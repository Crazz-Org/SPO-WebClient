/**
 * The spool — how a session asks the bench for a run, and how it gets the answer.
 *
 * A job request is one JSON file in spool/. The filename embeds the deposit time, so
 * the queue order IS the lexical filename order — no index, no counter, nothing to
 * corrupt. Every write goes tmp-then-rename on the same filesystem, so a reader never
 * sees a half-written file. No lock anywhere: exactly one process (the worker) consumes
 * the spool, and claiming is a rename, which is atomic.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../../shared/error-utils';
import type { BenchPaths } from './paths';
import type { TreeFingerprint } from './fingerprint';

export type JobType = 'live' | 'lease' | 'nightly' | 'ref';

export type JobVerdict =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'ENVIRONMENT'
  /** The tree changed between deposit and the end of the run — never presented as PASS. */
  | 'STALE'
  /** A gate job on a tree with uncommitted changes: nothing ran, nothing is attested. */
  | 'DIRTY'
  /** The depositing session died before its job started; nothing ran. */
  | 'ABANDONED'
  /** The worker went down mid-job; the body may have partially run. */
  | 'INTERRUPTED'
  /** A lease job: the gateway is up and held for the session. */
  | 'LEASED';

/**
 * Why a nightly exists. `scheduled` is the worker's own idle branch — the window, the
 * main-moved trigger; `manual` is a maintainer who ran `npm run bench:nightly-request`
 * because a red was not the code. Absent everywhere means `scheduled`: every record
 * written before the manual path existed is one.
 */
export type NightlyTrigger = 'scheduled' | 'manual';

/** Who asked for a manual nightly, recorded so a live drive is never anonymous. */
export interface ManualRequester {
  user: string;
  host: string;
  /** The controlling terminal, or 'unknown' when it could not be read. */
  tty: string;
  via: 'bench-cli' | 'spo';
  /** Required, trimmed, non-empty — a drive of the live world states its reason. */
  reason: string;
  requestedAt: string;
}

export interface JobRequest {
  id: string;
  type: JobType;
  /** Absolute path of the worktree to test, exactly as it sits on disk. */
  worktree: string;
  branch: string;
  /** Taken at deposit time. */
  fingerprint: TreeFingerprint;
  /** pid of a process that waits for the report (submit --wait); 0 = nobody to watch. */
  submitter: { pid: number };
  submittedAt: string;
  /** Forwarded verbatim to the job body (verify-gate.js / run.js flags). */
  args: string[];
  /** lease only: how long to hold the gateway. */
  leaseMinutes?: number;
  /**
   * `ref` only: what to gate, as anything `git reset --hard` accepts — a sha, a branch,
   * a `gh-readonly-queue/...` ref. The worker fetches it into a checkout it owns, so
   * unlike every other job type the subject need not exist on this machine at all.
   */
  ref?: string;
  /**
   * Set when the worker deposited this itself to serve a GitHub merge-queue entry. It is
   * the priority marker: such a job is taken before anything else waiting, because the
   * queue ejects an entry whose checks time out and the bench is serialised. See
   * ./merge-queue.
   */
  queueEntry?: boolean;
  /** `nightly` only: why this one was deposited. Absent ≡ `'scheduled'`. */
  trigger?: NightlyTrigger;
  /** `nightly` + `trigger: 'manual'` only: the human behind the request. */
  requestedBy?: ManualRequester;
}

