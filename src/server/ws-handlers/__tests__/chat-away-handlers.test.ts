/**
 * REQ_CHAT_AWAY at the WebSocket frontier.
 *
 * Forwards to the session and sends no response — mirrors handleChatTypingStatus,
 * not handleChatChase: away is a fire-and-forget notice, not a request with an
 * answer.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleChatAway } from '../chat-handlers';
import type { WsHandlerContext } from '../types';

function createCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const setChatAway = jest.fn(async () => {});
  const ctx = { ws, session: { setChatAway } } as unknown as WsHandlerContext;
  return { ctx, sent, setChatAway };
}

const awayRequest = (): WsMessage => ({
  type: WsMessageType.REQ_CHAT_AWAY,
  wsRequestId: '99',
}) as unknown as WsMessage;

describe('handleChatAway', () => {
  it('calls session.setChatAway and sends no response', async () => {
    const { ctx, sent, setChatAway } = createCtx();

    await handleChatAway(ctx, awayRequest());

    expect(setChatAway).toHaveBeenCalledWith();
    expect(sent).toEqual([]);
  });
});
