/**
 * chat-handler.chaseUser / stopChase — the browser half of following another
 * player's camera.
 *
 * Two asymmetries are the point of this file, and both come from the reference
 * client:
 *  - the badge goes up only when the server accepted, because Voyager only
 *    remembers `fChasedUser` on NOERROR (ServerCnxHandler.pas:1873-1897);
 *  - the badge comes down whatever the server answers, because Voyager clears
 *    it in a `finally` (ServerCnxHandler.pas:1900-1921). A failed stop must
 *    never strand the player with a badge they cannot dismiss.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn(), setChasedUser: jest.fn() },
}));

import { WsMessageType } from '@/shared/types';
import { chaseUser, stopChase } from './chat-handler';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

const CHASED = 'Mayor of Podan';

function makeCtx(answer: unknown | Error) {
  const sendRequest = jest.fn(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
  const showNotification = jest.fn();
  const ctx = { sendRequest, showNotification } as unknown as ClientHandlerContext;
  return { ctx, sendRequest, showNotification };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chaseUser', () => {
  it('sends REQ_CHAT_CHASE with the name and raises the badge on success', async () => {
    const { ctx, sendRequest, showNotification } = makeCtx({ type: WsMessageType.RESP_CHAT_SUCCESS });

    await chaseUser(ctx, CHASED);

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CHAT_CHASE,
      userName: CHASED,
    });
    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(CHASED);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('leaves the badge down and shows the fixed fallback when the rejection carries no gateway sentence', async () => {
    const { ctx, showNotification } = makeCtx(new Error('Cannot follow Mayor of Podan: unknown, offline, or already following you'));

    await expect(chaseUser(ctx, CHASED)).resolves.toBeUndefined();

    expect(ClientBridge.setChasedUser).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith(`Cannot follow ${CHASED}`, 'error');
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', expect.stringContaining(CHASED));
  });

  it('shows the gateway\'s own sentence, mapped from ERROR_InvalidUserName, when the rejection carries one', async () => {
    const err = Object.assign(new Error('raw code'), { serverMessage: 'Invalid username' });
    const { ctx, showNotification } = makeCtx(err);

    await expect(chaseUser(ctx, CHASED)).resolves.toBeUndefined();

    expect(ClientBridge.setChasedUser).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith('Invalid username', 'error');
  });
});

describe('stopChase', () => {
  it('sends REQ_CHAT_STOP_CHASE with no payload and clears the badge', async () => {
    const { ctx, sendRequest } = makeCtx({ type: WsMessageType.RESP_CHAT_SUCCESS });

    await stopChase(ctx);

    expect(sendRequest).toHaveBeenCalledWith({ type: WsMessageType.REQ_CHAT_STOP_CHASE });
    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(null);
  });

  it('clears the badge even when the stop request fails', async () => {
    const { ctx } = makeCtx(new Error('socket closed'));

    await expect(stopChase(ctx)).resolves.toBeUndefined();

    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(null);
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', expect.stringContaining('socket closed'));
  });
});
