/**
 * season-events — the server-driven half of forcing a season.
 *
 * The gateway turns the Delphi `RefreshSeason` push into `EVENT_REFRESH_SEASON`
 * (push-dispatcher.ts). This handler forwards a well-formed season to the
 * renderer, the same way a forced F1–F4 season does, so a mid-session change
 * from the server replaces whatever the player forced with F1–F4.
 *
 * The dispatcher forwards what it read rather than guessing, so a malformed
 * push (NaN, or a value outside the four seasons) must not reach the renderer.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { WsMessageType } from '@/shared/types';
import type { WsMessage } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import type { ClientHandlerContext } from './client-context';
import type { IsometricMapRenderer } from '../renderer/isometric-map-renderer';

function makeCtx() {
  const setSeason = jest.fn();
  const ctx = {
    getRenderer: () => ({ setSeason }) as unknown as IsometricMapRenderer,
  } as unknown as ClientHandlerContext;
  return { ctx, setSeason };
}

describe('EVENT_REFRESH_SEASON', () => {
  it('forwards a well-formed season to the renderer', () => {
    const { ctx, setSeason } = makeCtx();

    dispatchEvent(ctx, { type: WsMessageType.EVENT_REFRESH_SEASON, season: 3 } as unknown as WsMessage);

    expect(setSeason).toHaveBeenCalledWith(3);
    expect(setSeason).toHaveBeenCalledTimes(1);
  });

  it('never forwards a malformed season', () => {
    const { ctx, setSeason } = makeCtx();

    dispatchEvent(ctx, { type: WsMessageType.EVENT_REFRESH_SEASON, season: NaN } as unknown as WsMessage);
    dispatchEvent(ctx, { type: WsMessageType.EVENT_REFRESH_SEASON, season: 7 } as unknown as WsMessage);

    expect(setSeason).not.toHaveBeenCalled();
  });
});
