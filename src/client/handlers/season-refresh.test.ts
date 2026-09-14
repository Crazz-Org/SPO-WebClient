/**
 * event-handler — RefreshSeason.
 *
 * The Interface Server pushes `RefreshSeason` to every client view when the
 * world's season turns (`InterfaceServer.pas:3721-3737`), and Voyager assigns
 * it straight to the terrain suit (`MapIsoHandler.pas:546-547`) — no reload,
 * no re-login. This is the client half of that: the pushed integer is the
 * ordinal of `TSeason` (`Kernel/Seasons.pas:9`), 0..3, and out of that range
 * it must be dropped rather than guessed at.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { WsMessageType } from '@/shared/types';
import type { WsMessage } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';
import type { IsometricMapRenderer } from '../renderer/isometric-map-renderer';

function makeCtx(withRenderer = true) {
  const setSeason = jest.fn();
  const ctx = {
    worldSeason: null,
    getRenderer: () => (withRenderer ? ({ setSeason }) as unknown as IsometricMapRenderer : null),
  } as unknown as ClientHandlerContext;
  return { ctx, setSeason };
}

function refreshSeason(season: number): WsMessage {
  return { type: WsMessageType.EVENT_REFRESH_SEASON, season } as unknown as WsMessage;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EVENT_REFRESH_SEASON', () => {
  it('sets the terrain suit to the pushed season', () => {
    const { ctx, setSeason } = makeCtx();

    dispatchEvent(ctx, refreshSeason(0));

    expect(setSeason).toHaveBeenCalledWith(0);
  });

  it('holds the same season the gateway stored', () => {
    const { ctx } = makeCtx();

    dispatchEvent(ctx, refreshSeason(0));

    expect(ctx.worldSeason).toBe(0);
  });

  it('ignores a season outside the TSeason ordinal range and logs it', () => {
    const { ctx, setSeason } = makeCtx();

    dispatchEvent(ctx, refreshSeason(7));

    expect(setSeason).not.toHaveBeenCalled();
    expect(ctx.worldSeason).toBeNull();
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('unreadable'));
  });

  it('ignores a NaN season', () => {
    const { ctx, setSeason } = makeCtx();

    dispatchEvent(ctx, refreshSeason(NaN));

    expect(setSeason).not.toHaveBeenCalled();
    expect(ctx.worldSeason).toBeNull();
  });

  it('does not throw when no renderer exists yet, and still holds the season', () => {
    const { ctx } = makeCtx(false);

    expect(() => dispatchEvent(ctx, refreshSeason(2))).not.toThrow();
    expect(ctx.worldSeason).toBe(2);
  });
});
