/**
 * REQ_BANK_LOAN — a visitor's loan request, at the WebSocket frontier.
 *
 * The frontier passes the triple through unchanged, echoes it back with the
 * verdict, and refuses an amount the server's own `StrToFloat`
 * (`StdBlocks/Banks.pas:165`) would choke on — before the session is reached.
 * `$1,000` is the interesting refusal: it is what a player types, and Voyager
 * strips it in the sheet (`Voyager/BankGeneralSheet.pas:435-436`), so a stripped
 * amount is what the gateway is entitled to expect.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { ERROR_InvalidParameter } from '../../../shared/error-codes';
import { handleBankLoan } from '../building-handlers';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  askBankLoan: jest.Mock;
}

function createCtx(result: unknown = { verdict: 'approved', result: '0' }): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const askBankLoan = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });

  const ctx = { ws, session: { askBankLoan } } as unknown as WsHandlerContext;
  return { ctx, sent, askBankLoan };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_BANK_LOAN,
  wsRequestId: 'req-1',
  x: 924,
  y: 820,
  amount: '1000000',
  ...over,
}) as unknown as WsMessage;

describe('handleBankLoan', () => {
  it('passes the coordinates and the amount to the session unchanged', async () => {
    const r = createCtx();

    await handleBankLoan(r.ctx, request());

    expect(r.askBankLoan).toHaveBeenCalledWith(924, 820, '1000000');
  });

  it('echoes the identity back with the verdict and the wire ordinal', async () => {
    const r = createCtx({ verdict: 'notEnoughFunds', result: '2' });

    await handleBankLoan(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toEqual({
      type: WsMessageType.RESP_BANK_LOAN,
      wsRequestId: 'req-1',
      x: 924,
      y: 820,
      amount: '1000000',
      verdict: 'notEnoughFunds',
      result: '2',
    });
  });

  it('carries a decimal amount through untouched', async () => {
    const r = createCtx();

    await handleBankLoan(r.ctx, request({ amount: '1000.50' }));

    expect(r.askBankLoan).toHaveBeenCalledWith(924, 820, '1000.50');
  });

  it.each([
    ['a thousands separator', '1,000'],
    ['a currency sign', '$5'],
    ['an empty box', ''],
    ['a negative amount', '-1'],
    ['a number rather than a string', 1000],
    ['a missing amount', undefined],
  ])('refuses %s without reaching the session', async (_label, amount) => {
    const r = createCtx();

    await handleBankLoan(r.ctx, request({ amount }));

    expect(r.askBankLoan).not.toHaveBeenCalled();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].code).toBe(ERROR_InvalidParameter);
  });

  it('turns a session failure into an error frame instead of a hung request', async () => {
    const r = createCtx(new Error('No building found at (924, 820)'));

    await handleBankLoan(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].wsRequestId).toBe('req-1');
  });
});
