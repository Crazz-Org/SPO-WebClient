/**
 * ServerBusy poll failure handling — drives the REAL StarpeaceSession
 * (rewritten in Tier 4: the previous version tested a parallel mock class,
 * giving false confidence — audit P6).
 *
 * Ground truth (Voyager client):
 * - ServerBusy is a blocking property GET polled ~every 50s
 *   (ToolbarHandlerViewer.pas:131-162 — LEDsTimer 1s gated mod 50).
 * - After 4 consecutive exceptions the client simply STOPS polling
 *   (fExceptCount gate, ServerCnxHandler.pas:3596-3611). It NEVER reconnects
 *   from poll failures — reconnection happens only on a real socket close.
 * - A successful poll resets the failure counter.
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
import { SessionPhase, WsMessageType } from '../../shared/types';
import type { WsMessage } from '../../shared/types';
import type { MockTcpSocket } from './protocol-validation/mock-tcp-socket';

const WORLD_CONTEXT_ID = '8161308';

interface SessionInternals {
  serverBusyCheckInterval: ReturnType<typeof setInterval> | null;
  consecutivePollFailures: number;
  isServerBusy: boolean;
  rdoMetrics: { totalServerBusyPollFailures: number };
}

describe('ServerBusy polling (real session) — stop@4, no reconnect', () => {
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

  /** Real production constant, read off the class under test (not a mock copy). */
  function maxPollFailures(): number {
    return (harness.session.constructor as unknown as { MAX_CONSECUTIVE_POLL_FAILURES: number })
      .MAX_CONSECUTIVE_POLL_FAILURES;
  }

  /**
   * Advance fake time in 10s steps (with real setImmediate breaths so mock
   * responses reach the session) until the condition holds. Robust against
   * poll/timeout scheduling drift across the 50s interval and 180s deadline.
   */
  async function advanceUntil(cond: () => boolean, maxSteps = 300): Promise<void> {
    for (let i = 0; i < maxSteps && !cond(); i++) {
      await jest.advanceTimersByTimeAsync(10_000);
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(cond()).toBe(true);
  }

  it('exposes the legacy fExceptCount gate: MAX_CONSECUTIVE_POLL_FAILURES = 4', () => {
    expect(maxPollFailures()).toBe(4);
  });

  it('real cadence: first GET ServerBusy goes out only after the 50s gate', async () => {
    worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });
    harness.session.startServerBusyPolling();

    await jest.advanceTimersByTimeAsync(49_000);
    expect(worldSocket.getCommandsByMember('ServerBusy')).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1_100);
    expect(worldSocket.getCommandsByMember('ServerBusy')).toHaveLength(1);
    // Wire form: GET with a RID; the answer echoes the member name
    // (captured commands are stored with the trailing ";" stripped)
    expect(worldSocket.getCommandsByMember('ServerBusy')[0]).toMatch(/^C \d+ sel 8161308 get ServerBusy$/);
  });

  it('stops polling after MAX consecutive timeouts — and NEVER reconnects', async () => {
    // No fallback for ServerBusy → every poll times out at the 180s deadline.
    harness.session.startServerBusyPolling();

    await advanceUntil(() => internals().serverBusyCheckInterval === null);

    // Stopped at exactly the gate value, without ever reconnecting
    expect(internals().rdoMetrics.totalServerBusyPollFailures).toBe(maxPollFailures());
    expect(reconnectSpy).not.toHaveBeenCalled();

    // And it STAYS stopped — no further ServerBusy frames
    const sentBefore = worldSocket.getCommandsByMember('ServerBusy').length;
    await jest.advanceTimersByTimeAsync(600_000);
    expect(worldSocket.getCommandsByMember('ServerBusy')).toHaveLength(sentBefore);
  });

  it('a successful poll resets the consecutive-failure counter and polling continues', async () => {
    harness.session.startServerBusyPolling();

    // Let two consecutive failures accumulate (no fallback yet)
    await advanceUntil(() => internals().consecutivePollFailures >= 2);
    const failuresSoFar = internals().rdoMetrics.totalServerBusyPollFailures;
    expect(failuresSoFar).toBeGreaterThanOrEqual(2);

    // Now the server answers → the next completed poll resets the counter
    worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });
    await advanceUntil(() => internals().consecutivePollFailures === 0);

    expect(internals().serverBusyCheckInterval).not.toBeNull(); // still polling
    expect(internals().isServerBusy).toBe(false);
    // Cumulative metric never resets
    expect(internals().rdoMetrics.totalServerBusyPollFailures).toBeGreaterThanOrEqual(failuresSoFar);
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('a poll that flips the busy flag emits one EVENT_MODEL_STATUS_CHANGED with the matching status', async () => {
    const emitSpy = jest.spyOn(harness.session, 'emit');
    worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#-1"' });
    harness.session.startServerBusyPolling();

    await advanceUntil(() => internals().isServerBusy === true);

    const events = emitSpy.mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage)
      .filter((event) => event.type === WsMessageType.EVENT_MODEL_STATUS_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: WsMessageType.EVENT_MODEL_STATUS_CHANGED, status: 0 });
  });

  it('a poll whose answer does not change the flag emits nothing', async () => {
    worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });
    harness.session.startServerBusyPolling();
    await advanceUntil(() => internals().consecutivePollFailures === 0 && internals().isServerBusy === false);

    const emitSpy = jest.spyOn(harness.session, 'emit');
    // One more full poll cycle with the same unchanged answer.
    await jest.advanceTimersByTimeAsync(60_000);
    await new Promise(resolve => setImmediate(resolve));

    const events = emitSpy.mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage)
      .filter((event) => event.type === WsMessageType.EVENT_MODEL_STATUS_CHANGED);
    expect(events).toHaveLength(0);
  });

  it('polling can restart after a stop (startServerBusyPolling after reconnect)', async () => {
    harness.session.startServerBusyPolling();
    await advanceUntil(() => internals().serverBusyCheckInterval === null);

    worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });
    const sentBefore = worldSocket.getCommandsByMember('ServerBusy').length;
    harness.session.startServerBusyPolling();

    await advanceUntil(() =>
      worldSocket.getCommandsByMember('ServerBusy').length > sentBefore
      && internals().consecutivePollFailures === 0
    );

    expect(internals().serverBusyCheckInterval).not.toBeNull();
    expect(internals().isServerBusy).toBe(false);
    expect(reconnectSpy).not.toHaveBeenCalled();
  });
});
