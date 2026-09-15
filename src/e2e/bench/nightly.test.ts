import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { benchPaths, ensureLayout, type BenchPaths } from './paths';
import { Spool, type ManualRequester } from './job';
import type { GitRunner, TreeFingerprint } from './fingerprint';
import {
  deleteManualRequest,
  manualProofDue,
  manualRecordFile,
  manualRequestFile,
  maybeRunNightly,
  newestManualDepositMs,
  nightlyCheckout,
  nightlyDue,
  nightlyPrepareLog,
  nightlyResultFile,
  nightlyResultFromReport,
  NIGHTLY_MIN_GAP_MS,
  NIGHTLY_MOVE_RATE_LIMIT_MS,
  prepareCheckout,
  publishManualResult,
  readManualRecords,
  readManualRequest,
  readNightlyResult,
  writeManualRecord,
  writeNightlyResult,
  type ManualNightlyRecord,
  type ManualRequest,
  type NightlyDeps,
  type NightlyResult,
} from './nightly';

/** 03:00 UTC — inside the window, whatever the machine's timezone is. */
const IN_WINDOW = Date.UTC(2026, 7, 25, 3, 0, 0);
/** 12:00 UTC — the middle of a working day. */
const OUTSIDE = Date.UTC(2026, 7, 25, 12, 0, 0);

/** Stand-in for the real github auth environment; see ./git-auth. */
const NIGHTLY_AUTH = { GIT_CONFIG_COUNT: '1' };

interface Harness {
  deps: NightlyDeps;
  paths: BenchPaths;
  spool: Spool;
  commands: { cmd: string; args: string[]; cwd: string; env?: Record<string, string> }[];
  exitCodes: number[];
  logs: string[];
  /** Every delay the retry loop asked for, in order — never really waited. */
  slept: number[];
  gitCalls: { worktree: string; args: string[] }[];
  gitThrows: boolean;
  fingerprintThrows: boolean;
  /** What the checkout fingerprints as. Defaults to the value every pre-#801 test assumed. */
  head: string;
  clock: { nowMs: number };
  git: GitRunner;
  /** What `resolveRef(workerRepo, 'origin/main')` reports — undefined until a test sets it,
   *  so every existing test keeps taking the time-window-only path. */
  mainSha: string | undefined;
}

function harness(): Harness {
  const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-nightly-')));
  ensureLayout(paths);
  const spool = new Spool(paths);

  const h: Harness = {
    paths,
    spool,
    commands: [],
    slept: [],
    exitCodes: [],
    logs: [],
    gitCalls: [],
    gitThrows: false,
    fingerprintThrows: false,
    head: 'main-sha-abc',
    clock: { nowMs: IN_WINDOW },
    mainSha: undefined,
    git: (worktree, args) => {
      h.gitCalls.push({ worktree, args });
      if (h.gitThrows) throw new Error('no origin remote');
      return 'git@github.com:Crazz-Org/SPO-WebClient.git\n';
    },
    deps: {
      paths,
      spool,
      fingerprint: (): TreeFingerprint => {
        if (h.fingerprintThrows) throw new Error('tree vanished');
        return { head: h.head, hash: 'nightly-hash', clean: true };
      },
      resolveRef: (): string | undefined => h.mainSha,
      runCommand: async (cmd, args, options) => {
        h.commands.push({ cmd, args, cwd: options.cwd, env: options.env });
        return h.exitCodes.shift() ?? 0;
      },
      now: () => h.clock.nowMs,
      log: line => h.logs.push(line),
      sleep: async ms => void h.slept.push(ms),
      gitAuthEnv: () => NIGHTLY_AUTH,
    },
  };
  return h;
}

/** The `git`/`npm` verbs prepareCheckout ran, in order. */
function ranSteps(h: Harness): string[] {
  return h.commands.map(c => `${c.cmd} ${c.args[0]}`);
}

function result(overrides: Partial<NightlyResult> = {}): NightlyResult {
  return { verdict: 'PASS', submittedAt: new Date(IN_WINDOW).toISOString(), ...overrides };
}

/** Real 40-hex shas: the marker refuses anything looser, so the tests must use real ones. */
const TIP = 'a1b2c3d4'.repeat(5);
const MOVED_TIP = 'f9e8d7c6'.repeat(5);

function requester(overrides: Partial<ManualRequester> = {}): ManualRequester {
  return {
    user: 'maintainer',
    host: 'bench-pc',
    tty: '/dev/pts/3',
    via: 'bench-cli',
    reason: 'twelve connect ETIMEDOUT lines — this red is not the code',
    requestedAt: new Date(IN_WINDOW).toISOString(),
    ...overrides,
  };
}

/** Put a marker on disk exactly as `request-nightly` would. */
function fileRequest(h: Harness, request: Partial<ManualRequest> = {}): void {
  fs.mkdirSync(h.paths.nightly, { recursive: true });
  fs.writeFileSync(
    manualRequestFile(h.paths),
    `${JSON.stringify({ sha: TIP, requestedBy: requester(), ...request }, null, 2)}\n`,
    'utf8',
  );
}

/** The published file's exact bytes, or null when it does not exist. */
function latestBytes(h: Harness): Buffer | null {
  try {
    return fs.readFileSync(nightlyResultFile(h.paths));
  } catch {
    return null;
  }
}

