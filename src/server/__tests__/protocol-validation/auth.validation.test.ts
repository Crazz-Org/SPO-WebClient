/**
 * Protocol Validation: Directory Authentication
 *
 * Validates that StarpeaceSession.connectDirectory() produces RDO commands
 * matching real captured server exchanges, and correctly parses responses.
 *
 * Flow under test:
 *   Phase 1 (directory_auth socket): idof → OpenSession → MapSegaUser → LogonUser → EndSession
 *   Phase 2 (directory_query socket): idof → OpenSession → QueryKey → CanJoinNewWorld → EndSession
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
import { createWorldListScenario } from '../../../mock-server/scenarios/world-list-scenario';

describe('Protocol Validation: connectDirectory()', () => {
  let harness: ProtocolTestHarness;
  const authBundle = createAuthScenario();
  const worldListBundle = createWorldListScenario();

  beforeEach(() => {
    jest.clearAllMocks();

    harness = createProtocolTestHarness({
      socketConfigs: [
        // Socket 0: directory_auth (Phase 1)
        { rdoScenarios: [authBundle.rdo] },
        // Socket 1: directory_query (Phase 2)
        { rdoScenarios: [worldListBundle.rdo] },
      ],
    });
  });

  afterEach(() => {
    harness.assertNoViolations();
    harness.cleanup();
  });

  describe('Phase 1: Directory Authentication', () => {
    it('should send idof DirectoryServer as first command', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      expect(phase1Commands.length).toBeGreaterThanOrEqual(1);
      expect(phase1Commands[0]).toMatch(/idof "DirectoryServer"/);
    });

    it('should send RDOOpenSession GET to directory server ID', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const openSessionCmd = phase1Commands.find(cmd => cmd.includes('RDOOpenSession'));
      expect(openSessionCmd).toBeDefined();
      // Should target the directory server ID resolved from idof
      expect(openSessionCmd).toMatch(/sel \d+ get RDOOpenSession/);
    });

    it('should send RDOMapSegaUser with username', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const mapSegaCmd = phase1Commands.find(cmd => cmd.includes('RDOMapSegaUser'));
      expect(mapSegaCmd).toBeDefined();
      expect(mapSegaCmd).toContain('%SPO_test3');
    });

    it('should send RDOLogonUser with username and password', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const logonCmd = phase1Commands.find(cmd => cmd.includes('RDOLogonUser'));
      expect(logonCmd).toBeDefined();
      expect(logonCmd).toContain('%SPO_test3');
      expect(logonCmd).toContain('%test3');
    });

    it('should send RDOEndSession to close auth connection', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const endCmd = phase1Commands.find(cmd => cmd.includes('RDOEndSession'));
      expect(endCmd).toBeDefined();
      // EndSession uses "*" (push) separator
      expect(endCmd).toContain('"*"');
    });

    it('should send exactly 5 commands in Phase 1', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      expect(phase1Commands).toHaveLength(5);
    });

    it('should send Phase 1 commands with sequential RIDs', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const rids: number[] = [];
      for (const cmd of phase1Commands) {
        const ridMatch = cmd.match(/^C (\d+)/);
        if (ridMatch) rids.push(parseInt(ridMatch[1], 10));
      }
      // RIDs should be sequential (ascending)
      for (let i = 1; i < rids.length; i++) {
        expect(rids[i]).toBeGreaterThan(rids[i - 1]);
      }
    });

    it('should chain target IDs from previous responses', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      // Command 0: idof DirectoryServer → response gives directoryServerId
      // Command 1: sel <directoryServerId> get RDOOpenSession
      // Command 2-4: sel <sessionId> call ...

      // The sel target in command 1 should be the directoryServerId from scenario
      const openSessionCmd = phase1Commands[1];
      expect(openSessionCmd).toMatch(/sel 39751288 get RDOOpenSession/);

      // The sel target in command 2 should be the sessionId from scenario
      const mapSegaCmd = phase1Commands[2];
      expect(mapSegaCmd).toMatch(/sel 142217260 call RDOMapSegaUser/);
    });
  });

  describe('Phase 2: Directory Query', () => {
    it('should create a separate socket for directory query', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const sockets = harness.getSockets();
      expect(sockets.length).toBeGreaterThanOrEqual(2);
    });

    it('should send idof DirectoryServer on query socket', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      expect(phase2Commands.length).toBeGreaterThanOrEqual(1);
      expect(phase2Commands[0]).toMatch(/idof "DirectoryServer"/);
    });

    it('should send RDOQueryKey with correct zone path', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      const queryCmd = phase2Commands.find(cmd => cmd.includes('RDOQueryKey'));
      expect(queryCmd).toBeDefined();
      expect(queryCmd).toContain('%Root/Areas/Asia/Worlds');
    });

    it('should send RDOQueryKey with full query block (8 property categories)', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      const queryCmd = phase2Commands.find(cmd => cmd.includes('RDOQueryKey'));
      expect(queryCmd).toBeDefined();
      expect(queryCmd).toContain('General/Population');
      expect(queryCmd).toContain('Interface/IP');
      expect(queryCmd).toContain('Interface/Port');
      expect(queryCmd).toContain('Interface/Running');
    });

    it('should send RDOEndSession to close query connection', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      const endCmd = phase2Commands.find(cmd => cmd.includes('RDOEndSession'));
      expect(endCmd).toBeDefined();
    });

    it('should send RDOCanJoinNewWorld once, with the username, after RDOQueryKey and before RDOEndSession', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      const canJoinCmds = phase2Commands.filter(cmd => cmd.includes('RDOCanJoinNewWorld'));
      expect(canJoinCmds).toHaveLength(1);
      expect(canJoinCmds[0]).toMatch(/call RDOCanJoinNewWorld "\^" "%SPO_test3"$/);

      const canJoinIdx = phase2Commands.findIndex(cmd => cmd.includes('RDOCanJoinNewWorld'));
      const queryIdx = phase2Commands.findIndex(cmd => cmd.includes('RDOQueryKey'));
      const endIdx = phase2Commands.findIndex(cmd => cmd.includes('RDOEndSession'));
      expect(queryIdx).toBeLessThan(canJoinIdx);
      expect(canJoinIdx).toBeLessThan(endIdx);
    });

    it('should send exactly 5 commands in Phase 2', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const phase2Commands = harness.getCapturedCommands(1);
      expect(phase2Commands).toHaveLength(5);
    });
  });

  describe('Return value parsing', () => {
    it('should return WorldInfo array from directory query', async () => {
      const worlds = await harness.session.connectDirectory(
        'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
      );

      expect(worlds).toBeDefined();
      expect(Array.isArray(worlds)).toBe(true);
      expect(worlds.length).toBeGreaterThan(0);
    });

    it('should parse world names from response', async () => {
      const worlds = await harness.session.connectDirectory(
        'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
      );

      const worldNames = worlds.map(w => w.name);
      // Asia region worlds from captured data
      expect(worldNames).toContain('shamba');
    });

    it('should parse IP addresses from response', async () => {
      const worlds = await harness.session.connectDirectory(
        'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
      );

      // keyFieldMatch correctly selects Asia's RDOQueryKey via argsPattern
      const shamba = worlds.find(w => w.name === 'shamba');
      expect(shamba).toBeDefined();
      expect(shamba!.ip).toBe('158.69.153.134');
      expect(shamba!.port).toBe(8000);
    });

    it('should skip worlds without port (port=0)', async () => {
      const worlds = await harness.session.connectDirectory(
        'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
      );

      // Worlds without IP/port (like basinia, leonia) should be excluded
      const worldNames = worlds.map(w => w.name);
      expect(worldNames).not.toContain('basinia');
    });
  });

  describe('Full flow compliance', () => {
    it('should send exactly 10 commands total (5 auth + 5 query)', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const allCommands = harness.getAllCapturedCommands();
      expect(allCommands).toHaveLength(10);
    });

    it('should use RDO call format for method invocations', async () => {
      await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

      const allCommands = harness.getAllCapturedCommands();
      const callCommands = allCommands.filter(cmd => cmd.includes(' call '));

      for (const cmd of callCommands) {
        // Verify RDO call format: C <rid> sel <targetId> call <method> "<sep>" <args>
        const methodName = cmd.match(/call (\w+)/)![1];
        expect(cmd).toMatch(new RegExp(`call ${methodName} "[*^]"`));
      }
    });

    it('should work with different credentials (variable substitution)', async () => {
      // Rebuild scenarios with different credentials
      const customAuth = createAuthScenario({ username: 'TestUser', password: 'TestPass123' });
      const customWorldList = createWorldListScenario({ username: 'TestUser', password: 'TestPass123' });

      harness.cleanup();
      harness = createProtocolTestHarness({
        socketConfigs: [
          { rdoScenarios: [customAuth.rdo] },
          { rdoScenarios: [customWorldList.rdo] },
        ],
      });

      await harness.session.connectDirectory('TestUser', 'TestPass123', 'Root/Areas/Asia/Worlds');

      const phase1Commands = harness.getCapturedCommands(0);
      const logonCmd = phase1Commands.find(cmd => cmd.includes('RDOLogonUser'));
      expect(logonCmd).toContain('%TestUser');
      expect(logonCmd).toContain('%TestPass123');
    });
  });
});
