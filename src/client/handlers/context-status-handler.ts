/**
 * Context Status Handler — asks the gateway for the town sentence under the camera.
 *
 * The gateway already answers `''` for every "no sentence" case (no town under
 * the tile, `Kernel/World.pas:4243`; the façade's error code,
 * `InterfaceServer.pas:840`), so there is nothing here to report to the player.
 * A failed read is silent by design: this is an idle decoration, and a
 * notification for it would be noise every 20 seconds.
 */

import {
  WsMessageType,
  type WsReqContextStatus,
  type WsRespContextStatus,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

export async function requestContextStatusText(ctx: ClientHandlerContext, x: number, y: number): Promise<string> {
  try {
    const req: WsReqContextStatus = {
      type: WsMessageType.REQ_CONTEXT_STATUS,
      x, y,
    };

    const response = await ctx.sendRequest(req) as WsRespContextStatus;
    return response.text ?? '';
  } catch (err: unknown) {
    ClientBridge.log('Map', `Context status unavailable: ${toErrorMessage(err)}`);
    return '';
  }
}
