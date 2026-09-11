import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type runGit } from './fingerprint';
import { benchPaths, ensureLayout, readHeartbeat, readWorkerInfo, type BenchPaths } from './paths';
import { Spool, type JobRequest } from './job';
import { listVerdicts, publishPendingStatuses, writeVerdictIn } from './verdict';
import { readNightlyResult } from './nightly';
import { type GatewayDeps } from './gateway';
import {
  authEnvForGitArgs,
  mergeQueueDeps,
  NETWORK_SUBCOMMANDS,
  classifyStage,
  countCapabilityExceptions,
  DEADLINE_EXIT_CODE,
  liveAttestationFrom,
  main,
  mergeQueueDeps,
  nextGateAttempt,
  processOldest,
  realRunCommand,
  realWorkerDeps,
  recoverInterrupted,
  resolveLegacyLiveness,
  runJob,
  runWithDeadline,
  staticProofAttestationFrom,
  workerLoop,
  type WorkerDeps,
} from './worker';

interface Harness {
  deps: WorkerDeps;
  paths: BenchPaths;
  spool: Spool;
  worktree: string;
  commands: { cmd: string; args: string[]; cwd: string; env?: Record<string, string> }[];
  /** Queue of exit codes handed to successive runCommand calls (default 0). */
  exitCodes: number[];
  gatewayStarts: string[];
  /** The environment each gateway start was handed, in start order. */
  gatewayEnvs: Record<string, string>[];
  gatewayStops: number;
  logs: string[];
  submitterAlive: boolean;
  /** What deps.gitAuthEnv() returns; see ./git-auth. */
  gitAuthEnv: Record<string, string>;
  /** Successive fingerprint hashes; the last one repeats. */
  hashes: string[];
  /** What every fingerprint reports for `clean`. */
  clean: boolean;
  /** What `origin/main` resolves to in the worktree; undefined = the ref does not exist. */
  baseMain: string | undefined;
  published: string[];
  gatewayFails: boolean;
  /** What the owner lease answers when a job asks whether it may take the bench. */
  leaseDecision: { ok: boolean; why?: string };
  /** What CI is said to have concluded for the sha under test. See ./ci-proof. */
  ciProof: { proven: boolean; why?: string };
  /** How many times the loop asked the merge queue for work. */
  queueServed: number;
  /** What resolveRef answers for refs other than origin/main (e.g. `HEAD^{tree}`). */
  trees: Record<string, string | undefined>;
  /** The step name prepareRef reports as failed; null = the fetch worked. */
  prepareRefFails: string | null;
  /** Set to make prepareRef report a merge conflict instead of an ordinary failure. */
  prepareRefConflictBase: string | undefined;
  /** What prepareRef reports for `merged` on success. */
  prepareRefMerged: boolean;
  prepareRefCalls: string[];
  leaseRenewals: number;
  clock: { nowMs: number };
}

function harness(): Harness {
  const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-worker-')));
  ensureLayout(paths);
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-wt-'));
  // Same `log` the harness hands WorkerDeps below — production wires both through the one
  // logger too (realWorkerDeps), so an appendJobsLog failure surfaces exactly where every
  // other worker log line does.
  const spool = new Spool(paths, line => h.logs.push(line));
  let fingerprintCalls = 0;

  const h: Harness = {
    paths,
    spool,
    worktree,
    commands: [],
    exitCodes: [],
    gatewayStarts: [],
    gatewayEnvs: [],
    gatewayStops: 0,
    logs: [],
    submitterAlive: true,
    gitAuthEnv: { GIT_CONFIG_COUNT: '1' },
    hashes: ['h1'],
    clean: true,
    baseMain: 'main-sha-1',
    published: [],
    gatewayFails: false,
    leaseDecision: { ok: true },
    ciProof: { proven: false, why: 'no CI run for this commit yet' },
    queueServed: 0,
    trees: {},
    prepareRefFails: null,
    prepareRefConflictBase: undefined,
    prepareRefMerged: false,
    prepareRefCalls: [],
    leaseRenewals: 0,
    clock: { nowMs: 1_000_000 },
    deps: {
      paths,
      spool,
      port: 8080,
      fingerprint: wt => {
        const hash = h.hashes[Math.min(fingerprintCalls++, h.hashes.length - 1)];
        return { head: `head-of-${path.basename(wt)}`, hash, clean: h.clean };
      },
      resolveRef: (_wt, ref) => (ref === 'origin/main' ? h.baseMain : h.trees[ref]),
      runCommand: async (cmd, args, options) => {
        h.commands.push({ cmd, args, cwd: options.cwd, env: options.env });
        return h.exitCodes.shift() ?? 0;
      },
      gateway: {
        clearPort: async () => {},
        start: async (wt, _port, _logFile, env) => {
          if (h.gatewayFails) throw new Error('phase=caching forever');
          h.gatewayStarts.push(wt);
          h.gatewayEnvs.push(env);
          return { pid: 999, stop: async () => void h.gatewayStops++ };
        },
      },
      publishStatus: (_wt, head) => h.published.push(head),
      ciStaticProof: () => h.ciProof,
      serveMergeQueue: () => (h.queueServed++, 0),
      prepareRef: async ref => {
        h.prepareRefCalls.push(ref);
        // The real one resets a checkout on disk; the harness just makes the directory
        // exist, since everything downstream only asks whether it does.
        fs.mkdirSync(h.worktree, { recursive: true });
        if (h.prepareRefConflictBase) {
          return { failed: 'merge', conflictBase: h.prepareRefConflictBase };
        }
        return { failed: h.prepareRefFails, merged: h.prepareRefMerged };
      },
      mayDriveLive: () => h.leaseDecision,
      renewLease: async () => {
        h.leaseRenewals++;
        return { held: h.leaseDecision.ok };
      },
      processAlive: () => h.submitterAlive,
      now: () => (h.clock.nowMs += 10),
      sleep: async () => {},
      gitAuthEnv: () => h.gitAuthEnv,
      log: line => h.logs.push(line),
      currentJob: null,
    },
  };
  return h;
}

/** The `npm run <script>` targets the job asked for, in order. */
function npmRuns(h: Harness): string[] {
  return h.commands.filter(c => c.cmd === 'npm').map(c => c.args[1]);
}

