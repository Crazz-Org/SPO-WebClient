import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { benchPaths, ensureLayout, type BenchPaths } from './paths';
import {
  appendJobsLog,
  DuplicateJobError,
  newJobId,
  Spool,
  type JobReport,
  type JobRequest,
  type JobsLogLine,
} from './job';

function tempBench(): BenchPaths {
  const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-job-')));
  ensureLayout(paths);
  return paths;
}

const FP = { head: 'abc123', hash: 'deadbeef', clean: true };

function requestFor(worktree: string): Omit<JobRequest, 'id' | 'submittedAt'> {
  return {
    type: 'ref',
    worktree,
    branch: 'fix/x',
    fingerprint: FP,
    submitter: { pid: 1234 },
    args: [],
  };
}

function reportFor(id: string): JobReport {
  return {
    id,
    type: 'ref',
    worktree: '/wt/a',
    branch: 'fix/x',
    verdict: 'PASS',
    fingerprints: { atSubmit: FP },
    targetMoved: false,
    startedAt: '2026-08-22T09:00:00Z',
  };
}

/** A report shaped the way every real return from `finish()` is: `finishedAt` set. */
function finishedReportFor(id: string, overrides: Partial<JobReport> = {}): JobReport {
  return {
    ...reportFor(id),
    finishedAt: '2026-08-22T09:05:00Z',
    detail: 'verify-gate exited 0 (PASS)',
    ...overrides,
  };
}

/** jobsLog is append-only JSON-lines; read every line back as a JobsLogLine. */
function readJobsLog(paths: BenchPaths): JobsLogLine[] {
  let raw: string;
  try {
    raw = fs.readFileSync(paths.jobsLog, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as JobsLogLine);
}

describe('newJobId', () => {
  it('orders lexically by deposit time', () => {
    const early = newJobId(1_000);
    const late = newJobId(2_000_000_000_000);
    expect([late, early].sort()[0]).toBe(early);
  });
});

describe('Spool — deposit and queue order', () => {
  it('queues oldest first, whatever the deposit order of names', () => {
    const spool = new Spool(tempBench());
    const first = spool.submit(requestFor('/wt/a'), 1_000);
    const second = spool.submit(requestFor('/wt/b'), 2_000);
    expect(spool.queued().map(e => e.request.id)).toEqual([first.id, second.id]);
  });

  it('refuses a second deposit for the same worktree, naming the queued job', () => {
    const spool = new Spool(tempBench());
    const first = spool.submit(requestFor('/wt/a'), 1_000);
    expect(() => spool.submit(requestFor('/wt/a'), 2_000)).toThrow(DuplicateJobError);
    expect(() => spool.submit(requestFor('/wt/a'), 2_000)).toThrow(new RegExp(first.id));
  });

  it('accepts deposits from different worktrees', () => {
    const spool = new Spool(tempBench());
    spool.submit(requestFor('/wt/a'), 1_000);
    expect(() => spool.submit(requestFor('/wt/b'), 2_000)).not.toThrow();
  });

  it('skips an unreadable spool entry instead of wedging the queue', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    fs.writeFileSync(path.join(paths.spool, 'job-00000000000000-bad.json'), '{broken', 'utf8');
    const good = spool.submit(requestFor('/wt/a'), 2_000);
    expect(spool.queued().map(e => e.request.id)).toEqual([good.id]);
  });
});

describe('Spool — claim, discard, finish', () => {
  it('claim moves the file into running/ atomically', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    const job = spool.submit(requestFor('/wt/a'), 1_000);
    const runningFile = spool.claim(spool.queued()[0].file);
    expect(spool.queued()).toHaveLength(0);
    expect(spool.running().map(e => e.request.id)).toEqual([job.id]);
    spool.finish(runningFile);
    expect(spool.running()).toHaveLength(0);
  });

  it('discard drops a queued entry without running it', () => {
    const spool = new Spool(tempBench());
    spool.submit(requestFor('/wt/a'), 1_000);
    spool.discard(spool.queued()[0].file);
    expect(spool.queued()).toHaveLength(0);
  });
});

describe('Spool — lease release markers', () => {
  it('records and reads a release request, and finish() clears it', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.submit(requestFor('/wt/a'), 1_000);
    const runningFile = spool.claim(spool.queued()[0].file);
    const id = spool.running()[0].request.id;
    expect(spool.releaseRequested(id)).toBe(false);
    spool.requestRelease(id);
    expect(spool.releaseRequested(id)).toBe(true);
    // The marker is not a job: listings still see exactly one running entry.
    expect(spool.running()).toHaveLength(1);
    spool.finish(runningFile);
    expect(spool.releaseRequested(id)).toBe(false);
  });
});

describe('Spool — on a bench that does not exist yet', () => {
  it('lists nothing rather than throwing', () => {
    const spool = new Spool(benchPaths(path.join(os.tmpdir(), 'spo-bench-never-created')));
    expect(spool.queued()).toEqual([]);
    expect(spool.running()).toEqual([]);
    expect(() => spool.purgeDone(1)).not.toThrow();
  });
});

