/**
 * Research status handler — which invention a Research Center is working on,
 * and how far along it is.
 *
 * Neither datum is in the object cache: the server writes both in prose, in the
 * facility's status text. `TResearchCenter.GetStatusText`
 * (`Kernel/ResearchCenter.pas:713`) appends, and only when `fCurrResearch <> nil`:
 *
 * - to the `sttMain` section (`:722`) `mtidResearchMain` = `'%d%% research completed'`
 *   (`Kernel/SimHints.pas:332`) — the PERCENTAGE;
 * - to the `sttSecondary` section (`:733`) `mtidResearchSec` = `'Researching %s. Cost: %s.'`
 *   (`Kernel/SimHints.pas:333`) — the ACTIVE INVENTION'S NAME.
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) joins them with `StatusTextSeparator = ':-:'`
 * (`:4222`, constant at `Protocol/Protocol.pas:18`). The façade publishes the
 * join as `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-832`) — a FUNCTION of
 * two integers, hence `"^"` and a QueryId.
 *
 * Bind target and argument order follow the reference client, which emits this
 * one member rather than three `ObjectStatusText` calls:
 * `result := TStatusText(fISProxy.AllObjectStatusText( Id, fTycoonId ));`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`). `fISProxy` is bound to the
 * ClientView (`:1064`) — this codebase's `worldContextId` — and `fTycoonId` is
 * InitClient's 4th argument (`:516`), stored here as `fTycoonProxyId`.
 *
 * NEVER REJECTS. This is decoration on an inventory read: a failed status read
 * leaves the three lists exactly as they are today.
 */

import type { SessionContext } from './session-context';
import type { ActiveResearchStatus, ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`Interface Server/InterfaceServer.pas:825`), which arrives as `res="#1"`.
 * Any `#`-prefixed result is a code, never a status text.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/** `mtidResearchMain` — `'%d%% research completed'` (`Kernel/SimHints.pas:332`). */
const PERCENT_RE = /(\d+)\s*%\s*research completed/i;

/**
 * `mtidResearchSec` — `'Researching %s. Cost: %s.'` (`Kernel/SimHints.pas:333`).
 * `(.+?)` is non-greedy, so an invention name containing a period still stops at
 * the `. Cost:` that closes the sentence.
 */
const RESEARCHING_RE = /Researching\s+(.+?)\.\s*Cost:/i;

/**
 * Pull the percentage and the active invention's name out of a facility status
 * text. Returns `null` when neither sentence is present — which is exactly what
 * the server emits while no research is running.
 *
 * The whole joined answer is scanned rather than the `':-:'` sections
 * separately: neither pattern can match anything but its own sentence.
 * `mtidCompSupported` ("Company supported at %d%%.", `Kernel/SimHints.pas:334`)
 * rides the same section and is not confusable — `PERCENT_RE` requires the
 * literal `% research completed`.
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
 * Mark the one developing item the status text names, and only it.
 *
 * No match is a normal outcome, not an error: the active research may belong to
 * another category tab, and the cache's `dev{cat}RsName{i}` can be empty — the
 * gateway then puts the id in `name` (`session-utils.ts:130`). The name still
 * reaches the client on `activeResearch`, so nothing is lost when the mark
 * cannot be placed.
 */
export function markActiveDeveloping(
  developing: ResearchInventionItem[],
  status: ActiveResearchStatus | null
): void {
  const name = status?.inventionName?.trim();
  if (!name) return;

  const target = name.toLowerCase();
  for (const item of developing) {
    if (item.name.trim().toLowerCase() === target) {
      item.active = true;
      return;
    }
  }
}

/**
 * The research the facility at world tile (x, y) is working on, or `null` when
 * there is none, the session is not in a world, or the read failed.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext, x: number, y: number
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s) rather than NORMAL (three minutes): garnish on an inventory
    // read must never hold the research panel for three minutes.
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
    ctx.log.debug(`[ResearchStatus] Read failed, no active research reported: ${toErrorMessage(err)}`);
    return null;
  }
}
