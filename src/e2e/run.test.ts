import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import { formatSummary, main, runLive, STOPPED_BY_DEADLINE, type LiveRunOptions, type LiveRunResult } from './run';
import { WorldLock, type ReplayOutcome, type StoredPendingRestore } from './world-lock';
import * as preflightModule from './preflight';
import * as flowsModule from './flows';
import * as capabilityModule from './capability';
import { GATE_ONLY, SERVER_QUARANTINE } from './routing';
import { SECONDARY_ACCOUNT } from './config';

function tempLock(): WorldLock {
  return new WorldLock(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-run-')));
}

const okPreflight = {
  ok: true,
  checks: [{ what: 'gateway is ready', ok: true }],
  environmentAbort: false,
  survivalLogUrl: 'http://logs/S.log',
};

function passingFlow(name: string): flowsModule.FlowResult {
  return {
    name,
    status: 'PASS',
    assertions: [],
    untestable: [],
    probes: [],
    messagesSent: 4,
    messagesReceived: 6,
    wireErrors: 0,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('runLive', () => {
  it('reads the requested capabilities before the flows and carries the evidence', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const order: string[] = [];
    jest.spyOn(capabilityModule, 'checkCapability').mockImplementation(async capability => {
      order.push(`cap:${capability}`);
      return {
        capability,
        account: 'SPO_test3',
        members: ['RDOSitMayor'],
        determined: true,
        granted: false,
        checks: [{ what: 'canGovern on the Capitol (server grantAccess)', value: 'false' }],
        checkedAt: 'now',
      };
    });
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      order.push(`flow:${flow.name}`);
      return passingFlow(flow.name);
    });

    const result = await runLive({
      flows: ['login-spine'],
      branch: 'fix/a',
      lock: tempLock(),
      capabilities: ['president'],
    });

    expect(order).toEqual(['cap:president', 'flow:login-spine']);
    expect(result.status).toBe('PASS');
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].granted).toBe(false);
    expect(formatSummary(result)).toContain('capability president: NOT GRANTED for SPO_test3');
  });

  it('runs the requested flows and passes when they all pass', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.status).toBe('PASS');
    expect(result.flows.map(f => f.name)).toEqual(['login-spine']);
  });

  it('runLive never fails the run on an UNTESTABLE flow (main BLOCKs it only under an explicit --flows), and the summary says why', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => ({
      ...passingFlow(flow.name),
      status: 'UNTESTABLE',
      untestable: ['x — y'],
    }));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.status).toBe('PASS');
    const summary = formatSummary(result);
    expect(summary).toContain('UNTESTABLE');
    expect(summary).toContain('? untestable: x — y');
  });

  it('fails the run when any flow fails', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest
      .spyOn(flowsModule, 'runFlow')
      .mockImplementation(async flow => ({ ...passingFlow(flow.name), status: 'FAIL' as const }));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });
    expect(result.status).toBe('FAIL');
  });

  it('BLOCKS a run whose flows all pass but one ended SKIPPED, and names it', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow =>
      flow.name === 'permission-negative'
        ? { ...passingFlow(flow.name), status: 'SKIPPED', skipped: `${SECONDARY_ACCOUNT.username} refused at REQ_AUTH_CHECK (code 7)` }
        : passingFlow(flow.name),
    );

    const result = await runLive({
      flows: ['login-spine', 'permission-negative'],
      branch: 'fix/a',
      lock: tempLock(),
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toBe(
      `skipped — a flow that did not run is not a pass: permission-negative (${SECONDARY_ACCOUNT.username} refused at REQ_AUTH_CHECK (code 7))`,
    );
  });

  it('a skip beside a failure is still a FAIL', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => ({
      ...passingFlow(flow.name),
      status: flow.name === 'login-spine' ? 'FAIL' : 'SKIPPED',
    }));

    const result = await runLive({
      flows: ['login-spine', 'permission-negative'],
      branch: 'fix/a',
      lock: tempLock(),
    });

    expect(result.status).toBe('FAIL');
  });

  it('reports an ENVIRONMENT abort without running a single flow', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue({
      ok: false,
      checks: [{ what: 'gateway is ready', ok: false, detail: 'unreachable' }],
      environmentAbort: true,
    });
    const runFlow = jest.spyOn(flowsModule, 'runFlow');

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.status).toBe('ENVIRONMENT');
    expect(result.error).toContain('unreachable');
    expect(runFlow).not.toHaveBeenCalled();
  });

  it('releases the lock after an environment abort so the next run is not blocked', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue({
      ok: false,
      checks: [],
      environmentAbort: true,
    });
    const lock = tempLock();
    await runLive({ flows: ['login-spine'], branch: 'fix/a', lock });
    expect(lock.read().holder).toBeNull();
  });

  /** A lock left dirty by an earlier run, holding one replayable pending restore. */
  function dirtyLock(): { lock: WorldLock; entry: StoredPendingRestore } {
    const lock = tempLock();
    lock.acquire('fix/a', 1, () => false);
    const entry = {
      key: 'k',
      what: 'x',
      x: 1,
      y: 2,
      propertyName: 'RDOSetTaxValue',
      originalValue: '7',
      replay: {
        kind: 'section-property' as const,
        x: 1,
        y: 2,
        visualClass: '4610',
        groupId: 'townTaxes',
        readProperty: 'Tax0Percent',
        writeProperty: 'RDOSetTaxValue',
      },
    };
    lock.addPendingRestore(entry);
    expect(() => lock.release()).toThrow();
    return { lock, entry };
  }

  it('replays a dirty lock through the injected replayer first, and BLOCKS — preflight and runFlow untouched — only when the replay fails', async () => {
    const preflight = jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const { lock, entry } = dirtyLock();
    const outcomes: ReplayOutcome[] = [{ key: 'k', what: 'x', ok: false, detail: 'read-back still shows "8"' }];
    const replayer = jest.fn(async () => outcomes);

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(replayer).toHaveBeenCalledTimes(1);
    expect(replayer).toHaveBeenCalledWith(lock, [entry]);
    expect(result.status).toBe('BLOCKED');
    expect(result.error).toMatch(/dirty/);
    expect(result.error).toContain('Automatic replay failed — x: read-back still shows "8"');
    // The BLOCKED refusal must happen before anything is driven — if the early return in
    // runLive's lock refusal is ever broken, this is what stops the test from falling through
    // into an unmocked preflight/flow that would reach the live world.
    expect(preflight).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
    expect(lock.read().dirty).toBe(true);
    expect(result.replays).toEqual(outcomes);
  });

  it('a replay that reads every original back clears the lock and the run proceeds', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const { lock } = dirtyLock();
    const replayer = jest.fn(async (l: WorldLock, entries: StoredPendingRestore[]): Promise<ReplayOutcome[]> =>
      entries.map(e => {
        l.clearPendingRestore(e.key ?? '');
        return { key: e.key, what: e.what, ok: true, detail: 'read back its original' };
      }),
    );

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('PASS');
    expect(runFlow).toHaveBeenCalledTimes(1);
    expect(lock.read()).toEqual({ holder: null, pendingRestores: [], dirty: false });
    expect(result.replays).toEqual([{ key: 'k', what: 'x', ok: true, detail: 'read back its original' }]);
  });

  it('BLOCKS when the replayer reports ok but the lock still holds the entry', async () => {
    // Mocked so a broken refusal can never fall through to the live world.
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const { lock } = dirtyLock();
    const replayer = jest.fn(async (): Promise<ReplayOutcome[]> => [{ key: 'k', what: 'x', ok: true, detail: 'claimed' }]);

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toContain('Automatic replay failed — 1 pending restore(s) still recorded');
    expect(runFlow).not.toHaveBeenCalled();
    expect(lock.read().dirty).toBe(true);
  });

  it('BLOCKS when the replayer throws, carrying the throw text', async () => {
    // Mocked so a broken refusal can never fall through to the live world.
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const { lock } = dirtyLock();
    const replayer = jest.fn(async (): Promise<ReplayOutcome[]> => {
      throw new Error('gateway unreachable');
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toMatch(/dirty/);
    expect(result.error).toContain('gateway unreachable');
    expect(result.replays).toEqual([{ what: 'the automatic replay', ok: false, detail: 'gateway unreachable' }]);
    expect(runFlow).not.toHaveBeenCalled();
    expect(lock.read().dirty).toBe(true);
  });

  it('never replays over a live single-flight holder', async () => {
    // Mocked so a broken refusal can never fall through to the live world.
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const lock = tempLock();
    // The parent process is alive: its pid holds the lock, a rival live run with writes in flight.
    lock.acquire('fix/a', process.ppid);
    lock.addPendingRestore({ key: 'k', what: 'x', originalValue: '7', replay: { kind: 'policy-status' } });
    const replayer = jest.fn(async (): Promise<ReplayOutcome[]> => []);

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toMatch(/single-flight/);
    expect(result.replays).toBeUndefined();
    expect(replayer).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });

  it('BLOCKS with the refusal when the lock is taken again after a clean replay and refused', async () => {
    // Mocked so a broken refusal can never fall through to the live world.
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const { lock } = dirtyLock();
    const replayer = jest.fn(async (l: WorldLock): Promise<ReplayOutcome[]> => {
      l.clearPendingRestore('k');
      return [{ key: 'k', what: 'x', ok: true, detail: 'read back its original' }];
    });
    const realAcquire = lock.acquire.bind(lock);
    let calls = 0;
    jest.spyOn(lock, 'acquire').mockImplementation((branch: string) => {
      calls++;
      if (calls === 1) return realAcquire(branch);
      throw new Error('A live run is already in flight (pid 2). Live runs are single-flight.');
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toMatch(/single-flight/);
    expect(result.replays).toHaveLength(1);
    expect(runFlow).not.toHaveBeenCalled();
  });

  it('carries the replays into an ENVIRONMENT abort after a clean replay', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue({ ok: false, checks: [], environmentAbort: true });
    const { lock } = dirtyLock();
    const replayer = jest.fn(async (l: WorldLock): Promise<ReplayOutcome[]> => {
      l.clearPendingRestore('k');
      return [{ key: 'k', what: 'x', ok: true, detail: 'read back its original' }];
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock, replayer });

    expect(result.status).toBe('ENVIRONMENT');
    expect(result.replays).toHaveLength(1);
  });

  it('leaves replays unset when the lock was clean', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const replayer = jest.fn(async (): Promise<ReplayOutcome[]> => []);

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock(), replayer });

    expect(result.status).toBe('PASS');
    expect('replays' in result).toBe(false);
    expect(replayer).not.toHaveBeenCalled();
  });

  it('defaults to replayPendingRestores from flows.ts', async () => {
    // Mocked so a broken refusal can never fall through to the live world.
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));
    const replay = jest.spyOn(flowsModule, 'replayPendingRestores').mockResolvedValue([]);
    const { lock, entry } = dirtyLock();

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock });

    expect(replay).toHaveBeenCalledWith(lock, [entry]);
    expect(result.status).toBe('BLOCKED');
    expect(runFlow).not.toHaveBeenCalled();
  });

  it('fails the run when a flow left the world dirty', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const lock = tempLock();
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      lock.addPendingRestore({ key: 'k', what: 'x', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' });
      return passingFlow(flow.name);
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock });

    expect(result.status).toBe('FAIL');
    expect(result.error).toMatch(/dirty/);
  });

  it('records the release error apart, so the nightly never absorbs a dirty world (#1310)', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const lock = tempLock();
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      lock.addPendingRestore({ key: 'k', what: 'x', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' });
      return passingFlow(flow.name);
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock });

    expect(result.releaseError).toMatch(/dirty/);
  });

  it('carries no releaseError key when the world was released clean', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(Object.prototype.hasOwnProperty.call(result, 'releaseError')).toBe(false);
  });

  it('passes the resolved log url down to the flows', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest
      .spyOn(flowsModule, 'runFlow')
      .mockImplementation(async flow => passingFlow(flow.name));

    await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(runFlow.mock.calls[0][1].survivalLogUrl).toBe('http://logs/S.log');
  });

  it('carries the sha it was told to drive through to the result, when the caller knows one', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));

    const result = await runLive({
      flows: ['login-spine'],
      branch: 'main',
      sha: 'a'.repeat(40),
      lock: tempLock(),
    });

    expect(result.sha).toBe('a'.repeat(40));
  });

  it('leaves sha unset for an ad hoc run nobody told the commit to — absent, not a guess', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.sha).toBeUndefined();
  });
});

