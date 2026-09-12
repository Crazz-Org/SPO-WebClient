/**
 * Zone Handler — extracted from StarpeaceClient.
 *
 * Handles zone painting mode and zone definition.
 */

import {
  WsMessageType,
  WsReqDefineZone,
  WsRespDefineZone,
  SurfaceType,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';
import { setupEscapeHandler } from './handler-utils';
import { enterZonesOverlayForMode, leaveZonesOverlayAfterMode } from './overlay-mode';

export function toggleZonePaintingMode(ctx: ClientHandlerContext, zoneType: number): void {
  if (ctx.isZonePaintingMode && ctx.selectedZoneType === zoneType) {
    cancelZonePaintingMode(ctx);
    return;
  }

  if (ctx.isRoadBuildingMode) ctx.cancelRoadBuildingMode();
  if (ctx.isRoadDemolishMode) ctx.cancelRoadDemolishMode();
  if (ctx.currentBuildingToPlace) ctx.cancelBuildingPlacement();

  ctx.isZonePaintingMode = true;
  ctx.selectedZoneType = zoneType;

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setZonePaintingMode(true, zoneType);
    renderer.setZoneAreaCompleteCallback((x1, y1, x2, y2) => {
      defineZoneArea(ctx, x1, y1, x2, y2);
    });
    renderer.setCancelZonePaintingCallback(() => {
      cancelZonePaintingMode(ctx);
    });
  }

  // Zones must be visible to paint them — shown the same way placement shows them, and put
  // back the same way on exit (T8: the two modes used to disagree).
  enterZonesOverlayForMode(ctx);
  setupZonePaintingKeyboardHandler(ctx);

  // Store is updated automatically via ctx.isZonePaintingMode and ctx.selectedZoneType setters
  ClientBridge.log('Zone', `Zone painting mode enabled: type ${zoneType}`);
}

export function cancelZonePaintingMode(ctx: ClientHandlerContext): void {
  ctx.isZonePaintingMode = false;

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setZonePaintingMode(false);
    renderer.setZoneAreaCompleteCallback(null);
    renderer.setCancelZonePaintingCallback(null);
  }

  // Put back what was shown before painting (Zones stays if the player had it on).
  leaveZonesOverlayAfterMode(ctx);

  // Store is updated automatically via ctx.isZonePaintingMode setter
  ClientBridge.log('Zone', 'Zone painting mode disabled');
}

function setupZonePaintingKeyboardHandler(ctx: ClientHandlerContext): void {
  setupEscapeHandler(
    () => ctx.isZonePaintingMode,
    () => cancelZonePaintingMode(ctx),
  );
}

async function defineZoneArea(ctx: ClientHandlerContext, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  ClientBridge.log('Zone', `Defining zone ${ctx.selectedZoneType} from (${x1},${y1}) to (${x2},${y2})...`);

  try {
    const req: WsReqDefineZone = {
      type: WsMessageType.REQ_DEFINE_ZONE,
      zoneId: ctx.selectedZoneType,
      x1, y1, x2, y2,
    };

    const response = await ctx.sendRequest(req) as WsRespDefineZone;

    if (response.success) {
      const tileCount = (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1);
      // States what was requested, not what was applied: the server skips
      // refused tiles inside the rectangle silently (Kernel/World.pas:4544-4546).
      ctx.showNotification(`Zone requested: ${tileCount} tiles`, 'success');
      ctx.toggleZoneOverlay(true, SurfaceType.ZONES);
    } else {
      ctx.showNotification(response.message || 'Failed to define zone', 'error');
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to define zone: ${toErrorMessage(err)}`);
    ctx.showNotification(`Failed to define zone: ${toErrorMessage(err)}`, 'error');
  }
}
