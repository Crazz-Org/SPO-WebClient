/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `bank-loan-request` — driven through the real gateway and the real client half.
 *
 * Part 1 fixes the catalogue and the wire: `RDOAskLoan` on the block is a
 * 2-argument `function` (`StdBlocks/Banks.pas:46`), so every frame carries `"^"`,
 * the security id as a `#` integer and the sanitised amount as a `%` string.
 * Part 2 drives the real `requestBankLoan` against an `RdoMock` loaded with the
 * scenario, once per `TBankRequestResult` ordinal, and follows each answer out
 * through the real WS handler and the real client handler to the verdict the
 * borrow box renders.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket, WsMessage, WsRespBuildingLoanRequest } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import { bankLoanOutcomeOf, BANK_LOAN_VERDICTS } from '@/shared/building-details';
import { requestBankLoan } from '@/server/session/building-details-handler';
import { handleBuildingLoanRequest } from '@/server/ws-handlers/building-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { requestBankLoan as clientRequestBankLoan } from '@/client/handlers/building-action-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { useGameStore } from '@/client/store/game-store';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import * as ErrorCodes from '@/shared/error-codes';
import { RdoMock } from '../rdo-mock';
import {
  createBankLoanRequestScenario,
  BANK_LOAN_BLOCK,
  BANK_LOAN_TYCOON,
  BANK_LOAN_AMOUNT,
  BANK_LOAN_RAW_AMOUNT,
} from './bank-loan-request-scenario';

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn() },
}));

const X = 118;
const Y = 226;

/** The four ordinals of `Voyager/BankGeneralSheet.pas:22`. */
const ORDINALS = [0, 1, 2, 3] as const;

/** The outcome each ordinal stands for, written out (`Voyager/BankGeneralSheet.pas:22`). */
const OUTCOME_OF = { 0: 'approved', 1: 'rejected', 2: 'notEnoughFunds', 3: 'error' } as const;

describe('bank-loan-request scenario — the catalogue and the wire', () => {
  const { rdo } = createBankLoanRequestScenario();

  it('RDOAskLoan is a catalogued 2-argument function (StdBlocks/Banks.pas:46)', () => {
    expect(RDO_MEMBERS.RDOAskLoan).toEqual({ kind: 'function', arity: 2 });
  });

  it('every request carries the "^" call form, never the void "*"', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('answers whichever ordinal the factory was asked for', () => {
    for (const result of ORDINALS) {
      const built = createBankLoanRequestScenario(undefined, { result });
      expect(built.rdo.exchanges[0].response).toBe(`A200 res="#${result}"`);
    }
  });
});

function makeCtx(result: number, proxyId: number | null = BANK_LOAN_TYCOON) {
  const { rdo } = createBankLoanRequestScenario(undefined, { result });
  const fake = makeSessionCtx({ sockets: ['construction'], fTycoonProxyId: proxyId });
  (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([BANK_LOAN_BLOCK]); // substrate-exception: reads the cacher, which the fake stubs and which emits no frame, so no scenario can answer it

  const mock = new RdoMock();
  mock.addScenario(rdo);

  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const r = mock.match(frame);
    return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
  });

  return { fake, mock, rdo };
}

describe('bank-loan-request scenario — the gateway drive', () => {
  it('emits the "^" call with the proxy id as an integer and the sanitised amount as a string', async () => {
    const { fake } = makeCtx(0);

    await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT);

    expect(fake.sent).toHaveLength(1);
    const frame = RdoProtocol.format(fake.sent[0].packet as RdoPacket);
    expect(frame).toContain(
      `call RDOAskLoan "^" ${RdoValue.int(BANK_LOAN_TYCOON).format()},${RdoValue.string(BANK_LOAN_AMOUNT).format()}`,
    );
  });

  it('consumes the single exchange', async () => {
    const { fake, mock } = makeCtx(0);

    await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT);

    expect(mock.getConsumedIds()).toEqual(new Set(['bl-rdo-ask-loan']));
  });

  it('the fixture request is byte-for-byte the frame production emitted', async () => {
    const { fake, mock, rdo } = makeCtx(0);

    await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT);

    const frame = `${RdoProtocol.format(fake.sent[0].packet as RdoPacket)};`;
    const hit = mock.match(frame)!;
    expect(frame).toBe(hit.exchange.request);
    expect(frame).toPassStrictRdoValidation(rdo);
  });

  it('answers -1 and sends no frame at all when there is no proxy id', async () => {
    const { fake } = makeCtx(0, null);

    expect(await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT)).toEqual({ result: -1 });
    expect(fake.sent).toHaveLength(0);
  });

  it('throws when no building stands at the coordinates', async () => {
    const { fake } = makeCtx(0);
    (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([]); // substrate-exception: reads the cacher, which the fake stubs and which emits no frame, so no scenario can answer it

    await expect(requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT)).rejects.toThrow(/No building found/);
  });

  it('connects the construction socket when it is not up yet', async () => {
    const { fake } = makeCtx(0);
    (fake.ctx.getSocket as jest.Mock).mockReturnValue(undefined); // substrate-exception: socket presence is connection state on the fake, not a frame, so no scenario can answer it

    await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT);

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
  });

  it('answers -1 rather than a bogus ordinal when the block answers nothing readable', async () => {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([BANK_LOAN_BLOCK]); // substrate-exception: reads the cacher, which the fake stubs and which emits no frame, so no scenario can answer it
    fake.respond(() => 'res="%"');

    expect(await requestBankLoan(fake.ctx, X, Y, BANK_LOAN_RAW_AMOUNT)).toEqual({ result: -1 });
  });
});