describe('nightlyDue', () => {
  it('is due inside the window when nothing has run', () => {
    expect(nightlyDue(null, false, IN_WINDOW)).toBe(true);
  });

  it('is not due outside the window', () => {
    expect(nightlyDue(null, false, OUTSIDE)).toBe(false);
  });

  it('holds the window boundaries — 02:00 and 05:00 UTC are in, 01:00 and 06:00 are out', () => {
    const at = (hour: number) => nightlyDue(null, false, Date.UTC(2026, 7, 25, hour, 0, 0));
    expect(at(1)).toBe(false);
    expect(at(2)).toBe(true);
    expect(at(5)).toBe(true);
    expect(at(6)).toBe(false);
  });

  it('is not due while a nightly is already queued or running', () => {
    expect(nightlyDue(null, true, IN_WINDOW)).toBe(false);
  });

  it('is not due again within the gap', () => {
    const last = result({ submittedAt: new Date(IN_WINDOW - 60_000).toISOString() });
    expect(nightlyDue(last, false, IN_WINDOW)).toBe(false);
  });

  it('is due once the gap has passed', () => {
    const last = result({ submittedAt: new Date(IN_WINDOW - NIGHTLY_MIN_GAP_MS).toISOString() });
    expect(nightlyDue(last, false, IN_WINDOW)).toBe(true);
  });

  it('treats an unparseable stamp as due — a corrupt file must not wedge it off forever', () => {
    expect(nightlyDue(result({ submittedAt: 'not a date' }), false, IN_WINDOW)).toBe(true);
  });

  describe('backward compatibility — currentMainSha omitted', () => {
    it('stays on the window-only schedule when currentMainSha is not given at all', () => {
      // Same shape a "main moved" case would have (a different lastProvenSha, long past
      // the move rate limit) but with no currentMainSha — nothing new here, so outside
      // the window is still not due.
      const last = result({
        sha: 'old-sha',
        submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS).toISOString(),
      });
      expect(nightlyDue(last, false, OUTSIDE, undefined, 'other-sha')).toBe(false);
    });
  });

  describe('the main-moved trigger', () => {
    it('does not fire off-window on the very first check — nothing proven yet is "unknown", not "moved"', () => {
      // No lastProvenSha to compare against: falls through to the window schedule, same
      // as an omitted currentMainSha would, so the first-ever check does not bypass it.
      expect(nightlyDue(null, false, OUTSIDE, 'new-sha')).toBe(false);
      expect(nightlyDue(null, false, IN_WINDOW, 'new-sha')).toBe(true);
    });

    it('is due outside the window when main has moved past the last proven sha', () => {
      const last = result({
        sha: 'old-sha',
        submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS - 1).toISOString(),
      });
      expect(nightlyDue(last, false, OUTSIDE, 'new-sha', 'old-sha')).toBe(true);
    });

    it('is not due yet when main moved but the 15-minute move rate limit has not elapsed', () => {
      const last = result({
        sha: 'old-sha',
        submittedAt: new Date(OUTSIDE - 60_000).toISOString(),
      });
      expect(nightlyDue(last, false, OUTSIDE, 'new-sha', 'old-sha')).toBe(false);
    });

    it('holds the move rate-limit boundary — one ms short is not due, exactly on it is', () => {
      const justUnder = result({
        sha: 'old-sha',
        submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS + 1).toISOString(),
      });
      expect(nightlyDue(justUnder, false, OUTSIDE, 'new-sha', 'old-sha')).toBe(false);

      const exactly = result({
        sha: 'old-sha',
        submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS).toISOString(),
      });
      expect(nightlyDue(exactly, false, OUTSIDE, 'new-sha', 'old-sha')).toBe(true);
    });

    it('accepts an explicit lastRunAtMs instead of deriving it from the last result', () => {
      // last is null (nothing on disk), but the caller knows a run happened recently.
      expect(nightlyDue(null, false, OUTSIDE, 'new-sha', 'old-sha', OUTSIDE - 60_000)).toBe(false);
      expect(
        nightlyDue(null, false, OUTSIDE, 'new-sha', 'old-sha', OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS),
      ).toBe(true);
    });

    it('treats an unparseable explicit lastRunAtMs as no prior run — not a reason to withhold the move trigger', () => {
      expect(nightlyDue(null, false, OUTSIDE, 'new-sha', 'old-sha', NaN)).toBe(true);
    });

    it('does not fire inside the window either while the move rate limit is still open', () => {
      const last = result({
        sha: 'old-sha',
        submittedAt: new Date(IN_WINDOW - 60_000).toISOString(),
      });
      // Would be blocked by NIGHTLY_MIN_GAP_MS on the window path too, but this confirms
      // the main-moved path itself respects its own limit rather than falling through.
      expect(nightlyDue(last, false, IN_WINDOW, 'new-sha', 'old-sha')).toBe(false);
    });

    it('is not due while a nightly is already queued or running, even when main moved', () => {
      expect(nightlyDue(null, true, OUTSIDE, 'new-sha', 'old-sha')).toBe(false);
    });
  });

  describe('the already-proven check', () => {
    it('is not due when the current main sha exactly matches what was already proven', () => {
      const last = result({
        sha: 'same-sha',
        submittedAt: new Date(IN_WINDOW - NIGHTLY_MIN_GAP_MS).toISOString(),
      });
      // Inside the window and past the 20h gap — would be due on the window schedule
      // alone, but the sha is unchanged, so there is nothing new to prove.
      expect(nightlyDue(last, false, IN_WINDOW, 'same-sha', 'same-sha')).toBe(false);
    });

    it('takes precedence over a main-moved-shaped rate limit that has elapsed', () => {
      const last = result({
        sha: 'same-sha',
        submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS).toISOString(),
      });
      expect(nightlyDue(last, false, OUTSIDE, 'same-sha', 'same-sha')).toBe(false);
    });
  });
});

