/**
 * A worker-owned checkout, brought to an arbitrary ref.
 *
 * The bench has always tested **the depositing session's worktree**: the worker builds
 * whatever is on disk at a path the session named. That is the coupling #158 removes —
 * it is the only reason a session has to live on this machine, and the reason GitHub's
 * merge queue is unusable, since a speculative merge commit exists only on GitHub and
 * never in anybody's worktree.
 *
 * The input was already a commit: a `gate` job refuses a dirty tree, so the tree it tests
 * *is* HEAD. Replacing the worktree with a fetch changes the transport, not what is proven.
 *
 * #157 built the first instance of this for the nightly proof of `main`. This module is
 * that machinery with the target made a parameter, so one implementation serves the
 * nightly, a pushed branch head, and — the point of the exercise — a
 * `gh-readonly-queue/...` ref that exists nowhere but on GitHub.
 *
 * **Why a clone and not a `git worktree`.** Two reasons, both load-bearing:
 * `scripts/finish.sh` scans and reaps worktrees on its own schedule, and the worker must
 * not be something `finish` can delete underneath a running job; and the worker executes
 * `dist/e2e/bench/worker.js` *from* its own repo, so building a fetched ref there would
 * overwrite the running worker's code mid-flight.
 *
 * **Why the install is conditional.** `npm ci` is not a no-op: it deletes `node_modules`
 * and reinstalls from scratch, every time. The nightly could afford that — nobody waits
 * for it. A gate cannot: it is the serialised bench, and a full install would be paid by
 * every job to protect against a lockfile that changes a few times a month. So the
 * lockfile's own hash is recorded next to the checkout after each successful install, and
 * `npm ci` runs only when it differs — or when `node_modules` is simply not there.
 *
 * Session worktrees never needed any of this, and that is worth stating because it is not
 * obvious: they sit *inside* the main checkout (`.claude/worktrees/<name>`), so Node's
 * upward resolution finds `/home/<user>/SPO-WebClient/node_modules` and every worktree
 * silently borrows it. A checkout fetched from GitHub has no parent to borrow from.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../../shared/error-utils';
import { resolveRef, type GitRunner } from './fingerprint';
import { type GitAuthEnv } from './git-auth';

export interface CheckoutCommandOptions {
  cwd: string;
  env?: Record<string, string>;
  logFile: string;
}

/** Exactly what preparing a checkout needs; WorkerDeps satisfies it structurally. */
export interface CheckoutDeps {
  runCommand: (cmd: string, args: string[], options: CheckoutCommandOptions) => Promise<number>;
  now: () => number;
  log: (line: string) => void;
  /** Waits between attempts at a network step. Injected so tests do not really wait. */
  sleep: (ms: number) => Promise<void>;
  /**
   * The environment that makes git authenticate to github.com — see ./git-auth. A
   * dependency rather than a direct call so a test can prove the clone and the fetch carry
   * it, and prove that nothing else does.
   */
  gitAuthEnv: () => GitAuthEnv;
}

export interface PrepareRequest {
  /** Absolute path of the checkout directory; created by cloning when absent. */
  dir: string;
  /** What to reset to: `origin/main`, a sha, `origin/<branch>`. */
  ref: string;
  /** A repo that already has the origin remote, to read the clone URL from. */
  workerRepo: string;
  logFile: string;
  /**
   * When set, gate the tree GitHub will actually land, not the branch alone: after the
   * reset, this ref is merged in — unless `ref` already contains it, the common case,
   * answered by one `git merge-base --is-ancestor` (~35 s all told, no merge). See
   * doc/bench-worker.md § The gate base.
   */
  mergeRef?: string;
}

/** What preparing a checkout concluded. */
export interface PrepareResult {
  /** Name of the failed step, or null on success. */
  failed: string | null;
  /**
   * Set only when `failed === 'merge'`: the sha `mergeRef` resolved to, that the checkout
   * could not be merged with. `git merge --abort` has already run by the time this comes
   * back — the checkout is at `ref` again, clean, ready for the next job.
   */
  conflictBase?: string;
  /**
   * True when an actual merge commit was created — `ref` did not already contain
   * `mergeRef`. A caller that skips work on a CI record for the pre-merge sha must not do
   * so when this is true: CI never saw the merged tree. See worker.ts.
   */
  merged?: boolean;
}

