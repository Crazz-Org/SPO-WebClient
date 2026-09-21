/**
 * Research status handler — which invention a Research Center is working on,
 * and how far along it is.
 *
 * The object cache lists what is available, developing and completed, but never
 * says which of the developing inventions is the current one. The server does
 * say it — in prose, in the facility's status text.
 * `TResearchCenter.GetStatusText` (`Kernel/ResearchCenter.pas:713`) appends,
 * only when `fCurrResearch <> nil`:
 *
 *  - to the sttMain section (`:722`) `mtidResearchMain` = `'%d%% research
 *    completed'` (`Kernel/SimHints.pas:332`) — the percentage;
 *  - to the sttSecondary section (`:733`) `mtidResearchSec` = `'Researching %s.
 *    Cost: %s.'` (`Kernel/SimHints.pas:333`) — the invention's name.
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) joins them with `StatusTextSeparator = ':-:'`
 * (`:4222`, constant at `Protocol/Protocol.pas:18`). The façade publishes the
 * join as `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-831`) — a published
 * FUNCTION of two integers, so the frame carries `"^"` and a QueryId.
 *
 * Bind target and argument order follow the reference client, which emits this
 * one member rather than three `ObjectStatusText` calls:
 * `result := TStatusText(fISProxy.AllObjectStatusText( Id, fTycoonId ));`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`), with `fISProxy` bound to
 * the ClientView (`:1064`) — this codebase's `worldContextId` — and `fTycoonId`
 * InitClient's 4th argument (`:516`), stored here as `fTycoonProxyId`.
 */

import type { SessionContext } from './session-context';
import type { ActiveResearchStatus, ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

/** `mtidResearchMain` = `'%d%% research completed'` (`Kernel/SimHints.pas:332`). */
const PERCENT_RE = /(\d+)\s*%\s*research completed/i;

/**
 * `mtidResearchSec` = `'Researching %s. Cost: %s.'` (`Kernel/SimHints.pas:333`).
 * The name capture is non-greedy so an invention name containing a period still
 * stops at the `. Cost:` that closes the sentence.
 */
const RESEARCHING_RE = /Researching\s+(.+?)\.\s*Cost:/i;

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`Interface Server/InterfaceServer.pas:825`), which arrives as `res="#1"`.
 * Any `#`-prefixed result is a code, never a status text.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/**
 * Pull the current research out of a joined status text, or `null` when the
 * facility is researching nothing — neither sentence is emitted then.
 *
 * Both patterns are run over the whole answer rather than over a `':-:'` split:
 * neither can match anything but its own sentence. `mtidCompSupported`
 * ("Company supported at %d%%.", `Kernel/SimHints.pas:334`) rides the same
 * section, and the literal `% research completed` keeps it apart.
 */
export function parseResearchStatusText(statusText: string): ActiveResearchStatus | null {
  const percentMatch = statusText.match(PERCENT_RE);
  const nameMatch = statusText.match(RESEARCHING_RE);
  if (!percentMatch && !nameMatch) return null;

  const status: ActiveResearchStatus = {};
  if (percentMatch) status.percentComplete = parseInt(percentMatch[1], 10);
  if (nameMatch) status.inventionName = nameMatch[1].trim();
  return status;
}

/**
 * Mark the one developing item the status text names, if it is in this
 * category's list. Exactly one item is ever marked.
 *
 * **Call this only on a list whose display names are already filled in.** The
 * status text names the invention by its display name, while the object cache
 * writes `dev{cat}RsName{i}` only for volatile inventions
 * (`Inventions/Inventions.pas:756-759`, `if fVolatile then Cache.WriteString(kind
 * + 'RsName' …)`). For the whole standard research tree the cache slot is empty
 * and `parseResearchItems` puts the *id* in `name` (`session-utils.ts:130`); the
 * display name arrives later, from the parsed `research.0.dat` catalogue, in
 * `ws-handlers/misc-handlers.ts`. That is why the only caller sits there, after
 * the enrichment, and not in `research-handler.ts` beside the cache reads.
 *
 * Finding no match is still a normal outcome, not a failure: the active research
 * may belong to another category tab, or the gateway may have no `.dat` index
 * loaded. The name always reaches the client on `activeResearch`, so nothing is
 * lost when the mark cannot be placed.
 */
export function markActiveDeveloping(
  developing: ResearchInventionItem[],
  status: ActiveResearchStatus | null
): void {
  const activeName = status?.inventionName?.trim().toLowerCase();
  if (!activeName) return;

  const match = developing.find(item => item.name.trim().toLowerCase() === activeName);
  if (match) match.active = true;
}

/**
 * The building's current research, or `null` when there is none to report.
 *
 * Never rejects: this is decoration on an inventory read, and
 * `getResearchInventory` must not start failing because a status read did.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext, x: number, y: number
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s, the legacy proxy DefTimeOut) rather than NORMAL: garnish on an
    // inventory read must never hold the panel open for three minutes.
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
