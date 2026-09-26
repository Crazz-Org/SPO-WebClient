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
import { RdoMock } from '../rdo-mock';
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

  const COMPANY_VARS = {
    ...VARS,
    worldName: 'Shamba',
    worldIp: '142.44.158.91',
    worldPort: 8000,
  } as const;

  function buildHarness(canJoin?: number, languageId?: string): void {
    harness = createProtocolTestHarness({
      socketConfigs: [
        // Socket 0: directory_auth
        { rdoScenarios: [createAuthScenario(VARS).rdo] },
        // Socket 1: directory_query
        { rdoScenarios: [createWorldListScenario(VARS).rdo] },
        // Socket 2: world socket
        {
          rdoScenarios: [
            createWorldLoginScenario(VARS, { canJoin, languageId }).rdo,
            // Step 10 — the five per-index company getters.
            createCompanyListScenario(COMPANY_VARS).rdo,
          ],
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
      httpScenarios: [createCompanyListScenario(COMPANY_VARS).http],
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

  // The language criterion over the wire: the session language travels on the
  // SetLanguage frame, and the scenario's exchange pins the context target and
  // its exact one-position `argsPattern` `"%2"` with no `looseMatch` reason, so
  // RdoMock answers a frame that dropped or changed it with nothing at all (the
  // next test proves it). The `LangId` half of this criterion moved to
  // `login-handler.test.ts` with the ASP fetch it belongs to.
  it('the %2 SetLanguage exchange answers no other language and no bare frame', () => {
    const mock = new RdoMock();
    mock.addScenario(createWorldLoginScenario(VARS, { languageId: '2' }).rdo);
    expect(mock.match(`C sel ${CONTEXT_ID} call SetLanguage "*" "%2"`)?.exchange.id).toBe('wlogin-rdo-setlang');
    expect(mock.match(`C sel ${CONTEXT_ID} call SetLanguage "*" "%0"`)).toBeNull();
    expect(mock.match(`C sel ${CONTEXT_ID} call SetLanguage "*"`)).toBeNull();
  });

  it('a session opened with language 2 emits SetLanguage %2', async () => {
    buildHarness(undefined, '2');
    harness.session.setLanguageId('2');

    const result = await runLogin();

    const setLang = harness.getSockets()[2].getCapturedWrites().find(w => w.includes('SetLanguage'));
    expect(setLang).toContain(`sel ${CONTEXT_ID} call SetLanguage "*" "%2"`);

    // The fixture request is byte-for-byte the command the gateway wrote
    // (captured without its frame delimiter; a procedure carries no QueryId).
    const command = harness.getCapturedCommands(2).find(c => c.includes(' call SetLanguage '))!;
    const frame = `${command.replace(/^C \d+ /, 'C ')};`;
    const mock = new RdoMock();
    mock.addScenario(createWorldLoginScenario(VARS, { languageId: '2' }).rdo);
    const hit = mock.match(frame)!;
    expect(hit.exchange.id).toBe('wlogin-rdo-setlang');
    expect(frame).toBe(hit.exchange.request);

    expect(result.companies.length).toBeGreaterThan(0);
    harness.assertNoViolations();
  });
});
