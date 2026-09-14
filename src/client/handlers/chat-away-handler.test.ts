/**
 * chat-handler.setAwayStatus — announces the away state and clears the typing
 * dedupe flag, which is the whole "typing again clears it" mechanism: without
 * it, the next `setTypingStatus(ctx, true)` would be swallowed as a no-op.
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { WsMessageType } from '@/shared/types';
import { setAwayStatus, setTypingStatus } from './chat-handler';
import type { ClientHandlerContext } from './client-context';

function makeCtx(isTypingInChat = false) {
  const sendMessage = jest.fn();
  const ctx = { isTypingInChat, sendMessage } as unknown as ClientHandlerContext;
  return { ctx, sendMessage };
}

describe('setAwayStatus', () => {
  it('sends exactly REQ_CHAT_AWAY with no payload', () => {
    const { ctx, sendMessage } = makeCtx();

    setAwayStatus(ctx);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: WsMessageType.REQ_CHAT_AWAY });
  });

  it('leaves isTypingInChat false', () => {
    const { ctx } = makeCtx();

    setAwayStatus(ctx);

    expect(ctx.isTypingInChat).toBe(false);
  });

  it('resets isTypingInChat to false even after it was set to true', () => {
    const { ctx, sendMessage } = makeCtx();

    setTypingStatus(ctx, true);
    expect(ctx.isTypingInChat).toBe(true);

    setAwayStatus(ctx);
    expect(ctx.isTypingInChat).toBe(false);

    // The dedupe no longer swallows the next "true": it goes out again.
    sendMessage.mockClear();
    setTypingStatus(ctx, true);
    expect(sendMessage).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CHAT_TYPING_STATUS,
      isTyping: true,
    });
  });
});
