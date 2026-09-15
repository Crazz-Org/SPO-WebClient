/**
 * The bench root — one fixed directory for the whole machine, outside every worktree.
 *
 * Everything the worker and its clients share lives here: the spool (sessions drop job
 * requests), the running slot, the reports, the per-HEAD attestations the push hook
 * reads, the shared world state, and the heartbeat whose CONTENT — JSON since action
 * B5.2 (see HeartbeatContent below: writtenAt plus currentJob/startedAt), a bare epoch
 * ms before it — not the file's mtime, is the worker's sign of life (action B5.3: mtime
 * can be preserved by a `cp -p`-style copy, or bumped by an unrelated touch that writes
 * nothing; content is the one signal the writer actually controls).
 * It sits under $HOME (ext4), never under /mnt/c (DrvFs rename semantics) and
 * never in a session scratchpad (per-session, shares nothing).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BenchPaths {
  root: string;
  /** Sessions drop job requests here; filename order is queue order. */
  spool: string;
  /** The one claimed job — a file here means a job is executing. */
  running: string;
  /**
   * Job reports (`<id>.json`) and per-job build/test output (`<id>.log`). Only the `.log`
   * is purged (24 h, `purgeDone` in ./job) — the `.json` is left alone, and every job's
   * outcome is ALSO appended as one line to `jobsLog` the moment its report is written, so
   * neither a purge nor a `rm -rf done/` loses the answer. See `jobsLog` below and action
   * B4.2 (SPO-Pipeline/doc/bench-plan-derived-2026-09-02.md).
   */
  done: string;
  /** Per-HEAD gate attestations — what `.claude/hooks/pre-push-gate.sh` reads. */
  verdicts: string;
  /** Shared world lock / dirty flag / run history (see WORLD_STATE_DIR in ../config). */
  world: string;
  /**
   * The asset mirror every job's gateway reads, shared by every worktree on the machine.
   * Those ~570 files are identical in every checkout, so a per-worktree copy made each
   * new branch re-download the lot on the bench's exclusive time. Jobs are serialised,
   * so the one writer at a time this directory assumes is guaranteed by the queue.
   */
  cache: string;
  /**
   * The nightly proof of `main`: the worker-owned checkout it drives and the result it
   * publishes. Outside every session's worktree because no session owns it — see ./nightly.
   */
  nightly: string;
  /**
   * The checkout the worker fetches a `ref` job into — a pushed branch head, a merge
   * queue's speculative commit. Separate from `nightly/checkout` so a gate never has to
   * wait for, or disturb, the nightly's copy of `main`. See ./checkout.
   */
  refCheckout: string;
  /**
   * Written every few seconds by the worker; its CONTENT (the epoch ms it wrote, see
   * touchHeartbeat/heartbeatAgeMs) is the liveness signal, not its mtime.
   */
  heartbeat: string;
  /** Who the worker is: pid, repo it runs from, port it owns. */
  workerFile: string;
  /**
   * One durable JSON line per finished job (id, type, deposited sha, verdict, detail,
   * timestamps — see `JobsLogLine` in ./job), appended by `Spool.writeReport` and never
   * rewritten, reordered, or purged. `done/` answers "what happened to a job I just ran";
   * this file answers "what has ever happened", including the non-attesting verdicts
   * (DIRTY, ENVIRONMENT, ABANDONED, INTERRUPTED) that `verdicts/` never records and
   * `done/` used to lose after 24 h (action B4.2, SPO-Pipeline/doc/bench-plan-derived-2026-09-02.md
   * row 4.2). One line runs a few hundred bytes; at the bench's observed rate (tens of
   * jobs/day) that is single-digit MB per year — see job.ts's doc comment on
   * `appendJobsLog` for the measured figures and why no rotation is built here.
   */
  jobsLog: string;
}

/** Heartbeat older than this = the worker is not running, whatever systemd believes. */
export const HEARTBEAT_STALE_MS = 20_000;

/** How often the worker touches the heartbeat. */
export const HEARTBEAT_PERIOD_MS = 5_000;

/** The port the worker owns. Nothing else on this machine may listen on it. */
export const BENCH_PORT = 8080;

// `env` defaults to the real `process.env` for every production call site (every existing
// caller passes nothing, so the default keeps behaviour identical). A test asserting the
// UNSET-var default is the one caller with a reason to pass something else: injecting a
// throwaway object — `benchRoot({})` — proves the same fallback computation
// (`os.homedir()`-based; `os.homedir()` itself does no I/O) without ever touching or mutating
// the real `process.env.SPO_BENCH_DIR`. See paths.test.ts.
export function benchRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPO_BENCH_DIR || path.join(os.homedir(), '.spo-bench');
}

export function benchPaths(root: string = benchRoot()): BenchPaths {
  return {
    root,
    spool: path.join(root, 'spool'),
    running: path.join(root, 'running'),
    done: path.join(root, 'done'),
    verdicts: path.join(root, 'verdicts'),
    world: path.join(root, 'world'),
    cache: path.join(root, 'cache'),
    nightly: path.join(root, 'nightly'),
    refCheckout: path.join(root, 'ref', 'checkout'),
    heartbeat: path.join(root, 'heartbeat'),
    workerFile: path.join(root, 'worker.json'),
    jobsLog: path.join(root, 'jobs.jsonl'),
  };
}

