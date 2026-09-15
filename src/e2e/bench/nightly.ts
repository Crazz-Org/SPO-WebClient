/**
 * The nightly proof of `main`.
 *
 * The bench proves branches, one at a time, each against the `main` it was based on. It
 * never proves `main` itself — so two branches that pass alone and break together land,
 * and the defect stays invisible until some later session trips on it while working
 * ground it does not own. That session then spends its three gate attempts
 * (doc/E2E-POLICY.md §8) on somebody else's regression. The cost is not the failure, it
 * is the misattribution.
 *
 * The fix is one live drive of `origin/main` a night, deposited by the worker itself.
 *
 * Three decisions worth knowing before reading the code:
 *
 * - **It runs in a checkout nobody else touches** (`<bench>/nightly/checkout`), not in
 *   the worker's own repo. A job builds its worktree, and the worker executes
 *   `dist/e2e/bench/worker.js` *from* that repo (scripts/bench-install.sh) — building
 *   `main` there would overwrite the running worker's own code mid-flight. It is not a
 *   `git worktree` of that repo either: `scripts/finish.sh` scans and reaps worktrees on
 *   its own schedule, and the nightly must not be something `finish` can delete.
 * - **It is a real spool job**, not a side channel. Serialization, the report in `done/`,
 *   the `.log`, `bench:status` visibility, INTERRUPTED recovery and the 24 h purge all
 *   come for free, and "when the queue is idle" is honoured by the only mechanism that
 *   can honour it — the queue. `cli.ts` deliberately does not accept the type, so a
 *   session cannot deposit one.
 * - **It attests nothing.** No `verdicts/<sha>.json` is written for `main`. See the
 *   comment on writeNightlyResult.
 */

import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../../shared/error-utils';
import type { BenchPaths } from './paths';
import { runGit, type GitRunner, type TreeFingerprint } from './fingerprint';
import { prepareCheckout as sharedPrepareCheckout } from './checkout';
import { type GitAuthEnv } from './git-auth';
import type { Spool, JobRequest, JobVerdict, ManualRequester, NightlyTrigger } from './job';

/**
 * The window, in **UTC** hours: the run may start at 02:00, 03:00 or 04:00 UTC.
 *
 * UTC and not local time so the window is the same number on the maintainer's machine
 * and in a test run anywhere. On Europe/Paris that is 04:00–06:59 in summer and
 * 03:00–05:59 in winter — either way, hours at which the queue is empty and no session
 * is waiting behind the nightly.
 */
export const NIGHTLY_WINDOW_START_HOUR_UTC = 2;
export const NIGHTLY_WINDOW_END_HOUR_UTC = 5;

/**
 * How long after one nightly *deposit* the next may be considered.
 *
 * Under 24 h so the run does not drift out of its own window, comfortably over the width
 * of the window so a single night yields a single run. It is measured from the deposit,
 * not the finish, so a slow night cannot buy itself a second slot.
 */
export const NIGHTLY_MIN_GAP_MS = 20 * 60 * 60 * 1000;

/**
 * How long after one "main moved" deposit the next may be considered.
 *
 * Deliberately much tighter than {@link NIGHTLY_MIN_GAP_MS}: a run triggered because
 * `main` advanced is proving a specific new sha, not filling the night's one slot, so a
 * burst of merges should not have to wait 20 hours between checks — but it still must not
 * queue one nightly per commit when several land within the same few minutes.
 */
export const NIGHTLY_MOVE_RATE_LIMIT_MS = 15 * 60 * 1000;

/** What `<bench>/nightly/latest.json` holds — the surface the orchestrator reads. */
export interface NightlyResult {
  /** The spool job that produced this, when one ran. */
  jobId?: string;
  /** The `main` commit that was driven. Absent when nothing ran. */
  sha?: string;
  verdict: JobVerdict;
  /** When the job was deposited — what the gap in nightlyDue is measured from. */
  submittedAt: string;
  finishedAt?: string;
  detail?: string;
  /** The job log, so a human reading a red result has somewhere to go. */
  logFile?: string;
  /** Why this run happened. Absent ≡ `'scheduled'` — every record written before #801 is. */
  trigger?: NightlyTrigger;
  /**
   * Deposit time of the last SCHEDULED run; a manual write carries the previous one
   * forward. This, not `submittedAt`, is what the 20 h window gap is measured from — a
   * manual re-measurement of one sha must not silently cancel that night's window run.
   * Absent ≡ the record predates #801, and `submittedAt` reproduces the old arithmetic.
   */
  scheduledSubmittedAt?: string;
  /** manual only: who asked. */
  requestedBy?: ManualRequester;
  /** manual only: a summary of the record this one replaced. */
  supersedes?: {
    jobId?: string;
    sha?: string;
    verdict: JobVerdict;
    trigger?: NightlyTrigger;
    finishedAt?: string;
  };
}