/** Every verdict jobsLog has recorded so far, in append order — read through the real file. */
function jobsLogVerdicts(h: Harness): { id: string; verdict: string }[] {
  let raw: string;
  try {
    raw = fs.readFileSync(h.paths.jobsLog, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .map(l => ({ id: l.id, verdict: l.verdict }));
}

/**
 * A deposit shaped the way the client shapes one.
 *
 * The default is `ref`, because since #158 that IS the gate — the old worktree `gate` type
 * is gone, and every test that used to say 'gate' means "the job that produces an
 * attestation".
 */
function deposit(h: Harness, type: JobRequest['type'] = 'ref', args: string[] = []): JobRequest {
  return h.spool.submit(
    {
      type,
      worktree: h.worktree,
      branch: 'fix/x',
      fingerprint: { head: `head-of-${path.basename(h.worktree)}`, hash: 'h1', clean: true },
      submitter: { pid: 4321 },
      args,
      ...(type === 'lease' ? { leaseMinutes: 1 } : {}),
      ...(type === 'ref' ? { ref: `head-of-${path.basename(h.worktree)}` } : {}),
    },
    h.clock.nowMs,
  );
}

describe('recoverInterrupted', () => {
  it('reports running jobs as INTERRUPTED and clears the slot', () => {
    const h = harness();
    const job = deposit(h);
    h.spool.claim(h.spool.queued()[0].file);
    recoverInterrupted(h.deps);
    expect(h.spool.running()).toHaveLength(0);
    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('INTERRUPTED');
    expect(report?.detail).toMatch(/worker died/);
  });

  it('stamps the nightly result INTERRUPTED, so main never reads as proven by a dead job', () => {
    const h = harness();
    const job = deposit(h, 'nightly');
    h.spool.claim(h.spool.queued()[0].file);

    recoverInterrupted(h.deps);

    expect(readNightlyResult(h.paths)).toMatchObject({
      jobId: job.id,
      verdict: 'INTERRUPTED',
      submittedAt: job.submittedAt,
    });
  });

  it('leaves the nightly result alone when the interrupted job was a gate', () => {
    const h = harness();
    deposit(h);
    h.spool.claim(h.spool.queued()[0].file);

    recoverInterrupted(h.deps);

    expect(readNightlyResult(h.paths)).toBeNull();
  });

  it('an INTERRUPTED report reaches jobsLog — the state that never reaches runJob at all', () => {
    // B4.2's own warning, verbatim: "the state that by definition never reaches the normal
    // end of the job still never gets written". recoverInterrupted never calls runJob and
    // never returns through its finish() closure — it builds the report inline and hands it
    // to spool.writeReport directly. This only passes because the jobsLog append lives
    // INSIDE writeReport (job.ts), not bolted onto processOldest's own success path.
    const h = harness();
    const job = deposit(h);
    h.spool.claim(h.spool.queued()[0].file);

    recoverInterrupted(h.deps);

    expect(jobsLogVerdicts(h)).toEqual([{ id: job.id, verdict: 'INTERRUPTED' }]);
  });
});

describe('processOldest — the queue discipline', () => {
  it('returns false on an empty queue', async () => {
    expect(await processOldest(harness().deps)).toBe(false);
  });

  it('abandons a deposit whose session died, without running anything', async () => {
    const h = harness();
    const job = deposit(h);
    h.submitterAlive = false;
    expect(await processOldest(h.deps)).toBe(true);
    expect(h.spool.readReport(job.id)?.verdict).toBe('ABANDONED');
    expect(h.commands).toHaveLength(0);
    expect(h.spool.queued()).toHaveLength(0);
    // ABANDONED is written before runJob is ever called (there is no worktree to run
    // against) — the other non-attesting verdict that must not depend on reaching finish().
    expect(jobsLogVerdicts(h)).toEqual([{ id: job.id, verdict: 'ABANDONED' }]);
  });

  it('runs the oldest job end to end: claim, execute, report, release', async () => {
    const h = harness();
    const job = deposit(h);
    expect(await processOldest(h.deps)).toBe(true);
    expect(h.spool.readReport(job.id)?.verdict).toBe('PASS');
    expect(h.spool.queued()).toHaveLength(0);
    expect(h.spool.running()).toHaveLength(0);
  });

  it('writes the per-HEAD attestation for a gate job', async () => {
    const h = harness();
    deposit(h);
    await processOldest(h.deps);
    const verdicts = listVerdicts(h.paths);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toMatchObject({
      head: `head-of-${path.basename(h.worktree)}`,
      verdict: 'PASS',
      worktree: h.worktree,
    });
    // B2.5 — the real write path (not a hand-built fixture) never emits the removed
    // `fingerprintStable` field.
    expect(verdicts[0].verdict).not.toHaveProperty('fingerprintStable');
  });

  it('records the origin/main the run was judged against, in the report and the attestation', async () => {
    const h = harness();
    const job = deposit(h);
    await processOldest(h.deps);
    // The base is read AFTER `git fetch origin main`, or it would name a lagging local ref.
    expect(h.commands.some(c => c.cmd === 'git' && c.args[0] === 'fetch')).toBe(true);
    expect(h.spool.readReport(job.id)?.baseMain).toBe('main-sha-1');
    expect(listVerdicts(h.paths)[0].verdict.baseMain).toBe('main-sha-1');
  });

  it('leaves the base absent when origin/main does not resolve — never guesses one', async () => {
    const h = harness();
    h.baseMain = undefined;
    deposit(h);
    await processOldest(h.deps);
    expect(listVerdicts(h.paths)[0].verdict.baseMain).toBeUndefined();
  });

  it('carries the gate artifact\'s capability exceptions into the attestation', async () => {
    const h = harness();
    deposit(h);
    const artifactDir = path.join(h.worktree, 'report', 'e2e');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, `gate-head-of-${path.basename(h.worktree)}.json`),
      JSON.stringify({ exclusions: { capability: [{ capability: 'president' }] } }),
      'utf8',
    );
    await processOldest(h.deps);
    expect(listVerdicts(h.paths)[0].verdict.exceptions).toBe(1);
  });

  it('counts zero exceptions when the artifact is absent or unreadable', () => {
    expect(countCapabilityExceptions(undefined)).toBe(0);
    expect(countCapabilityExceptions('/nowhere/gate.json')).toBe(0);
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-')), 'gate.json');
    fs.writeFileSync(bad, '{not json', 'utf8');
    expect(countCapabilityExceptions(bad)).toBe(0);
  });

  // B2.1 — the attestation gains what the gate actually did. These are the exact class
  // measured on the real corpus (2026-09-03): 515 of 518 verdicts carried no `live` key
  // at all, and 17 artifacts recorded a skipped live stage in the same run that wrote PASS.
  describe('the attestation carries what the gate artifact actually proved', () => {
    function artifactPathFor(h: Harness): string {
      return path.join(h.worktree, 'report', 'e2e', `gate-head-of-${path.basename(h.worktree)}.json`);
    }
    function writeArtifact(h: Harness, body: unknown): void {
      const artifactDir = path.join(h.worktree, 'report', 'e2e');
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(artifactPathFor(h), JSON.stringify(body), 'utf8');
    }

    it('a gate whose live stage ran writes live.status "ran" with the flows it drove', async () => {
      const h = harness();
      deposit(h);
      writeArtifact(h, { live: { status: 'PASS', flows: [{ name: 'login-spine' }, { name: 'send-message' }] } });
      await processOldest(h.deps);
      expect(listVerdicts(h.paths)[0].verdict.live).toEqual({
        status: 'ran',
        flows: ['login-spine', 'send-message'],
      });
    });

    it('a gate that skipped with routed flows writes the skip and the flows it did not drive', async () => {
      const h = harness();
      deposit(h);
      writeArtifact(h, {
        live: { skipped: true, why: 'live stage requires --live (worker-only); routed flows: login-spine' },
        routing: { required: ['login-spine'] },
      });
      await processOldest(h.deps);
      expect(listVerdicts(h.paths)[0].verdict.live).toEqual({
        status: 'skipped',
        why: 'live stage requires --live (worker-only); routed flows: login-spine',
        required: ['login-spine'],
      });
    });

    it('a skip with nothing routed is distinguishable from a skip with routed flows', async () => {
      const h = harness();
      deposit(h);
      writeArtifact(h, {
        live: { skipped: true, why: 'nothing in this diff is observable over the wire' },
        routing: { required: [] },
      });
      await processOldest(h.deps);
      const live = listVerdicts(h.paths)[0].verdict.live;
      expect(live).toEqual({
        status: 'skipped',
        why: 'nothing in this diff is observable over the wire',
        required: [],
      });
      // And it must not equal the routed-flows case above.
      expect(live).not.toEqual({
        status: 'skipped',
        why: 'nothing in this diff is observable over the wire',
        required: ['login-spine'],
      });
    });

    it('an absent gate artifact produces an explicit unknown, never a shape that reads as "live ran"', async () => {
      const h = harness();
      // A build failure returns before report.gateArtifact is ever set (fetch ok, build fails).
      h.exitCodes = [0, 1];
      deposit(h);
      await processOldest(h.deps);
      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.live?.status).toBe('unknown');
      expect(verdict.live).not.toMatchObject({ status: 'ran' });
    });

    it('an unreadable gate artifact also produces unknown, not a false "ran"', async () => {
      const h = harness();
      deposit(h);
      const artifactDir = path.join(h.worktree, 'report', 'e2e');
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(artifactPathFor(h), '{not json at all', 'utf8');
      await processOldest(h.deps);
      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.live?.status).toBe('unknown');
      expect((verdict.live as { why: string }).why).toContain(
        `the gate artifact at ${artifactPathFor(h)} could not be read`,
      );
    });

    it('a gate BLOCKED by a live refusal (rate limit / dirty world) does not attest "ran"', async () => {
      const h = harness();
      deposit(h);
      writeArtifact(h, {
        live: { status: 'BLOCKED', flows: [], error: 'rate limit: 3 live runs in the last hour' },
        routing: { required: ['login-spine'] },
      });
      await processOldest(h.deps);
      const live = listVerdicts(h.paths)[0].verdict.live;
      expect(live?.status).not.toBe('ran');
      expect(live).toEqual({
        status: 'unknown',
        why: 'rate limit: 3 live runs in the last hour; routed flows: login-spine',
      });
    });

    it('carries staticProof "ci" when CI proved the sha', async () => {
      const h = harness();
      h.ciProof = { proven: true };
      deposit(h);
      writeArtifact(h, { live: { skipped: true, why: 'x' }, routing: { required: [] } });
      await processOldest(h.deps);
      expect(listVerdicts(h.paths)[0].verdict.staticProof).toEqual({ status: 'ci' });
    });

    it('carries staticProof "bench" with why when it replayed on the bench', async () => {
      const h = harness();
      h.ciProof = { proven: false, why: 'no CI run for this commit yet' };
      deposit(h);
      writeArtifact(h, { live: { skipped: true, why: 'x' }, routing: { required: [] } });
      await processOldest(h.deps);
      expect(listVerdicts(h.paths)[0].verdict.staticProof).toEqual({
        status: 'bench',
        why: 'no CI run for this commit yet',
      });
    });

    it('staticProof reads unknown when the gate never reached the static-proof question', async () => {
      const h = harness();
      h.exitCodes = [0, 1]; // fetch ok, build:server fails; returns before staticProof is ever set
      deposit(h);
      await processOldest(h.deps);
      expect(listVerdicts(h.paths)[0].verdict.staticProof).toEqual({ status: 'unknown' });
    });
  });

  describe('liveAttestationFrom — unit', () => {
    it('reads a "ran" live block with named flows', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(file, JSON.stringify({ live: { status: 'PASS', flows: [{ name: 'a' }, { name: 'b' } ] } }));
      expect(liveAttestationFrom(file)).toEqual({ status: 'ran', flows: ['a', 'b'] });
    });

    it('drops a flow entry with no readable name rather than inventing one', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(file, JSON.stringify({ live: { status: 'PASS', flows: [{ name: 'a' }, {}] } }));
      expect(liveAttestationFrom(file)).toEqual({ status: 'ran', flows: ['a'] });
    });

    it('reads a skipped live block, defaulting required to empty when routing is absent', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(file, JSON.stringify({ live: { skipped: true, why: 'no --live' } }));
      expect(liveAttestationFrom(file)).toEqual({ status: 'skipped', why: 'no --live', required: [] });
    });

    it('is unknown for undefined, missing, unreadable, and a null live block alike', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const missing = path.join(dir, 'nope.json');
      const bad = path.join(dir, 'bad.json');
      fs.writeFileSync(bad, '{not json');
      const nullLive = path.join(dir, 'null-live.json');
      fs.writeFileSync(nullLive, JSON.stringify({ live: null }));

      expect(liveAttestationFrom(undefined).status).toBe('unknown');
      expect(liveAttestationFrom(missing).status).toBe('unknown');
      expect(liveAttestationFrom(bad).status).toBe('unknown');
      expect(liveAttestationFrom(nullLive).status).toBe('unknown');
    });

    // M1: `'ran'` must be asserted from `live.status`, never the fallthrough of "not a
    // skip". A `live` block with no `skipped` key is exactly what verify-gate.js writes
    // for BLOCKED/ENVIRONMENT (LiveRunResult, src/e2e/run.ts) — none of these may read 'ran'.
    it('a BLOCKED live refusal (no `skipped` key) does not read as "ran"', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          live: { status: 'BLOCKED', flows: [], error: 'world lock held by another branch' },
          routing: { required: ['login-spine'] },
        }),
      );
      expect(liveAttestationFrom(file)).toEqual({
        status: 'unknown',
        why: 'world lock held by another branch; routed flows: login-spine',
      });
    });

    it('an ENVIRONMENT preflight abort (no `skipped` key) does not read as "ran"', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(
        file,
        JSON.stringify({ live: { status: 'ENVIRONMENT', flows: [], error: 'gateway: connect refused' } }),
      );
      expect(liveAttestationFrom(file)).toEqual({ status: 'unknown', why: 'gateway: connect refused' });
    });

    it('a live.status this code has never seen does not read as "ran"', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const file = path.join(dir, 'gate.json');
      fs.writeFileSync(file, JSON.stringify({ live: { status: 'TOTALLY_NEW', flows: [{ name: 'a' }] } }));
      const attestation = liveAttestationFrom(file);
      expect(attestation.status).not.toBe('ran');
      expect(attestation.status).toBe('unknown');
    });

    // M2: the read/parse failure must not be thrown away — a missing artifact (ENOENT;
    // the 145-of-393 "filed under the merge commit's sha" case) has to stay distinguishable
    // from a corrupt/truncated one, at least in the caught error text.
    it('keeps a missing artifact distinguishable from an unparseable one via the caught error', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-art-'));
      const missing = path.join(dir, 'nope.json');
      const bad = path.join(dir, 'bad.json');
      fs.writeFileSync(bad, '{not json at all');

      const missingWhy = (liveAttestationFrom(missing) as { why: string }).why;
      const badWhy = (liveAttestationFrom(bad) as { why: string }).why;

      expect(missingWhy).toContain('ENOENT');
      expect(missingWhy).not.toEqual(badWhy);
      expect(liveAttestationFrom(undefined)).toEqual({
        status: 'unknown',
        why: 'no gate artifact was recorded for this run',
      });
    });
  });

  describe('staticProofAttestationFrom — unit', () => {
    it('maps used:true to status "ci"', () => {
      expect(staticProofAttestationFrom({ used: true })).toEqual({ status: 'ci' });
    });

    it('maps used:false to status "bench" carrying why', () => {
      expect(staticProofAttestationFrom({ used: false, why: 'no CI run yet' })).toEqual({
        status: 'bench',
        why: 'no CI run yet',
      });
    });

    it('maps undefined to status "unknown"', () => {
      expect(staticProofAttestationFrom(undefined)).toEqual({ status: 'unknown' });
    });
  });

  it('still reports when runJob itself throws', async () => {
    const h = harness();
    const job = deposit(h);
    h.deps.gateway.clearPort = async () => {
      throw new Error('port stuck');
    };
    await processOldest(h.deps);
    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('FAIL');
    expect(report?.detail).toMatch(/port stuck/);
    expect(h.spool.running()).toHaveLength(0);
  });
});

