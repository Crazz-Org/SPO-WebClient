/**
 * Context Status handler — asks the server what town the camera is over.
 *
 * CADENCE: on a camera move. `refreshContextStatus` is called from
 * `sendCameraPositionNow`, so it rides the two moments the camera is already
 * reported: 2 s after the last move (the debounced report) and on the 30 s
 * viewport heartbeat.
 *
 * The reference client polled instead: when no object supplied a status line,
 * Voyager showed the context text and armed `fIdleTextTimer`
 * (`Voyager/URLHandlers/MapIsoHandler.pas:672-678`), a 20 000 ms timer (`:188`)
 * whose tick re-asked. Following the camera says the same thing sooner after a
 * move and costs nothing while the player sits still.
 *
 * An empty answer is normal, not an error: the world answers '' when there is no
 * town under the camera (`Kernel/World.pas:4243`). The strip hides itself on ''.
 */

import { WsMessageType, type WsReqContextStatus, type WsRespContextStatus } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import { useGameStore } from '../store/game-store';
import type { ClientHandlerContext } from './client-context';

export async function refreshContextStatus(ctx: ClientHandlerContext): Promise<void> {
  const renderer = ctx.getRenderer();
  if (!renderer) return;

  const pos = renderer.getCameraPosition();
  const req: WsReqContextStatus = {
    type: WsMessageType.REQ_CONTEXT_STATUS,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
  };

  // A camera move that lands while this one is in flight wins — an answer for a
  // place the player has already left must not overwrite the current one.
  const gen = ctx.nextGeneration('contextStatus');

  try {
    const resp = await ctx.sendRequest(req) as WsRespContextStatus;
    if (!ctx.isCurrentGeneration('contextStatus', gen)) return;
    useGameStore.getState().setContextStatusText(resp.text ?? '');
  } catch (err: unknown) {
    // Background poll — logged, never surfaced as a notification.
    ClientBridge.log('Map', `Context status unavailable: ${toErrorMessage(err)}`);
  }
}
