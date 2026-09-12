/**
 * Context Status handler — the town under the camera.
 *
 * `ContextStatusText( x, y : integer ) : OleVariant` is declared on the Interface
 * Server's client view (`Interface Server/InterfaceServer.pas:149`, body `:834-848`)
 * — the same object the gateway addresses as `worldContextId`. The IS forwards it
 * to `TWorld.RDOContextStatusText(ToTycoon, x, y)` (`Kernel/World.pas:385`, body
 * `:4233-4250`), injecting the tycoon itself (`InterfaceServer.pas:838`), which is
 * why the client only ever sends the two coordinates.
 *
 * Two empty answers, both meaning "nothing to say", both rendered as a hidden strip:
 *  - no town under (x,y) — `World.pas:4243` — or any exception in the world (`:4248`);
 *  - the server is busy or the DA is down — `InterfaceServer.pas:839`.
 *
 * And one non-sentence: when the world proxy itself faulted the IS answers the
 * *integer* `ERROR_Unknown` (`InterfaceServer.pas:842`), not a string. That arrives
 * as `res="#…"` and is discarded rather than shown as a number.
 */

import type { SessionContext } from './session-context';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse as parsePropertyResponseHelper } from '../rdo-helpers';

// =========================================================================
// PUBLIC — getContextStatusText
// =========================================================================

/**
 * Ask the world for the sentence describing the town at (x, y).
 * Returns '' when there is no town, when the server declined, or when the
 * answer is the integer error code rather than a sentence.
 */
export async function getContextStatusText(ctx: SessionContext, x: number, y: number): Promise<string> {
  if (!ctx.worldContextId) {
    throw new Error('Not logged into world - cannot read context status');
  }

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'ContextStatusText', ctx.worldContextId,
    RdoValue.int(Math.round(x)), RdoValue.int(Math.round(y)),
  ).packet, undefined, TimeoutCategory.FAST);

  const payload = packet.payload ?? '';

  // InterfaceServer.pas:842 answers the integer ERROR_Unknown when the world
  // proxy failed — not a sentence.
  if (/\bres="#/.test(payload)) return '';

  return parsePropertyResponseHelper(payload, 'res').trim();
}
