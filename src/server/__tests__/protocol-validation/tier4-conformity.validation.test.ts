/**
 * Tier-4 conformity validation — drives the REAL StarpeaceSession.
 *
 * Covers the conformity audit fixes:
 *  V1  ServerBusy poll must read wordbool "#-1" as busy (any non-zero ordinal)
 *  V2  A throwing push handler must not kill frame processing / the gateway
 *  V4  A recoverable RDO error must NEVER trigger a reconnect (close-only policy)
 *  P1a AnswerStatus heartbeat must be answered A<rid> res="#0"
 *      (legacy TISEvents.AnswerStatus → NOERROR, ServerCnxHandler.pas:666-669)
 *  P1b Malformed "Aerror 17" busy rejection must flip the busy flag
 *
 * assertNoViolations() is not called: the socket carries no scenario exchange
 * (rdoScenarios: []), so the strict validator has nothing to compare a frame
 * against; the frames are pinned by literal assertions instead.
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
import { SessionPhase } from '../../../shared/types';
import type { MockTcpSocket } from './mock-tcp-socket';
import { TimeoutCategory } from '../../../shared/timeout-categories';

const WORLD_CONTEXT_ID = '8161308';

interface SessionInternals {
  isServerBusy: boolean;
  knownObjects: Map<string, string>;
}

function internals(harness: ProtocolTestHarness): SessionInternals {
  return harness.session as unknown as SessionInternals;
}

/** Inject raw server→client bytes into the session's world socket. */
function injectData(socket: MockTcpSocket, frame: string): void {
  socket.emit('data', Buffer.from(frame, 'latin1'));
}

