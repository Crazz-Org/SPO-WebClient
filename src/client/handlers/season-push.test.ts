/**
 * EVENT_REFRESH_SEASON was decoded by the gateway and then dropped by the browser:
 * `dispatchEvent` had no case for it, so the terrain suit only ever changed at the
 * next login. This proves the new case applies the pushed season to the renderer
 * and mirrors it into `ctx.worldSeason`, including when the map view does not exist yet.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { WsMessageType, type WsEventRefreshSeason } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import type { ClientHandlerContext } from './client-context';

function makeCtx(renderer: { setSeason: jest.Mock } | null) {
  const ctx = {
    worldSeason: null,
    getRenderer: () => renderer,
    soundManager: { play: jest.fn() },
  } as unknown as ClientHandlerContext;
  return ctx;
}

describe('dispatchEvent given EVENT_REFRESH_SEASON', () => {
  it('applies season 0 (winter) to the renderer and stores it on the context', () => {
    const renderer = { setSeason: jest.fn() };
    const ctx = makeCtx(renderer);
    const msg: WsEventRefreshSeason = { type: WsMessageType.EVENT_REFRESH_SEASON, season: 0 };

    dispatchEvent(ctx, msg);

    expect(renderer.setSeason).toHaveBeenCalledWith(0);
    expect(ctx.worldSeason).toBe(0);
  });

  it('applies season 3 (autumn) to the renderer and stores it on the context', () => {
    const renderer = { setSeason: jest.fn() };
    const ctx = makeCtx(renderer);
    const msg: WsEventRefreshSeason = { type: WsMessageType.EVENT_REFRESH_SEASON, season: 3 };

    dispatchEvent(ctx, msg);

    expect(renderer.setSeason).toHaveBeenCalledWith(3);
    expect(ctx.worldSeason).toBe(3);
  });

  it('still records the season when the map view does not exist yet', () => {
    const ctx = makeCtx(null);
    const msg: WsEventRefreshSeason = { type: WsMessageType.EVENT_REFRESH_SEASON, season: 2 };

    expect(() => dispatchEvent(ctx, msg)).not.toThrow();
    expect(ctx.worldSeason).toBe(2);
  });
});
