/**
 * Road Handler — extracted from StarpeaceClient.
 *
 * Handles road building mode, road demolition mode, and road segment operations.
 */

import {
  WsMessageType,
  WsReqBuildRoad,
  WsRespBuildRoad,
  WsReqDemolishRoad,
  WsRespDemolishRoad,
  WsReqDemolishRoadArea,
  WsRespDemolishRoadArea,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { playerErrorMessage } from '../player-error';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';
import { setupEscapeHandler } from './handler-utils';
import { useUiStore } from '../store/ui-store';
import type { DialogRow } from '../components/common/Dialog';
import { useGameStore } from '../store/game-store';
import { estimateRoadCost, type RoadTileFacts } from '@/shared/road-cost';
import { formatMoney } from '../format-utils';

export function toggleRoadBuildingMode(ctx: ClientHandlerContext): void {
  ctx.isRoadBuildingMode = !ctx.isRoadBuildingMode;

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setRoadDrawingMode(ctx.isRoadBuildingMode);

    if (ctx.isRoadBuildingMode) {
      if (ctx.currentBuildingToPlace) {
        ctx.cancelBuildingPlacement();
      }

      renderer.setRoadSegmentCompleteCallback((x1, y1, x2, y2) => {
        void buildRoadSegment(ctx, x1, y1, x2, y2);
      });

      renderer.setCancelRoadDrawingCallback(() => {
        cancelRoadBuildingMode(ctx);
      });

      setupRoadBuildingKeyboardHandler(ctx);

      ClientBridge.log('Road', 'Road building mode enabled. Click and drag to draw roads. Right-click or press ESC to cancel.');
    } else {
      ClientBridge.log('Road', 'Road building mode disabled');
    }
  }

  // Store is updated automatically via ctx.isRoadBuildingMode setter
}

export function cancelRoadBuildingMode(ctx: ClientHandlerContext): void {
  ctx.isRoadBuildingMode = false;

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setRoadDrawingMode(false);
  }

  // Store is updated automatically via ctx.isRoadBuildingMode setter
  ClientBridge.log('Road', 'Road building mode cancelled');
}

/**
 * A drag released in road mode. The spend is CONFIRMED first (T8, B5 roads), like a building
 * placement: tiles, cost — the very amount the gateway will charge — and the cash after; the
 * player can opt out for the session ("Don't ask again"). Only then does the request leave.
 */
export function buildRoadSegment(ctx: ClientHandlerContext, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  if (ctx.isBuildingRoad) return Promise.resolve();

  const renderer = ctx.getRenderer();
  if (renderer) {
    const validation = renderer.validateRoadPath(x1, y1, x2, y2);
    if (!validation.valid) {
      ClientBridge.log('Road', `Cannot build road: ${validation.error}`);
      ctx.showNotification(validation.error || 'Invalid road placement', 'error');
      return Promise.resolve();
    }
  }

  // Price the drag from what the renderer knows — existing road is free, water without
  // concrete is a bridge (issue #99). The same facts ride with the request, so the amount
  // confirmed here is the amount the gateway puts on the wire.
  const tileFacts = renderer ? renderer.getRoadPathFacts(x1, y1, x2, y2) : undefined;
  const { tileCount, cost } = estimateRoadCost(x1, y1, x2, y2, tileFacts);
  const bridgeTiles = tileFacts ? tileFacts.filter(t => !t.hasRoad && t.isBridge).length : 0;
  const freeTiles = tileFacts ? tileFacts.filter(t => t.hasRoad).length : 0;
  const cashRaw = useGameStore.getState().tycoonStats?.cash;
  const cashNum = cashRaw ? parseFloat(String(cashRaw).replace(/,/g, '')) : NaN;
  const rows: DialogRow[] = [
    { label: 'Tiles', value: String(tileCount) },
  ];
  if (bridgeTiles > 0) rows.push({ label: 'Bridge tiles', value: String(bridgeTiles) });
  if (freeTiles > 0) rows.push({ label: 'Already paved', value: `${freeTiles} (free)` });
  rows.push({ label: 'Cost', value: formatMoney(cost), tone: 'gold' });
  if (!Number.isNaN(cashNum)) {
    const after = cashNum - cost;
    rows.push({ label: 'Cash after', value: formatMoney(after), tone: after < 0 ? 'negative' : 'positive' });
  }
  return new Promise<void>((resolve) => {
    useUiStore.getState().requestConfirm(
      'Build this road?',
      `From (${x1}, ${y1}) to (${x2}, ${y2}).`,
      () => { void sendBuildRoad(ctx, x1, y1, x2, y2, tileFacts).then(resolve); },
      { kind: 'spend', confirmLabel: 'Build', typeToConfirm: null, rows, dontAskAgainKey: 'road' },
    );
  });
}

