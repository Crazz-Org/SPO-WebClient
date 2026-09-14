/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The L1 protocol scenario for the season push, driven end to end through the
 * real halves: real push dispatcher -> real browser event handler.
 *
 * A season change has no request of its own — it is a pure unsolicited push —
 * so there is no gateway emitter leg to prove, only that the pushed integer
 * survives the dispatcher into `dispatchEvent` and reaches `renderer.setSeason`,
 * the assignment `MapIsoHandler.pas:546-547` made.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { RdoProtocol } from '@/server/rdo';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchEvent } from '@/client/handlers/event-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import type { IsometricMapRenderer } from '@/client/renderer/isometric-map-renderer';
import { WsMessageType } from '@/shared/types';
import type { WsMessage, RdoPacket } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import { mergeVariables } from './scenario-variables';
import { createRefreshSeasonScenario, refreshSeasonPush } from './refresh-season-scenario';

const CLIENT_VIEW_ID = mergeVariables().clientViewId;

/**
 * Parse a raw push frame the way the real socket reader hands it to the
 * dispatcher: quotes stripped, type prefix kept.
 */
function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

function makeClientDriver(withRenderer = true) {
  const setSeason = jest.fn();
  const ctx = {
    worldSeason: null,
    getRenderer: () => (withRenderer ? ({ setSeason }) as unknown as IsometricMapRenderer : null),
  } as unknown as ClientHandlerContext;
  return { ctx, setSeason };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refresh-season scenario', () => {
  it('passes strict RDO validation', () => {
    const { rdo } = createRefreshSeasonScenario();
    expect(rdo).toPassStrictRdoValidation();
  });

  it('matches its own frame in the mock', () => {
    const { rdo } = createRefreshSeasonScenario();
    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(rdo.exchanges).toHaveLength(1);
    expect(rdo.exchanges[0].pushOnly).toBe(true);
  });

  it('changes the rendered terrain suit: gateway push -> dispatchEvent -> setSeason', () => {
    const { rdo } = createRefreshSeasonScenario(undefined, { season: 0 });
    const pushFrame = rdo.exchanges[0].response;

    // Gateway half: the raw push becomes an EVENT_REFRESH_SEASON.
    const push = makePushCtx();
    dispatchPush(push.ctx, 'world', parsePush(pushFrame));

    expect(push.ctx.setWorldSeason).toHaveBeenCalledWith(0);
    const emitted = (push.ctx.emit as jest.Mock).mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage);
    const seasonEvent = emitted.find(e => e.type === WsMessageType.EVENT_REFRESH_SEASON);
    expect(seasonEvent).toBeDefined();

    // Browser half: the event switches the terrain suit.
    const { ctx, setSeason } = makeClientDriver();
    dispatchEvent(ctx, seasonEvent!);

    expect(setSeason).toHaveBeenCalledWith(0);
    expect(ctx.worldSeason).toBe(0);
  });

  it('never applies a season the renderer cannot key', () => {
    const push = makePushCtx();
    dispatchPush(push.ctx, 'world', parsePush(refreshSeasonPush(CLIENT_VIEW_ID, 9)));

    const emitted = (push.ctx.emit as jest.Mock).mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage);
    const seasonEvent = emitted.find(e => e.type === WsMessageType.EVENT_REFRESH_SEASON);
    expect(seasonEvent).toBeDefined();

    const { ctx, setSeason } = makeClientDriver();
    dispatchEvent(ctx, seasonEvent!);

    expect(setSeason).not.toHaveBeenCalled();
  });
});
