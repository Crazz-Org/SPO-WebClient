import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { benchPaths, ensureLayout, type BenchPaths } from './paths';
import { Spool, type JobReport } from './job';
import {
  manualRequestFile,
  readManualRequest,
  writeManualRecord,
  writeNightlyResult,
} from './nightly';
import { formatReport, main, parseArgs, type CliDeps } from './cli';

/** `origin/main`'s tip, as a real 40-hex sha — the marker refuses anything looser. */
const TIP = 'a1b2c3d4'.repeat(5);

interface Harness {
  deps: CliDeps;
  paths: BenchPaths;
  spool: Spool;
  out: string[];
  err: string[];
  alive: boolean;
  aliveReason?: string;
  clean: boolean;
  clock: { nowMs: number };
  /** What `git ls-remote origin refs/heads/main` answers; null makes the call throw. */
  lsRemote: string | null;
  interactive: boolean;
  /** What the human types at the confirmation prompt; null is EOF. */
  answer: string | null;
  /** Every question the command actually asked. */
  asked: string[];
}

function harness(): Harness {
  const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-cli-')));
  ensureLayout(paths);
  const spool = new Spool(paths);
  const h: Harness = {
    paths,
    spool,
    out: [],
    err: [],
    alive: true,
    clean: true,
    clock: { nowMs: 1_000_000 },
    lsRemote: `${TIP}\trefs/heads/main`,
    interactive: true,
    answer: TIP.slice(0, 8),
    asked: [],
    deps: {
      paths,
      spool,
      fingerprint: () => ({ head: 'abc123', hash: 'h1', clean: h.clean }),
      git: args => {
        if (args.includes('ls-remote')) {
          if (h.lsRemote === null) throw new Error('could not resolve host github.com');
          return h.lsRemote;
        }
        if (args.includes('--show-toplevel')) return '/wt/a';
        if (args.includes('--abbrev-ref')) return 'fix/x';
        return 'head-sha'; // rev-parse HEAD
      },
      workerAlive: () => ({ alive: h.alive, reason: h.aliveReason }),
      now: () => (h.clock.nowMs += 100),
      sleep: async () => {},
      pid: 777,
      out: line => h.out.push(line),
      err: line => h.err.push(line),
      env: {},
      isInteractive: () => h.interactive,
      promptLine: async question => {
        h.asked.push(question);
        return h.answer;
      },
      requesterIdentity: () => ({ user: 'maintainer', host: 'bench-pc', tty: '/dev/pts/3' }),
    },
  };
  return h;
}

function reportFor(id: string, overrides: Partial<JobReport> = {}): JobReport {
  return {
    id,
    type: 'ref',
    worktree: '/wt/a',
    branch: 'fix/x',
    verdict: 'PASS',
    fingerprints: { atSubmit: { head: 'abc123', hash: 'h1', clean: true } },
    targetMoved: false,
    startedAt: '2026-08-22T09:00:00Z',
    ...overrides,
  };
}

describe('parseArgs', () => {
  it('splits known flags from passthrough and positionals', () => {
    const parsed = parseArgs(['submit', '--type=lease', '--wait', '--manual-verified=ran it', 'extra']);
    expect(parsed.command).toBe('submit');
    expect(parsed.known.get('type')).toBe('lease');
    expect(parsed.known.get('wait')).toBe('true');
    expect(parsed.passthrough).toEqual(['--manual-verified=ran it']);
    expect(parsed.positional).toEqual(['extra']);
  });
});

