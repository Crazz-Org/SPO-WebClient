/**
 * initChatChannels — the default-channel branch (issue #620).
 *
 * With no default pinned, the sequence is byte-for-byte today's: join `''`, label
 * "Lobby". With a default pinned, it tries to land there instead -- recreating it if
 * the channel list no longer has it -- and falls back to `''` with a visible warning
 * the moment the store shows it did not land in the pinned channel.
 */

jest.mock('../bridge/client-bridge', () => {
  const { useChatStore } = require('../store/chat-store');
  return {
    ClientBridge: {
      log: jest.fn(),
      setChatChannels: (channels: unknown) => useChatStore.getState().setChannels(channels),
      setCurrentChannel: (channel: string) => useChatStore.getState().setCurrentChannel(channel),
      addChatChannel: (channel: string) => useChatStore.getState().addChannel(channel),
      setChannelInfo: (channel: string, info: string) => useChatStore.getState().setChannelInfo(channel, info),
    },
  };
});

jest.mock('../store/default-channel', () => ({
  loadDefaultChannel: jest.fn(),
}));

import { WsMessageType } from '@/shared/types';
import type { WsMessage, WsReqChatJoinChannel, ChatChannel } from '@/shared/types';
import { initChatChannels } from './chat-handler';
import { useChatStore } from '../store/chat-store';
import { loadDefaultChannel } from '../store/default-channel';
import type { ClientHandlerContext } from './client-context';

interface Options {
  channels?: ChatChannel[];
  joinReject?: Record<string, Error>;
  createReject?: Error;
}

function makeCtx(opts: Options = {}) {
  const sent: WsMessage[] = [];
  const sendRequest = jest.fn(async (req: WsMessage) => {
    sent.push(req);
    switch (req.type) {
      case WsMessageType.REQ_CHAT_GET_CHANNELS:
        return { type: WsMessageType.RESP_CHAT_CHANNEL_LIST, channels: opts.channels ?? [] };
      case WsMessageType.REQ_CHAT_JOIN_CHANNEL: {
        const name = (req as WsReqChatJoinChannel).channelName;
        if (opts.joinReject?.[name]) throw opts.joinReject[name];
        return { type: WsMessageType.RESP_CHAT_SUCCESS };
      }
      case WsMessageType.REQ_CHAT_CREATE_CHANNEL:
        if (opts.createReject) throw opts.createReject;
        return { type: WsMessageType.RESP_CHAT_SUCCESS, info: 'Traders (Creator: SPO_test3).' };
      case WsMessageType.REQ_CHAT_GET_CHANNEL_INFO:
        return { type: WsMessageType.RESP_CHAT_CHANNEL_INFO, info: 'info' };
      case WsMessageType.REQ_CHAT_GET_USERS:
        return { type: WsMessageType.RESP_CHAT_USER_LIST, users: [] };
      default:
        return {};
    }
  });
  const ctx = {
    sendRequest,
    showNotification: jest.fn(),
    isJoiningChannel: false,
  } as unknown as ClientHandlerContext;
  return { ctx, sent };
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ currentChannel: '', channels: [], channelInfo: {} });
});

describe('initChatChannels — default channel', () => {
  it('with none stored, joins the empty wire name and labels the strip Lobby', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue(null);
    const { ctx, sent } = makeCtx({ channels: [{ name: 'Lobby', isProtected: false }] });

    await initChatChannels(ctx);

    const joins = sent.filter((m) => m.type === WsMessageType.REQ_CHAT_JOIN_CHANNEL);
    expect(joins).toEqual([{ type: WsMessageType.REQ_CHAT_JOIN_CHANNEL, channelName: '' }]);
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
    expect(ctx.showNotification).not.toHaveBeenCalled();
  });

  it('with a stored default already in the channel list, joins it and never ""', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue('Trade');
    const { ctx, sent } = makeCtx({
      channels: [{ name: 'Lobby', isProtected: false }, { name: 'Trade', isProtected: false }],
    });

    await initChatChannels(ctx);

    const joins = sent.filter((m) => m.type === WsMessageType.REQ_CHAT_JOIN_CHANNEL);
    expect(joins).toEqual([{ type: WsMessageType.REQ_CHAT_JOIN_CHANNEL, channelName: 'Trade' }]);
    expect(useChatStore.getState().currentChannel).toBe('Trade');
    expect(ctx.showNotification).not.toHaveBeenCalled();
  });

  it('recreates a stored default absent from the channel list', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue('Traders');
    const { ctx, sent } = makeCtx({ channels: [{ name: 'Lobby', isProtected: false }] });

    await initChatChannels(ctx);

    const create = sent.find((m) => m.type === WsMessageType.REQ_CHAT_CREATE_CHANNEL);
    expect(create).toEqual({ type: WsMessageType.REQ_CHAT_CREATE_CHANNEL, channelName: 'Traders', password: '' });
    expect(useChatStore.getState().currentChannel).toBe('Traders');
    expect(ctx.showNotification).not.toHaveBeenCalled();
  });

  it('falls back to Lobby with a warning when the recreate is refused', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue('Traders');
    const { ctx, sent } = makeCtx({
      channels: [{ name: 'Lobby', isProtected: false }],
      createReject: new Error('name already taken'),
    });

    await initChatChannels(ctx);

    const joins = sent.filter((m) => m.type === WsMessageType.REQ_CHAT_JOIN_CHANNEL);
    expect(joins).toEqual([{ type: WsMessageType.REQ_CHAT_JOIN_CHANNEL, channelName: '' }]);
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
    expect(ctx.showNotification).toHaveBeenCalledWith(
      'Default channel "Traders" is unavailable — you are in Lobby',
      'warning',
    );
  });

  it('falls back to Lobby with a warning when the server refuses the join', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue('Trade');
    const { ctx, sent } = makeCtx({
      channels: [{ name: 'Lobby', isProtected: false }, { name: 'Trade', isProtected: false }],
      joinReject: { Trade: new Error('channel is full') },
    });

    await initChatChannels(ctx);

    const joins = sent.filter((m) => m.type === WsMessageType.REQ_CHAT_JOIN_CHANNEL);
    expect(joins.map((m) => (m as WsReqChatJoinChannel).channelName)).toEqual(['Trade', '']);
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
    expect(ctx.showNotification).toHaveBeenCalledWith(
      'Default channel "Trade" is unavailable — you are in Lobby',
      'warning',
    );
  });

  it('treats a stored default of "Lobby" exactly like no default', async () => {
    (loadDefaultChannel as jest.Mock).mockReturnValue('Lobby');
    const { ctx, sent } = makeCtx({ channels: [{ name: 'Lobby', isProtected: false }] });

    await initChatChannels(ctx);

    const joins = sent.filter((m) => m.type === WsMessageType.REQ_CHAT_JOIN_CHANNEL);
    expect(joins).toEqual([{ type: WsMessageType.REQ_CHAT_JOIN_CHANNEL, channelName: '' }]);
    expect(ctx.showNotification).not.toHaveBeenCalled();
  });
});