export function ensureLayout(paths: BenchPaths): void {
  const dirs = [
    paths.root,
    paths.spool,
    paths.running,
    paths.done,
    paths.verdicts,
    paths.world,
    paths.cache,
    paths.nightly,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export interface WorkerInfo {
  pid: number;
  startedAt: string;
  /** The checkout the worker's own code runs from (not the worktree under test). */
  repo: string;
  port: number;
}

export function writeWorkerInfo(paths: BenchPaths, info: WorkerInfo): void {
  fs.writeFileSync(paths.workerFile, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

export function readWorkerInfo(paths: BenchPaths): WorkerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(paths.workerFile, 'utf8')) as WorkerInfo;
  } catch {
    return null;
  }
}

/**
 * The job the worker is executing right now, for the heartbeat to carry — action B5.2.
 * `id` is the `JobRequest.id`; `startedAt` is when THIS job began executing (the claim, not
 * the deposit — a job can sit queued for a while before it is picked up, and "how long has
 * the worker been on this" must measure from execution, not from the queue).
 */
export interface CurrentJob {
  id: string;
  startedAt: string;
}

/**
 * What the heartbeat file's content actually is, since action B5.2: a fresh epoch-ms clock
 * tick (`writtenAt` — everything `heartbeatAgeMs` ever measured) plus which job, if any, the
 * worker is executing right now.
 *
 * Before B5.2 the heartbeat carried only a bare epoch-ms number, written on its own
 * `setInterval` (worker.ts) deliberately independent of the work loop — so a worker wedged
 * mid-job kept beating exactly like an idle one, and the ONE thing the heartbeat could say
 * ("this process is still scheduling timers") was mistaken for "this worker is fine".
 * `currentJob`/`startedAt` let a reader tell ALIVE (currentJob null: the worker is up and has
 * nothing to do) from PROGRESSING (currentJob set: the worker is up AND has been on this exact
 * job since `startedAt` — a client that also knows the job's own stage deadlines, see worker.ts's
 * VERIFY_GATE_DEADLINE_MS and friends, can tell a long-but-normal drive from one that has
 * outrun every bound the worker itself would have killed it at).
 *
 * `currentJob` is set and cleared from the SAME place — `processOldest`'s claim/finish
 * boundary in worker.ts — rather than written once at job start and left alone: a heartbeat
 * that never clears `currentJob` would make a worker that finished ten minutes ago, and has
 * been idle since, read as still busy on its last job forever. See worker.ts's own comment at
 * the `currentJob` field of `WorkerDeps` for exactly where it is set and cleared.
 */
export interface HeartbeatContent {
  /** Epoch ms this beat was written — the staleness clock; the one thing this file always
   *  carried, unchanged in meaning by B5.2. */
  writtenAt: number;
  /** The job id the worker is currently executing, or null when idle. */
  currentJob: string | null;
  /** ISO timestamp `currentJob` started executing, or null when idle. */
  startedAt: string | null;
}

/**
 * Write a fresh heartbeat: `writtenAt` is always `Date.now()`; `current` (undefined/null when
 * idle) supplies `currentJob`/`startedAt`. Called from worker.ts's own `setInterval`, still
 * deliberately independent of the work loop (see that file's comment) — this only changes
 * WHAT gets written each beat, not the fact that it rides its own timer.
 *
 * The write is atomic: it lands in a temp file beside the target and `fs.renameSync`s it into
 * place. `fs.writeFileSync` on the live path directly would truncate-then-write, leaving a
 * window where the file on disk is empty; a reader landing in that window used to see `''`, and
 * readHeartbeat's legacy bare-number fallback turned that into a beat from epoch zero. A rename
 * is atomic within one filesystem, so a reader always sees either the previous beat or this one.
 */
export function touchHeartbeat(paths: BenchPaths, current?: CurrentJob | null): void {
  const content: HeartbeatContent = {
    writtenAt: Date.now(),
    currentJob: current?.id ?? null,
    startedAt: current?.startedAt ?? null,
  };
  // The temp file sits beside the target, never in /tmp: rename is only atomic WITHIN one
  // filesystem, and the bench root may be a different mount from the system temp dir. Per-pid
  // and reused every beat, not per-beat-unique — a crash mid-write leaves at most one stale
  // heartbeat.<pid>.tmp, which the next beat of that pid overwrites.
  const tmpFile = `${paths.heartbeat}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(content)}\n`, 'utf8');
  fs.renameSync(tmpFile, paths.heartbeat);
}

