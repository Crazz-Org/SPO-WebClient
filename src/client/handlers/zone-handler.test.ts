/**
 * zone-handler — entering zone painting shows the Zones overlay the same way placement does,
 * and leaving it puts back what was shown before (T8: the two modes used to disagree).
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));
jest.mock('./handler-utils', () => ({ setupEscapeHandler: jest.fn() }));

import { SurfaceType, WsMessageType } from '@/shared/types';
import type { WsRespDefineZone } from '@/shared/types';
import { toggleZonePaintingMode, cancelZonePaintingMode } from './zone-handler';
import { useGameStore } from '../store/game-store';
import type { ClientHandlerContext } from './client-context';

function makeCtx(zones: boolean, overlay: SurfaceType | null) {
  const renderer = {
    setZonePaintingMode: jest.fn(),
    setZoneAreaCompleteCallback: jest.fn(),
    setCancelZonePaintingCallback: jest.fn(),
  };
  const ctx = {
    isZonePaintingMode: false,
    selectedZoneType: 0,
    isRoadBuildingMode: false,
    isRoadDemolishMode: false,
    currentBuildingToPlace: null,
    isCityZonesEnabled: zones,
    activeOverlayType: overlay,
    overlayBeforePlacement: { type: 'none' },
    toggleZoneOverlay: jest.fn(),
    getRenderer: () => renderer,
    cancelRoadBuildingMode: jest.fn(),
    cancelRoadDemolishMode: jest.fn(),
    cancelBuildingPlacement: jest.fn(),
    sendRequest: jest.fn(),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
  return { ctx, renderer };
}

describe('zone painting and the overlay', () => {
  beforeEach(() => useGameStore.setState({ overlayBeforeMode: null }));

  it('Crime shown before: hidden while painting, back after cancel', () => {
    const { ctx, renderer } = makeCtx(false, SurfaceType.CRIME);
    toggleZonePaintingMode(ctx, 2);
    expect(ctx.isZonePaintingMode).toBe(true);
    expect(ctx.selectedZoneType).toBe(2);
    expect(renderer.setZonePaintingMode).toHaveBeenCalledWith(true, 2);
    expect(ctx.isCityZonesEnabled).toBe(true);
    expect(ctx.activeOverlayType).toBeNull();
    expect(useGameStore.getState().overlayBeforeMode).toEqual({ type: 'overlay', overlay: SurfaceType.CRIME });
    cancelZonePaintingMode(ctx);
    expect(ctx.isZonePaintingMode).toBe(false);
    expect(ctx.isCityZonesEnabled).toBe(false);
    expect(ctx.activeOverlayType).toBe(SurfaceType.CRIME);
    expect(renderer.setZonePaintingMode).toHaveBeenLastCalledWith(false);
  });

  it('Zones already on stays on after painting (the old code switched it off)', () => {
    const { ctx } = makeCtx(true, null);
    toggleZonePaintingMode(ctx, 1);
    cancelZonePaintingMode(ctx);
    expect(ctx.isCityZonesEnabled).toBe(true);
    expect(ctx.toggleZoneOverlay).not.toHaveBeenCalled();
  });

  it('toggling the same zone type again cancels; other modes are cancelled on entry', () => {
    const { ctx } = makeCtx(false, null);
    (ctx as unknown as { isRoadBuildingMode: boolean }).isRoadBuildingMode = true;
    (ctx as unknown as { isRoadDemolishMode: boolean }).isRoadDemolishMode = true;
    (ctx as unknown as { currentBuildingToPlace: unknown }).currentBuildingToPlace = { name: 'x' };
    toggleZonePaintingMode(ctx, 3);
    expect(ctx.cancelRoadBuildingMode).toHaveBeenCalled();
    expect(ctx.cancelRoadDemolishMode).toHaveBeenCalled();
    expect(ctx.cancelBuildingPlacement).toHaveBeenCalled();
    toggleZonePaintingMode(ctx, 3);
    expect(ctx.isZonePaintingMode).toBe(false);
  });
});

describe('defineZoneArea — reached through the renderer callback', () => {
  function reachCallback(ctx: ClientHandlerContext, renderer: { setZoneAreaCompleteCallback: jest.Mock }) {
    toggleZonePaintingMode(ctx, 2);
    return renderer.setZoneAreaCompleteCallback.mock.calls[0][0] as (x1: number, y1: number, x2: number, y2: number) => Promise<void>;
  }

  it('a refusal shows an error notification and does not reopen the Zones overlay', async () => {
    const { ctx, renderer } = makeCtx(false, null);
    const complete = reachCallback(ctx, renderer);
    const response: WsRespDefineZone = {
      type: WsMessageType.RESP_DEFINE_ZONE,
      wsRequestId: 'req-1',
      success: false,
      message: 'Zone refused by the server: Unknown error (code 1)',
      errorCode: 1,
    };
    (ctx.sendRequest as jest.Mock).mockResolvedValue(response);
    (ctx.toggleZoneOverlay as jest.Mock).mockClear();

    await complete(0, 0, 2, 2);

    expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    expect(ctx.showNotification).toHaveBeenCalledWith(response.message, 'error');
    expect(ctx.toggleZoneOverlay).not.toHaveBeenCalled();
  });

  it('acceptance shows a toast naming the requested tile count, not tiles applied', async () => {
    const { ctx, renderer } = makeCtx(false, null);
    const complete = reachCallback(ctx, renderer);
    const response: WsRespDefineZone = {
      type: WsMessageType.RESP_DEFINE_ZONE,
      wsRequestId: 'req-1',
      success: true,
    };
    (ctx.sendRequest as jest.Mock).mockResolvedValue(response);

    await complete(0, 0, 2, 2);

    expect(ctx.showNotification).toHaveBeenCalledWith('Zone requested: 9 tiles', 'success');
    expect(ctx.showNotification).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });
});
