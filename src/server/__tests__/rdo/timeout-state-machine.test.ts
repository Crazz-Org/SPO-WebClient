/**
 * RDO request timeout lifecycle — drives the REAL StarpeaceSession
 * (rewritten in Tier 4: the previous version tested a parallel mock class — audit P6).
 *
 * Policy under test:
 * - A request with no response rejects at its deadline (category default = NORMAL
 *   = IS_PROXY_TIMEOUT_MS = 180s, the legacy in-play blocking-read deadline)
 * - A timeout NEVER triggers a reconnect (close-only policy, ReportCnxFailure no-op)
 * - A late response after the timeout is logged/counted, never resolved
 * - An orphaned response (unknown RID) is dropped and counted, never crashes
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

import { createProtocolTestHarness, ProtocolTestHarness } from './../protocol-validation/protocol-test-harness';
import { SessionPhase } from '../../../shared/types';
import { IS_PROXY_TIMEOUT_MS } from '../../../shared/timeout-categories';
import type { MockTcpSocket } from './../protocol-validation/mock-tcp-socket';
import { TimeoutCategory } from '../../../shared/timeout-categories';

const WORLD_CONTEXT_ID = '8161308';

interface SessionInternals {
  pendingRequests: Map<number, { state: string }>;
  rdoMetrics: {
    totalSent: number;
    totalResolved: number;
    totalTimedOut: number;
    totalLateResponses: number;
    totalOrphaned: number;
  };
  sockets: Map<string, unknown>;
}

describe('RDO timeout lifecycle (real session)', () => {
  let harness: ProtocolTestHarness;
  let worldSocket: MockTcpSocket;
  let reconnectSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    worldSocket = harness.getSockets()[0];
    harness.session.setWorldContextId(WORLD_CONTEXT_ID);
    harness.session.setPhase(SessionPhase.WORLD_CONNECTED);
    reconnectSpy = jest
      .spyOn(harness.session, 'attemptWorldReconnect')
      .mockResolvedValue(undefined) as ReturnType<typeof jest.spyOn>;
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
    jest.useRealTimers();
  });

  function internals(): SessionInternals {
    return harness.session as unknown as SessionInternals;
  }

  function sendUnanswered(member: string, timeoutMs?: number): Promise<Error> {
    const promise = harness.session.sendRdoRequest('world', {
      verb: 'sel' as never,
      targetId: WORLD_CONTEXT_ID,
      action: 'get' as never,
      member,
    }, timeoutMs, TimeoutCategory.NORMAL);
    return promise.then(
      () => { throw new Error('expected rejection'); },
      (err: Error) => err,
    );
  }

  it('rejects at the explicit deadline with "Request timeout"', async () => {
    const captured = sendUnanswered('NeverAnswered', 5_000);
    await jest.advanceTimersByTimeAsync(5_100);

    const err = await captured;
    expect(err.message).toBe('Request timeout: NeverAnswered');
    expect(internals().rdoMetrics.totalTimedOut).toBe(1);
  });

  it('default deadline is the legacy in-play 180s (NORMAL category)', async () => {
    const captured = sendUnanswered('NeverAnswered'); // no explicit timeout

    await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS - 1_000);
    expect(internals().rdoMetrics.totalTimedOut).toBe(0); // still pending at 179s

    await jest.advanceTimersByTimeAsync(2_000);
    const err = await captured;
    expect(err.message).toContain('Request timeout');
    expect(internals().rdoMetrics.totalTimedOut).toBe(1);
  });

  it('a timeout NEVER triggers a reconnect and does not close the socket', async () => {
    const captured = sendUnanswered('NeverAnswered', 5_000);
    await jest.advanceTimersByTimeAsync(5_100);
    await captured;

    expect(reconnectSpy).not.toHaveBeenCalled();
    expect(internals().sockets.has('world')).toBe(true);
  });

  it('a late response after the timeout is counted, never resolved', async () => {
    const captured = sendUnanswered('NeverAnswered', 5_000);

    // Find the RID actually sent on the wire
    const sent = worldSocket.getCapturedCommands().find(c => c.includes('NeverAnswered'));
    const rid = sent?.match(/^C (\d+) /)?.[1];
    expect(rid).toBeDefined();

    await jest.advanceTimersByTimeAsync(5_100);
    await captured; // already rejected

    // Server answers late
    worldSocket.emit('data', Buffer.from(`A${rid} NeverAnswered="#42";`, 'latin1'));

    expect(internals().rdoMetrics.totalLateResponses).toBe(1);
    expect(internals().rdoMetrics.totalResolved).toBe(0);
  });

  it('an orphaned response (unknown RID) is dropped and counted, never crashes', () => {
    expect(() => {
      worldSocket.emit('data', Buffer.from('A64000 res="#1";', 'latin1'));
    }).not.toThrow();

    expect(internals().rdoMetrics.totalOrphaned).toBe(1);
  });

  it('a normal response before the deadline resolves and counts', async () => {
    worldSocket.addFallbackResponse({ member: 'Answered', payload: 'Answered="#7"' });

    const packet = await (async () => {
      const p = harness.session.sendRdoRequest('world', {
        verb: 'sel' as never,
        targetId: WORLD_CONTEXT_ID,
        action: 'get' as never,
        member: 'Answered',
      }, 5_000, TimeoutCategory.NORMAL);
      await new Promise(resolve => setImmediate(resolve));
      return p;
    })();

    expect(packet.payload).toContain('Answered="#7"');
    expect(internals().rdoMetrics.totalResolved).toBe(1);
    expect(internals().rdoMetrics.totalTimedOut).toBe(0);
  });
});