export interface JobReport {
  id: string;
  type: JobType;
  worktree: string;
  branch: string;
  verdict: JobVerdict;
  /** What the body concluded before the staleness rule was applied (differs on STALE). */
  bodyVerdict?: JobVerdict;
  fingerprints: {
    atSubmit: TreeFingerprint;
    atStart?: TreeFingerprint;
    atEnd?: TreeFingerprint;
  };
  targetMoved: boolean;
  /**
   * The `origin/main` sha the job was judged against. `main` moving past it is what
   * makes an attestation stale, now that the branch is no longer forced to be up to
   * date — see doc/bench-worker.md § The gate base. Absent when the ref could not be
   * resolved (offline, no remote).
   */
  baseMain?: string;
  /**
   * `ref` only: true when `prepareRef` had to merge `origin/main` into the checkout —
   * `ref` was not already an ancestor of it, so the tree the gate judged is not simply
   * the branch's own HEAD. See doc/bench-worker.md § The gate base.
   */
  merged?: boolean;
  startedAt: string;
  finishedAt?: string;
  /** Human-readable summary or error. */
  detail?: string;
  /** `ref` only: path of report/e2e/gate-<sha>.json inside the checkout. */
  gateArtifact?: string;
  /**
   * `ref` only: whether the static stage (typecheck, lint, tests) was taken from CI's run
   * on this sha instead of replayed on the bench, and why not when it was not. See
   * ./ci-proof — absent means the question was never asked (live/lease/nightly job).
   */
  staticProof?: { used: boolean; why?: string };
  /** Where the job's stdout/stderr went. */
  logFile?: string;
  /** lease only. */
  port?: number;
  leaseUntil?: string;
  /** `nightly` only: copied from the request by `runJob`, so the publish path can read it. */
  trigger?: NightlyTrigger;
}

/**
 * One line of `jobsLog` (~/.spo-bench/jobs.jsonl) — the durable answer to "what happened
 * to this job", for every verdict including the ones `verdicts/` never records (DIRTY,
 * ENVIRONMENT, ABANDONED) and the one nothing else ever recorded past 24 h (INTERRUPTED).
 * Deliberately a subset of `JobReport`: no `fingerprints.atStart`/`atEnd`, no
 * `gateArtifact`, no `logFile` — those name paths and hashes that answer "was this build
 * reproducible", which is `done/<id>.json`'s job while it still exists. This line answers
 * "what verdict did job X reach, on what sha, and why" — cheap enough to keep forever (see
 * `appendJobsLog`'s doc comment for the measured size).
 */
export interface JobsLogLine {
  id: string;
  type: JobType;
  /** The sha the submitter deposited — `report.fingerprints.atSubmit.head`, never the
   *  merge commit a `ref` job's `prepareRef` may have produced (see worker.ts's own
   *  `depositedSha`/`gatedSha` split, B4.1). */
  depositedSha: string;
  branch: string;
  verdict: JobVerdict;
  /** What the body concluded before STALE overrode it — absent unless it did. */
  bodyVerdict?: JobVerdict;
  startedAt: string;
  finishedAt: string;
  detail?: string;
  /** `nightly` only: `scheduled` or `manual`. Absent on every other job type. */
  trigger?: NightlyTrigger;
}

/**
 * Append one durable line to `jobsLog` for a FINISHED report — never for the `lease` job's
 * own early write (`worker.ts`: "the report is written EARLY... then the worker holds the
 * bench"), which has no `finishedAt` yet. That early write and the lease's real final write
 * both reach here through the same `Spool.writeReport`; gating on `finishedAt` is what
 * keeps this one line per job instead of two for every lease.
 *
 * `finishedAt` is set exactly once per job, by `runJob`'s `finish()` closure for every
 * ordinary outcome, and directly by `recoverInterrupted` (INTERRUPTED) and `processOldest`
 * (ABANDONED, submitter-died-before-start) for the two paths that never reach `runJob` at
 * all. All three write through `Spool.writeReport`, so hooking the append there — rather
 * than in each of those three call sites — is what makes INTERRUPTED reach this file: a
 * worker that died mid-job has nothing to do with any of `runJob`'s own return paths, but
 * `recoverInterrupted` still calls `writeReport`, so it still lands here.
 *
 * WHOLLY NON-FATAL, the same rule as `nextGateAttempt` (B4.3): this is bookkeeping, never
 * evidence a gate's own verdict depends on. A full disk, an unwritable `~/.spo-bench`, a
 * permissions change — none of it may throw out of here, and none of it may touch the
 * `done/<id>.json` this function is called right after writing. The failure is not
 * swallowed, though: it is handed to `log` when the caller supplies one, so a jobs.jsonl
 * that quietly stopped growing is at least visible in the worker's own log — the gap this
 * action exists to close, one level in.
 *
 * Retention: no rotation, and none is planned. Measured by literally replaying this
 * function over every real `~/.spo-bench/done/*.json` on disk (37 reports, 2026-09-03):
 * 11,933 bytes total, 323 bytes/line average — against ~1-1.3 KB for the `.json` each line
 * summarizes. The bench is one worker running one job at a time, and that same corpus shows
 * on the order of tens of jobs a day (37 in the trailing 24 h). At 40 jobs/day * 323 B that
 * is ~13 KB/day, ~4.6 MB/year: trivial to keep forever, and trivial next to the `.log`
 * files this deliberately excludes (measured up to ~48 KB each, and still purged after
 * 24 h by `purgeDone`). Revisit only if the job rate itself grows by orders of magnitude —
 * nothing here assumes it will.
 */