describe('Spool — reports', () => {
  it('round-trips a report, and reads null for an unknown id', () => {
    const spool = new Spool(tempBench());
    const report = reportFor('job-1');
    spool.writeReport(report);
    expect(spool.readReport('job-1')).toEqual(report);
    expect(spool.readReport('job-nope')).toBeNull();
  });

  it('isPending sees queued and running jobs, and not finished ones', () => {
    const spool = new Spool(tempBench());
    const job = spool.submit(requestFor('/wt/a'), 1_000);
    expect(spool.isPending(job.id)).toBe(true);
    const runningFile = spool.claim(spool.queued()[0].file);
    expect(spool.isPending(job.id)).toBe(true);
    spool.finish(runningFile);
    expect(spool.isPending(job.id)).toBe(false);
  });

  it('purges only .log files older than the retention window, never the .json', () => {
    // B4.2: purgeDone used to delete the whole done/<id>.json + .log pair, which is why
    // the non-attesting vocabulary (DIRTY, ENVIRONMENT, ABANDONED, INTERRUPTED) was
    // invisible past 24 h — verdicts/ never records them, and done/ was the only other
    // place they existed. Now only the .log — the large, reproduce-nothing part — ages
    // out; the .json (and the durable jobsLog line written alongside it) do not.
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.writeReport(reportFor('job-old'));
    spool.writeReport(reportFor('job-new'));
    const oldJson = path.join(paths.done, 'job-old.json');
    const oldLog = path.join(paths.done, 'job-old.log');
    fs.writeFileSync(oldLog, 'stdout/stderr from the old job\n', 'utf8');
    const past = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(oldJson, past, past);
    fs.utimesSync(oldLog, past, past);

    spool.purgeDone(24 * 60 * 60 * 1000);

    expect(fs.existsSync(oldLog)).toBe(false);
    expect(spool.readReport('job-old')).not.toBeNull();
    expect(spool.readReport('job-new')).not.toBeNull();
  });

  it('never purges a .json report, however old it is', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.writeReport(reportFor('job-ancient'));
    const file = path.join(paths.done, 'job-ancient.json');
    const yearAgo = (Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(file, yearAgo, yearAgo);

    spool.purgeDone(24 * 60 * 60 * 1000);

    expect(spool.readReport('job-ancient')).not.toBeNull();
  });
});