/** The marker a maintainer's `request-nightly` leaves for the worker's idle branch. */
export interface ManualRequest {
  sha: string;
  requestedBy: ManualRequester;
}

/**
 * One manual outcome, attested or not — `NightlyResult`'s shape plus its provenance.
 *
 * Every manual request produces exactly one of these, including the ones that never
 * deposited a job at all. `latest.json` is replaced only by the attesting ones (see
 * {@link publishManualResult}); this file is where the rest stay visible.
 */
export interface ManualNightlyRecord extends NightlyResult {
  /** The jobId when one ran, otherwise `manual-<epochMs>-<requestedSha 8>`. */
  id: string;
  requestedSha: string;
  requestedBy: ManualRequester;
  attested: boolean;
  /** Only when no job ran at all. */
  outcome?: 'superseded' | 'already-green' | 'prepare-failed';
}

/**
 * Structurally the worker's `RunCommandOptions`. Declared here rather than imported so
 * this module does not point back at worker.ts, which points at it.
 */
export interface NightlyCommandOptions {
  cwd: string;
  env?: Record<string, string>;
  logFile: string;
}

/** Exactly what the nightly needs from the worker — WorkerDeps satisfies it structurally. */
export interface NightlyDeps {
  paths: BenchPaths;
  spool: Spool;
  fingerprint: (worktree: string) => TreeFingerprint;
  /** The sha a ref points at, or undefined when it does not exist. Used to read the
   *  worker repo's local knowledge of `origin/main` — never a fresh network fetch. */
  resolveRef: (worktree: string, ref: string) => string | undefined;
  runCommand: (cmd: string, args: string[], options: NightlyCommandOptions) => Promise<number>;
  now: () => number;
  log: (line: string) => void;
  /** Waits between attempts at a network step — see checkout.ts. */
  sleep: (ms: number) => Promise<void>;
  /**
   * The environment that makes git authenticate to github.com; see ./git-auth. The nightly
   * needs this at least as much as a job does: it is the only proof `main` ever gets, and
   * when its fetch was refused on 2026-09-03 there was nothing behind it to try again.
   */
  gitAuthEnv: () => GitAuthEnv;
}

/** The clone the nightly drives — refreshed to `origin/main`, written by nothing else. */
export function nightlyCheckout(paths: BenchPaths): string {
  return path.join(paths.nightly, 'checkout');
}

/** The published result. */
export function nightlyResultFile(paths: BenchPaths): string {
  return path.join(paths.nightly, 'latest.json');
}

/** Where refreshing the checkout logs — separate from the job log, which may not exist yet. */
export function nightlyPrepareLog(paths: BenchPaths): string {
  return path.join(paths.nightly, 'prepare.log');
}

/** The marker `request-nightly` writes and only `maybeRunNightly` reads. */
export function manualRequestFile(paths: BenchPaths): string {
  return path.join(paths.nightly, 'manual-request.json');
}

/** Where every manual outcome is kept, attested or not. The worker never deletes these. */
export function manualRecordDir(paths: BenchPaths): string {
  return path.join(paths.nightly, 'manual');
}

export function manualRecordFile(paths: BenchPaths, id: string): string {
  return path.join(manualRecordDir(paths), `${id}.json`);
}

/** A 40-hex commit sha, and nothing looser: the marker names the tip that was confirmed. */
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Read the manual request, or `null` when there is none.
 *
 * A marker that cannot be trusted is **deleted**, not left in place — same rule as
 * `readNightlyResult`'s corrupt-tolerant read, and for the same reason one level up: this
 * file is consulted on every idle tick, so one bad write would otherwise wedge the manual
 * path (and its log line) forever.
 */
