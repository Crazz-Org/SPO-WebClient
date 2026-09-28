/**
 * map-handler — the paced sender every REQ_MAP_LOAD and REQ_GET_SURFACE goes through.
 * At most 3 unanswered at once, at most 10 sends in any rolling 1 s window,
 * map loads before overlay requests (#1051).
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { SurfaceType, WsMessageType } from '@/shared/types';
import type { WsMessage } from '@/shared/types';
import {
  fetchSurfaceForArea,
  loadAlignedMapAreaForRect,
  loadMapArea,
  onMapDataReceived,
  refreshMapData,
  setOverlay,
} from './map-handler';
import { dispatchEvent } from './event-handler';
import type { ClientHandlerContext } from './client-context';

interface SendRecord {
  t: number;
  type: WsMessageType;
  x: number;
  y: number;
  answered: boolean;
  resolve?: (v: unknown) => void;
  reject?: (e: unknown) => void;
}

interface Harness {
  ctx: ClientHandlerContext & { isCityZonesEnabled: boolean; activeOverlayType: SurfaceType | null };
  sends: SendRecord[];
  renderer: Record<string, jest.Mock>;
  maxOutstanding: () => number;
}

const LOAD_TIMEOUT = 15_000;

function zoneKeys(n: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(`${(i % 20) * 64},${Math.floor(i / 20) * 64}`);
  return keys;
}

function makeHarness(opts: { zones?: number; overlay?: SurfaceType | null; camera?: { x: number; y: number } | null } = {}): Harness {
  const sends: SendRecord[] = [];
  let maxOut = 0;

  const outstanding = (now: number) =>
    sends.filter(s => !s.answered && !(s.type === WsMessageType.REQ_MAP_LOAD && now - s.t >= LOAD_TIMEOUT)).length;

  const record = (msg: WsMessage, extra: Partial<SendRecord> = {}): SendRecord => {
    const m = msg as WsMessage & { x?: number; y?: number; x1?: number; y1?: number };
    const rec: SendRecord = {
      t: Date.now(), type: msg.type, x: m.x ?? m.x1 ?? 0, y: m.y ?? m.y1 ?? 0, answered: false, ...extra,
    };
    sends.push(rec);
    maxOut = Math.max(maxOut, outstanding(rec.t));
    return rec;
  };

  const keys = zoneKeys(opts.zones ?? 0);
  const renderer: Record<string, jest.Mock> = {
    setZoneOverlay: jest.fn(),
    getLoadedZoneKeys: jest.fn(() => keys),
    invalidateArea: jest.fn(),
    triggerZoneCheck: jest.fn(),
    updateMapData: jest.fn(),
  };
  if (opts.camera !== null) {
    const cam = opts.camera ?? { x: 0, y: 0 };
    renderer.getCameraPosition = jest.fn(() => cam);
  }

  const ctx = {
    isCityZonesEnabled: false,
    activeOverlayType: opts.overlay ?? null,
    rawSend: jest.fn((msg: WsMessage) => { record(msg); }),
    sendRequest: jest.fn((msg: WsMessage) => new Promise((resolve, reject) => { record(msg, { resolve, reject }); })),
    getRenderer: () => renderer,
    showNotification: jest.fn(),
  } as unknown as Harness['ctx'];

  return { ctx, sends, renderer, maxOutstanding: () => maxOut };
}

const surfaces = (h: Harness) => h.sends.filter(s => s.type === WsMessageType.REQ_GET_SURFACE);
const loads = (h: Harness) => h.sends.filter(s => s.type === WsMessageType.REQ_MAP_LOAD);

function answerSurface(rec: SendRecord): void {
  rec.answered = true;
  rec.resolve?.({ type: WsMessageType.RESP_SURFACE_DATA, data: { rows: [] } });
}

function answerLoad(h: Harness, rec: SendRecord): void {
  rec.answered = true;
  dispatchEvent(h.ctx, {
    type: WsMessageType.RESP_MAP_DATA,
    data: { x: rec.x, y: rec.y, w: 64, h: 64, buildings: [], segments: [] },
  } as unknown as WsMessage);
}

/** Answers everything outstanding as soon as it goes out, stepping time 10 ms at a time. */
async function drain(h: Harness, maxSteps = 20_000): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const open = h.sends.filter(s => !s.answered);
    if (open.length === 0) {
      await jest.advanceTimersByTimeAsync(1100);
      if (h.sends.every(s => s.answered)) return;
      continue;
    }
    for (const rec of open) {
      if (rec.type === WsMessageType.REQ_MAP_LOAD) answerLoad(h, rec);
      else answerSurface(rec);
    }
    await jest.advanceTimersByTimeAsync(10);
  }
  throw new Error('drain did not finish');
}

