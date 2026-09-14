/**
 * REQ_CHAT_CREATE_CHANNEL at the WebSocket frontier.
 *
 * Forwards to the session and answers RESP_CHAT_SUCCESS. A refusal is
 * deliberately NOT caught here: it propagates to the registry's generic
 * RESP_ERROR path, exactly as `handleChatJoinChannel` and `handleChatChase` let
 * theirs propagate. That propagation is the channel by which "already exists
 * and its password does not match" reaches the modal, which is the only way the
 * player can be told to correct the form.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleChatCreateChannel } from '../chat-handlers';
import type { WsHandlerContext } from '../types';

function createCtx(failure?: Error) {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const createChatChannel = jest.fn(async (_name: string, _password: string) => {
    if (failure) throw failure;
  });

  const ctx = { ws, session: { createChatChannel } } as unknown as WsHandlerContext;
  return { ctx, sent, createChatChannel };
}

const createRequest = (channelName = 'Traders', password = 's3cret'): WsMessage => ({
  type: WsMessageType.REQ_CHAT_CREATE_CHANNEL,
  wsRequestId: '91',
  channelName,
  password,
}) as unknown as WsMessage;

describe('handleChatCreateChannel', () => {
  it('forwards the name and the password to the session and answers RESP_CHAT_SUCCESS', async () => {
    const { ctx, sent, createChatChannel } = createCtx();

    await handleChatCreateChannel(ctx, createRequest());

    expect(createChatChannel).toHaveBeenCalledWith('Traders', 's3cret');
    expect(sent).toEqual([{ type: WsMessageType.RESP_CHAT_SUCCESS, wsRequestId: '91' }]);
  });

  it('forwards an empty password unchanged', async () => {
    const { ctx, createChatChannel } = createCtx();

    await handleChatCreateChannel(ctx, createRequest('Open House', ''));

    expect(createChatChannel).toHaveBeenCalledWith('Open House', '');
  });

  it('lets a refusal propagate, and answers nothing itself', async () => {
    const { ctx, sent } = createCtx(
      new Error('Channel "Traders" already exists and its password does not match'),
    );

    await expect(handleChatCreateChannel(ctx, createRequest())).rejects.toThrow(/password/);
    expect(sent).toEqual([]);
  });
});
