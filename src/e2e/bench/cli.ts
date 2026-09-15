/**
 * The bench client — what a session runs. Three commands:
 *
 * The default job type is `ref`: since #158 the bench gates a commit it FETCHES, so the
 * ordinary thing to ask for is "gate this sha", not "gate this directory".
 *
 *   submit --type=gate|live|lease|ref [--ref=<sha>] [--wait] [--timeout-min=N]
 *          [--lease-minutes=N] [flags…]
 *     Deposits a job for the CURRENT worktree (cwd) and returns immediately with the
 *     job id — unless --wait, which folds straight into the wait loop so the whole
 *     round trip is ONE background shell command for the session (zero tokens spent
 *     waiting). Unrecognized flags are forwarded verbatim to the job body, so
 *     `npm run gate -- --flows=login-spine` reaches verify-gate.js unchanged.
 *     A dead worker is reported HERE, at deposit time — exit 3, immediately. A gate on
 *     a tree with uncommitted changes is refused here too — exit 2: the attestation
 *     names a sha, so the tested tree must BE that sha.
 *
 *     `--type=ref --ref=<sha|branch>` is the odd one out: it names a commit on GitHub
 *     rather than this worktree, and the worker fetches it into a checkout of its own.
 *     The subject need not exist on this machine — which is the point (#158). Its answer
 *     goes to `ref/verdicts/` and is published as `bench/ref-gate`, beside the session
 *     path rather than on top of it.
 *
 *   wait <job-id> [--timeout-min=N]
 *     Sleeps until the report exists (exit 0 on PASS/LEASED, 1 otherwise), the worker
 *     dies (exit 3), or the timeout passes (exit 4).
 *
 *   release
 *     End the running lease held for the CURRENT worktree early (`npm run dev:release`).
 *
 *   status
 *     Worker liveness, the queue, and recent reports.
 *
 *   request-nightly --reason=<text> [--via=spo]
 *     Ask the worker to re-drive `origin/main`'s current tip. A MAINTAINER command, not a
 *     session one: it refuses inside a Claude Code session and refuses without a terminal,
 *     and it makes the human type the tip's first 8 characters back before it writes
 *     anything. It deposits nothing itself — it leaves a marker the worker's idle branch
 *     picks up, so the queue stays the one thing that decides when the live world is
 *     driven. This is the ONLY sanctioned way to ask for a nightly; `submit --type=nightly`
 *     is refused and stays refused.
 *
 * Exit codes: 0 ok · 1 job completed with a non-passing verdict, or a usage error ·
 * 2 refused at deposit (duplicate, a gate on a dirty tree, or a nightly request that was
 * not confirmed / not needed) · 3 worker down · 4 wait timeout · 5 a nightly request from
 * somewhere that may not make one (an agent session, or no terminal) · 6 `origin/main`'s
 * tip could not be read.
 *
 * Codes 5 and 6 are new in THIS namespace only. `scripts/board-move.sh`'s own exit 5 and
 * `verify-gate.js`'s 0–3 are separate namespaces — see doc/bench-worker.md.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import { toErrorMessage } from '../../shared/error-utils';
import {
  benchPaths,
  ensureLayout,
  heartbeatAgeMs,
  workerStatus,
  type BenchPaths,
} from './paths';
import { fingerprintTree, type TreeFingerprint } from './fingerprint';
import {
  DuplicateJobError,
  Spool,
  type JobReport,
  type JobType,
  type ManualRequester,
} from './job';
import {
  manualRequestFile,
  nightlyResultFile,
  readManualRecords,
  readManualRequest,
  readNightlyResult,
  type ManualRequest,
} from './nightly';

export interface CliDeps {
  paths: BenchPaths;
  spool: Spool;
  fingerprint: (worktree: string) => TreeFingerprint;
  git: (args: string[]) => string;
  workerAlive: () => { alive: boolean; reason?: string };
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pid: number;
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** stdin AND stdout are both a TTY — a human is on the other end of both directions. */
  isInteractive: () => boolean;
  /** One line from the human, or null on EOF. */
  promptLine: (question: string) => Promise<string | null>;
  /** Who is asking: username, hostname, tty path ('unknown' when unreadable). */
  requesterIdentity: () => { user: string; host: string; tty: string };
}

