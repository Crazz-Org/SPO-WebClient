/**
 * RDO wire test — CloseObject, driven through the production emitter
 * (`cacherCloseObject` in spo_session.ts): void push on the cacher root,
 * one integer argument (the temp object id), no RID.
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

const CACHER_ID = '8161400';

describe('CloseObject wire frame (cacherCloseObject)', () => {
  let harness: ProtocolTestHarness;

  const writes = (): string[] => harness.getSockets()[0].getCapturedWrites();

  beforeEach(async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [], disableStrictValidation: true }],
    });
    await harness.session.createSocket('map', '127.0.0.1', 6000);
    harness.session.setCacherId(CACHER_ID);
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('writes the void CloseObject frame on the cacher root with the temp id', () => {
    harness.session.cacherCloseObject('7024008');
    expect(writes()).toEqual([`C sel ${CACHER_ID} call CloseObject "*" "#7024008";`]);
  });

  it('carries the id it was given, not a constant', () => {
    harness.session.cacherCloseObject('5551234');
    expect(writes()).toEqual([`C sel ${CACHER_ID} call CloseObject "*" "#5551234";`]);
  });

  it('writes nothing without a cacher', () => {
    harness.session.setCacherId(null);
    harness.session.cacherCloseObject('7024008');
    expect(writes()).toEqual([]);
  });
});
