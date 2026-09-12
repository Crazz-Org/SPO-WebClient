/**
 * L1 protocol scenario: the `world-list` exchanges driven through the REAL gateway.
 *
 * `scenarios.test.ts` checks the fixture's shape; this drives `connectDirectory` against it
 * over mock sockets, so the RDOCanJoinNewWorld frame asserted here is the one the gateway
 * actually emits — one widestring argument, against the directory SESSION id, inside the query
 * session, after RDOQueryKey and before RDOEndSession
 * (`DServer/DirectoryServer.pas:116`, `logonComplete.asp:100-106`).
 */

// Must mock before any imports that use them
jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createProtocolTestHarness,
  ProtocolTestHarness,
} from '@/server/__tests__/protocol-validation/protocol-test-harness';
import { mergeVariables } from './scenario-variables';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario } from './world-list-scenario';

const VARS = { username: 'SPO_test3', password: 'test3' } as const;
const SESSION_ID = mergeVariables(VARS).directorySessionId;
const CAN_JOIN_FRAME = new RegExp(
  `^C \\d+ sel ${SESSION_ID} call RDOCanJoinNewWorld "\\^" "%SPO_test3"$`,
);

describe('L1: world-list scenario driven through connectDirectory()', () => {
  let harness: ProtocolTestHarness;

  function buildHarness(canJoinNewWorld?: boolean): void {
    harness = createProtocolTestHarness({
      socketConfigs: [
        // Socket 0: directory_auth
        { rdoScenarios: [createAuthScenario(VARS).rdo] },
        // Socket 1: directory_query
        {
          rdoScenarios: [
            createWorldListScenario(
              VARS,
              canJoinNewWorld === undefined ? undefined : { canJoinNewWorld },
            ).rdo,
          ],
        },
      ],
    });
  }

  /** The one RDOCanJoinNewWorld frame, asserted on shape and on position. */
  function assertCanJoinFrame(): void {
    const queryCmds = harness.getCapturedCommands(1);
    expect(queryCmds.filter(c => c.includes('RDOCanJoinNewWorld'))).toHaveLength(1);

    const canJoinIdx = queryCmds.findIndex(c => CAN_JOIN_FRAME.test(c));
    expect(canJoinIdx).toBeGreaterThanOrEqual(0);
    const queryIdx = queryCmds.findIndex(c => c.includes('call RDOQueryKey'));
    const endIdx = queryCmds.findIndex(c => c.includes('call RDOEndSession'));
    expect(queryIdx).toBeLessThan(canJoinIdx);
    expect(canJoinIdx).toBeLessThan(endIdx);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('records the world limit when RDOCanJoinNewWorld answers 0', async () => {
    buildHarness(false);

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

    expect(harness.session.isAtWorldLimit()).toBe(true);
    expect(worlds.length).toBeGreaterThan(0);
    assertCanJoinFrame();
    harness.assertNoViolations();
  });

  it('records no limit when RDOCanJoinNewWorld answers -1', async () => {
    buildHarness(true);

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

    expect(harness.session.isAtWorldLimit()).toBe(false);
    expect(worlds.length).toBeGreaterThan(0);
    assertCanJoinFrame();
    harness.assertNoViolations();
  });

  it('asks by default, and the default answer leaves the login unchanged', async () => {
    buildHarness();

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

    expect(harness.session.isAtWorldLimit()).toBe(false);
    expect(worlds.map(w => w.name)).toContain('shamba');
    assertCanJoinFrame();
    harness.assertNoViolations();
  });
});
