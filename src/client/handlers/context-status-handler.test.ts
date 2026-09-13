/**
 * context-status-handler (browser side) — the ask, and the silence.
 *
 * The gateway already collapses every "no sentence" case to `''`, so this
 * handler has exactly two jobs: send `REQ_CONTEXT_STATUS` with the tile, and
 * never let a failure reach the player — an idle decoration that pops a
 * notification every 20 s would be noise, not information.
 */

jest.mock('../bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { requestContextStatusText } from './context-status-handler';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import { ClientBridge } from '../bridge/client-bridge';

function makeCtx(sendRequest: jest.Mock): ClientHandlerContext {
  return { sendRequest } as unknown as ClientHandlerContext;
}

describe('requestContextStatusText', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for the tile and returns the sentence', async () => {
    const sendRequest = jest.fn().mockResolvedValue({
      type: WsMessageType.RESP_CONTEXT_STATUS,
      text: 'Podan, population 12,400',
    });

    await expect(requestContextStatusText(makeCtx(sendRequest), 706, 436))
      .resolves.toBe('Podan, population 12,400');

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CONTEXT_STATUS,
      x: 706,
      y: 436,
    });
  });

  it('returns "" when the response carries no text at all', async () => {
    const sendRequest = jest.fn().mockResolvedValue({ type: WsMessageType.RESP_CONTEXT_STATUS });

    await expect(requestContextStatusText(makeCtx(sendRequest), 1, 1)).resolves.toBe('');
  });

  it('logs and returns "" on a failure — no notification reaches the player', async () => {
    const sendRequest = jest.fn().mockRejectedValue(new Error('socket closed'));

    await expect(requestContextStatusText(makeCtx(sendRequest), 706, 436)).resolves.toBe('');
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('socket closed'));
  });
});