async function sendBuildRoad(ctx: ClientHandlerContext, x1: number, y1: number, x2: number, y2: number, tileFacts?: RoadTileFacts[]): Promise<void> {
  ctx.isBuildingRoad = true;
  ClientBridge.log('Road', `Building road from (${x1}, ${y1}) to (${x2}, ${y2})...`);

  try {
    const req: WsReqBuildRoad = {
      type: WsMessageType.REQ_BUILD_ROAD,
      x1, y1, x2, y2, tileFacts
    };

    const response = await ctx.sendRequest(req) as WsRespBuildRoad;

    if (response.success && !response.partial) {
      ClientBridge.log('Road', `Road built: ${response.tileCount} tiles, cost $${response.cost}`);
      ctx.showNotification(`Road built: ${response.tileCount} tiles`, 'success');
      ctx.loadAlignedMapAreaForRect(x1, y1, x2, y2);
    } else if (response.success && response.partial) {
      ClientBridge.log('Road', `Road partially built: ${response.tileCount} tiles, cost $${response.cost}`);
      ctx.showNotification(response.message || `Road partially built (${response.tileCount} tiles)`, 'warning');
      ctx.loadAlignedMapAreaForRect(x1, y1, x2, y2);
    } else {
      ClientBridge.log('Error', response.message || 'Failed to build road');
      ctx.showNotification(response.message || 'Failed to build road', 'error');
      ctx.loadAlignedMapAreaForRect(x1, y1, x2, y2);
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to build road: ${toErrorMessage(err)}`);
  } finally {
    ctx.isBuildingRoad = false;
  }
}

function setupRoadBuildingKeyboardHandler(ctx: ClientHandlerContext): void {
  setupEscapeHandler(
    () => ctx.isRoadBuildingMode,
    () => cancelRoadBuildingMode(ctx),
  );
}

// ── Road Demolition ─────────────────────────────────────────────────────────

export function toggleRoadDemolishMode(ctx: ClientHandlerContext): void {
  ctx.isRoadDemolishMode = !ctx.isRoadDemolishMode;

  if (ctx.isRoadDemolishMode && ctx.isRoadBuildingMode) {
    cancelRoadBuildingMode(ctx);
  }

  const renderer = ctx.getRenderer();
  if (renderer) {
    if (ctx.isRoadDemolishMode) {
      if (ctx.currentBuildingToPlace) {
        ctx.cancelBuildingPlacement();
      }

      renderer.setRoadDemolishClickCallback((x: number, y: number) => {
        void demolishRoadAt(ctx, x, y);
      });
      renderer.setRoadDemolishAreaCompleteCallback((x1: number, y1: number, x2: number, y2: number) => {
        void demolishRoadArea(ctx, x1, y1, x2, y2);
      });
      renderer.setCancelRoadDemolishCallback(() => {
        cancelRoadDemolishMode(ctx);
      });

      ClientBridge.log('Road', 'Road demolish mode enabled. Click or drag to select road tiles. Right-click or press ESC to cancel.');
    } else {
      renderer.setRoadDemolishClickCallback(null);
      renderer.setRoadDemolishAreaCompleteCallback(null);
      ClientBridge.log('Road', 'Road demolish mode disabled');
    }
  }

  // Store is updated automatically via ctx.isRoadDemolishMode setter
}

export function cancelRoadDemolishMode(ctx: ClientHandlerContext): void {
  ctx.isRoadDemolishMode = false;

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setRoadDemolishClickCallback(null);
    renderer.setRoadDemolishAreaCompleteCallback(null);
    renderer.setCancelRoadDemolishCallback(null);
  }

  // Store is updated automatically via ctx.isRoadDemolishMode setter
}

/** Demolition is destructive: a Dialog first (T8, B5), with a session opt-out shared by click and area. */
function confirmRoadDemolition(message: string, onConfirm: () => void): void {
  useUiStore.getState().requestConfirm(
    'Demolish road?',
    message,
    onConfirm,
    { kind: 'destructive', confirmLabel: 'Demolish', typeToConfirm: null, dontAskAgainKey: 'roadDemolish' },
  );
}

export function demolishRoadAt(ctx: ClientHandlerContext, x: number, y: number): Promise<void> {
  return new Promise<void>((resolve) => {
    confirmRoadDemolition(`The road tile at (${x}, ${y}) will be removed.`, () => { void sendDemolishRoadAt(ctx, x, y).then(resolve); });
  });
}

async function sendDemolishRoadAt(ctx: ClientHandlerContext, x: number, y: number): Promise<void> {
  ClientBridge.log('Road', `Demolishing road at (${x}, ${y})...`);

  try {
    const req: WsReqDemolishRoad = {
      type: WsMessageType.REQ_DEMOLISH_ROAD,
      x, y
    };

    const response = await ctx.sendRequest(req) as WsRespDemolishRoad;

    if (response.success) {
      ClientBridge.log('Road', `Road demolished at (${x}, ${y})`);
      ctx.showNotification('Road demolished', 'success');
      ctx.loadAlignedMapArea(x, y);
    } else {
      ClientBridge.log('Error', response.message || 'Failed to demolish road');
      ctx.showNotification(response.message || 'Failed to demolish road', 'error');
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to demolish road: ${toErrorMessage(err)}`);
    ctx.showNotification(playerErrorMessage('demolish the road', err), 'error');
  }
}

