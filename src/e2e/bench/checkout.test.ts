/**
 * The worker-owned checkout — src/e2e/bench/checkout.ts.
 *
 * The property this file exists to pin is the install decision. Skipping `npm ci` is the
 * only place here that trades safety for time, so every case that is not positive
 * evidence of a current `node_modules` must answer "install". Getting that backwards
 * builds a fetched ref against the wrong packages and blames the code for it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  installedLockFile,
  installedLockHash,
  lockHash,
  needsInstall,
  prepareCheckout,
  recordInstalled,
  resolveTargetRef,
  NETWORK_RETRY_DELAYS_MS,
  type CheckoutDeps,
} from './checkout';

const NOW = 1_800_000_000_000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spo-checkout-'));
}

interface Harness {
  deps: CheckoutDeps;
  commands: { cmd: string; args: string[]; cwd: string; env?: Record<string, string> }[];
  exitCodes: number[];
  logs: string[];
  /** Every delay the retry loop asked for, in order — never really waited. */
  slept: number[];
}

const AUTH = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader' };

function harness(): Harness {
  const h: Harness = {
    commands: [],
    exitCodes: [],
    logs: [],
    slept: [],
    deps: {
      runCommand: async (cmd, args, options) => {
        h.commands.push({ cmd, args, cwd: options.cwd, env: options.env });
        return h.exitCodes.shift() ?? 0;
      },
      now: () => NOW,
      log: line => h.logs.push(line),
      sleep: async ms => void h.slept.push(ms),
      gitAuthEnv: () => AUTH,
    },
  };
  return h;
}

/** A checkout that already looks cloned, so prepare goes straight to the git steps. */
function clonedDir(): string {
  const dir = path.join(tempDir(), 'checkout');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/** Remote-tracking refs the fake origin has for one test: `refs/remotes/...` -> sha. */
let remoteRefs: Record<string, string> = {};
beforeEach(() => {
  remoteRefs = {};
});

const git = (_worktree: string, args: string[]): string => {
  if (args[0] === 'rev-parse') {
    const wanted = args[args.length - 1];
    const sha = remoteRefs[wanted];
    // What `rev-parse --verify --quiet` really does when the ref is absent: exit non-zero.
    if (!sha) throw new Error(`fatal: Needed a single revision: ${wanted}`);
    return `${sha}\n`;
  }
  return 'https://github.com/Crazz-Org/SPO-WebClient.git';
};

describe('the install decision', () => {
  it('installs when node_modules is not there at all', () => {
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(needsInstall(dir)).toBe(true);
  });

  it('installs when nothing recorded what node_modules was built from', () => {
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(needsInstall(dir)).toBe(true);
  });

  it('installs when the lockfile has moved since the last install', () => {
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}');
    recordInstalled(dir, lockHash(dir) as string);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":2}');
    expect(needsInstall(dir)).toBe(true);
  });

  it('installs when the lockfile cannot be read — skipping needs positive evidence', () => {
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    recordInstalled(dir, 'whatever');
    expect(lockHash(dir)).toBeNull();
    expect(needsInstall(dir)).toBe(true);
  });

  it('skips only when the recorded hash IS the lockfile on disk', () => {
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}');
    recordInstalled(dir, lockHash(dir) as string);
    expect(needsInstall(dir)).toBe(false);
  });

  it('reads back nothing when no install was ever recorded', () => {
    expect(installedLockHash(clonedDir())).toBeNull();
  });

  it('keeps its record beside the checkout, not inside it — a git clean must not eat it', () => {
    const dir = clonedDir();
    expect(installedLockFile(dir).startsWith(dir + '.')).toBe(true);
  });
});

