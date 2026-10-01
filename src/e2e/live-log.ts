/**
 * Model-server log evidence.
 *
 * Proof of receipt, not of the change (OB-28: a write reported confirmed and discarded).
 * RDO members log on entry, *before* their `try` and mostly before their owner check, so a
 * line in FIVEMODELSERVER's Survival log proves the frame arrived — the change itself is
 * proven by the probe's read-back (doc/E2E-POLICY.md §5).
 *
 * Reading a log is not probing the server (CLAUDE.md) — it is an open IIS listing.
 *
 * Windowing is done by **byte offset**, not by timestamp: we record the log's length
 * before the write and read only what was appended after. That needs no knowledge of the
 * Delphi timestamp format and no assumption about the server's timezone.
 */

import { toErrorMessage } from '../shared/error-utils';
import { LIVE_LOG_BASE } from './config';
import { sleep as defaultSleep } from './sleep';

/**
 * Markers proving a write entered its handler — doc/E2E-POLICY.md §5. `member -> prefix`;
 * each citation is the member's declaration, then the `Logs.Log` line in SPO-Original.
 *
 * - **The line proves receipt only.** Most handlers log *before* `CheckOpAuthenticity`
 *   (e.g. `Kernel/Kernel.pas:4336` -> `:4337`) and the gateway checks no ownership, so a
 *   refused write still prints its line. A round trip therefore always requires a read-back.
 * - **Identifying fields go in each flow's `match`.** `Fac(<x>,<y>)`-lines are keyed by the
 *   text after the coordinates; a flow's `match` requires `Fac(<x>,<y>)`. `SetTradeLevel` also
 *   occurs inside `' Error in SetTradeLevel..'` (`Kernel/Kernel.pas:6404`) — the `Fac(x,y)`
 *   match excludes it. `Voting:` is logged identically by `TPresidentialHall.RDOVote`
 *   (`Kernel/WorldPolitics.pas:1822`), so a vote's `match` must carry the voter.
 * - **Circuit lines.** The three circuit lines log the gateway's tycoon **object reference**,
 *   not the tycoon id (`TTycoon(TycoonId)`, `Kernel/World.pas:4270`), which no WS message
 *   exposes — their `match` uses the circuit id and the coordinates. `CreateCircuitSeg: OK!`
 *   (`Kernel/World.pas:4307`) is logged unconditionally and is never a proof.
 * - **Capitol variant.** `TPresidentialHall.RDOSetMinSalaryValue` logs `Setting Ministry
 *   Salary.` instead (`Kernel/WorldPolitics.pas:1772`, log `:1774`), so the town marker can
 *   never be satisfied by the Capitol variant.
 * - **No public line.** `RDOPayOff` (`Kernel/Kernel.pas:11555`) logs nothing, and
 *   `RDOSendMoney` logs to a `Money` log (`Logs.Log('Money', …)`, `Kernel/Kernel.pas:11491`)
 *   the public listing does not carry — both are proven by `readBack` alone.
 */