export function readManualRequest(paths: BenchPaths, log: (line: string) => void): ManualRequest | null {
  const file = manualRequestFile(paths);
  let parsed: ManualRequest;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ManualRequest;
  } catch (err: unknown) {
    if (!fs.existsSync(file)) return null;
    log(`nightly: discarding an unreadable manual request (${toErrorMessage(err)})`);
    deleteManualRequest(paths);
    return null;
  }
  if (typeof parsed?.sha !== 'string' || !SHA_RE.test(parsed.sha)) {
    log('nightly: discarding a manual request whose sha is not a 40-hex commit');
    deleteManualRequest(paths);
    return null;
  }
  if (typeof parsed.requestedBy?.reason !== 'string' || parsed.requestedBy.reason.trim() === '') {
    log('nightly: discarding a manual request with no reason');
    deleteManualRequest(paths);
    return null;
  }
  return parsed;
}

export function deleteManualRequest(paths: BenchPaths): void {
  fs.rmSync(manualRequestFile(paths), { force: true });
}

/** Tmp-then-rename, exactly as `writeNightlyResult` does — and it makes its own parent. */
export function writeManualRecord(paths: BenchPaths, record: ManualNightlyRecord): void {
  const target = manualRecordFile(paths, record.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
}

/** Every manual record on file, newest-irrelevant order; unreadable entries are skipped. */
export function readManualRecords(paths: BenchPaths): ManualNightlyRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(manualRecordDir(paths));
  } catch {
    return [];
  }
  const out: ManualNightlyRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(
        JSON.parse(fs.readFileSync(path.join(manualRecordDir(paths), name), 'utf8')) as ManualNightlyRecord,
      );
    } catch {
      // A half-written or hand-edited record must not hide the rest.
    }
  }
  return out;
}

/**
 * The most recent manual **deposit** time, or undefined when none exists.
 *
 * Every manual record counts, including the ones where no job ran: that is the
 * conservative direction for a limit whose whole effect is bounded at 15 minutes, and it
 * keeps a request that failed to prepare from being retried in a tight loop.
 */
export function newestManualDepositMs(paths: BenchPaths): number | undefined {
  let newest: number | undefined;
  for (const record of readManualRecords(paths)) {
    const ms = Date.parse(record.submittedAt);
    if (Number.isFinite(ms) && (newest === undefined || ms > newest)) newest = ms;
  }
  return newest;
}

export function readNightlyResult(paths: BenchPaths): NightlyResult | null {
  try {
    return JSON.parse(fs.readFileSync(nightlyResultFile(paths), 'utf8')) as NightlyResult;
  } catch {
    // Absent or unreadable both mean the same thing to every caller: nothing is known
    // about main. A corrupt file must not be able to wedge the nightly off.
    return null;
  }
}

/**
 * Publish the result — tmp-then-rename, so a reader never sees half a file.
 *
 * Deliberately **not** `verdicts/<sha>.json`. That file means a *gate* ran — the static
 * stage, the President exclusion, verify-gate's routing — and a bare live drive is none
 * of those. Writing one would also hand `publishPendingStatuses` a `bench/gate` commit
 * status to post on `main`'s own sha, a context branch protection reads; and the push
 * hook matches an attestation to the pushing worktree, which this checkout never is. A
 * separate surface says the true thing instead of a convenient one.
 */
export function writeNightlyResult(paths: BenchPaths, result: NightlyResult): void {
  fs.mkdirSync(paths.nightly, { recursive: true });
  const target = nightlyResultFile(paths);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
}

/** Is `nowMs` inside the 02:00–05:00 UTC window? */
function isTimeWindowDue(nowMs: number): boolean {
  const hour = new Date(nowMs).getUTCHours();
  return hour >= NIGHTLY_WINDOW_START_HOUR_UTC && hour <= NIGHTLY_WINDOW_END_HOUR_UTC;
}

/**
 * Has `origin/main` advanced past the last sha a nightly actually proved?
 *
 * Requires an actual prior sha to compare against — a `lastProvenSha` of undefined means
 * "unknown", not "moved". Nothing having run yet must not read as a move: that would fire
 * this trigger off-window and off-gap the very first time `currentMainSha` becomes
 * resolvable, which is exactly the case the window schedule below already covers.
 */
function isMainMoved(currentMainSha: string | undefined, lastProvenSha: string | undefined): boolean {
  return (
    currentMainSha !== undefined && lastProvenSha !== undefined && currentMainSha !== lastProvenSha
  );
}

