/**
 * RDO wire test — KeepAlive, driven through the production emitter
 * (`startCacherKeepAlive` in spo_session.ts).
 *
 * KeepAlive is published on the inspector temp object (CachedObjectWrap.pas:36);
 * the legacy client keep-alives the OPEN inspector object every ~60 s
 * (ObjectInspectorHandleViewer.pas:1172-1180). The cacherId was the old, removed
 * target: today the frame targets the active inspector temp object, void push,
 * no arguments, no RID.
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
import {
  setActiveInspectorForTest,
  releaseInspector,
  type ActiveInspector,
} from '../../session/building-details-handler';
import type { SessionContext } from '../../session/session-context';

const CACHER_ID = '8161400';
const TEMP_OBJECT_ID = '7024008';
const FRAME = `C sel ${TEMP_OBJECT_ID} call KeepAlive "*";`;

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

describe('KeepAlive wire frame (startCacherKeepAlive)', () => {
  let harness: ProtocolTestHarness;
  let inspectorSet: boolean;

  const keepAlives = (): string[] =>
    harness.getSockets()[0].getCapturedWrites().filter(w => w.includes('KeepAlive'));

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('map', '127.0.0.1', 6000);
    harness.session.setCacherId(CACHER_ID);
    (harness.session as unknown as { startCacherKeepAlive(): void }).startCacherKeepAlive();
    inspectorSet = false;
  });

  afterEach(() => {
    if (inspectorSet) releaseInspector(harness.session as unknown as SessionContext);
    harness.session.destroy();
    harness.cleanup();
    jest.useRealTimers();
  });

  function openInspector(): void {
    setActiveInspectorForTest(harness.session as unknown as SessionContext, fakeInspector(TEMP_OBJECT_ID));
    inspectorSet = true;
  }

  it('writes exactly the void KeepAlive frame on the inspector temp object', () => {
    openInspector();
    jest.advanceTimersByTime(60_100);
    expect(keepAlives()).toEqual([FRAME]);
  });

  it('re-emits the same frame on every tick', () => {
    openInspector();
    jest.advanceTimersByTime(120_200);
    expect(keepAlives()).toEqual([FRAME, FRAME]);
  });

  it('writes nothing when no inspector is open', () => {
    jest.advanceTimersByTime(60_100);
    expect(keepAlives()).toEqual([]);
  });
});
