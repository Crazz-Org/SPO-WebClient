/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `bank-loan` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue and the wire: `RDOAskLoan` is a 2-argument
 * `function`, so every frame carries `"^"` and never `"*"`, and its arguments
 * are an integer security id followed by a `%` string amount.
 *
 * Part 2 drives the real `setBuildingProperty` once per ordinal against an
 * `RdoMock` loaded with the scenario, and asserts both the decoded outcome and
 * **the sentence the player sees** — which is the half of "asserting the
 * rendered verdict" this layer can prove.
 *
 * `expect` is deliberately NOT imported from `@jest/globals`: the global
 * augmentation that declares `toPassStrictRdoValidation`
 * (`src/server/__tests__/matchers/rdo-matchers.d.ts`) only reaches the global
 * `expect`, as in every sibling scenario test.
 */

import { describe, it } from '@jest/globals';
import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { setBuildingProperty, KNOWN_RDO_COMMANDS } from '@/server/session/building-property-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { BANK_LOAN_VERDICTS } from '@/shared/building-details';
import { RdoMock } from '../rdo-mock';
import {
  createBankLoanScenario,
  BANK_LOAN_BLOCK,
  BANK_LOAN_SECURITY_ID,
  BANK_LOAN_CASES,
} from './bank-loan-scenario';

const { rdo } = createBankLoanScenario();

const X = 118;
const Y = 226;

describe('bank-loan scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOAskLoan is a catalogued 2-argument function', () => {
    // StdBlocks/Banks.pas:46 —
    // `function RDOAskLoan( ClientId : integer; Amount : widestring ) : olevariant;`
    expect(RDO_MEMBERS.RDOAskLoan).toEqual({ kind: 'function', arity: 2 });
  });

  it('is not on the "*" list — every name there is emitted fire-and-forget', () => {
    // The whole reason a function must be kept off it: `"*"` on a function is
    // the arbitrary-write form, same as RDOVoteOf.
    expect(KNOWN_RDO_COMMANDS.has('RDOAskLoan')).toBe(false);
  });

  it('every request carries "^" and never "*"', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('every request carries the integer security id then the string amount', () => {
    for (const ex of rdo.exchanges) {
      const amount = BANK_LOAN_CASES.find(c => c.id === ex.id)!.amount;
      expect(ex.matchKeys?.argsPattern).toEqual([
        RdoValue.int(BANK_LOAN_SECURITY_ID).format(),
        RdoValue.string(amount).format(),
      ]);
      expect(ex.request).toContain(`#${BANK_LOAN_SECURITY_ID}`);
      expect(ex.request).toContain(`%${amount}`);
    }
  });

  it('matches each frame back to its own exchange', () => {
    // What the four different amounts buy: without them RdoMock could not tell
    // the four ordinals apart.
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('covers all four ordinals, including the client-only brqError', () => {
    // The server enum has three values (Kernel/Kernel.pas:1750), so `3` exists
    // nowhere but here and in the client's own fallback.
    expect(BANK_LOAN_CASES.map(c => c.ordinal)).toEqual(['0', '1', '2', '3']);
  });
});

describe('bank-loan scenario — the drive', () => {
  function makeCtx(mock: RdoMock): FakeSessionCtx {
    const fake = makeSessionCtx({
      sockets: ['map', 'construction'],
      fTycoonProxyId: BANK_LOAN_SECURITY_ID,
    });
    let next = 900001;
    fake.cacher.createObject.mockImplementation(async () => String(next++));
    fake.cacher.getPropertyList.mockImplementation(
      async (_id: string, names: string[]) =>
        names.map(n => (n === 'CurrBlock' ? BANK_LOAN_BLOCK : '')),
    );

    // The bridge from RdoMock to a real gateway call, as the sibling bank
    // scenario's own test builds it (bank-tv-live-reads-scenario.test.ts:112-116).
    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    return fake;
  }

  it.each(BANK_LOAN_CASES)(
    'ordinal $ordinal comes back as $outcome, with its own sentence',
    async ({ amount, ordinal, outcome }) => {
      const mock = new RdoMock();
      mock.addScenario(rdo);
      const fake = makeCtx(mock);

      const result = await setBuildingProperty(fake.ctx, X, Y, 'RDOAskLoan', amount);

      expect(result.success).toBe(true);
      expect(result.newValue).toBe(ordinal);
      expect(result.loanResult).toBe(outcome);
      // The sentence the player reads — the rendered half of the verdict.
      expect(BANK_LOAN_VERDICTS[result.loanResult!].message)
        .toBe(BANK_LOAN_VERDICTS[outcome].message);
    },
  );

  it('renders four distinct sentences across the four ordinals', async () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    const messages: string[] = [];

    for (const { amount } of BANK_LOAN_CASES) {
      const fake = makeCtx(mock);
      const result = await setBuildingProperty(fake.ctx, X, Y, 'RDOAskLoan', amount);
      messages.push(BANK_LOAN_VERDICTS[result.loanResult!].message);
    }

    expect(new Set(messages).size).toBe(4);
  });

  it('binds the call to CurrBlock and consumes every exchange', async () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);

    for (const { amount } of BANK_LOAN_CASES) {
      const fake = makeCtx(mock);
      await setBuildingProperty(fake.ctx, X, Y, 'RDOAskLoan', amount);
      expect(fake.sent[0].packet.targetId).toBe(BANK_LOAN_BLOCK);
      expect(fake.sent[0].packet.separator).toBe('"^"');
    }

    expect(mock.getConsumedIds()).toEqual(new Set(rdo.exchanges.map(e => e.id)));
  });

  it('sanitises the typed amount so it still matches its exchange', async () => {
    // `$1,000,000` and `1 000 000` are the same request as `1000000`
    // (BankGeneralSheet.pas:435-436) — the mock only matches the stripped form.
    const mock = new RdoMock();
    mock.addScenario(rdo);

    for (const typed of ['$1,000,000', '1 000 000']) {
      const fake = makeCtx(mock);
      const result = await setBuildingProperty(fake.ctx, X, Y, 'RDOAskLoan', typed);
      expect(result.loanResult).toBe('approved');
    }
  });
});