/**
 * Did the last result prove nothing about any sha at all?
 *
 * An `ENVIRONMENT` nightly records no `sha` — the checkout never got far enough to have
 * one. That is the state this predicate exists for, and it is a trap without it: `main` is
 * unproven, and the move trigger *cannot say so*, because `isMainMoved` needs two shas to
 * compare and only has one. Every trigger but the 03:00 window is then dead until the next
 * window.
 *
 * That is not hypothetical. On 2026-09-03 a single throttled fetch failed the nightly at
 * 07:49:22Z, recorded `ENVIRONMENT` with no sha, and `main` went unproven for the rest of
 * the working day — with eleven commits landing behind it.
 *
 * Retrying is bounded by construction, not by hope: this can only be true when nothing
 * ran, because any nightly that got as far as driving records the sha it started on, and
 * `isAlreadyProven` stops it there. So the loop this opens is "keep trying to prove main
 * until you manage to", at the move trigger's own 15-minute rate limit — never "drive the
 * live world again and again".
 */
function provedNothing(last: NightlyResult | null, lastProvenSha: string | undefined): boolean {
  return last !== null && lastProvenSha === undefined;
}

/** Is the current `main` sha exactly the one already covered by the last result? */
function isAlreadyProven(currentMainSha: string | undefined, lastProvenSha: string | undefined): boolean {
  return currentMainSha !== undefined && currentMainSha === lastProvenSha;
}

/** Has enough time passed since `lastRunAtMs` to clear a rate limit of `gapMs`? */
function isRateLimitExceeded(lastRunAtMs: number | undefined, nowMs: number, gapMs: number): boolean {
  if (lastRunAtMs === undefined || !Number.isFinite(lastRunAtMs)) return true;
  return nowMs - lastRunAtMs >= gapMs;
}

/**
 * Is a nightly due right now?
 *
 * Pure, so the whole schedule is testable without a filesystem or a real clock.
 *
 * Two independent paths, either of which is enough:
 *
 * - **The window.** The original schedule: once inside 02:00–05:00 UTC, and not again
 *   within {@link NIGHTLY_MIN_GAP_MS} of the last deposit. Unchanged, and the only path
 *   taken when `currentMainSha` is not given — every existing caller keeps this behaviour.
 * - **Main moved.** When `currentMainSha` is known, a sha was previously proven
 *   (`lastProvenSha` is set), and they differ — a run is due immediately, independent of
 *   the window, so a break is caught close to the push that caused it rather than at the
 *   next 02:00. Rate-limited on its own, much tighter, gap
 *   ({@link NIGHTLY_MOVE_RATE_LIMIT_MS}) so a burst of merges deposits one run, not one per
 *   push. Nothing having run yet (`lastProvenSha` absent) is "unknown", not "moved" — that
 *   case falls through to the window schedule below, same as an omitted `currentMainSha`.
 *
 * Ahead of both: `currentMainSha` already matching `lastProvenSha` means this exact commit
 * was already run — main is immutable at a sha, so a second run would teach nothing new,
 * and neither path fires.
 */
export function nightlyDue(
  last: NightlyResult | null,
  nightlyPending: boolean,
  nowMs: number,
  currentMainSha?: string,
  lastProvenSha?: string,
  lastRunAtMs?: number,
): boolean {
  // One at a time: a job already queued or running IS this night's nightly.
  if (nightlyPending) return false;

  // This exact sha was already run — re-running teaches nothing new about main.
  if (isAlreadyProven(currentMainSha, lastProvenSha)) return false;

  // The SCHEDULED stamp, not simply the last deposit: a manual proof re-measures one sha
  // because a human asked, and consuming the night's 20 h slot would silently cancel that
  // night's window run. Records written before #801 have no `scheduledSubmittedAt`, so the
  // fallback reproduces the old arithmetic exactly.
  const submittedAtMs = last ? Date.parse(last.scheduledSubmittedAt ?? last.submittedAt) : NaN;
  const effectiveLastRunAtMs = lastRunAtMs ?? (Number.isFinite(submittedAtMs) ? submittedAtMs : undefined);

  // Two ways `main` can be unproven: it moved past what was proven, or nothing was ever
  // proven because the last attempt died before it could learn anything. Both are answered
  // by the same rate-limited retry.
  const unproven =
    currentMainSha !== undefined &&
    (isMainMoved(currentMainSha, lastProvenSha) || provedNothing(last, lastProvenSha));
  if (unproven && isRateLimitExceeded(effectiveLastRunAtMs, nowMs, NIGHTLY_MOVE_RATE_LIMIT_MS)) {
    return true;
  }

  if (!isTimeWindowDue(nowMs)) return false;
  if (!last) return true;
  // An unparseable stamp is not a reason to never run again.
  if (!Number.isFinite(submittedAtMs)) return true;
  return nowMs - submittedAtMs >= NIGHTLY_MIN_GAP_MS;
}

