/**
 * L1 protocol scenario: the one-click re-entry chain (`resumeSession`) drives the exact same
 * four ws-handlers, in the exact same order, that the four login screens drive by hand — this
 * proves it emits the same frames over the real gateway code, not just that the client-side
 * mock believes it does (`auth-handler.test.ts` covers that half).
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
import {
  handleAuthCheck,
  handleConnectDirectory,
  handleLoginWorld,
  handleSelectCompany,
} from '@/server/ws-handlers/auth-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { WsMessageType, type WsMessage } from '@/shared/types';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario } from './world-list-scenario';
import { createWorldLoginScenario } from './world-login-scenario';
import { createSelectCompanyScenario } from './select-company-scenario';
import { createCompanyListScenario } from './company-list-scenario';

const CONTEXT_ID = '8161308';
const VARS = { username: 'SPO_test3', password: 'test3' } as const;

function buildHarness(): ProtocolTestHarness {
  return createProtocolTestHarness({
    socketConfigs: [
      { rdoScenarios: [createAuthScenario(VARS).rdo] },
      { rdoScenarios: [createAuthScenario(VARS).rdo] },
      { rdoScenarios: [createWorldListScenario(VARS).rdo] },
      {
        rdoScenarios: [createWorldLoginScenario(VARS).rdo, createSelectCompanyScenario(VARS).rdo],
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
      }).http,
    ],
  });
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('L1: resumeSession chain emits the same frames as the four-stage login', () => {
  const builtHarnesses: ProtocolTestHarness[] = [];

  afterEach(() => {
    for (const harness of builtHarnesses) {
      // destroy(), not endSession(): selectCompany starts the ServerBusy poll and the GC
      // sweep (spo_session.ts:1865, :2027), and only destroy() stops them
      // (spo_session.ts:2840, :2862) — endSession() alone leaves them running past the test,
      // and an unmocked ServerBusy reply means each poll tick blocks for the full
      // IS_PROXY_TIMEOUT_MS before failing.
      harness.session.destroy();
      harness.cleanup();
    }
    builtHarnesses.length = 0;
    jest.clearAllMocks();
  });

  it('drives handleAuthCheck/handleConnectDirectory/handleLoginWorld/handleSelectCompany to the same wire as the four-stage path', async () => {
    // Four-stage run (A): the same calls the four login screens make, one per stage.
    const harnessA = buildHarness();
    builtHarnesses.push(harnessA);

    await harnessA.session.checkAuth(VARS.username, VARS.password);
    await tick();
    const worlds = await harnessA.session.connectDirectory(VARS.username, VARS.password, 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find((w) => w.name === 'shamba');
    expect(shamba).toBeDefined();
    await tick();
    await harnessA.session.loginWorld(VARS.username, VARS.password, shamba!);
    await tick();
    await harnessA.session.selectCompany('28');

    const aBySocket = [0, 1, 2, 3].map((i) => harnessA.getCapturedCommands(i));
    const aAll = harnessA.getAllCapturedCommands();
    harnessA.assertNoViolations();
    harnessA.session.destroy();

    // Chained run (B): the same four requests, driven straight through the ws-handlers with
    // no ticks in between — this is what `resumeSession` produces on the wire.
    const harnessB = buildHarness();
    builtHarnesses.push(harnessB);

    const sent: WsMessage[] = [];
    const ws = {
      send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
    } as unknown as WebSocket;
    const ctx = { ws, session: harnessB.session } as unknown as WsHandlerContext;

    await handleAuthCheck(ctx, {
      type: WsMessageType.REQ_AUTH_CHECK,
      wsRequestId: 'r1',
      username: VARS.username,
      password: VARS.password,
    } as WsMessage);
    await handleConnectDirectory(ctx, {
      type: WsMessageType.REQ_CONNECT_DIRECTORY,
      wsRequestId: 'r2',
      username: VARS.username,
      password: VARS.password,
      zonePath: 'Root/Areas/Asia/Worlds',
    } as WsMessage);
    await handleLoginWorld(ctx, {
      type: WsMessageType.REQ_LOGIN_WORLD,
      wsRequestId: 'r3',
      username: VARS.username,
      password: VARS.password,
      worldName: 'shamba',
    } as WsMessage);
    await handleSelectCompany(ctx, {
      type: WsMessageType.REQ_SELECT_COMPANY,
      wsRequestId: 'r4',
      companyId: '28',
    } as WsMessage);

    expect(sent.some((m) => m.type === WsMessageType.RESP_ERROR)).toBe(false);

    const bBySocket = [0, 1, 2, 3].map((i) => harnessB.getCapturedCommands(i));
    const bAll = harnessB.getAllCapturedCommands();
    harnessB.assertNoViolations();

    expect(bAll).toEqual(aAll);
    for (let i = 0; i < 4; i++) {
      expect(bBySocket[i]).toEqual(aBySocket[i]);
    }

    // Both lists are non-trivial — a diff against an empty capture would pass vacuously.
    expect(aAll.some((c) => c.includes('RDOLogonUser'))).toBe(true);
    expect(aAll.some((c) => c.includes('call Logon'))).toBe(true);
    expect(aAll.some((c) => c.includes('set EnableEvents'))).toBe(true);
    const regIdx = aAll.findIndex((c) => c.includes('RegisterEventsById'));
    const enableIdx = aAll.findIndex((c) => c.includes('set EnableEvents'));
    expect(regIdx).toBeGreaterThanOrEqual(0);
    expect(regIdx).toBeLessThan(enableIdx);
  });
});