describe('prepareCheckout', () => {
  it('clones when there is no .git, then fetches, resets and cleans', async () => {
    const h = harness();
    const dir = path.join(tempDir(), 'fresh');
    const logFile = path.join(tempDir(), 'prepare.log');

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile },
      git,
    );

    expect(result.failed).toBeNull();
    expect(h.commands.map(c => `${c.cmd} ${c.args[0]}`)).toEqual([
      'git clone',
      'git fetch',
      'git reset',
      'git clean',
      'npm ci',
    ]);
  });

  it('resets to whatever ref it was given — a sha as readily as a branch', async () => {
    const h = harness();
    const dir = clonedDir();
    const sha = 'a'.repeat(40);
    await prepareCheckout(
      h.deps,
      { dir, ref: sha, workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );
    expect(h.commands.find(c => c.args[0] === 'reset')?.args).toEqual(['reset', '--hard', sha]);
  });

  it('fetches every branch, so a sha reachable from one resets without a direct fetch', async () => {
    const h = harness();
    const dir = clonedDir();
    await prepareCheckout(
      h.deps,
      { dir, ref: 'x', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );
    expect(h.commands.find(c => c.args[0] === 'fetch')?.args).toEqual([
      'fetch', '--prune', '--force', 'origin',
    ]);
  });

  it('skips the install when the lockfile has not moved, and says so', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}');
    recordInstalled(dir, lockHash(dir) as string);

    await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

    expect(h.commands.some(c => c.cmd === 'npm')).toBe(false);
    expect(h.logs.join('\n')).toMatch(/already matches the lockfile/);
  });

  it('records the lockfile it installed from, so the next job may skip', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":9}');

    await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

    expect(installedLockHash(dir)).toBe(lockHash(dir));
    expect(needsInstall(dir, () => true)).toBe(false);
  });

  it('does not record anything when the install failed', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":9}');
    h.exitCodes = [0, 0, 0, 1]; // fetch, reset, clean ok; npm ci fails

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

    expect(result.failed).toBe('npm ci');
    expect(installedLockHash(dir)).toBeNull();
  });

  it.each([
    ['git reset --hard origin/main', 1],
    ['git clean -fd', 2],
  ])('names %s when it is the step that failed', async (name, index) => {
    const h = harness();
    const dir = clonedDir();
    h.exitCodes = [0, 0, 0];
    h.exitCodes[index] = 1;

    await expect(
      prepareCheckout(
        h.deps,
        { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
        git,
      ),
    ).resolves.toMatchObject({ failed: name });
  });

  it('names the clone when it fails, and never touches the ref afterwards', async () => {
    const h = harness();
    h.exitCodes = [1, 1, 1]; // every attempt, or the retry would rescue it
    const result = await prepareCheckout(
      h.deps,
      {
        dir: path.join(tempDir(), 'fresh'),
        ref: 'origin/main',
        workerRepo: '/repo',
        logFile: path.join(tempDir(), 'p.log'),
      },
      git,
    );
    expect(result.failed).toBe('git clone');
    // The intent is that nothing runs against a checkout that was never created — not that
    // the clone ran once. It now runs three times, because a clone is a network step.
    expect(h.commands.every(c => c.args[0] === 'clone')).toBe(true);
  });

  it('reports the origin lookup rather than cloning from a guess', async () => {
    const h = harness();
    const logFile = path.join(tempDir(), 'p.log');
    const result = await prepareCheckout(
      h.deps,
      { dir: path.join(tempDir(), 'fresh'), ref: 'origin/main', workerRepo: '/repo', logFile },
      () => {
        throw new Error('not a git repository');
      },
    );
    expect(result.failed).toBe('git remote get-url origin');
    expect(h.commands).toHaveLength(0);
    expect(fs.readFileSync(logFile, 'utf8')).toMatch(/not a git repository/);
  });

  it('starts the log fresh each time — a red run must not read yesterday\'s noise', async () => {
    const h = harness();
    const dir = clonedDir();
    const logFile = path.join(tempDir(), 'p.log');
    fs.writeFileSync(logFile, 'STALE FROM LAST NIGHT\n');

    await prepareCheckout(h.deps, { dir, ref: 'origin/main', workerRepo: '/repo', logFile }, git);

    expect(fs.readFileSync(logFile, 'utf8')).not.toMatch(/STALE/);
  });
});

