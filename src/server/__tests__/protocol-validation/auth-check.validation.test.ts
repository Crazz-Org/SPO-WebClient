/**
 * Protocol Validation: Auth-Only Check (checkAuth)
 *
 * Validates that StarpeaceSession.checkAuth() produces the same 5 RDO commands
 * as the auth phase of connectDirectory(), and correctly throws AuthError on failure.
 *
 * Flow under test:
 *   idof DirectoryServer → RDOOpenSession → RDOMapSegaUser → RDOLogonUser → RDOEndSession
 */

// Must mock before any imports that use them
jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/// <reference path="../../__tests__/matchers/rdo-matchers.d.ts" />
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import { createAuthScenario } from '../../../mock-server/scenarios/auth-scenario';
import { AuthError } from '../../../shared/auth-error';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import type { ScenarioVariables } from '../../../mock-server/scenarios/scenario-variables';
import { mergeVariables } from '../../../mock-server/scenarios/scenario-variables';

/** Create an auth scenario that returns a non-zero error code for RDOLogonUser */
function createAuthFailureScenario(errorCode: number, overrides?: Partial<ScenarioVariables>): RdoScenario {
  const vars = mergeVariables(overrides);
  return {
    name: 'auth-failure',
    description: `Directory authentication failure (code ${errorCode})`,
    exchanges: [
      {
        id: 'auth-fail-001',
        request: `C 0 idof "DirectoryServer"`,
        response: `A0 objid="${vars.directoryServerId}"`,
        matchKeys: { verb: 'idof', targetId: 'DirectoryServer' },
      },
      {
        id: 'auth-fail-002',
        request: `C 1 sel ${vars.directoryServerId} get RDOOpenSession`,
        response: `A1 RDOOpenSession="#${vars.directorySessionId}"`,
        matchKeys: { verb: 'sel', action: 'get', member: 'RDOOpenSession' },
      },
      {
        id: 'auth-fail-003',
        request: `C 2 sel ${vars.directorySessionId} call RDOMapSegaUser "^" "%${vars.username}"`,
        response: `A2 res="%"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RDOMapSegaUser' },
      },
      {
        id: 'auth-fail-004',
        request: `C 3 sel ${vars.directorySessionId} call RDOLogonUser "^" "%${vars.username}","%${vars.password}"`,
        response: `A3 res="#${errorCode}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RDOLogonUser' },
      },
      {
        id: 'auth-fail-005',
        request: `C 4 sel ${vars.directorySessionId} call RDOEndSession "*"`,
        response: `A4`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RDOEndSession' },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };
}

describe('Protocol Validation: checkAuth()', () => {
  let harness: ProtocolTestHarness;

  afterEach(() => {
    try {
      harness.assertNoViolations();
    } finally {
      harness.cleanup();
    }
  });

  describe('success path', () => {
    const authBundle = createAuthScenario();

    beforeEach(() => {
      jest.clearAllMocks();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [authBundle.rdo] },
        ],
      });
    });

    it('should send exactly 5 RDO commands', async () => {
      await harness.session.checkAuth('SPO_test3', 'test3');
      const commands = harness.getCapturedCommands(0);
      expect(commands).toHaveLength(5);
    });

    it('should send idof DirectoryServer as first command', async () => {
      await harness.session.checkAuth('SPO_test3', 'test3');
      const commands = harness.getCapturedCommands(0);
      expect(commands[0]).toMatch(/idof "DirectoryServer"/);
    });

    it('should send RDOLogonUser with username and password', async () => {
      await harness.session.checkAuth('SPO_test3', 'test3');
      const commands = harness.getCapturedCommands(0);
      const logonCmd = commands.find(cmd => cmd.includes('RDOLogonUser'));
      expect(logonCmd).toBeDefined();
      expect(logonCmd).toContain('%SPO_test3');
      expect(logonCmd).toContain('%test3');
    });

    it('should send RDOEndSession with void push separator', async () => {
      await harness.session.checkAuth('SPO_test3', 'test3');
      const commands = harness.getCapturedCommands(0);
      const endCmd = commands.find(cmd => cmd.includes('RDOEndSession'));
      expect(endCmd).toBeDefined();
      expect(endCmd).toContain('"*"');
    });

    it('should resolve without error on success (code 0)', async () => {
      await expect(harness.session.checkAuth('SPO_test3', 'test3')).resolves.toBeUndefined();
    });

    it('should close the socket after auth', async () => {
      await harness.session.checkAuth('SPO_test3', 'test3');
      const sockets = harness.getSockets();
      expect(sockets[0].destroyed).toBe(true);
    });
  });

  describe('failure paths', () => {
    it('should throw AuthError with code 12 for invalid username', async () => {
      jest.clearAllMocks();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [createAuthFailureScenario(12)] },
        ],
      });

      try {
        await harness.session.checkAuth('BadUser', 'test3');
        fail('Expected AuthError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).authCode).toBe(12);
      }
    });

    it('should throw AuthError with code 13 for invalid password', async () => {
      jest.clearAllMocks();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [createAuthFailureScenario(13)] },
        ],
      });

      await expect(harness.session.checkAuth('SPO_test3', 'WrongPass'))
        .rejects.toThrow(AuthError);
    });

    it('should throw AuthError with code 17 for account already active', async () => {
      jest.clearAllMocks();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [createAuthFailureScenario(17)] },
        ],
      });

      await expect(harness.session.checkAuth('SPO_test3', 'test3'))
        .rejects.toThrow(AuthError);
    });

    it('should throw AuthError with code 112 for non-existent account', async () => {
      jest.clearAllMocks();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [createAuthFailureScenario(112)] },
        ],
      });

      await expect(harness.session.checkAuth('Nobody', 'test3'))
        .rejects.toThrow(AuthError);
    });
  });
});
