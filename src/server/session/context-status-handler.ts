/**
 * Context status handler — the one sentence the server writes about the town
 * under the camera.
 *
 * `ContextStatusText( x, y : integer ) : OleVariant` is a published FUNCTION on
 * `TClientView` (`Interface Server/InterfaceServer.pas:149`, body `:834-847`),
 * so the frame carries `"^"` and a QueryId. The façade forwards to
 * `TWorld.RDOContextStatusText( ToTycoon, x, y )` (`Kernel/World.pas:4233`,
 * declared `:385`) and injects the tycoon proxy id itself — the client sends
 * two integers and nothing else.
 *
 * An EMPTY ANSWER IS NORMAL, NOT AN ERROR. `World.pas:4243` returns `''` when
 * `NearestTown( x, y )` finds no town, `:4248` returns `''` on any exception,
 * and `InterfaceServer.pas:838` returns `''` while the DA is down or the server
 * is busy. `InterfaceServer.pas:840` is the one answer that is not a string: on
 * an exception the façade assigns the INTEGER `ERROR_Unknown`, which reaches the
 * wire as `res="#1"` — rendering that would put a bare `1` in the HUD, so a
 * `#`-prefixed answer is read here as "no sentence".
 *
 * Bind target: Voyager calls it on `fISProxy` after `BindTo( fClientViewId )`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1064`, call at `:1444`) — the
 * per-session `TClientView` id, which in this codebase is `worldContextId`.
 */

import type { SessionContext } from './session-context';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`InterfaceServer.pas:840`), which arrives as `res="#1"`. Any `#`-prefixed
 * result is a code, never a sentence.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/**
 * The server's sentence for the town under world tile (x, y), or `''` when
 * there is none. Never rejects: this is an idle decoration refreshed every
 * 20 s, and a failed read must be silent, exactly as the reference client's
 * own `''` fallback when its proxy is unbound (`ServerCnxHandler.pas:1445`).
 */
export async function getContextStatusText(ctx: SessionContext, x: number, y: number): Promise<string> {
  if (!ctx.worldContextId) return '';

  try {
    // FAST (60 s, the legacy proxy DefTimeOut) rather than NORMAL: a throw-away
    // decoration asked again every 20 s must not hold a request slot for three minutes.
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'ContextStatusText', ctx.worldContextId,
      RdoValue.int(x), RdoValue.int(y),
    ).packet, undefined, TimeoutCategory.FAST);

    const payload = packet.payload || '';
    if (ERROR_CODE_ANSWER.test(payload)) {
      ctx.log.debug('[ContextStatus] Server answered an error code, not a sentence');
      return '';
    }

    return parsePropertyResponse(payload, 'res').trim();
  } catch (err: unknown) {
    ctx.log.debug(`[ContextStatus] Read failed, showing nothing: ${toErrorMessage(err)}`);
    return '';
  }
}
