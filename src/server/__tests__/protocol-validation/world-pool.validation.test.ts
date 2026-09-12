/**
 * Protocol Validation: World Connection Pool
 *
 * The pool was dead code until O-M1 (`initialize()` was called nowhere), so no
 * test had ever exercised a populated pool. Enabling it needs a socket factory
 * the harness can supply — the pool builds its own sockets, and without the
 * factory they silently consume the scenarios meant for named sockets.
 *
 * What matters on the wire is WHEN the pool may hold connections. The
 * server-side session binds to a single client TCP connection:
 *
 *   - `get RDOCnntId` is intercepted by the query parser before any object
 *     lookup and answered with the id of the connection carrying the frame
 *     (Rdo/Server/RDOQueryServer.pas:269-274, `tidConnRequestName` at :9). The
 *     id is the address of the socket object itself
 *     (WinSockRDOConnectionsServer.pas:664-668).
 *   - That id is handed to `RegisterEventsById`, which binds the `TClientView`
 *     to that connection as BOTH push channel and teardown trigger:
 *       fClientConnection := ...GetClientConnectionById(ClientId);
 *       fClientConnection.OnDisconnect := OnDisconnect;
 *       fClientEventsProxy.SetConnection(fClientConnection);
 *     (Interface Server/InterfaceServer.pas:1919-1923)
 *
 * A pool populated before login can carry those frames, binding the session to a
 * connection the pool owns and may destroy on degradation — the O-H1/O-H2
 * zombie session from a new direction. Two independent mechanisms prevent it and
 * both are pinned here: ordering (populate after the session is bound) and the
 * `CONNECTION_BOUND_MEMBERS` routing guard.
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
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
  HarnessConfig,
} from './protocol-test-harness';
import { createAuthScenario } from '../../../mock-server/scenarios/auth-scenario';
import { createWorldListScenario } from '../../../mock-server/scenarios/world-list-scenario';
import { createCompanyListScenario } from '../../../mock-server/scenarios/company-list-scenario';
import { RdoVerb, RdoAction } from '../../../shared/types';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import { TimeoutCategory } from '../../../shared/timeout-categories';

const INTERFACE_SERVER_ID = '6892548';
const CONTEXT_ID = '8161308';
const RDO_CNNT_ID = '12345678';

function createWorldLoginRdoScenario(): RdoScenario {
  return {
    name: 'world-login',
    description: 'World login RDO exchanges: idof, AccountStatus, Logon, RegisterEventsById',
    exchanges: [
      {
        id: 'wp-rdo-idof',
        request: `C 0 idof "InterfaceServer"`,
        response: `A0 objid="${INTERFACE_SERVER_ID}"`,
        matchKeys: { verb: 'idof', targetId: 'InterfaceServer' },
      },
      {
        id: 'wp-rdo-acct',
        request: `C 1 sel ${INTERFACE_SERVER_ID} call AccountStatus "^" "%SPO_test3","%test3"`,
        response: `A1 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AccountStatus' },
      },
      {
        id: 'wp-rdo-logon',
        request: `C 2 sel ${INTERFACE_SERVER_ID} call Logon "^" "%SPO_test3","%test3"`,
        response: `A2 res="#${CONTEXT_ID}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Logon' },
      },
      {
        id: 'wp-rdo-regevt',
        request: `C 3 sel ${CONTEXT_ID} call RegisterEventsById "^" "#${RDO_CNNT_ID}"`,
        response: `A3 res="#1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RegisterEventsById' },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: world connection pool', () => {
  let harness: ProtocolTestHarness;

  const authBundle = createAuthScenario({ username: 'SPO_test3', password: 'test3' });
  const worldListBundle = createWorldListScenario({ username: 'SPO_test3', password: 'test3' });
  const companyBundle = createCompanyListScenario({
    username: 'SPO_test3',
    password: 'test3',
    worldName: 'Shamba',
    worldIp: '142.44.158.91',
    worldPort: 8000,
  });

  const worldFallbacks = buildWorldPropertyFallbacks({
    worldName: 'Shamba',
    worldIp: '142.44.158.91',
    worldPort: '8000',
    mailAddr: '142.44.158.91',
    mailPort: '1234',
  });

  function buildHarness(worldPool: HarnessConfig['worldPool']): ProtocolTestHarness {
    return createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [authBundle.rdo] },
        { rdoScenarios: [worldListBundle.rdo] },
        {
          // The company bundle answers the five indexed reads of step 10 —
          // without it the login hangs waiting for the first one.
          rdoScenarios: [createWorldLoginRdoScenario(), companyBundle.rdo],
          fallbackResponses: worldFallbacks,
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [companyBundle.http],
      worldPool,
    });
  }

  /**
   * Pool connections answer ordinary reads; they must never see login frames.
   * The five indexed company reads of step 10 ARE ordinary reads — they happen
   * after the pool is populated, so a pool connection is what answers them.
   */
  const poolSocketConfig = {
    rdoScenarios: [companyBundle.rdo],
    fallbackResponses: worldFallbacks,
    disableStrictValidation: true,
  };

  async function runFullLoginFlow(): Promise<void> {
    const worlds = await harness.session.connectDirectory(
      'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
    );
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    await harness.session.loginWorld('SPO_test3', 'test3', shamba!);
  }

  /** Let the pool's fire-and-forget initialize() settle. */
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));

  afterEach(() => {
    harness?.cleanup();
  });

  describe('population ordering — the session must bind to the primary socket', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      harness = buildHarness({ enabled: true, socketConfigs: [poolSocketConfig] });
    });

    it('should not open a single pool connection before the session is bound', async () => {
      // initWorldPool() runs immediately after the world socket connects, long
      // before Logon. Constructing the pool there is fine; populating is not.
      const worlds = await harness.session.connectDirectory(
        'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
      );
      const shamba = worlds.find(w => w.name === 'shamba');

      const loginPromise = harness.session.loginWorld('SPO_test3', 'test3', shamba!);
      // Sampled while the login sequence is in flight.
      expect(harness.getPoolSockets()).toHaveLength(0);
      await loginPromise;
    });

    it('should keep every session-binding frame on the primary world socket', async () => {
      await runFullLoginFlow();
      await flush();

      const poolCmds = harness.getPoolCapturedCommands();
      // The three frames that bind the server-side session to a connection.
      expect(poolCmds.join('\n')).not.toMatch(/RDOCnntId/);
      expect(poolCmds.join('\n')).not.toMatch(/RegisterEventsById/);
      expect(poolCmds.join('\n')).not.toMatch(/\bcall Logon\b/);
    });

    it('should read RDOCnntId exactly once, on the primary socket', async () => {
      await runFullLoginFlow();
      await flush();

      const worldCmds = harness.getCapturedCommands(2);
      const cnntReads = worldCmds.filter(c => c.includes('RDOCnntId'));
      expect(cnntReads).toHaveLength(1);
      expect(cnntReads[0]).toMatch(/get RDOCnntId/);
    });

    it('should populate the pool once login completes', async () => {
      await runFullLoginFlow();
      await flush();

      expect(harness.session.getWorldPool()).not.toBeNull();
      expect(harness.session.getWorldPool()!.size).toBeGreaterThan(0);
    });
  });

  describe('routing guard — CONNECTION_BOUND_MEMBERS bypass the pool', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      harness = buildHarness({
        enabled: true,
        socketConfigs: [poolSocketConfig, poolSocketConfig, poolSocketConfig],
      });
    });

    it('should send an ordinary post-login read over a pool connection', async () => {
      await runFullLoginFlow();
      await flush();

      const before = harness.getPoolCapturedCommands().length;
      await harness.session.sendRdoRequest('world', {
        verb: RdoVerb.SEL, targetId: CONTEXT_ID,
        action: RdoAction.GET, member: 'TycoonId',
      }, undefined, TimeoutCategory.NORMAL);

      expect(harness.getPoolCapturedCommands().length).toBe(before + 1);
      expect(harness.getPoolCapturedCommands().join('\n')).toMatch(/get TycoonId/);
    });

    it('should keep a post-login RDOCnntId read on the primary socket even with a live pool', async () => {
      await runFullLoginFlow();
      await flush();
      expect(harness.session.getWorldPool()!.size).toBeGreaterThan(0);

      const poolBefore = harness.getPoolCapturedCommands().length;
      const primaryBefore = harness.getCapturedCommands(2).length;

      await harness.session.sendRdoRequest('world', {
        verb: RdoVerb.SEL, targetId: CONTEXT_ID,
        action: RdoAction.GET, member: 'RDOCnntId',
      }, undefined, TimeoutCategory.FAST);

      // The value identifies the carrying connection (RDOQueryServer.pas:269-274),
      // so answering it from a pool socket would bind the session to a socket the
      // pool may destroy on degradation.
      expect(harness.getPoolCapturedCommands().length).toBe(poolBefore);
      expect(harness.getCapturedCommands(2).length).toBe(primaryBefore + 1);
      const primaryCmds = harness.getCapturedCommands(2);
      expect(primaryCmds[primaryCmds.length - 1]).toMatch(/get RDOCnntId/);
    });
  });

  describe('fallbacks', () => {
    it('should fall back to the primary socket when the pool cannot be populated', async () => {
      jest.clearAllMocks();
      harness = buildHarness({ enabled: true, failConnectionAt: 0 });

      await runFullLoginFlow();
      await flush();

      expect(harness.session.getWorldPool()!.size).toBe(0);

      const primaryBefore = harness.getCapturedCommands(2).length;
      await harness.session.sendRdoRequest('world', {
        verb: RdoVerb.SEL, targetId: CONTEXT_ID,
        action: RdoAction.GET, member: 'TycoonId',
      }, undefined, TimeoutCategory.NORMAL);
      expect(harness.getCapturedCommands(2).length).toBe(primaryBefore + 1);
    });

    it('should leave the pool empty when the session has it disabled', async () => {
      jest.clearAllMocks();
      harness = buildHarness({ enabled: false });

      await runFullLoginFlow();
      await flush();

      expect(harness.getPoolSockets()).toHaveLength(0);
      expect(harness.session.getWorldPool()!.size).toBe(0);
    });
  });
});
