/**
 * chat-handler.requestChannelInfo — the GetChannelInfo fetch behind the
 * ChatStrip header subtitle.
 *
 * The server expects the wire name for the default channel ("" for Lobby,
 * same translation `joinChannel`'s caller already applies at the ChatStrip
 * layer), but the store keys the result by the display name so it lines up
 * with `channels`/`currentChannel`. A placeholder goes out immediately so the
 * header does not sit blank while the request is in flight, and a failure
 * clears it rather than leaving a stale "Loading..." behind.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn(), setChannelInfo: jest.fn(), setCurrentChannel: jest.fn() },
}));

import { WsMessageType } from '@/shared/types';
import { requestChannelInfo, joinChannel } from './chat-handler';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

type Answer = { info: string } | Error;

function makeCtx(answer: Answer) {
  const sendRequest = jest.fn(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
  const ctx = { sendRequest } as unknown as ClientHandlerContext;
  return { ctx, sendRequest };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestChannelInfo', () => {
  it('translates "Lobby" to the empty wire name, but stores the answer under "Lobby"', async () => {
    const { ctx, sendRequest } = makeCtx({ info: 'Lobby (Creator: Admin). 5 users: John, Mary and Bob.' });

    await requestChannelInfo(ctx, 'Lobby');

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO,
      channelName: '',
    });
    expect(ClientBridge.setChannelInfo).toHaveBeenNthCalledWith(1, 'Lobby', 'Loading...');
    expect(ClientBridge.setChannelInfo).toHaveBeenNthCalledWith(
      2, 'Lobby', 'Lobby (Creator: Admin). 5 users: John, Mary and Bob.',
    );
  });

  it('sends a named channel unchanged', async () => {
    const { ctx, sendRequest } = makeCtx({ info: 'Trade (Creator: Merchant). Password protected.' });

    await requestChannelInfo(ctx, 'Trade');

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO,
      channelName: 'Trade',
    });
    expect(ClientBridge.setChannelInfo).toHaveBeenLastCalledWith(
      'Trade', 'Trade (Creator: Merchant). Password protected.',
    );
  });

  it('clears the placeholder instead of leaving "Loading..." behind on failure', async () => {
    const { ctx } = makeCtx(new Error('socket closed'));

    await requestChannelInfo(ctx, 'Trade');

    expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Failed to get channel info: socket closed');
    expect(ClientBridge.setChannelInfo).toHaveBeenNthCalledWith(1, 'Trade', 'Loading...');
    expect(ClientBridge.setChannelInfo).toHaveBeenNthCalledWith(2, 'Trade', '');
  });
});

describe('joinChannel — a rejection', () => {
  function joinCtx(err: unknown) {
    const ctx = {
      isJoiningChannel: false,
      sendRequest: jest.fn(() => Promise.reject(err)),
      showNotification: jest.fn(),
    } as unknown as ClientHandlerContext & { showNotification: jest.Mock };
    return ctx;
  }

  it('without a gateway sentence shows the player sentence and rolls back', async () => {
    const ctx = joinCtx(new Error('Request Timeout'));

    await joinChannel(ctx, 'Trade', undefined, 'Lobby');

    expect(ctx.showNotification).toHaveBeenCalledWith(
      'Could not join this channel — the server did not answer in time. Try again.',
      'error',
    );
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Failed to join channel: Request Timeout');
    expect(ClientBridge.setCurrentChannel).toHaveBeenLastCalledWith('Lobby');
    expect(ctx.isJoiningChannel).toBe(false);
  });

  it('with a gateway sentence shows that sentence unchanged', async () => {
    const ctx = joinCtx(Object.assign(new Error('Unknown error'), { code: 1, serverMessage: 'Wrong password.' }));

    await joinChannel(ctx, 'Trade', 'x', 'Lobby');

    expect(ctx.showNotification).toHaveBeenCalledWith('Wrong password.', 'error');
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Failed to join channel: Wrong password.');
  });
});