describe('runJob — gate', () => {
  it('builds in the worktree, then runs verify-gate with the shared world state', async () => {
    const h = harness();
    const job = deposit(h);
    await runJob(h.deps, job);
    expect(h.commands[0]).toMatchObject({ cmd: 'git', args: ['fetch', '--quiet', 'origin', 'main'], cwd: h.worktree });
    expect(h.commands[1]).toMatchObject({ cmd: 'npm', args: ['run', 'build:server'], cwd: h.worktree });
    // B4.1/B4.3: the worker always tells verify-gate.js the deposited sha and this
    // target's attempt count, ahead of anything a caller supplied in request.args.
    const depositedSha = `head-of-${path.basename(h.worktree)}`;
    expect(h.commands[2]).toMatchObject({
      cmd: 'node',
      args: ['scripts/verify-gate.js', '--live', `--deposited-sha=${depositedSha}`, '--attempt=1'],
      cwd: h.worktree,
    });
    expect(h.commands[2].env?.E2E_WORLD_STATE_DIR).toBe(h.paths.world);
    expect(h.gatewayStarts).toEqual([h.worktree]);
    expect(h.gatewayStops).toBe(1);
  });

  it('places its own --deposited-sha/--attempt ahead of request.args, so its own values win', async () => {
    // flag() in verify-gate.js resolves the FIRST match in argv — a caller-forwarded
    // --attempt must never override the count the bench itself is tracking (B4.3), which
    // is exactly the class of bug that let 314 of 314 real artifacts read attempt: 1.
    const h = harness();
    const job = deposit(h, 'ref', ['--attempt=99', '--flows=login-spine']);
    await runJob(h.deps, job);
    const depositedSha = `head-of-${path.basename(h.worktree)}`;
    expect(h.commands[2]).toMatchObject({
      cmd: 'node',
      args: [
        'scripts/verify-gate.js',
        '--live',
        `--deposited-sha=${depositedSha}`,
        '--attempt=1',
        '--attempt=99',
        '--flows=login-spine',
      ],
    });
  });

  it('points the gateway and the body at the bench-wide asset cache, not the worktree', async () => {
    const h = harness();
    const job = deposit(h);
    await runJob(h.deps, job);
    // The gateway is what primes and reads the mirror; without this it would download
    // all ~570 files into a fresh worktree on the bench's exclusive time.
    expect(h.gatewayEnvs).toEqual([
      { E2E_WORLD_STATE_DIR: h.paths.world, SPO_CACHE_DIR: h.paths.cache },
    ]);
    // verify-gate replays the Jest suite when there is no receipt, and tests that read
    // real assets must be pointed at the same mirror or they silently self-skip.
    expect(h.commands[2].env?.SPO_CACHE_DIR).toBe(h.paths.cache);
  });

  it('builds the gateway alone — no client bundle, no terrain-test, for a browserless drive', async () => {
    const h = harness();
    await runJob(h.deps, deposit(h));
    expect(npmRuns(h)).toEqual(['build:server']);
  });



  it('maps every verify-gate exit code explicitly: 0 PASS, 1 FAIL, 2 BLOCKED, 3 ENVIRONMENT', async () => {
    // One code per outcome, matching the EXIT table in scripts/verify-gate.js. The pair
    // that matters is 3 -> ENVIRONMENT: the gate used to exit 1 for it, so a run that
    // judged nothing arrived here as FAIL and was attested as a verdict on the code.
    for (const [code, verdict] of [
      [0, 'PASS'],
      [1, 'FAIL'],
      [2, 'BLOCKED'],
      [3, 'ENVIRONMENT'],
    ] as const) {
      const h = harness();
      const job = deposit(h);
      h.exitCodes = [0, 0, code]; // fetch, build, body
      const report = await runJob(h.deps, job);
      expect(report.verdict).toBe(verdict);
      expect(report.detail).toBe(`verify-gate exited ${code} (${verdict})`);
    }
  });

  it('reads a code the table does not name as FAIL — never as a silent pass', async () => {
    const h = harness();
    const job = deposit(h);
    h.exitCodes = [0, 0, 139]; // e.g. killed by a signal
    expect((await runJob(h.deps, job)).verdict).toBe('FAIL');
  });

  it('ignores a failed origin/main fetch — offline, the gate falls back on its own', async () => {
    const h = harness();
    const job = deposit(h);
    h.exitCodes = [128]; // fetch fails, everything after defaults to 0
    expect((await runJob(h.deps, job)).verdict).toBe('PASS');
  });

  it('fails without starting a gateway when the build fails', async () => {
    const h = harness();
    const job = deposit(h);
    h.exitCodes = [0, 1]; // fetch ok, build fails
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('FAIL');
    expect(report.detail).toMatch(/npm run build:server failed/);
    expect(h.gatewayStarts).toHaveLength(0);
  });

  it('reports ENVIRONMENT when the gateway never becomes ready', async () => {
    const h = harness();
    const job = deposit(h);
    h.gatewayFails = true;
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('ENVIRONMENT');
    expect(report.detail).toMatch(/never became ready/);
  });

  it('never lets an ENVIRONMENT overwrite a good attestation for the same sha', async () => {
    // The destructive shape this guards: a sha gates PASS, then anything that runs no
    // code — a gateway that will not come up, a lease that cannot be renewed — replaces
    // that attestation and publishes `bench/gate=error` on a commit that genuinely passed.
    const h = harness();
    await processOldest(h.deps);
    deposit(h);
    await processOldest(h.deps);
    expect(listVerdicts(h.paths)[0].verdict.verdict).toBe('PASS');

    h.gatewayFails = true;
    deposit(h);
    await processOldest(h.deps);

    const verdicts = listVerdicts(h.paths);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict.verdict).toBe('PASS');
  });

  describe('which verdicts may write verdicts/<sha>.json', () => {
    // An attestation is the one artefact the merge rule trusts, and merge-queue.ts treats
    // any existing one as "already answered" — so a sha is never re-gated once a file
    // exists for it. Every verdict therefore has exactly one right answer here, and the
    // pairs are pinned rather than left to follow from whatever the guard happens to test.
    const attests: [string, (h: Harness) => void][] = [
      ['PASS', () => {}],
      ['FAIL', h => void (h.exitCodes = [0, 0, 1])],
      ['BLOCKED', h => void (h.exitCodes = [0, 0, 2])],
      // STALE is a real judgement — the tree moved under a run that did read the code —
      // so it attests, and the hook refuses it for being unstable rather than absent.
      ['STALE', h => void (h.hashes = ['h1', 'h2'])],
    ];

    const attestsNot: [string, string, (h: Harness) => void][] = [
      ['DIRTY', 'the tree is not the sha', h => void (h.clean = false)],
      ['ENVIRONMENT', 'the live stage aborted', h => void (h.exitCodes = [0, 0, 3])],
      ['ENVIRONMENT', 'the gateway never came up', h => void (h.gatewayFails = true)],
      ['ENVIRONMENT', 'the ref could not be fetched', h => void (h.prepareRefFails = 'fetch')],
      [
        'ENVIRONMENT',
        'the owner lease was refused',
        h => void (h.leaseDecision = { ok: false, why: 'another host holds it' }),
      ],
      [
        'ABANDONED',
        'the worktree was gone',
        h => {
          h.deps.prepareRef = async () => {
            fs.rmSync(h.worktree, { recursive: true, force: true });
            return { failed: null };
          };
        },
      ],
    ];

    it.each(attests)('%s attests: the run judged the code', async (verdict, arrange) => {
      const h = harness();
      arrange(h);
      deposit(h);
      await processOldest(h.deps);
      expect(listVerdicts(h.paths).map(v => v.verdict.verdict)).toEqual([verdict]);
    });

    it.each(attestsNot)('%s attests nothing — %s', async (verdict, _why, arrange) => {
      const h = harness();
      arrange(h);
      const job = deposit(h);
      await processOldest(h.deps);
      expect(h.spool.readReport(job.id)?.verdict).toBe(verdict);
      expect(listVerdicts(h.paths)).toHaveLength(0);
      // No file, so nothing for the publisher to post: `bench/gate` stays unset on the sha.
      publishPendingStatuses(h.paths, h.deps.publishStatus, h.deps.log, h.clock.nowMs);
      expect(h.published).toEqual([]);
    });

    it.each(attestsNot)(
      'a later %s leaves an earlier PASS for the same sha untouched (%s)',
      async (_verdict, _why, arrange) => {
        const h = harness();
        deposit(h);
        await processOldest(h.deps);
        const passed = listVerdicts(h.paths)[0].verdict;
        expect(passed.verdict).toBe('PASS');

        arrange(h);
        deposit(h);
        await processOldest(h.deps);

        // Same sha, same file: byte-for-byte the attestation the passing run wrote.
        expect(listVerdicts(h.paths).map(v => v.verdict)).toEqual([passed]);
      },
    );
  });

  it('reports ABANDONED when the worktree vanished from disk', async () => {
    // A worktree job only: a `ref` job's checkout is CREATED by prepareRef, so the
    // directory cannot be missing by the time this check runs.
    const h = harness();
    const job = deposit(h, 'live');
    fs.rmSync(h.worktree, { recursive: true, force: true });
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('ABANDONED');
    expect(h.commands).toHaveLength(0);
  });

  it('refuses a gate on a dirty tree: DIRTY, nothing built, no gateway, no attestation', async () => {
    const h = harness();
    const job = deposit(h);
    h.clean = false;
    await processOldest(h.deps);
    expect(h.spool.readReport(job.id)?.verdict).toBe('DIRTY');
    expect(h.spool.readReport(job.id)?.detail).toMatch(/commit first/);
    expect(h.commands).toHaveLength(0);
    expect(h.gatewayStarts).toHaveLength(0);
    expect(listVerdicts(h.paths)).toHaveLength(0);
  });

  it('refuses to take the bench without the owner lease, before clearing the port', async () => {
    // The refusal has to land BEFORE clearPort: that call SIGKILLs whatever holds 8080,
    // and on a second host it would be killing the other worker's gateway.
    const h = harness();
    const job = deposit(h);
    let cleared = 0;
    h.deps.gateway.clearPort = async () => void cleared++;
    h.leaseDecision = { ok: false, why: 'BENCH_OWNER has lapsed and could not be renewed' };

    await processOldest(h.deps);

    expect(cleared).toBe(0);

    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('ENVIRONMENT');
    expect(report?.detail).toMatch(/lapsed/);
    expect(h.commands).toHaveLength(0);
    expect(h.gatewayStarts).toHaveLength(0);
    // ENVIRONMENT attests nothing — the sha is neither passed nor failed.
    expect(listVerdicts(h.paths)).toHaveLength(0);
  });

  it('publishes a finished nightly to latest.json and attests nothing', async () => {
    const h = harness();
    const job = deposit(h, 'nightly');

    await processOldest(h.deps);

    expect(readNightlyResult(h.paths)).toMatchObject({
      jobId: job.id,
      verdict: 'PASS',
      submittedAt: job.submittedAt,
      sha: `head-of-${path.basename(h.worktree)}`,
    });
    // A nightly is not a gate: no sha of main may carry an attestation the push hook
    // or a bench/gate commit status could read.
    expect(listVerdicts(h.paths)).toHaveLength(0);
  });

  it('publishes a failing nightly too — red is the case the file exists for', async () => {
    const h = harness();
    deposit(h, 'nightly');
    h.exitCodes = [0, 0, 0, 1]; // fetch, build:server, build:e2e, then the drive fails

    await processOldest(h.deps);

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'FAIL' });
  });

  it('a world-lock refusal reads as BLOCKED, not FAIL — nothing ran, main does not go red', async () => {
    const h = harness();
    deposit(h, 'nightly');
    h.exitCodes = [0, 0, 0, 2]; // fetch, build:server, build:e2e, then run.js exits BLOCKED

    await processOldest(h.deps);

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'BLOCKED' });
  });

  it('a preflight abort reads as ENVIRONMENT, not FAIL — main does not go red', async () => {
    const h = harness();
    deposit(h, 'nightly');
    h.exitCodes = [0, 0, 0, 3]; // fetch, build:server, build:e2e, then run.js exits ENVIRONMENT

    await processOldest(h.deps);

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'ENVIRONMENT' });
  });

  it('maps a live job exit code the same way as the gate — BLOCKED, not FAIL', async () => {
    const h = harness();
    const job = deposit(h, 'live');
    h.exitCodes = [0, 0, 0, 2]; // fetch, build:server, build:e2e, then run.js exits BLOCKED
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('BLOCKED');
    expect(report.detail).toMatch(/live drive exited 2 \(BLOCKED\)/);
  });

  it('runs a live job on a dirty tree — only gate attests a sha', async () => {
    const h = harness();
    const job = deposit(h, 'live');
    h.clean = false;
    await processOldest(h.deps);
    expect(h.spool.readReport(job.id)?.verdict).toBe('PASS');
  });

  it('downgrades a PASS to STALE when the tree moved, keeping the body verdict visible', async () => {
    // A worktree job only: this is the deposit-vs-start half of the comparison, which a
    // `ref` job waives because its checkout is reset to the ref AFTER the deposit. The
    // start-vs-end half still applies to both — see the ref describe above.
    const h = harness();
    const job = deposit(h, 'live');
    h.hashes = ['h2', 'h2']; // differs from the h1 taken at deposit
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('STALE');
    expect(report.bodyVerdict).toBe('PASS');
    expect(report.targetMoved).toBe(true);
    expect(report.detail).toMatch(/tree changed between deposit/);
  });

  it('marks the target moved on a FAIL too, without renaming the verdict', async () => {
    const h = harness();
    const job = deposit(h);
    h.hashes = ['h2', 'h3'];
    h.exitCodes = [0, 0, 1];
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('FAIL');
    expect(report.targetMoved).toBe(true);
  });
});

