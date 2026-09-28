/**
 * road-handler — a road drag asks before spending (cost = what the gateway charges), and
 * demolition asks before removing; both honour the session opt-out.
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));
jest.mock('./handler-utils', () => ({ setupEscapeHandler: jest.fn() }));

import { buildRoadSegment, demolishRoadAt, demolishRoadArea, toggleRoadBuildingMode, toggleRoadDemolishMode } from './road-handler';
import { useUiStore } from '../store/ui-store';
import { useGameStore } from '../store/game-store';
import type { ClientHandlerContext } from './client-context';
import { roadPathTiles, type RoadTileFacts } from '@/shared/road-cost';

/** Plain land everywhere — what the renderer reports over untouched ground. */
function plainLand(x1: number, y1: number, x2: number, y2: number): RoadTileFacts[] {
  return roadPathTiles(x1, y1, x2, y2).map(() => ({ hasRoad: false, isBridge: false, isVoid: false }));
}

function makeCtx(
  validation: { valid: boolean; error?: string } = { valid: true },
  facts: (x1: number, y1: number, x2: number, y2: number) => RoadTileFacts[] = plainLand,
) {
  return {
    isBuildingRoad: false,
    getRenderer: () => ({ validateRoadPath: () => validation, getRoadPathFacts: facts }),
    sendRequest: jest.fn().mockResolvedValue({ success: true, tileCount: 4, cost: 8_000_000 }),
    showNotification: jest.fn(),
    loadAlignedMapArea: jest.fn(),
    loadAlignedMapAreaForRect: jest.fn(),
  } as unknown as ClientHandlerContext & { sendRequest: jest.Mock; showNotification: jest.Mock };
}

describe('buildRoadSegment asks before spending', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null });
    useGameStore.setState({ tycoonStats: { cash: '10,000,000', incomePerHour: '0', failureLevel: 0 } as never });
    sessionStorage.clear();
  });

  it('raises a spend Dialog with tiles, cost and cash after; sends only on confirm', async () => {
    const ctx = makeCtx();
    const done = buildRoadSegment(ctx, 10, 5, 14, 5);
    const s = useUiStore.getState();
    expect(s.modal).toBe('confirm');
    expect(s.confirmPayload?.title).toBe('Build this road?');
    expect(s.confirmPayload?.options?.kind).toBe('spend');
    // 4 steps = 5 priced tiles, start tile included (#99).
    expect(s.confirmPayload?.options?.rows).toEqual([
      { label: 'Tiles', value: '5' },
      { label: 'Cost', value: '$10,000,000', tone: 'gold' },
      { label: 'Cash after', value: '$0', tone: 'positive' },
    ]);
    expect(ctx.sendRequest).not.toHaveBeenCalled();
    s.confirmPayload?.onConfirm();
    await done;
    expect(ctx.sendRequest).toHaveBeenCalledTimes(1);
    expect(ctx.sendRequest.mock.calls[0][0]).toMatchObject({ x1: 10, y1: 5, x2: 14, y2: 5 });
    // The facts the price was made of ride with the request, so the gateway charges the
    // very amount that was confirmed here.
    expect(ctx.sendRequest.mock.calls[0][0].tileFacts).toHaveLength(5);
    expect(ctx.showNotification).toHaveBeenCalledWith('Road built: 4 tiles', 'success');
  });

  it('cash after goes negative when the drag costs more than the tycoon holds; no cash row without stats', () => {
    const ctx = makeCtx();
    void buildRoadSegment(ctx, 0, 0, 0, 6);
    expect(useUiStore.getState().confirmPayload?.options?.rows?.[2]).toEqual({ label: 'Cash after', value: '-$4,000,000', tone: 'negative' });
    useUiStore.setState({ modal: null, confirmPayload: null });
    useGameStore.setState({ tycoonStats: null });
    void buildRoadSegment(ctx, 0, 0, 0, 6);
    expect(useUiStore.getState().confirmPayload?.options?.rows).toHaveLength(2);
  });

  it('names the bridge tiles and the free re-use of paved ones, and prices them (#99)', () => {
    // (0,0) → (2,0): start already paved, then land, then water with no concrete.
    const ctx = makeCtx({ valid: true }, () => [
      { hasRoad: true, isBridge: false, isVoid: false },
      { hasRoad: false, isBridge: false, isVoid: false },
      { hasRoad: false, isBridge: true, isVoid: false },
    ]);
    void buildRoadSegment(ctx, 0, 0, 2, 0);
    expect(useUiStore.getState().confirmPayload?.options?.rows).toEqual([
      { label: 'Tiles', value: '3' },
      { label: 'Bridge tiles', value: '1' },
      { label: 'Already paved', value: '1 (free)' },
      { label: 'Cost', value: '$6,000,000', tone: 'gold' },
      { label: 'Cash after', value: '$4,000,000', tone: 'positive' },
    ]);
  });

  it('an invalid path is refused before any dialog', async () => {
    const ctx = makeCtx({ valid: false, error: 'Road must connect to existing road network' });
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(useUiStore.getState().modal).toBeNull();
    expect(ctx.showNotification).toHaveBeenCalledWith('Road must connect to existing road network', 'error');
    expect(ctx.sendRequest).not.toHaveBeenCalled();
  });

  it('skips the dialog when the player opted out for the session; a request in flight is ignored', async () => {
    sessionStorage.setItem('spo.dialog.dontAsk.road', '1');
    const ctx = makeCtx();
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(useUiStore.getState().modal).toBeNull();
    expect(ctx.sendRequest).toHaveBeenCalledTimes(1);
    ctx.isBuildingRoad = true;
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(ctx.sendRequest).toHaveBeenCalledTimes(1);
  });

  it('reports a partial build as a warning and a refusal as an error', async () => {
    sessionStorage.setItem('spo.dialog.dontAsk.road', '1');
    const ctx = makeCtx();
    ctx.sendRequest.mockResolvedValueOnce({ success: true, partial: true, tileCount: 2, cost: 4_000_000, message: 'Road partially built' });
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(ctx.showNotification).toHaveBeenLastCalledWith('Road partially built', 'warning');
    ctx.sendRequest.mockResolvedValueOnce({ success: false, message: 'Insufficient funds' });
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(ctx.showNotification).toHaveBeenLastCalledWith('Insufficient funds', 'error');
    ctx.sendRequest.mockRejectedValueOnce(new Error('boom'));
    await buildRoadSegment(ctx, 0, 0, 3, 0);
    expect(ctx.isBuildingRoad).toBe(false);
  });
});

