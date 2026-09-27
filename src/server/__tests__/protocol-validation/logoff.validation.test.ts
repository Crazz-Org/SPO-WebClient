/**
 * Logoff conformity validation — graceful world-session termination.
 *
 * Legacy Voyager (ServerCnxHandler.pas:2043-2063):
 *   ClientNotAware (fire-and-forget) → get Logoff (5s deadline) → socket close.
 * The InterfaceServer publishes NO RDOEndSession (TDirectorySession member) —
 * the old implementation sent it there (errUnexistentMethod noise) and then
 * hard-destroyed the socket ~100ms later.
 *
 * Drives the REAL StarpeaceSession.endSession() through the protocol harness.
 *
 * assertNoViolations() is not called: the socket carries no scenario exchange
 * (rdoScenarios: []), so the strict validator has nothing to compare a frame
 * against; what each test checks is asserted directly on the session and the
 * socket's captured traffic instead.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';

const WORLD_CONTEXT_ID = '125086508';

function buildHarness(withLogoffResponse: boolean): ProtocolTestHarness {
  return createProtocolTestHarness({
    socketConfigs: [
      {
        rdoScenarios: [],
        disableStrictValidation: true,
        fallbackResponses: withLogoffResponse
          ? [{ member: 'Logoff', payload: 'Logoff="#0"' }]
          : [],
      },
    ],
  });
}

describe('Graceful Logoff (endSession)', () => {
  let harness: ProtocolTestHarness;

  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function connectWorld(h: ProtocolTestHarness): Promise<void> {
    await h.session.createSocket('world', '127.0.0.1', 5000);
    h.session.setWorldContextId(WORLD_CONTEXT_ID);
  }

  it('sends ClientNotAware (push) then get Logoff (RID) on the ClientView, never RDOEndSession', async () => {
    harness = buildHarness(true);
    await connectWorld(harness);

    await harness.session.endSession();

    const commands = harness.getCapturedCommands(0);
    const notAware = commands.find(c => c.includes('ClientNotAware'));
    const logoff = commands.find(c => c.includes('Logoff'));

    expect(notAware).toBeDefined();
    expect(notAware).toContain(`sel ${WORLD_CONTEXT_ID}`);
    expect(notAware).toContain('"*"');
    expect(notAware).toMatch(/^C sel /); // fire-and-forget: no RID

    expect(logoff).toBeDefined();
    expect(logoff).toMatch(new RegExp(`^C \\d+ sel ${WORLD_CONTEXT_ID} get Logoff$`));

    expect(commands.some(c => c.includes('RDOEndSession'))).toBe(false);

    // ClientNotAware precedes Logoff (legacy order)
    expect(commands.indexOf(notAware!)).toBeLessThan(commands.indexOf(logoff!));
  });

  it('closes the world socket after the Logoff answer', async () => {
    harness = buildHarness(true);
    await connectWorld(harness);
    const socket = harness.getSockets()[0];
    const endSpy = jest.spyOn(socket, 'end');

    await harness.session.endSession();

    expect(endSpy).toHaveBeenCalled();
  });

  it('is idempotent — a second endSession() sends nothing new', async () => {
    harness = buildHarness(true);
    await connectWorld(harness);

    await harness.session.endSession();
    const countAfterFirst = harness.getCapturedCommands(0).length;

    await harness.session.endSession();
    expect(harness.getCapturedCommands(0).length).toBe(countAfterFirst);
  });

  it('does not attempt world auto-reconnect after a graceful logoff socket close', async () => {
    harness = buildHarness(true);
    await connectWorld(harness);

    await harness.session.endSession();
    // Let the mock socket's close event fire
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 20));

    // A reconnect attempt would create a second socket
    expect(harness.getSockets().length).toBe(1);
  });

  it('still closes the socket when Logoff gets no answer (timeout path)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = buildHarness(false); // no Logoff response → 5s deadline
    await connectWorld(harness);
    const socket = harness.getSockets()[0];
    const endSpy = jest.spyOn(socket, 'end');

    const pending = harness.session.endSession();
    // Cross the LOGOFF_TIMEOUT_MS (5000) deadline
    await jest.advanceTimersByTimeAsync(5100);
    await pending;

    expect(endSpy).toHaveBeenCalled();
    const commands = harness.getCapturedCommands(0);
    expect(commands.some(c => c.includes('Logoff'))).toBe(true);
  });

  it('does nothing when no world session exists', async () => {
    harness = buildHarness(true);
    // No socket, no worldContextId
    await expect(harness.session.endSession()).resolves.toBeUndefined();
    expect(harness.getAllCapturedCommands()).toHaveLength(0);
  });
});