/** Where the hash of the lockfile that the current `node_modules` was built from lives. */
export function installedLockFile(dir: string): string {
  return `${dir}.installed-lock`;
}

export function lockHash(dir: string): string | null {
  try {
    return crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(dir, 'package-lock.json')))
      .digest('hex');
  } catch {
    // No lockfile to compare: never claim the install is current.
    return null;
  }
}

/** What the last successful `npm ci` in this checkout was built from, if anything. */
export function installedLockHash(dir: string): string | null {
  try {
    return fs.readFileSync(installedLockFile(dir), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function recordInstalled(dir: string, hash: string): void {
  fs.writeFileSync(installedLockFile(dir), `${hash}\n`, 'utf8');
}

/**
 * Does this checkout need `npm ci`?
 *
 * Yes when `node_modules` is missing, when nothing recorded what the current one was
 * built from, or when the lockfile has moved since. **An unreadable lockfile also means
 * yes** — the whole point is to skip work only on positive evidence that it is redundant.
 */
export function needsInstall(dir: string, exists: (p: string) => boolean = fs.existsSync): boolean {
  if (!exists(path.join(dir, 'node_modules'))) return true;
  const current = lockHash(dir);
  if (current === null) return true;
  return current !== installedLockHash(dir);
}

/**
 * How long to wait before each further attempt at a step that talks to the network.
 *
 * Two retries, ~10 s of patience in total. Deliberately modest, and the reason is worth
 * stating: this is *not* the fix for the throttling that took out the merge queue and the
 * nightly on 2026-09-03 — authenticating the fetch is (see ./git-auth), and an
 * authenticated fetch is not subject to the limit that was hit. This exists for the
 * ordinary transient — a dropped packet, a DNS blip, a moment of GitHub unavailability —
 * where one more attempt a few seconds later is the whole cure.
 *
 * It stays short because the bench is serialised: every second spent retrying is a second
 * no other job can run. Waiting out a multi-minute outage is not this loop's job; failing
 * honestly and letting the caller resubmit is.
 *
 * Sized against the corpus, not guessed: `done/` on 2026-09-04 held 7 ENVIRONMENT jobs, all
 * `git fetch failed while fetching …`, all one episode — 07:44:26Z to (at least) 07:49:22Z,
 * a floor of 296 s with **no observed ceiling** (one episode, not seven independent
 * samples). Surviving that floor would need ≥ 296 s of patience — 2.3× the 128 s median
 * `ref` job on a serialised bench — for a cause (`anonymous` throttling) that the token in
 * `git-auth.ts` already removes, and that produced zero fetch failures and zero retries in
 * the ~370 lines of worker journal since. No bound sized from this corpus could honestly
 * claim to survive "an episode"; `[2_000, 8_000]` is therefore an **honest partial
 * mitigation** — sized on the cost side (10 s ≈ 8 % of a median job) for the ordinary
 * transient, not a throttle survivor. `worker.ts`'s separate best-effort `origin/main`
 * refresh (~worker.ts:799) is deliberately not wrapped in this retry — see the comment
 * there for why.
 */
export const NETWORK_RETRY_DELAYS_MS = [2_000, 8_000];

/**
 * Run a step that talks to the network, retrying on a non-zero exit.
 *
 * Only ever used for `clone` and `fetch`. `reset`, `clean` and `merge` are local and
 * deterministic: retrying those would not fix anything and would turn a real error into
 * three copies of itself in the log.
 *
 * Every attempt is numbered in `options.logFile`, not just `deps.log` (which reaches only
 * the worker's own stdout/journal): a first-try success and a retried one must be
 * distinguishable by reading the job log alone. The marker is written *before* the child
 * runs, so git's own stderr for that attempt lands under the marker it belongs to.
 *
 * Sample excerpts (taken from checkout.test.ts's own temp logs — the format is pinned there):
 *
 * ```
 * --- git fetch: attempt 1/3 ---            # first-try success
 * git fetch: succeeded on attempt 1/3
 *
 * --- git fetch: attempt 1/3 ---            # retried success
 * git fetch: exited 1 — retrying in 2000ms
 * --- git fetch: attempt 2/3 ---
 * git fetch: exited 1 — retrying in 8000ms
 * --- git fetch: attempt 3/3 ---
 * git fetch: succeeded on attempt 3/3
 *
 * --- git fetch: attempt 1/3 ---            # exhaustion
 * git fetch: exited 1 — retrying in 2000ms
 * --- git fetch: attempt 2/3 ---
 * git fetch: exited 1 — retrying in 8000ms
 * --- git fetch: attempt 3/3 ---
 * git fetch: failed after 3 attempts (last exit 1)
 * ```
 */
async function runNetworkCommand(
  deps: CheckoutDeps,
  name: string,
  cmd: string,
  args: string[],
  options: CheckoutCommandOptions,
  delays: number[] = NETWORK_RETRY_DELAYS_MS,
): Promise<number> {
  const attempts = delays.length + 1;
  for (let attempt = 1; ; attempt++) {
    fs.appendFileSync(options.logFile, `--- ${name}: attempt ${attempt}/${attempts} ---\n`, 'utf8');
    const code = await deps.runCommand(cmd, args, options);
    if (code === 0) {
      fs.appendFileSync(options.logFile, `${name}: succeeded on attempt ${attempt}/${attempts}\n`, 'utf8');
      return code;
    }
    if (attempt > delays.length) {
      fs.appendFileSync(options.logFile, `${name}: failed after ${attempts} attempts (last exit ${code})\n`, 'utf8');
      deps.log(`checkout: ${name} failed after ${attempts} attempts — last exit ${code}`);
      return code;
    }
    const delay = delays[attempt - 1];
    fs.appendFileSync(options.logFile, `${name}: exited ${code} — retrying in ${delay}ms\n`, 'utf8');
    deps.log(`checkout: ${name} exited ${code} — retrying in ${delay}ms`);
    await deps.sleep(delay);
  }
}

/**
 * Resolve a job's ref against the remote before it is reset to. `git fetch` only ever
 * advances the copies of the remote's branches (`refs/remotes/origin/*`), never a checkout's
 * own local branch of the same name; resetting straight to a sha then drags that local
 * branch along with it, so a later job asking for a branch by name resolves it to whatever
 * commit yesterday's job happened to leave the local branch pointing at, not the branch's
 * real tip.
 */
export function resolveTargetRef(dir: string, ref: string, git: GitRunner): string {
  // Already spelled against the remote (the nightly's `origin/main`): nothing to resolve,
  // and asking would look for `refs/remotes/origin/origin/main`.
  if (ref.startsWith('origin/')) return ref;
  return resolveRef(dir, `refs/remotes/origin/${ref}`, git) ? `origin/${ref}` : ref;
}

/**
 * Bring `dir` to `ref`, cloning it the first time. Returns the name of the step that
 * failed, or null on success.
 *
 * `git clean -fd` keeps ignored files on purpose, so `node_modules/` survives the reset —
 * which is what makes the conditional install possible at all. The tree fingerprint also
 * excludes ignored files, so the checkout reads as clean either way.
 */
export async function prepareCheckout(
  deps: CheckoutDeps,
  request: PrepareRequest,
  git: GitRunner,
): Promise<PrepareResult> {
  const { dir, ref, workerRepo, logFile, mergeRef } = request;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // One preparation per log: a red result points here, and yesterday's noise would bury it.
  fs.writeFileSync(logFile, `=== prepare ${dir} at ${ref} — ${new Date(deps.now()).toISOString()} ===\n`, 'utf8');

  // Read once and used for the clone and the fetch — the only two steps that leave this
  // machine. Nothing local gets the token, so `npm ci` and the drive itself never see it.
  const env = deps.gitAuthEnv();

  if (!fs.existsSync(path.join(dir, '.git'))) {
    let url: string;
    try {
      url = git(workerRepo, ['remote', 'get-url', 'origin']).trim();
    } catch (err: unknown) {
      fs.appendFileSync(logFile, `${toErrorMessage(err)}\n`, 'utf8');
      return { failed: 'git remote get-url origin' };
    }
    const cloned = await runNetworkCommand(deps, 'git clone', 'git', ['clone', url, dir], {
      cwd: path.dirname(dir),
      logFile,
      env,
    });
    if (cloned !== 0) return { failed: 'git clone' };
  }

  // Every branch, not just the one asked for: a bare sha cannot always be fetched
  // directly (the server has to allow it), while a sha reachable from a fetched branch
  // always resets cleanly. `--prune` keeps deleted branches from accumulating forever.
  const fetched = await runNetworkCommand(
    deps,
    'git fetch',
    'git',
    ['fetch', '--prune', '--force', 'origin'],
    { cwd: dir, logFile, env },
  );
  if (fetched !== 0) return { failed: 'git fetch' };

  // Resolved after the fetch, never before: a branch created since the last job only has a
  // `refs/remotes/origin/...` once the fetch has run.
  const target = resolveTargetRef(dir, ref, git);
  if (target !== ref) {
    deps.log(`checkout ${dir}: ${ref} resolved to ${target} — the remote-tracking ref, not the local branch`);
    fs.appendFileSync(logFile, `resolved ${ref} -> ${target}\n`, 'utf8');
  }

  // Local, deterministic, and given no token: see runNetworkCommand.
  const localSteps: { name: string; cmd: string; args: string[] }[] = [
    { name: `git reset --hard ${target}`, cmd: 'git', args: ['reset', '--hard', target] },
    { name: 'git clean -fd', cmd: 'git', args: ['clean', '-fd'] },
  ];
  for (const step of localSteps) {
    const code = await deps.runCommand(step.cmd, step.args, { cwd: dir, logFile });
    if (code !== 0) return { failed: step.name };
  }

  let merged = false;
  if (mergeRef) {
    // The common case: the branch already contains everything on `mergeRef`, because
    // nothing landed on it since the branch forked (or the branch is itself
    // `origin/main`). One plumbing call answers that without ever invoking `merge` —
    // no merge commit, no risk of a conflict, the fast path the ~35 s figure describes.
    const aheadCode = await deps.runCommand(
      'git',
      ['merge-base', '--is-ancestor', mergeRef, 'HEAD'],
      { cwd: dir, logFile },
    );
    if (aheadCode === 0) {
      deps.log(`checkout ${dir}: ${mergeRef} is already an ancestor of ${ref} — no merge needed`);
    } else {
      deps.log(`checkout ${dir}: merging ${mergeRef} into ${ref} — gating the tree it would land`);
      const mergeCode = await deps.runCommand(
        'git',
        ['-c', 'user.name=SPO Bench', '-c', 'user.email=bench@local', 'merge', '--no-edit', mergeRef],
        { cwd: dir, logFile },
      );
      if (mergeCode !== 0) {
        let conflictBase = mergeRef;
        try {
          conflictBase = git(dir, ['rev-parse', mergeRef]).trim();
        } catch {
          // Keep the ref name; a sha is nicer but the name still identifies the base.
        }
        // Leave the checkout exactly as prepareCheckout found it, not mid-merge — the
        // next job to use this shared checkout must not inherit somebody else's conflict.
        await deps.runCommand('git', ['merge', '--abort'], { cwd: dir, logFile });
        deps.log(`checkout ${dir}: merge conflict with ${mergeRef} (${conflictBase}) — aborted`);
        return { failed: 'merge', conflictBase };
      }
      merged = true;
    }
  }

  if (needsInstall(dir)) {
    deps.log(`checkout ${dir}: lockfile moved (or no node_modules) — npm ci`);
    const code = await deps.runCommand('npm', ['ci'], { cwd: dir, logFile });
    if (code !== 0) return { failed: 'npm ci' };
    const hash = lockHash(dir);
    // Only a hash we actually read gets recorded: stamping a guess would make the next
    // job skip an install it needed.
    if (hash) recordInstalled(dir, hash);
  } else {
    deps.log(`checkout ${dir}: node_modules already matches the lockfile — no install`);
  }

  return { failed: null, merged };
}
