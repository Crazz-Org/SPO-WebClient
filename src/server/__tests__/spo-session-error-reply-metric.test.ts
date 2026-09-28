/**
 * `rdoMetrics.totalErrorReplies` — one increment per `A<rid> error N;` reply to a pending
 * request, whichever way the errorCode contract then settles the promise. Drives the REAL
 * StarpeaceSession over the protocol harness (pattern of rdo/timeout-state-machine.test.ts).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-validation/protocol-test-harness';
import { SessionPhase } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import type { MockTcpSocket } from './protocol-validation/mock-tcp-socket';

const WORLD_CONTEXT_ID = '8161308';

describe('rdoMetrics.totalErrorReplies (real session)', () => {
  let harness: ProtocolTestHarness;
  let worldSocket: MockTcpSocket;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    worldSocket = harness.getSockets()[0];
    harness.session.setWorldContextId(WORLD_CONTEXT_ID);
    harness.session.setPhase(SessionPhase.WORLD_CONNECTED);
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
    jest.useRealTimers();
  });

  /** Sends a request, answers it with `reply(rid)`, and waits for it to settle. */
  async function sendAndAnswer(member: string, reply: (rid: string) => string): Promise<void> {
    const promise = harness.session
      .sendRdoRequest('world', {
        verb: 'sel' as never,
        targetId: WORLD_CONTEXT_ID,
        action: 'get' as never,
        member,
      }, 5_000, TimeoutCategory.NORMAL)
      .then(() => undefined, () => undefined);
    const sent = worldSocket.getCapturedCommands().find(c => c.includes(member));
    const rid = sent?.match(/^C (\d+) /)?.[1];
    expect(rid).toBeDefined();
    worldSocket.emit('data', Buffer.from(reply(rid as string), 'latin1'));
    await promise;
  }

  function errorReplies(): number {
    return harness.session.getQueueStatus().rdoMetrics.totalErrorReplies;
  }

  it('starts at zero', () => {
    expect(errorReplies()).toBe(0);
  });

  it('counts one error reply once, and a success reply leaves it unchanged', async () => {
    await sendAndAnswer('Failing', rid => `A${rid} error 9;`);
    expect(errorReplies()).toBe(1);

    await sendAndAnswer('Succeeding', rid => `A${rid} res="#1";`);
    expect(errorReplies()).toBe(1);
  });
});
