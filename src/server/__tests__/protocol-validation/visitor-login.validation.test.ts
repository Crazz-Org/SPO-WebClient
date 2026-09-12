/**
 * Protocol Validation: Visitor visa login (issue 537)
 *
 * A login whose GetCompanyCount is 0 must reach the world with company id '0'
 * (the visitor visa, chooseVisa.asp:44) and emit the same EnableEvents / PickEvent
 * sequence as a real company selection — no SetCompany lookup failure, because
 * there is no member named SetCompany on the wire; the "lookup" is the local
 * VISITOR_COMPANY constant (login-handler.ts).
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/// <reference path="../../__tests__/matchers/rdo-matchers.d.ts" />
import { describe, it, expect, afterEach } from '@jest/globals';
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from './protocol-test-harness';
import { createAuthScenario } from '../../../mock-server/scenarios/auth-scenario';
import { createWorldListScenario } from '../../../mock-server/scenarios/world-list-scenario';
import { createCompanyListScenario } from '../../../mock-server/scenarios/company-list-scenario';
import { createSelectCompanyScenario } from '../../../mock-server/scenarios/select-company-scenario';
import { SessionPhase } from '../../../shared/types';
import { VISITOR_COMPANY } from '../../../shared/visitor-visa';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';

const INTERFACE_SERVER_ID = '6892548';
const CONTEXT_ID = '8161308';
const RDO_CNNT_ID = '12345678';

function worldLoginRdo(accountStatusPayload: string): RdoScenario {
  return {
    name: 'world-login',
    description: 'World login RDO exchanges: idof, AccountStatus, Logon, RegisterEventsById',
    exchanges: [
      {
        id: 'wl-rdo-idof',
        request: `C 0 idof "InterfaceServer"`,
        response: `A0 objid="${INTERFACE_SERVER_ID}"`,
        matchKeys: { verb: 'idof', targetId: 'InterfaceServer' },
      },
      {
        // #538 put CanJoinWorldEx between idof and AccountStatus (login-handler.ts:430);
        // `0` = admitted, so the visa page here is decided by the company count alone.
        id: 'wl-rdo-canjoin',
        request: `C 1 sel ${INTERFACE_SERVER_ID} call CanJoinWorldEx "^" "%SPO_test3"`,
        response: `A1 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'CanJoinWorldEx' },
      },
      {
        id: 'wl-rdo-acct',
        request: `C 1 sel ${INTERFACE_SERVER_ID} call AccountStatus "^" "%SPO_test3","%test3"`,
        response: `A1 ${accountStatusPayload}`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AccountStatus' },
      },
      {
        id: 'wl-rdo-logon',
        request: `C 2 sel ${INTERFACE_SERVER_ID} call Logon "^" "%SPO_test3","%test3"`,
        response: `A2 res="#${CONTEXT_ID}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Logon' },
      },
      {
        id: 'wl-rdo-regevt',
        request: `C 3 sel ${CONTEXT_ID} call RegisterEventsById "^" "#${RDO_CNNT_ID}"`,
        response: `A3 res="#1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RegisterEventsById' },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: visitor visa login', () => {
  let harness: ProtocolTestHarness;

  function buildHarness(accountStatusPayload: string): ProtocolTestHarness {
    const authBundle = createAuthScenario({ username: 'SPO_test3', password: 'test3' });
    const worldListBundle = createWorldListScenario({ username: 'SPO_test3', password: 'test3' });
    const companyBundle = createCompanyListScenario(
      {
        username: 'SPO_test3',
        password: 'test3',
        worldName: 'Shamba',
        worldIp: '142.44.158.91',
        worldPort: 8000,
      },
      { logonResult: 'noCompanies' },
    );
    const selectCompanyBundle = createSelectCompanyScenario({ clientViewId: CONTEXT_ID });

    return createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [authBundle.rdo] },
        { rdoScenarios: [worldListBundle.rdo] },
        {
          rdoScenarios: [worldLoginRdo(accountStatusPayload), selectCompanyBundle.rdo],
          fallbackResponses: [
            ...buildWorldPropertyFallbacks({
              worldName: 'Shamba',
              worldIp: '142.44.158.91',
              worldPort: '8000',
              mailAddr: '142.44.158.91',
              mailPort: '1234',
            }).map(f => (f.member === 'GetCompanyCount' ? { member: 'GetCompanyCount', payload: 'GetCompanyCount="#0"' } : f)),
            // RdoProtocol.parse folds a SET's value into `member` ('EnableEvents="#-1"'),
            // which the select-company scenario's matchKeys ('EnableEvents' alone) can
            // never equal — a fallback keyed on the full assignment is the only way to
            // answer it. Pre-existing gap in the mock's SET matching, not this task's to fix.
            { member: 'EnableEvents="#-1"', payload: '' },
          ],
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [companyBundle.http],
    });
  }

  afterEach(() => {
    harness.session.destroy();
    harness.assertNoViolations();
    harness.cleanup();
  });

  it('a returning visitor (AccountStatus #0) reaches a visa page and enters as company id "0" with no SetCompany lookup failure', async () => {
    harness = buildHarness('res="#0"');

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();

    const result = await harness.session.loginWorld('SPO_test3', 'test3', shamba!);
    expect(result.loginPage).toEqual({ kind: 'visa', firstVisit: false });
    expect(result.companies).toEqual([]);

    await harness.session.selectCompany('0');

    const worldCmds = harness.getCapturedCommands(2);
    expect(worldCmds.some(c => c.includes(`sel ${CONTEXT_ID} set EnableEvents="#-1"`))).toBe(true);
    const enableIdx = worldCmds.findIndex(cmd => cmd.includes('EnableEvents'));
    const pickIdx = worldCmds.findIndex(cmd => cmd.includes('PickEvent'));
    expect(enableIdx).toBeGreaterThan(-1);
    expect(pickIdx).toBeGreaterThan(enableIdx);

    expect(worldCmds.some(c => /\bSetCompany\b/.test(c))).toBe(false);
    expect(harness.session.currentCompany).toEqual(VISITOR_COMPANY);
    expect(harness.session.getPhase()).toBe(SessionPhase.WORLD_CONNECTED);
  });

  it('a first-time visitor (AccountStatus #2) gets firstVisit true', async () => {
    harness = buildHarness('res="#2"');

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    const result = await harness.session.loginWorld('SPO_test3', 'test3', shamba!);

    expect(result.loginPage).toEqual({ kind: 'visa', firstVisit: true });
  });
});