/**
 * Read the heartbeat file's content back, or null when it is absent or unparseable as either
 * shape below.
 *
 * Tries the current JSON shape (`HeartbeatContent`) first; falls back to the pre-B5.2 bare
 * epoch-ms number (`currentJob`/`startedAt` read as absent) so a worker mid-upgrade — the old
 * binary's last beat still on disk for up to one `HEARTBEAT_PERIOD_MS` after the new one
 * starts — does not read as dead for that one tick. Genuinely corrupt content (neither shape
 * parses to a finite timestamp) returns null, same as an absent file always has. Empty or
 * whitespace-only content also returns null, rather than falling into the legacy branch —
 * `Number('')` is `0`, which `Number.isFinite` accepts, so without this guard an empty file
 * would read as a beat from 1970.
 */
export function readHeartbeat(paths: BenchPaths): HeartbeatContent | null {
  let raw: string;
  try {
    raw = fs.readFileSync(paths.heartbeat, 'utf8').trim();
  } catch {
    return null;
  }
  // Must come BEFORE either branch below: `''` is not an object, so it falls through to the
  // legacy bare-number branch, and `Number('')` is 0 — which `Number.isFinite` accepts. `raw` is
  // already trimmed, so this covers a whitespace-only file too.
  if (raw === '') return null;
  // A bare number (the legacy pre-B5.2 shape) is itself valid JSON — `JSON.parse("123")` is
  // `123`, not a parse failure — so a `try/catch` around JSON.parse alone cannot tell the two
  // shapes apart: it would "succeed" into a number with no `.writtenAt` to read. The object
  // check below is what actually distinguishes them; legacy content falls through to the
  // plain-number branch afterwards, exactly like malformed JSON does.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const candidate = parsed as Partial<HeartbeatContent>;
    const writtenAt = Number(candidate.writtenAt);
    if (!Number.isFinite(writtenAt)) return null;
    return {
      writtenAt,
      currentJob: typeof candidate.currentJob === 'string' ? candidate.currentJob : null,
      startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : null,
    };
  }
  // Legacy bare-number heartbeat (pre-B5.2), or genuinely corrupt content — either way there
  // is no currentJob/startedAt to recover, only (maybe) a timestamp.
  const writtenAt = Number(raw);
  if (!Number.isFinite(writtenAt)) return null;
  return { writtenAt, currentJob: null, startedAt: null };
}

/**
 * Milliseconds since the last heartbeat, or null when there has never been one (the file is
 * absent) or its content isn't a parseable timestamp.
 *
 * Reads by CONTENT — the epoch ms touchHeartbeat wrote — never by the file's mtime (action
 * B5.3, replacing an earlier mtime-based read). mtime is not a safe proxy for "the worker wrote
 * this recently": a `cp -p`-style copy preserves the SOURCE's old mtime on a byte-identical
 * fresh copy, and an unrelated touch (a backup pass, a filesystem re-sync) can bump mtime with
 * no write at all. Content has neither failure mode, because touchHeartbeat writes a fresh
 * epoch ms on every single beat — see paths.test.ts's two heartbeat/mtime-divergence cases for
 * both directions pinned directly.
 *
 * console/collect.js in the sibling SPO-Pipeline repo reads this SAME file by content too (it
 * always did); this function used to be the odd one out. HEARTBEAT_STALE_MS itself is
 * unchanged by this action — see this file's own const above. Since B5.2 the content is JSON
 * (see HeartbeatContent); this function is now a thin wrapper over readHeartbeat that keeps its
 * own signature — `number | null`, unrelated to the job fields — exactly as every existing
 * caller (cli.ts, workerStatus below) already expects.
 */
export function heartbeatAgeMs(paths: BenchPaths, nowMs: number = Date.now()): number | null {
  const beat = readHeartbeat(paths);
  return beat === null ? null : nowMs - beat.writtenAt;
}

export interface WorkerStatus {
  alive: boolean;
  /** Human-readable reason when not alive; undefined when alive. */
  reason?: string;
  info: WorkerInfo | null;
}

/**
 * The check a submitter runs BEFORE queuing: a dead worker must be known at deposit
 * time, not discovered after twenty minutes of waiting. Two signals, because they catch
 * different failures: the pid says the process exists, the heartbeat says its loop is
 * actually turning (a worker wedged in a crash-restart cycle has a pid but a frozen
 * heartbeat).
 */
export function workerStatus(
  paths: BenchPaths,
  nowMs: number = Date.now(),
  isAlive: (pid: number) => boolean = processAlive,
): WorkerStatus {
  const info = readWorkerInfo(paths);
  if (!info) {
    return { alive: false, reason: 'no worker registered — run scripts/bench-install.sh', info: null };
  }
  if (!isAlive(info.pid)) {
    return { alive: false, reason: `worker pid ${info.pid} is not running`, info };
  }
  const age = heartbeatAgeMs(paths, nowMs);
  if (age === null) {
    return { alive: false, reason: 'worker has never heartbeat', info };
  }
  if (age > HEARTBEAT_STALE_MS) {
    return { alive: false, reason: `heartbeat is ${Math.round(age / 1000)} s old (limit ${HEARTBEAT_STALE_MS / 1000} s)`, info };
  }
  return { alive: true, info };
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