/**
 * Is a MANUAL proof due right now? Pure, same reason `nightlyDue` is.
 *
 * Two conditions, and deliberately not a third:
 *
 * - **Nothing nightly is pending.** One at a time, exactly as the scheduled path.
 * - **The 15-minute live-drive limit has cleared.** A manual proof *is* a live drive of the
 *   one world on the one locked account, so it counts against
 *   {@link NIGHTLY_MOVE_RATE_LIMIT_MS} like any other. A request inside that window WAITS —
 *   the marker stays on disk and the next tick reconsiders it — it is never refused.
 *
 * What is absent is the window and the 20 h gap. A human who has read the log and asked for
 * a re-measurement is not filling the night's slot; they are asking one specific question
 * about one specific tip, and making them wait until 02:00 UTC would make the whole command
 * useless for the case it exists for.
 */
export function manualProofDue(pending: boolean, nowMs: number, lastRunAtMs?: number): boolean {
  return !pending && isRateLimitExceeded(lastRunAtMs, nowMs, NIGHTLY_MOVE_RATE_LIMIT_MS);
}

/**
 * Bring `<bench>/nightly/checkout` to `origin/main`.
 *
 * A thin naming of the shared machinery in ./checkout — same clone, same reset, same
 * conditional install — with `origin/main` as the target. It stayed a named function
 * because "the nightly's checkout" is a thing the rest of this module and its tests talk
 * about, while ./checkout deliberately knows nothing about nightlies.
 */
export async function prepareCheckout(
  deps: NightlyDeps,
  workerRepo: string,
  git: GitRunner,
): Promise<string | null> {
  // The nightly already targets `origin/main` as `ref` — there is nothing to merge it
  // with, so it never passes `mergeRef` and stays on the shape this module's own callers
  // and tests have always used.
  const result = await sharedPrepareCheckout(
    deps,
    {
      dir: nightlyCheckout(deps.paths),
      ref: 'origin/main',
      workerRepo,
      logFile: nightlyPrepareLog(deps.paths),
    },
    git,
  );
  return result.failed;
}

/** The id a manual record gets when no job ever ran, so there is no jobId to borrow. */
function manualRecordId(nowMs: number, requestedSha: string): string {
  return `manual-${String(nowMs)}-${requestedSha.slice(0, 8)}`;
}

/** The later of two possibly-absent, possibly-unparseable epoch stamps. */
function laterOf(a: number | undefined, b: number | undefined): number | undefined {
  const finite = [a, b].filter((ms): ms is number => ms !== undefined && Number.isFinite(ms));
  return finite.length === 0 ? undefined : Math.max(...finite);
}

/**
 * Called from the worker loop's idle branch: if a nightly is due, refresh the checkout
 * and deposit the job. Returns true when one was deposited.
 *
 * A session that deposits while the nightly runs simply queues behind it, exactly as it
 * would behind any other job — the nightly is never aborted, and never *starts* while
 * anything is queued, which is the only moment "idle" can be honoured.
 *
 * A **manual** request is served ahead of the scheduled schedule, and by the same
 * mechanism: it is an ordinary `type: 'nightly'` job, deposited from this same idle
 * branch, so "never while a session is waiting" keeps being honoured by the queue rather
 * than by a second rule. See {@link manualProofDue} for what it does and does not wait on.
 */
