/**
 * The browser half of creating a channel.
 *
 * Two things separate it from `joinChannel`: a rejection is **rethrown**, so the
 * modal can stay open and show the server's reason, and the list is updated by
 * insertion rather than by re-fetching — what the reference client did
 * (`ChatHandler.pas:284-287`).
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatChannel: jest.fn(),
    removeChatChannel: jest.fn(),
    setCurrentChannel: jest.fn(),
    setChannelInfo: jest.fn(),
  },
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WsMessageType } from '@/shared/types';
import type { WsMessage } from '@/shared/types';
import { createChannel } from './chat-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

function makeCtx(reject?: Error) {
  const sent: WsMessage[] = [];
  const sendRequest = jest.fn(async (req: WsMessage) => {
    sent.push(req);
    if (reject) throw reject;
    return { type: WsMessageType.RESP_CHAT_SUCCESS, info: 'Traders (Creator: SPO_test3).' } as WsMessage;
  });
  const ctx = { sendRequest, showNotification: jest.fn() } as unknown as ClientHandlerContext;
  return { ctx, sent, sendRequest };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createChannel', () => {
  it('sends REQ_CHAT_CREATE_CHANNEL with the name and the password', async () => {
    const { ctx, sent } = makeCtx();

    await createChannel(ctx, 'Traders', 's3cret');

    expect(sent[0]).toEqual({
      type: WsMessageType.REQ_CHAT_CREATE_CHANNEL,
      channelName: 'Traders',
      password: 's3cret',
    });
  });

  it('inserts the channel and stands in it once the server accepted', async () => {
    const { ctx } = makeCtx();

    await createChannel(ctx, 'Traders', 's3cret');

    expect(ClientBridge.addChatChannel).toHaveBeenCalledWith('Traders');
    expect(ClientBridge.setCurrentChannel).toHaveBeenCalledWith('Traders');
  });

  it('asks for the new channel description with the raw typed name', async () => {
    const { ctx, sent } = makeCtx();

    await createChannel(ctx, 'Traders', 's3cret');

    const info = sent.find(m => m.type === WsMessageType.REQ_CHAT_GET_CHANNEL_INFO);
    expect(info).toEqual({
      type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO,
      channelName: 'Traders',
    });
  });

  it('rethrows a refusal and writes nothing to the list or the current channel', async () => {
    const { ctx } = makeCtx(new Error('Channel "Traders" already exists and its password does not match'));

    await expect(createChannel(ctx, 'Traders', 'wrong')).rejects.toThrow(/password/);

    expect(ClientBridge.addChatChannel).not.toHaveBeenCalled();
    expect(ClientBridge.setCurrentChannel).not.toHaveBeenCalled();
  });
});
