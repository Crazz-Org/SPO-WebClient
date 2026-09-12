/**
 * L1 protocol scenario: a `RefreshSeason` push, driven through the REAL gateway and then
 * into the REAL client dispatcher — proving the wire push changes the rendered terrain suit
 * (issue 588), and that the client ends up holding the same season the gateway stored.
 */

// Must mock before any imports that use them
jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../client/bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn() },
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from '@/server/__tests__/protocol-validation/protocol-test-harness';
import type { PushTrigger } from '@/server/__tests__/protocol-validation/mock-tcp-socket';
import { WsMessageType, type WsMessage, type WsEventRefreshSeason } from '@/shared/types';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario } from './world-list-scenario';
import { createCompanyListScenario } from './company-list-scenario';
import { createWorldLoginScenario } from './world-login-scenario';
import { createRefreshSeasonScenario, buildRefreshSeasonPush } from './refresh-season-scenario';
import { dispatchEvent } from '../../client/handlers/event-handler';
import type { ClientHandlerContext } from '../../client/handlers/client-context';
import { TextureCache } from '../../client/renderer/texture-cache';
import { Season } from '../../shared/map-config';

const CONTEXT_ID = '8161308';
const VARS = { username: 'SPO_test3', password: 'test3' } as const;

describe('L1: refresh-season scenario driven through loginWorld() into dispatchEvent()', () => {
  let harness: ProtocolTestHarness;

  function buildHarness(): void {
    const pushTriggers: PushTrigger[] = [
      ...buildLoginPushTriggers(CONTEXT_ID),
      { triggerOnMember: 'RegisterEventsById', pushData: [buildRefreshSeasonPush(CONTEXT_ID, 0)], delayMs: 25 },
    ];

    harness = createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [createAuthScenario(VARS).rdo] },
        { rdoScenarios: [createWorldListScenario(VARS).rdo] },
        {
          rdoScenarios: [
            createWorldLoginScenario(VARS).rdo,
            createRefreshSeasonScenario(VARS, { season: 0, contextId: CONTEXT_ID }).rdo,
          ],
          fallbackResponses: buildWorldPropertyFallbacks({
            worldName: 'Shamba',
            worldIp: '142.44.158.91',
            worldPort: '8000',
            mailAddr: '142.44.158.91',
            mailPort: '1234',
          }),
          pushTriggers,
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('changes the terrain suit without a reload, and leaves the client holding the gateway\'s season', async () => {
    buildHarness();

    const events: WsMessage[] = [];
    harness.session.on('ws_event', (e: WsMessage) => events.push(e));

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    await harness.session.loginWorld('SPO_test3', 'test3', shamba!);

    expect(harness.session.getWorldSeason()).toBe(1); // WorldSeason="%Spring" fallback

    await new Promise(r => setTimeout(r, 60));

    const seasonEvents = events.filter(
      (e): e is WsEventRefreshSeason => e.type === WsMessageType.EVENT_REFRESH_SEASON
    );
    expect(seasonEvents).toHaveLength(1);
    expect(seasonEvents[0].season).toBe(0);
    expect(harness.session.getWorldSeason()).toBe(0);

    const cache = new TextureCache();
    const renderer = { setSeason: (s: Season) => cache.setSeason(s) };
    const ctx = {
      worldSeason: 1,
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    dispatchEvent(ctx, seasonEvents[0]);

    expect(cache.getSeason()).toBe(Season.WINTER);
    expect(ctx.worldSeason).toBe(harness.session.getWorldSeason());

    harness.assertNoViolations();
  });
});