describe('Tier-4 RDO conformity (real session)', () => {
  let harness: ProtocolTestHarness;
  let worldSocket: MockTcpSocket;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [], disableStrictValidation: true },
      ],
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

  describe('V1 — ServerBusy poll boolean parsing', () => {
    async function pollOnceWith(payload: string): Promise<void> {
      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload });
      harness.session.startServerBusyPolling();
      await jest.advanceTimersByTimeAsync(50_000 + 100);
    }

    it('reads the canonical wordbool true "#-1" as BUSY', async () => {
      await pollOnceWith('ServerBusy="#-1"');
      expect(internals(harness).isServerBusy).toBe(true);
    });

    it('reads the ordinal "#1" as BUSY (any non-zero = true)', async () => {
      await pollOnceWith('ServerBusy="#1"');
      expect(internals(harness).isServerBusy).toBe(true);
    });

    it('reads "#0" as NOT busy', async () => {
      internals(harness).isServerBusy = true;
      await pollOnceWith('ServerBusy="#0"');
      expect(internals(harness).isServerBusy).toBe(false);
    });
  });

  // ===================================================================
  // O-L5 — the busy poll goes through sendRdoRequest, not around it
  //
  // It used to be a second implementation of the primitive (its own rid
  // allocation, frame write, pendingRequests entry and timer), which drifted
  // from the real one. It now calls sendRdoRequest with two explicit options.
  // Both are load-bearing, so both are pinned.
  // ===================================================================
  describe('O-L5 — ServerBusy poll uses the shared primitive', () => {
    it('still emits while isServerBusy — buffering the poll would deadlock the session', async () => {
      // The flag can only be cleared by this very poll or a ModelStatusChanged
      // push. If the busy gate buffered it, a busy server would be permanent.
      internals(harness).isServerBusy = true;
      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });

      harness.session.startServerBusyPolling();
      await jest.advanceTimersByTimeAsync(50_000 + 100);

      expect(worldSocket.getCapturedCommands().some(c => /get ServerBusy/.test(c))).toBe(true);
      expect(internals(harness).isServerBusy).toBe(false);
    });

    it('logs the poll as a real RDO>> request, with a rid', async () => {
      // The duplication's visible symptom: the poll was the only RDO traffic in
      // the project that never produced an `RDO>> <socket>` entry — it wrote the
      // frame directly, so it only showed up on the raw `RDO>*` wire tap, which
      // belongs to a different logger (rdo-helpers.ts:77) and is therefore NOT
      // observable from this spy. Asserting its absence here would pass either
      // way; the positive assertion is what bites.
      const debugSpy = jest.spyOn(harness.session.log, 'debug');
      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });

      harness.session.startServerBusyPolling();
      await jest.advanceTimersByTimeAsync(50_000 + 100);

      const requestLog = debugSpy.mock.calls.find(([msg, payload]) =>
        typeof msg === 'string' && msg.startsWith('RDO>> world')
        && (payload as { command?: string })?.command === 'ServerBusy',
      );
      expect(requestLog).toBeDefined();
      expect((requestLog![1] as { rid?: number }).rid).toEqual(expect.any(Number));
    });

    it('keeps the poll on the primary socket when a world pool is live', async () => {
      // A poll answered by a pool connection about to be replaced counts as a
      // poll failure, and four of those stop polling for good (legacy parity).
      harness.session.setWorldPoolEnabled(true);
      harness.session.initWorldPool('127.0.0.1', 8000);
      harness.session.populateWorldPool();
      await jest.advanceTimersByTimeAsync(100);
      expect(harness.session.getWorldPool()!.size).toBeGreaterThan(0);

      worldSocket.addFallbackResponse({ member: 'ServerBusy', payload: 'ServerBusy="#0"' });
      harness.session.startServerBusyPolling();
      await jest.advanceTimersByTimeAsync(50_000 + 100);

      expect(worldSocket.getCapturedCommands().some(c => /get ServerBusy/.test(c))).toBe(true);
      expect(harness.getPoolCapturedCommands().some(c => /ServerBusy/.test(c))).toBe(false);
    });
  });

  describe('V2 — toxic push must not kill frame processing', () => {
    it('a throwing ws_event listener does not prevent the next frame in the same chunk', () => {
      harness.session.on('ws_event', () => {
        throw new Error('listener boom');
      });

      // One TCP chunk: a RefreshArea push (whose listener throws) glued to an
      // AnswerStatus heartbeat that MUST still be answered.
      expect(() => injectData(
        worldSocket,
        'C sel 40133496 call RefreshArea "*" "#10","#20","#5","#5","%";'
        + 'C 777 sel 40133496 call AnswerStatus "^" ;'
      )).not.toThrow();

      const writes = harness.getSockets()[0].getCapturedWrites();
      expect(writes.some(w => w.includes('A777 res="#0"'))).toBe(true);
    });
  });

  describe('V4 — recoverable RDO error never reconnects (close-only policy)', () => {
    it('does not call attemptWorldReconnect while retrying a degraded-connection error', async () => {
      const reconnectSpy = jest
        .spyOn(harness.session, 'attemptWorldReconnect')
        .mockResolvedValue(undefined);

      // errSendError(10) — classified RECOVERABLE + connectionDegraded
      worldSocket.addFallbackResponse({ member: 'TestProp', payload: 'error 10' });

      const promise = harness.session.sendRdoRequest('world', {
        verb: 'sel' as never,
        targetId: WORLD_CONTEXT_ID,
        action: 'get' as never,
        member: 'TestProp',
      }, 10_000, TimeoutCategory.NORMAL);
      promise.catch(() => { /* handled below — avoid unhandled-rejection noise */ });

      // Advance fake time in 1s steps with a real setImmediate breath between
      // each, so the mock socket's setImmediate-delivered responses reach the
      // session between retry backoffs.
      for (let i = 0; i < 15; i++) {
        await jest.advanceTimersByTimeAsync(1_000);
        await new Promise(resolve => setImmediate(resolve));
      }
      const result = await promise;

      expect(result.errorCode).toBe(10);
      expect(reconnectSpy).not.toHaveBeenCalled();
    });
  });

  describe('P1a — AnswerStatus heartbeat', () => {
    it('answers A<rid> res="#0" (legacy TISEvents.AnswerStatus → NOERROR)', () => {
      injectData(worldSocket, 'C 4321 sel 40133496 call AnswerStatus "^" ;');

      const writes = worldSocket.getCapturedWrites();
      const reply = writes.find(w => w.includes('A4321'));
      expect(reply).toBeDefined();
      expect(reply).toContain('A4321 res="#0";');
    });

    it('still answers the reverse idof "InterfaceEvents" with objid=', () => {
      internals(harness).knownObjects.set('InterfaceEvents', '40133496');
      injectData(worldSocket, 'C 99 idof "InterfaceEvents";');

      const writes = worldSocket.getCapturedWrites();
      expect(writes.some(w => w.includes('A99 objid="40133496";'))).toBe(true);
    });
  });

  describe('P1b — malformed "Aerror 17" busy rejection', () => {
    it('flips the busy flag and does not corrupt the following frame', () => {
      expect(internals(harness).isServerBusy).toBe(false);

      // Busy rejection glued to a heartbeat: both must be handled.
      injectData(worldSocket, 'Aerror 17C 555 sel 40133496 call AnswerStatus "^" ;');

      expect(internals(harness).isServerBusy).toBe(true);
      expect(worldSocket.getCapturedWrites().some(w => w.includes('A555 res="#0"'))).toBe(true);
    });
  });
});
