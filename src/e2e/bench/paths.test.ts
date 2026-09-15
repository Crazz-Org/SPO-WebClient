import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  benchPaths,
  benchRoot,
  ensureLayout,
  HEARTBEAT_STALE_MS,
  heartbeatAgeMs,
  processAlive,
  readHeartbeat,
  readWorkerInfo,
  touchHeartbeat,
  workerStatus,
  writeWorkerInfo,
  type WorkerInfo,
} from './paths';

function tempBench() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-'));
  const paths = benchPaths(root);
  ensureLayout(paths);
  return paths;
}

const INFO: WorkerInfo = { pid: 4242, startedAt: '2026-08-22T09:00:00Z', repo: '/repo', port: 8080 };

describe('bench layout', () => {
  it('creates every shared directory', () => {
    const paths = tempBench();
    for (const dir of [paths.spool, paths.running, paths.done, paths.verdicts, paths.world, paths.cache, paths.nightly]) {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('honours SPO_BENCH_DIR, and defaults under the home directory', () => {
    // action b5.4: the real `process.env.SPO_BENCH_DIR` is never set, deleted or restored
    // here. This suite forces it to a fresh temp directory for every test file
    // (src/server/__tests__/setup/jest-setup.ts) precisely so nothing can resolve a bench
    // path against the real `~/.spo-bench` — a test that deleted the real var mid-run, even
    // inside a try/finally, would reopen exactly that window for the synchronous span in
    // between. `benchRoot` takes an injectable `env` (default `process.env`, unchanged for
    // every production call site) so this test can prove both branches of the fallback — SET
    // and UNSET — against throwaway objects instead of the process-wide one.
    const fakeEnv = { SPO_BENCH_DIR: '/somewhere/else' } as NodeJS.ProcessEnv;
    expect(benchRoot(fakeEnv)).toBe('/somewhere/else');
    expect(benchPaths(benchRoot(fakeEnv)).spool).toBe('/somewhere/else/spool');
    expect(benchPaths(benchRoot(fakeEnv)).cache).toBe('/somewhere/else/cache');

    // The zero-arg production path: every real call site (src/e2e/bench/cli.ts,
    // src/e2e/bench/worker.ts) calls `benchRoot()` with no argument at all, relying entirely on
    // the default parameter to fall through to the real `process.env`. The assertions above only
    // ever exercise the injected-`env` branch, so a mutant that breaks the default itself (e.g.
    // `env: NodeJS.ProcessEnv = {}`, which makes production ignore SPO_BENCH_DIR entirely) would
    // pass every other test in this suite. jest-setup.ts has already pointed
    // `process.env.SPO_BENCH_DIR` at a throwaway mkdtemp directory for this test file (see
    // src/server/__tests__/setup/jest-setup.ts), so reading it back here proves the DEFAULT
    // itself resolves SPO_BENCH_DIR, without ever touching or depending on the real
    // `~/.spo-bench`.
    expect(benchRoot()).toBe(process.env.SPO_BENCH_DIR);

    // The UNSET-var default: `os.homedir()` is a pure lookup (no filesystem access), so this
    // asserts the computed path without ever creating, reading or touching the directory it
    // names — real or otherwise.
    expect(benchRoot({} as NodeJS.ProcessEnv)).toBe(path.join(os.homedir(), '.spo-bench'));
  });
});

describe('worker info', () => {
  it('round-trips', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    expect(readWorkerInfo(paths)).toEqual(INFO);
  });

  it('reads null when the file is missing or corrupt', () => {
    const paths = tempBench();
    expect(readWorkerInfo(paths)).toBeNull();
    fs.writeFileSync(paths.workerFile, 'not json', 'utf8');
    expect(readWorkerInfo(paths)).toBeNull();
  });
});

describe('heartbeat', () => {
  it('is null before the first beat, near-zero right after', () => {
    const paths = tempBench();
    expect(heartbeatAgeMs(paths)).toBeNull();
    touchHeartbeat(paths);
    expect(heartbeatAgeMs(paths)).toBeLessThan(5_000);
  });

  it('reads null when the file exists but its content is not a parseable timestamp', () => {
    const paths = tempBench();
    fs.writeFileSync(paths.heartbeat, 'not a number\n', 'utf8');
    expect(heartbeatAgeMs(paths)).toBeNull();
  });

  // Action B5.3: the contract is CONTENT, never mtime -- these two cases are the ones that tell
  // them apart. A reader reverted to fs.statSync(...).mtimeMs would flip BOTH assertions below.
  it('trusts content over mtime: stale content with a freshly-bumped mtime (e.g. an unrelated touch, a backup pass) still reads stale', () => {
    const paths = tempBench();
    const staleWrittenMs = Date.now() - HEARTBEAT_STALE_MS - 5_000;
    fs.writeFileSync(paths.heartbeat, `${staleWrittenMs}\n`, 'utf8');
    const freshTime = new Date();
    fs.utimesSync(paths.heartbeat, freshTime, freshTime); // mtime says "just now"; content still says stale
    expect(heartbeatAgeMs(paths)).toBeGreaterThan(HEARTBEAT_STALE_MS);
  });

  it('trusts content over mtime: fresh content with a stale mtime (e.g. a `cp -p`-preserved copy) still reads fresh', () => {
    const paths = tempBench();
    const freshWrittenMs = Date.now();
    fs.writeFileSync(paths.heartbeat, `${freshWrittenMs}\n`, 'utf8');
    const oldTime = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(paths.heartbeat, oldTime, oldTime); // mtime says 10 minutes old; content still says now
    expect(heartbeatAgeMs(paths)).toBeLessThan(5_000);
  });

  // Action B5.2: the heartbeat carries {currentJob, startedAt} so a reader can tell ALIVE from
  // PROGRESSING, not just a bare epoch-ms number any more.
  describe('B5.2: currentJob/startedAt', () => {
    it('idle (no argument) writes null currentJob/startedAt, and heartbeatAgeMs still works', () => {
      const paths = tempBench();
      touchHeartbeat(paths);
      const beat = readHeartbeat(paths);
      expect(beat?.currentJob).toBeNull();
      expect(beat?.startedAt).toBeNull();
      expect(heartbeatAgeMs(paths)).toBeLessThan(5_000);
    });

    it('round-trips a currentJob, and heartbeatAgeMs still reads writtenAt correctly', () => {
      const paths = tempBench();
      touchHeartbeat(paths, { id: 'job-123', startedAt: '2026-09-03T10:00:00.000Z' });
      const beat = readHeartbeat(paths);
      expect(beat?.currentJob).toBe('job-123');
      expect(beat?.startedAt).toBe('2026-09-03T10:00:00.000Z');
      expect(heartbeatAgeMs(paths)).toBeLessThan(5_000);
    });

    it('a later idle beat clears a previous currentJob — B5.2 must not leave a finished job looking busy forever', () => {
      const paths = tempBench();
      touchHeartbeat(paths, { id: 'job-123', startedAt: '2026-09-03T10:00:00.000Z' });
      expect(readHeartbeat(paths)?.currentJob).toBe('job-123');
      touchHeartbeat(paths, null);
      expect(readHeartbeat(paths)?.currentJob).toBeNull();
      expect(readHeartbeat(paths)?.startedAt).toBeNull();
    });

    it('readHeartbeat tolerates a legacy bare-number heartbeat (pre-B5.2), with currentJob absent', () => {
      const paths = tempBench();
      fs.writeFileSync(paths.heartbeat, `${Date.now()}\n`, 'utf8');
      const beat = readHeartbeat(paths);
      expect(beat).not.toBeNull();
      expect(beat?.currentJob).toBeNull();
      expect(beat?.startedAt).toBeNull();
    });

    it('readHeartbeat returns null for genuinely corrupt content (neither JSON nor a number)', () => {
      const paths = tempBench();
      fs.writeFileSync(paths.heartbeat, 'not json and not a number\n', 'utf8');
      expect(readHeartbeat(paths)).toBeNull();
    });

    it('readHeartbeat returns null when the JSON parses but writtenAt is not a finite number', () => {
      const paths = tempBench();
      fs.writeFileSync(paths.heartbeat, `${JSON.stringify({ writtenAt: 'not-a-number', currentJob: 'x', startedAt: 'y' })}\n`, 'utf8');
      expect(readHeartbeat(paths)).toBeNull();
    });

    it('readHeartbeat returns null for an empty file, not an epoch-zero beat', () => {
      const paths = tempBench();
      fs.writeFileSync(paths.heartbeat, '', 'utf8');
      expect(readHeartbeat(paths)).toBeNull();
      expect(heartbeatAgeMs(paths)).toBeNull();
    });

    it('readHeartbeat returns null for a whitespace-only file', () => {
      const paths = tempBench();
      fs.writeFileSync(paths.heartbeat, '   \n\t\n', 'utf8');
      expect(readHeartbeat(paths)).toBeNull();
    });
  });
});

describe('workerStatus — what a submitter learns at deposit time', () => {
  it('reports a never-installed worker', () => {
    const status = workerStatus(tempBench());
    expect(status.alive).toBe(false);
    expect(status.reason).toMatch(/no worker registered/);
  });

  it('reports a dead pid even with a fresh heartbeat', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    touchHeartbeat(paths);
    const status = workerStatus(paths, Date.now(), () => false);
    expect(status.alive).toBe(false);
    expect(status.reason).toMatch(/pid 4242 is not running/);
  });

  it('reports a worker that never heartbeat', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    const status = workerStatus(paths, Date.now(), () => true);
    expect(status.alive).toBe(false);
    expect(status.reason).toMatch(/never heartbeat/);
  });

  it('reports a frozen heartbeat — the crash-loop case systemd cannot see', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    touchHeartbeat(paths);
    const status = workerStatus(paths, Date.now() + HEARTBEAT_STALE_MS + 1_000, () => true);
    expect(status.alive).toBe(false);
    expect(status.reason).toMatch(/heartbeat is \d+ s old/);
  });

  it('reports alive when the pid runs and the heartbeat is fresh', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    touchHeartbeat(paths);
    expect(workerStatus(paths, Date.now(), () => true)).toEqual({ alive: true, info: INFO });
  });

  it('an empty heartbeat file reads as never-heartbeat, not a 57-year-old beat', () => {
    const paths = tempBench();
    writeWorkerInfo(paths, INFO);
    fs.writeFileSync(paths.heartbeat, '', 'utf8');
    const status = workerStatus(paths, Date.now(), () => true);
    expect(status.alive).toBe(false);
    expect(status.reason).toMatch(/never heartbeat/);
    expect(status.reason).not.toMatch(/\d{6,} s old/);
  });
});

describe('processAlive', () => {
  it('sees the current process, and not an absurd pid', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 30)).toBe(false);
  });
});
