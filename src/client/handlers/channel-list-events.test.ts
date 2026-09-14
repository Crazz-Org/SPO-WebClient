/**
 * EVENT_CHANNEL_LIST_CHANGE in the browser.
 *
 * The gateway has always translated the server's `NotifyChannelListChange`
 * broadcast (`push-dispatcher.ts:389-403`); until this case existed the browser
 * dropped it. It is how *other* players' lists learn about a channel someone
 * else created — the Interface Server fans the broadcast out to every
 * `TClientView` (`InterfaceServer.pas:4049`).
 *
 * `change` is `uchInclusion = 0` / `uchExclusion = 1`
 * (`Protocol/Protocol.pas:120`), the two branches asserted below.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatChannel: jest.fn(),
    removeChatChannel: jest.fn(),
    setCurrentChannel: jest.fn(),
    addChatMessage: jest.fn(),
  },
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WsMessageType } from '@/shared/types';
import type { WsEventChannelListChange } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { useChatStore } from '@/client/store/chat-store';
import type { ClientHandlerContext } from './client-context';

const ctx = {} as unknown as ClientHandlerContext;

const event = (change: number, name = 'Traders'): WsEventChannelListChange => ({
  type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE,
  name,
  password: 's3cret',
  change,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EVENT_CHANNEL_LIST_CHANGE', () => {
  it('inserts the channel on an inclusion (change = 0)', () => {
    dispatchEvent(ctx, event(0));

    expect(ClientBridge.addChatChannel).toHaveBeenCalledWith('Traders');
    expect(ClientBridge.removeChatChannel).not.toHaveBeenCalled();
  });

  it('drops the channel on an exclusion (change = 1)', () => {
    dispatchEvent(ctx, event(1, 'Podan Merchants'));

    expect(ClientBridge.removeChatChannel).toHaveBeenCalledWith('Podan Merchants');
    expect(ClientBridge.addChatChannel).not.toHaveBeenCalled();
  });

  it('never removes Lobby on an exclusion, whatever the case', () => {
    dispatchEvent(ctx, event(1, 'Lobby'));
    dispatchEvent(ctx, event(1, 'lobby'));
    dispatchEvent(ctx, event(1, 'LOBBY'));

    expect(ClientBridge.removeChatChannel).not.toHaveBeenCalled();
  });

  it('never removes on an exclusion with an empty name', () => {
    dispatchEvent(ctx, event(1, ''));

    expect(ClientBridge.removeChatChannel).not.toHaveBeenCalled();
  });

  it('excludes a channel that is not the current one without touching the current channel', () => {
    useChatStore.setState({ currentChannel: 'Lobby' });

    dispatchEvent(ctx, event(1, 'Traders'));

    expect(ClientBridge.removeChatChannel).toHaveBeenCalledWith('Traders');
    expect(ClientBridge.setCurrentChannel).not.toHaveBeenCalled();
    expect(ClientBridge.addChatMessage).not.toHaveBeenCalled();
  });

  it('falls back to Lobby with a system message when the excluded channel is the current one', () => {
    useChatStore.setState({ currentChannel: 'Traders' });

    dispatchEvent(ctx, event(1, 'Traders'));

    expect(ClientBridge.removeChatChannel).toHaveBeenCalledWith('Traders');
    expect(ClientBridge.setCurrentChannel).toHaveBeenCalledWith('Lobby');
    expect(ClientBridge.addChatMessage).toHaveBeenCalledWith(
      'Lobby',
      expect.objectContaining({ from: 'SYSTEM', isSystem: true }),
    );
  });
});