describe('road demolition asks first', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null });
    sessionStorage.clear();
  });

  it('one tile: destructive Dialog, then the request', async () => {
    const ctx = makeCtx();
    const done = demolishRoadAt(ctx, 4, 9);
    const s = useUiStore.getState();
    expect(s.confirmPayload?.title).toBe('Demolish road?');
    expect(s.confirmPayload?.options?.kind).toBe('destructive');
    expect(s.confirmPayload?.message).toContain('(4, 9)');
    s.confirmPayload?.onConfirm();
    await done;
    expect(ctx.sendRequest.mock.calls[0][0]).toMatchObject({ x: 4, y: 9 });
    expect(ctx.showNotification).toHaveBeenCalledWith('Road demolished', 'success');
  });

  it('an area: the rectangle is normalised and the same opt-out key applies', async () => {
    sessionStorage.setItem('spo.dialog.dontAsk.roadDemolish', '1');
    const ctx = makeCtx();
    await demolishRoadArea(ctx, 8, 8, 2, 3);
    expect(useUiStore.getState().modal).toBeNull();
    expect(ctx.sendRequest.mock.calls[0][0]).toMatchObject({ x1: 2, y1: 3, x2: 8, y2: 8 });
    expect(ctx.showNotification).toHaveBeenCalledWith('Roads demolished', 'success');
    ctx.sendRequest.mockResolvedValueOnce({ success: false, message: 'Not yours' });
    await demolishRoadArea(ctx, 0, 0, 1, 1);
    expect(ctx.showNotification).toHaveBeenLastCalledWith('Not yours', 'error');
    ctx.sendRequest.mockRejectedValueOnce(new Error('down'));
    await demolishRoadAt(ctx, 0, 0);
    expect(ctx.showNotification).toHaveBeenLastCalledWith('Could not demolish the road — something went wrong. Try again.', 'error');
    ctx.sendRequest.mockRejectedValueOnce(new Error('Request Timeout'));
    await demolishRoadArea(ctx, 0, 0, 1, 1);
    expect(ctx.showNotification).toHaveBeenLastCalledWith(
      'Could not demolish these roads — the server did not answer in time. Try again.', 'error',
    );
  });
});

describe('the renderer callbacks route through the asking versions', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null });
    sessionStorage.clear();
  });

  it('a completed road drag and a demolish click/area open their dialogs', () => {
    const renderer = {
      setRoadDrawingMode: jest.fn(),
      setRoadSegmentCompleteCallback: jest.fn(),
      setCancelRoadDrawingCallback: jest.fn(),
      setRoadDemolishClickCallback: jest.fn(),
      setRoadDemolishAreaCompleteCallback: jest.fn(),
      setCancelRoadDemolishCallback: jest.fn(),
      validateRoadPath: () => ({ valid: true }),
      getRoadPathFacts: plainLand,
    };
    const ctx = {
      ...makeCtx(),
      isRoadBuildingMode: false,
      isRoadDemolishMode: false,
      currentBuildingToPlace: null,
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;
    toggleRoadBuildingMode(ctx);
    const onSegment = renderer.setRoadSegmentCompleteCallback.mock.calls[0][0] as (a: number, b: number, c: number, d: number) => void;
    onSegment(0, 0, 2, 0);
    expect(useUiStore.getState().confirmPayload?.title).toBe('Build this road?');
    useUiStore.setState({ modal: null, confirmPayload: null });
    toggleRoadDemolishMode(ctx);
    const onClick = renderer.setRoadDemolishClickCallback.mock.calls[0][0] as (x: number, y: number) => void;
    onClick(1, 1);
    expect(useUiStore.getState().confirmPayload?.title).toBe('Demolish road?');
    useUiStore.setState({ modal: null, confirmPayload: null });
    const onArea = renderer.setRoadDemolishAreaCompleteCallback.mock.calls[0][0] as (a: number, b: number, c: number, d: number) => void;
    onArea(0, 0, 2, 2);
    expect(useUiStore.getState().confirmPayload?.message).toContain('(0, 0) to (2, 2)');
  });
});
