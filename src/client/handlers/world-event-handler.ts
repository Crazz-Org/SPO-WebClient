/**
 * World Event Handler — asks the gateway for the newest world event (`PickEvent`).
 *
 * The gateway already answers `null` for every "no event" case (empty queue,
 * backup running, DA down — `InterfaceServer.pas:1161-1170`), so there is
 * nothing here to report to the player. A failed read is silent by design,
 * same reasoning as `context-status-handler.ts`.
 */

import {
  WsMessageType,
  type WsReqWorldEvent,
  type WsRespWorldEvent,
  type WorldEventLine,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

export async function requestWorldEvent(ctx: ClientHandlerContext): Promise<WorldEventLine | null> {
  try {
    const req: WsReqWorldEvent = { type: WsMessageType.REQ_WORLD_EVENT };
    const response = await ctx.sendRequest(req) as WsRespWorldEvent;
    return response.event ?? null;
  } catch (err: unknown) {
    ClientBridge.log('Map', `World event unavailable: ${toErrorMessage(err)}`);
    return null;
  }
}