describe('mergeRef — gating the tree the branch would actually land, not the branch alone', () => {
  /** A checkout already installed, so every scenario's command list is just the git steps. */
  function installedDir(): string {
    const dir = clonedDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}');
    recordInstalled(dir, lockHash(dir) as string);
    return dir;
  }

  it('takes the fast path when ref already contains mergeRef — one plumbing call, no merge', async () => {
    const h = harness();
    const dir = installedDir();

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'abc', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log'), mergeRef: 'origin/main' },
      git,
    );

    expect(result).toEqual({ failed: null, merged: false });
    expect(h.commands.map(c => c.args[0])).toEqual(['fetch', 'reset', 'clean', 'merge-base']);
    expect(h.commands.find(c => c.args[0] === 'merge-base')?.args).toEqual([
      'merge-base', '--is-ancestor', 'origin/main', 'HEAD',
    ]);
  });

  it('merges mergeRef in with the SPO Bench identity when ref does not already contain it', async () => {
    const h = harness();
    const dir = installedDir();
    h.exitCodes = [0, 0, 0, 1, 0]; // fetch, reset, clean ok; merge-base: not an ancestor; merge: ok

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'abc', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log'), mergeRef: 'origin/main' },
      git,
    );

    expect(result).toEqual({ failed: null, merged: true });
    const merge = h.commands.find(c => c.args.includes('--no-edit'));
    expect(merge?.args).toEqual([
      '-c', 'user.name=SPO Bench', '-c', 'user.email=bench@local', 'merge', '--no-edit', 'origin/main',
    ]);
  });

  it('aborts explicitly on a conflict and names the base sha it could not merge with', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}');
    h.exitCodes = [0, 0, 0, 1, 1]; // fetch, reset, clean ok; not an ancestor; merge: conflict
    const baseSha = 'deadbeef'.repeat(5);
    const gitWithRevParse = (_worktree: string, args: string[]): string =>
      args[0] === 'rev-parse' ? baseSha : git(_worktree, args);

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'abc', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log'), mergeRef: 'origin/main' },
      gitWithRevParse,
    );

    expect(result).toEqual({ failed: 'merge', conflictBase: baseSha });
    // Abort ran, and nothing after it (no install attempted on a checkout mid-merge).
    expect(h.commands.some(c => c.args[0] === 'merge' && c.args[1] === '--abort')).toBe(true);
    expect(h.commands.some(c => c.cmd === 'npm')).toBe(false);
    // The log ends clean: no half-merged state left for the log to describe.
    expect(h.logs.join('\n')).toMatch(/merge conflict with origin\/main.*aborted/);
  });

  it('installs only after a successful merge — the merged tree is what node_modules must match', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":9}'); // no node_modules: needsInstall
    h.exitCodes = [0, 0, 0, 1, 0]; // fetch, reset, clean ok; not an ancestor; merge: ok

    await prepareCheckout(
      h.deps,
      { dir, ref: 'abc', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log'), mergeRef: 'origin/main' },
      git,
    );

    const order = h.commands.map(c => (c.args.includes('--no-edit') ? 'merge' : c.args[0]));
    expect(order.indexOf('merge')).toBeGreaterThan(-1);
    expect(order.indexOf('ci')).toBeGreaterThan(order.indexOf('merge'));
  });

  it('never calls merge-base at all when no mergeRef is requested — unchanged behaviour', async () => {
    const h = harness();
    const dir = installedDir();

    const result = await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

    expect(result).toEqual({ failed: null, merged: false });
    expect(h.commands.some(c => c.args.includes('merge-base'))).toBe(false);
  });
});

/**
 * The bug these pin: SPO-WebClient is a public repo, so git never asks the credential
 * helper (it only asks after a 401, and GitHub answers 200) and every fetch the bench
 * has ever made went out anonymous — until GitHub's anonymous-traffic throttle refused
 * seven merge-queue fetches and the nightly on 2026-09-03. Nothing anywhere asserted
 * which git calls carried credentials, which is why it was invisible for as long as it
 * was. See ./git-auth.
 */
