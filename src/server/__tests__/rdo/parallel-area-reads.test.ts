/**
 * Parallel area reads (RDO_PARALLEL_AREA_READS) + focusBuilding dedup —
 * drives the REAL StarpeaceSession over the mock transport.
 *
 * Policy under test (Delphi-verified, agents 2026-07-03):
 * - ObjectsInArea / SegmentsInArea are ClientView-stateless reads
 *   (InterfaceServer.pas:751-782, :1012-1058) and safe to send concurrently;
 *   with the flag ON they must BOTH be on the wire before either response.
 * - With the flag OFF (default), the legacy sequential order is preserved:
 *   SegmentsInArea goes out only after the ObjectsInArea response.
 * - SwitchFocusEx must NEVER be duplicated for concurrent identical focus
 *   requests (non-atomic unfocus/focus pair server-side,
 *   InterfaceServer.pas:906-946): concurrent focusBuilding(x,y) for the
 *   same coordinates share one wire call.
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

import { createProtocolTestHarness, ProtocolTestHarness } from '../protocol-validation/protocol-test-harness';
import { SessionPhase } from '../../../shared/types';
import { IS_PROXY_TIMEOUT_MS } from '../../../shared/timeout-categories';
import { config } from '../../../shared/config';
import {
  buildFocusResponse,
  CAPTURED_FARM,
} from '../../../mock-server/scenarios/switch-focus-scenario';
import type { MockTcpSocket } from '../protocol-validation/mock-tcp-socket';

const WORLD_CONTEXT_ID = '8161308';

/** Flush pending microtasks + setImmediate callbacks */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Parallel area reads + focus dedup (real session)', () => {
  let harness: ProtocolTestHarness;
  let worldSocket: MockTcpSocket;
  const defaultParallelFlag = config.rdo.parallelAreaReads;

  beforeEach(async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    worldSocket = harness.getSockets()[0];
    harness.session.setWorldContextId(WORLD_CONTEXT_ID);
    harness.session.setPhase(SessionPhase.WORLD_CONNECTED);
  });

  afterEach(() => {
    config.rdo.parallelAreaReads = defaultParallelFlag;
    harness.session.destroy();
    harness.cleanup();
  });

  /** Count captured wire commands containing a member name */
  function countSent(member: string): number {
    return worldSocket.getCapturedCommands().filter((c) => c.includes(member)).length;
  }

  /** Extract the RID of the first captured command for a member */
  function ridOf(member: string): string {
    const cmd = worldSocket.getCapturedCommands().find((c) => c.includes(member));
    const rid = cmd?.match(/^C (\d+) /)?.[1];
    if (!rid) throw new Error(`No captured command for ${member}`);
    return rid;
  }

  /** Emit a server answer frame for a RID */
  function respond(rid: string, body: string): void {
    worldSocket.emit('data', Buffer.from(`A${rid} ${body};`, 'latin1'));
  }

  describe('config flag', () => {
    it('parallelAreaReads defaults to false (opt-in during live validation)', () => {
      expect(defaultParallelFlag).toBe(false);
    });
  });

  describe('loadMapArea — flag OFF (legacy sequential order)', () => {
    it('sends SegmentsInArea only after the ObjectsInArea response arrives', async () => {
      config.rdo.parallelAreaReads = false;
      const mapPromise = harness.session.loadMapArea(100, 100, 64, 64);
      await flush();

      expect(countSent('ObjectsInArea')).toBe(1);
      expect(countSent('SegmentsInArea')).toBe(0);

      respond(ridOf('ObjectsInArea'), 'res="%"');
      await flush();

      expect(countSent('SegmentsInArea')).toBe(1);
      respond(ridOf('SegmentsInArea'), 'res="%"');

      const map = await mapPromise;
      expect(map.buildings).toEqual([]);
      expect(map.segments).toEqual([]);
      expect(map.x).toBe(100);
      expect(map.y).toBe(100);
    });
  });

  describe('loadMapArea — flag ON (concurrent independent reads)', () => {
    it('sends BOTH area reads before any response (1 RTT instead of 2)', async () => {
      config.rdo.parallelAreaReads = true;
      const mapPromise = harness.session.loadMapArea(100, 100, 64, 64);
      await flush();

      // Both requests must be in flight before the server answered anything
      expect(countSent('ObjectsInArea')).toBe(1);
      expect(countSent('SegmentsInArea')).toBe(1);

      respond(ridOf('ObjectsInArea'), 'res="%"');
      respond(ridOf('SegmentsInArea'), 'res="%"');

      const map = await mapPromise;
      expect(map.buildings).toEqual([]);
      expect(map.segments).toEqual([]);
    });

    it('keeps identical wire frames (same verb/target/args as sequential mode)', async () => {
      config.rdo.parallelAreaReads = true;
      const p1 = harness.session.loadMapArea(200, 300, 64, 64);
      await flush();
      respond(ridOf('ObjectsInArea'), 'res="%"');
      respond(ridOf('SegmentsInArea'), 'res="%"');
      await p1;
      const parallelFrames = worldSocket.getCapturedCommands().map((c) => c.replace(/^C \d+ /, ''));

      worldSocket.reset();
      config.rdo.parallelAreaReads = false;
      const p2 = harness.session.loadMapArea(200, 300, 64, 64);
      await flush();
      respond(ridOf('ObjectsInArea'), 'res="%"');
      await flush();
      respond(ridOf('SegmentsInArea'), 'res="%"');
      await p2;
      const sequentialFrames = worldSocket.getCapturedCommands().map((c) => c.replace(/^C \d+ /, ''));

      // Byte-identical frames modulo RID — parallelism changes timing only
      expect(new Set(parallelFrames)).toEqual(new Set(sequentialFrames));
    });

    it('rejects the whole map load when a read times out (only rejection path — legacy parity: error frames resolve)', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      try {
        config.rdo.parallelAreaReads = true;
        const mapPromise = harness.session.loadMapArea(100, 100, 64, 64);
        const captured = mapPromise.then(
          () => { throw new Error('expected rejection'); },
          (err: Error) => err,
        );
        await flush();

        expect(countSent('ObjectsInArea')).toBe(1);
        expect(countSent('SegmentsInArea')).toBe(1);

        // Answer one read; let the other hit its deadline
        respond(ridOf('SegmentsInArea'), 'res="%"');
        await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);

        const err = await captured;
        expect(err.message).toContain('Request timeout: ObjectsInArea');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('focusBuilding — concurrent dedup (SwitchFocusEx)', () => {
    const FOCUS_BODY = `res="%${buildFocusResponse(CAPTURED_FARM)}"`;

    it('concurrent focusBuilding for the SAME coords sends ONE SwitchFocusEx', async () => {
      const p1 = harness.session.focusBuilding(472, 392);
      const p2 = harness.session.focusBuilding(472, 392);
      await flush();

      expect(countSent('SwitchFocusEx')).toBe(1);

      respond(ridOf('SwitchFocusEx'), FOCUS_BODY);
      const [info1, info2] = await Promise.all([p1, p2]);

      expect(info1.buildingId).toBe(CAPTURED_FARM.objectId);
      expect(info2).toEqual(info1);
    });

    it('a back-to-back re-focus on the SAME building reuses the fresh result (no 2nd SwitchFocusEx)', async () => {
      // This is the real click pattern: REQ_BUILDING_FOCUS then the details
      // fetch, handled sequentially by the gateway — each triggers focusBuilding
      const p1 = harness.session.focusBuilding(472, 392);
      await flush();
      respond(ridOf('SwitchFocusEx'), FOCUS_BODY);
      const info1 = await p1;

      const info2 = await harness.session.focusBuilding(472, 392);
      await flush();

      expect(countSent('SwitchFocusEx')).toBe(1);
      expect(info2).toEqual(info1);
    });

    it('focusing DIFFERENT coordinates sends a new SwitchFocusEx (no stale reuse)', async () => {
      const p1 = harness.session.focusBuilding(472, 392);
      await flush();
      respond(ridOf('SwitchFocusEx'), FOCUS_BODY);
      await p1;

      const p2 = harness.session.focusBuilding(500, 400);
      await flush();

      expect(countSent('SwitchFocusEx')).toBe(2);
      const secondRid = worldSocket
        .getCapturedCommands()
        .filter((c) => c.includes('SwitchFocusEx'))[1]
        .match(/^C (\d+) /)![1];
      respond(secondRid, FOCUS_BODY);
      await p2;
    });

    it('re-focus on the same building AFTER the reuse TTL sends a fresh SwitchFocusEx', async () => {
      const p1 = harness.session.focusBuilding(472, 392);
      await flush();
      respond(ridOf('SwitchFocusEx'), FOCUS_BODY);
      await p1;

      // Age the cached focus beyond the 3s TTL
      (harness.session as unknown as { lastFocusAt: number }).lastFocusAt = Date.now() - 10_000;

      const p2 = harness.session.focusBuilding(472, 392);
      await flush();

      expect(countSent('SwitchFocusEx')).toBe(2);
      const secondRid = worldSocket
        .getCapturedCommands()
        .filter((c) => c.includes('SwitchFocusEx'))[1]
        .match(/^C (\d+) /)![1];
      respond(secondRid, FOCUS_BODY);
      await p2;
    });

    it('second sequential focus carries the previous building id (legacy From param)', async () => {
      const p1 = harness.session.focusBuilding(472, 392);
      await flush();
      respond(ridOf('SwitchFocusEx'), FOCUS_BODY);
      await p1;

      const p2 = harness.session.focusBuilding(500, 400);
      await flush();

      const secondCmd = worldSocket
        .getCapturedCommands()
        .filter((c) => c.includes('SwitchFocusEx'))[1];
      // First arg = previously focused object id, not 0
      expect(secondCmd).toContain(`"#${CAPTURED_FARM.objectId}"`);

      const secondRid = secondCmd.match(/^C (\d+) /)![1];
      respond(secondRid, FOCUS_BODY);
      await p2;
    });

    it('a timed-out focus clears the pending entry so a retry sends a new call', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      try {
        const p1 = harness.session.focusBuilding(472, 392);
        const captured = p1.then(
          () => { throw new Error('expected rejection'); },
          (err: Error) => err,
        );
        await flush();
        await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);
        const err = await captured;
        expect(err.message).toContain('Request timeout: SwitchFocusEx');
      } finally {
        jest.useRealTimers();
      }

      // Pending entry must be gone: the retry sends a NEW SwitchFocusEx
      const p2 = harness.session.focusBuilding(472, 392);
      await flush();
      expect(countSent('SwitchFocusEx')).toBe(2);

      const secondRid = worldSocket
        .getCapturedCommands()
        .filter((c) => c.includes('SwitchFocusEx'))[1]
        .match(/^C (\d+) /)![1];
      respond(secondRid, FOCUS_BODY);
      await p2;
    });
  });
});