describe('reading and writing the published result', () => {
  it('round-trips and leaves no .tmp behind', () => {
    const h = harness();
    writeNightlyResult(h.paths, result({ sha: 'abc', jobId: 'job-1' }));

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'PASS', sha: 'abc', jobId: 'job-1' });
    expect(fs.existsSync(`${nightlyResultFile(h.paths)}.tmp`)).toBe(false);
  });

  it('reads an absent file as nothing known', () => {
    expect(readNightlyResult(harness().paths)).toBeNull();
  });

  it('reads a corrupt file as nothing known', () => {
    const h = harness();
    fs.writeFileSync(nightlyResultFile(h.paths), '{ not json', 'utf8');

    expect(readNightlyResult(h.paths)).toBeNull();
  });

  it('creates the nightly directory when it is missing', () => {
    const h = harness();
    fs.rmSync(h.paths.nightly, { recursive: true, force: true });

    writeNightlyResult(h.paths, result());

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'PASS' });
  });
});

describe('prepareCheckout', () => {
  it('clones on the first run, resolving the url from the worker repo', async () => {
    const h = harness();

    expect(await prepareCheckout(h.deps, '/repo', h.git)).toBeNull();

    expect(h.gitCalls).toEqual([{ worktree: '/repo', args: ['remote', 'get-url', 'origin'] }]);
    expect(h.commands[0]).toMatchObject({
      cmd: 'git',
      args: ['clone', 'git@github.com:Crazz-Org/SPO-WebClient.git', nightlyCheckout(h.paths)],
    });
    expect(ranSteps(h)).toEqual(['git clone', 'git fetch', 'git reset', 'git clean', 'npm ci']);
  });

  it('does not clone when the checkout already exists', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });

    expect(await prepareCheckout(h.deps, '/repo', h.git)).toBeNull();

    expect(h.gitCalls).toEqual([]);
    expect(ranSteps(h)).toEqual(['git fetch', 'git reset', 'git clean', 'npm ci']);
  });

  it('runs every step inside the checkout', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });

    await prepareCheckout(h.deps, '/repo', h.git);

    for (const command of h.commands) {
      expect(command.cwd).toBe(nightlyCheckout(h.paths));
    }
  });

  it('names the failing step and runs nothing after it', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });
    h.exitCodes = [0, 1];

    expect(await prepareCheckout(h.deps, '/repo', h.git)).toBe('git reset --hard origin/main');

    expect(ranSteps(h)).toEqual(['git fetch', 'git reset']);
  });

  it('names the clone when the clone fails', async () => {
    const h = harness();
    h.exitCodes = [1, 1, 1]; // every attempt, or the retry would rescue it

    expect(await prepareCheckout(h.deps, '/repo', h.git)).toBe('git clone');
    expect(ranSteps(h)).toEqual(['git clone', 'git clone', 'git clone']);
  });

  it('names the url lookup when the worker repo has no origin', async () => {
    const h = harness();
    h.gitThrows = true;

    expect(await prepareCheckout(h.deps, '/repo', h.git)).toBe('git remote get-url origin');

    expect(h.commands).toEqual([]);
    expect(fs.readFileSync(nightlyPrepareLog(h.paths), 'utf8')).toContain('no origin remote');
  });

  it('starts a fresh log each night, so a red result is not buried', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });
    fs.writeFileSync(nightlyPrepareLog(h.paths), 'yesterday noise\n', 'utf8');

    await prepareCheckout(h.deps, '/repo', h.git);

    expect(fs.readFileSync(nightlyPrepareLog(h.paths), 'utf8')).not.toContain('yesterday noise');
  });
});

