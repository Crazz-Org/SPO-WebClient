import {
  decodeBankLoanResult,
  sanitiseLoanAmount,
  BANK_LOAN_VERDICTS,
  type BankLoanOutcome,
} from './bank-loan';

describe('decodeBankLoanResult', () => {
  it('maps the four TBankRequestResult ordinals to their outcomes', () => {
    expect(decodeBankLoanResult('0')).toBe('approved');
    expect(decodeBankLoanResult('1')).toBe('rejected');
    expect(decodeBankLoanResult('2')).toBe('notEnoughFunds');
    expect(decodeBankLoanResult('3')).toBe('error');
  });

  it('tolerates surrounding whitespace', () => {
    expect(decodeBankLoanResult(' 0 ')).toBe('approved');
    expect(decodeBankLoanResult('\t2\n')).toBe('notEnoughFunds');
  });

  it('falls back to error for empty, out-of-range and non-numeric replies', () => {
    expect(decodeBankLoanResult('')).toBe('error');
    expect(decodeBankLoanResult('4')).toBe('error');
    expect(decodeBankLoanResult('-1')).toBe('error');
    expect(decodeBankLoanResult('x')).toBe('error');
    expect(decodeBankLoanResult('0.0')).toBe('error');
  });
});

describe('sanitiseLoanAmount', () => {
  it('strips dollar signs, thousands commas and spaces', () => {
    expect(sanitiseLoanAmount('$12,500,000')).toBe('12500000');
    expect(sanitiseLoanAmount('12 500 000')).toBe('12500000');
    expect(sanitiseLoanAmount('  $ 1,000 ')).toBe('1000');
  });

  it('leaves a bare number and a decimal point untouched', () => {
    expect(sanitiseLoanAmount('1000000')).toBe('1000000');
    expect(sanitiseLoanAmount('1000.50')).toBe('1000.50');
  });

  it('returns an empty string for an empty or punctuation-only input', () => {
    expect(sanitiseLoanAmount('')).toBe('');
    expect(sanitiseLoanAmount(' $, ')).toBe('');
  });
});

describe('BANK_LOAN_VERDICTS', () => {
  const outcomes: BankLoanOutcome[] = ['approved', 'rejected', 'notEnoughFunds', 'error'];

  it('carries four distinct sentences — not one generic failure message', () => {
    const messages = outcomes.map(o => BANK_LOAN_VERDICTS[o].message);
    expect(new Set(messages).size).toBe(4);
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(0);
    }
  });

  it('tones approved positive and every failure negative', () => {
    expect(BANK_LOAN_VERDICTS.approved.tone).toBe('positive');
    expect(BANK_LOAN_VERDICTS.rejected.tone).toBe('negative');
    expect(BANK_LOAN_VERDICTS.notEnoughFunds.tone).toBe('negative');
    expect(BANK_LOAN_VERDICTS.error.tone).toBe('negative');
  });

  it('has an entry for every outcome decodeBankLoanResult can return', () => {
    for (const raw of ['0', '1', '2', '3', '', 'x']) {
      expect(BANK_LOAN_VERDICTS[decodeBankLoanResult(raw)]).toBeDefined();
    }
  });
});
