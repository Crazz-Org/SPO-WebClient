/**
 * Research status handler — which invention a Research Center is working on,
 * and how far along it is.
 *
 * Neither datum is in the object cache. `TResearchCenter.GetStatusText`
 * (`Kernel/ResearchCenter.pas:713`) writes both in prose, and only while
 * `fCurrResearch <> nil`:
 *
 *  - the `sttMain` section gets `mtidResearchMain` = `'%d%% research completed'`
 *    (`Kernel/ResearchCenter.pas:722`, string at `Kernel/SimHints.pas:332`);
 *  - the `sttSecondary` section gets `mtidResearchSec` =
 *    `'Researching %s. Cost: %s.'` (`:733`, string at `Kernel/SimHints.pas:333`).
 *
 * The three sections travel together: `TWorld.RDOAllObjectStatusText`
 * (`Kernel/World.pas:4208`) loops every `TStatusKind` and joins with
 * `StatusTextSeparator = ':-:'` (`Kernel/World.pas:4222`, constant at
 * `Protocol/Protocol.pas:18`). The façade publishes the join as
 * `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, body `:816-831`) — a FUNCTION of
 * two integers, so the frame carries `"^"` and a QueryId.
 *
 * Bind target and argument order follow the reference client, which emits this
 * one member rather than three `ObjectStatusText` calls:
 * `result := TStatusText(fISProxy.AllObjectStatusText( Id, fTycoonId ));`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`), on the proxy bound to the
 * ClientView (`:1064`) — this codebase's `worldContextId` — with `fTycoonId`
 * being InitClient's 4th argument (`:516`), here `fTycoonProxyId`.
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
 * Non-greedy, so an invention name containing a period still stops at the
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
 * Read the percentage and the active invention's name out of a facility status
 * text. Returns `null` when neither sentence is there — the normal answer for a
 * Research Center with nothing running (`fCurrResearch = nil`).
 *
 * Both regexes run over the whole joined answer: neither can match anything but
 * its own sentence, so splitting on `':-:'` first would buy nothing.
 * `mtidCompSupported` ("Company supported at %d%%.", `Kernel/SimHints.pas:334`)
 * rides the same section — `PERCENT_RE` requires the literal
 * `% research completed`, so it cannot be confused with it.
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
 * A miss is a normal outcome, not an error: the running research may belong to
 * another category tab, and `dev{cat}RsName{i}` can be empty — the gateway then
 * puts the id in `name` (`session-utils.ts:130`) and no name can match. The
 * name still reaches the client on `activeResearch`, so nothing is lost.
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
 * The building's current research at world tile (x, y), or `null` when there is
 * none — or when the read failed. Never rejects: this is decoration on an
 * inventory read, and `getResearchInventory` must not start failing because a
 * status read did.
 */
export async function getActiveResearchStatus(
  ctx: SessionContext,
  x: number, y: number,
): Promise<ActiveResearchStatus | null> {
  if (!ctx.worldContextId || ctx.fTycoonProxyId === null) return null;

  try {
    const { buildingId } = await ctx.focusBuilding(x, y);

    // FAST (60 s, the legacy proxy DefTimeOut) rather than NORMAL: garnish on
    // an inventory read must never hold the panel open for three minutes.
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