export async function maybeRunNightly(
  deps: NightlyDeps,
  workerRepo: string = process.cwd(),
  git: GitRunner = runGit,
): Promise<boolean> {
  const pending = [...deps.spool.queued(), ...deps.spool.running()].some(
    entry => entry.request.type === 'nightly',
  );
  const nowMs = deps.now();
  const last = readNightlyResult(deps.paths);
  const manual = readManualRequest(deps.paths, deps.log);
  // What the 15-minute LIVE-DRIVE limit is measured from: the later of the last published
  // deposit and the newest manual deposit. A manual run is a live drive too, so it must be
  // counted here even though it never touches the window's own 20 h slot.
  const lastRunAtMs = laterOf(
    last ? Date.parse(last.submittedAt) : undefined,
    newestManualDepositMs(deps.paths),
  );

  if (manual !== null) {
    return runManualProof(deps, workerRepo, git, { manual, last, pending, nowMs, lastRunAtMs });
  }

  // Local knowledge only — never a fresh fetch on every idle tick. Ordinary job traffic
  // (each fetches `origin/main` into its own worktree of this same repo, sharing the ref)
  // keeps it current in practice.
  const currentMainSha = deps.resolveRef(workerRepo, 'origin/main');
  if (!nightlyDue(last, pending, nowMs, currentMainSha, last?.sha, lastRunAtMs)) return false;

  const submittedAt = new Date(nowMs).toISOString();
  deps.log('nightly: refreshing the main checkout');
  const failedStep = await prepareCheckout(deps, workerRepo, git);
  if (failedStep) {
    // ENVIRONMENT, not FAIL: the checkout could not be built, so nothing was learned
    // about main. Recording it is what stops the loop retrying every two seconds until
    // the window closes — and what tells a human where to look.
    deps.log(`nightly: ${failedStep} failed — not deposited`);
    writeNightlyResult(deps.paths, {
      verdict: 'ENVIRONMENT',
      submittedAt,
      finishedAt: new Date(deps.now()).toISOString(),
      detail: `${failedStep} failed while refreshing the nightly checkout — see ${nightlyPrepareLog(deps.paths)}`,
      trigger: 'scheduled',
      scheduledSubmittedAt: submittedAt,
    });
    return false;
  }

  const checkout = nightlyCheckout(deps.paths);
  let fingerprint: TreeFingerprint;
  try {
    fingerprint = deps.fingerprint(checkout);
  } catch (err: unknown) {
    deps.log(`nightly: could not fingerprint the checkout — not deposited`);
    writeNightlyResult(deps.paths, {
      verdict: 'ENVIRONMENT',
      submittedAt,
      finishedAt: new Date(deps.now()).toISOString(),
      detail: `could not fingerprint the nightly checkout: ${toErrorMessage(err)}`,
      trigger: 'scheduled',
      scheduledSubmittedAt: submittedAt,
    });
    return false;
  }

  const request = deps.spool.submit(
    {
      type: 'nightly',
      worktree: checkout,
      branch: 'main',
      fingerprint,
      // Nobody waits on a nightly: there is no session behind it to abandon it.
      submitter: { pid: 0 },
      args: [],
      trigger: 'scheduled',
    },
    nowMs,
  );
  deps.log(`nightly: deposited ${request.id} for main ${fingerprint.head}`);
  return true;
}

interface ManualProofContext {
  manual: ManualRequest;
  last: NightlyResult | null;
  pending: boolean;
  nowMs: number;
  lastRunAtMs?: number;
}

/**
 * Serve one manual request. Returns true only when a job was actually deposited.
 *
 * Every path but the last writes a manual record and drops the marker, and **none of them
 * touches `latest.json`**. That is the load-bearing rule of the whole feature: a manual run
 * that broke on the environment, or arrived after `main` had already moved, has measured
 * nothing — and clearing a genuine red on the strength of a non-measurement is exactly the
 * failure the request exists to avoid, not to cause.
 */