export function realCliDeps(): CliDeps {
  const paths = benchPaths();
  return {
    paths,
    spool: new Spool(paths),
    fingerprint: fingerprintTree,
    git: args => execFileSync('git', args, { encoding: 'utf8' }).trim(),
    workerAlive: () => workerStatus(paths),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    pid: process.pid,
    out: line => process.stdout.write(`${line}\n`),
    err: line => process.stderr.write(`${line}\n`),
    env: process.env,
    isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    promptLine: askOnce,
    requesterIdentity: () => ({
      user: os.userInfo().username,
      host: os.hostname(),
      tty: readTty(),
    }),
  };
}

/** The controlling terminal, or 'unknown' — never a throw, it is only ever provenance. */
function readTty(): string {
  try {
    return fs.readlinkSync('/proc/self/fd/0');
  } catch {
    return 'unknown';
  }
}

/* istanbul ignore next -- needs a real terminal; every caller is tested with an injected promptLine */
function askOnce(question: string): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string | null>(resolve => {
    rl.question(question, answer => resolve(answer));
    rl.on('close', () => resolve(null));
  }).finally(() => rl.close());
}

const DEFAULT_WAIT_TIMEOUT_MIN = 120;

interface ParsedArgs {
  command: string;
  positional: string[];
  known: Map<string, string>;
  passthrough: string[];
}

// `reason` and `via` MUST be here: an unrecognised flag falls into `passthrough` and is
// forwarded to a job body, so leaving them out would make `--reason=…` silently vanish.
const KNOWN_FLAGS = new Set(['type', 'wait', 'timeout-min', 'lease-minutes', 'ref', 'reason', 'via']);

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = '', ...rest] = argv;
  const known = new Map<string, string>();
  const passthrough: string[] = [];
  const positional: string[] = [];
  for (const arg of rest) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) {
      positional.push(arg);
    } else if (KNOWN_FLAGS.has(match[1])) {
      known.set(match[1], match[2] ?? 'true');
    } else {
      passthrough.push(arg);
    }
  }
  return { command, positional, known, passthrough };
}

export async function main(argv: string[], deps: CliDeps = realCliDeps()): Promise<number> {
  ensureLayout(deps.paths);
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case 'submit':
      return submit(parsed, deps);
    case 'wait': {
      const id = parsed.positional[0];
      if (!id) {
        deps.err('usage: wait <job-id> [--timeout-min=N]');
        return 1;
      }
      return wait(id, timeoutMin(parsed), deps);
    }
    case 'release':
      return release(deps);
    case 'status':
      return status(deps);
    case 'request-nightly':
      return requestNightly(parsed, deps);
    default:
      deps.err(
        `unknown command "${parsed.command}" — expected submit, wait, release, status or request-nightly`,
      );
      return 1;
  }
}

function timeoutMin(parsed: ParsedArgs): number {
  const raw = Number(parsed.known.get('timeout-min'));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WAIT_TIMEOUT_MIN;
}

