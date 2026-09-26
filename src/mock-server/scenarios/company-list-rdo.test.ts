/**
 * L1 protocol scenario: the `company-list` RDO half driven through the REAL gateway.
 *
 * `scenarios.test.ts` checks the fixture's shape; this drives `loginWorld` against it
 * over a mock socket, so the five frames asserted here are the ones the gateway
 * actually emits for step 10 — one 1-argument published `function` per field the
 * legacy company page read (`Interface Server/InterfaceServer.pas:169-173`,
 * `chooseCompany.asp:166-170`).
 *
 * It also proves criterion 3 over the wire rather than by reading the source: no
 * `logonComplete.asp` fetch is made on the login path at all.
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
import { createCompanyListScenario, CAPTURED_COMPANY } from './company-list-scenario';
import { createWorldLoginScenario } from './world-login-scenario';
import { toProxyUrl } from '@/shared/proxy-utils';
import { companySealPath } from '@/shared/company-seal';
import type { WorldInfo } from '@/shared/types';

const CONTEXT_ID = '8161308';
const VARS = { username: 'SPO_test3', password: 'test3' } as const;
const COMPANY_VARS = {
  ...VARS,
  worldName: 'Shamba',
  worldIp: '142.44.158.91',
  worldPort: 8000,
} as const;

/** The five members, in the order chooseCompany.asp:166-170 read them. */
const GETTERS = [
  'GetCompanyOwnerRole',
  'GetCompanyName',
  'GetCompanyId',
  'GetCompanyCluster',
  'GetCompanyFacilityCount',
] as const;

describe('L1: company-list RDO half driven through loginWorld()', () => {
  let harness: ProtocolTestHarness;

  beforeEach(() => {
    jest.clearAllMocks();
    harness = createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [createAuthScenario(VARS).rdo] },
        { rdoScenarios: [createWorldListScenario(VARS).rdo] },
        {
          rdoScenarios: [
            createWorldLoginScenario(VARS).rdo,
            createCompanyListScenario(COMPANY_VARS).rdo,
          ],
          fallbackResponses: buildWorldPropertyFallbacks({
            worldName: 'Shamba',
            worldIp: COMPANY_VARS.worldIp,
            worldPort: '8000',
            mailAddr: COMPANY_VARS.worldIp,
            mailPort: '1234',
          }),
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [createCompanyListScenario(COMPANY_VARS).http],
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  async function runLogin(): Promise<{
    world: WorldInfo;
    result: Awaited<ReturnType<ProtocolTestHarness['session']['loginWorld']>>;
  }> {
    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    const result = await harness.session.loginWorld('SPO_test3', 'test3', shamba!);
    return { world: shamba!, result };
  }

  it('emits the five getters once each, carrying an integer index', async () => {
    await runLogin();

    const worldCmds = harness.getCapturedCommands(2);
    for (const member of GETTERS) {
      const matching = worldCmds.filter(c =>
        new RegExp(`^C \\d+ sel ${CONTEXT_ID} call ${member} "\\^" "#0"$`).test(c));
      expect(matching).toHaveLength(1);
    }
  });

  it('each fixture request is byte-for-byte the frame the gateway wrote, QueryId stripped', async () => {
    await runLogin();

    // The harness captures the real wire command, `C <rid> sel ...` without the
    // frame delimiter; the fixture literal is that frame with the rid dropped.
    const frames = harness.getCapturedCommands(2)
      .filter(c => GETTERS.some(m => c.includes(` call ${m} `)))
      .map(c => `${c.replace(/^C \d+ /, 'C ')};`);
    const mock = new RdoMock();
    mock.addScenario(createCompanyListScenario(COMPANY_VARS).rdo);

    expect(frames.map(f => mock.match(f)!.exchange.id)).toEqual([
      'cl-rdo-001', 'cl-rdo-002', 'cl-rdo-003', 'cl-rdo-004', 'cl-rdo-005',
    ]);
    expect(frames).toEqual(frames.map(f => mock.match(f)!.exchange.request));
  });

  it('emits them in the order chooseCompany.asp:166-170 read them', async () => {
    await runLogin();

    const worldCmds = harness.getCapturedCommands(2);
    const order = worldCmds
      .map(c => GETTERS.find(m => c.includes(` call ${m} `)))
      .filter((m): m is typeof GETTERS[number] => m !== undefined);
    expect(order).toEqual([...GETTERS]);
  });

  it('parses the five answers into one CompanyInfo', async () => {
    const { world, result } = await runLogin();

    expect(result.companies).toEqual([
      {
        id: CAPTURED_COMPANY.id,
        name: CAPTURED_COMPANY.name,
        ownerRole: CAPTURED_COMPANY.ownerRole,
        status: CAPTURED_COMPANY.status,
        cluster: CAPTURED_COMPANY.cluster,
        facilityCount: CAPTURED_COMPANY.facilityCount,
        sealUrl: toProxyUrl(companySealPath(CAPTURED_COMPANY.cluster), world.ip),
      },
    ]);
  });

  it('fetches no logonComplete.asp at all', async () => {
    await runLogin();

    const fetchMock = jest.requireMock('node-fetch') as { default: { mock: { calls: unknown[][] } } };
    const asked = fetchMock.default.mock.calls.map(c => String(c[0]));
    expect(asked.filter(u => u.includes('logonComplete.asp'))).toEqual([]);
  });

  it('raises no strict-validation violation', async () => {
    await runLogin();

    harness.assertNoViolations();
  });
});
