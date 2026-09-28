/**
 * Map Handler — extracted from StarpeaceClient.
 *
 * Handles map area loading, surface fetching, zone overlays,
 * city zones toggle, and map refresh.
 */

import {
  WsMessageType,
  WsReqMapLoad,
  WsReqGetSurface,
  WsRespSurfaceData,
  SurfaceType,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

// ── Paced sender ──────────────────────────────────────────────────────────────
// Every REQ_MAP_LOAD and REQ_GET_SURFACE leaves through this one line, so that
// turning on an overlay or building a long road never sends hundreds of
// messages at once (the gateway serialises them, and caps each socket's rate).

/** Most requests of either kind left unanswered at once. */
const MAX_IN_FLIGHT = 3;
/** Most sends allowed in any rolling window of SEND_WINDOW_MS. */
const MAX_SENDS_PER_WINDOW = 10;
/** Length of the rolling send window. */
const SEND_WINDOW_MS = 1000;
/** A map load with no answer frees its place after this long — same as the renderer's zone-loader timeout. */
const MAP_LOAD_TIMEOUT_MS = 15_000;

interface SurfaceJob {
  surfaceType: SurfaceType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  resolve: () => void;
  promise: Promise<void>;
}

interface InFlightLoad {
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

interface Pacer {
  loadQueue: WsReqMapLoad[];
  surfaceQueue: SurfaceJob[];
  inFlight: number;
  inFlightLoads: InFlightLoad[];
  sendTimes: number[];
  wakeTimer: ReturnType<typeof setTimeout> | null;
}

const pacers = new WeakMap<ClientHandlerContext, Pacer>();

function getPacer(ctx: ClientHandlerContext): Pacer {
  let pacer = pacers.get(ctx);
  if (!pacer) {
    pacer = { loadQueue: [], surfaceQueue: [], inFlight: 0, inFlightLoads: [], sendTimes: [], wakeTimer: null };
    pacers.set(ctx, pacer);
  }
  return pacer;
}

function releaseLoad(ctx: ClientHandlerContext, pacer: Pacer, entry: InFlightLoad): void {
  const idx = pacer.inFlightLoads.indexOf(entry);
  if (idx === -1) return;
  clearTimeout(entry.timer);
  pacer.inFlightLoads.splice(idx, 1);
  pacer.inFlight--;
  pump(ctx, pacer);
}

function pump(ctx: ClientHandlerContext, pacer: Pacer): void {
  while (pacer.inFlight < MAX_IN_FLIGHT && (pacer.loadQueue.length > 0 || pacer.surfaceQueue.length > 0)) {
    const now = Date.now();
    while (pacer.sendTimes.length > 0 && pacer.sendTimes[0] <= now - SEND_WINDOW_MS) {
      pacer.sendTimes.shift();
    }
    if (pacer.sendTimes.length >= MAX_SENDS_PER_WINDOW) {
      if (pacer.wakeTimer === null) {
        pacer.wakeTimer = setTimeout(() => {
          pacer.wakeTimer = null;
          pump(ctx, pacer);
        }, Math.max(0, pacer.sendTimes[0] + SEND_WINDOW_MS - now));
      }
      return;
    }

    const req = pacer.loadQueue.shift();
    if (req) {
      ctx.rawSend(req);
      pacer.inFlight++;
      pacer.sendTimes.push(Date.now());
      const entry: InFlightLoad = {
        x: req.x,
        y: req.y,
        timer: setTimeout(() => releaseLoad(ctx, pacer, entry), MAP_LOAD_TIMEOUT_MS),
      };
      pacer.inFlightLoads.push(entry);
      continue;
    }

    const job = pacer.surfaceQueue.shift() as SurfaceJob;
    const active = ctx.isCityZonesEnabled ? SurfaceType.ZONES : ctx.activeOverlayType;
    if (job.surfaceType !== active) {
      // The answer would be discarded anyway (stillActive check) — skip it.
      job.resolve();
      continue;
    }
    pacer.inFlight++;
    pacer.sendTimes.push(Date.now());
    void requestSurface(ctx, job.surfaceType, job.x1, job.y1, job.x2, job.y2).finally(() => {
      pacer.inFlight--;
      job.resolve();
      pump(ctx, pacer);
    });
  }
}

/**
 * Called on every RESP_MAP_DATA / EVENT_MAP_DATA: frees the place of the
 * in-flight map load whose origin matches. Unmatched data (a push, or a load
 * already freed by its timeout) changes nothing.
 */
export function onMapDataReceived(ctx: ClientHandlerContext, x: number, y: number): void {
  const pacer = pacers.get(ctx);
  if (!pacer) return;
  const entry = pacer.inFlightLoads.find(e => e.x === x && e.y === y);
  if (entry) releaseLoad(ctx, pacer, entry);
}

/** Order zone keys ("x,y") nearest-first to the camera, when the renderer can tell where it is. */
function zonesNearestFirst(renderer: { getCameraPosition?: () => { x: number; y: number } }, keys: string[]): Array<[number, number]> {
  const zones = keys.map(key => key.split(',').map(Number) as [number, number]);
  if (typeof renderer.getCameraPosition !== 'function') return zones;
  const cam = renderer.getCameraPosition();
  const dist = ([x, y]: [number, number]) => (x + 32 - cam.x) ** 2 + (y + 32 - cam.y) ** 2;
  return zones.sort((a, b) => dist(a) - dist(b));
}

export function loadMapArea(ctx: ClientHandlerContext, x?: number, y?: number, w: number = 64, h: number = 64): void {
  const coords = x !== undefined && y !== undefined ? ` at (${x}, ${y})` : ' at player position';
  ClientBridge.log('Map', `Loading area${coords} ${w}x${h}...`);

  const req: WsReqMapLoad = {
    type: WsMessageType.REQ_MAP_LOAD,
    x: x !== undefined ? x : 0,
    y: y !== undefined ? y : 0,
    width: w,
    height: h
  };

  const pacer = getPacer(ctx);
  pacer.loadQueue.push(req);
  pump(ctx, pacer);

  // When any overlay is active, also fetch surface data for this area
  const activeSurface = ctx.isCityZonesEnabled ? SurfaceType.ZONES : ctx.activeOverlayType;
  if (activeSurface !== null && x !== undefined && y !== undefined) {
    void fetchSurfaceForArea(ctx, activeSurface, x, y, x + w, y + h);
  }
}

/**
 * Queue one surface request on the paced sender. The promise resolves once the
 * request has been sent and its answer handled, or once it was skipped because
 * its overlay is no longer active. An identical request still waiting in the
 * queue is not queued twice: its promise is returned instead.
 */
export function fetchSurfaceForArea(ctx: ClientHandlerContext, surfaceType: SurfaceType, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const pacer = getPacer(ctx);
  const existing = pacer.surfaceQueue.find(j =>
    j.surfaceType === surfaceType && j.x1 === x1 && j.y1 === y1 && j.x2 === x2 && j.y2 === y2);
  if (existing) return existing.promise;

  let resolve: () => void = () => {};
  const promise = new Promise<void>(r => { resolve = r; });
  pacer.surfaceQueue.push({ surfaceType, x1, y1, x2, y2, resolve, promise });
  pump(ctx, pacer);
  return promise;
}

async function requestSurface(ctx: ClientHandlerContext, surfaceType: SurfaceType, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  try {
    const req: WsReqGetSurface = {
      type: WsMessageType.REQ_GET_SURFACE,
      surfaceType,
      x1, y1, x2, y2,
    };
    const response = await ctx.sendRequest(req) as WsRespSurfaceData;
    const renderer = ctx.getRenderer();
    const stillActive = ctx.isCityZonesEnabled
      ? surfaceType === SurfaceType.ZONES
      : surfaceType === ctx.activeOverlayType;
    if (renderer && stillActive) {
      const isHeatmap = surfaceType !== SurfaceType.ZONES && surfaceType !== SurfaceType.TOWNS;
      renderer.setZoneOverlay(true, response.data, x1, y1, isHeatmap, surfaceType === SurfaceType.TOWNS);
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to fetch ${surfaceType} surface: ${toErrorMessage(err)}`);
  }
}

export function loadAlignedMapArea(ctx: ClientHandlerContext, x: number, y: number, margin: number = 0): void {
  const zoneSize = 64;
  const alignedX = Math.floor(x / zoneSize) * zoneSize;
  const alignedY = Math.floor(y / zoneSize) * zoneSize;

  loadMapArea(ctx, alignedX, alignedY, zoneSize, zoneSize);

  if (margin <= 0) return;

  const xInZone = x - alignedX;
  const yInZone = y - alignedY;

  const needRight = xInZone + margin >= zoneSize;
  const needBelow = yInZone + margin >= zoneSize;

  if (needRight) {
    loadMapArea(ctx, alignedX + zoneSize, alignedY, zoneSize, zoneSize);
  }
  if (needBelow) {
    loadMapArea(ctx, alignedX, alignedY + zoneSize, zoneSize, zoneSize);
  }
  if (needRight && needBelow) {
    loadMapArea(ctx, alignedX + zoneSize, alignedY + zoneSize, zoneSize, zoneSize);
  }
}

export function loadAlignedMapAreaForRect(ctx: ClientHandlerContext, x1: number, y1: number, x2: number, y2: number): void {
  const zoneSize = 64;
  const minAX = Math.floor(Math.min(x1, x2) / zoneSize) * zoneSize;
  const minAY = Math.floor(Math.min(y1, y2) / zoneSize) * zoneSize;
  const maxAX = Math.floor(Math.max(x1, x2) / zoneSize) * zoneSize;
  const maxAY = Math.floor(Math.max(y1, y2) / zoneSize) * zoneSize;

  for (let ax = minAX; ax <= maxAX; ax += zoneSize) {
    for (let ay = minAY; ay <= maxAY; ay += zoneSize) {
      loadMapArea(ctx, ax, ay, zoneSize, zoneSize);
    }
  }
}

export function toggleCityZones(ctx: ClientHandlerContext): void {
  ctx.isCityZonesEnabled = !ctx.isCityZonesEnabled;
  // Store is updated automatically via ctx.isCityZonesEnabled setter
  ClientBridge.log('Zones', `City Zones overlay ${ctx.isCityZonesEnabled ? 'enabled' : 'disabled'}`);

  if (ctx.isCityZonesEnabled && ctx.activeOverlayType !== null) {
    ctx.activeOverlayType = null;
    // Store is updated automatically via ctx.activeOverlayType setter
    toggleZoneOverlay(ctx, false, SurfaceType.ZONES);
  }

  if (ctx.isCityZonesEnabled) {
    toggleZoneOverlay(ctx, true, SurfaceType.ZONES);
  } else {
    toggleZoneOverlay(ctx, false, SurfaceType.ZONES);
  }
}

export function setOverlay(ctx: ClientHandlerContext, surfaceType: SurfaceType | null): void {
  // Toggle off if same overlay selected
  if (surfaceType !== null && surfaceType === ctx.activeOverlayType) {
    surfaceType = null;
  }

  if (ctx.activeOverlayType !== null) {
    toggleZoneOverlay(ctx, false, ctx.activeOverlayType);
  }

  ctx.activeOverlayType = surfaceType;
  // Store is updated automatically via ctx.activeOverlayType setter

  if (surfaceType === null) {
    ClientBridge.log('Overlay', 'Overlay disabled');
    return;
  }

  if (ctx.isCityZonesEnabled) {
    ctx.isCityZonesEnabled = false;
    // Store is updated automatically via ctx.isCityZonesEnabled setter
    ClientBridge.log('Zones', 'City Zones disabled (overlay activated)');
  }

  ClientBridge.log('Overlay', `Enabling ${surfaceType} overlay`);
  toggleZoneOverlay(ctx, true, surfaceType);
}

export function toggleZoneOverlay(ctx: ClientHandlerContext, enabled: boolean, surfaceType: SurfaceType): void {
  ClientBridge.log('Overlay', enabled ? `Enabling ${surfaceType} overlay` : 'Disabling overlay');

  const renderer = ctx.getRenderer();
  if (!renderer) return;

  if (!enabled) {
    renderer.setZoneOverlay(false);
    return;
  }

  const isHeatmap = surfaceType !== SurfaceType.ZONES && surfaceType !== SurfaceType.TOWNS;
  renderer.setZoneOverlay(true, undefined, undefined, undefined, isHeatmap, surfaceType === SurfaceType.TOWNS);
  const loadedKeys = renderer.getLoadedZoneKeys();
  for (const [x, y] of zonesNearestFirst(renderer, loadedKeys)) {
    void fetchSurfaceForArea(ctx, surfaceType, x, y, x + 64, y + 64);
  }

  ClientBridge.log('Overlay', `Fetching ${surfaceType} overlay for ${loadedKeys.length} loaded zones`);
}

export function refreshMapData(ctx: ClientHandlerContext): void {
  ClientBridge.log('Map', 'Refreshing map data...');

  const renderer = ctx.getRenderer();
  if (!renderer || !renderer.getCameraPosition) {
    ClientBridge.log('Error', 'Cannot refresh: renderer not available');
    return;
  }

  const cameraPos = renderer.getCameraPosition();
  const x = Math.floor(cameraPos.x);
  const y = Math.floor(cameraPos.y);

  renderer.invalidateArea(x - 64, y - 64, x + 64, y + 64);
  renderer.triggerZoneCheck();

  // Re-fetch overlay data if an overlay is active
  const activeSurface = ctx.isCityZonesEnabled ? SurfaceType.ZONES : ctx.activeOverlayType;
  if (activeSurface !== null) {
    const loadedKeys = renderer.getLoadedZoneKeys();
    for (const [zx, zy] of zonesNearestFirst(renderer, loadedKeys)) {
      void fetchSurfaceForArea(ctx, activeSurface, zx, zy, zx + 64, zy + 64);
    }
  }

  ctx.showNotification('Map refreshed', 'info');
}
