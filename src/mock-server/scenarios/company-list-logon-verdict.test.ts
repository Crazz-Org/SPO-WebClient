/**
 * L1 protocol scenario: the logon page's portal-travel verdict, driven through the REAL gateway.
 *
 * After the RDO company read, `loginWorld` asks `logonComplete.asp` for the one thing only the
 * page knows — whether portal travel to this world has expired (`logonComplete.asp:26-67`). Only a
 * `logonNoAccess.asp` redirect carrying a real `PA` date is a verdict. The page writes
 * `01/01/2008` (or nothing) when `PaidPlanets` is unset or its own directory connection failed
 * (`:56-58`), and that value turned up on accounts that work (#752) — so those, an unreachable page,
 * and a thrown fetch all fail open with one warning.
 *
 * Each case drives `handleLoginWorld` against `company-list-scenario`'s HTTP half and reads the
 * `RESP_LOGIN_SUCCESS` the browser would receive.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, afterEach } from '@jest/globals';
import type { WebSocket } from 'ws';
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from '@/server/__tests__/protocol-validation/protocol-test-harness';
import { handleLoginWorld } from '@/server/ws-handlers/auth-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { WsMessageType, type WsMessage, type WsRespLoginSuccess } from '@/shared/types';
import { Logger } from '@/shared/logger';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario } from './world-list-scenario';
import { createWorldLoginScenario } from './world-login-scenario';
import { createCompanyListScenario, type CompanyListScenarioOptions } from './company-list-scenario';

const CONTEXT_ID = '8161308';
const VARS = { username: 'SPO_test3', password: 'test3' } as const;
const COMPANY_VARS = {
  ...VARS,
  worldName: 'Shamba',
  worldIp: '142.44.158.91',
  worldPort: 8000,
} as const;

const LOGON_PAGE_PREFIX = '[Session] Logon page';

function buildHarness(options?: CompanyListScenarioOptions): ProtocolTestHarness {
  return createProtocolTestHarness({
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
    httpScenarios: [createCompanyListScenario(COMPANY_VARS, options).http],
  });
}

interface LoginRun {
  response: WsRespLoginSuccess;
  sent: WsMessage[];
  warnings: string[];
}

describe('L1: the logon page verdict (logonComplete.asp:26-67) through handleLoginWorld', () => {
  let harness: ProtocolTestHarness | null = null;
  let warnSpy: jest.SpiedFunction<Logger['warn']> | null = null;

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
    if (harness) {
      harness.session.destroy();
      harness.cleanup();
      harness = null;
    }
    jest.clearAllMocks();
  });

  /** Build the harness (optionally tampering with it), then drive the real login. */
  async function runLogin(
    options?: CompanyListScenarioOptions,
    beforeLogin?: () => void,
  ): Promise<LoginRun> {
    harness = buildHarness(options);
    beforeLogin?.();
    warnSpy = jest.spyOn(Logger.prototype, 'warn');

    await harness.session.connectDirectory(VARS.username, VARS.password, 'Root/Areas/Asia/Worlds');

    const sent: WsMessage[] = [];
    const ws = {
      send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
    } as unknown as WebSocket;
    const ctx = { ws, session: harness.session } as unknown as WsHandlerContext;

    await handleLoginWorld(ctx, {
      type: WsMessageType.REQ_LOGIN_WORLD,
      wsRequestId: 'lv-1',
      username: VARS.username,
      password: VARS.password,
      worldName: 'shamba',
    } as WsMessage);

    harness.assertNoViolations();
    expect(sent.some(m => m.type === WsMessageType.RESP_ERROR)).toBe(false);
    const response = sent.find(m => m.type === WsMessageType.RESP_LOGIN_SUCCESS) as WsRespLoginSuccess | undefined;
    expect(response).toBeDefined();
    const warnings = warnSpy.mock.calls.map(c => String(c[0]));
    return { response: response!, sent, warnings };
  }

  const logonPageWarnings = (run: LoginRun): string[] =>
    run.warnings.filter(w => w.startsWith(LOGON_PAGE_PREFIX));
  const otherWarnings = (run: LoginRun): string[] =>
    run.warnings.filter(w => !w.startsWith(LOGON_PAGE_PREFIX));

  it('denies on a logonNoAccess.asp redirect carrying a real date', async () => {
    const run = await runLogin({ logonResult: 'noAccess', expiresOn: '01/01/2020' });

    expect(run.response.loginPage).toEqual({ kind: 'denied', expiresOn: '01/01/2020' });
    expect(logonPageWarnings(run)).toEqual([]);
  });

  it('adds no loginPage and no logon page warning on the company list answer', async () => {
    const run = await runLogin({ logonResult: 'companies' });

    expect('loginPage' in run.response).toBe(false);
    expect(logonPageWarnings(run)).toEqual([]);
    expect((run.response.companies ?? []).map(c => c.id)).toEqual(['28']);
  });

  it.each([
    ['01/01/2008', 'the page\'s forced unset value'],
    ['', 'an empty PA'],
  ])('fails open on PA "%s" — %s: no loginPage, exactly one more warning than the baseline', async (expiresOn) => {
    const baseline = await runLogin({ logonResult: 'companies' });
    const baselineOther = otherWarnings(baseline);
    warnSpy?.mockRestore();
    harness?.session.destroy();
    harness?.cleanup();
    jest.clearAllMocks();

    const run = await runLogin({ logonResult: 'noAccess', expiresOn });

    expect('loginPage' in run.response).toBe(false);
    expect(logonPageWarnings(run)).toHaveLength(1);
    expect(otherWarnings(run)).toEqual(baselineOther);
    expect(run.warnings).toHaveLength(baseline.warnings.length + 1);
    expect((run.response.companies ?? []).map(c => c.id)).toEqual(['28']);
  });

  it('fails open when logonComplete.asp is unreachable: no denial, one warning, companies intact', async () => {
    const run = await runLogin({ logonResult: 'companies' }, () => {
      const fetchMock = jest.requireMock('node-fetch') as { default: jest.Mock };
      fetchMock.default.mockRejectedValue(new Error('connect ECONNREFUSED'));
    });

    expect('loginPage' in run.response).toBe(false);
    expect(logonPageWarnings(run)).toEqual([
      '[Session] Logon page: logonComplete.asp unreachable — login continues without the portal check',
    ]);
    expect((run.response.companies ?? []).map(c => c.id)).toEqual(['28']);
  });
});