function expectBounds(h: Harness): void {
  expect(h.maxOutstanding()).toBeLessThanOrEqual(3);
  const times = h.sends.map(s => s.t).sort((a, b) => a - b);
  for (let i = 0; i + 10 < times.length; i++) {
    expect(times[i + 10] - times[i]).toBeGreaterThanOrEqual(1000);
  }
}

describe('map-handler paced sender', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('overlay on with 300 loaded zones: 3 before any answer, one more per answer, all 300 eventually', async () => {
    const h = makeHarness({ zones: 300 });
    setOverlay(h.ctx, SurfaceType.CRIME);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(3);

    answerSurface(surfaces(h)[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(4);

    answerSurface(surfaces(h)[1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(5);

    await drain(h);
    expect(surfaces(h)).toHaveLength(300);
    expect(new Set(surfaces(h).map(s => `${s.x},${s.y}`)).size).toBe(300);
    expectBounds(h);
    // Rate-bound: 300 sends at ≤10/s cannot finish in under ~29 s
    const times = h.sends.map(s => s.t);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThanOrEqual(29_000);
    expect(h.renderer.setZoneOverlay).toHaveBeenCalledWith(true, { rows: [] }, 0, 0, true, false);
  });

  it('refreshMapData with an overlay on and 300 loaded zones: same bounds, all 300 sent', async () => {
    const h = makeHarness({ zones: 300, overlay: SurfaceType.CRIME });
    refreshMapData(h.ctx);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(3);
    answerSurface(surfaces(h)[2]);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(4);
    await drain(h);
    expect(surfaces(h)).toHaveLength(300);
    expectBounds(h);
    expect(h.ctx.showNotification).toHaveBeenCalledWith('Map refreshed', 'info');
  });

  it('a road over 10 × 10 zones: 3 loads in flight, an answer frees one, a silent load frees after 15 s', async () => {
    const h = makeHarness();
    loadAlignedMapAreaForRect(h.ctx, 0, 0, 639, 639);
    expect(loads(h)).toHaveLength(3);

    answerLoad(h, loads(h)[0]);
    expect(loads(h)).toHaveLength(4);
    expect(h.renderer.updateMapData).toHaveBeenCalledTimes(1);

    // No answer for the 3 in flight: nothing moves until the 15 s timeout
    await jest.advanceTimersByTimeAsync(LOAD_TIMEOUT - 1);
    expect(loads(h)).toHaveLength(4);
    await jest.advanceTimersByTimeAsync(1);
    expect(loads(h)).toHaveLength(7);

    await drain(h);
    expect(loads(h)).toHaveLength(100);
    expect(new Set(loads(h).map(s => `${s.x},${s.y}`)).size).toBe(100);
    expectBounds(h);
  });

  it('with a surface backlog waiting, a zone-loader loadMapArea is the next message sent', async () => {
    const h = makeHarness({ zones: 300 });
    setOverlay(h.ctx, SurfaceType.CRIME);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h)).toHaveLength(3);

    loadMapArea(h.ctx, 640, 640);
    expect(loads(h)).toHaveLength(0);

    answerSurface(surfaces(h)[0]);
    await jest.advanceTimersByTimeAsync(0);
    const next = h.sends[3];
    expect(next.type).toBe(WsMessageType.REQ_MAP_LOAD);
    expect([next.x, next.y]).toEqual([640, 640]);

    await drain(h);
    expectBounds(h);
  });

  it('switching the overlay off skips the queued requests and settles their promises', async () => {
    const h = makeHarness({ zones: 300 });
    setOverlay(h.ctx, SurfaceType.CRIME);
    await jest.advanceTimersByTimeAsync(0);
    const queued = fetchSurfaceForArea(h.ctx, SurfaceType.CRIME, 5000, 5000, 5064, 5064);
    let settled = false;
    void queued.then(() => { settled = true; });

    setOverlay(h.ctx, null);
    // One in-flight request fails, the others answer: all free their place
    const inFlight = surfaces(h);
    inFlight[0].answered = true;
    inFlight[0].reject?.(new Error('Disconnected'));
    answerSurface(inFlight[1]);
    answerSurface(inFlight[2]);
    await jest.advanceTimersByTimeAsync(0);

    expect(surfaces(h)).toHaveLength(3);
    expect(settled).toBe(true);
    // The late answers are not painted on a switched-off overlay
    expect(h.renderer.setZoneOverlay).not.toHaveBeenCalledWith(true, { rows: [] }, expect.anything(), expect.anything(), expect.anything(), expect.anything());
    // The sender is free again: a new load goes straight out
    loadMapArea(h.ctx, 0, 0);
    expect(loads(h)).toHaveLength(1);
  });

  it('an identical surface request still waiting in the queue is sent only once', async () => {
    const h = makeHarness({ overlay: SurfaceType.CRIME });
    for (let i = 0; i < 3; i++) void fetchSurfaceForArea(h.ctx, SurfaceType.CRIME, i * 64, 0, i * 64 + 64, 64);
    const a = fetchSurfaceForArea(h.ctx, SurfaceType.CRIME, 640, 640, 704, 704);
    const b = fetchSurfaceForArea(h.ctx, SurfaceType.CRIME, 640, 640, 704, 704);
    expect(b).toBe(a);
    await drain(h);
    expect(surfaces(h).filter(s => s.x === 640 && s.y === 640)).toHaveLength(1);
    expect(surfaces(h)).toHaveLength(4);
  });

  it('City Zones on: queued ZONES requests go out while a stale overlay type is skipped', async () => {
    const h = makeHarness({ overlay: SurfaceType.CRIME });
    h.ctx.isCityZonesEnabled = true;
    void fetchSurfaceForArea(h.ctx, SurfaceType.ZONES, 0, 0, 64, 64);
    void fetchSurfaceForArea(h.ctx, SurfaceType.CRIME, 64, 0, 128, 64);
    await drain(h);
    expect(surfaces(h)).toHaveLength(1);
    expect(h.renderer.setZoneOverlay).toHaveBeenCalledWith(true, { rows: [] }, 0, 0, false, false);
  });

  it('orders overlay requests nearest the camera first', async () => {
    const h = makeHarness({ zones: 300, camera: { x: 1000, y: 800 } });
    setOverlay(h.ctx, SurfaceType.CRIME);
    await jest.advanceTimersByTimeAsync(0);
    expect([surfaces(h)[0].x, surfaces(h)[0].y]).toEqual([960, 768]);
  });

  it('keeps the loaded order when the renderer cannot report its camera', async () => {
    const h = makeHarness({ zones: 300, camera: null });
    setOverlay(h.ctx, SurfaceType.CRIME);
    await jest.advanceTimersByTimeAsync(0);
    expect(surfaces(h).map(s => [s.x, s.y])).toEqual([[0, 0], [64, 0], [128, 0]]);
  });

  it('loadMapArea with an overlay on queues the load before its surface request', () => {
    const h = makeHarness({ overlay: SurfaceType.CRIME });
    loadMapArea(h.ctx, 128, 64);
    expect(h.sends.map(s => s.type)).toEqual([WsMessageType.REQ_MAP_LOAD, WsMessageType.REQ_GET_SURFACE]);
    // No coordinates: the load defaults to the origin and no surface is asked
    loadMapArea(h.ctx);
    expect(h.sends[2]).toMatchObject({ type: WsMessageType.REQ_MAP_LOAD, x: 0, y: 0 });
    expect(h.sends).toHaveLength(3);
  });

  it('map data that matches no in-flight load changes nothing', () => {
    const fresh = makeHarness();
    expect(() => onMapDataReceived(fresh.ctx, 0, 0)).not.toThrow();
    expect(fresh.sends).toHaveLength(0);

    const h = makeHarness();
    loadAlignedMapAreaForRect(h.ctx, 0, 0, 639, 0);
    expect(loads(h)).toHaveLength(3);
    onMapDataReceived(h.ctx, 9999, 9999);
    expect(loads(h)).toHaveLength(3);
    // A second answer for the same origin frees nothing more
    onMapDataReceived(h.ctx, 0, 0);
    expect(loads(h)).toHaveLength(4);
    onMapDataReceived(h.ctx, 0, 0);
    expect(loads(h)).toHaveLength(4);
  });
});
