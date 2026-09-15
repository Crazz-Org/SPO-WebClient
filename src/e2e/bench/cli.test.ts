import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { benchPaths, ensureLayout, type BenchPaths } from './paths';
import { Spool, type JobReport } from './job';
import { formatReport, main, parseArgs, type CliDeps } from './cli';

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
    deps: {
      paths,
      spool,
      fingerprint: () => ({ head: 'abc123', hash: 'h1', clean: h.clean }),
      git: args => {
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
});

describe('unknown command', () => {
  it('is refused with usage guidance', async () => {
    const h = harness();
    expect(await main(['frobnicate'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/expected submit, wait, release or status/);
  });
});