describe('jobsLog — the durable line jobsLog purge (and done/) can no longer take away', () => {
  it('writeReport appends exactly one line, shaped from the finished report', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    const report = finishedReportFor('job-1', {
      verdict: 'FAIL',
      detail: 'npm run build:server failed in the worktree — see /path/job-1.log',
    });

    spool.writeReport(report);

    const lines = readJobsLog(paths);
    expect(lines).toEqual([
      {
        id: 'job-1',
        type: 'ref',
        depositedSha: FP.head,
        branch: 'fix/x',
        verdict: 'FAIL',
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        detail: report.detail,
      },
    ]);
  });

  it('carries bodyVerdict when the report has one (STALE overriding a body PASS)', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.writeReport(
      finishedReportFor('job-stale', { verdict: 'STALE', bodyVerdict: 'PASS', detail: 'the tree changed' }),
    );
    expect(readJobsLog(paths)[0]).toMatchObject({ verdict: 'STALE', bodyVerdict: 'PASS' });
  });

  it('does not append the lease job\'s early, not-yet-finished write', () => {
    // worker.ts writes the LEASED report TWICE: once early (no finishedAt — "the report is
    // written EARLY... then the worker holds the bench") so the waiting session unblocks,
    // and once for real when the lease ends. Appending on the early write would double the
    // line for every lease job — this is the mutation that placement guards against.
    const paths = tempBench();
    const spool = new Spool(paths);
    const early: JobReport = { ...reportFor('job-lease'), type: 'lease', verdict: 'LEASED' };
    expect(early.finishedAt).toBeUndefined();

    spool.writeReport(early);
    expect(readJobsLog(paths)).toEqual([]);

    spool.writeReport({ ...early, finishedAt: '2026-08-22T09:30:00Z', detail: 'lease expired' });
    expect(readJobsLog(paths)).toHaveLength(1);
  });

  it('appends once per writeReport call, in call order, across multiple jobs', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.writeReport(finishedReportFor('job-a', { verdict: 'PASS' }));
    spool.writeReport(finishedReportFor('job-b', { verdict: 'FAIL' }));
    spool.writeReport(finishedReportFor('job-c', { verdict: 'BLOCKED' }));
    expect(readJobsLog(paths).map(l => [l.id, l.verdict])).toEqual([
      ['job-a', 'PASS'],
      ['job-b', 'FAIL'],
      ['job-c', 'BLOCKED'],
    ]);
  });

  it('survives a simulated 48 h purge — the B4 gate criterion, verbatim', () => {
    // "a job that ends ENVIRONMENT appears in jobs.jsonl and survives a simulated 48 h"
    // (SPO-Pipeline/doc/bench-plan-derived-2026-09-02.md, Gate B4).
    const paths = tempBench();
    const spool = new Spool(paths);
    spool.writeReport(finishedReportFor('job-env', { verdict: 'ENVIRONMENT', detail: 'git fetch failed' }));
    const jsonFile = path.join(paths.done, 'job-env.json');
    const past = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(jsonFile, past, past);

    spool.purgeDone(24 * 60 * 60 * 1000, Date.now());

    expect(readJobsLog(paths)).toEqual([
      expect.objectContaining({ id: 'job-env', verdict: 'ENVIRONMENT' }),
    ]);
  });

  it('an unwritable jobsLog does not throw, does not touch done/, and is reported through log', () => {
    const paths = tempBench();
    // A directory in jobsLog's place makes the append fail (EISDIR) without touching
    // permissions, which is more portable across CI than chmod.
    fs.mkdirSync(paths.jobsLog);
    const seen: string[] = [];
    const spool = new Spool(paths, line => seen.push(line));
    const report = finishedReportFor('job-x');

    expect(() => spool.writeReport(report)).not.toThrow();

    expect(spool.readReport('job-x')).toEqual(report);
    expect(seen.some(line => line.includes('job-x') && line.includes('jobs.jsonl'))).toBe(true);
  });

  it('an unwritable jobsLog with no log callback still does not throw', () => {
    const paths = tempBench();
    fs.mkdirSync(paths.jobsLog);
    const spool = new Spool(paths);
    expect(() => spool.writeReport(finishedReportFor('job-y'))).not.toThrow();
    expect(spool.readReport('job-y')).not.toBeNull();
  });

  it('appendJobsLog itself is a no-op, not a throw, for a report with no finishedAt', () => {
    const paths = tempBench();
    ensureLayout(paths);
    appendJobsLog(paths, reportFor('job-z'));
    expect(readJobsLog(paths)).toEqual([]);
  });

  it('carries the trigger on a nightly line — "was this run asked for, or was it the schedule"', () => {
    const paths = tempBench();
    appendJobsLog(
      paths,
      finishedReportFor('job-manual', { type: 'nightly', branch: 'main', trigger: 'manual' }),
    );
    expect(readJobsLog(paths)[0]).toMatchObject({ type: 'nightly', trigger: 'manual' });
  });

  it('omits the trigger key entirely on a non-nightly report, even when the report carries one', () => {
    // The field is meaningless on a `ref` or `live` job, and a key that always read
    // "scheduled" there would look as if the question had been asked of it.
    const paths = tempBench();
    appendJobsLog(paths, finishedReportFor('job-ref', { trigger: 'scheduled' }));
    expect(readJobsLog(paths)[0]).not.toHaveProperty('trigger');
  });

  it('omits the trigger key on a nightly that never carried one — every pre-#801 record', () => {
    const paths = tempBench();
    appendJobsLog(paths, finishedReportFor('job-old', { type: 'nightly', branch: 'main' }));
    expect(readJobsLog(paths)[0]).not.toHaveProperty('trigger');
  });
});

describe('the duplicate guard keys on the subject, not the directory', () => {
  it('refuses a second job for the same worktree AND ref', () => {
    const paths = tempBench();
    const spool = new Spool(paths);
    const base = {
      type: 'ref' as const,
      worktree: '/bench/ref/checkout',
      branch: 'x',
      fingerprint: { head: 'a'.repeat(40), hash: 'ref:a', clean: true },
      submitter: { pid: 0 },
      args: [],
      ref: 'a'.repeat(40),
    };
    spool.submit(base, 1000);
    expect(() => spool.submit(base, 2000)).toThrow(DuplicateJobError);
  });

  it('allows two ref jobs for DIFFERENT refs in the one shared checkout', () => {
    // Since #158 stage C every gate is a ref job run in the same checkout. Keying on the
    // directory alone would refuse every second gate — and would refuse a merge-queue
    // entry whenever any session gate happened to be queued, leaving the entry ungated
    // until GitHub ejected it on the check-response timeout.
    const paths = tempBench();
    const spool = new Spool(paths);
    const make = (ref: string) => ({
      type: 'ref' as const,
      worktree: '/bench/ref/checkout',
      branch: ref,
      fingerprint: { head: ref, hash: `ref:${ref}`, clean: true },
      submitter: { pid: 0 },
      args: [],
      ref,
    });
    spool.submit(make('a'.repeat(40)), 1000);
    expect(() => spool.submit(make('b'.repeat(40)), 2000)).not.toThrow();
    expect(spool.queued()).toHaveLength(2);
  });

  it('still refuses a second worktree job for the same worktree', () => {
    // Unchanged for the jobs that genuinely test a directory: both have ref undefined.
    const paths = tempBench();
    const spool = new Spool(paths);
    const base = {
      type: 'lease' as const,
      worktree: '/home/dev/wt',
      branch: 'fix/x',
      fingerprint: { head: 'h', hash: 'h1', clean: true },
      submitter: { pid: 1 },
      args: [],
    };
    spool.submit(base, 1000);
    expect(() => spool.submit(base, 2000)).toThrow(DuplicateJobError);
  });
});