describe('runJob — ref: gating a commit the worker fetched', () => {
  /** A ref deposit, shaped the way cli.ts shapes one: the fingerprint names the ref. */
  function depositRef(h: Harness, ref = 'a'.repeat(40)): JobRequest {
    return h.spool.submit(
      {
        type: 'ref',
        worktree: h.worktree,
        branch: ref,
        fingerprint: { head: ref, hash: `ref:${ref}`, clean: true },
        submitter: { pid: 0 },
        args: [],
        ref,
      },
      h.clock.nowMs,
    );
  }

  it('fetches the ref before anything else, then gates it like any other commit', async () => {
    const h = harness();
    const job = depositRef(h);

    await processOldest(h.deps);

    expect(h.prepareRefCalls).toEqual(['a'.repeat(40)]);
    expect(npmRuns(h)).toEqual(['build:server']);
    expect(h.commands.some(c => c.args[0] === 'scripts/verify-gate.js')).toBe(true);
    expect(h.spool.readReport(job.id)?.verdict).toBe('PASS');
  });

  it('is never STALE for a tree it reset itself — a fetched commit cannot move', async () => {
    // The deposit fingerprint names the ref, and the checkout is reset AFTER it; the two
    // can never match. Under the worktree rule that reads as a moving target, which would
    // make every ref job STALE and the whole path useless.
    const h = harness();
    const job = depositRef(h);

    await processOldest(h.deps);

    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('PASS');
    expect(report?.targetMoved).toBe(false);
  });

  it('still catches a tree that moves DURING the run', async () => {
    // The atSubmit half is waived, not the atStart/atEnd half: something rewriting the
    // checkout mid-job is a real fault whatever caused it, and a PASS from it would
    // describe a tree that no longer exists.
    const h = harness();
    h.hashes = ['at-start', 'moved-underneath'];
    const job = depositRef(h);

    await processOldest(h.deps);

    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('STALE');
    expect(report?.bodyVerdict).toBe('PASS');
    // B2.5 — the fact survives into the persisted attestation via the STALE verdict word
    // itself; there is no longer a separate `fingerprintStable` boolean repeating it.
    expect(listVerdicts(h.paths)[0].verdict.verdict).toBe('STALE');
  });

  it('attests where the merge rule reads — a ref job IS the gate now', async () => {
    // Stage B kept this answer in `ref/verdicts/` under a non-required context, so one
    // live exercise could be compared against the session path without either overwriting
    // the other. That comparison ran for real (job-01787603001316-a0c610: PASS on
    // 514bc4e3, `verdicts/` untouched, published as `bench/ref-gate`) and stage C promotes
    // the path. An attestation nobody reads would gate nothing.
    const h = harness();
    depositRef(h);

    await processOldest(h.deps);

    const verdicts = listVerdicts(h.paths);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toMatchObject({ verdict: 'PASS' });
  });

  it('publishes it as the required context', async () => {
    const h = harness();
    depositRef(h);
    await processOldest(h.deps);

    await workerLoop(h.deps, 1, async () => false);

    expect(h.published).toHaveLength(1);
  });

  it('skips the static stage when CI proved this exact sha, and says who proved it', async () => {
    const h = harness();
    h.ciProof = { proven: true };
    const job = depositRef(h);

    await processOldest(h.deps);

    const verify = h.commands.find(c => c.args[0] === 'scripts/verify-gate.js');
    expect(verify?.args).toContain('--skip-static');
    // The artifact must name its witness. Recording CI as RECEIPT would make two different
    // authorities indistinguishable in the one file a human reads afterwards.
    expect(verify?.args).toContain('--static-from=ci');
    expect(h.spool.readReport(job.id)?.staticProof).toEqual({ used: true });
    expect(h.logs.join('\n')).toMatch(/static stage from CI/);
  });

  it('replays the static stage when CI has not proved the sha — and says why', async () => {
    // The hole the receipt could not see: a gate may run BEFORE the pull request exists,
    // and two of ci.yml's steps only run on pull_request events. "CI is required for the
    // merge" is true at merge time and says nothing about now.
    const h = harness();
    h.ciProof = { proven: false, why: 'no "typecheck + tests" run exists for this commit yet' };
    const job = depositRef(h);

    await processOldest(h.deps);

    const verify = h.commands.find(c => c.args[0] === 'scripts/verify-gate.js');
    expect(verify?.args).not.toContain('--skip-static');
    expect(h.spool.readReport(job.id)?.staticProof).toEqual({
      used: false,
      why: expect.stringContaining('no "typecheck + tests" run'),
    });
  });


  it('reports ENVIRONMENT when the ref cannot be fetched, and builds nothing', async () => {
    const h = harness();
    const job = depositRef(h, 'deadbeef');
    h.prepareRefFails = 'git reset --hard deadbeef';

    await processOldest(h.deps);

    const report = h.spool.readReport(job.id);
    expect(report?.verdict).toBe('ENVIRONMENT');
    expect(report?.detail).toMatch(/git reset --hard deadbeef/);
    expect(h.commands).toHaveLength(0);
    // Nothing was learned about the commit, so nothing is attested about it either.
    expect(listVerdicts(h.paths)).toHaveLength(0);
  });

  describe('gating the merged tree, not the branch (#183)', () => {
    it('a merge conflict is FAIL, not ENVIRONMENT — it is a fact about the code', async () => {
      const h = harness();
      h.prepareRefConflictBase = 'deadbeef'.repeat(5);
      const job = depositRef(h);

      await processOldest(h.deps);

      const report = h.spool.readReport(job.id);
      expect(report?.verdict).toBe('FAIL');
      expect(report?.detail).toContain('deadbeef'.repeat(5).slice(0, 8));
      // Nothing was built — the conflict is caught before any of that.
      expect(h.commands).toHaveLength(0);
      // FAIL is a real judgement, so it attests exactly like any other FAIL.
      const verdicts = listVerdicts(h.paths);
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].verdict.verdict).toBe('FAIL');
    });

    it('a real merge marks the verdict merged, with the base it merged in', async () => {
      const h = harness();
      h.prepareRefMerged = true;
      depositRef(h);

      await processOldest(h.deps);

      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.merged).toBe(true);
      expect(verdict.mergedBase).toBe(h.baseMain);
    });

    it('the fast path (ref already contains mergeRef) leaves merged unset', async () => {
      const h = harness();
      depositRef(h); // prepareRefMerged defaults to false

      await processOldest(h.deps);

      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.merged).toBeUndefined();
      expect(verdict.mergedBase).toBeUndefined();
    });

    it('forces the static stage to replay after a merge, even though CI proved the pre-merge sha', async () => {
      const h = harness();
      h.ciProof = { proven: true };
      h.prepareRefMerged = true;
      const job = depositRef(h);

      await processOldest(h.deps);

      const verify = h.commands.find(c => c.args[0] === 'scripts/verify-gate.js');
      expect(verify?.args).not.toContain('--skip-static');
      expect(h.spool.readReport(job.id)?.staticProof).toEqual({
        used: false,
        why: expect.stringContaining('merged origin/main'),
      });
    });

    it('the fast path still trusts a CI record — merging changed nothing', async () => {
      const h = harness();
      h.ciProof = { proven: true };
      const job = depositRef(h); // no merge: prepareRefMerged stays false

      await processOldest(h.deps);

      const verify = h.commands.find(c => c.args[0] === 'scripts/verify-gate.js');
      expect(verify?.args).toContain('--skip-static');
      expect(h.spool.readReport(job.id)?.staticProof).toEqual({ used: true });
    });

    it('attests the DEPOSITED sha, never the merge commit — even when a merge really ran', async () => {
      // fingerprintTree() would report `head-of-<worktree-basename>` for HEAD after the
      // merge — a sha nobody ever pushed. The attestation key must stay
      // request.fingerprint.head, fixed at deposit time.
      const h = harness();
      h.prepareRefMerged = true;
      const ref = 'a'.repeat(40);
      depositRef(h, ref);

      await processOldest(h.deps);

      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.head).toBe(ref);
      expect(verdict.head).not.toBe(`head-of-${path.basename(h.worktree)}`);
    });

    // B4.1 — D6: the artifact and the verdict used to be filed under different shas with
    // nothing connecting them. This proves the join works starting from EITHER file,
    // using only what each file itself records — no git lookup.
    it('records both shas in the verdict, and gatedSha names exactly the artifact this run wrote (D6 join)', async () => {
      const h = harness();
      h.prepareRefMerged = true;
      const ref = 'a'.repeat(40);
      const job = depositRef(h, ref);

      await processOldest(h.deps);

      const verdict = listVerdicts(h.paths)[0].verdict;
      const report = h.spool.readReport(job.id);

      // Direction 1 — starting from the DEPOSITED sha (this verdict's own filename basis),
      // the verdict names the GATED sha explicitly.
      expect(verdict.depositedSha).toBe(ref);
      expect(verdict.gatedSha).toBe(`head-of-${path.basename(h.worktree)}`); // the merge commit HEAD
      expect(verdict.gatedSha).not.toBe(ref); // a real merge ran; the two really do differ

      // Direction 2 — `gatedSha` is exactly the sha `gateArtifactPath` used to file the
      // artifact this run actually produced (report.gateArtifact, read back from done/).
      // A reader who only has the verdict can build that path without ever calling git.
      expect(report?.gateArtifact).toBe(
        path.join(h.worktree, 'report', 'e2e', `gate-${verdict.gatedSha}.json`),
      );
    });

    it('falls back to the deposited sha for gatedSha when a merge conflict means nothing was ever checked out', async () => {
      // A merge conflict returns before the worktree is ever fingerprinted (prepareRef has
      // already run `merge --abort`) — report.fingerprints.atStart is never set, so there
      // is no OTHER sha to name. gatedSha must still be present, not silently dropped.
      const h = harness();
      h.prepareRefConflictBase = 'deadbeef'.repeat(5);
      const ref = 'e'.repeat(40);
      depositRef(h, ref);

      await processOldest(h.deps);

      const verdict = listVerdicts(h.paths)[0].verdict;
      expect(verdict.depositedSha).toBe(ref);
      expect(verdict.gatedSha).toBe(ref);
      expect(verdict.gatedSha).toBe(verdict.head);
    });

    // B4.3 — D8: attempt: 1 in 314 of 314 real artifacts, though at least one sha was
    // demonstrably gated twice. The natural key is the DEPOSITED sha: a merge-queue
    // re-gate keeps it constant even though the GATED sha (the merge commit) moves with
    // `main` between runs — keying on the gated sha instead would still show attempt: 1
    // both times, which is exactly the corpus's own shape for `3ef3d3c3`.
    it('increments attempt on a re-gate of the identical deposited sha, and resets for a different one', async () => {
      const h = harness();
      const sha = 'b'.repeat(40);

      depositRef(h, sha);
      await processOldest(h.deps);
      depositRef(h, sha); // the SAME target, gated a second time
      await processOldest(h.deps);
      depositRef(h, 'c'.repeat(40)); // a genuinely different target
      await processOldest(h.deps);

      const attemptFlags = h.commands
        .filter(c => c.args[0] === 'scripts/verify-gate.js')
        .map(c => c.args.find(a => a.startsWith('--attempt=')));
      expect(attemptFlags).toEqual(['--attempt=1', '--attempt=2', '--attempt=1']);
    });
  });
});

// F2 (SPO-Pipeline/doc/bench-audit-2026-09-02.md): a malformed gate-attempts.json must
// never fail the gate it is only supposed to be counting. Round 1's docstring claimed
// "unreadable or missing is treated as empty rather than thrown", which was false for
// every JSON-valid non-object: null and a string both threw a TypeError the moment the
// old code assigned `counts[sha] = attempt` onto them, and a JSON array silently pinned
// every attempt to 1 forever (JSON.stringify drops properties assigned past an array's
// length, so it never threw at all). These tests cover all four shapes plus the two
// non-fatal failure paths (persist failure, and the ENOENT/corruption logging split).
describe('nextGateAttempt — F2: a malformed counter file must never fail the gate', () => {
  function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-attempts-'));
  }
  const sha = 'a'.repeat(40);

  it('treats a missing file as empty, silently — no log for the ordinary first-run case', () => {
    const root = tmpRoot();
    const logs: string[] = [];
    expect(nextGateAttempt(root, sha, m => logs.push(m))).toBe(1);
    expect(logs).toEqual([]);
    // And it persisted, so the next call increments rather than starting over.
    expect(nextGateAttempt(root, sha, m => logs.push(m))).toBe(2);
  });

  it('resets and proceeds, without throwing, when the file holds a JSON null', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'gate-attempts.json'), 'null', 'utf8');
    const logs: string[] = [];
    expect(() => nextGateAttempt(root, sha, m => logs.push(m))).not.toThrow();
    expect(nextGateAttempt(root, sha)).toBe(2); // proves the reset write actually landed
    expect(logs.some(m => m.includes('gate-attempts.json') && m.toLowerCase().includes('null'))).toBe(true);
  });

  it('resets and proceeds, without throwing, when the file holds a bare JSON string', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'gate-attempts.json'), '"oops"', 'utf8');
    const logs: string[] = [];
    expect(() => nextGateAttempt(root, sha, m => logs.push(m))).not.toThrow();
    expect(nextGateAttempt(root, sha)).toBe(2);
    expect(logs.some(m => m.includes('gate-attempts.json'))).toBe(true);
  });

  it('resets and proceeds, without throwing, when the bytes are not valid JSON at all', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'gate-attempts.json'), '{ not json at all', 'utf8');
    const logs: string[] = [];
    expect(() => nextGateAttempt(root, sha, m => logs.push(m))).not.toThrow();
    expect(nextGateAttempt(root, sha)).toBe(2);
    expect(logs.some(m => m.includes('gate-attempts.json'))).toBe(true);
  });

  // The important one: a JSON array never throws, so only asserting on the INCREMENTED
  // value (not on the absence of a throw) catches it. Before this fix, `counts` would BE
  // the array, `counts[sha] = 1` would set a non-index property JSON.stringify silently
  // drops, and every subsequent call would read the same array back and compute
  // `(counts[sha] ?? 0) + 1 === 1` again — attempt pinned to 1 forever, the exact defect
  // B4.3 exists to remove, reintroduced one level in.
  it('resets and proceeds when the file holds a JSON array — the shape that does not throw', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'gate-attempts.json'), '["not", "a", "map"]', 'utf8');
    const logs: string[] = [];
    const first = nextGateAttempt(root, sha, m => logs.push(m));
    expect(first).toBe(1);
    const second = nextGateAttempt(root, sha, m => logs.push(m));
    // The critical assertion: it actually incremented. A regression to the old bug would
    // make this 1 again, not throw.
    expect(second).toBe(2);
    expect(logs.some(m => m.includes('gate-attempts.json') && m.toLowerCase().includes('array'))).toBe(true);
  });

  it('never throws and still returns a usable attempt when persisting the count fails', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'gate-attempts.json'), JSON.stringify({ [sha]: 4 }), 'utf8');
    fs.chmodSync(root, 0o500); // read + execute only: the tmp-then-rename write cannot land
    try {
      const logs: string[] = [];
      let attempt = -1;
      expect(() => {
        attempt = nextGateAttempt(root, sha, m => logs.push(m));
      }).not.toThrow();
      // Computed in memory from the count it COULD read, even though persisting it failed —
      // this call's own return value is still correct; only the NEXT call loses precision.
      expect(attempt).toBe(5);
      expect(logs.some(m => m.includes('could not persist'))).toBe(true);
    } finally {
      fs.chmodSync(root, 0o700); // restore so the harness can clean up the tmp dir
    }
  });
});