async function submit(parsed: ParsedArgs, deps: CliDeps): Promise<number> {
  const type = (parsed.known.get('type') ?? 'ref') as JobType;
  // `nightly` is deliberately absent and stays absent. A nightly is deposited by the
  // worker's own idle branch and nowhere else, so "when the queue is idle" is honoured by
  // the only thing that can honour it. A human who needs one asks for it with
  // `request-nightly`, which leaves a marker the worker picks up — it still does not
  // deposit a job from here.
  if (!['live', 'lease', 'ref'].includes(type)) {
    deps.err(`unknown job type "${type}" — expected ref, live or lease`);
    if (type === 'nightly') {
      deps.err('a nightly is the worker\'s to deposit — ask for one with: npm run bench:nightly-request -- --reason="…"');
    }
    return 1;
  }

  // A dead worker is announced NOW, not after the session has waited on nothing.
  const worker = deps.workerAlive();
  if (!worker.alive) {
    // Also on stdout: a caller that captures only stdout (the pipeline's park detail) must be
    // able to record WHICH branch of workerStatus fired, not just `{"exit": 3}`.
    deps.out(`worker-down: ${worker.reason ?? 'unknown'}`);
    deps.err(`WORKER DOWN: ${worker.reason ?? 'unknown'}`);
    deps.err('The bench worker is not running. Fix it first:');
    deps.err('  systemctl --user status spo-bench-worker    # why it stopped');
    deps.err('  systemctl --user restart spo-bench-worker   # bring it back');
    deps.err('  scripts/bench-install.sh                    # first-time setup');
    return 3;
  }

  let worktree: string;
  let branch: string;
  let head: string;
  try {
    worktree = deps.git(['rev-parse', '--show-toplevel']);
    branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    head = deps.git(['rev-parse', 'HEAD']);
  } catch (err: unknown) {
    deps.err(`not inside a git worktree: ${toErrorMessage(err)}`);
    return 1;
  }

  // A ref job names a commit. Defaulting to HEAD keeps a bare `submit` meaningful and
  // matches what `npm run gate` asks for; the push check lives in scripts/bench-gate.sh,
  // and a sha origin does not have simply fails the fetch — loudly, as ENVIRONMENT.
  const ref = parsed.known.get('ref') ?? head;

  // A ref job is about a commit on GitHub, not about this worktree. The subject does not
  // exist on this machine until the worker fetches it, so there is nothing here to
  // fingerprint — the placeholder below just names the ref. `worker.ts`'s atStart/atEnd
  // staleness check still runs against the WORKER's own checkout after it fetches and
  // resets to this ref; it does not, and cannot, compare against this placeholder (B2.5 —
  // a field that once claimed otherwise, `fingerprintStable`, was removed because it was
  // true in the whole corpus (518 verdicts on file as of 2026-09-03; it only grows) and
  // could not be made false for a `ref` job).
  const fingerprint =
    type === 'ref' ? { head: ref as string, hash: `ref:${ref}`, clean: true } : deps.fingerprint(worktree);
  let request;
  try {
    request = deps.spool.submit(
      {
        type,
        // The worker's own checkout, not this one: a ref job's tree is fetched, and the
        // session that deposited it may not even be on the worker's machine.
        worktree: type === 'ref' ? deps.paths.refCheckout : worktree,
        branch: type === 'ref' ? (ref as string) : branch,
        fingerprint,
        // With --wait this process stays alive until the report lands, so the worker can
        // tell a dead session from a queued one. Without it there is nobody to watch.
        submitter: { pid: parsed.known.has('wait') ? deps.pid : 0 },
        args: parsed.passthrough,
        ...(type === 'lease' ? { leaseMinutes: leaseMinutes(parsed) } : {}),
        ...(type === 'ref' ? { ref } : {}),
      },
      deps.now(),
    );
  } catch (err: unknown) {
    if (err instanceof DuplicateJobError) {
      deps.err(err.message);
      return 2;
    }
    throw err;
  }

  const queueDepth = deps.spool.queued().length + deps.spool.running().length;
  deps.out(`job ${request.id} queued (${type}, position ${queueDepth})`);
  deps.out(`report will land in ${deps.paths.done}/${request.id}.json`);

  if (parsed.known.has('wait')) return wait(request.id, timeoutMin(parsed), deps);
  deps.out(`wait with:  bash scripts/bench-wait.sh ${request.id}`);
  return 0;
}

