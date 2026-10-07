/**
 * Facility status batch — the status text of many facilities, read WITHOUT focusing them.
 *
 * What is read. The Interface Server façade publishes
 * `function AllObjectStatusText( Id, TycoonId : TObjId ) : OleVariant;`
 * (`Interface Server/InterfaceServer.pas:148`, TClientView, published), whose body (`:816-831`) is
 * `result := widestring(fServer.WorldProxy.RDOAllObjectStatusText( Id, TycoonId ))`, or
 * `result := ERROR_Unknown` when that call raises (`TClientView.AllObjectStatusText`).
 * `TWorld.RDOAllObjectStatusText` (`Kernel/World.pas:4208`) does
 * `Facility := TFacility(Id); Facility.Lock; ... result := result + Facility.StatusText[kind,
 * TTycoon(ToTycoon)] + StatusTextSeparator;` for every `TStatusKind` (sttMain, sttSecondary,
 * sttHint), inside `try ... except result := ''`. It takes only the facility's own lock, not
 * the WorldLock.
 *
 * Why it is the focus text. `TClientView.SwitchFocusEx` (`InterfaceServer.pas:924-935`) answers
 * `Report := IntToStr(ObjId); Report := Report + LineBreak +
 * string(fServer.WorldProxy.RDOAllObjectStatusText( ObjId, fTycoonProxyId ));` — so
 * `id + newline + AllObjectStatusText` IS what REQ_BUILDING_FOCUS parses, and
 * `parseBuildingFocusResponse` reads it unchanged (the RefreshObject push already does the
 * same prefixing, `parseRefreshObjectPush` in spo_session.ts). The `($X/h)` money per hour
 * is appended to sttMain by `TFacility.GetStatusText` (`Kernel/Kernel.pas`:
 * `result := result + tcnDescSeparator + '(' + FormatMoney( fMoneyDelta ) + '/h)'`, only when
 * the owning company is privated, has an owner, and the class has `mfcShowProfitInText`).
 *
 * Why no focus. `TClientView.SwitchFocus` unfocuses the previous object and calls
 * `FocusObject` on the new one, which makes the facility push a RefreshObject per sim update
 * to this client (research note measurements/research/2026-10-05/money-read-paths.md, (a)4).
 * `AllObjectStatusText` touches no focus state: this module never calls SwitchFocus(Ex),
 * FocusObject or UnfocusObject, and leaves `currentFocusedBuildingId` alone.
 *
 * Bind target and arguments follow `research-status-handler.ts getActiveResearchStatus`
 * (the existing caller): sent on 'world' to the ClientView (`worldContextId`), with
 * `fTycoonProxyId` as TycoonId.
 *
 * Load (#1335). ONE batch AllObjectStatusText is unsettled per session at any time — across
 * every batch that session runs at once, and counting a call whose id already gave up on it.
 * Each id has a time budget (`FACILITY_STATUS_BUDGET_MS`) covering its wait for that slot and
 * its call: when it runs out the id is answered `unknown` and the batch moves on. A call the
 * budget gave up on keeps the slot until it settles (its answer, or the 180 s RDO deadline),
 * so a stalled server never receives a second call from this session; the ids behind it run
 * out of budget waiting and are answered `unknown` with nothing sent. The RDO deadline itself
 * is left at NORMAL: a shorter one would count as a pool timeout and, after three, replace a
 * world pool connection (`RdoConnectionPool.releaseSlot`) — reconnect churn on a slow server.
 * The whole batch is capped too (`FACILITY_STATUS_BATCH_CAP_MS`, from when it starts): once
 * the cap passes, every id not yet answered is `unknown` and nothing more is sent for it.
 *
 * SAFETY — callers must pass only ids they hold as alive THIS cycle. The id is a raw object
 * pointer (`TFacility(Id)` above; focus gets it from `TClientView.ObjectAt` →
 * `integer(FacilityAt(x,y))`). Nothing on the server checks that the integer is a facility.
 * What the source shows about stale ids:
 *  - a DEMOLISHED facility is not freed by the world loop: `TWorld.DeleteFacility` inserts it
 *    in `fDeadMeat`; the sim loop wipes it (`WipeFacility`: `Facility.Deleted := true`) and
 *    then `Facilities.Extract(Fac)` and `fDeadMeat.AtExtract( 0 )` with the freeing
 *    `//fDeadMeat.AtDelete( 0 ); // >>> !!!!!!!!!!!` commented out (`Kernel/World.pas`), and
 *    `TCollection.AtExtract` (`Kernel/Collection.pas`) only removes the slot. Whether any OTHER
 *    path frees facilities (company or tycoon purge) is UNVERIFIED;
 *  - after a Model Server restart every id is a pointer into a previous process and means
 *    nothing. The `except result := ''` in RDOAllObjectStatusText turns an access violation
 *    into an empty answer, but reading a wild pointer that happens to be mapped is undefined
 *    (UNVERIFIED what it would return).
 * Gateway guard (cheap, not proof): an id is only sent when THIS gateway session's own
 * SwitchFocusEx returned it (`hasFocusedFacilityId`), so ids from an earlier login, another
 * process or a typo never reach the server. The registry forgets an id on a fchDestruction
 * RefreshObject push and on a successful RDODelFacility at the tile it was focused at, and is
 * cleared with the session's other per-login state (logout, destroy, world reconnect).
 * Whether the gateway reconnects (and so clears it) on a Model Server restart that leaves the
 * Interface Server up is UNVERIFIED. Before this handler the gateway held no per-company
 * facility id list (only the single `currentFocusedBuildingId`); the registry is the guard
 * added for it.
 */

