/**
 * World socket auto-reconnect — drives the REAL StarpeaceSession
 * (rewritten in Tier 4: the previous version tested a parallel mock class
 * that hardcoded RECONNECT_MAX_RETRIES = 3 while production uses 23 — audit P6).
 *
 * Policy under test:
 * - Reconnect trigger: socket 'close' ONLY, and only if !loggedOff
 * - Two bounded phases: 3 fast (5/10/20s exponential) + 20 slow (15s) = 23 total
 * - ±25% jitter on every backoff delay
 * - Pending RIDs drained (rejected) BEFORE reconnecting (ghost-RID rule)
 * - Promise dedup: concurrent callers share one attempt
 * - Give up at max retries → emit 'worldDisconnected'
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
import * as loginHandler from '../session/login-handler';
import type { MockTcpSocket } from './protocol-validation/mock-tcp-socket';
import { TimeoutCategory } from '../../shared/timeout-categories';

const WORLD_CONTEXT_ID = '8161308';

interface SessionStatics {
  RECONNECT_FAST_RETRIES: number;
  RECONNECT_SLOW_RETRIES: number;
  RECONNECT_MAX_RETRIES: number;
  RECONNECT_BASE_BACKOFF_MS: number;
  RECONNECT_SLOW_INTERVAL_MS: number;
}

interface SessionInternals {
  worldReconnectAttempts: number;
  worldReconnectLastAttempt: number;
  loggedOff: boolean;
  pendingRequests: Map<number, unknown>;
}

function statics(): SessionStatics {

  const { StarpeaceSession: SessionClass } = require('../spo_session');
  return SessionClass as unknown as SessionStatics;
}

describe('World reconnect (real session)', () => {
  let harness: ProtocolTestHarness;
  let worldSocket: MockTcpSocket;
  let reconnectWorldSocketSpy: jest.SpiedFunction<typeof loginHandler.reconnectWorldSocket>;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    reconnectWorldSocketSpy = jest
      .spyOn(loginHandler, 'reconnectWorldSocket')
      .mockResolvedValue(undefined as never);

    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    worldSocket = harness.getSockets()[0];
    harness.session.setWorldContextId(WORLD_CONTEXT_ID);
    harness.session.setPhase(SessionPhase.WORLD_CONNECTED);
  });

  afterEach(() => {
    reconnectWorldSocketSpy.mockRestore();
    harness.session.destroy();
    harness.cleanup();
    jest.useRealTimers();
  });

  function internals(): SessionInternals {
    return harness.session as unknown as SessionInternals;
  }

  describe('real production constants (not a mock copy)', () => {
    it('two bounded phases: 3 fast + 20 slow = 23 total attempts', () => {
      expect(statics().RECONNECT_FAST_RETRIES).toBe(3);
      expect(statics().RECONNECT_SLOW_RETRIES).toBe(20);
      expect(statics().RECONNECT_MAX_RETRIES).toBe(23);
    });

    it('fast base backoff 5s, slow interval 15s', () => {
      expect(statics().RECONNECT_BASE_BACKOFF_MS).toBe(5000);
      expect(statics().RECONNECT_SLOW_INTERVAL_MS).toBe(15_000);
    });
  });

  describe('trigger policy: socket close only', () => {
    it('socket close in WORLD_CONNECTED triggers a reconnect attempt', async () => {
      worldSocket.emit('close');
      await new Promise(resolve => setImmediate(resolve));
      expect(reconnectWorldSocketSpy).toHaveBeenCalledTimes(1);
    });

    it('socket close after graceful logoff does NOT reconnect (loggedOff flag)', async () => {
      internals().loggedOff = true;
      worldSocket.emit('close');
      await new Promise(resolve => setImmediate(resolve));
      expect(reconnectWorldSocketSpy).not.toHaveBeenCalled();
    });

    it('phase guard: no reconnect outside WORLD_CONNECTED/RECONNECTING', async () => {
      harness.session.setPhase(SessionPhase.DIRECTORY_CONNECTED);
      await harness.session.attemptWorldReconnect();
      expect(reconnectWorldSocketSpy).not.toHaveBeenCalled();
    });
  });

  describe('attempt lifecycle', () => {
    it('successful reconnect resets the attempt counter and returns to WORLD_CONNECTED', async () => {
      await harness.session.attemptWorldReconnect();
      expect(reconnectWorldSocketSpy).toHaveBeenCalledTimes(1);
      expect(internals().worldReconnectAttempts).toBe(0); // reset on success
      expect(harness.session.getPhase()).toBe(SessionPhase.WORLD_CONNECTED);
    });

    it('drains pending RIDs BEFORE reconnecting (ghost-RID rule)', async () => {
      const pending = harness.session.sendRdoRequest('world', {
        verb: 'sel' as never,
        targetId: WORLD_CONTEXT_ID,
        action: 'get' as never,
        member: 'NeverAnswered',
      }, 60_000, TimeoutCategory.NORMAL);
      const captured = pending.catch((err: Error) => err);
      await new Promise(resolve => setImmediate(resolve));
      expect(internals().pendingRequests.size).toBe(1);

      // The reconnect path's own immediate ServerBusy re-poll (§3.2) must resolve
      // too, or it would be mistaken for a ghost RID left behind by the drain.
      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });

      await harness.session.attemptWorldReconnect();
      await new Promise(resolve => setImmediate(resolve));

      const err = await captured;
      expect((err as Error).message).toContain('reconnecting');
      expect(internals().pendingRequests.size).toBe(0);
    });

    it('re-polls ServerBusy immediately on reconnect, without waiting out the 50s cadence', async () => {
      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });

      await harness.session.attemptWorldReconnect();
      await new Promise(resolve => setImmediate(resolve));

      expect(worldSocket.getCommandsByMember('ServerBusy')).toHaveLength(1);
    });

    it('dedup: concurrent callers share a single attempt', async () => {
      const p1 = harness.session.attemptWorldReconnect();
      const p2 = harness.session.attemptWorldReconnect();
      await Promise.all([p1, p2]);
      expect(reconnectWorldSocketSpy).toHaveBeenCalledTimes(1);
    });

    it('backoff throttle: an immediate second attempt is rejected as throttled', async () => {
      reconnectWorldSocketSpy.mockRejectedValueOnce(new Error('still down') as never);
      await harness.session.attemptWorldReconnect().catch(() => { /* first attempt fails */ });

      // Second attempt immediately after: elapsed ≈ 0 < jittered backoff (≥ 3750ms)
      await expect(harness.session.attemptWorldReconnect()).rejects.toThrow(/throttled/);
      expect(reconnectWorldSocketSpy).toHaveBeenCalledTimes(1);
    });

    it('jitter: the backoff gate stays within ±25% of its base on the second attempt window', async () => {
      reconnectWorldSocketSpy.mockRejectedValueOnce(new Error('still down') as never);
      await harness.session.attemptWorldReconnect().catch(() => { /* attempt 1 fails */ });

      // After one failed attempt, the exponential base is 5s × 2¹ = 10s, so the
      // jittered gate lies in [7.5s, 12.5s]. Beyond the worst case, a new
      // attempt must always pass the throttle.
      await jest.advanceTimersByTimeAsync(12_600);
      await harness.session.attemptWorldReconnect();
      expect(reconnectWorldSocketSpy).toHaveBeenCalledTimes(2);
    });

    it('gives up at RECONNECT_MAX_RETRIES and emits worldDisconnected', async () => {
      internals().worldReconnectAttempts = statics().RECONNECT_MAX_RETRIES;
      const disconnected = jest.fn();
      harness.session.on('worldDisconnected', disconnected);

      await harness.session.attemptWorldReconnect();

      expect(disconnected).toHaveBeenCalledTimes(1);
      expect(reconnectWorldSocketSpy).not.toHaveBeenCalled();
    });
  });
});