export const LOG_MARKERS: Record<string, string> = {
  // Kernel/Population.pas:1250 (log :1254) — "Setting Tax value: <town>, <TaxId>, <value>"
  RDOSetTaxValue: 'Setting Tax value:',
  // Kernel/Population.pas:1292 (log :1294) — "Setting Min Wage: <town>, <PopKind>, <value>"
  RDOSetMinSalaryValue: 'Setting Min Wage:',
  // Kernel/TownPolitics.pas:220 (log :224)
  RDOSetPublicity: 'Setting town politics publicity:',
  // Kernel/TownPolitics.pas:186 (log :192)
  RDOSetRatingFrom: 'Setting town politics Tycoon rating:',
  // Kernel/TownPolitics.pas:395 (log :400) — "Voting: <voter> by <choice>"; match must carry the voter
  RDOVote: 'Voting:',
  // StdBlocks/ServiceBlock.pas:1578 (log :1580) — "Service SetPrice: <index>, <value>"
  RDOSetPrice: 'Service SetPrice:',
  // Kernel/WorkCenterBlock.pas:582 (log :584) — "Setting salaries: <hi>, <mid>, <lo>"
  RDOSetSalaries: 'Setting salaries:',
  // Kernel/Kernel.pas:4332 (log :4336) — "Fac(<x>,<y>) Output price set:"
  RDOSetOutputPrice: 'Output price set:',
  // Kernel/Kernel.pas:4358 (log :4363) — "Fac(<x>,<y>) Input overprice set:"
  RDOSetInputOverPrice: 'Input overprice set:',
  // Kernel/Kernel.pas:4390 (log :4394) — "Fac(<x>,<y>) Input max price set:"
  RDOSetInputMaxPrice: 'Input max price set:',
  // Kernel/Kernel.pas:4416 (log :4420) — "Fac(<x>,<y>) Input min K set:"
  RDOSetInputMinK: 'Input min K set:',
  // Kernel/Kernel.pas:4442 (log :4446)
  RDOSetInputSortMode: 'Changing Sort Mode..',
  // Kernel/Kernel.pas:7154 (log :7156) — "Fac(<x>,<y>) Setting Input fluid perc: <perc>"
  RDOSetInputFluidPerc: 'Setting Input fluid perc:',
  // Kernel/Kernel.pas:4304 (log :4306) — "Fac(<x>,<y>) Input connected:"
  RDOConnectInput: 'Input connected:',
  // Kernel/Kernel.pas:4311 (log :4313) — "Fac(<x>,<y>) Output connected:"
  RDOConnectOutput: 'Output connected:',
  // Kernel/Kernel.pas:4320 — "Fac(<x>,<y>) Input disconnect:"
  RDODisconnectInput: 'Input disconnect:',
  // Kernel/Kernel.pas:4327 — "Fac(<x>,<y>) Output disconnect:"
  RDODisconnectOutput: 'Output disconnect:',
  // Kernel/Kernel.pas:4521 (log :4529) — "Fac(<x>,<y>) Connect to Tycoon:"
  RDOConnectToTycoon: 'Connect to Tycoon:',
  // Kernel/Kernel.pas:6371 (log :6375) — "Fac(<x>,<y>) SetCompanyInputDemand"
  RDOSetCompanyInputDemand: 'SetCompanyInputDemand',
  // Kernel/Kernel.pas:6395 (in TBlock.SetTradeLevel, called by RDOSetTradeLevel :6408 after its owner check)
  RDOSetTradeLevel: 'SetTradeLevel',
  // Kernel/Kernel.pas:3948 (TFacility.SetStopped, log :3950) — no coordinates, so the read-back attributes it
  Stopped: 'Stopping Facility.',
  // Kernel/Kernel.pas:4668 (log :4675, inside its CheckOpAuthenticity guard)
  RDOStartUpgrades: 'Facility Start Upgrade count:',
  // Kernel/Kernel.pas:4685 (log :4689)
  RDOStopUpgrade: 'Facility Stop Upgrade..',
  // Kernel/ResearchCenter.pas:382 (log :384)
  RDOQueueResearch: 'Queue Research:',
  // Kernel/ResearchCenter.pas:394 (log :396)
  RDOCancelResearch: 'Cancel Research:',
  // Kernel/PopulatedBlock.pas:771 (log :773) — "Repairing: <facility name>"
  RdoRepair: 'Repairing:',
  // Kernel/World.pas:3560 (log :3565) — "New Facility: <class> Company: <id> x: <x> y: <y>"
  RDONewFacility: 'New Facility:',
  // Kernel/World.pas:3571 (log :3575) — "Del Facility, x: <x> y: <y>"
  RDODelFacility: 'Del Facility, x:',
  // Kernel/World.pas:4252 (log :4263) — "CreateCircuitSeg: <CircuitId>, <TycoonRef>, <x1>, <y1>, <x2>, <y2>"
  RDOCreateCircuitSeg: 'CreateCircuitSeg:',
  // Kernel/World.pas:4311 (log :4320) — "BreakCircuit: <CircuitId>, <TycoonRef>, <x>, <y>"
  RDOBreakCircuitAt: 'BreakCircuit:',
  // Kernel/World.pas:4356 (log :4366) — "WipingCircuit: <CircuitId>, <TycoonRef>, <x1>, <y1>, <x2>, <y2>"
  RDOWipeCircuit: 'WipingCircuit:',
  // Kernel/World.pas:4502 (log :4526) — "Defining Zone: <ZoneId>, <TycoonId>, <x1>, <y1>, <x2>, <y2>"
  RDODefineZone: 'Defining Zone:',
  // Kernel/Kernel.pas:11451 (log :11455) — "AskLoan: <tycoon>, $<amount>"
  RDOAskLoan: 'AskLoan:',
  // Kernel/Kernel.pas:11772 (log :11777) — "Setting policy status: <tycoon>, <to>, <status>"
  RDOSetPolicyStatus: 'Setting policy status:',
  // Kernel/Kernel.pas:11679 (log :11681) — "Adding initial suppliers: <tycoon>, <fluid>, <suppliers>"
  RDOAddAutoConnection: 'Adding initial suppliers:',
  // Kernel/Kernel.pas:11689 (log :11691) — "Deleting initial suppliers: <tycoon>, <fluid>, <suppliers>"
  RDODelAutoConnection: 'Deleting initial suppliers:',
  // Kernel/Kernel.pas:11699 (log :11703) — "Initial suppliers, include Trade Center: <tycoon>, <fluid>"
  RDOHireTradeCenter: 'Initial suppliers, include Trade Center:',
  // Kernel/Kernel.pas:11717 (log :11721) — "Initial suppliers, excluding Trade Center: <tycoon>, <fluid>"
  RDODontHireTradeCenter: 'Initial suppliers, excluding Trade Center:',
  // Kernel/Kernel.pas:11735 (log :11739) — "Initial suppliers, hire only warehouses: <tycoon>, <fluid>"
  RDOHireOnlyFromWarehouse: 'Initial suppliers, hire only warehouses:',
  // Kernel/Kernel.pas:11753 (log :11757) — "Initial suppliers, hire all: <tycoon>, <fluid>" (the later
  // "hire all OK!" line, :11766, does not contain "hire all:")
  RDODontHireOnlyFromWarehouse: 'Initial suppliers, hire all:',
  // Kernel/PoliticsCache.pas:139 — kept; not a write, no flow's proof
  CacheTown: 'Caching Town..',
};