describe('maybeRunNightly', () => {
  it('deposits one job for main when due', async () => {
    const h = harness();

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);

    const queued = h.spool.queued();
    expect(queued).toHaveLength(1);
    expect(queued[0].request).toMatchObject({
      type: 'nightly',
      branch: 'main',
      worktree: nightlyCheckout(h.paths),
      submitter: { pid: 0 },
      args: [],
      fingerprint: { head: 'main-sha-abc' },
    });
  });

  it('does nothing at all outside the window — not even a git call', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(h.spool.queued()).toEqual([]);
    expect(h.commands).toEqual([]);
    expect(h.gitCalls).toEqual([]);
  });

  it('does not deposit a second nightly while one is queued', async () => {
    const h = harness();
    await maybeRunNightly(h.deps, '/repo', h.git);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.spool.queued()).toHaveLength(1);
  });

  it('does not deposit a nightly while one is running', async () => {
    const h = harness();
    await maybeRunNightly(h.deps, '/repo', h.git);
    h.spool.claim(h.spool.queued()[0].file);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.spool.queued()).toEqual([]);
  });

  it('is held off by a result inside the gap', async () => {
    const h = harness();
    writeNightlyResult(h.paths, result({ submittedAt: new Date(IN_WINDOW - 60_000).toISOString() }));

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.spool.queued()).toEqual([]);
  });

  it('records ENVIRONMENT and deposits nothing when the checkout cannot be refreshed', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });
    h.exitCodes = [0, 0, 0, 1];

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(h.spool.queued()).toEqual([]);
    expect(readNightlyResult(h.paths)).toMatchObject({
      verdict: 'ENVIRONMENT',
      detail: expect.stringContaining('npm ci'),
    });
  });

  it('the recorded ENVIRONMENT stops it retrying for the rest of the window', async () => {
    const h = harness();
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });
    h.exitCodes = [1];
    await maybeRunNightly(h.deps, '/repo', h.git);
    const after = h.commands.length;

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.commands).toHaveLength(after);
  });

  it('records ENVIRONMENT when the checkout cannot be fingerprinted', async () => {
    const h = harness();
    h.fingerprintThrows = true;

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(h.spool.queued()).toEqual([]);
    expect(readNightlyResult(h.paths)).toMatchObject({
      verdict: 'ENVIRONMENT',
      detail: expect.stringContaining('tree vanished'),
    });
  });

  it('defaults the worker repo to the process cwd', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;

    // Not due, so nothing runs — this only pins the default down as reachable.
    await expect(maybeRunNightly(h.deps)).resolves.toBe(false);
  });

  describe('the main-moved trigger', () => {
    it('deposits a nightly when main has moved, even outside the window', async () => {
      const h = harness();
      h.clock.nowMs = OUTSIDE;
      writeNightlyResult(
        h.paths,
        result({
          sha: 'old-sha',
          submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS - 1).toISOString(),
        }),
      );
      h.mainSha = 'new-sha';

      expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);
      expect(h.spool.queued()).toHaveLength(1);
    });

    it('does not deposit for a main move still inside the 15-minute rate limit', async () => {
      const h = harness();
      h.clock.nowMs = OUTSIDE;
      writeNightlyResult(
        h.paths,
        result({ sha: 'old-sha', submittedAt: new Date(OUTSIDE - 60_000).toISOString() }),
      );
      h.mainSha = 'new-sha';

      expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
      expect(h.spool.queued()).toEqual([]);
      expect(h.commands).toEqual([]);
    });

    it('does not deposit a second one while a main-moved nightly is already queued', async () => {
      const h = harness();
      h.clock.nowMs = OUTSIDE;
      writeNightlyResult(
        h.paths,
        result({
          sha: 'old-sha',
          submittedAt: new Date(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS - 1).toISOString(),
        }),
      );
      h.mainSha = 'new-sha';
      await maybeRunNightly(h.deps, '/repo', h.git);

      expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
      expect(h.spool.queued()).toHaveLength(1);
    });
  });

  it('does not re-run when the current main sha was already proven, even inside the window past the gap', async () => {
    const h = harness();
    h.clock.nowMs = IN_WINDOW;
    writeNightlyResult(
      h.paths,
      result({ sha: 'same-sha', submittedAt: new Date(IN_WINDOW - NIGHTLY_MIN_GAP_MS).toISOString() }),
    );
    h.mainSha = 'same-sha';

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.spool.queued()).toEqual([]);
    expect(h.commands).toEqual([]);
  });

  it('the window trigger still deposits unchanged when origin/main cannot be resolved', async () => {
    // resolveRef returning undefined (offline, or nothing fetched yet) is exactly the
    // pre-feature shape: currentMainSha absent, so only the window/20h-gap schedule
    // applies — proven by the untouched default harness (mainSha undefined).
    const h = harness();

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);
    expect(h.spool.queued()).toHaveLength(1);
  });

  it('the window trigger no longer re-fires for an unchanged, already-proven main, even past the 20h gap', async () => {
    const h = harness();
    h.clock.nowMs = IN_WINDOW;
    writeNightlyResult(
      h.paths,
      result({ sha: 'main-sha-abc', submittedAt: new Date(IN_WINDOW - NIGHTLY_MIN_GAP_MS).toISOString() }),
    );
    // resolveRef reports the same sha the last nightly proved: nothing changed.
    h.mainSha = 'main-sha-abc';

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(h.spool.queued()).toEqual([]);
  });
});

describe('nightlyResultFromReport', () => {
  const fingerprint = (head: string): TreeFingerprint => ({ head, hash: 'h', clean: true });

  it('takes the sha the job actually started on', () => {
    const built = nightlyResultFromReport(
      {
        id: 'job-9',
        verdict: 'PASS',
        fingerprints: { atSubmit: fingerprint('at-submit'), atStart: fingerprint('at-start') },
        finishedAt: 'then',
        detail: 'live drive exited 0',
        logFile: '/logs/job-9.log',
      },
      { submittedAt: 'deposited-at' },
    );

    expect(built).toEqual({
      jobId: 'job-9',
      sha: 'at-start',
      verdict: 'PASS',
      submittedAt: 'deposited-at',
      finishedAt: 'then',
      detail: 'live drive exited 0',
      logFile: '/logs/job-9.log',
      trigger: 'scheduled',
      scheduledSubmittedAt: 'deposited-at',
    });
  });

  it('falls back to the deposit fingerprint when the job never started', () => {
    const built = nightlyResultFromReport(
      { id: 'job-9', verdict: 'ABANDONED', fingerprints: { atSubmit: fingerprint('at-submit') } },
      { submittedAt: 'deposited-at' },
    );

    expect(built.sha).toBe('at-submit');
  });

  it('stamps every scheduled write as the night\'s slot — the two stamps are the same value', () => {
    // What makes the 20 h gap keep its old arithmetic: a scheduled deposit IS the slot, so
    // scheduledSubmittedAt repeats submittedAt and only a MANUAL write can make them differ.
    const built = nightlyResultFromReport(
      { id: 'job-9', verdict: 'FAIL', fingerprints: { atSubmit: fingerprint('at-submit') } },
      { submittedAt: '2026-09-14T02:10:00.000Z', trigger: 'scheduled' },
    );

    expect(built.trigger).toBe('scheduled');
    expect(built.scheduledSubmittedAt).toBe('2026-09-14T02:10:00.000Z');
  });
});

