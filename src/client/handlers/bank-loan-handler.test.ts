/**
 * `requestBankLoan` — the client half of the visitor's loan request.
 *
 * It returns a verdict rather than writing a store or raising a toast, because
 * all four answers (Voyager/BankGeneralSheet.pas:446-468) are drawn in the
 * control's own panel. The rules it must hold: never send while disconnected,
 * and never throw — a failed call is `brqError`, an answer, not an exception.
 */

import { requestBankLoan } from './building-action-handler';
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

const reply = (verdict: string, result: string) => ({
  type: WsMessageType.RESP_BANK_LOAN,
  x: 10, y: 20, amount: '1000000', verdict, result,
});

beforeEach(() => {
  jest.clearAllMocks();
  useGameStore.setState({ status: 'connected' });
});

describe('requestBankLoan', () => {
  it('sends REQ_BANK_LOAN with the coordinates and the sanitised amount', async () => {
    const { ctx, sendRequest } = makeCtx(reply('approved', '0'));

    await requestBankLoan(ctx, 10, 20, '1000000');

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_BANK_LOAN,
      x: 10,
      y: 20,
      amount: '1000000',
    });
  });

  it.each([
    ['approved', '0'],
    ['rejected', '1'],
    ['notEnoughFunds', '2'],
    ['error', '3'],
  ])('returns the %s verdict as answered', async (verdict, ordinal) => {
    const { ctx } = makeCtx(reply(verdict, ordinal));

    expect(await requestBankLoan(ctx, 10, 20, '1000000')).toBe(verdict);
  });

  it('stays silent while disconnected, and answers brqError', async () => {
    useGameStore.setState({ status: 'disconnected' });
    const { ctx, sendRequest } = makeCtx(reply('approved', '0'));

    expect(await requestBankLoan(ctx, 10, 20, '1000000')).toBe('error');
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('answers brqError on a failed request rather than throwing at the button', async () => {
    const { ctx } = makeCtx(new Error('Request timeout'));

    expect(await requestBankLoan(ctx, 10, 20, '1000000')).toBe('error');
  });
});