describe('prepareCheckout — credentials', () => {
  const prep = (h: Harness, dir: string): Promise<unknown> =>
    prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

  it('gives the fetch the github credentials', async () => {
    const h = harness();
    await prep(h, clonedDir());
    expect(h.commands.find(c => c.args[0] === 'fetch')?.env).toEqual(AUTH);
  });

  it('gives the clone the github credentials — the first fetch of all is a clone', async () => {
    const h = harness();
    await prep(h, path.join(tempDir(), 'fresh'));
    expect(h.commands.find(c => c.args[0] === 'clone')?.env).toEqual(AUTH);
  });

  it.each([['reset'], ['clean']])(
    'gives %s no credentials — it is local, and a token there is a token somewhere it is not needed',
    async verb => {
      const h = harness();
      await prep(h, clonedDir());
      expect(h.commands.find(c => c.args[0] === verb)?.env).toBeUndefined();
    },
  );

  it('gives npm ci no credentials', async () => {
    const h = harness();
    await prep(h, clonedDir());
    expect(h.commands.find(c => c.cmd === 'npm')?.env).toBeUndefined();
  });

  it('reads the environment once per prepare, not once per command', async () => {
    let reads = 0;
    const h = harness();
    h.deps.gitAuthEnv = () => {
      reads += 1;
      return AUTH;
    };
    await prep(h, path.join(tempDir(), 'fresh'));
    expect(reads).toBe(1);
  });
});

describe('prepareCheckout — retrying a network step', () => {
  const prep = (h: Harness, dir: string): Promise<{ failed: string | null }> =>
    prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      git,
    );

  it('retries a failed fetch and succeeds on the second attempt', async () => {
    const h = harness();
    h.exitCodes = [1, 0, 0, 0, 0];
    const result = await prep(h, clonedDir());

    expect(result.failed).toBeNull();
    expect(h.commands.filter(c => c.args[0] === 'fetch')).toHaveLength(2);
    expect(h.slept).toEqual([NETWORK_RETRY_DELAYS_MS[0]]);
  });

  it('backs off between attempts, and gives up after the last delay', async () => {
    const h = harness();
    h.exitCodes = [1, 1, 1];
    const result = await prep(h, clonedDir());

    expect(result.failed).toBe('git fetch');
    expect(h.commands.filter(c => c.args[0] === 'fetch')).toHaveLength(
      NETWORK_RETRY_DELAYS_MS.length + 1,
    );
    expect(h.slept).toEqual(NETWORK_RETRY_DELAYS_MS);
  });

  it('says in the log that it is retrying, and what it is waiting for', async () => {
    const h = harness();
    h.exitCodes = [1, 0];
    await prep(h, clonedDir());
    expect(h.logs.join('\n')).toMatch(/git fetch exited 1 — retrying in 2000ms/);
  });

  it.each([['reset', 1], ['clean', 2]])(
    'never retries %s — it is local and deterministic, so a second run would only hide the error',
    async (verb, index) => {
      const h = harness();
      h.exitCodes = [0, 0, 0];
      h.exitCodes[index] = 1;
      await prep(h, clonedDir());

      expect(h.commands.filter(c => c.args[0] === verb)).toHaveLength(1);
      expect(h.slept).toEqual([]);
    },
  );

  it('never retries npm ci', async () => {
    const h = harness();
    const dir = clonedDir();
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"v":9}');
    h.exitCodes = [0, 0, 0, 1];
    await prep(h, dir);

    expect(h.commands.filter(c => c.cmd === 'npm')).toHaveLength(1);
    expect(h.slept).toEqual([]);
  });

  it('waits long enough to outlast a blip, and short enough not to wedge a serialised bench', () => {
    const total = NETWORK_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(5_000);
    expect(total).toBeLessThanOrEqual(30_000);
  });
});