/**
 * The 2026-09-03 trap, pinned.
 *
 * A single throttled fetch failed the nightly at 07:49:22Z. `ENVIRONMENT` records no sha,
 * `isMainMoved` needs two shas to compare, and so every trigger but the 03:00 window went
 * dead — `main` stayed unproven for the rest of the working day with eleven commits behind
 * it. The failure that mattered was not the fetch; it was that nothing tried again.
 */
describe('nightlyDue after a result that proved nothing', () => {
  const OUTSIDE = Date.UTC(2026, 8, 3, 18, 30, 0); // 18:30 UTC — nowhere near the window
  const failed = (submittedAt: number): NightlyResult => ({
    verdict: 'ENVIRONMENT',
    submittedAt: new Date(submittedAt).toISOString(),
    detail: 'git fetch failed while refreshing the nightly checkout',
  });

  it('is due again outside the window when the last attempt recorded no sha', () => {
    const last = failed(Date.UTC(2026, 8, 3, 7, 49, 22));
    expect(nightlyDue(last, false, OUTSIDE, 'main-sha', last.sha)).toBe(true);
  });

  it('is held off by the same 15-minute rate limit as a move, not retried in a tight loop', () => {
    const last = failed(OUTSIDE - 60_000);
    expect(nightlyDue(last, false, OUTSIDE, 'main-sha', last.sha)).toBe(false);
  });

  it('becomes due once that rate limit clears', () => {
    const last = failed(OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS - 1);
    expect(nightlyDue(last, false, OUTSIDE, 'main-sha', last.sha)).toBe(true);
  });

  it('stops as soon as a result proves the current sha — this is not an endless live drive', () => {
    // Any nightly that got far enough to drive records the sha it started on, so the retry
    // this opens can only ever cover attempts where nothing ran at all.
    const proven: NightlyResult = {
      verdict: 'PASS',
      submittedAt: new Date(OUTSIDE - 3_600_000).toISOString(),
      sha: 'main-sha',
    };
    expect(nightlyDue(proven, false, OUTSIDE, 'main-sha', proven.sha)).toBe(false);
  });

  it('a FAIL that names a sha does not retry either — the code was judged, not the environment', () => {
    const failedRun: NightlyResult = {
      verdict: 'FAIL',
      submittedAt: new Date(OUTSIDE - 3_600_000).toISOString(),
      sha: 'main-sha',
    };
    expect(nightlyDue(failedRun, false, OUTSIDE, 'main-sha', failedRun.sha)).toBe(false);
  });

  it('does not run while one is already queued or running', () => {
    const last = failed(Date.UTC(2026, 8, 3, 7, 49, 22));
    expect(nightlyDue(last, true, OUTSIDE, 'main-sha', last.sha)).toBe(false);
  });

  it('needs a current main sha — without one there is nothing to prove against', () => {
    const last = failed(Date.UTC(2026, 8, 3, 7, 49, 22));
    expect(nightlyDue(last, false, OUTSIDE, undefined, last.sha)).toBe(false);
  });
});

/**
 * #801 — the maintainer-requested proof of `main`.
 *
 * A nightly that FAILs for a reason that is not the code (2026-09-13: twelve
 * `connect ETIMEDOUT 158.69.153.134:8000` lines) sticks to `origin/main`'s tip until
 * somebody pushes a commit, and the orchestrator parks every card in the meantime. The
 * request marker is how a human says "re-measure that same tip" without any of it
 * becoming a way to deposit a nightly from outside the worker's idle branch.
 */
describe('manualProofDue', () => {
  it('is due when nothing has run at all', () => {
    expect(manualProofDue(false, OUTSIDE)).toBe(true);
  });

  it('is refused inside the 15-minute live-drive limit — a manual proof IS a live drive', () => {
    expect(manualProofDue(false, OUTSIDE, OUTSIDE - 60_000)).toBe(false);
  });

  it('holds the boundary — one ms short is refused, exactly on it is due', () => {
    expect(manualProofDue(false, OUTSIDE, OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS + 1)).toBe(false);
    expect(manualProofDue(false, OUTSIDE, OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS)).toBe(true);
  });

  it('is refused while a nightly is already queued or running', () => {
    expect(manualProofDue(true, OUTSIDE)).toBe(false);
  });

  it('treats an unparseable last-run stamp as no prior run', () => {
    expect(manualProofDue(false, OUTSIDE, NaN)).toBe(true);
  });

  it('ignores the window and the 20 h slot entirely — that is the point of asking', () => {
    // 12:00 UTC, nowhere near 02:00-05:00, and a scheduled run 30 minutes ago would still
    // hold the window path off for 20 h. Neither is a reason to refuse a human.
    expect(manualProofDue(false, OUTSIDE, OUTSIDE - NIGHTLY_MOVE_RATE_LIMIT_MS - 1)).toBe(true);
  });
});