export function appendJobsLog(
  paths: BenchPaths,
  report: JobReport,
  log?: (line: string) => void,
): void {
  if (report.finishedAt === undefined) return;
  const line: JobsLogLine = {
    id: report.id,
    type: report.type,
    depositedSha: report.fingerprints.atSubmit.head,
    branch: report.branch,
    verdict: report.verdict,
    ...(report.bodyVerdict !== undefined ? { bodyVerdict: report.bodyVerdict } : {}),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    ...(report.detail !== undefined ? { detail: report.detail } : {}),
    // Nightly only: on any other type the field is meaningless, and a key that is always
    // "scheduled" on a `ref` line would read as if the question had been asked of it.
    ...(report.type === 'nightly' && report.trigger !== undefined ? { trigger: report.trigger } : {}),
  };
  try {
    fs.appendFileSync(paths.jobsLog, `${JSON.stringify(line)}\n`, 'utf8');
  } catch (err: unknown) {
    log?.(`jobs.jsonl: could not append ${report.id} (${toErrorMessage(err)})`);
  }
}

export class DuplicateJobError extends Error {
  constructor(existing: JobRequest) {
    super(
      `This worktree already has job ${existing.id} (${existing.type}) waiting in the queue. ` +
        `Wait for its report (scripts/bench-wait.sh ${existing.id}); if the tree has changed ` +
        `since, resubmit after it completes.`,
    );
    this.name = 'DuplicateJobError';
  }
}

export function newJobId(nowMs: number = Date.now()): string {
  // Epoch millis first: lexical order = deposit order for any plausible clock.
  return `job-${String(nowMs).padStart(14, '0')}-${crypto.randomBytes(3).toString('hex')}`;
}

export class Spool {
  /**
   * `log`: where an unwritable `jobsLog` becomes observable (see `appendJobsLog`).
   * Optional so every existing test construction (`new Spool(paths)`) keeps compiling;
   * production wiring always supplies one (worker.ts, cli.ts) — the same `log` the rest
   * of the worker already uses, not a second logging path.
   */
  constructor(
    private readonly paths: BenchPaths,
    private readonly log?: (line: string) => void,
  ) {}

  /**
   * Deposit a request. Refuses (DuplicateJobError) while an earlier request for the same
   * **subject** is still queued — the usual cause is a retry after an edit, and what the
   * session wants then is the newest tree tested once, not twice.
   *
   * The subject is the worktree *and*, for a `ref` job, the ref. Keying on the worktree
   * alone was right while every job tested a directory; since #158 stage C every gate is a
   * `ref` job run in the ONE shared checkout, so that rule would refuse every second
   * gate — and, worse, refuse a merge-queue entry whenever any session gate happened to be
   * queued. The entry would then never be gated, and GitHub would eject it on the
   * check-response timeout for a reason that had nothing to do with its code.
   */
  submit(request: Omit<JobRequest, 'id' | 'submittedAt'>, nowMs: number = Date.now()): JobRequest {
    const pending = this.queued().find(
      entry => entry.request.worktree === request.worktree && entry.request.ref === request.ref,
    );
    if (pending) throw new DuplicateJobError(pending.request);

    const full: JobRequest = {
      ...request,
      id: newJobId(nowMs),
      submittedAt: new Date(nowMs).toISOString(),
    };
    writeAtomically(path.join(this.paths.spool, `${full.id}.json`), full);
    return full;
  }