describe('runJob — nightly', () => {
  it('builds and drives exactly what a live job does — it is a live drive against main', async () => {
    const h = harness();
    const job = deposit(h, 'nightly');

    const report = await runJob(h.deps, job);

    expect(npmRuns(h)).toEqual(['build:server', 'build:e2e']);
    expect(h.commands[3]).toMatchObject({
      cmd: 'node',
      args: ['dist/e2e/run.js', '--branch=fix/x', `--sha=head-of-${path.basename(h.worktree)}`],
    });
    expect(report.verdict).toBe('PASS');
  });

  it('names the sha it actually checked out and is about to drive (atStart), never the one that was merely queued at deposit', async () => {
    const h = harness();
    // A custom deposit, not the `deposit()` helper: it needs atSubmit.head to differ from
    // what `deps.fingerprint` (below) returns for atStart, so a worker.ts regression that
    // reads the wrong fingerprint — atSubmit instead of atStart, or `resolveRef`'s
    // `baseMain` (a live, movable ref) instead of either — shows up as a real mismatch
    // rather than the two coincidentally-equal strings the shared helper would produce.
    const job = h.spool.submit(
      {
        type: 'nightly',
        worktree: h.worktree,
        branch: 'main',
        // hash matches the harness's default `h.hashes` so the tree does not also read as
        // having moved mid-run (that is a separate concern, targetMoved, covered elsewhere)
        // — only `head` differs, isolating exactly the thing this test checks.
        fingerprint: { head: 'submit-time-sha-not-what-ran', hash: 'h1', clean: true },
        submitter: { pid: 0 },
        args: [],
      },
      h.clock.nowMs,
    );

    const report = await runJob(h.deps, job);

    expect(h.commands[3]).toMatchObject({
      cmd: 'node',
      args: ['dist/e2e/run.js', '--branch=main', `--sha=head-of-${path.basename(h.worktree)}`],
    });
    expect(report.verdict).toBe('PASS');
  });
});

describe('runJob — live and lease', () => {
  it('drives dist/e2e/run.js for a live job, having compiled it rather than assumed it', async () => {
    const h = harness();
    const job = deposit(h, 'live', ['--flows=login-spine']);
    const report = await runJob(h.deps, job);
    expect(npmRuns(h)).toEqual(['build:server', 'build:e2e']);
    expect(h.commands[3]).toMatchObject({
      cmd: 'node',
      args: [
        'dist/e2e/run.js',
        '--branch=fix/x',
        `--sha=head-of-${path.basename(h.worktree)}`,
        '--flows=login-spine',
      ],
    });
    expect(report.verdict).toBe('PASS');
  });

  it('names the step that failed, and stops there — a live job whose driver will not compile', async () => {
    const h = harness();
    const job = deposit(h, 'live');
    h.exitCodes = [0, 0, 1]; // fetch ok, build:server ok, build:e2e fails
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('FAIL');
    expect(report.detail).toMatch(/npm run build:e2e failed/);
    expect(h.gatewayStarts).toHaveLength(0);
  });

  it('lease: builds everything — the session it serves opens a real browser', async () => {
    const h = harness();
    await runJob(h.deps, deposit(h, 'lease'));
    expect(npmRuns(h)).toEqual(['build']);
  });

  it('lease: reports LEASED early, holds, and releases on the session\'s marker', async () => {
    const h = harness();
    const job = deposit(h, 'lease');
    let early: ReturnType<Spool['readReport']> = null;
    h.deps.sleep = async () => {
      // First hold cycle: the early report must already be on disk — it is what the
      // waiting session unblocked on. Then the session asks for release.
      early = early ?? h.spool.readReport(job.id);
      h.spool.requestRelease(job.id);
    };
    const report = await runJob(h.deps, job);
    expect(early).toMatchObject({ verdict: 'LEASED', port: 8080 });
    expect((early as unknown as { leaseUntil?: string }).leaseUntil).toBeDefined();
    expect(report.detail).toMatch(/lease released by the session/);
    expect(h.gatewayStops).toBe(1);
  });

  it('a lease job appends exactly one jobsLog line, though writeReport runs twice for it', async () => {
    // runJob itself calls spool.writeReport for the early LEASED unblock; processOldest
    // calls it again for the real, finished report once the lease ends. Two writeReport
    // calls, and jobsLog must still hold exactly one line for this one job.
    const h = harness();
    const job = deposit(h, 'lease');
    h.deps.sleep = async () => h.spool.requestRelease(job.id);

    await processOldest(h.deps);

    expect(jobsLogVerdicts(h)).toEqual([{ id: job.id, verdict: 'LEASED' }]);
  });

  it('runs a job deposited without --wait even though nobody is waiting (pid 0)', async () => {
    const h = harness();
    const job = h.spool.submit(
      {
        type: 'ref',
        worktree: h.worktree,
        branch: 'fix/x',
        fingerprint: { head: `head-of-${path.basename(h.worktree)}`, hash: 'h1', clean: true },
        submitter: { pid: 0 },
        args: [],
      },
      h.clock.nowMs,
    );
    h.submitterAlive = false;
    await processOldest(h.deps);
    expect(h.spool.readReport(job.id)?.verdict).toBe('PASS');
  });

  it('reports honestly when the end-of-run fingerprint cannot be taken', async () => {
    const h = harness();
    const job = deposit(h);
    let calls = 0;
    h.deps.fingerprint = wt => {
      if (++calls === 2) throw new Error('worktree vanished mid-fingerprint');
      return { head: `head-of-${path.basename(wt)}`, hash: 'h1', clean: true };
    };
    const report = await runJob(h.deps, job);
    expect(report.targetMoved).toBe(true);
    expect(report.verdict).toBe('STALE');
    expect(report.detail).toMatch(/could not re-fingerprint at end/);
  });

  it('lease: expires on its own when the session outlives it', async () => {
    const h = harness();
    const job = deposit(h, 'lease');
    // now() advances 10 ms per call; a 1-minute lease expires after enough hold cycles.
    const report = await runJob(h.deps, job);
    expect(report.detail).toMatch(/lease expired/);
  });
});

describe('the real command runner and deps', () => {
  it('realRunCommand resolves to the exit code and appends output to the log', async () => {
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-run-')), 'job.log');
    const code = await realRunCommand('node', ['-e', 'process.stdout.write("hi"); process.exit(3)'], {
      cwd: process.cwd(),
      logFile,
    });
    expect(code).toBe(3);
    expect(fs.readFileSync(logFile, 'utf8')).toContain('hi');
  });

  it('realRunCommand resolves 1 when the command cannot even start', async () => {
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-run-')), 'job.log');
    expect(await realRunCommand('/definitely/not/a/binary', [], { cwd: process.cwd(), logFile })).toBe(1);
  });

  it('realWorkerDeps wires the production pieces', async () => {
    const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-real-')));
    ensureLayout(paths);
    const deps = realWorkerDeps(paths);
    expect(deps.port).toBe(8080);
    expect(typeof deps.now()).toBe('number');
    await deps.sleep(1);
    deps.log('smoke'); // writes to stdout; must not throw
    // An unused high port: the real clearPort runs `ss`, finds nothing, returns.
    await expect(deps.gateway.clearPort(65_001)).resolves.toBeUndefined();
  });

  it('realWorkerDeps forwards the job environment to startGateway', async () => {
    const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-real-')));
    ensureLayout(paths);
    const spawned: { cwd: string; env: Record<string, string> }[] = [];
    // A fake machine, so the wiring is exercised without a gateway being spawned.
    const gatewayDeps: GatewayDeps = {
      execFile: () => '',
      spawnProcess: ((_cmd: string, _args: string[], opts: { cwd: string; env: Record<string, string> }) => {
        spawned.push({ cwd: opts.cwd, env: opts.env });
        return { pid: 4242, unref: () => {} };
      }) as unknown as GatewayDeps['spawnProcess'],
      fetchImpl: (async () => ({ ok: true, text: async () => 'data: {"phase":"ready"}\n\n' }) as Response) as typeof fetch,
      sleep: async () => {},
      kill: () => {},
    };
    const deps = realWorkerDeps(paths, gatewayDeps);

    const logFile = path.join(paths.done, 'wiring.log');
    const gateway = await deps.gateway.start('/wt/a', 8080, logFile, { SPO_CACHE_DIR: paths.cache });

    expect(gateway.pid).toBe(4242);
    expect(spawned[0].cwd).toBe('/wt/a');
    expect(spawned[0].env.SPO_CACHE_DIR).toBe(paths.cache);
    expect(spawned[0].env.PORT).toBe('8080');
  });
});

describe('workerLoop and main', () => {
  it('processes a job then idles, and survives a loop-level error', async () => {
    const h = harness();
    deposit(h);
    let calls = 0;
    const originalQueued = h.spool.queued.bind(h.spool);
    h.spool.queued = () => {
      calls++;
      if (calls === 2) throw new Error('transient fs error');
      return originalQueued();
    };
    await workerLoop(h.deps, 3);
    expect(h.logs.some(l => l.includes('transient fs error'))).toBe(true);
    expect(h.logs.some(l => l.includes('finished'))).toBe(true);
  });

  it('offers the bench to the nightly only when the queue came back empty', async () => {
    const h = harness();
    deposit(h);
    const offered: boolean[] = [];

    // Tick 1 runs the job (worked -> no offer); tick 2 finds nothing left.
    await workerLoop(h.deps, 2, async () => {
      offered.push(true);
      return false;
    });

    expect(offered).toEqual([true]);
  });

  it('carries the real nightly by default — an idle loop deposits one when it is due', async () => {
    const h = harness();
    // 03:00 UTC: inside the window, whatever the machine's timezone.
    h.clock.nowMs = Date.UTC(2026, 7, 25, 3, 0, 0);
    // Every clone attempt fails, so nothing touches the network or the disk. Three, not
    // one: a clone is a network step and gets retried — see checkout.ts.
    h.exitCodes = [1, 1, 1];

    await workerLoop(h.deps, 1);

    expect(readNightlyResult(h.paths)).toMatchObject({ verdict: 'ENVIRONMENT' });
    expect(h.commands[0]).toMatchObject({ cmd: 'git', args: expect.arrayContaining(['clone']) });
  });

  it('leaves the nightly alone at an hour a session might be waiting', async () => {
    const h = harness();
    h.clock.nowMs = Date.UTC(2026, 7, 25, 12, 0, 0);

    await workerLoop(h.deps, 1);

    expect(readNightlyResult(h.paths)).toBeNull();
    expect(h.commands).toEqual([]);
  });

  it('publishes pending statuses from the loop', async () => {
    const h = harness();
    deposit(h);
    await workerLoop(h.deps, 2);
    expect(h.published).toEqual([`head-of-${path.basename(h.worktree)}`]);
  });

  it('main registers the worker, heartbeats, recovers, and clears the port before looping', async () => {
    const h = harness();
    deposit(h);
    h.spool.claim(h.spool.queued()[0].file); // simulate a job cut by a crash
    let cleared = 0;
    h.deps.gateway.clearPort = async () => void cleared++;
    await main(h.deps, 0);
    expect(readWorkerInfo(h.paths)?.pid).toBe(process.pid);
    expect(fs.existsSync(h.paths.heartbeat)).toBe(true);
    expect(h.spool.running()).toHaveLength(0); // recovered
    expect(cleared).toBe(1);
  });

  it('main takes the owner lease before it looks at the queue', async () => {
    // A worker that claims a job before it holds the lease has already taken the bench
    // by the time it asks whether it may — the order is the guarantee, not the check.
    const h = harness();
    await main(h.deps, 0);
    expect(h.leaseRenewals).toBe(1);
  });

  it('main says so, loudly, when it cannot hold the lease', async () => {
    const h = harness();
    h.leaseDecision = { ok: false, why: 'laptop (pid 77) holds the bench' };
    await main(h.deps, 0);
    expect(h.logs.join('\n')).toMatch(/bench lease NOT held/);
  });
});