export function demolishRoadArea(ctx: ClientHandlerContext, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const nx1 = Math.min(x1, x2);
  const ny1 = Math.min(y1, y2);
  const nx2 = Math.max(x1, x2);
  const ny2 = Math.max(y1, y2);
  return new Promise<void>((resolve) => {
    confirmRoadDemolition(
      `Every road tile from (${nx1}, ${ny1}) to (${nx2}, ${ny2}) will be removed.`,
      () => { void sendDemolishRoadArea(ctx, nx1, ny1, nx2, ny2).then(resolve); },
    );
  });
}

async function sendDemolishRoadArea(ctx: ClientHandlerContext, nx1: number, ny1: number, nx2: number, ny2: number): Promise<void> {
  ClientBridge.log('Road', `Demolishing road area (${nx1},${ny1})→(${nx2},${ny2})...`);

  try {
    const req: WsReqDemolishRoadArea = {
      type: WsMessageType.REQ_DEMOLISH_ROAD_AREA,
      x1: nx1, y1: ny1, x2: nx2, y2: ny2
    };

    const response = await ctx.sendRequest(req) as WsRespDemolishRoadArea;

    if (response.success) {
      ClientBridge.log('Road', `Road area demolished`);
      ctx.showNotification('Roads demolished', 'success');
      ctx.loadAlignedMapAreaForRect(nx1, ny1, nx2, ny2);
    } else {
      ClientBridge.log('Error', response.message || 'Failed to demolish roads');
      ctx.showNotification(response.message || 'Failed to demolish roads', 'error');
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to demolish road area: ${toErrorMessage(err)}`);
    ctx.showNotification(playerErrorMessage('demolish these roads', err), 'error');
  }
}