  /** Queued requests, oldest first. Unreadable files are skipped, not fatal. */
  queued(): { file: string; request: JobRequest }[] {
    return listJson<JobRequest>(this.paths.spool);
  }

  /** The claimed job, if any. */
  running(): { file: string; request: JobRequest }[] {
    return listJson<JobRequest>(this.paths.running);
  }

  /** Claim = rename into running/. Atomic; only the worker calls this. */
  claim(file: string): string {
    const target = path.join(this.paths.running, path.basename(file));
    fs.renameSync(file, target);
    return target;
  }

  /** Drop a spool entry without running it (dead submitter). */
  discard(file: string): void {
    fs.rmSync(file, { force: true });
  }

  finish(runningFile: string): void {
    fs.rmSync(runningFile, { force: true });
    fs.rmSync(releaseMarker(this.paths, path.basename(runningFile, '.json')), { force: true });
  }

  /**
   * Ask the worker to end a running lease early. A marker file, not a signal: the session
   * has no stable pid the worker could watch (every Bash tool call is its own shell), so
   * the release is explicit — `npm run dev:release` — or the lease simply expires.
   */
  requestRelease(id: string): void {
    fs.writeFileSync(releaseMarker(this.paths, id), `${Date.now()}\n`, 'utf8');
  }

  releaseRequested(id: string): boolean {
    return fs.existsSync(releaseMarker(this.paths, id));
  }

  writeReport(report: JobReport): string {
    const target = path.join(this.paths.done, `${report.id}.json`);
    writeAtomically(target, report);
    // After, not before: a jobsLog failure must never stop the report that IS the job's
    // evidence from landing in done/ (see appendJobsLog's doc comment — bookkeeping only).
    appendJobsLog(this.paths, report, this.log);
    return target;
  }

  readReport(id: string): JobReport | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.paths.done, `${id}.json`), 'utf8')) as JobReport;
    } catch {
      return null;
    }
  }

  /** A queued or running request still exists for this id (the wait loop's "be patient" signal). */
  isPending(id: string): boolean {
    return [...this.queued(), ...this.running()].some(entry => entry.request.id === id);
  }

  /**
   * Deletes `.log` files in `done/` older than maxAgeMs — build/test output, the one part
   * of a finished job that is both large (measured up to ~48 KB) and reproduces nothing a
   * reader needs once the job is old news. The `.json` report is left alone: it used to be
   * deleted right alongside the log, which is the entire reason DIRTY / ENVIRONMENT /
   * ABANDONED / INTERRUPTED were invisible in a 509-record corpus (action B4.2,
   * SPO-Pipeline/doc/bench-plan-derived-2026-09-02.md row 4.2) — `verdicts/` never records
   * a non-attesting verdict, and `done/` was the only place they existed at all. Its
   * content is now durable regardless (`appendJobsLog`, called from `writeReport` before
   * this ever runs), so leaving the `.json` in place is redundant-but-harmless rather than
   * load-bearing — but B3.4 in SPO-Pipeline reads `done/<jobId>.json` right after a gate,
   * and no longer racing a 24 h clock only makes that read safer.
   */
  purgeDone(maxAgeMs: number, nowMs: number = Date.now()): void {
    for (const name of safeReaddir(this.paths.done)) {
      if (!name.endsWith('.log')) continue;
      const file = path.join(this.paths.done, name);
      try {
        if (nowMs - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
      } catch {
        // A file deleted underneath us is already what we wanted.
      }
    }
  }
}

function releaseMarker(paths: BenchPaths, id: string): string {
  return path.join(paths.running, `${id}.release`);
}

function listJson<T>(dir: string): { file: string; request: T }[] {
  const out: { file: string; request: T }[] = [];
  for (const name of safeReaddir(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      out.push({ file, request: JSON.parse(fs.readFileSync(file, 'utf8')) as T });
    } catch {
      // Half-written or corrupt: skip. tmp-then-rename makes this near-impossible,
      // but a skipped entry is better than a wedged queue.
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function writeAtomically(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
}
