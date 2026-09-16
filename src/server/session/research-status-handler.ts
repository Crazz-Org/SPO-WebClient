/**
 * Research status handler — which invention a Research Center is developing
 * right now, and how far along it is.
 *
 * Neither datum is in the object cache. `TResearchCenter.GetStatusText`
 * (`Kernel/ResearchCenter.pas:713`) writes both as prose, and only while
 * `fCurrResearch <> nil`: `'%d%% research completed'` into the sttMain section
 * (`Kernel/ResearchCenter.pas:722`, string at `Kernel/SimHints.pas:332`) and
 * `'Researching %s. Cost: %s.'` into the sttSecondary section (`:733`, string at
 * `Kernel/SimHints.pas:333`). With no research running neither sentence exists.
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) joins `low(kind)..high(kind)` with
 * `StatusTextSeparator = ':-:'` (`Kernel/World.pas:4222`). The façade publishes
 * the join as `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-838`) — a published
 * FUNCTION of two integers, so the frame carries `"^"` and a QueryId.
 *
 * Rule 2 points the same way: Voyager emits this single member and splits
 * locally — `result := TStatusText(fISProxy.AllObjectStatusText( Id, fTycoonId ));`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`). `fISProxy` is bound to the
 * ClientView (`ServerCnxHandler.pas:1064`), this codebase's `worldContextId`, and
 * `fTycoonId` is InitClient's 4th argument (`ServerCnxHandler.pas:516`), stored
 * here as `fTycoonProxyId`.
 */

import type { SessionContext } from './session-context';
import type { ActiveResearchStatus, ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

/** `'%d%% research completed'` — `Kernel/SimHints.pas:332`. */
const PERCENT_RE = /(\d+)\s*%\s*research completed/i;

/**
 * `'Researching %s. Cost: %s.'` — `Kernel/SimHints.pas:333`. The capture is
 * non-greedy so an invention name containing a period still stops at the
 * `. Cost:` that closes the sentence.
 */
const RESEARCHING_RE = /Researching\s+(.+?)\.\s*Cost:/i;

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`Interface Server/InterfaceServer.pas:825`), which arrives as `res="#1"`.
 * Any `#`-prefixed result is a code, never a status text.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/**
 * Read the two research sentences out of a facility's joined status text.
 * Returns `null` when neither is present — the normal answer for a Research
 * Center that is idle, and for every other kind of building.
 *
 * The whole joined text is searched rather than the `':-:'` sections
 * separately: neither pattern can match anything but its own sentence.
 * `mtidCompSupported` ("Company supported at %d%%.",
 * `Kernel/SimHints.pas:334`) rides the same section and is not matched, because
 * `PERCENT_RE` requires the literal `% research completed`.
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
 * Mark the one developing item the server named as the active research.
 *
 * A miss is a normal outcome, not an error: the active research may belong to
 * another category tab, and `dev{cat}RsName{i}` can be empty in the cache, in
 * which case `parseResearchItems` puts the id in `name` instead
 * (`session-utils.ts:130`). The name still reaches the client on
 * `activeResearch`, so nothing is lost when the mark cannot be placed.
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
      return;
    }
  }
}

/**
 * The active research of the building at world tile (x, y), or `null` when
 * there is none. Never rejects: this is decoration on an inventory read, and
 * `getResearchInventory` must not start failing because a status read did.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext,
  x: number,
  y: number,
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s) rather than NORMAL (three minutes), for the same reason
    // context-status-handler gives: garnish on another read must never hold
    // the panel for three minutes.
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
    ctx.log.debug(`[ResearchStatus] Read failed, no active research shown: ${toErrorMessage(err)}`);
    return null;
  }
}