/** A marker plus the identifying fields a flow requires of the line. */
export interface LogProof {
  marker: string;
  match?: (line: string) => boolean;
}

export interface LogWindow {
  /** Full URL of the log being watched. */
  url: string;
  /** Byte length at the moment the window opened. */
  offset: number;
  openedAt: string;
}

/** Newest `Survival <YY-MM-DD>.log` in the listing — avoids guessing the server's date. */
export async function findCurrentSurvivalLog(base: string = LIVE_LOG_BASE): Promise<string> {
  const listing = await fetchText(base);
  const names = new Set<string>();
  const pattern = /Survival[%20\s][\d-]+\.log/gi;
  for (const match of listing.matchAll(pattern)) names.add(match[0]);
  if (names.size === 0) {
    throw new Error(`No Survival log found in the listing at ${base}`);
  }
  // YY-MM-DD sorts lexicographically, so the last name is the newest day.
  const newest = Array.from(names).sort().pop() as string;
  return base + newest.replace(/\s/g, '%20');
}

/** Record where the log currently ends, before the write is issued. */
export async function openLogWindow(url: string): Promise<LogWindow> {
  return { url, offset: await logLength(url), openedAt: new Date().toISOString() };
}

/** Everything appended to the log since the window opened. */
export async function readSince(window: LogWindow): Promise<string> {
  const response = await fetch(window.url, { headers: { Range: `bytes=${window.offset}-` } });
  if (response.status === 416) return ''; // Nothing appended yet.
  if (!response.ok) {
    throw new Error(`Log read failed (${response.status}) for ${window.url}`);
  }
  const text = await response.text();
  // A server that ignores Range returns 200 and the whole file — slice it ourselves.
  return response.status === 206 ? text : text.slice(window.offset);
}

/**
 * Poll the log tail until a line containing the marker — and satisfying `match`, when
 * given — appears or the deadline passes. Returns the matching line, or null if it never
 * arrived.
 */
export async function awaitMarker(
  window: LogWindow,
  marker: string,
  timeoutMs: number,
  pollMs?: number,
  now?: () => number,
  sleep?: (ms: number) => Promise<void>,
): Promise<string | null>;
export async function awaitMarker(
  window: LogWindow,
  proof: LogProof,
  timeoutMs: number,
  pollMs?: number,
  now?: () => number,
  sleep?: (ms: number) => Promise<void>,
): Promise<string | null>;
export async function awaitMarker(
  window: LogWindow,
  markerOrProof: string | LogProof,
  timeoutMs: number,
  pollMs = 2_000,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string | null> {
  const proof: LogProof = typeof markerOrProof === 'string' ? { marker: markerOrProof } : markerOrProof;
  const deadline = now() + timeoutMs;
  for (;;) {
    const tail = await readSince(window);
    const line = tail
      .split(/\r?\n/)
      .find(l => l.includes(proof.marker) && (proof.match?.(l) ?? true));
    if (line) return line.trim();
    if (now() >= deadline) return null;
    await sleep(pollMs);
  }
}

async function logLength(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`Cannot read log length (${response.status}) for ${url}`);
  }
  const header = response.headers.get('content-length');
  const length = Number(header);
  if (header === null || !Number.isFinite(length)) {
    throw new Error(`Log at ${url} reported no usable content-length`);
  }
  return length;
}

async function fetchText(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (err: unknown) {
    // `new Error(msg, { cause })` needs lib ES2022; this tree targets ES2020, so the
    // cause is attached as a property instead. It is kept because the underlying network
    // error is what tells an operator whether the log host is down or merely slow.
    const wrapped = new Error(`Cannot reach the model-server logs at ${url}: ${toErrorMessage(err)}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
}