describe('runLive — the drain guard (#1181)', () => {
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  it('exits non-zero, naming the flow in progress, when the event loop drains mid-drive', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    // A flow whose awaited timer never fires — exactly the drained session-resume.
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(() => new Promise(() => {}));
    const before = process.listeners('beforeExit');
    const lock = tempLock();

    void runLive({ flows: ['session-resume'], branch: 'fix/a', lock });
    await flush();
    expect(runFlow).toHaveBeenCalled();

    const added = process.listeners('beforeExit').filter(l => !before.includes(l));
    expect(added).toHaveLength(1);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      (added[0] as () => void)();
      expect(exit).toHaveBeenCalledWith(1);
      const text = write.mock.calls.map(c => String(c[0])).join('');
      expect(text).toContain('in progress');
      expect(text).toContain('session-resume');
      expect(lock.read().holder).toBeNull();
    } finally {
      process.removeListener('beforeExit', added[0] as () => void);
    }
  });

  it('disarms the guard once a run settles — PASS or ENVIRONMENT', async () => {
    const count = process.listeners('beforeExit').length;
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));
    await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });
    expect(process.listeners('beforeExit')).toHaveLength(count);

    jest.spyOn(preflightModule, 'preflight').mockResolvedValue({ ...okPreflight, ok: false });
    await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });
    expect(process.listeners('beforeExit')).toHaveLength(count);
  });
});

