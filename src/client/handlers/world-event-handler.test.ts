/**
 * world-event-handler (browser side) — the ask, and the silence.
 *
 * The gateway already collapses every "no event" case to `null`, so this
 * handler has exactly two jobs: send `REQ_WORLD_EVENT`, and never let a
 * failure reach the player.
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { requestWorldEvent } from './world-event-handler';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import { ClientBridge } from '../bridge/client-bridge';

function makeCtx(sendRequest: jest.Mock): ClientHandlerContext {
  return { sendRequest } as unknown as ClientHandlerContext;
}

describe('requestWorldEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for REQ_WORLD_EVENT and returns the event', async () => {
    const event = { date: '18/02/2026', kind: 1, text: 'Farm built in Helartia', x: 706, y: 436 };
    const sendRequest = jest.fn().mockResolvedValue({
      type: WsMessageType.RESP_WORLD_EVENT,
      event,
    });

    await expect(requestWorldEvent(makeCtx(sendRequest))).resolves.toEqual(event);
    expect(sendRequest).toHaveBeenCalledWith({ type: WsMessageType.REQ_WORLD_EVENT });
  });

  it('returns null when the response carries no event', async () => {
    const sendRequest = jest.fn().mockResolvedValue({ type: WsMessageType.RESP_WORLD_EVENT, event: null });

    await expect(requestWorldEvent(makeCtx(sendRequest))).resolves.toBeNull();
  });

  it('logs and returns null on a failure — no notification reaches the player', async () => {
    const sendRequest = jest.fn().mockRejectedValue(new Error('socket closed'));

    await expect(requestWorldEvent(makeCtx(sendRequest))).resolves.toBeNull();
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('socket closed'));
  });
});