// Mutation proof for runNetworkCommand (doc/bench-worker.md § Retry mutation proof), 6/8
// killed, measured by hand: deleting the success append or the sleep, starting `attempt` at
// 0, the attempts off-by-one, returning early with no retry, and an unconditional success
// append are each killed by one of the four tests below. The other two mutants — writing
// `${attempt}` instead of `${attempts}` on exhaustion, and moving the attempt marker after
// `runCommand` — are accepted survivors, not gaps: the first is equivalent (the two values
// are always equal at exhaustion), the second guards an ordering only two real processes can
// race on, which a fake `runCommand` cannot exercise.
describe('prepareCheckout — the job log tells a retried success from a first-try one', () => {
  const ATTEMPTS = NETWORK_RETRY_DELAYS_MS.length + 1;

  const prep = (h: Harness, dir: string, logFile: string): Promise<{ failed: string | null }> =>
    prepareCheckout(h.deps, { dir, ref: 'origin/main', workerRepo: '/repo', logFile }, git);

  const readLog = (logFile: string): string => fs.readFileSync(logFile, 'utf8');

  it('a first-try success names attempt 1 and nothing higher', async () => {
    const h = harness();
    const logFile = path.join(tempDir(), 'p.log');
    await prep(h, clonedDir(), logFile);

    const log = readLog(logFile);
    expect(log).toContain(`--- git fetch: attempt 1/${ATTEMPTS} ---`);
    expect(log).toContain(`git fetch: succeeded on attempt 1/${ATTEMPTS}`);
    expect(log).not.toContain('attempt 2/');
    expect(log).not.toContain('retrying');
  });

  it('a success after N failures is readable from the log alone, in order', async () => {
    const h = harness();
    h.exitCodes = [1, 1, 0];
    const logFile = path.join(tempDir(), 'p.log');
    const result = await prep(h, clonedDir(), logFile);

    expect(result.failed).toBeNull();
    const log = readLog(logFile);
    expect(log.indexOf(`--- git fetch: attempt 1/${ATTEMPTS} ---`)).toBeGreaterThanOrEqual(0);
    const i1 = log.indexOf(`--- git fetch: attempt 1/${ATTEMPTS} ---`);
    const i2 = log.indexOf(`--- git fetch: attempt 2/${ATTEMPTS} ---`);
    const i3 = log.indexOf(`--- git fetch: attempt 3/${ATTEMPTS} ---`);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(log).toContain('git fetch: exited 1 — retrying in 2000ms');
    expect(log).toContain('git fetch: exited 1 — retrying in 8000ms');
    expect(log).toContain(`git fetch: succeeded on attempt ${ATTEMPTS}/${ATTEMPTS}`);
    expect(h.slept).toEqual(NETWORK_RETRY_DELAYS_MS);
  });

  it('exhaustion names the attempt count and never claims success', async () => {
    const h = harness();
    h.exitCodes = [1, 1, 1];
    const logFile = path.join(tempDir(), 'p.log');
    const result = await prep(h, clonedDir(), logFile);

    expect(result.failed).toBe('git fetch');
    const log = readLog(logFile);
    expect(log).toContain(`git fetch: failed after ${ATTEMPTS} attempts (last exit 1)`);
    expect(log).not.toContain('succeeded');
    expect(log.match(/attempt \d\/\d ---/g)).toHaveLength(ATTEMPTS);
  });

  it('the clone gets the same per-attempt lines as the fetch', async () => {
    const h = harness();
    const logFile = path.join(tempDir(), 'p.log');
    await prep(h, path.join(tempDir(), 'fresh'), logFile);

    const log = readLog(logFile);
    expect(log).toContain(`--- git clone: attempt 1/${ATTEMPTS} ---`);
    expect(log).toContain(`git clone: succeeded on attempt 1/${ATTEMPTS}`);
  });

  it('runs under a throwaway SPO_BENCH_DIR, never the real one', () => {
    expect(process.env.SPO_BENCH_DIR).toBeDefined();
    expect((process.env.SPO_BENCH_DIR as string).startsWith(os.tmpdir())).toBe(true);
    const logFile = path.join(tempDir(), 'p.log');
    expect(logFile.startsWith(os.tmpdir())).toBe(true);
  });

  it('local steps write no attempt lines of their own', async () => {
    const h = harness();
    const logFile = path.join(tempDir(), 'p.log');
    await prep(h, clonedDir(), logFile);

    const log = readLog(logFile);
    expect(log.match(/^--- git fetch: attempt 1\//gm)).toHaveLength(1);
    expect(log).not.toMatch(/reset.*attempt/);
    expect(log).not.toMatch(/clean.*attempt/);
  });
});

describe('the ref is resolved against the remote, not the checkout\'s own branches', () => {
  it('a --ref=main job after a job at sha X resets to origin/main, not X', async () => {
    const h = harness();
    const dir = clonedDir();
    const shaX = 'a'.repeat(40);
    remoteRefs['refs/remotes/origin/main'] = 'b'.repeat(40);

    await prepareCheckout(h.deps, { dir, ref: shaX, workerRepo: '/repo', logFile: path.join(tempDir(), 'p1.log') }, git);
    h.commands = [];

    await prepareCheckout(h.deps, { dir, ref: 'main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p2.log') }, git);

    const resetArgs = h.commands.find(c => c.args[0] === 'reset')?.args;
    expect(resetArgs).toEqual(['reset', '--hard', 'origin/main']);
    expect(resetArgs).not.toContain(shaX);
  });

  it('a sha is passed through untouched', async () => {
    const h = harness();
    const dir = clonedDir();
    const sha = 'a'.repeat(40);

    await prepareCheckout(h.deps, { dir, ref: sha, workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') }, git);

    expect(h.commands.find(c => c.args[0] === 'reset')?.args).toEqual(['reset', '--hard', sha]);
  });

  it('origin/... is never double-prefixed, and no rev-parse is asked at all', async () => {
    const h = harness();
    const dir = clonedDir();
    remoteRefs['refs/remotes/origin/main'] = 'b'.repeat(40);
    const gitCalls: string[][] = [];
    const recordingGit = (worktree: string, args: string[]): string => {
      gitCalls.push(args);
      return git(worktree, args);
    };

    await prepareCheckout(
      h.deps,
      { dir, ref: 'origin/main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      recordingGit,
    );

    expect(h.commands.find(c => c.args[0] === 'reset')?.args).toEqual(['reset', '--hard', 'origin/main']);
    expect(gitCalls.some(args => args[0] === 'rev-parse')).toBe(false);
  });

  it('a branch with no remote-tracking ref is left alone', async () => {
    const h = harness();
    const dir = clonedDir();

    await prepareCheckout(h.deps, { dir, ref: 'x', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') }, git);

    expect(h.commands.find(c => c.args[0] === 'reset')?.args).toEqual(['reset', '--hard', 'x']);
  });

  it('resolves after the fetch, not before', async () => {
    const h = harness();
    const dir = clonedDir();
    remoteRefs['refs/remotes/origin/main'] = 'b'.repeat(40);
    let verbsAtRevParse: string[] = [];
    const recordingGit = (worktree: string, args: string[]): string => {
      if (args[0] === 'rev-parse') {
        verbsAtRevParse = h.commands.map(c => c.args[0]);
      }
      return git(worktree, args);
    };

    await prepareCheckout(
      h.deps,
      { dir, ref: 'main', workerRepo: '/repo', logFile: path.join(tempDir(), 'p.log') },
      recordingGit,
    );

    expect(verbsAtRevParse).toContain('fetch');
    expect(verbsAtRevParse).not.toContain('reset');
  });

  it('is legible afterwards, in the worker log and the job log file', async () => {
    const h = harness();
    const dir = clonedDir();
    const logFile = path.join(tempDir(), 'p.log');
    remoteRefs['refs/remotes/origin/main'] = 'b'.repeat(40);

    await prepareCheckout(h.deps, { dir, ref: 'main', workerRepo: '/repo', logFile }, git);

    expect(h.logs.join('\n')).toMatch(/main resolved to origin\/main/);
    expect(fs.readFileSync(logFile, 'utf8')).toContain('resolved main -> origin/main');
  });
});

describe('resolveTargetRef', () => {
  it('leaves an already-remote ref untouched', () => {
    expect(resolveTargetRef('/repo', 'origin/main', git)).toBe('origin/main');
  });

  it('resolves a branch that has a remote-tracking ref', () => {
    remoteRefs['refs/remotes/origin/main'] = 'b'.repeat(40);
    expect(resolveTargetRef('/repo', 'main', git)).toBe('origin/main');
  });

  it('leaves a ref with no remote-tracking counterpart untouched', () => {
    expect(resolveTargetRef('/repo', 'x', git)).toBe('x');
  });
});
