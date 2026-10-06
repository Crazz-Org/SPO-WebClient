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
 * Windowing applies two rules, and a line must pass both to count as proof:
 *
 * 1. **Byte offset.** We record the log's length before the write (a HEAD request sent with
 *    `Accept-Encoding: identity`) and read only what was appended after. A HEAD answered with
 *    any other `Content-Encoding` is refused: its length is the compressed size, which opens
 *    the window a fraction of the way into the file (#1228).
 * 2. **Timestamp.** A Survival line is stamped in one of two forms. `TimeToStr(Now)` writes
 *    `h:mm:ss AM/PM` (e.g. `Kernel/Kernel.pas:4689`), dated by the file it was read from (see
 *    the rollover rule below). `DateTimeToStr(Now)` writes `YYYY-MM-DD h:mm:ss AM/PM` — the `Voting:`
 *    (`Kernel/TownPolitics.pas:400`, `Kernel/WorldPolitics.pas:1822`), `Service SetPrice:`
 *    (`StdBlocks/ServiceBlock.pas:1580`) and `Setting salaries:`
 *    (`Kernel/WorkCenterBlock.pas:584`) markers — compared as a full UTC date-time. Either way
 *    the stamp must be at or after `LogWindow.openedAt`, less a `CLOCK_SKEW_SECONDS`
 *    allowance. A line earlier than that never counts, whatever the byte offset says. A line
 *    without a stamp falls back to the byte offset alone.
 *
 * Rollover (#1269): the server starts a new `Survival <YY-MM-DD>.log` at 00:00 server time
 * (≈ UTC, per the assumption below), so a run can span two files.
 *
 * - (a) Each window opens on the newest Survival file in the directory of the URL it is given,
 *   at the moment it opens — the URL resolved at preflight only names the directory.
 * - (b) Reading a window returns its file's tail, then the whole of every newer-dated Survival
 *   file that has appeared in that directory since.
 * - (c) An `h:mm:ss AM/PM` stamp is dated by the file it was read from: a line from a file
 *   dated after `openedAt`'s UTC day counts as later than the window, and the time-of-day
 *   comparison applies only to lines from the window's own day.
 *
 * Assumption: **Survival log time = UTC** — verified 2026-09-30 and 2026-10-01 (tail line
 * `6:28:28 AM` read at `06:28:30 UTC`). The server clock can trail the bench by a second or
 * two, and a line logged right after the window opens would then carry a stamp earlier than
 * `openedAt` (research-roundtrip's `Cancel Research:` line, dropped on the first #1228 gate) —
 * hence the allowance. It is seconds; the stale lines this rule exists to refuse are hours old.
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
 * - **Two `AskLoan` lines.** The bank block's `TBankBlock.RDOAskLoan` logs
 *   `Fac(<x>,<y>) AskLoan` (`StdBlocks/Banks.pas:162`) while the tycoon's `RDOAskLoan` logs
 *   `AskLoan: <tycoon>, $<amount>` (`Kernel/Kernel.pas:11455`). One member name cannot carry two
 *   markers (`runRoundTrip` refuses a differing one), so the block form has a class-qualified key,
 *   and its `match` must be `facLineMatches(…, 'AskLoan')` — the bare marker is also a substring of
 *   `AskLoan:` and of an `Error in AskLoan` line, neither of which proves the block's borrow.
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
  // StdBlocks/Banks.pas:46 (impl :160, log :162) — "<date> - Fac(<x>,<y>) AskLoan", no tycoon, no amount.
  // Its own key: RDOAskLoan above is the tycoon form's "AskLoan:" (Kernel/Kernel.pas:11455).
  'TBankBlock.RDOAskLoan': 'AskLoan',
  // Kernel/World.pas:4794 (log :4801) — "CloneFacility: <TycoonId>"; the clone itself is only queued (:4815)
  CloneFacility: 'CloneFacility:',
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
  const days = await listSurvivalDays(base);
  if (days.length === 0) {
    throw new Error(`No Survival log found in the listing at ${base}`);
  }
  return survivalUrl(base, days[days.length - 1]);
}

/** Every `YY-MM-DD` a `Survival <YY-MM-DD>.log` in the listing carries, oldest first. */
async function listSurvivalDays(base: string): Promise<string[]> {
  const listing = await fetchText(base);
  const days = new Set<string>();
  for (const match of listing.matchAll(/Survival(?:%20|\s)(\d{2}-\d{2}-\d{2})\.log/gi)) days.add(match[1]);
  // YY-MM-DD sorts lexicographically, so the last day is the newest.
  return Array.from(days).sort();
}

function survivalUrl(dir: string, day: string): string {
  return `${dir}Survival%20${day}.log`;
}

/** The directory a log URL lives in, trailing slash included. */
function logDirOf(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

/** The `YY-MM-DD` of a `Survival <YY-MM-DD>.log` URL, or undefined for any other name. */
function logDayOf(url: string): string | undefined {
  return /^Survival(?:%20|\s)(\d{2}-\d{2}-\d{2})\.log$/i.exec(url.slice(url.lastIndexOf('/') + 1))?.[1];
}

/**
 * Record where the log currently ends, before the write is issued. The URL handed in only
 * supplies the directory: the window opens on the newest Survival file there right now.
 */
export async function openLogWindow(url: string): Promise<LogWindow> {
  const current = await findCurrentSurvivalLog(logDirOf(url));
  return { url: current, offset: await logLength(current), openedAt: new Date().toISOString() };
}

/** Everything appended to the log since the window opened, then any newer day's file in full. */
export async function readSince(window: LogWindow): Promise<string> {
  return (await readSegments(window)).map(s => s.text).join('\n');
}

interface LogSegment {
  /** `YY-MM-DD` of the file the text was read from, when its name carries one. */
  day?: string;
  text: string;
}

/** The window's own tail, then every newer-dated Survival file in its directory, oldest first. */
async function readSegments(window: LogWindow): Promise<LogSegment[]> {
  const response = await fetch(window.url, {
    headers: { Range: `bytes=${window.offset}-`, 'Accept-Encoding': 'identity' },
  });
  let tail = ''; // 416: nothing appended yet.
  if (response.status !== 416) {
    if (!response.ok) {
      throw new Error(`Log read failed (${response.status}) for ${window.url}`);
    }
    const text = await response.text();
    // A server that ignores Range returns 200 and the whole file — slice it ourselves.
    tail = response.status === 206 ? text : text.slice(window.offset);
  }
  const day = logDayOf(window.url);
  const segments: LogSegment[] = [{ day, text: tail }];
  if (day === undefined) return segments;
  const dir = logDirOf(window.url);
  for (const newer of (await listSurvivalDays(dir)).filter(d => d > day)) {
    const url = survivalUrl(dir, newer);
    const next = await fetch(url, { headers: { 'Accept-Encoding': 'identity' } });
    if (!next.ok) {
      throw new Error(`Log read failed (${next.status}) for ${url}`);
    }
    segments.push({ day: newer, text: await next.text() });
  }
  return segments;
}

/** How far a line's stamp may trail `openedAt` and still count — the server clock can lag the bench. */
export const CLOCK_SKEW_SECONDS = 10;

/**
 * True unless the line carries a stamp earlier than window.openedAt less
 * `CLOCK_SKEW_SECONDS`: a `YYYY-MM-DD h:mm:ss AM|PM` stamp is compared as a full UTC
 * date-time. An `h:mm:ss AM|PM` stamp is dated by `fileDay`, the `YY-MM-DD` of the file it
 * was read from — so a line from a file dated after openedAt's UTC day is later than the
 * window — and, without one, by openedAt's own UTC day.
 */
export function loggedInWindow(line: string, window: LogWindow, fileDay?: string): boolean {
  const stamp = /^\s*(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\b/i.exec(line);
  const opened = new Date(window.openedAt);
  if (!stamp || Number.isNaN(opened.getTime())) return true;
  const hours = (Number(stamp[4]) % 12) + (stamp[7].toUpperCase() === 'PM' ? 12 : 0);
  const minutes = Number(stamp[5]);
  const seconds = Number(stamp[6]);
  if (stamp[1] !== undefined) {
    // DateTimeToStr(Now): full UTC date-time against openedAt.
    const lineMs = Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), hours, minutes, seconds);
    return lineMs >= opened.getTime() - CLOCK_SKEW_SECONDS * 1000;
  }
  // TimeToStr(Now): a time of day, placed on the day of the file it was read from.
  const day = fileDay === undefined ? undefined : /^(\d{2})-(\d{2})-(\d{2})$/.exec(fileDay);
  const dayStartMs = day
    ? Date.UTC(2000 + Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : Date.UTC(opened.getUTCFullYear(), opened.getUTCMonth(), opened.getUTCDate());
  const lineSeconds = dayStartMs / 1000 + hours * 3600 + minutes * 60 + seconds;
  return lineSeconds >= Math.floor(opened.getTime() / 1000) - CLOCK_SKEW_SECONDS;
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
    for (const segment of await readSegments(window)) {
      const line = segment.text
        .split(/\r?\n/)
        .find(
          l => l.includes(proof.marker) && loggedInWindow(l, window, segment.day) && (proof.match?.(l) ?? true),
        );
      if (line) return line.trim();
    }
    if (now() >= deadline) return null;
    await sleep(pollMs);
  }
}

async function logLength(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  if (!response.ok) {
    throw new Error(`Cannot read log length (${response.status}) for ${url}`);
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') {
    throw new Error(
      `Log at ${url} was served with Content-Encoding: ${encoding} despite Accept-Encoding: identity — its content-length is not the file's length`,
    );
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
