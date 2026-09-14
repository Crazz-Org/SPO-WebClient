/**
 * REQ_CHAT_JOIN_CHANNEL at the WebSocket frontier.
 *
 * A `ChannelJoinError` (wrong password / full channel, issue 618) is caught
 * here and turned into a `RESP_ERROR` carrying the server's own code and
 * player-readable sentence — unlike a chase refusal, this one must reach the
 * browser with the code intact so it can tell the two refusals apart. Any
 * other failure (e.g. "Not logged into world") is not a `ChannelJoinError`
 * and propagates to the registry's generic `RESP_ERROR` path instead.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleChatJoinChannel } from '../chat-handlers';
import { ChannelJoinError } from '../../session/chat-handler';
import { ERROR_InvalidPassword } from '../../../shared/error-codes';
import type { WsHandlerContext } from '../types';

function createCtx(failure?: Error) {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const joinChatChannel = jest.fn(async (_channelName: string, _password: string) => {
    if (failure) throw failure;
  });

  const ctx = { ws, session: { joinChatChannel } } as unknown as WsHandlerContext;
  return { ctx, sent, joinChatChannel };
}

const joinRequest = (channelName: string, password?: string): WsMessage => ({
  type: WsMessageType.REQ_CHAT_JOIN_CHANNEL,
  wsRequestId: '99',
  channelName,
  ...(password !== undefined ? { password } : {}),
}) as unknown as WsMessage;

describe('handleChatJoinChannel', () => {
  it('forwards the channel name and password, and answers RESP_CHAT_SUCCESS', async () => {
    const { ctx, sent, joinChatChannel } = createCtx();

    await handleChatJoinChannel(ctx, joinRequest('Boardroom', 'hunter2'));

    expect(joinChatChannel).toHaveBeenCalledWith('Boardroom', 'hunter2');
    expect(sent).toEqual([{ type: WsMessageType.RESP_CHAT_SUCCESS, wsRequestId: '99' }]);
  });

  it('defaults to an empty password when none is given', async () => {
    const { ctx, joinChatChannel } = createCtx();

    await handleChatJoinChannel(ctx, joinRequest('Lobby'));

    expect(joinChatChannel).toHaveBeenCalledWith('Lobby', '');
  });

  it('turns a ChannelJoinError into a RESP_ERROR carrying the server code and sentence', async () => {
    const { ctx, sent } = createCtx(new ChannelJoinError(ERROR_InvalidPassword, 'Wrong password for "Boardroom".'));

    await handleChatJoinChannel(ctx, joinRequest('Boardroom', 'wrong'));

    expect(sent).toEqual([{
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '99',
      errorMessage: 'Wrong password for "Boardroom".',
      code: ERROR_InvalidPassword,
    }]);
  });

  it('lets a non-ChannelJoinError failure propagate, and answers nothing itself', async () => {
    const { ctx, sent } = createCtx(new Error('Not logged into world'));

    await expect(handleChatJoinChannel(ctx, joinRequest('Lobby'))).rejects.toThrow('Not logged into world');
    expect(sent).toEqual([]);
  });
});