describe('the merge queue takes the bench first', () => {
  it('serves the queue only on an idle tick, never over a waiting job', async () => {
    // An entry jumps the spool once deposited, but the pass that deposits it must not run
    // while something is mid-flight — otherwise "jumping the line" becomes "interrupting".
    const h = harness();
    deposit(h);
    await workerLoop(h.deps, 1, async () => false);
    expect(h.queueServed).toBe(0);

    await workerLoop(h.deps, 1, async () => false);
    expect(h.queueServed).toBe(1);
  });

  it('takes a queue entry ahead of an older ordinary deposit', async () => {
    // The whole point of the priority: a lease measured at up to 33 min would otherwise
    // eject a healthy branch on the queue's check-response timeout.
    const h = harness();
    const ordinary = deposit(h);
    const entry = h.spool.submit(
      {
        type: 'ref',
        worktree: h.worktree,
        branch: 'gh-readonly-queue/main/pr-1-abc',
        fingerprint: { head: 'q'.repeat(40), hash: 'ref:q', clean: true },
        submitter: { pid: 0 },
        args: [],
        ref: 'q'.repeat(40),
        queueEntry: true,
      },
      h.clock.nowMs + 1000, // deposited LATER than the ordinary job
    );

    await processOldest(h.deps);

    expect(h.spool.readReport(entry.id)?.verdict).toBe('PASS');
    expect(h.spool.readReport(ordinary.id)).toBeNull(); // still waiting its turn
  });

  it('records the tree a ref job drove, so the queue can skip an identical one', async () => {
    const h = harness();
    h.trees['HEAD^{tree}'] = 'tree-abc';
    h.spool.submit(
      {
        type: 'ref',
        worktree: h.worktree,
        branch: 'x',
        fingerprint: { head: 'r'.repeat(40), hash: 'ref:r', clean: true },
        submitter: { pid: 0 },
        args: [],
        ref: 'r'.repeat(40),
      },
      h.clock.nowMs,
    );

    await processOldest(h.deps);

    expect(listVerdicts(h.paths)[0].verdict.tree).toBe('tree-abc');
  });
});

describe('mergeQueueDeps — what the queue service is given', () => {
  function bench(): BenchPaths {
    const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-mq-')));
    ensureLayout(paths);
    return paths;
  }

  it('offers every attestation as a candidate, with the tree it drove and its liveness', () => {
    const paths = bench();
    writeVerdictIn(paths.verdicts, {
      head: 'a'.repeat(40),
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      live: { status: 'ran', flows: ['login-spine'] },
      tree: 'tree-1',
      jobId: 'job-1',
      createdAt: new Date().toISOString(),
    });

    expect(mergeQueueDeps(paths, () => {}).attested()).toEqual([
      { head: 'a'.repeat(40), tree: 'tree-1', verdict: 'PASS', live: { status: 'ran', flows: ['login-spine'] } },
    ]);
  });

  it('reports a tree-less attestation as null rather than dropping it', () => {
    // Older attestations predate the tree field. They are still real verdicts; they just
    // cannot satisfy the dedup, which mayReuseVerdict already handles.
    const paths = bench();
    writeVerdictIn(paths.verdicts, {
      head: 'b'.repeat(40),
      branch: 'x',
      worktree: '/wt',
      verdict: 'PASS',
      jobId: 'job-2',
      createdAt: new Date().toISOString(),
    });
    expect(mergeQueueDeps(paths, () => {}).attested()[0].tree).toBeNull();
  });

  /** A real git repo rooted at the ref checkout — first-parent inversion reads real objects. */
  function gitRepoRefCheckout(paths: BenchPaths): (...args: string[]) => string {
    fs.mkdirSync(paths.refCheckout, { recursive: true });
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', paths.refCheckout, ...args], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    return git;
  }

  describe('attested() resolves `live` for a legacy PASS-with-tree candidate that lacks it', () => {
    // Y1 — the validation derived every source's liveness from its gate artifact; the
    // shipped `attested()` used to read `verdict.live` straight off disk and nothing
    // else, so a legacy verdict (515 of 518 on the real corpus, 2026-09-03) always read
    // as `'unknown'` even when its own gate artifact proved otherwise. These pin the fix.

    it('reads the artifact directly when it is filed under the verdict head itself', () => {
      const paths = bench();
      const git = gitRepoRefCheckout(paths);
      fs.writeFileSync(path.join(paths.refCheckout, 'a.txt'), 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'c0');
      const head = git('rev-parse', 'HEAD').trim();
      const tree = git('rev-parse', 'HEAD^{tree}').trim();

      const dir = path.join(paths.refCheckout, 'report', 'e2e');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `gate-${head}.json`),
        JSON.stringify({ live: { skipped: true, why: 'requires --live' }, routing: { required: ['login-spine'] } }),
      );

      writeVerdictIn(paths.verdicts, {
        head,
        branch: 'x',
        worktree: paths.refCheckout,
        verdict: 'PASS',
        tree,
        jobId: 'job-legacy',
        createdAt: new Date().toISOString(),
        // no `live` — the legacy shape this fix exists for.
      });

      const [candidate] = mergeQueueDeps(paths, () => {}).attested();
      expect(candidate.live).toEqual({ status: 'skipped', why: 'requires --live', required: ['login-spine'] });
    });

    it('resolves via first-parent inversion when the artifact is filed under a real merge commit', () => {
      // Reproduces the shape 122 of the corpus's 377 reusable candidates are in: `main`
      // was merged into the checkout before the gate ran, so the artifact is keyed by the
      // MERGE commit, never the deposited head the verdict itself is keyed by.
      const paths = bench();
      const git = gitRepoRefCheckout(paths);
      fs.writeFileSync(path.join(paths.refCheckout, 'a.txt'), 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'c0');

      git('checkout', '-q', '-b', 'feature');
      fs.writeFileSync(path.join(paths.refCheckout, 'feature.txt'), 'f\n');
      git('add', '.');
      git('commit', '-q', '-m', 'feature commit');
      const featureHead = git('rev-parse', 'HEAD').trim();

      git('checkout', '-q', 'main');
      fs.writeFileSync(path.join(paths.refCheckout, 'main.txt'), 'm\n');
      git('add', '.');
      git('commit', '-q', '-m', 'main moved');
      const mainHead = git('rev-parse', 'HEAD').trim();

      git('checkout', '-q', 'feature');
      git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
      const mergeSha = git('rev-parse', 'HEAD').trim();
      const mergeTree = git('rev-parse', 'HEAD^{tree}').trim();
      // Prove the fixture really is a merge shaped the way worker.ts produces one.
      expect(git('rev-parse', `${mergeSha}^1`).trim()).toBe(featureHead);
      expect(git('rev-parse', `${mergeSha}^2`).trim()).toBe(mainHead);

      const dir = path.join(paths.refCheckout, 'report', 'e2e');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `gate-${mergeSha}.json`),
        JSON.stringify({ live: { status: 'PASS', flows: [{ name: 'login-spine' }] } }),
      );

      writeVerdictIn(paths.verdicts, {
        head: featureHead,
        branch: 'feature',
        worktree: paths.refCheckout,
        verdict: 'PASS',
        tree: mergeTree,
        merged: true,
        mergedBase: mainHead,
        jobId: 'job-legacy-merged',
        createdAt: new Date().toISOString(),
      });

      const [candidate] = mergeQueueDeps(paths, () => {}).attested();
      expect(candidate.live).toEqual({ status: 'ran', flows: ['login-spine'] });
    });

    it('leaves `live` undefined for a legacy verdict with no tree — never reusable, not worth resolving', () => {
      const paths = bench();
      fs.mkdirSync(paths.refCheckout, { recursive: true });
      writeVerdictIn(paths.verdicts, {
        head: 'a'.repeat(40),
        branch: 'x',
        worktree: '/wt',
        verdict: 'PASS',
        jobId: 'job-notree',
        createdAt: new Date().toISOString(),
      });
      const [candidate] = mergeQueueDeps(paths, () => {}).attested();
      expect(candidate.live).toBeUndefined();
    });

    it('leaves `live` undefined for a FAIL verdict — mayReuseVerdict never looks at it', () => {
      const paths = bench();
      fs.mkdirSync(paths.refCheckout, { recursive: true });
      writeVerdictIn(paths.verdicts, {
        head: 'a'.repeat(40),
        branch: 'x',
        worktree: '/wt',
        verdict: 'FAIL',
        tree: 'T1',
        jobId: 'job-fail',
        createdAt: new Date().toISOString(),
      });
      const [candidate] = mergeQueueDeps(paths, () => {}).attested();
      expect(candidate.live).toBeUndefined();
    });
  });

  describe('resolveLegacyLiveness — unit', () => {
    function bench(): BenchPaths {
      const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-legacy-live-')));
      ensureLayout(paths);
      fs.mkdirSync(paths.refCheckout, { recursive: true });
      return paths;
    }
    function writeArtifact(paths: BenchPaths, sha: string, body: unknown): void {
      const dir = path.join(paths.refCheckout, 'report', 'e2e');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `gate-${sha}.json`), JSON.stringify(body), 'utf8');
    }
    const gitMustNotBeCalled = (): string => {
      throw new Error('git must not be called for this case');
    };

    it('is unknown, not an error, for an unmerged verdict with no direct artifact', () => {
      const paths = bench();
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        gitMustNotBeCalled,
        { head: 'b'.repeat(40), tree: 'T', merged: false, mergedBase: undefined },
        () => new Map(),
      );
      expect(result).toEqual({ status: 'unknown', why: 'no gate artifact was recorded for this run' });
    });

    it('is unknown when no merge commit in the index has this head as its first parent', () => {
      const paths = bench();
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        gitMustNotBeCalled,
        { head: 'd'.repeat(40), tree: 'T', merged: true, mergedBase: 'e'.repeat(40) },
        () => new Map(),
      );
      expect(result).toEqual({
        status: 'unknown',
        why: 'no merge commit in the ref checkout has this head as its first parent',
      });
    });

    // "Make first-parent inversion return the wrong commit" — a first-parent hit is not
    // proof on its own; these three pin the validation that catches it.
    it('refuses a first-parent match whose tree does not match the verdict', () => {
      const paths = bench();
      const head = 'c'.repeat(40);
      const mergeSha = 'm'.repeat(40);
      writeArtifact(paths, mergeSha, { live: { status: 'PASS', flows: [] } });
      const git = (_wt: string, args: string[]): string => {
        if (args[1] === `${mergeSha}^{tree}`) return 'SOME-OTHER-TREE\n';
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      };
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        git,
        { head, tree: 'tree-M', merged: true, mergedBase: 'e'.repeat(40) },
        () => new Map([[head, mergeSha]]),
      );
      expect(result).toEqual({ status: 'unknown', why: 'the recovered merge commit tree does not match the verdict' });
    });

    it('refuses a first-parent match whose second parent does not match mergedBase', () => {
      const paths = bench();
      const head = 'c'.repeat(40);
      const mergeSha = 'm'.repeat(40);
      writeArtifact(paths, mergeSha, { live: { status: 'PASS', flows: [] } });
      const git = (_wt: string, args: string[]): string => {
        if (args[1] === `${mergeSha}^{tree}`) return 'tree-M\n';
        if (args[1] === `${mergeSha}^2`) return 'DIFFERENT-BASE\n';
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      };
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        git,
        { head, tree: 'tree-M', merged: true, mergedBase: 'e'.repeat(40) },
        () => new Map([[head, mergeSha]]),
      );
      expect(result).toEqual({
        status: 'unknown',
        why: 'the recovered merge commit base does not match the verdict',
      });
    });

    it('accepts a first-parent match once all three checks agree, carrying `required` through', () => {
      const paths = bench();
      const head = 'c'.repeat(40);
      const mergeSha = 'm'.repeat(40);
      const base = 'e'.repeat(40);
      writeArtifact(paths, mergeSha, {
        live: { skipped: true, why: 'no --live' },
        routing: { required: ['login-spine'] },
      });
      const git = (_wt: string, args: string[]): string => {
        if (args[1] === `${mergeSha}^{tree}`) return 'tree-M\n';
        if (args[1] === `${mergeSha}^2`) return `${base}\n`;
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      };
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        git,
        { head, tree: 'tree-M', merged: true, mergedBase: base },
        () => new Map([[head, mergeSha]]),
      );
      // "make the resolved answer ignore `required`" — this pins that it does not.
      expect(result).toEqual({ status: 'skipped', why: 'no --live', required: ['login-spine'] });
    });

    // "Make the artifact lookup always fail" — must fall back to allow (unknown), never
    // throw and never a blanket refuse.
    it('falls back to unknown, never throws, when every git call fails', () => {
      const paths = bench();
      const head = 'd'.repeat(40);
      const mergeSha = 'm'.repeat(40);
      const result = resolveLegacyLiveness(
        paths.refCheckout,
        () => {
          throw new Error('git is unavailable');
        },
        { head, tree: 'T', merged: true, mergedBase: 'e'.repeat(40) },
        () => new Map([[head, mergeSha]]),
      );
      expect(result).toEqual({ status: 'unknown', why: 'could not validate the recovered merge commit' });
    });
  });

  it('deposits a queue entry as a PRIORITY ref job in the shared checkout', () => {
    const paths = bench();
    const deps = mergeQueueDeps(paths, () => {});
    deps.deposit({ ref: 'gh-readonly-queue/main/pr-9-abc', sha: 'c'.repeat(40) });

    const [{ request }] = new Spool(paths).queued();
    expect(request).toMatchObject({
      type: 'ref',
      ref: 'c'.repeat(40),
      queueEntry: true,
      worktree: paths.refCheckout,
      branch: 'gh-readonly-queue/main/pr-9-abc',
      submitter: { pid: 0 },
    });
  });

  it('sees its own deposit as pending, so a tick never deposits twice', () => {
    const paths = bench();
    const deps = mergeQueueDeps(paths, () => {});
    expect(deps.pendingFor('d'.repeat(40))).toBe(false);
    deps.deposit({ ref: 'gh-readonly-queue/main/pr-9-abc', sha: 'd'.repeat(40) });
    expect(deps.pendingFor('d'.repeat(40))).toBe(true);
  });

  it('copies a reused verdict onto the entry, recording that it was not driven', () => {
    const paths = bench();
    writeVerdictIn(paths.verdicts, {
      head: 'e'.repeat(40),
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      live: { status: 'ran', flows: ['login-spine'] },
      tree: 'tree-9',
      jobId: 'job-src',
      createdAt: new Date().toISOString(),
      published: true,
    });

    mergeQueueDeps(paths, () => {}).reuse('e'.repeat(40), 'f'.repeat(40), 'identical tree');

    const copy = listVerdicts(paths).find(v => v.verdict.head === 'f'.repeat(40))!.verdict;
    expect(copy.verdict).toBe('PASS');
    expect(copy.tree).toBe('tree-9');
    // Unpublished, so the loop posts it to GitHub; the job id stays byte-identical to the
    // original live drive, and `reusedFrom` carries the provenance instead.
    expect(copy.published).toBe(false);
    expect(copy.jobId).toBe('job-src');
    expect(copy.reusedFrom).toBe('e'.repeat(40));
    // The source's own liveness travels with the copy — a chain of reuses two hops from
    // the original live drive is still traceable back to what actually proved it.
    expect(copy.live).toEqual({ status: 'ran', flows: ['login-spine'] });
  });

  // F1 (SPO-Pipeline/doc/bench-audit-2026-09-02.md): a reuse copy's `head` is the QUEUE
  // ENTRY's sha, which is never checked out or gated — so the source's `gatedSha` must
  // never ride along under that name onto the copy. A live example on disk (verdict
  // `083e7a1c…`, `reusedFrom 95158cf2…`, `merged: true`, `mergedBase b31e6bc5…`) had
  // every field but `reusedFrom` describing a commit other than its own `head` — a
  // reader following `gatedSha` from that copy lands on the SOURCE's gate artifact
  // believing it describes the copy.
  it('never carries a gatedSha describing a commit it did not gate — the source gate travels under reusedGatedSha instead', () => {
    const paths = bench();
    const sourceGatedSha = 'g'.repeat(40); // the merge commit the SOURCE actually ran through verify-gate.js
    writeVerdictIn(paths.verdicts, {
      head: 'e'.repeat(40),
      depositedSha: 'e'.repeat(40),
      gatedSha: sourceGatedSha,
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      merged: true,
      mergedBase: 'base-sha',
      tree: 'tree-9',
      jobId: 'job-src',
      createdAt: new Date().toISOString(),
      published: true,
    });

    mergeQueueDeps(paths, () => {}).reuse('e'.repeat(40), 'f'.repeat(40), 'identical tree');

    const copy = listVerdicts(paths).find(v => v.verdict.head === 'f'.repeat(40))!.verdict;
    // The copy's head ('f'.repeat(40)) was never checked out — gatedSha must be absent,
    // never the source's value under this record's own head.
    expect(copy.gatedSha).toBeUndefined();
    expect(copy).not.toHaveProperty('gatedSha');
    // The real evidence is preserved, but under a name that cannot be mistaken for this
    // record's own gate.
    expect(copy.reusedGatedSha).toBe(sourceGatedSha);
    expect(copy.depositedSha).toBe('f'.repeat(40));
  });

  // Y2 — B2.5 deleted `fingerprintStable` from every reader and writer, not from the 515
  // verdicts already on file when it shipped. `{ ...source.verdict, ... }` spread any
  // extra key straight through, so reusing off one of those 515 resurrected the field
  // into a brand-new write — the deletion was real for a fresh gate, but not for a reuse.
  it('does not resurrect fingerprintStable when reusing from a legacy source that still carries it on disk', () => {
    const paths = bench();
    // Written directly, not through writeVerdictIn: BenchVerdict no longer declares this
    // field, but a real legacy file on disk still has it — that JSON is what `reuse` reads.
    const legacySource = {
      head: 'e'.repeat(40),
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      tree: 'tree-9',
      jobId: 'job-src',
      createdAt: new Date().toISOString(),
      fingerprintStable: true,
    };
    fs.mkdirSync(paths.verdicts, { recursive: true });
    fs.writeFileSync(path.join(paths.verdicts, `${legacySource.head}.json`), JSON.stringify(legacySource), 'utf8');

    mergeQueueDeps(paths, () => {}).reuse('e'.repeat(40), 'f'.repeat(40), 'identical tree');

    const copy = listVerdicts(paths).find(v => v.verdict.head === 'f'.repeat(40))!.verdict;
    expect(copy).not.toHaveProperty('fingerprintStable');
    // Everything else about the copy still behaves exactly as before this fix.
    expect(copy.tree).toBe('tree-9');
    expect(copy.reusedFrom).toBe('e'.repeat(40));
  });

  it('keeps the jobId byte-identical and reusedFrom pinned to the original across a reuse chain', () => {
    // A->B, B->C, C->D — each hop reads the verdict the previous hop just wrote. Before
    // this card, jobId grew a "(reused: ...)" suffix on every hop, so a long enough chain
    // pushed the status description past GitHub's 140-char limit and stopped publishing.
    const paths = bench();
    const shaA = 'a'.repeat(40);
    const shaB = 'b'.repeat(40);
    const shaC = 'c'.repeat(40);
    const shaD = 'd'.repeat(40);
    writeVerdictIn(paths.verdicts, {
      head: shaA,
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      tree: 'tree-chain',
      jobId: 'job-original',
      createdAt: new Date().toISOString(),
      published: true,
    });

    const deps = mergeQueueDeps(paths, () => {});
    deps.reuse(shaA, shaB, 'identical tree');
    deps.reuse(shaB, shaC, 'identical tree');
    deps.reuse(shaC, shaD, 'identical tree');

    const final = listVerdicts(paths).find(v => v.verdict.head === shaD)!.verdict;
    expect(final.jobId).toBe('job-original');
    expect(final.reusedFrom).toBe(shaA);
  });

  // F1, mirroring the jobId/reusedFrom chain test just above: a reuse-of-a-reuse must
  // still point at the ORIGINAL gate artifact, not at an intermediate copy that itself
  // never carries gatedSha. Without the `sourceGatedSha ?? sourceReusedGatedSha` fallback,
  // hop 2 (B->C) would copy `undefined` forward and the chain would go dark from there.
  it('collapses reusedGatedSha to the original gate artifact across a reuse chain', () => {
    const paths = bench();
    const shaA = 'a'.repeat(40);
    const shaB = 'b'.repeat(40);
    const shaC = 'c'.repeat(40);
    const shaD = 'd'.repeat(40);
    const originalGatedSha = 'g'.repeat(40);
    writeVerdictIn(paths.verdicts, {
      head: shaA,
      depositedSha: shaA,
      gatedSha: originalGatedSha,
      branch: 'x',
      worktree: paths.refCheckout,
      verdict: 'PASS',
      tree: 'tree-chain',
      jobId: 'job-original',
      createdAt: new Date().toISOString(),
      published: true,
    });

    const deps = mergeQueueDeps(paths, () => {});
    deps.reuse(shaA, shaB, 'identical tree');
    deps.reuse(shaB, shaC, 'identical tree');
    deps.reuse(shaC, shaD, 'identical tree');

    const final = listVerdicts(paths).find(v => v.verdict.head === shaD)!.verdict;
    expect(final.reusedGatedSha).toBe(originalGatedSha);
    expect(final.gatedSha).toBeUndefined();
    expect(final).not.toHaveProperty('gatedSha');
  });

  it('does nothing when the source verdict has vanished — the next tick gates it', () => {
    // The 24 h purge can remove it between the decision and the copy. Leaving the entry
    // unanswered is the safe direction: it gets gated properly rather than blessed.
    const paths = bench();
    mergeQueueDeps(paths, () => {}).reuse('0'.repeat(40), '1'.repeat(40), 'why');
    expect(listVerdicts(paths)).toHaveLength(0);
  });
});

