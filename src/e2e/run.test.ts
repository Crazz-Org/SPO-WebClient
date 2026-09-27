import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import { formatSummary, main, runLive, type LiveRunOptions, type LiveRunResult } from './run';
import { WorldLock } from './world-lock';
import * as preflightModule from './preflight';
import * as flowsModule from './flows';
import * as capabilityModule from './capability';

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
    lock.addPendingRestore({ what: 'x', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' });
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
      lock.addPendingRestore({ what: 'x', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' });
      return passingFlow(flow.name);
    });

    const result = await runLive({ flows: ['login-spine'], branch: 'fix/a', lock });

    expect(result.status).toBe('FAIL');
    expect(result.error).toMatch(/dirty/);
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

  it('runs every flow when none are named', async () => {
    const runner = jest.fn(async (_options: LiveRunOptions) => result);
    const out = sink();
    await main([], runner, out.stream);
    expect(runner.mock.calls[0][0].flows.length).toBeGreaterThan(1);
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
