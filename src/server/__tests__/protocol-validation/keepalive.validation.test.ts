/**
 * Cacher KeepAlive conformity validation.
 *
 * Delphi ground truth: KeepAlive is published on TCachedObjectWrap (the
 * inspector temp object, CachedObjectWrap.pas:33, impl :292-294); the cacher
 * ROOT ('WSObjectCacher' hook = TWorldRegistyServer) publishes NO KeepAlive.
 * The legacy client keep-alives the OPEN inspector object every ~60s
 * (ObjectInspectorHandleViewer.pas:1172-1178); the server reaps temp objects
 * idle > 5 minutes (fMaxTTL = EncodeTime(0,5,0,0), CacheServerReportForm.pas:244).
 *
 * Old behavior (non-conformant): sel <cacherId> call KeepAlive every 60s
 * → errUnexistentMethod noise. New behavior: target the active inspector
 * temp object; silence when no inspector is open.
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
import {
  setActiveInspectorForTest,
  releaseInspector,
  type ActiveInspector,
} from '../../session/building-details-handler';
import type { SessionContext } from '../../session/session-context';

const CACHER_ID = '987654';
const TEMP_OBJECT_ID = '5551234';

function fakeInspector(tempObjectId: string): ActiveInspector {
  return {
    tempObjectId,
    x: 10,
    y: 20,
    visualClass: 'TestBuilding',
    mutex: { runExclusive: (fn: () => unknown) => fn() } as unknown as ActiveInspector['mutex'],
    gateMap: '0000',
    hasSupplies: false,
    hasProducts: false,
    hasCompInputs: false,
    isWarehouse: false,
  };
}

describe('Cacher KeepAlive targeting', () => {
  let harness: ProtocolTestHarness;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('map', '127.0.0.1', 6000);
    harness.session.setCacherId(CACHER_ID);
    (harness.session as unknown as { startCacherKeepAlive(): void }).startCacherKeepAlive();
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
    jest.useRealTimers();
  });

  it('sends NO KeepAlive when no inspector is open (legacy parity: nothing to keep alive)', () => {
    jest.advanceTimersByTime(3 * 60_000 + 100);

    const keepAlives = harness.getCapturedCommands(0).filter(c => c.includes('KeepAlive'));
    expect(keepAlives).toHaveLength(0);
  });

  it('keep-alives the ACTIVE inspector temp object, never the cacher root', () => {
    setActiveInspectorForTest(harness.session as unknown as SessionContext, fakeInspector(TEMP_OBJECT_ID));

    jest.advanceTimersByTime(60_000 + 100);

    const keepAlives = harness.getCapturedCommands(0).filter(c => c.includes('KeepAlive'));
    expect(keepAlives).toHaveLength(1);
    expect(keepAlives[0]).toContain(`sel ${TEMP_OBJECT_ID}`);
    expect(keepAlives[0]).toContain('"*"'); // fire-and-forget void push
    expect(keepAlives[0]).not.toContain(`sel ${CACHER_ID}`);
    expect(keepAlives[0]).toMatch(/^C sel /); // no RID
  });

  it('stops sending once the inspector is released', () => {
    const ctx = harness.session as unknown as SessionContext;
    setActiveInspectorForTest(ctx, fakeInspector(TEMP_OBJECT_ID));

    jest.advanceTimersByTime(60_000 + 100);
    expect(harness.getCapturedCommands(0).filter(c => c.includes('KeepAlive'))).toHaveLength(1);

    releaseInspector(ctx);

    jest.advanceTimersByTime(2 * 60_000);
    // No further KeepAlive after release (only the CloseObject from release itself)
    expect(harness.getCapturedCommands(0).filter(c => c.includes('KeepAlive'))).toHaveLength(1);
  });
});
