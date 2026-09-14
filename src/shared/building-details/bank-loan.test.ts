/**
 * The four ordinals, the sanitiser, and the copy — the L0 half of issue 571.
 *
 * `jest.config.js` holds `./src/shared/building-details/: { functions: 100 }`,
 * so every export here is executed at least once by design, not by accident.
 */

import {
  bankLoanOutcomeOf,
  sanitiseLoanAmount,
  isValidLoanAmount,
  BANK_LOAN_VERDICTS,
  type BankLoanOutcome,
} from './bank-loan';

describe('bankLoanOutcomeOf — the four TBankRequestResult ordinals', () => {
  it('maps each of 0,1,2,3 to its own outcome (BankGeneralSheet.pas:22)', () => {
    expect(bankLoanOutcomeOf(0)).toBe('approved');
    expect(bankLoanOutcomeOf(1)).toBe('rejected');
    expect(bankLoanOutcomeOf(2)).toBe('notEnoughFunds');
    expect(bankLoanOutcomeOf(3)).toBe('error');
  });

  it('the four outcomes are pairwise distinct', () => {
    const outcomes = [0, 1, 2, 3].map(bankLoanOutcomeOf);
    expect(new Set(outcomes).size).toBe(4);
  });

  it('anything the server can never answer falls on the brqError sentinel', () => {
    // -1 is the gateway's "no frame could be sent at all"; the rest are shapes
    // no TBankRequestResult has.
    for (const ordinal of [-1, 4, 99, 1.5, Number.NaN]) {
      expect(bankLoanOutcomeOf(ordinal)).toBe('error');
    }
  });
});

describe('sanitiseLoanAmount — KillSpaces(ReplaceChar(...)) (BankGeneralSheet.pas:435-436)', () => {
  it('strips the currency punctuation the player types', () => {
    expect(sanitiseLoanAmount('$5,000,000')).toBe('5000000');
  });

  it('strips every space, wherever it sits', () => {
    expect(sanitiseLoanAmount('  1 000 000 ')).toBe('1000000');
  });

  it('leaves a clean number untouched, decimal point included', () => {
    expect(sanitiseLoanAmount('1234.56')).toBe('1234.56');
  });

  it('removes nothing else — StrToFloat on the server reads the remainder', () => {
    expect(sanitiseLoanAmount('12a')).toBe('12a');
  });

  it('answers the empty string for an empty box', () => {
    expect(sanitiseLoanAmount('')).toBe('');
  });
});

describe('isValidLoanAmount — a positive decimal StrToFloat can read', () => {
  it('accepts a positive integer and a positive decimal', () => {
    expect(isValidLoanAmount('5000000')).toBe(true);
    expect(isValidLoanAmount('0.5')).toBe(true);
  });

  it('rejects zero — Kernel/Kernel.pas:8911 refuses Amount <= 0', () => {
    expect(isValidLoanAmount('0')).toBe(false);
    expect(isValidLoanAmount('0.0')).toBe(false);
  });

  it('rejects an empty box, a sign, and anything non-numeric', () => {
    for (const text of ['', '-100', '+100', '1e6', 'abc', '1,000']) {
      expect(isValidLoanAmount(text)).toBe(false);
    }
  });
});

describe('BANK_LOAN_VERDICTS — four messages, distinguished on screen', () => {
  const outcomes: BankLoanOutcome[] = ['approved', 'rejected', 'notEnoughFunds', 'error'];

  it('carries one entry per outcome', () => {
    for (const outcome of outcomes) {
      expect(BANK_LOAN_VERDICTS[outcome].message).not.toBe('');
    }
  });

  it('the four messages are pairwise distinct — not one generic failure line', () => {
    const messages = outcomes.map((o) => BANK_LOAN_VERDICTS[o].message);
    expect(new Set(messages).size).toBe(4);
  });

  it('approval reads as success and the "not enough funds" grant as a warning, not a refusal', () => {
    expect(BANK_LOAN_VERDICTS.approved.tone).toBe('success');
    expect(BANK_LOAN_VERDICTS.notEnoughFunds.tone).toBe('warning');
    expect(BANK_LOAN_VERDICTS.rejected.tone).toBe('error');
    expect(BANK_LOAN_VERDICTS.error.tone).toBe('error');
  });
});
