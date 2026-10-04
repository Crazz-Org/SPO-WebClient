import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import { formatSummary, main, runLive, type LiveRunOptions, type LiveRunResult } from './run';
import { WorldLock } from './world-lock';
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
    unproven: [],
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

  it('an UNPROVEN flow never fails the run, and the summary says why', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => ({
      ...passingFlow(flow.name),
      status: 'UNPROVEN',
      unproven: ['x — y'],
    }));

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });

    expect(result.status).toBe('PASS');
    const summary = formatSummary(result);
    expect(summary).toContain('UNPROVEN');
    expect(summary).toContain('? unproven: x — y');
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

  it('reports BLOCKED when the world is still dirty from an earlier run', async () => {
    const preflight = jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    const runFlow = jest.spyOn(flowsModule, 'runFlow').mockImplementation(async f => passingFlow(f.name));

    const lock = tempLock();
    lock.acquire('fix/a', 1, () => false);
    lock.addPendingRestore({ key: 'k', what: 'x', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' });
    expect(() => lock.release()).toThrow();

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/b', lock });
    expect(result.status).toBe('BLOCKED');
    expect(result.error).toMatch(/dirty/);
    // The BLOCKED refusal must happen before anything is driven — if the early return in
    // runLive's lock.acquire() catch is ever broken, this is what stops the test from
    // falling through into an unmocked preflight/flow that would reach the live world.
    expect(preflight).not.toHaveBeenCalled();
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
    expect(result.releaseError).toMatch(/dirty/);
  });

  it('carries no releaseError when the world was left clean', async () => {
    jest.spyOn(preflightModule, 'preflight').mockResolvedValue(okPreflight);
    jest.spyOn(flowsModule, 'runFlow').mockImplementation(async flow => passingFlow(flow.name));
    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock: tempLock() });
    expect(result).not.toHaveProperty('releaseError');
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
          unproven: [],
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
          unproven: [],
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
          unproven: [],
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
          status: 'UNPROVEN',
          assertions: [],
          unproven: [],
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
          unproven: [],
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
          unproven: [],
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

  describe('the server quarantine (#1310)', () => {
    const written = path.join('report', 'e2e', 'live-2026-08-21T10-00-00-000Z.json');
    afterEach(() => {
      if (fs.existsSync(written)) fs.unlinkSync(written);
    });

    const failing = (name: string): flowsModule.FlowResult => ({
      ...passingFlow(name),
      status: 'FAIL',
      error: 'SERVER_ERROR The picture server could not store the picture',
    });
    const portraitOnly: LiveRunResult = {
      ...result,
      status: 'FAIL',
      flows: [passingFlow('login-spine'), failing('portrait-roundtrip')],
    };

    it('a nightly whose only failure is a quarantined FAIL exits 0, reported PASS, the flow keeping its FAIL', async () => {
      const out = sink();
      expect(await main([], async () => portraitOnly, out.stream)).toBe(0);
      expect(out.text()).toContain('L2 live drive on planitia — PASS');
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8')) as LiveRunResult;
      expect(artifact.status).toBe('PASS');
      const portrait = artifact.flows.find(f => f.name === 'portrait-roundtrip');
      const entry = SERVER_QUARANTINE['portrait-roundtrip'];
      expect(portrait?.status).toBe('FAIL');
      expect(portrait?.quarantined).toEqual({ reason: entry.reason, link: entry.link, lift: entry.lift });
      expect(artifact.flows.find(f => f.name === 'login-spine')).not.toHaveProperty('quarantined');
    });

    it('a quarantined FAIL beside a FAIL of a non-quarantined flow still exits 1', async () => {
      const both = { ...portraitOnly, flows: [...portraitOnly.flows, failing('politics-read')] };
      expect(await main([], async () => both, sink().stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
    });

    it('a quarantined-only FAIL that left the world dirty still exits 1', async () => {
      const dirty = { ...portraitOnly, releaseError: 'The live world is marked dirty', error: 'The live world is marked dirty' };
      expect(await main([], async () => dirty, sink().stream)).toBe(1);
      expect(JSON.parse(fs.readFileSync(written, 'utf8')).status).toBe('FAIL');
    });

    it('an explicit --flows=portrait-roundtrip judges the flow: its FAIL exits 1', async () => {
      const named = { ...portraitOnly, flows: [failing('portrait-roundtrip')] };
      expect(await main(['--flows=portrait-roundtrip'], async () => named, sink().stream)).toBe(1);
      const artifact = JSON.parse(fs.readFileSync(written, 'utf8')) as LiveRunResult;
      expect(artifact.status).toBe('FAIL');
      expect(artifact.flows[0]).not.toHaveProperty('quarantined');
    });

    it('prints the Server quarantine block, every entry, on a passing run', async () => {
      const out = sink();
      const passing = { ...result, flows: [passingFlow('login-spine'), passingFlow('portrait-roundtrip')] };
      expect(await main([], async () => passing, out.stream)).toBe(0);
      const text = out.text();
      const entries = Object.entries(SERVER_QUARANTINE);
      expect(text).toContain(`  Server quarantine (${entries.length}):`);
      for (const [flow, entry] of entries) {
        expect(text).toContain(`    ${flow} — ${entry.reason}`);
        expect(text).toContain(`link: ${entry.link}`);
        expect(text).toContain(`lift: ${entry.lift}`);
        expect(text).toContain(`added: ${entry.added}`);
      }
      expect(text).toMatch(/added: 2026-10-04 · outcome: PASS/);
      expect(text).toMatch(/outcome: not run/);
    });
  });
});

describe('formatSummary — the server quarantine block (#1310)', () => {
  const base: LiveRunResult = {
    world: 'planitia',
    branch: 'fix/a',
    startedAt: '2026-08-21T10:00:00.000Z',
    finishedAt: '2026-08-21T10:05:00.000Z',
    status: 'PASS',
    preflight: { ok: true, checks: [], environmentAbort: false },
    flows: [],
    capabilities: [],
  };

  it('prints nothing for an empty table', () => {
    expect(formatSummary(base, {})).not.toContain('Server quarantine');
  });

  it('prints each entry with its real outcome', () => {
    const table = { 'portrait-roundtrip': { reason: 'r', link: 'https://x/1', lift: 'l', added: '2026-10-04' } };
    const failed = { ...passingFlow('portrait-roundtrip'), status: 'FAIL' as const };
    expect(formatSummary({ ...base, flows: [failed] }, table)).toContain(
      '  Server quarantine (1):\n    portrait-roundtrip — r\n' +
        '            link: https://x/1 · lift: l · added: 2026-10-04 · outcome: FAIL',
    );
  });
});
