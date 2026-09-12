/**
 * L1 protocol scenario: the `world-login` exchanges driven through the REAL gateway.
 *
 * `scenarios.test.ts` checks the fixture's shape; this drives `loginWorld` against it over
 * a mock socket, so the CanJoinWorldEx frame asserted here is the one the gateway actually
 * emits — one widestring argument, against the InterfaceServer id, before AccountStatus
 * (`Interface Server/InterfaceServer.pas:441`, `logonComplete.asp:143-152`).
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
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from '@/server/__tests__/protocol-validation/protocol-test-harness';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario } from './world-list-scenario';
import { createCompanyListScenario } from './company-list-scenario';
import {
  createWorldLoginScenario,
  WORLD_LOGIN_INTERFACE_SERVER_ID,
} from './world-login-scenario';

const CONTEXT_ID = '8161308';
const CAN_JOIN_FRAME = new RegExp(
  `^C \\d+ sel ${WORLD_LOGIN_INTERFACE_SERVER_ID} call CanJoinWorldEx "\\^" "%SPO_test3"$`,
);

const VARS = { username: 'SPO_test3', password: 'test3' } as const;

describe('L1: world-login scenario driven through loginWorld()', () => {
  let harness: ProtocolTestHarness;

  function buildHarness(canJoin?: number, languageId?: string): void {
    harness = createProtocolTestHarness({
      socketConfigs: [
        // Socket 0: directory_auth
        { rdoScenarios: [createAuthScenario(VARS).rdo] },
        // Socket 1: directory_query
        { rdoScenarios: [createWorldListScenario(VARS).rdo] },
        // Socket 2: world socket
        {
          rdoScenarios: [createWorldLoginScenario(VARS, { canJoin, languageId }).rdo],
          fallbackResponses: buildWorldPropertyFallbacks({
            worldName: 'Shamba',
            worldIp: '142.44.158.91',
            worldPort: '8000',
            mailAddr: '142.44.158.91',
            mailPort: '1234',
          }),
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [
        createCompanyListScenario({
          ...VARS,
          worldName: 'Shamba',
          worldIp: '142.44.158.91',
          worldPort: 8000,
        }, languageId === undefined ? undefined : { languageId }).http,
      ],
    });
  }

  async function runLogin(): Promise<Awaited<ReturnType<ProtocolTestHarness['session']['loginWorld']>>> {
    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    return harness.session.loginWorld('SPO_test3', 'test3', shamba!);
  }

  /** The one CanJoinWorldEx frame, asserted on shape and on position. */
  function assertCanJoinFrame(): void {
    const worldCmds = harness.getCapturedCommands(2);
    const canJoinIdx = worldCmds.findIndex(c => CAN_JOIN_FRAME.test(c));
    expect(canJoinIdx).toBeGreaterThanOrEqual(0);
    expect(worldCmds.filter(c => c.includes('CanJoinWorldEx'))).toHaveLength(1);
    const acctIdx = worldCmds.findIndex(c => c.includes('call AccountStatus'));
    expect(canJoinIdx).toBeLessThan(acctIdx);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('reports a world at its user cap when CanJoinWorldEx answers -1', async () => {
    buildHarness(-1);

    const result = await runLogin();

    expect(result.admission).toEqual({ kind: 'full' });
    assertCanJoinFrame();
    harness.assertNoViolations();
  });

  it('reports the nobility shortfall when CanJoinWorldEx answers a positive number', async () => {
    buildHarness(5);

    const result = await runLogin();

    expect(result.admission).toEqual({ kind: 'nobility', shortfall: 5 });
    assertCanJoinFrame();
    harness.assertNoViolations();
  });

  it('changes nothing about the login when CanJoinWorldEx answers 0', async () => {
    buildHarness();

    const result = await runLogin();

    expect(result.admission).toBeUndefined();
    expect(result.companies.length).toBeGreaterThan(0);
    assertCanJoinFrame();
    harness.assertNoViolations();
  });

  // The language criterion, end to end over the wire: a session opened with a non-default
  // language must put it on BOTH carriers — the SetLanguage frame and the ASP query. The
  // `logonComplete.asp` exchange is gated on `LangId=2`, so a gateway that drops the id
  // gets a 404 and no companies come back.
  it('a session opened with language 2 emits SetLanguage %2 and asks logonComplete.asp with LangId=2', async () => {
    buildHarness(undefined, '2');
    harness.session.setLanguageId('2');

    const result = await runLogin();

    const setLang = harness.getSockets()[2].getCapturedWrites().find(w => w.includes('SetLanguage'));
    expect(setLang).toContain(`sel ${CONTEXT_ID} call SetLanguage "*" "%2"`);

    const fetchMock = jest.requireMock('node-fetch') as { default: { mock: { calls: unknown[][] } } };
    const asked = fetchMock.default.mock.calls.map(c => String(c[0]));
    const logonComplete = asked.find(u => u.includes('logonComplete.asp'));
    expect(logonComplete).toContain('LangId=2');

    // The gated exchange matched — the company page came back, not the 404.
    expect(result.companies.length).toBeGreaterThan(0);
    harness.assertNoViolations();
  });
});