async function runManualProof(
  deps: NightlyDeps,
  workerRepo: string,
  git: GitRunner,
  ctx: ManualProofContext,
): Promise<boolean> {
  const { manual, last, pending, nowMs } = ctx;
  if (!manualProofDue(pending, nowMs, ctx.lastRunAtMs)) {
    // The marker is KEPT: a request inside the 15-minute limit waits for the next tick,
    // it is not refused. The human already confirmed the sha; the bench owes them the run.
    deps.log(
      `nightly: manual proof of ${manual.sha.slice(0, 8)} waiting — a nightly is pending, or the 15-minute live-drive limit has not cleared`,
    );
    return false;
  }

  const submittedAt = new Date(nowMs).toISOString();
  const provenance = {
    requestedSha: manual.sha,
    requestedBy: manual.requestedBy,
    submittedAt,
    trigger: 'manual' as const,
    attested: false,
  };
  const noJobRecord = (rest: Omit<ManualNightlyRecord, keyof typeof provenance | 'id'>): void => {
    writeManualRecord(deps.paths, {
      ...provenance,
      ...rest,
      id: manualRecordId(nowMs, manual.sha),
    });
    deleteManualRequest(deps.paths);
  };

  if (last?.verdict === 'PASS' && last.sha === manual.sha) {
    deps.log(`nightly: manual proof of ${manual.sha.slice(0, 8)} skipped — already recorded PASS`);
    noJobRecord({
      sha: manual.sha,
      verdict: 'PASS',
      finishedAt: new Date(deps.now()).toISOString(),
      outcome: 'already-green',
      detail: 'main is already recorded PASS at this exact sha — nothing was driven',
    });
    return false;
  }

  deps.log('nightly: refreshing the main checkout for a manual proof');
  const failedStep = await prepareCheckout(deps, workerRepo, git);
  if (failedStep) {
    deps.log(`nightly: ${failedStep} failed — the manual proof was not deposited`);
    noJobRecord({
      verdict: 'ENVIRONMENT',
      finishedAt: new Date(deps.now()).toISOString(),
      outcome: 'prepare-failed',
      detail: `${failedStep} failed while refreshing the nightly checkout — see ${nightlyPrepareLog(deps.paths)}`,
    });
    return false;
  }

  const checkout = nightlyCheckout(deps.paths);
  let fingerprint: TreeFingerprint;
  try {
    fingerprint = deps.fingerprint(checkout);
  } catch (err: unknown) {
    deps.log('nightly: could not fingerprint the checkout — the manual proof was not deposited');
    noJobRecord({
      verdict: 'ENVIRONMENT',
      finishedAt: new Date(deps.now()).toISOString(),
      outcome: 'prepare-failed',
      detail: `could not fingerprint the nightly checkout: ${toErrorMessage(err)}`,
    });
    return false;
  }

  if (fingerprint.head !== manual.sha) {
    // `main` moved between the confirmation and the refresh. Driving the new tip would
    // answer a question nobody asked, and the ordinary move trigger will prove it anyway.
    // STALE rather than a new verdict: it is this project's own word for "the subject
    // changed underneath the run, so this attests nothing", and the union is hand-synced
    // into two other consumers (scripts/nightly-check.sh, SPO-Pipeline's classifyNightly).
    deps.log(
      `nightly: manual proof of ${manual.sha.slice(0, 8)} superseded — main is now ${fingerprint.head.slice(0, 8)}`,
    );
    noJobRecord({
      sha: fingerprint.head,
      verdict: 'STALE',
      finishedAt: new Date(deps.now()).toISOString(),
      outcome: 'superseded',
      detail: `main moved to ${fingerprint.head} before the requested ${manual.sha} could be driven; the move trigger will prove the new tip`,
    });
    return false;
  }

  const request = deps.spool.submit(
    {
      type: 'nightly',
      worktree: checkout,
      branch: 'main',
      fingerprint,
      submitter: { pid: 0 },
      args: [],
      trigger: 'manual',
      requestedBy: manual.requestedBy,
    },
    nowMs,
  );
  // Deposit BEFORE delete, on purpose. A worker death between the two leaves the marker on
  // disk; the next tick sees a pending nightly and does nothing, and once that job finishes
  // the leftover marker either hits the already-green path (it passed) or queues one more
  // visible, rate-limited drive (it failed). The alternative — delete first — can lose the
  // request entirely, which is the failure a human would have to notice by its absence.
  deleteManualRequest(deps.paths);
  deps.log(
    `nightly: deposited manual proof ${request.id} for main ${fingerprint.head} (requested by ${manual.requestedBy.user}: ${manual.requestedBy.reason})`,
  );
  return true;
}

/** The shape both publish paths read a finished report through. */
interface NightlyReportView {
  id: string;
  verdict: JobVerdict;
  fingerprints: { atSubmit: TreeFingerprint; atStart?: TreeFingerprint };
  finishedAt?: string;
  detail?: string;
  logFile?: string;
}

/** The sha a nightly job actually started on; the deposit sha when it never started. */
function drivenSha(report: NightlyReportView): string {
  return report.fingerprints.atStart?.head ?? report.fingerprints.atSubmit.head;
}

/**
 * The result a finished (or interrupted) SCHEDULED nightly job publishes.
 *
 * `submittedAt` comes from the request, never from the report: it is what the gap in
 * nightlyDue is measured from, and a job that queued behind something else started long
 * after it was deposited. The request is taken whole rather than as a bare stamp because
 * the trigger has to travel with it — a manual run goes through
 * {@link publishManualResult} instead, and this function is the scheduled half.
 */