function leaseMinutes(parsed: ParsedArgs): number {
  const raw = Number(parsed.known.get('lease-minutes'));
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

async function wait(id: string, timeoutMinutes: number, deps: CliDeps): Promise<number> {
  const deadline = deps.now() + timeoutMinutes * 60_000;
  for (;;) {
    const report = deps.spool.readReport(id);
    if (report) {
      deps.out(formatReport(report));
      return report.verdict === 'PASS' || report.verdict === 'LEASED' ? 0 : 1;
    }
    const worker = deps.workerAlive();
    if (!worker.alive) {
      deps.out(`worker-down: ${worker.reason ?? 'unknown'}`);
      deps.err(`WORKER DIED while job ${id} was pending: ${worker.reason ?? 'unknown'}`);
      deps.err('The queue is preserved; restart the worker and it will resume:');
      deps.err('  systemctl --user restart spo-bench-worker');
      return 3;
    }
    if (deps.now() > deadline) {
      deps.err(`timed out after ${timeoutMinutes} min waiting for job ${id} (still queued or running)`);
      return 4;
    }
    await deps.sleep(2_000);
  }
}

export function formatReport(report: JobReport): string {
  const lines = [
    `=== bench job ${report.id} — ${report.verdict}`,
    `  type ${report.type} · branch ${report.branch}`,
    `  worktree ${report.worktree}`,
  ];
  if (report.detail) lines.push(`  ${report.detail}`);
  if (report.targetMoved) {
    lines.push('  ! the tree CHANGED during the run — this result does not attest the current tree');
  }
  if (report.type === 'lease' && report.leaseUntil) {
    lines.push(`  gateway on port ${report.port} until ${report.leaseUntil}`);
  }
  if (report.baseMain) lines.push(`  gated against main ${report.baseMain.slice(0, 8)}`);
  if (report.gateArtifact) lines.push(`  gate artifact: ${report.gateArtifact}`);
  if (report.logFile) lines.push(`  full log: ${report.logFile}`);
  return lines.join('\n');
}

async function release(deps: CliDeps): Promise<number> {
  let worktree: string;
  try {
    worktree = deps.git(['rev-parse', '--show-toplevel']);
  } catch (err: unknown) {
    deps.err(`not inside a git worktree: ${toErrorMessage(err)}`);
    return 1;
  }
  const lease = deps.spool
    .running()
    .find(entry => entry.request.type === 'lease' && entry.request.worktree === worktree);
  if (!lease) {
    deps.err(`no running lease for ${worktree} — nothing to release`);
    return 1;
  }
  deps.spool.requestRelease(lease.request.id);
  deps.out(`release requested for lease ${lease.request.id}; the worker tears the gateway down within seconds`);
  return 0;
}

async function status(deps: CliDeps): Promise<number> {
  const worker = deps.workerAlive();
  const age = heartbeatAgeMs(deps.paths, deps.now());
  deps.out(
    worker.alive
      ? `worker ALIVE (heartbeat ${age === null ? '?' : Math.round(age / 1000)} s ago)`
      : `worker DOWN — ${worker.reason ?? 'unknown'}`,
  );
  for (const { request } of deps.spool.running()) {
    deps.out(`  running: ${request.id} (${request.type}) ${request.worktree} [${request.branch}]`);
  }
  const queued = deps.spool.queued();
  deps.out(`  queued: ${queued.length}`);
  for (const { request } of queued) {
    deps.out(
      `    ${request.id} (${request.type}${nightlyTriggerSuffix(request.type, request.trigger)}) ${request.worktree} [${request.branch}]`,
    );
  }
  // `deps.err`, not a no-op: this read DISCARDS a marker it cannot trust (same rule as the
  // worker's own read), and a deletion nobody is told about is the worst kind.
  const pendingRequest = readManualRequest(deps.paths, line => deps.err(line));
  if (pendingRequest) {
    deps.out(
      `  manual request pending: ${pendingRequest.sha} by ${pendingRequest.requestedBy.user}`,
    );
  }
  return worker.alive ? 0 : 3;
}

/** ", manual" on a nightly that is one; nothing at all on any other job. */
function nightlyTriggerSuffix(type: JobType, trigger: string | undefined): string {
  return type === 'nightly' ? `, ${trigger ?? 'scheduled'}` : '';
}

/** A 40-hex commit sha and nothing looser — the tip the human confirms must be exact. */
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * `request-nightly` — ask the worker to re-drive `origin/main`'s current tip.
 *
 * This exists for one situation: a nightly that recorded `FAIL` for a reason that was not
 * the code (on 2026-09-13, twelve `connect ETIMEDOUT` lines against the live server), which
 * then sticks to that tip until somebody pushes a commit — and parks every card on the
 * board in the meantime. `nightlyDue` is right to refuse to re-run a sha it has already
 * measured; `main` is immutable at a sha. What was missing was a way for a human who has
 * read the log to say "measure that same tip again".
 *
 * It refuses an agent (`CLAUDECODE`) and refuses a pipe, because asking for one is asking
 * past [kanban-workflow.md § While `main` is red] rule 1 — the judgement that a red is not
 * the code is a maintainer's to make, at a real terminal, having read the log.
 *
 * It writes a marker and nothing else. The worker's idle branch deposits the job, so a
 * manual proof waits behind every queued session exactly as the scheduled one does.
 */
async function requestNightly(parsed: ParsedArgs, deps: CliDeps): Promise<number> {
  if (deps.env.CLAUDECODE) {
    deps.err(
      'refused: running inside a Claude Code session — a nightly proof is a maintainer decision ' +
        '(doc/kanban-workflow.md § While `main` is red)',
    );
    return 5;
  }
  if (!deps.isInteractive()) {
    deps.err('refused: needs a terminal — this command confirms a sha with a human before it drives the live world');
    return 5;
  }

  const reason = (parsed.known.get('reason') ?? '').trim();
  if (!reason) {
    deps.err('usage: request-nightly --reason="why this red is not the code" [--via=spo]');
    return 1;
  }
  const via = parsed.known.get('via') ?? 'bench-cli';
  if (via !== 'bench-cli' && via !== 'spo') {
    deps.err(`unknown --via "${via}" — expected spo (it is a label; it grants nothing)`);
    return 1;
  }

  const worker = deps.workerAlive();
  if (!worker.alive) {
    deps.out(`worker-down: ${worker.reason ?? 'unknown'}`);
    deps.err(`WORKER DOWN: ${worker.reason ?? 'unknown'}`);
    deps.err('The bench worker is not running. Fix it first:');
    deps.err('  systemctl --user status spo-bench-worker    # why it stopped');
    deps.err('  systemctl --user restart spo-bench-worker   # bring it back');
    deps.err('  scripts/bench-install.sh                    # first-time setup');
    return 3;
  }

  // The one network read this command makes, and it is read-only: it touches no checkout.
  // It is what makes the confirmed sha the REAL tip rather than the worker's local ref,
  // which may be hours behind — confirming a stale sha would ask for the wrong proof.
  let tip: string;
  try {
    tip = (deps.git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] ?? '').toLowerCase();
  } catch (err: unknown) {
    deps.err(`could not read origin/main: ${toErrorMessage(err)}`);
    return 6;
  }
  if (!SHA_RE.test(tip)) {
    deps.err(`could not read origin/main: git ls-remote answered "${tip}", not a commit sha`);
    return 6;
  }

  const latest = readNightlyResult(deps.paths);
  if (latest?.verdict === 'PASS' && latest.sha === tip) {
    deps.err(`already green at ${tip} — nothing to re-prove`);
    return 2;
  }

  const existing = readManualRequest(deps.paths, line => deps.err(line));
  if (existing) {
    deps.err(
      `a manual request is already on file: ${existing.sha} by ${existing.requestedBy.user} at ${existing.requestedBy.requestedAt}`,
    );
    deps.err('the worker takes it on its next idle tick; delete it only if you know it is stale');
    return 2;
  }

  const alreadyQueued = [...deps.spool.queued(), ...deps.spool.running()].find(
    entry => entry.request.type === 'nightly' && entry.request.fingerprint.head === tip,
  );
  if (alreadyQueued) {
    deps.err(`a nightly already targets ${tip}: ${alreadyQueued.request.id} — wait for it`);
    return 2;
  }

  deps.out(`origin/main is at ${tip}`);
  deps.out(
    latest
      ? `  on file: ${latest.verdict} (${latest.trigger ?? 'scheduled'}) for ${latest.sha ?? '(no sha)'} at ${latest.finishedAt ?? '?'}`
      : '  on file: nothing — no nightly has ever been recorded',
  );
  if (latest?.detail) deps.out(`  detail: ${latest.detail}`);
  if (latest?.logFile) deps.out(`  log: ${latest.logFile}`);
  for (const record of readManualRecords(deps.paths).filter(r => r.requestedSha === tip)) {
    deps.out(
      `  earlier manual proof of this tip: ${record.id} — ${record.verdict}${record.outcome ? ` (${record.outcome})` : ''}, attested ${record.attested}`,
    );
  }
  deps.out('This drives the live world on the locked account, through the queue, the next time it is idle.');

  const answer = await deps.promptLine(`type the first 8 characters of ${tip} to confirm: `);
  if (answer === null || answer.trim().toLowerCase() !== tip.slice(0, 8)) {
    deps.err('not confirmed — nothing was written');
    return 2;
  }

  const request: ManualRequest = {
    sha: tip,
    requestedBy: {
      ...deps.requesterIdentity(),
      via,
      reason,
      requestedAt: new Date(deps.now()).toISOString(),
    } satisfies ManualRequester,
  };
  const target = manualRequestFile(deps.paths);
  const tmp = `${target}.tmp-${deps.pid}`;
  try {
    fs.mkdirSync(deps.paths.nightly, { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    // link(2), not rename(2): rename would silently clobber a request another terminal
    // wrote in the last few milliseconds. EEXIST is the answer we want — the other one won.
    fs.linkSync(tmp, target);
  } catch (err: unknown) {
    deps.err(`could not file the request: ${toErrorMessage(err)}`);
    return 2;
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  deps.out(`requested: the worker will drive main ${tip} on its next idle tick`);
  deps.out(`the result lands in ${nightlyResultFile(deps.paths)} (only if it actually measures this sha)`);
  deps.out(`every outcome, attested or not, is recorded under ${deps.paths.nightly}/manual/`);
  return 0;
}

/* istanbul ignore next -- thin entry point; main() is tested with injected deps */
if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${toErrorMessage(err)}\n`);
      process.exit(1);
    });
}
