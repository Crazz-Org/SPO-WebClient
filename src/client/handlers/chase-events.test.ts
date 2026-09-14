/**
 * event-handler — the two incoming halves of a chase.
 *
 * `EVENT_MOVE_TO` is the mirroring itself: the Interface Server pushes a
 * `MoveTo` to every chaser on each `SetViewedArea` of the followed player
 * (InterfaceServer.pas:707-716, :742), and the gateway already turns that push
 * into this event. All this handler does is hand the pair to the renderer's
 * `centerOn` — the same entry `focusBuilding` uses, so the area-load path is
 * the one the map already knows.
 *
 * The dispatcher forwards what it managed to read rather than guessing, so a
 * malformed push arrives as NaN. That must not move the camera anywhere.
 *
 * The second half is the server-side abort: when the player we follow leaves,
 * the user-list push is the only notice we get, and Voyager clears its own
 * chase state off exactly that (ServerCnxHandler.pas:3029-3039).
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatUser: jest.fn(),
    removeChatUser: jest.fn(),
    setChasedUser: jest.fn(),
  },
}));

import { WsMessageType } from '@/shared/types';
import type { WsMessage, ChatUser } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { useChatStore } from '../store/chat-store';
import { useMapStore } from '../store/map-store';
import type { ClientHandlerContext } from './client-context';
import type { IsometricMapRenderer } from '../renderer/isometric-map-renderer';

const CHASED = 'Mayor of Podan';

function makeCtx() {
  const centerOn = jest.fn();
  const ctx = {
    getRenderer: () => ({ centerOn }) as unknown as IsometricMapRenderer,
  } as unknown as ClientHandlerContext;
  return { ctx, centerOn };
}

function user(name: string): ChatUser {
  return { name, id: '0', status: 0, nobilityPoints: 0, nobilityTier: 'Citizen', modifiers: 0 } as ChatUser;
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ chasedUser: null });
  useMapStore.getState().reset();
});

describe('EVENT_MOVE_TO', () => {
  it('centres the map on the coordinates the followed player moved to, exactly once, and records the position in the camera history', () => {
    const { ctx, centerOn } = makeCtx();

    dispatchEvent(ctx, { type: WsMessageType.EVENT_MOVE_TO, x: 706, y: 436 } as unknown as WsMessage);

    expect(centerOn).toHaveBeenCalledWith(706, 436);
    expect(centerOn).toHaveBeenCalledTimes(1);
    const { history, historyIndex } = useMapStore.getState();
    expect(history[historyIndex]).toEqual({ x: 706, y: 436 });
  });

  it('never moves the camera on coordinates the dispatcher could not read, and records nothing', () => {
    const { ctx, centerOn } = makeCtx();

    dispatchEvent(ctx, { type: WsMessageType.EVENT_MOVE_TO, x: NaN, y: 436 } as unknown as WsMessage);

    expect(centerOn).not.toHaveBeenCalled();
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('unreadable'));
    expect(useMapStore.getState().history).toEqual([]);
  });

  it('does nothing when there is no renderer yet', () => {
    const ctx = { getRenderer: () => null } as unknown as ClientHandlerContext;

    expect(() =>
      dispatchEvent(ctx, { type: WsMessageType.EVENT_MOVE_TO, x: 10, y: 20 } as unknown as WsMessage),
    ).not.toThrow();
  });

  it('falls through untouched on an unknown event type', () => {
    const { ctx, centerOn } = makeCtx();

    expect(() =>
      dispatchEvent(ctx, { type: 'NOT_A_REAL_EVENT' } as unknown as WsMessage),
    ).not.toThrow();

    expect(centerOn).not.toHaveBeenCalled();
    expect(useMapStore.getState().history).toEqual([]);
  });
});

describe('EVENT_CHAT_USER_LIST_CHANGE — server-side chase abort', () => {
  function leave(name: string): WsMessage {
    return {
      type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE,
      action: 'LEAVE',
      user: user(name),
    } as unknown as WsMessage;
  }

  it('clears the badge when the player we follow leaves', () => {
    useChatStore.setState({ chasedUser: CHASED });
    const { ctx } = makeCtx();

    dispatchEvent(ctx, leave(CHASED));

    expect(ClientBridge.removeChatUser).toHaveBeenCalledWith(CHASED);
    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(null);
  });

  it('leaves the badge alone when somebody else leaves', () => {
    useChatStore.setState({ chasedUser: CHASED });
    const { ctx } = makeCtx();

    dispatchEvent(ctx, leave('Someone Else'));

    expect(ClientBridge.removeChatUser).toHaveBeenCalledWith('Someone Else');
    expect(ClientBridge.setChasedUser).not.toHaveBeenCalled();
  });

  it('leaves the badge alone on a JOIN', () => {
    useChatStore.setState({ chasedUser: CHASED });
    const { ctx } = makeCtx();

    dispatchEvent(ctx, {
      type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE,
      action: 'JOIN',
      user: user(CHASED),
    } as unknown as WsMessage);

    expect(ClientBridge.addChatUser).toHaveBeenCalled();
    expect(ClientBridge.setChasedUser).not.toHaveBeenCalled();
  });
});