describe('the manual request marker', () => {
  it('round-trips a well-formed request', () => {
    const h = harness();
    fileRequest(h);

    expect(readManualRequest(h.paths, () => {})).toMatchObject({
      sha: TIP,
      requestedBy: { user: 'maintainer', via: 'bench-cli' },
    });
  });

  it('reads an absent marker as nothing, without logging', () => {
    const h = harness();
    const logs: string[] = [];

    expect(readManualRequest(h.paths, line => logs.push(line))).toBeNull();
    expect(logs).toEqual([]);
  });

  it('deletes and logs an unparseable marker — a bad write must not wedge the idle loop', () => {
    const h = harness();
    fs.mkdirSync(h.paths.nightly, { recursive: true });
    fs.writeFileSync(manualRequestFile(h.paths), '{ not json', 'utf8');
    const logs: string[] = [];

    expect(readManualRequest(h.paths, line => logs.push(line))).toBeNull();
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(logs.join('\n')).toMatch(/unreadable manual request/);
  });

  it('deletes and logs a marker whose sha is not a 40-hex commit', () => {
    const h = harness();
    fileRequest(h, { sha: 'abc123' });
    const logs: string[] = [];

    expect(readManualRequest(h.paths, line => logs.push(line))).toBeNull();
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(logs.join('\n')).toMatch(/not a 40-hex commit/);
  });

  it('deletes and logs a marker with a blank reason — a live drive states why', () => {
    const h = harness();
    fileRequest(h, { requestedBy: requester({ reason: '   ' }) });
    const logs: string[] = [];

    expect(readManualRequest(h.paths, line => logs.push(line))).toBeNull();
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(logs.join('\n')).toMatch(/no reason/);
  });

  it('deletes and logs a marker with no requestedBy at all', () => {
    const h = harness();
    fs.mkdirSync(h.paths.nightly, { recursive: true });
    fs.writeFileSync(manualRequestFile(h.paths), JSON.stringify({ sha: TIP }), 'utf8');
    const logs: string[] = [];

    expect(readManualRequest(h.paths, line => logs.push(line))).toBeNull();
    expect(logs.join('\n')).toMatch(/no reason/);
  });

  it('deleteManualRequest is a no-op when there is nothing to delete', () => {
    const h = harness();
    expect(() => deleteManualRequest(h.paths)).not.toThrow();
  });
});

describe('manual records', () => {
  const record = (overrides: Partial<ManualNightlyRecord> = {}): ManualNightlyRecord => ({
    id: 'manual-1',
    requestedSha: TIP,
    requestedBy: requester(),
    attested: false,
    verdict: 'ENVIRONMENT',
    submittedAt: new Date(IN_WINDOW).toISOString(),
    trigger: 'manual',
    ...overrides,
  });

  it('writes into nightly/manual/, creating the directory, and leaves no .tmp behind', () => {
    const h = harness();
    writeManualRecord(h.paths, record());

    expect(JSON.parse(fs.readFileSync(manualRecordFile(h.paths, 'manual-1'), 'utf8'))).toMatchObject({
      id: 'manual-1',
      attested: false,
    });
    expect(fs.existsSync(`${manualRecordFile(h.paths, 'manual-1')}.tmp`)).toBe(false);
  });

  it('reads an absent directory as no records at all', () => {
    expect(readManualRecords(harness().paths)).toEqual([]);
    expect(newestManualDepositMs(harness().paths)).toBeUndefined();
  });

  it('skips an unreadable record rather than hiding the rest', () => {
    const h = harness();
    writeManualRecord(h.paths, record({ id: 'manual-good' }));
    fs.writeFileSync(manualRecordFile(h.paths, 'manual-bad'), '{ not json', 'utf8');
    fs.writeFileSync(path.join(h.paths.nightly, 'manual', 'notes.txt'), 'ignored', 'utf8');

    expect(readManualRecords(h.paths).map(r => r.id)).toEqual(['manual-good']);
  });

  it('newestManualDepositMs takes the largest parseable deposit stamp', () => {
    const h = harness();
    writeManualRecord(h.paths, { ...record({ id: 'manual-old' }), submittedAt: new Date(IN_WINDOW - 60_000).toISOString() });
    writeManualRecord(h.paths, { ...record({ id: 'manual-new' }), submittedAt: new Date(IN_WINDOW).toISOString() });
    writeManualRecord(h.paths, { ...record({ id: 'manual-broken' }), submittedAt: 'not a date' });

    expect(newestManualDepositMs(h.paths)).toBe(IN_WINDOW);
  });
});

