/**
 * EVENT_MOVE_TO — the server-driven camera pan (Delphi MoveTo push).
 *
 * The Interface Server can push MoveTo(x, y) at any time; the client must re-centre the
 * isometric map on it and record it in the camera history, the same as a player-driven pan.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { WsMessageType, type WsMessage } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { useMapStore } from '../store/map-store';
import type { ClientHandlerContext } from './client-context';

function makeCtx(renderer: { centerOn: jest.Mock } | null) {
  return {
    getRenderer: () => renderer,
    soundManager: { play: jest.fn() },
  } as unknown as ClientHandlerContext;
}

describe('EVENT_MOVE_TO', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMapStore.getState().reset();
  });

  it('re-centres the map and records the position', () => {
    const renderer = { centerOn: jest.fn() };
    const ctx = makeCtx(renderer);

    dispatchEvent(ctx, { type: WsMessageType.EVENT_MOVE_TO, x: 706, y: 436 } as WsMessage);

    expect(renderer.centerOn).toHaveBeenCalledTimes(1);
    expect(renderer.centerOn).toHaveBeenCalledWith(706, 436);
    expect(useMapStore.getState().history).toEqual([{ x: 706, y: 436 }]);
    expect(useMapStore.getState().historyIndex).toBe(0);
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('706'));
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('436'));
  });

  it('still records the position when there is no renderer yet', () => {
    const ctx = makeCtx(null);

    expect(() =>
      dispatchEvent(ctx, { type: WsMessageType.EVENT_MOVE_TO, x: 706, y: 436 } as WsMessage)
    ).not.toThrow();

    expect(useMapStore.getState().history).toEqual([{ x: 706, y: 436 }]);
  });

  it('leaves an unknown event untouched', () => {
    const renderer = { centerOn: jest.fn() };
    const ctx = makeCtx(renderer);

    dispatchEvent(ctx, { type: 'EVENT_NOBODY_HANDLES' } as unknown as WsMessage);

    expect(renderer.centerOn).not.toHaveBeenCalled();
    expect(useMapStore.getState().history).toEqual([]);
    expect(ClientBridge.log).not.toHaveBeenCalled();
  });
});
