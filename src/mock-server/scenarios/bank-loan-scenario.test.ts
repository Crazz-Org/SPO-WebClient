/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `bank-loan` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue and the wire: `RDOAskLoan` is a 2-argument
 * `function` (`StdBlocks/Banks.pas:46`), so every frame carries `"^"` and two
 * arguments — the tycoon pointer as an integer, the amount as a string.
 *
 * Part 2 drives the real `askBankLoan` against an `RdoMock` loaded with the
 * scenario, asking for each of the four amounts in turn and asserting that each
 * of 0, 1, 2, 3 comes back as its own outcome. That is the card's criterion at
 * the protocol layer: four answers, four verdicts, not one generic failure.
 */

// `expect` stays global: the `toPassStrictRdoValidation` matcher is declared on the
// global `jest.Matchers` augmentation (src/server/__tests__/matchers/rdo-matchers.d.ts),
// which an `expect` imported from `@jest/globals` does not carry.
import { describe, it } from '@jest/globals';
import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { askBankLoan } from '@/server/session/bank-loan-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createBankLoanScenario,
  BANK_LOAN_BLOCK,
  BANK_LOAN_CLIENT_ID,
  BANK_LOAN_CASES,
} from './bank-loan-scenario';

const { rdo } = createBankLoanScenario();

const X = 924;
const Y = 820;

describe('bank-loan scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOAskLoan is a catalogued 2-argument function', () => {
    expect(RDO_MEMBERS.RDOAskLoan).toEqual({ kind: 'function', arity: 2 });
  });

  it('every frame carries the "^" read form, never the void "*"', () => {
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

  it('sends the security id the gateway actually holds', () => {
    // The scenario would match nothing if its client id drifted from the
    // `fTycoonProxyId` the handler reads off the session.
    expect(BANK_LOAN_CLIENT_ID).toBe(FAKE_CONTEXT_IDS.tycoonProxyId);
  });

  it('gives each ordinal its own amount, so no two frames are alike', () => {
    const amounts = BANK_LOAN_CASES.map(c => c.amount);
    expect(new Set(amounts).size).toBe(BANK_LOAN_CASES.length);
  });
});

describe('bank-loan scenario — the drive', () => {
  function makeCtx() {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([BANK_LOAN_BLOCK]);

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    return { fake, mock };
  }

  it('maps each of 0, 1, 2, 3 to its own outcome, and consumes all four exchanges', async () => {
    const { fake, mock } = makeCtx();

    for (const { amount, ordinal, verdict } of BANK_LOAN_CASES) {
      expect(await askBankLoan(fake.ctx, X, Y, amount)).toEqual({ verdict, result: ordinal });
    }

    expect(mock.getConsumedIds()).toEqual(new Set(BANK_LOAN_CASES.map(c => c.id)));
  });

  it('packs the tycoon pointer as an integer and the amount as a string', async () => {
    const { fake } = makeCtx();

    for (const { amount } of BANK_LOAN_CASES) {
      await askBankLoan(fake.ctx, X, Y, amount);
    }

    expect(fake.sent).toHaveLength(BANK_LOAN_CASES.length);
    fake.sent.forEach((s, i) => {
      expect((s.packet as RdoPacket).args).toEqual([
        RdoValue.int(BANK_LOAN_CLIENT_ID).format(),
        RdoValue.string(BANK_LOAN_CASES[i].amount).format(),
      ]);
    });
  });
});
