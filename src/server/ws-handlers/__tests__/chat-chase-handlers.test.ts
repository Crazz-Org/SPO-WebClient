/**
 * REQ_CHAT_CHASE / REQ_CHAT_STOP_CHASE at the WebSocket frontier.
 *
 * Both forward to the session and answer RESP_CHAT_SUCCESS. A refusal is
 * deliberately NOT caught here: it propagates to the registry's generic
 * RESP_ERROR path, exactly as `handleChatJoinChannel` lets a failed join
 * propagate — the browser needs the server's own message to tell the player
 * why the follow was refused.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleChatChase, handleChatStopChase } from '../chat-handlers';
import type { WsHandlerContext } from '../types';

function createCtx(failure?: Error) {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const chaseUser = jest.fn(async (_userName: string) => {
    if (failure) throw failure;
  });
  const stopChase = jest.fn(async () => {
    if (failure) throw failure;
  });

  const ctx = { ws, session: { chaseUser, stopChase } } as unknown as WsHandlerContext;
  return { ctx, sent, chaseUser, stopChase };
}

const chaseRequest = (userName = 'Mayor of Podan'): WsMessage => ({
  type: WsMessageType.REQ_CHAT_CHASE,
  wsRequestId: '77',
  userName,
}) as unknown as WsMessage;

const stopRequest = (): WsMessage => ({
  type: WsMessageType.REQ_CHAT_STOP_CHASE,
  wsRequestId: '78',
}) as unknown as WsMessage;

describe('handleChatChase', () => {
  it('forwards the name to the session and answers RESP_CHAT_SUCCESS', async () => {
    const { ctx, sent, chaseUser } = createCtx();

    await handleChatChase(ctx, chaseRequest());

    expect(chaseUser).toHaveBeenCalledWith('Mayor of Podan');
    expect(sent).toEqual([{ type: WsMessageType.RESP_CHAT_SUCCESS, wsRequestId: '77' }]);
  });

  it('lets a refusal propagate, and answers nothing itself', async () => {
    const { ctx, sent } = createCtx(new Error('Cannot follow Ghost: unknown, offline, or already following you'));

    await expect(handleChatChase(ctx, chaseRequest('Ghost'))).rejects.toThrow('Cannot follow Ghost');
    expect(sent).toEqual([]);
  });
});

describe('handleChatStopChase', () => {
  it('calls the session with no argument and answers RESP_CHAT_SUCCESS', async () => {
    const { ctx, sent, stopChase } = createCtx();

    await handleChatStopChase(ctx, stopRequest());

    expect(stopChase).toHaveBeenCalledWith();
    expect(sent).toEqual([{ type: WsMessageType.RESP_CHAT_SUCCESS, wsRequestId: '78' }]);
  });

  it('lets a transport failure propagate', async () => {
    const { ctx, sent } = createCtx(new Error('Not logged into world'));

    await expect(handleChatStopChase(ctx, stopRequest())).rejects.toThrow('Not logged into world');
    expect(sent).toEqual([]);
  });
});
