/**
 * Research status handler — which invention a Research Center is working on,
 * and how far along it is.
 *
 * Neither fact is in the object cache: the server writes both in prose, in the
 * facility's status text. `TResearchCenter.GetStatusText`
 * (`Kernel/ResearchCenter.pas:713`) appends, only while `fCurrResearch <> nil`,
 * `mtidResearchMain` = `'%d%% research completed'` to the sttMain section
 * (`Kernel/ResearchCenter.pas:722`, string at `Kernel/SimHints.pas:332`) and
 * `mtidResearchSec` = `'Researching %s. Cost: %s.'` to the sttSecondary section
 * (`:733`, string at `Kernel/SimHints.pas:333`). When no research is running,
 * neither sentence is emitted at all.
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) walks `low(kind)..high(kind)` and joins with
 * `StatusTextSeparator = ':-:'` (`Kernel/World.pas:4222`), published by the
 * façade as `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-831`) — a FUNCTION of
 * two integers, so the frame carries `"^"` and a QueryId.
 *
 * Voyager emits exactly this member, one call for all three sections:
 * `result := TStatusText(fISProxy.AllObjectStatusText( Id, fTycoonId ));`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`). `fISProxy` is bound to the
 * ClientView (`ServerCnxHandler.pas:1064`) — this codebase's `worldContextId` —
 * and `fTycoonId` is InitClient's 4th argument (`ServerCnxHandler.pas:516`),
 * which this codebase holds as `fTycoonProxyId`.
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

/** `'Researching %s. Cost: %s.'` — `Kernel/SimHints.pas:333`. */
const RESEARCHING_RE = /Researching\s+(.+?)\.\s*Cost:/i;

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`Interface Server/InterfaceServer.pas:826`), which arrives as `res="#1"`.
 * Any `#`-prefixed result is a code, never a status text.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/**
 * Read the active research out of a facility's joined status text, or `null`
 * when the server named neither sentence — which is what a Research Center with
 * no `fCurrResearch` answers.
 *
 * Both patterns are run over the whole answer rather than over a `':-:'` split:
 * neither can match anything but its own sentence. In particular
 * `mtidCompSupported` ("Company supported at %d%%.", `Kernel/SimHints.pas:334`)
 * rides the same section and is not confusable with `PERCENT_RE`, which demands
 * the literal `% research completed`.
 */
export function parseResearchStatusText(statusText: string): ActiveResearchStatus | null {
  const percentMatch = PERCENT_RE.exec(statusText);
  const nameMatch = RESEARCHING_RE.exec(statusText);
  if (!percentMatch && !nameMatch) return null;

  const status: ActiveResearchStatus = {};
  if (percentMatch) status.percentComplete = parseInt(percentMatch[1], 10);
  // Non-greedy: an invention name carrying a period still stops at the `. Cost:`
  // that closes the sentence.
  if (nameMatch) status.inventionName = nameMatch[1].trim();
  return status;
}

/**
 * Mark the ONE developing item the status text names, if it is in this list.
 *
 * No match is a normal outcome, not an error: the active research may belong to
 * another category tab, and `dev{cat}RsName{i}` can be empty in the cache — the
 * gateway then puts the id in `name` (`session-utils.ts:130`). The name still
 * reaches the client on `activeResearch`, so nothing is lost when the mark
 * cannot be placed.
 */
export function markActiveDeveloping(
  developing: ResearchInventionItem[],
  status: ActiveResearchStatus | null
): void {
  const name = status?.inventionName?.trim().toLowerCase();
  if (!name) return;

  const match = developing.find(item => item.name.trim().toLowerCase() === name);
  if (match) match.active = true;
}

/**
 * The Research Center's current research at the given building coordinates, or
 * `null` when there is none — or when the read did not work.
 *
 * NEVER REJECTS. This is decoration on an inventory read: a failed status read
 * must leave `getResearchInventory` answering exactly what it answers today.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext, x: number, y: number
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s, the legacy proxy DefTimeOut) rather than NORMAL: garnish on an
    // inventory read must never hold the panel for three minutes.
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