export function nightlyResultFromReport(
  report: NightlyReportView,
  request: Pick<JobRequest, 'submittedAt' | 'trigger'>,
): NightlyResult {
  return {
    jobId: report.id,
    sha: drivenSha(report),
    verdict: report.verdict,
    submittedAt: request.submittedAt,
    finishedAt: report.finishedAt,
    detail: report.detail,
    logFile: report.logFile,
    trigger: 'scheduled',
    // A scheduled deposit IS the night's slot, so the two stamps are the same value; a
    // later manual write carries this one forward rather than resetting the window.
    scheduledSubmittedAt: request.submittedAt,
  };
}

/**
 * Publish the outcome of a **manual** nightly job.
 *
 * Two writes, and only one of them is conditional:
 *
 * - The manual record in `nightly/manual/<jobId>.json` is written **always**, whatever the
 *   verdict. That file is the complete history of what a human asked for and what came
 *   back, and it is the only place a non-attesting manual outcome is visible at all.
 * - `nightly/latest.json` is replaced **only when the run actually measured the sha that
 *   was requested** — the verdict is `PASS` or `FAIL`, and the driven sha is the requested
 *   one. `ENVIRONMENT`, `INTERRUPTED`, `STALE`, `BLOCKED` and a run whose tip moved all
 *   leave it byte-identical.
 *
 * That condition is the whole safety of the feature. Without it a manual run that died on
 * a timed-out fetch would **clear a genuine red it never measured** — which is worse than
 * the red sticking, because the red at least says something true. A *scheduled*
 * `INTERRUPTED` still overwrites, and that asymmetry is deliberate: there the rule exists
 * so a worker death cannot leave yesterday's PASS standing for a sha nothing is scheduled
 * to re-drive. A manual run has no such duty — the record it would overwrite is a real
 * measurement of this very same sha, and the human can simply ask again.
 */
export function publishManualResult(
  paths: BenchPaths,
  report: NightlyReportView & { verdict: JobVerdict },
  request: Pick<JobRequest, 'submittedAt' | 'fingerprint' | 'requestedBy'>,
): void {
  const requestedSha = request.fingerprint.head;
  const sha = drivenSha(report);
  const requestedBy = request.requestedBy ?? unknownRequester(request.submittedAt);
  const attested =
    (report.verdict === 'PASS' || report.verdict === 'FAIL') && sha === requestedSha;

  writeManualRecord(paths, {
    id: report.id,
    jobId: report.id,
    requestedSha,
    requestedBy,
    attested,
    sha,
    verdict: report.verdict,
    submittedAt: request.submittedAt,
    finishedAt: report.finishedAt,
    detail: report.detail,
    logFile: report.logFile,
    trigger: 'manual',
  });

  if (!attested) return;

  const previous = readNightlyResult(paths);
  writeNightlyResult(paths, {
    jobId: report.id,
    sha,
    verdict: report.verdict,
    submittedAt: request.submittedAt,
    finishedAt: report.finishedAt,
    detail: report.detail,
    logFile: report.logFile,
    trigger: 'manual',
    // Carried forward, never reset: a manual proof does not consume the night's slot.
    // A pre-#801 record has no `scheduledSubmittedAt`, and its own `submittedAt` IS the
    // last scheduled deposit — every record before this existed was a scheduled one.
    ...(previous
      ? { scheduledSubmittedAt: previous.scheduledSubmittedAt ?? previous.submittedAt }
      : {}),
    requestedBy,
    ...(previous
      ? {
          supersedes: {
            jobId: previous.jobId,
            sha: previous.sha,
            verdict: previous.verdict,
            trigger: previous.trigger ?? 'scheduled',
            finishedAt: previous.finishedAt,
          },
        }
      : {}),
  });
}

/**
 * The requester of a manual job whose spool file predates (or lost) its `requestedBy`.
 *
 * Only reachable for a job deposited by an older worker binary and finished by a newer
 * one. The record still has to name someone, and saying so plainly beats omitting the
 * field and letting a reader assume the run was scheduled.
 */
export function unknownRequester(requestedAt: string): ManualRequester {
  return {
    user: 'unknown',
    host: 'unknown',
    tty: 'unknown',
    via: 'bench-cli',
    reason: 'the request carried no requestedBy',
    requestedAt,
  };
}