describe('maybeRunNightly — the manual branch', () => {
  /** A red on file for TIP, deposited long enough ago not to trip the rate limit. */
  function redAtTip(h: Harness, sha: string = TIP): void {
    writeNightlyResult(
      h.paths,
      result({
        verdict: 'FAIL',
        sha,
        jobId: 'job-yesterday',
        submittedAt: new Date(h.clock.nowMs - NIGHTLY_MOVE_RATE_LIMIT_MS - 1).toISOString(),
        scheduledSubmittedAt: new Date(h.clock.nowMs - NIGHTLY_MOVE_RATE_LIMIT_MS - 1).toISOString(),
        trigger: 'scheduled',
      }),
    );
  }

  it('KEEPS the request while the 15-minute limit is still open — it waits, it is not refused', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    writeNightlyResult(
      h.paths,
      result({ verdict: 'FAIL', sha: TIP, submittedAt: new Date(OUTSIDE - 60_000).toISOString() }),
    );
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(true);
    expect(h.spool.queued()).toEqual([]);
    expect(h.commands).toEqual([]);
    expect(h.logs.join('\n')).toMatch(/waiting/);
  });

  it('KEEPS the request while a nightly is already pending', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    h.head = TIP;
    redAtTip(h);
    fileRequest(h);
    // One manual proof already deposited and claimed; a second request must wait, not race.
    await maybeRunNightly(h.deps, '/repo', h.git);
    h.spool.claim(h.spool.queued()[0].file);
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(true);
  });

  it('records already-green and drives nothing when latest.json is PASS at the requested sha', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    writeNightlyResult(
      h.paths,
      result({ verdict: 'PASS', sha: TIP, submittedAt: new Date(OUTSIDE - 3_600_000).toISOString() }),
    );
    const before = latestBytes(h);
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(latestBytes(h)).toEqual(before);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.commands).toEqual([]);
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({ outcome: 'already-green', attested: false, requestedSha: TIP }),
    ]);
  });

  it('a prepare failure leaves latest.json BYTE-IDENTICAL and records ENVIRONMENT beside it', async () => {
    // The load-bearing rule: a manual run that broke on the environment measured nothing,
    // so it must not clear the red it was asked to re-check.
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    redAtTip(h);
    const before = latestBytes(h);
    fs.mkdirSync(path.join(nightlyCheckout(h.paths), '.git'), { recursive: true });
    h.exitCodes = [0, 0, 0, 1]; // fetch, reset, clean, then npm ci fails
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(latestBytes(h)).toEqual(before);
    expect(h.spool.queued()).toEqual([]);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({
        verdict: 'ENVIRONMENT',
        outcome: 'prepare-failed',
        attested: false,
        detail: expect.stringContaining('npm ci'),
      }),
    ]);
  });

  it('a fingerprint failure is the same non-event — latest.json byte-identical, ENVIRONMENT recorded', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    redAtTip(h);
    const before = latestBytes(h);
    h.fingerprintThrows = true;
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(latestBytes(h)).toEqual(before);
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({
        verdict: 'ENVIRONMENT',
        outcome: 'prepare-failed',
        detail: expect.stringContaining('tree vanished'),
      }),
    ]);
  });

  it('records superseded, and drives nothing, when main moved before the refresh', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    redAtTip(h);
    const before = latestBytes(h);
    h.head = MOVED_TIP; // the checkout came back on a different tip than was confirmed
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);

    expect(latestBytes(h)).toEqual(before);
    expect(h.spool.queued()).toEqual([]);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({
        outcome: 'superseded',
        verdict: 'STALE',
        attested: false,
        requestedSha: TIP,
        sha: MOVED_TIP,
      }),
    ]);
  });

  it('deposits a nightly carrying trigger and requestedBy, and drops the marker', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    h.head = TIP;
    redAtTip(h);
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);

    const queued = h.spool.queued();
    expect(queued).toHaveLength(1);
    expect(queued[0].request).toMatchObject({
      type: 'nightly',
      branch: 'main',
      worktree: nightlyCheckout(h.paths),
      submitter: { pid: 0 },
      trigger: 'manual',
      requestedBy: { user: 'maintainer', host: 'bench-pc', via: 'bench-cli' },
      fingerprint: { head: TIP },
    });
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.logs.join('\n')).toContain('manual proof');
  });

  it('serves the manual request even outside the window and inside the 20 h slot', async () => {
    // Exactly the case the command exists for: 12:00 UTC, a scheduled run this morning.
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    h.head = TIP;
    redAtTip(h);
    fileRequest(h);

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);
  });

  it('a corrupt marker is discarded and the SCHEDULED path still runs on the same tick', async () => {
    const h = harness();
    fs.mkdirSync(h.paths.nightly, { recursive: true });
    fs.writeFileSync(manualRequestFile(h.paths), '{ not json', 'utf8');

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.spool.queued()[0].request.trigger).toBe('scheduled');
    expect(readManualRecords(h.paths)).toEqual([]);
  });

  it('a marker with a short sha is discarded and does not throw', async () => {
    const h = harness();
    fileRequest(h, { sha: 'deadbeef' });

    await expect(maybeRunNightly(h.deps, '/repo', h.git)).resolves.toBe(true);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('counts a manual deposit against the 15-minute limit for the NEXT request', async () => {
    const h = harness();
    h.clock.nowMs = OUTSIDE;
    h.head = TIP;
    redAtTip(h);
    fileRequest(h);
    await maybeRunNightly(h.deps, '/repo', h.git);
    // The first proof finished and left nothing pending; a second request arrives 1 min later.
    h.spool.discard(h.spool.queued()[0].file);
    fs.rmSync(nightlyResultFile(h.paths), { force: true });
    writeManualRecord(h.paths, {
      id: 'manual-just-now',
      requestedSha: TIP,
      requestedBy: requester(),
      attested: true,
      verdict: 'FAIL',
      sha: TIP,
      submittedAt: new Date(OUTSIDE).toISOString(),
      trigger: 'manual',
    });
    h.clock.nowMs = OUTSIDE + 60_000;
    fileRequest(h, { sha: MOVED_TIP });

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(false);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(true);
  });
});

