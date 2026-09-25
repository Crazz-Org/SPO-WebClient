/**
 * REQ_CHAT_CREATE_CHANNEL at the WebSocket frontier.
 *
 * Forwards to the session and answers RESP_CHAT_SUCCESS. A `ChannelCreateError`
 * (the name is taken and the fall-through JoinChannel refused: `res` 13 / 32)
 * is caught here and turned into RESP_ERROR carrying the server's code and the
 * gateway's sentence, exactly as `handleChatJoinChannel` does with
 * `ChannelJoinError`. It has to be: the registry's generic path in `server.ts`
 * replaces any error that reaches it with 'Internal server error', so a refusal
 * left to propagate would reach the modal as "Unknown error". Any other failure
 * still propagates to that generic path — no raw internal message is sent.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleChatCreateChannel } from '../chat-handlers';
import { ChannelCreateError } from '../../session/chat-handler';
import { ERROR_InvalidPassword, ERROR_NotEnoughRoom } from '../../../shared/error-codes';
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

  it('answers a password refusal with RESP_ERROR carrying the code and the sentence', async () => {
    const sentence = 'Channel "Traders" already exists and its password does not match';
    const { ctx, sent } = createCtx(new ChannelCreateError(ERROR_InvalidPassword, sentence));

    await handleChatCreateChannel(ctx, createRequest());

    expect(sent).toEqual([{
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '91',
      errorMessage: sentence,
      code: ERROR_InvalidPassword,
    }]);
  });

  it('answers a full-channel refusal with RESP_ERROR carrying the code and the sentence', async () => {
    const sentence = 'Channel "Traders" already exists and is full';
    const { ctx, sent } = createCtx(new ChannelCreateError(ERROR_NotEnoughRoom, sentence));

    await handleChatCreateChannel(ctx, createRequest());

    expect(sent).toEqual([{
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '91',
      errorMessage: sentence,
      code: ERROR_NotEnoughRoom,
    }]);
  });

  it('lets any other failure reach the generic path, and answers nothing itself', async () => {
    const { ctx, sent } = createCtx(new Error('Failed to create channel: 1'));

    await expect(handleChatCreateChannel(ctx, createRequest())).rejects.toThrow('Failed to create channel: 1');
    expect(sent).toEqual([]);
  });
});