// ---- action B5.1: a deadline per stage, and an actual kill --------------------------------

describe('classifyStage', () => {
  it('classifies every git subcommand into the git bucket (120s)', () => {
    expect(classifyStage('git', ['fetch', '--prune', '--force', 'origin'])).toMatchObject({ deadlineMs: 120_000 });
    expect(classifyStage('git', ['reset', '--hard', 'origin/main'])).toMatchObject({ deadlineMs: 120_000 });
    expect(classifyStage('git', ['clean', '-fd'])).toMatchObject({ deadlineMs: 120_000 });
    expect(classifyStage('git', ['merge', '--no-edit', 'origin/main'])).toMatchObject({ deadlineMs: 120_000 });
    expect(classifyStage('git', ['merge-base', '--is-ancestor', 'a', 'b'])).toMatchObject({ deadlineMs: 120_000 });
  });

  it('classifies npm ci into its own bucket (600s)', () => {
    expect(classifyStage('npm', ['ci'])).toMatchObject({ deadlineMs: 600_000 });
  });

  it('classifies build:server and build:e2e into the single-tsc bucket (660s), distinct from the full build', () => {
    expect(classifyStage('npm', ['run', 'build:server'])).toMatchObject({ deadlineMs: 660_000, stage: 'npm run build:server' });
    expect(classifyStage('npm', ['run', 'build:e2e'])).toMatchObject({ deadlineMs: 660_000, stage: 'npm run build:e2e' });
  });

  it('classifies the full `npm run build` (lease jobs) with more room than a single tsc target', () => {
    const full = classifyStage('npm', ['run', 'build']);
    expect(full.deadlineMs).toBe(900_000);
    expect(full.deadlineMs).toBeGreaterThan(classifyStage('npm', ['run', 'build:server']).deadlineMs);
  });

  it('classifies verify-gate.js on its own bound (20 min), well above the measured max (329.2s)', () => {
    const gate = classifyStage('node', ['scripts/verify-gate.js', '--live', '--deposited-sha=x']);
    expect(gate.deadlineMs).toBe(1_200_000);
    expect(gate.deadlineMs).toBeGreaterThan(329_200 * 3); // margin over the measured corpus max
  });

  it('classifies run.js (live/nightly) on its own bound (15 min)', () => {
    expect(classifyStage('node', ['dist/e2e/run.js', '--flag'])).toMatchObject({ deadlineMs: 900_000, stage: 'run.js' });
  });

  it('falls back to a bounded default for anything unrecognised, rather than leaving it unbounded', () => {
    const unknown = classifyStage('some-unclassified-tool', ['--flag']);
    expect(unknown.deadlineMs).toBe(660_000);
    expect(unknown.stage).toContain('some-unclassified-tool');
  });
});