describe('runLive — a SIGTERM stops the drive gracefully (#1328)', () => {
  const restore = { key: 'clone', what: 'salaries', x: 1, y: 2, propertyName: 'RDOSetSalaries', originalValue: '100' };

  // The listeners present before the test's runLive — the drain-guard test leaves a run pending
  // forever, so its handler is still installed and must never see this file's signals.
  let before: NodeJS.SignalsListener[] = [];
  let kill: jest.SpyInstance;
  beforeEach(() => {
    before = process.listeners('SIGTERM');
    // A safety net: a re-raised SIGTERM must never reach the Jest worker itself.
    kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  /** Delivers a SIGTERM to the handler this test's runLive installed — no real signal is sent. */
  function sigterm(): void {
    for (const listener of process.listeners('SIGTERM').filter(l => !before.includes(l))) listener('SIGTERM');
  }

  it('lets flow k finish its restore, starts nothing after it, reports k+1..n as not run, and releases the lock clean', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const lock = tempLock();
    const started: string[] = [];
    let restored = false;
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      started.push(flow.name);
      if (flow.name === 'clone-salaries-roundtrip') {
        lock.addPendingRestore(restore);
        sigterm();
        await new Promise(resolve => setTimeout(resolve, 5));
        lock.clearPendingRestore(restore.key);
        restored = true;
      }
      return passingFlow(flow.name);
    });

    const result = await runLive({
      flows: ['login-spine', 'clone-salaries-roundtrip', 'politics-read', 'chat-read'],
      branch: 'fix/a',
      lock,
    });

    expect(restored).toBe(true);
    expect(started).toEqual(['login-spine', 'clone-salaries-roundtrip']);
    expect(result.flows.map(f => [f.name, f.status])).toEqual([
      ['login-spine', 'PASS'],
      ['clone-salaries-roundtrip', 'PASS'],
      ['politics-read', 'SKIPPED'],
      ['chat-read', 'SKIPPED'],
    ]);
    expect(result.flows.slice(2).map(f => f.skipped)).toEqual([STOPPED_BY_DEADLINE, STOPPED_BY_DEADLINE]);
    expect(STOPPED_BY_DEADLINE).toBe('stopped by deadline');
    expect(result.status).not.toBe('PASS');
    expect(result.stopped).toBe(true);
    expect(lock.read()).toEqual({ holder: null, pendingRestores: [], dirty: false });
    const text = write.mock.calls.map(c => String(c[0])).join('');
    expect(text).toContain('stop requested — finishing flow clone-salaries-roundtrip');
  });

  it('is not a PASS even when the stop lands during the last flow', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      sigterm();
      return passingFlow(flow.name);
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.status).toBe('BLOCKED');
    expect(result.error).toBe('stopped by SIGTERM before the drive settled');
  });

  it('does not swallow a second SIGTERM — it steps aside and re-raises it for the default termination', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let afterFirst: number | undefined;
    let afterSecond: number | undefined;
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => {
      sigterm();
      afterFirst = process.listeners('SIGTERM').length;
      expect(kill).not.toHaveBeenCalled();
      sigterm();
      afterSecond = process.listeners('SIGTERM').length;
      return passingFlow(flow.name);
    });

    await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(afterFirst).toBe(before.length + 1);
    expect(afterSecond).toBe(before.length);
  });

  it('removes the handler once runLive returns — PASS, FAIL and BLOCKED alike', async () => {
    const count = process.listeners('SIGTERM').length;
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow');
    let installed = 0;

    runFlow.mockImplementation(async flow => {
      installed = process.listeners('SIGTERM').length;
      return passingFlow(flow.name);
    });
    expect((await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() })).status).toBe('PASS');
    expect(installed).toBe(count + 1);
    expect(process.listeners('SIGTERM')).toHaveLength(count);

    runFlow.mockImplementation(async flow => ({ ...passingFlow(flow.name), status: 'FAIL' as const }));
    expect((await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() })).status).toBe('FAIL');
    expect(process.listeners('SIGTERM')).toHaveLength(count);

    runFlow.mockImplementation(async flow => ({ ...passingFlow(flow.name), status: 'SKIPPED' as const }));
    expect((await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() })).status).toBe('BLOCKED');
    expect(process.listeners('SIGTERM')).toHaveLength(count);

    const dirty = tempLock();
    dirty.acquire('fix/a', 1, () => false);
    dirty.addPendingRestore(restore);
    expect(() => dirty.release()).toThrow();
    expect((await runLive({ flows: ['login-spine'], branch: 'fix/b', lock: dirty })).status).toBe('BLOCKED');
    expect(process.listeners('SIGTERM')).toHaveLength(count);
  });
});