import type { SessionContext } from './session-context';
import type { FacilityStatusEntry, FacilityStatusText, RdoPacket } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { parseBuildingFocusResponse } from '../map-parsers';
import { toErrorMessage } from '../../shared/error-utils';

/**
 * Per-id time budget: the id's wait for the session's one status-read slot plus its call.
 * A healthy AllObjectStatusText is one Interface Server → Model Server call answered well under
 * a second; 10 s is an order of magnitude above that and well under both the 180 s in-play RDO
 * deadline and the 44–47 s reads seen during the 2026-10-06 stall (#1335).
 */
export const FACILITY_STATUS_BUDGET_MS = 10_000;

/**
 * Whole-batch cap, measured from when the batch starts: past it, every id not yet answered is
 * answered `unknown` and nothing more is sent for the batch. Without it a stalled server would
 * hold a 300-id batch for up to 300 × the per-id budget (50 min).
 */
export const FACILITY_STATUS_BATCH_CAP_MS = 60_000;

/** The `error` of an id the batch cap answered. */
function capError(capMs: number): string {
  return `batch cap of ${capMs} ms reached`;
}

/**
 * The façade's exception answer is the integer `ERROR_Unknown`
 * (`TClientView.AllObjectStatusText`), which arrives as `res="#1"`. Any `#`-prefixed result
 * is a code, never a status text (same rule as research-status-handler.ts).
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/** `'-$39,127/h'` → -39127; `''` (no `($X/h)` in the text) → null. */
export function revenueToNumber(revenue: string): number | null {
  const m = /^(-)?\$([\d,]+)\/h$/.exec(revenue.trim());
  if (!m) return null;
  const n = parseInt(m[2].replace(/,/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  return m[1] ? -n : n;
}

/**
 * Parse one AllObjectStatusText answer (already unwrapped from `res="%..."`) as focus does:
 * prefix the id the way SwitchFocusEx does, then `parseBuildingFocusResponse`.
 */
export function parseFacilityStatusText(id: string, statusText: string): FacilityStatusText {
  const info = parseBuildingFocusResponse(`${id}\n${statusText}`, 0, 0);
  return {
    buildingName: info.buildingName,
    ownerName: info.ownerName,
    salesInfo: info.salesInfo,
    revenue: info.revenue,
    revenuePerHour: revenueToNumber(info.revenue),
    detailsText: info.detailsText,
    hintsText: info.hintsText,
  };
}

/**
 * The tail of each session's queue of batch status reads. Taking the slot chains behind the
 * tail; the slot is free again when its holder's call settles. Keyed by the session object,
 * so a session that is gone takes its queue with it.
 */
const statusReadTail = new WeakMap<SessionContext, Promise<void>>();

function takeStatusReadSlot(ctx: SessionContext): { ready: Promise<void>; release: () => void } {
  const ready = statusReadTail.get(ctx) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  statusReadTail.set(ctx, ready.then(() => held));
  return { ready, release };
}

type CallOutcome = { packet: RdoPacket } | { failure: string };

/** Where the call goes: the ClientView and the TycoonId argument, read once per batch. */
interface StatusTarget {
  worldContextId: string;
  tycoonProxyId: number;
}

async function readOne(
  ctx: SessionContext,
  target: StatusTarget,
  id: string,
  budgetMs: number,
  cap: { at: number; ms: number },
): Promise<FacilityStatusEntry> {
  if (!ctx.hasFocusedFacilityId(id)) {
    return {
      id, status: 'error',
      error: 'unknown id: not returned by a REQ_BUILDING_FOCUS in this gateway session (focus it once first)',
    };
  }

  let expired = false;
  let sent = false;
  const slot = takeStatusReadSlot(ctx);
  const call: Promise<CallOutcome> = slot.ready.then(async (): Promise<CallOutcome> => {
    if (expired) {
      // This id's budget ran out while it waited: send nothing, hand the slot on.
      slot.release();
      return { failure: 'not sent' };
    }
    sent = true;
    try {
      // NORMAL: the in-play deadline the reference client uses for IS calls (see
      // sendRdoRequest's category note); the budget below is the gateway's own, not the wire's.
      const packet = await ctx.sendRdoRequest('world', rdoCall(
        'AllObjectStatusText', target.worldContextId,
        RdoValue.int(parseInt(id, 10)),
        RdoValue.int(target.tycoonProxyId),
      ).packet, undefined, TimeoutCategory.NORMAL);
      return { packet };
    } catch (err: unknown) {
      return { failure: toErrorMessage(err) };
    } finally {
      slot.release();
    }
  });

  // The id's budget, cut short by the batch cap when that comes first.
  const untilCap = cap.at - Date.now();
  const byCap = untilCap < budgetMs;
  let timer: NodeJS.Timeout | undefined;
  const outOfBudget = new Promise<'budget'>(resolve => {
    timer = setTimeout(() => { expired = true; resolve('budget'); }, Math.min(budgetMs, untilCap));
  });
  const outcome = await Promise.race([call, outOfBudget]);
  clearTimeout(timer);

  if (outcome === 'budget' && byCap) return { id, status: 'unknown', error: capError(cap.ms) };
  if (outcome === 'budget') {
    return {
      id, status: 'unknown',
      error: sent
        ? `no answer within ${budgetMs} ms`
        : `not sent: this session's previous status read was still unanswered after ${budgetMs} ms`,
    };
  }
  if ('failure' in outcome) return { id, status: 'unknown', error: outcome.failure };

  const payload = outcome.packet.payload || '';
  if (ERROR_CODE_ANSWER.test(payload)) {
    return { id, status: 'unknown', error: 'server answered an error code (ERROR_Unknown)' };
  }
  const text = parsePropertyResponse(payload, 'res');
  if (text.trim() === '') {
    // `RDOAllObjectStatusText` answers '' for a nil id or after an exception, and the
    // façade answers '' when its DA link is down (`if fServer.fDAOK ... else result := ''`).
    return { id, status: 'unknown', error: 'empty status text (no facility answered)' };
  }
  return { id, status: 'ok', text: parseFacilityStatusText(id, text) };
}

/**
 * The status of each id, in request order; one id's failure or delay never touches another's.
 * Ids are read one after another, and at most one batch AllObjectStatusText is unsettled per
 * session; the batch answers within `capMs` (see the Load note above). Never focuses anything. Never rejects.
 */
export async function readFacilityStatusBatch(
  ctx: SessionContext,
  ids: ReadonlyArray<string>,
  budgetMs: number = FACILITY_STATUS_BUDGET_MS,
  capMs: number = FACILITY_STATUS_BATCH_CAP_MS,
): Promise<FacilityStatusEntry[]> {
  const worldContextId = ctx.worldContextId;
  const tycoonProxyId = ctx.fTycoonProxyId;
  if (!worldContextId || tycoonProxyId === null) {
    return ids.map(id => ({ id, status: 'error', error: 'not logged into a world' }));
  }
  const target: StatusTarget = { worldContextId, tycoonProxyId };
  const results: FacilityStatusEntry[] = [];
  const cap = { at: Date.now() + capMs, ms: capMs };
  for (const id of ids) {
    if (Date.now() >= cap.at) {
      results.push({ id, status: 'unknown', error: capError(capMs) });
      continue;
    }
    results.push(await readOne(ctx, target, id, budgetMs, cap));
  }
  return results;
}