describe('submit', () => {
  it('announces a dead worker immediately — exit 3, nothing queued', async () => {
    const h = harness();
    h.alive = false;
    h.aliveReason = 'heartbeat is 45 s old';
    expect(await main(['submit', '--type=ref'], h.deps)).toBe(3);
    expect(h.err[0]).toMatch(/WORKER DOWN: heartbeat is 45 s old/);
    expect(h.out.join('\n')).toMatch(/worker-down: heartbeat is 45 s old/);
    expect(h.spool.queued()).toHaveLength(0);
  });

  it('queues a job naming the COMMIT, run in the worker\'s own checkout', async () => {
    // Not the session's worktree: since #158 the subject of a gate is a pushed sha, and
    // the worker fetches it into a checkout it owns. `--ref` defaults to HEAD so a bare
    // submit still means something.
    const h = harness();
    expect(await main(['submit', '--type=ref'], h.deps)).toBe(0);
    const queued = h.spool.queued();
    expect(queued).toHaveLength(1);
    expect(queued[0].request).toMatchObject({
      type: 'ref',
      ref: 'head-sha',
      branch: 'head-sha',
      worktree: h.deps.paths.refCheckout,
      // No --wait: nobody stays alive to watch, so no pid is recorded.
      submitter: { pid: 0 },
    });
    expect(h.out.join('\n')).toContain(queued[0].request.id);
  });

  it('records the waiting process as submitter when --wait is given', async () => {
    const h = harness();
    // The harness clock advances 100 ms per call, so a 1-minute wait times out (exit 4)
    // almost at once; the deposit itself is what we check.
    expect(await main(['submit', '--type=ref', '--wait', '--timeout-min=1'], h.deps)).toBe(4);
    expect(h.spool.queued()[0].request.submitter.pid).toBe(777);
  });

  it('defaults a lease to 30 minutes', async () => {
    const h = harness();
    await main(['submit', '--type=lease'], h.deps);
    expect(h.spool.queued()[0].request.leaseMinutes).toBe(30);
  });

  it('forwards unrecognized flags to the job body verbatim', async () => {
    const h = harness();
    await main(['submit', '--type=ref', '--manual-verified=ran the Capitol flow'], h.deps);
    expect(h.spool.queued()[0].request.args).toEqual(['--manual-verified=ran the Capitol flow']);
  });

  it('refuses a duplicate deposit, naming the queued job — exit 2', async () => {
    const h = harness();
    await main(['submit', '--type=ref'], h.deps);
    const first = h.spool.queued()[0].request.id;
    expect(await main(['submit', '--type=ref'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain(first);
  });

  it('does NOT care about a dirty worktree — the subject is a pushed commit', async () => {
    // This used to be refused here. A ref job tests a sha on GitHub, so the state of the
    // session's working tree says nothing about what will be gated. The guard that still
    // matters — "you are about to gate HEAD while holding uncommitted work" — lives in
    // scripts/bench-gate.sh, the session-facing command, where it can name the fix.
    const h = harness();
    h.clean = false;
    expect(await main(['submit', '--type=ref'], h.deps)).toBe(0);
    expect(h.spool.queued()).toHaveLength(1);
  });

  it('still accepts a live or lease job on a dirty tree — they attest nothing', async () => {
    const h = harness();
    h.clean = false;
    expect(await main(['submit', '--type=live'], h.deps)).toBe(0);
    expect(h.spool.queued()).toHaveLength(1);
  });

  it('rejects an unknown job type', async () => {
    const h = harness();
    expect(await main(['submit', '--type=nonsense'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/unknown job type/);
  });

  it('fails plainly outside a git worktree', async () => {
    const h = harness();
    h.deps.git = () => {
      throw new Error('not a git repository');
    };
    expect(await main(['submit'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/not inside a git worktree/);
  });

  it('records the lease length on a lease job', async () => {
    const h = harness();
    await main(['submit', '--type=lease', '--lease-minutes=45'], h.deps);
    expect(h.spool.queued()[0].request.leaseMinutes).toBe(45);
  });

  it('--wait folds straight into the wait loop and returns the job verdict', async () => {
    const h = harness();
    // The report "arrives" as soon as the wait loop first checks for it.
    const originalRead = h.spool.readReport.bind(h.spool);
    h.spool.readReport = (id: string) => {
      h.spool.writeReport(reportFor(id));
      return originalRead(id);
    };
    expect(await main(['submit', '--type=ref', '--wait'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toMatch(/PASS/);
  });
});

describe('wait', () => {
  it('requires a job id', async () => {
    const h = harness();
    expect(await main(['wait'], h.deps)).toBe(1);
  });

  it('returns 0 on PASS and prints the report', async () => {
    const h = harness();
    h.spool.writeReport(reportFor('job-1'));
    expect(await main(['wait', 'job-1'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toMatch(/job-1 — PASS/);
  });

  it('returns 1 on any non-passing verdict', async () => {
    const h = harness();
    h.spool.writeReport(reportFor('job-1', { verdict: 'STALE', targetMoved: true }));
    expect(await main(['wait', 'job-1'], h.deps)).toBe(1);
    expect(h.out.join('\n')).toMatch(/tree CHANGED during the run/);
  });

  it('returns 0 on LEASED — the gateway is ready to drive', async () => {
    const h = harness();
    h.spool.writeReport(
      reportFor('job-1', { type: 'lease', verdict: 'LEASED', port: 8080, leaseUntil: '2026-08-22T10:00:00Z' }),
    );
    expect(await main(['wait', 'job-1'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toMatch(/port 8080 until/);
  });

  it('detects the worker dying mid-wait — exit 3', async () => {
    const h = harness();
    let checks = 0;
    h.deps.workerAlive = () => ({ alive: ++checks < 3, reason: 'pid gone' });
    expect(await main(['wait', 'job-1'], h.deps)).toBe(3);
    expect(h.err.join('\n')).toMatch(/WORKER DIED/);
    expect(h.out.join('\n')).toMatch(/worker-down:/);
  });

  it('times out with exit 4 when the report never lands', async () => {
    const h = harness();
    // now() advances 100 ms per call; a 1-minute budget runs out quickly.
    expect(await main(['wait', 'job-1', '--timeout-min=1'], h.deps)).toBe(4);
    expect(h.err.join('\n')).toMatch(/timed out/);
  });
});

describe('status', () => {
  it('shows a live worker with the queue', async () => {
    const h = harness();
    await main(['submit', '--type=ref'], h.deps);
    h.out = [];
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.out[0]).toMatch(/worker ALIVE/);
    expect(h.out.join('\n')).toMatch(/queued: 1/);
  });

  it('shows a dead worker — exit 3', async () => {
    const h = harness();
    h.alive = false;
    h.aliveReason = 'no worker registered';
    expect(await main(['status'], h.deps)).toBe(3);
    expect(h.out[0]).toMatch(/worker DOWN/);
  });
});

describe('formatReport', () => {
  it('includes the artifact and log pointers when present', () => {
    const text = formatReport(
      reportFor('job-1', { gateArtifact: '/wt/a/report/e2e/gate-abc.json', logFile: '/bench/done/job-1.log' }),
    );
    expect(text).toContain('gate artifact: /wt/a/report/e2e/gate-abc.json');
    expect(text).toContain('full log: /bench/done/job-1.log');
  });

  it('names the main the job was gated against, and says nothing when there is none', () => {
    expect(formatReport(reportFor('job-1', { baseMain: 'abcdef1234567890' }))).toContain(
      'gated against main abcdef12',
    );
    expect(formatReport(reportFor('job-1', {}))).not.toContain('gated against main');
  });
});

describe('release', () => {
  it('drops the release marker for the running lease of this worktree', async () => {
    const h = harness();
    await main(['submit', '--type=lease'], h.deps);
    h.spool.claim(h.spool.queued()[0].file);
    const id = h.spool.running()[0].request.id;
    expect(await main(['release'], h.deps)).toBe(0);
    expect(h.spool.releaseRequested(id)).toBe(true);
    expect(h.out.join('\n')).toContain(id);
  });

  it('reports when no lease is running for this worktree', async () => {
    const h = harness();
    expect(await main(['release'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/no running lease/);
  });

  it('fails plainly outside a git worktree', async () => {
    const h = harness();
    h.deps.git = () => {
      throw new Error('not a git repository');
    };
    expect(await main(['release'], h.deps)).toBe(1);
  });
});

describe('realCliDeps', () => {
  it('wires the production pieces without side effects', async () => {
    const { realCliDeps } = await import('./cli');
    const deps = realCliDeps();
    expect(typeof deps.now()).toBe('number');
    await deps.sleep(1);
    expect(deps.git(['rev-parse', '--is-inside-work-tree'])).toBe('true');
    expect(typeof deps.workerAlive().alive).toBe('boolean');
    expect(deps.pid).toBe(process.pid);
  });

  it('wires the request-nightly pieces too — and reads as non-interactive under Jest', async () => {
    const { realCliDeps } = await import('./cli');
    const deps = realCliDeps();
    expect(deps.env).toBe(process.env);
    // Jest gives the test process pipes, not a terminal, which is exactly the shape the
    // command refuses: nobody is there to confirm a sha.
    expect(deps.isInteractive()).toBe(false);
    const who = deps.requesterIdentity();
    expect(typeof who.user).toBe('string');
    expect(typeof who.host).toBe('string');
    expect(typeof who.tty).toBe('string');
  });
});

describe('unknown command', () => {
  it('is refused with usage guidance', async () => {
    const h = harness();
    expect(await main(['frobnicate'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/expected submit, wait, release, status or request-nightly/);
  });
});


/**
 * #801 — `request-nightly`, one test per row of the refusal table.
 *
 * The command drives the live world on the locked account, eventually. Every check below
 * exists so that a run only ever happens because a human at a terminal, who has read the
 * log, typed a sha back. The two exit-5 rows come first on purpose: they must refuse
 * before anything at all is written.
 */
describe('request-nightly', () => {
  const OK = ['request-nightly', '--reason=twelve connect ETIMEDOUT lines'];

  /** The marker's parsed content, or null when the command wrote nothing. */
  function marker(h: Harness) {
    return readManualRequest(h.paths, () => {});
  }

  it('refuses inside a Claude Code session — exit 5, and writes nothing', async () => {
    const h = harness();
    h.deps.env = { CLAUDECODE: '1' };

    expect(await main(OK, h.deps)).toBe(5);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.err.join('\n')).toMatch(/maintainer decision/);
    expect(h.asked).toEqual([]);
  });

  it('refuses without a terminal — exit 5, and writes nothing', async () => {
    const h = harness();
    h.interactive = false;

    expect(await main(OK, h.deps)).toBe(5);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.err.join('\n')).toMatch(/needs a terminal/);
  });

  it('refuses a missing --reason with usage — exit 1', async () => {
    const h = harness();
    expect(await main(['request-nightly'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/usage: request-nightly/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('refuses a blank --reason — a live drive states why it is happening', async () => {
    const h = harness();
    expect(await main(['request-nightly', '--reason=   '], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/usage: request-nightly/);
  });

  it('refuses an unknown --via — exit 1', async () => {
    const h = harness();
    expect(await main([...OK, '--via=sudo'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/unknown --via/);
  });

  it('reports a dead worker the same way submit does — exit 3', async () => {
    const h = harness();
    h.alive = false;
    h.aliveReason = 'heartbeat is 45 s old';

    expect(await main(OK, h.deps)).toBe(3);

    expect(h.out.join('\n')).toMatch(/worker-down: heartbeat is 45 s old/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('exits 6 when origin/main cannot be read at all', async () => {
    const h = harness();
    h.lsRemote = null;

    expect(await main(OK, h.deps)).toBe(6);

    expect(h.err.join('\n')).toMatch(/could not read origin\/main/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('exits 6 when ls-remote answers something that is not a commit sha', async () => {
    const h = harness();
    h.lsRemote = 'fatal: could not read Username';

    expect(await main(OK, h.deps)).toBe(6);
    expect(h.err.join('\n')).toMatch(/not a commit sha/);
  });

  it('refuses when latest.json is already PASS at the tip — exit 2, nothing to re-prove', async () => {
    const h = harness();
    writeNightlyResult(h.paths, { verdict: 'PASS', sha: TIP, submittedAt: 'then' });

    expect(await main(OK, h.deps)).toBe(2);

    expect(h.err.join('\n')).toMatch(/already green/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('refuses a second request while one is already on file — exit 2', async () => {
    const h = harness();
    expect(await main(OK, h.deps)).toBe(0);
    h.err = [];

    expect(await main(OK, h.deps)).toBe(2);
    expect(h.err.join('\n')).toMatch(/already on file/);
  });

  it('refuses when a nightly already targets the tip — exit 2', async () => {
    const h = harness();
    h.spool.submit(
      {
        type: 'nightly',
        worktree: '/bench/nightly/checkout',
        branch: 'main',
        fingerprint: { head: TIP, hash: 'h', clean: true },
        submitter: { pid: 0 },
        args: [],
      },
      h.clock.nowMs,
    );

    expect(await main(OK, h.deps)).toBe(2);

    expect(h.err.join('\n')).toMatch(/a nightly already targets/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('shows the tip, the record on file and every earlier manual proof of it before asking', async () => {
    const h = harness();
    writeNightlyResult(h.paths, {
      verdict: 'FAIL',
      sha: TIP,
      submittedAt: 'then',
      finishedAt: 'later',
      detail: 'live drive exited 1',
      logFile: '/bench/done/job-red.log',
      trigger: 'scheduled',
    });
    writeManualRecord(h.paths, {
      id: 'manual-earlier',
      requestedSha: TIP,
      requestedBy: {
        user: 'maintainer',
        host: 'bench-pc',
        tty: '/dev/pts/3',
        via: 'bench-cli',
        reason: 'first try',
        requestedAt: 'then',
      },
      attested: false,
      verdict: 'ENVIRONMENT',
      submittedAt: 'then',
      outcome: 'prepare-failed',
      trigger: 'manual',
    });

    expect(await main(OK, h.deps)).toBe(0);

    const printed = h.out.join('\n');
    expect(printed).toContain(`origin/main is at ${TIP}`);
    expect(printed).toMatch(/on file: FAIL \(scheduled\)/);
    expect(printed).toContain('live drive exited 1');
    expect(printed).toContain('/bench/done/job-red.log');
    expect(printed).toMatch(/earlier manual proof of this tip: manual-earlier — ENVIRONMENT \(prepare-failed\)/);
    expect(printed).toMatch(/drives the live world on the locked account/);
    expect(h.asked[0]).toContain(TIP);
  });

  it('says so plainly when no nightly has ever been recorded', async () => {
    const h = harness();
    expect(await main(OK, h.deps)).toBe(0);
    expect(h.out.join('\n')).toMatch(/on file: nothing/);
  });

  it('exits 2 and writes nothing when the confirmation does not match', async () => {
    const h = harness();
    h.answer = 'deadbeef';

    expect(await main(OK, h.deps)).toBe(2);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.err.join('\n')).toMatch(/not confirmed/);
  });

  it('exits 2 and writes nothing on EOF at the prompt', async () => {
    const h = harness();
    h.answer = null;

    expect(await main(OK, h.deps)).toBe(2);

    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
  });

  it('accepts the confirmation with surrounding whitespace and any case', async () => {
    const h = harness();
    h.answer = `  ${TIP.slice(0, 8).toUpperCase()}  `;

    expect(await main(OK, h.deps)).toBe(0);
    expect(marker(h)?.sha).toBe(TIP);
  });

  it('writes the marker holding the tip, a trimmed reason and the requester — exit 0', async () => {
    const h = harness();

    expect(await main(['request-nightly', '--reason=   the fetch timed out   '], h.deps)).toBe(0);

    expect(marker(h)).toMatchObject({
      sha: TIP,
      requestedBy: {
        user: 'maintainer',
        host: 'bench-pc',
        tty: '/dev/pts/3',
        via: 'bench-cli',
        reason: 'the fetch timed out',
      },
    });
    expect(h.out.join('\n')).toMatch(/the worker will drive main/);
    // It deposits NOTHING itself — the worker's idle branch is still the only depositor.
    expect(h.spool.queued()).toEqual([]);
    expect(fs.existsSync(`${manualRequestFile(h.paths)}.tmp-777`)).toBe(false);
  });

  it('records --via=spo as a label, and it grants nothing', async () => {
    const h = harness();
    expect(await main([...OK, '--via=spo'], h.deps)).toBe(0);
    expect(marker(h)?.requestedBy.via).toBe('spo');
  });

  it('loses the race gracefully when another terminal files one at the prompt — exit 2', async () => {
    // This is what link(2) buys over rename(2): the other terminal's request is still
    // there afterwards. A rename would have silently clobbered it, and one of the two
    // humans would never learn their request had been thrown away.
    const h = harness();
    h.deps.promptLine = async () => {
      fs.writeFileSync(
        manualRequestFile(h.paths),
        JSON.stringify({
          sha: TIP,
          requestedBy: {
            user: 'the-other-terminal',
            host: 'bench-pc',
            tty: '/dev/pts/9',
            via: 'bench-cli',
            reason: 'got here first',
            requestedAt: 'then',
          },
        }),
        'utf8',
      );
      return TIP.slice(0, 8);
    };

    expect(await main(OK, h.deps)).toBe(2);

    expect(h.err.join('\n')).toMatch(/could not file the request/);
    expect(marker(h)?.requestedBy.user).toBe('the-other-terminal');
    expect(fs.existsSync(`${manualRequestFile(h.paths)}.tmp-777`)).toBe(false);
  });

  it('REGRESSION: submit --type=nightly is still refused, and names the sanctioned way', async () => {
    const h = harness();

    expect(await main(['submit', '--type=nightly'], h.deps)).toBe(1);

    expect(h.err.join('\n')).toMatch(/unknown job type "nightly"/);
    expect(h.err.join('\n')).toMatch(/bench:nightly-request/);
    expect(h.spool.queued()).toEqual([]);
  });

  it('--reason and --via never leak into a job body as passthrough flags', async () => {
    // Without both in KNOWN_FLAGS they would be forwarded verbatim to verify-gate.js.
    const parsed = parseArgs(['request-nightly', '--reason=why', '--via=spo']);
    expect(parsed.passthrough).toEqual([]);
    expect(parsed.known.get('reason')).toBe('why');
    expect(parsed.known.get('via')).toBe('spo');
  });
});

describe('status — the nightly trigger and the pending request', () => {
  it('names the trigger on a queued nightly and shows a pending manual request', async () => {
    const h = harness();
    // The request goes first: with a nightly already queued for this tip the command would
    // (rightly) refuse at the "a nightly already targets" row and write nothing.
    expect(await main(['request-nightly', '--reason=re-measure'], h.deps)).toBe(0);
    h.spool.submit(
      {
        type: 'nightly',
        worktree: '/bench/nightly/checkout',
        branch: 'main',
        fingerprint: { head: TIP, hash: 'h', clean: true },
        submitter: { pid: 0 },
        args: [],
        trigger: 'manual',
      },
      h.clock.nowMs,
    );
    h.out = [];

    expect(await main(['status'], h.deps)).toBe(0);

    const printed = h.out.join('\n');
    expect(printed).toMatch(/\(nightly, manual\)/);
    expect(printed).toContain(`manual request pending: ${TIP} by maintainer`);
  });

  it('reads a nightly with no trigger as scheduled, and says nothing about a request that is absent', async () => {
    const h = harness();
    h.spool.submit(
      {
        type: 'nightly',
        worktree: '/bench/nightly/checkout',
        branch: 'main',
        fingerprint: { head: TIP, hash: 'h', clean: true },
        submitter: { pid: 0 },
        args: [],
      },
      h.clock.nowMs,
    );

    expect(await main(['status'], h.deps)).toBe(0);

    const printed = h.out.join('\n');
    expect(printed).toMatch(/\(nightly, scheduled\)/);
    expect(printed).not.toContain('manual request pending');
  });

  it('says out loud when it discards a corrupt marker, rather than deleting it in silence', async () => {
    const h = harness();
    fs.writeFileSync(manualRequestFile(h.paths), '{ not json', 'utf8');

    expect(await main(['status'], h.deps)).toBe(0);

    expect(h.err.join('\n')).toMatch(/unreadable manual request/);
    expect(fs.existsSync(manualRequestFile(h.paths))).toBe(false);
    expect(h.out.join('\n')).not.toContain('manual request pending');
  });

  it('adds no suffix to a non-nightly job', async () => {
    const h = harness();
    await main(['submit', '--type=ref'], h.deps);
    h.out = [];
    await main(['status'], h.deps);
    expect(h.out.join('\n')).toMatch(/\(ref\) /);
  });
});