/** A `WsHandlerContext` whose socket keeps every JSON message written to it. */
function makeWsCtx(session: unknown) {
  const sent: WsMessage[] = [];
  const ws = { send: (raw: string) => { sent.push(JSON.parse(raw) as WsMessage); } };
  return { ctx: { ws, session } as unknown as WsHandlerContext, sent };
}

describe('bank-loan-request scenario — the four verdicts, end to end', () => {
  beforeEach(() => {
    useGameStore.setState({ status: 'connected' });
  });

  it.each(ORDINALS)('ordinal %i travels the whole path and renders its own verdict', async (result) => {
    const { fake } = makeCtx(result);

    // Gateway → WS handler: the real session delegation, over the real mock.
    const session = {
      requestBankLoan: (x: number, y: number, amount: string) => requestBankLoan(fake.ctx, x, y, amount),
    };
    const ws = makeWsCtx(session);
    await handleBuildingLoanRequest(ws.ctx, {
      type: WsMessageType.REQ_BUILDING_LOAN_REQUEST,
      wsRequestId: 'req-1',
      x: X, y: Y, amount: BANK_LOAN_RAW_AMOUNT,
    } as WsMessage);

    expect(ws.sent).toHaveLength(1);
    const resp = ws.sent[0] as WsRespBuildingLoanRequest;
    expect(resp.type).toBe(WsMessageType.RESP_BUILDING_LOAN_REQUEST);
    expect(resp.result).toBe(result);

    // WS answer → the client half, which hands the raw ordinal to the borrow box.
    const clientCtx = { sendRequest: jest.fn(async () => resp) } as unknown as ClientHandlerContext;
    const ordinal = await clientRequestBankLoan(clientCtx, X, Y, BANK_LOAN_RAW_AMOUNT);

    expect(ordinal).toBe(result);
    expect(bankLoanOutcomeOf(ordinal)).toBe(OUTCOME_OF[result]);
  });

  it('the four ordinals produce four different messages on screen', () => {
    const messages = ORDINALS.map((o) => BANK_LOAN_VERDICTS[bankLoanOutcomeOf(o)].message);
    expect(new Set(messages).size).toBe(4);
  });

  it('the client sends the raw text and lets the gateway sanitise it', async () => {
    const sendRequest = jest.fn(async () => ({
      type: WsMessageType.RESP_BUILDING_LOAN_REQUEST, x: X, y: Y, result: 0,
    }));
    const clientCtx = { sendRequest } as unknown as ClientHandlerContext;

    await clientRequestBankLoan(clientCtx, X, Y, BANK_LOAN_RAW_AMOUNT);

    expect(sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_BUILDING_LOAN_REQUEST,
      x: X, y: Y, amount: BANK_LOAN_RAW_AMOUNT,
    });
  });

  it('the client answers the brqError sentinel while disconnected, and on a failed request', async () => {
    useGameStore.setState({ status: 'disconnected' });
    const sendRequest = jest.fn(async () => ({ result: 0 }));
    expect(await clientRequestBankLoan(
      { sendRequest } as unknown as ClientHandlerContext, X, Y, BANK_LOAN_RAW_AMOUNT,
    )).toBe(-1);
    expect(sendRequest).not.toHaveBeenCalled();

    useGameStore.setState({ status: 'connected' });
    const throwing = jest.fn(async () => { throw new Error('Request timeout'); });
    expect(await clientRequestBankLoan(
      { sendRequest: throwing } as unknown as ClientHandlerContext, X, Y, BANK_LOAN_RAW_AMOUNT,
    )).toBe(-1);
    expect(bankLoanOutcomeOf(-1)).toBe('error');
  });
});

describe('bank-loan-request scenario — the WS handler refuses an unsendable amount', () => {
  it.each(['', '   ', '-100', 'abc', '$0'])('never builds a frame for %p', async (amount) => {
    const { fake } = makeCtx(0);
    const session = {
      requestBankLoan: (x: number, y: number, a: string) => requestBankLoan(fake.ctx, x, y, a),
    };
    const ws = makeWsCtx(session);

    await handleBuildingLoanRequest(ws.ctx, {
      type: WsMessageType.REQ_BUILDING_LOAN_REQUEST,
      wsRequestId: 'req-2',
      x: X, y: Y, amount,
    } as WsMessage);

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect((ws.sent[0] as { code?: number }).code).toBe(ErrorCodes.ERROR_InvalidParameter);
    expect(fake.sent).toHaveLength(0);
  });

  it('answers an error response when the session throws', async () => {
    const session = {
      requestBankLoan: () => Promise.reject(new Error('No building found at (118, 226)')),
    };
    const ws = makeWsCtx(session);

    await handleBuildingLoanRequest(ws.ctx, {
      type: WsMessageType.REQ_BUILDING_LOAN_REQUEST,
      wsRequestId: 'req-3',
      x: X, y: Y, amount: BANK_LOAN_RAW_AMOUNT,
    } as WsMessage);

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect((ws.sent[0] as { code?: number }).code).toBe(ErrorCodes.ERROR_FacilityNotFound);
  });
});