describe('formatSummary', () => {
  const base: LiveRunResult = {
    world: 'planitia',
    branch: 'fix/a',
    startedAt: 'a',
    finishedAt: 'b',
    status: 'FAIL',
    preflight: { ok: true, checks: [], environmentAbort: false },
    flows: [],
    capabilities: [],
  };

  it('leads with the world and the verdict', () => {
    expect(formatSummary({ ...base, status: 'PASS' })).toContain('L2 live drive on planitia — PASS');
  });

  it('shows a failed assertion under its flow', () => {
    const summary = formatSummary({
      ...base,
      flows: [
        {
          name: 'permission-negative',
          status: 'FAIL',
          assertions: [{ what: 'a non-mayor is refused', ok: false, detail: 'canGovern=true' }],
          untestable: [],
          probes: [],
          messagesSent: 1,
          messagesReceived: 1,
          wireErrors: 0,
        },
      ],
    });
    expect(summary).toContain('x a non-mayor is refused (canGovern=true)');
  });

  it('shows whether each probe produced a log line and a restore', () => {
    const summary = formatSummary({
      ...base,
      flows: [
        {
          name: 'politics-write',
          status: 'FAIL',
          assertions: [],
          untestable: [],
          probes: [
            {
              what: 'tax row 0',
              member: 'RDOSetTaxValue',
              status: 'FAIL',
              original: '7',
              written: '8',
              logLine: null,
              readBack: 'UNCONFIRMED',
              restored: true,
            },
          ],
          messagesSent: 1,
          messagesReceived: 1,
          wireErrors: 0,
        },
      ],
    });
    expect(summary).toContain('log=NO');
    expect(summary).toContain('restored=true');
  });

  it('includes a short sha in the headline when the run named one', () => {
    expect(formatSummary({ ...base, status: 'PASS', sha: 'c'.repeat(40) })).toContain(
      `L2 live drive on planitia — PASS (${'c'.repeat(8)})`,
    );
  });

  it('omits the sha suffix entirely when none was recorded, rather than printing a blank or "undefined"', () => {
    expect(formatSummary({ ...base, status: 'PASS' })).toBe('L2 live drive on planitia — PASS');
  });

  it('shows a seeded flow\'s seed and each cleanup, ok or FAIL', () => {
    const summary = formatSummary({
      ...base,
      flows: [
        {
          name: 'zoning-alert-read',
          status: 'FAIL',
          assertions: [],
          untestable: [],
          probes: [],
          messagesSent: 1,
          messagesReceived: 1,
          wireErrors: 0,
          seed: { what: `${SECONDARY_ACCOUNT.username} sends SPO_test3 one alert`, ok: true, detail: 'hall (220,41) via 10.1.2.3' },
          cleanup: [
            { what: "removed from SPO_test3's Inbox", ok: true, detail: '1/1 deleted' },
            { what: `removed from ${SECONDARY_ACCOUNT.username}'s Sent`, ok: false },
          ],
        },
      ],
    });
    expect(summary).toContain(`seed ok: ${SECONDARY_ACCOUNT.username} sends SPO_test3 one alert (hall (220,41) via 10.1.2.3)`);
    expect(summary).toContain("cleanup ok: removed from SPO_test3's Inbox (1/1 deleted)");
    expect(summary).toContain(`cleanup FAIL: removed from ${SECONDARY_ACCOUNT.username}'s Sent`);
    expect(summary).not.toContain(`${SECONDARY_ACCOUNT.username}'s Sent (`);
  });

  it('shows a failed seed as FAIL', () => {
    const summary = formatSummary({
      ...base,
      flows: [
        {
          name: 'zoning-alert-read',
          status: 'UNTESTABLE',
          assertions: [],
          untestable: [],
          probes: [],
          messagesSent: 0,
          messagesReceived: 0,
          wireErrors: 0,
          seed: { what: 'the seed', ok: false },
        },
      ],
    });
    expect(summary).toContain('seed FAIL: the seed');
    expect(summary).not.toContain('the seed (');
    expect(summary).not.toContain('cleanup');
  });

  it('prints a skipped flow as SKIP with its reason', () => {
    const summary = formatSummary({
      ...base,
      status: 'BLOCKED',
      flows: [
        {
          name: 'permission-negative',
          status: 'SKIPPED',
          skipped: `${SECONDARY_ACCOUNT.username} refused`,
          assertions: [],
          untestable: [],
          probes: [],
          messagesSent: 0,
          messagesReceived: 0,
          wireErrors: 0,
        },
      ],
    });
    expect(summary).toContain(`  SKIP  permission-negative — ${SECONDARY_ACCOUNT.username} refused`);
    expect(summary).not.toContain('SKIPPED  permission-negative');
  });

  it('prints the server quarantine block with each entry and its outcome in this run (#1310)', () => {
    // A second entry that did not run — newspaper-board-read left the live table with #1320.
    const table = {
      ...SERVER_QUARANTINE,
      'newspaper-board-read': { reason: 'posts answer HTTP 500', link: 'https://example.com/1', lift: 'a post lands', added: '2026-10-04' },
    };
    const summary = formatSummary({ ...base, flows: [{ ...passingFlow('portrait-roundtrip'), status: 'FAIL' }] }, table);
    const entries = Object.keys(table);
    expect(summary).toContain(`Server quarantine (${entries.length}):`);
    const portrait = SERVER_QUARANTINE['portrait-roundtrip'];
    expect(summary).toContain(
      `  portrait-roundtrip — ${portrait.reason} | link: ${portrait.link} | lift: ${portrait.lift} | ` +
        `added: ${portrait.added} | this run: FAIL`,
    );
    expect(summary).toMatch(/ {2}newspaper-board-read — .* \| this run: not run$/m);
  });

  it('prints no quarantine block without a table', () => {
    expect(formatSummary(base)).not.toContain('Server quarantine');
  });

  it('prints one line per replayed pending restore, ok or FAIL', () => {
    const summary = formatSummary({
      ...base,
      status: 'BLOCKED',
      error: 'dirty',
      replays: [
        { key: 'a', what: 'zone of (1,1)-(3,2)', ok: true, detail: 'read back its original' },
        { key: 'b', what: 'the road', ok: false, detail: 'no segment is left on the span' },
      ],
    });
    expect(summary).toContain('  replay ok: zone of (1,1)-(3,2) — read back its original');
    expect(summary).toContain('  replay FAIL: the road — no segment is left on the span');
    expect(summary.indexOf('! dirty')).toBeLessThan(summary.indexOf('replay ok'));
  });

  it('surfaces failed pre-flight checks', () => {
    const summary = formatSummary({
      ...base,
      status: 'ENVIRONMENT',
      preflight: {
        ok: false,
        checks: [{ what: 'gateway is ready', ok: false, detail: 'phase=loading' }],
        environmentAbort: true,
      },
    });
    expect(summary).toContain('pre-flight FAIL  gateway is ready: phase=loading');
  });
});