describe('the 20 h gap is measured from the SCHEDULED stamp', () => {
  it('a manual write 90 minutes ago does not suppress the window run it never filled', async () => {
    const h = harness();
    // A manual proof landed at 01:30; the last SCHEDULED deposit was 21 h before now.
    writeNightlyResult(
      h.paths,
      result({
        verdict: 'FAIL',
        sha: MOVED_TIP,
        submittedAt: new Date(IN_WINDOW - 90 * 60_000).toISOString(),
        scheduledSubmittedAt: new Date(IN_WINDOW - 21 * 60 * 60_000).toISOString(),
        trigger: 'manual',
      }),
    );

    expect(await maybeRunNightly(h.deps, '/repo', h.git)).toBe(true);
    expect(h.spool.queued()[0].request.trigger).toBe('scheduled');
  });

  it('and a record with no scheduled stamp at all keeps the old arithmetic exactly', () => {
    // Every file written before #801 is this shape: the fallback must reproduce today's
    // answer, not change it.
    const legacy = result({ sha: MOVED_TIP, submittedAt: new Date(IN_WINDOW - 90 * 60_000).toISOString() });
    expect(legacy.scheduledSubmittedAt).toBeUndefined();
    expect(nightlyDue(legacy, false, IN_WINDOW)).toBe(false);

    const old = result({ sha: MOVED_TIP, submittedAt: new Date(IN_WINDOW - NIGHTLY_MIN_GAP_MS).toISOString() });
    expect(nightlyDue(old, false, IN_WINDOW)).toBe(true);
  });
});

describe('publishManualResult — attest-only replacement', () => {
  const fp = (head: string) => ({ head, hash: 'h', clean: true });
  const request = { submittedAt: 'deposited-at', fingerprint: fp(TIP), requestedBy: requester() };
  const report = (overrides: Partial<Parameters<typeof publishManualResult>[1]> = {}) => ({
    id: 'job-manual-1',
    verdict: 'PASS' as const,
    fingerprints: { atSubmit: fp(TIP), atStart: fp(TIP) },
    finishedAt: 'then',
    detail: 'live drive exited 0',
    logFile: '/logs/job-manual-1.log',
    ...overrides,
  });

  it('replaces latest.json on a PASS that measured the requested sha, with supersedes filled', () => {
    const h = harness();
    writeNightlyResult(
      h.paths,
      result({ verdict: 'FAIL', sha: TIP, jobId: 'job-red', finishedAt: 'yesterday', trigger: 'scheduled', scheduledSubmittedAt: 'scheduled-stamp' }),
    );

    publishManualResult(h.paths, report(), request);

    expect(readNightlyResult(h.paths)).toMatchObject({
      jobId: 'job-manual-1',
      sha: TIP,
      verdict: 'PASS',
      trigger: 'manual',
      scheduledSubmittedAt: 'scheduled-stamp',
      requestedBy: { user: 'maintainer' },
      supersedes: { jobId: 'job-red', sha: TIP, verdict: 'FAIL', trigger: 'scheduled', finishedAt: 'yesterday' },
    });
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({ id: 'job-manual-1', attested: true, verdict: 'PASS' }),
    ]);
  });

  it('replaces latest.json on a FAIL too — a manual proof may confirm the red', () => {
    const h = harness();
    writeNightlyResult(h.paths, result({ verdict: 'FAIL', sha: TIP }));

    publishManualResult(h.paths, report({ verdict: 'FAIL' }), request);

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'FAIL', trigger: 'manual' });
  });

  it('carries a pre-#801 record\'s own submittedAt forward as the scheduled stamp', () => {
    const h = harness();
    // No scheduledSubmittedAt: every record written before this existed was a scheduled one.
    writeNightlyResult(h.paths, result({ verdict: 'FAIL', sha: TIP, submittedAt: 'legacy-stamp' }));

    publishManualResult(h.paths, report(), request);

    expect(readNightlyResult(h.paths)?.scheduledSubmittedAt).toBe('legacy-stamp');
  });

  it('omits supersedes and the scheduled stamp when nothing was on file', () => {
    const h = harness();

    publishManualResult(h.paths, report(), request);

    const published = readNightlyResult(h.paths);
    expect(published?.supersedes).toBeUndefined();
    expect(published?.scheduledSubmittedAt).toBeUndefined();
  });

  for (const verdict of ['ENVIRONMENT', 'INTERRUPTED', 'STALE', 'BLOCKED', 'ABANDONED', 'DIRTY'] as const) {
    it(`leaves latest.json byte-identical on ${verdict}, and still records the outcome`, () => {
      const h = harness();
      writeNightlyResult(h.paths, result({ verdict: 'FAIL', sha: TIP, jobId: 'job-red' }));
      const before = latestBytes(h);

      publishManualResult(h.paths, report({ verdict }), request);

      expect(latestBytes(h)).toEqual(before);
      expect(readManualRecords(h.paths)).toEqual([
        expect.objectContaining({ id: 'job-manual-1', verdict, attested: false }),
      ]);
    });
  }

  it('leaves latest.json byte-identical when the driven sha is not the requested one', () => {
    const h = harness();
    writeNightlyResult(h.paths, result({ verdict: 'FAIL', sha: TIP }));
    const before = latestBytes(h);

    publishManualResult(h.paths, report({ fingerprints: { atSubmit: fp(TIP), atStart: fp(MOVED_TIP) } }), request);

    expect(latestBytes(h)).toEqual(before);
    expect(readManualRecords(h.paths)).toEqual([
      expect.objectContaining({ attested: false, requestedSha: TIP, sha: MOVED_TIP }),
    ]);
  });

  it('names an unknown requester rather than omitting one, for a job deposited by an older worker', () => {
    const h = harness();

    publishManualResult(h.paths, report(), { submittedAt: 'deposited-at', fingerprint: fp(TIP) });

    expect(readNightlyResult(h.paths)?.requestedBy).toMatchObject({ user: 'unknown', host: 'unknown' });
  });
});