describe('runWithDeadline: an actual kill, not just a timer that gives up waiting', () => {
  function tmpLog(): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-deadline-')), 'job.log');
  }

  it('resolves the real exit code when the command finishes well inside its deadline', async () => {
    const logFile = tmpLog();
    const code = await runWithDeadline(
      'node',
      ['-e', 'process.stdout.write("hi"); process.exit(0)'],
      { cwd: process.cwd(), logFile },
      { stage: 'fast', deadlineMs: 30_000 },
    );
    expect(code).toBe(0);
    expect(fs.readFileSync(logFile, 'utf8')).toContain('hi');
  });

  // Mutation target: "remove a stage's deadline" — without the deadlineTimer, this test's
  // process (which ignores SIGTERM AND never exits on its own) would hang the awaited
  // Promise forever, and the test times out rather than resolving DEADLINE_EXIT_CODE.
  //
  // Mutation target: "make the kill not actually kill" — a mutant that no-ops the real
  // `kill(-pid, signal)` call would still resolve DEADLINE_EXIT_CODE (the backstop timer
  // does not depend on the kill succeeding — see runWithDeadline's own doc comment on what
  // the backstop does and does not guarantee), so the resolved CODE alone cannot catch that
  // mutation. Only checking that the OS process is actually gone afterward can — the pid is
  // written to `pidFile` by the child itself, then polled here.
  //
  // The deadline has to outlast node's OWN startup: the child writes its pid as its first
  // statement, but it only gets to run that statement once the runtime is up. A deadline
  // tighter than that startup cost makes SIGKILL land before the file is ever written, and
  // the read below dies on ENOENT — a machine-load flake, not a regression. 3s of headroom
  // for a boot that normally takes tens of milliseconds; the bound below still proves the
  // wait is bounded and not "however long the OS takes".
  it('kills a process that ignores SIGTERM — SIGKILL still ends it, the OS process is actually gone, and the wait is bounded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-deadline-'));
    const logFile = path.join(dir, 'job.log');
    const pidFile = path.join(dir, 'pid');
    const start = Date.now();
    const code = await runWithDeadline(
      'node',
      [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ` +
          "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      ],
      { cwd: process.cwd(), logFile },
      { stage: 'ignores-sigterm', deadlineMs: 3_000, killGraceMs: 250 },
    );
    expect(code).toBe(DEADLINE_EXIT_CODE);
    // Bound: deadlineMs + 2*killGraceMs + slack, never "however long the OS takes".
    expect(Date.now() - start).toBeLessThan(8_000);
    expect(fs.readFileSync(logFile, 'utf8')).toMatch(/exceeded its .*deadline — killing/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: no such process — SIGKILL actually landed
  }, 20_000);

  // Mutation target: "kill the direct child only" (drop detached:true, or signal +pid instead
  // of -pid) — a real grandchild, spawned the way `npm run build:*` spawns `tsc`, must die too.
  it('kills the whole process group — a grandchild the command spawns dies too', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-deadline-'));
    const logFile = path.join(dir, 'job.log');
    const marker = path.join(dir, 'grandchild-alive');
    const scriptFile = path.join(dir, 'parent.js');
    // The parent spawns a grandchild that keeps touching `marker` every 50ms, then hangs
    // itself — exactly the shape of `npm run build:*` forking `tsc` and then a wedged tsc.
    fs.writeFileSync(
      scriptFile,
      [
        "const { spawn } = require('child_process');",
        "const fs = require('fs');",
        `const marker = ${JSON.stringify(marker)};`,
        "const gc = spawn(process.execPath, ['-e', " +
          "\"setInterval(() => { try { require('fs').writeFileSync(process.argv[1], String(Date.now())); } catch {} }, 50);\", marker], " +
          "{ stdio: 'ignore' });",
        'setInterval(() => {}, 1000);', // the parent itself also just hangs
      ].join('\n'),
    );
    const code = await runWithDeadline(
      process.execPath,
      [scriptFile],
      { cwd: dir, logFile },
      { stage: 'group-kill', deadlineMs: 300, killGraceMs: 200 },
    );
    expect(code).toBe(DEADLINE_EXIT_CODE);
    // The grandchild should have stopped writing by now; if only the direct child were
    // killed, `marker` would keep getting fresher every 50ms indefinitely.
    const firstCheck = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
    await new Promise(resolve => setTimeout(resolve, 400));
    const secondCheck = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
    expect(secondCheck).toBe(firstCheck);
  }, 10_000);

  // Mutation target: "a killer that waits on the process it killed" — the exact recurring
  // shape this chantier's report warns about. A process that never reports 'close' (the
  // real-world case: a child stuck in uninterruptible I/O wait, immune even to SIGKILL for a
  // while) must not hang this function forever.
  it('resolves via its own backstop even when the process never reports close', async () => {
    const logFile = tmpLog();
    const fakeChild = new EventEmitter() as unknown as ReturnType<typeof import('child_process').spawn>;
    (fakeChild as unknown as { pid: number }).pid = 4242;
    const killCalls: { pid: number; signal: NodeJS.Signals }[] = [];
    const start = Date.now();
    const code = await runWithDeadline(
      'ignored-because-spawn-is-injected',
      [],
      { cwd: process.cwd(), logFile },
      { stage: 'backstop', deadlineMs: 50, killGraceMs: 50 },
      {
        spawnProcess: (() => fakeChild) as unknown as typeof import('child_process').spawn,
        kill: (pid, signal) => killCalls.push({ pid, signal }),
      },
    );
    expect(code).toBe(DEADLINE_EXIT_CODE);
    expect(Date.now() - start).toBeLessThan(2_000);
    // Both signals sent, to the whole GROUP (negative pid), in order.
    expect(killCalls).toEqual([
      { pid: -4242, signal: 'SIGTERM' },
      { pid: -4242, signal: 'SIGKILL' },
    ]);
  }, 5_000);
});

describe("runJob: a deadline kill produces ENVIRONMENT, not FAIL — B5.1's routing", () => {
  // runCommand call order for a `ref` job: (1) the best-effort `git fetch` refresh (its exit
  // code is never checked), (2) `npm run build:server` (BUILD_STEPS.ref), (3) verify-gate.js.
  it('a build step killed by its deadline (exit 124) reports ENVIRONMENT, never FAIL', async () => {
    const h = harness();
    const job = deposit(h);
    h.exitCodes = [0, DEADLINE_EXIT_CODE]; // (1) fetch refresh, (2) build:server killed
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('ENVIRONMENT');
    expect(report.detail).toMatch(/exceeded its deadline and was killed/);
  });

  it('a killed verify-gate.js reports ENVIRONMENT and never writes a verdicts/ file (NON_ATTESTING)', async () => {
    const h = harness();
    deposit(h);
    h.exitCodes = [0, 0, DEADLINE_EXIT_CODE]; // (1) fetch refresh, (2) build:server ok, (3) gate killed
    await processOldest(h.deps);
    const written = listVerdicts(h.paths);
    expect(written).toHaveLength(0);
  });

  // live/nightly order: (1) fetch refresh, (2) build:server, (3) build:e2e, (4) run.js.
  it('a killed live drive (live/nightly) reports ENVIRONMENT, never FAIL', async () => {
    const h = harness();
    const job = deposit(h, 'live');
    h.exitCodes = [0, 0, 0, DEADLINE_EXIT_CODE];
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('ENVIRONMENT');
    expect(report.detail).toMatch(/live drive exceeded its deadline and was killed/);
  });

  it('an ordinary non-zero exit is still FAIL — the deadline sentinel does not swallow real failures', async () => {
    const h = harness();
    const job = deposit(h);
    h.exitCodes = [0, 1]; // (1) fetch refresh, (2) build:server genuinely failed, not timed out
    const report = await runJob(h.deps, job);
    expect(report.verdict).toBe('FAIL');
    expect(report.detail).toMatch(/npm run build:server failed/);
  });
});

// ---- action B5.2: the heartbeat reports progress, not existence ---------------------------

describe('processOldest: currentJob tracks execution, not deposit or existence', () => {
  it('sets currentJob at CLAIM time (not deposit time) while the job runs, and clears it once done', async () => {
    const h = harness();
    const job = deposit(h);
    let observedDuring: WorkerDeps['currentJob'] = undefined as unknown as WorkerDeps['currentJob'];
    const originalFingerprint = h.deps.fingerprint;
    h.deps.fingerprint = wt => {
      if (observedDuring === undefined) observedDuring = h.deps.currentJob;
      return originalFingerprint(wt);
    };
    expect(h.deps.currentJob).toBeNull();
    await processOldest(h.deps);
    expect(observedDuring).not.toBeNull();
    expect(observedDuring?.id).toBe(job.id);
    // Claim time, not job.submittedAt (the deposit time) — a queue wait must not be counted
    // as "how long the worker has been on this job".
    expect(observedDuring?.startedAt).not.toBe(job.submittedAt);
    // Cleared once the job is done — a heartbeat tick after this point must read idle, not
    // "still busy on the job that finished".
    expect(h.deps.currentJob).toBeNull();
  });

  it('clears currentJob even when runJob throws (the catch-and-FAIL path)', async () => {
    const h = harness();
    deposit(h);
    h.deps.mayDriveLive = () => {
      throw new Error('boom');
    };
    await processOldest(h.deps);
    expect(h.deps.currentJob).toBeNull();
  });

  it('never sets currentJob for a submitter-died deposit — nothing ran, nothing to report progress on', async () => {
    const h = harness();
    deposit(h);
    h.submitterAlive = false;
    await processOldest(h.deps);
    expect(h.deps.currentJob).toBeNull();
  });
});

describe('the heartbeat carries currentJob/startedAt (B5.2), via main()', () => {
  it('idles with currentJob null when the queue is empty', async () => {
    const h = harness();
    await main(h.deps, 0);
    const beat = readHeartbeat(h.paths);
    expect(beat).not.toBeNull();
    expect(beat?.currentJob).toBeNull();
    expect(beat?.startedAt).toBeNull();
  });
});

/**
 * The merge queue is where the outage actually landed: between 07:44:26Z and 07:45:17Z on
 * 2026-09-03 it resubmitted the same `gh-readonly-queue` ref seven times and GitHub refused
 * every fetch as unauthenticated. Its git runner is shared between calls that leave the
 * machine and calls that do not, so which of them carries credentials is a decision, and a
 * decision nothing asserted is a decision that silently reverts.
 */
describe('authEnvForGitArgs', () => {
  const AUTH = { GIT_CONFIG_COUNT: '1' };
  const auth = (): typeof AUTH => AUTH;
  const log = (): void => {};

  it.each([['fetch'], ['ls-remote'], ['clone'], ['push']])(
    'authenticates git %s — it leaves the machine',
    verb => {
      expect(authEnvForGitArgs([verb, 'origin'], log, auth)).toEqual(AUTH);
    },
  );

  it.each([['rev-parse'], ['log'], ['merge-base'], ['status'], ['diff'], ['hash-object']])(
    'gives git %s nothing — it is local, and credentials it cannot use are credentials somewhere they need not be',
    verb => {
      expect(authEnvForGitArgs([verb], log, auth)).toBeUndefined();
    },
  );

  it('is undefined, not an empty object, for a local call — runGit then leaves the env alone', () => {
    expect(authEnvForGitArgs(['rev-parse'], log, auth)).toBeUndefined();
  });

  it('handles an empty argument list without throwing', () => {
    expect(authEnvForGitArgs([], log, auth)).toBeUndefined();
  });

  it('pins the network set, so adding a network call without credentials is a failing test', () => {
    expect([...NETWORK_SUBCOMMANDS].sort()).toEqual(['clone', 'fetch', 'ls-remote', 'push']);
  });
});

/**
 * Reachability, not correctness. `authEnvForGitArgs` having the right answer proves
 * nothing about whether production ever asks it — that is the distinction the whole B-series
 * kept paying for, and it is exactly the shape of the original defect: the credential helper
 * was configured and correct, and simply never on the path. These call the wiring the worker
 * really builds.
 */
describe('the worker wiring reaches the credentials', () => {
  function paths(): BenchPaths {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-wiring-'));
    const p = benchPaths(root);
    ensureLayout(p);
    return p;
  }

  it('routes the merge queue fetch through the credentials', () => {
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    const runner = ((cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv) => {
      calls.push({ args, env });
      return '';
    }) as typeof runGit;

    const deps = mergeQueueDeps(paths(), () => {}, runner);
    deps.git(['fetch', '--no-tags', 'origin', 'refs/heads/x'], '/repo');

    expect(calls).toHaveLength(1);
    expect(calls[0].env).toBeDefined();
  });

  it('routes the merge queue ls-remote through the credentials — it polls GitHub on every tick', () => {
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    const runner = ((cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv) => {
      calls.push({ args, env });
      return '';
    }) as typeof runGit;

    mergeQueueDeps(paths(), () => {}, runner).lsRemote('/repo');

    expect(calls[0].args[0]).toBe('ls-remote');
    expect(calls[0].env).toBeDefined();
  });

  it('gives the merge queue local reads no credentials', () => {
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    const runner = ((cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv) => {
      calls.push({ args, env });
      return 'sha\n';
    }) as typeof runGit;

    mergeQueueDeps(paths(), () => {}, runner).git(['rev-parse', 'HEAD'], '/repo');

    expect(calls[0].env).toBeUndefined();
  });

  /**
   * Asserted on key NAMES only, never on the object. This calls the real `gh auth token`,
   * so `env` holds a live credential on a developer machine, and a jest diff of a whole
   * env object prints every value it holds straight into the test output and CI log.
   */
  it('hands the worker a gitAuthEnv that is either complete or empty, never half-built', () => {
    const keys = Object.keys(realWorkerDeps(paths()).gitAuthEnv()).sort();
    // A partial triple would make git fail with a config error rather than fall back to
    // anonymous, which is worse than the bug this replaces. Empty is the honest other
    // answer: no token, so no header — see githubAuthEnv.
    expect([
      [].join(),
      ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'].join(),
    ]).toContain(keys.join());
  });

  it('hands the worker a sleep that really waits', async () => {
    const before = Date.now();
    await realWorkerDeps(paths()).sleep(5);
    expect(Date.now() - before).toBeGreaterThanOrEqual(4);
  });
});