describe('main', () => {
  const result: LiveRunResult = {
    world: 'planitia',
    branch: 'fix/a',
    startedAt: '2026-08-21T10:00:00.000Z',
    finishedAt: '2026-08-21T10:05:00.000Z',
    status: 'PASS',
    preflight: { ok: true, checks: [], environmentAbort: false },
    flows: [],
    capabilities: [],
  };

  function sink(): { stream: Writable; text: () => string } {
    let text = '';
    const stream = new Writable({
      write(chunk, _enc, done) {
        text += String(chunk);
        done();
      },
    });
    return { stream, text: () => text };
  }

  // The no --flows default (the nightly's own call) now leaves out the GATE_ONLY keys (#1134).
  it('runs every flow but the gate-only ones when none are named, and says which it left out', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    const out = sink();
    await main([], runner, out.stream);
    const flows = runner.mock.calls[0][0].flows;
    expect(flows).toEqual(flowsModule.FLOWS.map(f => f.name).filter(n => !(n in GATE_ONLY)));
    expect(flows).not.toContain('politics-write');
    expect(flows).not.toContain('policy-roundtrip');
    expect(flows).toContain('autoconnection-roundtrip');
    expect(flows).not.toContain('chat-private-channel');
    expect(flows).toContain('chat-read');
    expect(flows).toContain('chat-chase');
    expect(out.text()).toMatch(/gate-only, not driven: politics-write/);
    expect(out.text()).toMatch(/gate-only, not driven: policy-roundtrip/);
    expect(out.text()).toMatch(/gate-only, not driven: chat-private-channel/);
    expect(flows).not.toContain('bank-borrow-payoff');
    expect(flows).toContain('bank-send-return');
    expect(flows).toContain('portrait-roundtrip');
    expect(out.text()).toMatch(/gate-only, not driven: bank-borrow-payoff/);
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    if (fs.existsSync(written)) fs.unlinkSync(written);
  });

  it('runs a gate-only flow when the caller names it — the gate drives it', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    const out = sink();
    await main(['--flows=login-spine,politics-write'], runner, out.stream);
    expect(runner.mock.calls[0][0].flows).toEqual(['login-spine', 'politics-write']);
    expect(out.text()).not.toContain('gate-only');
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    if (fs.existsSync(written)) fs.unlinkSync(written);
  });

  it('runs only the flows the caller asked for', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    await main(['--flows=login-spine,politics-read', '--branch=fix/x'], runner, sink().stream);
    expect(runner.mock.calls[0][0]).toMatchObject({
      flows: ['login-spine', 'politics-read'],
      branch: 'fix/x',
    });
  });

  it('forwards the sha flag to the runner, when the caller (the worker) passed one', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    await main(['--flows=login-spine', '--branch=fix/x', `--sha=${'b'.repeat(40)}`], runner, sink().stream);
    expect(runner.mock.calls[0][0]).toMatchObject({ branch: 'fix/x', sha: 'b'.repeat(40) });
  });

  it('leaves sha unset when no --sha flag was given — never a default that could collide', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    await main(['--flows=login-spine'], runner, sink().stream);
    expect(runner.mock.calls[0][0].sha).toBeUndefined();
  });

  it('forwards the capabilities the caller asked for, and refuses an unknown one', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    await main(['--flows=login-spine', '--capabilities=president'], runner, sink().stream);
    expect(runner.mock.calls[0][0].capabilities).toEqual(['president']);
    await expect(main(['--capabilities=emperor'], runner, sink().stream)).rejects.toThrow(
      /Unknown capability "emperor"\. Known: president/,
    );
  });

  it('writes the run artifact and points at it', async () => {
    const out = sink();
    await main(['--flows=login-spine'], async () => result, out.stream);
    const expected = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    expect(out.text()).toContain(expected);
    expect(JSON.parse(fs.readFileSync(expected, 'utf8')).status).toBe('PASS');
    fs.unlinkSync(expected);
  });

  it('writes the sha into the run artifact when the result carries one', async () => {
    const withSha = { ...result, sha: 'd'.repeat(40) };
    const out = sink();
    await main(['--flows=login-spine'], async () => withSha, out.stream);
    const expected = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    expect(JSON.parse(fs.readFileSync(expected, 'utf8')).sha).toBe('d'.repeat(40));
    fs.unlinkSync(expected);
  });

  it('writes no sha key at all when the result has none — absent, never a null or empty placeholder a reader could mistake for a match', async () => {
    const out = sink();
    await main(['--flows=login-spine'], async () => result, out.stream);
    const expected = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(expected, 'utf8')), 'sha')).toBe(
      false,
    );
    fs.unlinkSync(expected);
  });

  it('exits non-zero on anything but PASS', async () => {
    const failed = { ...result, status: 'FAIL' as const };
    expect(await main(['--flows=login-spine'], async () => failed, sink().stream)).toBe(1);
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    if (fs.existsSync(written)) fs.unlinkSync(written);
  });

  it('refuses an empty --flows= instead of running nothing', async () => {
    for (const argv of [['--flows='], ['--flows=,']]) {
      const runner = jest.fn(async (_options: LiveRunOptions) => result);
      await expect(main(argv, runner, sink().stream)).rejects.toThrow(/--flows= names no flow/);
      expect(runner).not.toHaveBeenCalled();
    }
  });

  describe('UNTESTABLE flows under an explicit --flows (#1184)', () => {
    const untestableFlow: flowsModule.FlowResult = {
      name: 'newspaper-board-read',
      status: 'UNTESTABLE',
      assertions: [],
      untestable: ['no newspaper on the board'],
      probes: [],
      messagesSent: 0,
      messagesReceived: 0,
      wireErrors: 0,
    };
    const okFlow: flowsModule.FlowResult = { ...untestableFlow, name: 'login-spine', status: 'PASS', untestable: [] };
    const withUntestable: LiveRunResult = { ...result, flows: [okFlow, untestableFlow] };
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    afterEach(() => {
      if (fs.existsSync(written)) fs.unlinkSync(written);
    });

    it('BLOCKS the run, exit 2, and names the flow', async () => {
      const out = sink();
      expect(await main(['--flows=login-spine,newspaper-board-read'], async () => withUntestable, out.stream)).toBe(2);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('BLOCKED');
      expect(out.text()).toContain('L2 live drive on planitia — BLOCKED');
      expect(out.text()).toContain('untestable — a flow named by --flows that observed nothing is not a proof');
      expect(out.text()).toContain('newspaper-board-read (no newspaper on the board)');
    });

    it('leaves the nightly (no --flows) PASS', async () => {
      expect(await main([], async () => withUntestable, sink().stream)).toBe(0);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('PASS');
    });

    it('keeps a FAIL beside it a FAIL, exit 1', async () => {
      const failed: LiveRunResult = { ...withUntestable, status: 'FAIL', flows: [{ ...okFlow, status: 'FAIL' }, untestableFlow] };
      expect(await main(['--flows=login-spine,newspaper-board-read'], async () => failed, sink().stream)).toBe(1);
    });

    it('keeps a skip-BLOCKED run BLOCKED and names both the skip and the untestable flow', async () => {
      const blocked: LiveRunResult = {
        ...withUntestable,
        status: 'BLOCKED',
        error: 'skipped — a flow that did not run is not a pass: permission-negative',
        flows: [{ ...okFlow, name: 'permission-negative', status: 'SKIPPED', skipped: 'refused' }, untestableFlow],
      };
      const out = sink();
      expect(await main(['--flows=permission-negative,newspaper-board-read'], async () => blocked, out.stream)).toBe(2);
      const error = JSON.parse(fs.readFileSync(written, 'utf8')).error;
      expect(error).toContain('skipped — a flow that did not run is not a pass: permission-negative');
      expect(error).toContain('not a proof: newspaper-board-read');
    });
  });

  describe('a run BLOCKED only by skipped flows', () => {
    const skippedRun: LiveRunResult = {
      ...result,
      status: 'BLOCKED',
      error: `skipped — a flow that did not run is not a pass: permission-negative (${SECONDARY_ACCOUNT.username} refused)`,
      flows: [
        {
          name: 'permission-negative',
          status: 'SKIPPED',
          skipped: `${SECONDARY_ACCOUNT.username} refused`,
          assertions: [],
          untestable: [],
          probes: [],
          messagesSent: 0,
          messagesReceived: 0,
          wireErrors: 0,
        },
      ],
    };
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    afterEach(() => {
      if (fs.existsSync(written)) fs.unlinkSync(written);
    });

    it('is reported PASS by the nightly (no --flows), the skip listed, and the artifact agrees', async () => {
      const out = sink();
      expect(await main([], async () => skippedRun, out.stream)).toBe(0);
      expect(out.text()).toContain('L2 live drive on planitia — PASS');
      expect(out.text()).toContain(`  SKIP  permission-negative — ${SECONDARY_ACCOUNT.username} refused`);
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8'));
      expect(artifact.status).toBe('PASS');
      expect(artifact.flows[0]).toMatchObject({ status: 'SKIPPED', skipped: `${SECONDARY_ACCOUNT.username} refused` });
    });

    it('stays BLOCKED, exit 2, when the caller named the flows', async () => {
      const out = sink();
      expect(await main(['--flows=permission-negative'], async () => skippedRun, out.stream)).toBe(2);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('BLOCKED');
    });

    it('a lock-refusal BLOCK (no flows) stays BLOCKED for the nightly too', async () => {
      const refused = { ...result, status: 'BLOCKED' as const, error: 'world dirty' };
      expect(await main([], async () => refused, sink().stream)).toBe(2);
    });

    it('a run a SIGTERM stopped stays BLOCKED for the nightly — its unreached flows are not a pass (#1328)', async () => {
      const stopped = { ...skippedRun, stopped: true as const };
      expect(await main([], async () => stopped, sink().stream)).toBe(2);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('BLOCKED');
    });
  });

  describe('UNTESTABLE flows in the nightly (#1320)', () => {
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    afterEach(() => {
      if (fs.existsSync(written)) fs.unlinkSync(written);
    });
    const untestable = (name: string, reasons: string[]): flowsModule.FlowResult => ({
      ...passingFlow(name),
      status: 'UNTESTABLE',
      untestable: reasons,
    });
    const flows = [
      passingFlow('login-spine'),
      untestable('mayor-rating-roundtrip', ["the restore to 100's Tycoon rating line — no line, so the pending restore is cleared"]),
      untestable('newspaper-board-read', ['a column is listed — 0 columns', 'a tree entry is listed — 0 entries']),
    ];

    it('exits 0 with PASS when every flow is PASS or UNTESTABLE, printing each reason', async () => {
      const out = sink();
      expect(await main([], async () => ({ ...result, status: 'PASS', flows }), out.stream)).toBe(0);
      expect(out.text()).toContain('L2 live drive on planitia — PASS');
      expect(out.text()).toContain("? untestable: the restore to 100's Tycoon rating line — no line, so the pending restore is cleared");
      expect(out.text()).toContain('? untestable: a column is listed — 0 columns');
      expect(out.text()).toContain('? untestable: a tree entry is listed — 0 entries');
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8'));
      expect(artifact.status).toBe('PASS');
      expect(artifact.flows[1]).toMatchObject({ status: 'UNTESTABLE', untestable: flows[1].untestable });
    });

    it('still FAILs, exit 1, on a dirty world beside them', async () => {
      const dirty: LiveRunResult = { ...result, status: 'FAIL', flows, releaseError: 'world left dirty', error: 'world left dirty' };
      const out = sink();
      expect(await main([], async () => dirty, out.stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
      expect(out.text()).toContain('? untestable: a column is listed — 0 columns');
    });
  });

  describe('the server quarantine (#1310)', () => {
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    afterEach(() => {
      if (fs.existsSync(written)) fs.unlinkSync(written);
    });
    const failing = (name: string): flowsModule.FlowResult => ({ ...passingFlow(name), status: 'FAIL', error: 'refused' });
    const quarantinedFail: LiveRunResult = {
      ...result,
      status: 'FAIL',
      flows: [passingFlow('login-spine'), failing('portrait-roundtrip')],
    };

    it('reports PASS, exit 0, when the only FAIL is a quarantined flow — the flow keeps its FAIL and is marked', async () => {
      const out = sink();
      expect(await main([], async () => quarantinedFail, out.stream)).toBe(0);
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8'));
      expect(artifact.status).toBe('PASS');
      const portrait = SERVER_QUARANTINE['portrait-roundtrip'];
      expect(artifact.flows[1]).toMatchObject({
        name: 'portrait-roundtrip',
        status: 'FAIL',
        quarantined: { reason: portrait.reason, link: portrait.link, lift: portrait.lift },
      });
      expect(artifact.flows[0].quarantined).toBeUndefined();
      expect(out.text()).toContain('L2 live drive on planitia — PASS');
      expect(out.text()).toContain('  FAIL  portrait-roundtrip — refused');
    });

    it('still FAILs, exit 1, when a non-quarantined flow FAILs beside it', async () => {
      const both = { ...quarantinedFail, flows: [...quarantinedFail.flows, failing('politics-read')] };
      expect(await main([], async () => both, sink().stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
    });

    it('still FAILs, exit 1, when a SIGTERM stopped the run — the quarantine never absorbs a stopped drive (#1328)', async () => {
      const stopped = { ...quarantinedFail, stopped: true as const };
      expect(await main([], async () => stopped, sink().stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
    });

    it('still FAILs, exit 1, on a dirty world — the quarantine never excuses a safety rail', async () => {
      const dirty = { ...quarantinedFail, releaseError: 'world left dirty', error: 'world left dirty' };
      expect(await main([], async () => dirty, sink().stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
    });

    it('still FAILs, exit 1, when --flows names the quarantined flow, and marks nothing', async () => {
      const named = { ...quarantinedFail, flows: [failing('portrait-roundtrip')] };
      expect(await main(['--flows=portrait-roundtrip'], async () => named, sink().stream)).toBe(1);
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8'));
      expect(artifact.status).toBe('FAIL');
      expect(artifact.flows[0].quarantined).toBeUndefined();
    });

    it('prints the Server quarantine block, every entry, on a passing run', async () => {
      const out = sink();
      expect(await main([], async () => ({ ...result, flows: [passingFlow('login-spine')] }), out.stream)).toBe(0);
      const entries = Object.keys(SERVER_QUARANTINE);
      expect(out.text()).toContain(`Server quarantine (${entries.length}):`);
      expect(entries.length).toBeGreaterThan(0);
      for (const flow of entries) expect(out.text()).toContain(`  ${flow} — ${SERVER_QUARANTINE[flow].reason}`);
    });
  });

  it.each([
    ['PASS', 0],
    ['FAIL', 1],
    ['BLOCKED', 2],
    ['ENVIRONMENT', 3],
  ] as const)('maps status %s to exit code %d — the worker reads this to tell a refusal from a real failure', async (status, code) => {
    const outcome = { ...result, status };
    expect(await main(['--flows=login-spine'], async () => outcome, sink().stream)).toBe(code);
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    if (fs.existsSync(written)) fs.unlinkSync(written);
  });
});
