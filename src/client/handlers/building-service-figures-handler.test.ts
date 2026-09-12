/**
 * requestServiceFigures — the client half of the General tab's live poll.
 *
 * It returns its answer rather than writing a store, because the figures belong
 * to the card list on screen and have to disappear with it. The rules it must
 * hold are the poll's: never send while disconnected, and never throw — a
 * failed tick has to leave the next one able to run.
 */

import { requestServiceFigures } from './building-action-handler';
import { useGameStore } from '../store/game-store';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn() },
}));

function makeCtx(reply: unknown): { ctx: ClientHandlerContext; sendRequest: jest.Mock } {
  const sendRequest = jest.fn().mockImplementation(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { ctx: { sendRequest } as unknown as ClientHandlerContext, sendRequest };
}

const REPLY = {
  type: WsMessageType.RESP_BUILDING_SERVICE_FIGURES,
  x: 10, y: 20, serviceIndex: 1, supply: '64', demand: '37',
};

beforeEach(() => {
  jest.clearAllMocks();
  useGameStore.setState({ status: 'connected' });
});

describe('requestServiceFigures', () => {
  it('sends REQ_BUILDING_SERVICE_FIGURES with the coordinates and the one index', async () => {
    const { ctx, sendRequest } = makeCtx(REPLY);

    await requestServiceFigures(ctx, 10, 20, 1);

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_BUILDING_SERVICE_FIGURES,
      x: 10,
      y: 20,
      serviceIndex: 1,
    });
  });

  it('returns the two wire strings as answered', async () => {
    const { ctx } = makeCtx(REPLY);

    expect(await requestServiceFigures(ctx, 10, 20, 1)).toEqual({ supply: '64', demand: '37' });
  });

  it('stays silent while disconnected', async () => {
    useGameStore.setState({ status: 'disconnected' });
    const { ctx, sendRequest } = makeCtx(REPLY);

    expect(await requestServiceFigures(ctx, 10, 20, 1)).toBeNull();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('answers null on a failed request rather than throwing into the timer', async () => {
    const { ctx } = makeCtx(new Error('Request timeout'));

    expect(await requestServiceFigures(ctx, 10, 20, 1)).toBeNull();
  });
});
