/**
 * research-status-handler — which invention a Research Center is working on,
 * and how far along it is.
 *
 * Neither datum is in the object cache. `TResearchCenter.GetStatusText`
 * (`Kernel/ResearchCenter.pas:713`) writes them into the facility's status
 * text, and only when `fCurrResearch <> nil`:
 *
 * - into the `sttMain` section (`:722`) the string `mtidResearchMain` =
 *   `'%d%% research completed'` (`Kernel/SimHints.pas:332`) — the percentage;
 * - into the `sttSecondary` section (`:733`) the string `mtidResearchSec` =
 *   `'Researching %s. Cost: %s.'` (`Kernel/SimHints.pas:333`) — the name.
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) loops `low(kind)..high(kind)` and joins them with
 * `StatusTextSeparator = ':-:'` (`:4222`, constant at `Protocol/Protocol.pas:18`).
 * The façade publishes the join as
 * `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-831`) — a published
 * FUNCTION of arity 2, so the frame carries `"^"` and two integers.
 *
 * Voyager emits exactly this member — one call for all three sections, split
 * locally afterwards: `result := TStatusText(fISProxy.AllObjectStatusText(
 * Id, fTycoonId ));` (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`).
 * `fISProxy` is bound to the ClientView (`:1064`) — this codebase's
 * `worldContextId` — and `fTycoonId` is InitClient's 4th argument (`:516`),
 * stored here as `fTycoonProxyId`.
 */

import type { SessionContext } from './session-context';
import type { ActiveResearchStatus, ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

/**
 * `mtidResearchMain` = `'%d%% research completed'` (`Kernel/SimHints.pas:332`).
 * The literal `% research completed` is what keeps this apart from
 * `mtidCompSupported` ("Company supported at %d%%.", `SimHints.pas:334`), which
 * rides the same `sttSecondary` section.
 */
const PERCENT_RE = /(\d+)\s*%\s*research completed/i;

/**
 * `mtidResearchSec` = `'Researching %s. Cost: %s.'` (`Kernel/SimHints.pas:333`).
 * `(.+?)` is non-greedy so an invention name containing a period still stops at
 * the `. Cost:` that closes the sentence.
 */
const RESEARCHING_RE = /Researching\s+(.+?)\.\s*Cost:/i;

/**
 * On an exception the façade assigns the INTEGER `ERROR_Unknown`
 * (`Interface Server/InterfaceServer.pas:826`), which reaches the wire as
 * `res="#1"`. Any `#`-prefixed result is a code, never a status text.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/**
 * Pull the active research out of a facility status text, or `null` when the
 * server named neither — which is exactly what it does while `fCurrResearch`
 * is nil (`Kernel/ResearchCenter.pas:717,734`).
 *
 * Both patterns run over the whole joined answer: neither can match anything
 * but its own sentence, so splitting on `':-:'` first would buy nothing.
 */
export function parseResearchStatusText(statusText: string): ActiveResearchStatus | null {
  const percentMatch = PERCENT_RE.exec(statusText);
  const nameMatch = RESEARCHING_RE.exec(statusText);
  if (!percentMatch && !nameMatch) return null;

  const status: ActiveResearchStatus = {};
  if (percentMatch) status.percentComplete = parseInt(percentMatch[1], 10);
  if (nameMatch) status.inventionName = nameMatch[1].trim();
  return status;
}

/**
 * Mark the one developing item the status text names, if it is in this list.
 *
 * NO MATCH IS A NORMAL OUTCOME, not a failure: the active research may belong
 * to another category tab, and the cache's `dev{cat}RsName{i}` can be empty —
 * `parseResearchItems` then puts the id in `name` (`session-utils.ts:130`).
 * The name still reaches the client on `activeResearch`, so nothing is lost
 * when the mark cannot be placed.
 */
export function markActiveDeveloping(
  developing: ResearchInventionItem[],
  status: ActiveResearchStatus | null,
): void {
  const wanted = status?.inventionName?.trim().toLowerCase();
  if (!wanted) return;

  for (const item of developing) {
    if (item.name.trim().toLowerCase() === wanted) {
      item.active = true;
      return; // exactly one item is ever marked
    }
  }
}

/**
 * The research a building at world tile (x, y) is working on, or `null`.
 *
 * NEVER REJECTS. This is decoration on an inventory read: a failed status read
 * must leave the three lists exactly as they were, never fail the panel.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext, x: number, y: number,
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    // Deduplicated and TTL-reused inside the session, so on the normal path —
    // the panel is already open on this very building — it costs no round trip.
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s) rather than NORMAL (three minutes): garnish on an inventory
    // read must never hold the panel for the full in-play deadline.
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'AllObjectStatusText', ctx.worldContextId,
      RdoValue.int(parseInt(buildingId, 10)),
      RdoValue.int(ctx.fTycoonProxyId),
    ).packet, undefined, TimeoutCategory.FAST);

    const payload = packet.payload || '';
    if (ERROR_CODE_ANSWER.test(payload)) {
      ctx.log.debug('[ResearchStatus] Server answered an error code, not a status text');
      return null;
    }

    return parseResearchStatusText(parsePropertyResponse(payload, 'res'));
  } catch (err: unknown) {
    ctx.log.debug(`[ResearchStatus] Read failed, reporting no active research: ${toErrorMessage(err)}`);
    return null;
  }
}
