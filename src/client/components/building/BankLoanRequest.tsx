/**
 * BankLoanRequest — the borrow box of a bank you do not own (issue 571).
 *
 * Voyager's sheet offers an amount edit and a Request button to a VISITOR and
 * disables both for the owner — `fbRequest.Enabled := not fOwnsFacility` and
 * `eBorrow.Enabled := not fOwnsFacility` (Voyager/BankGeneralSheet.pas:156,:160),
 * the exact opposite polarity of every other control on that sheet (:154-159).
 * The gate itself lives in PropertyGroup; this component is the control.
 *
 * The verdict is rendered inline, one distinct line per TBankRequestResult
 * ordinal (:446-467) — no toast. Touching the amount hides it again, which is
 * what `eBorrowEnter` / `eBorrowKeyDown` do (:472-480).
 */

import { useState } from 'react';
import {
  bankLoanOutcomeOf,
  sanitiseLoanAmount,
  isValidLoanAmount,
  BANK_LOAN_VERDICTS,
  type BankLoanOutcome,
} from '@/shared/building-details';
import { useClient } from '../../context';
import styles from './PropertyGroup.module.css';

export interface BankLoanRequestProps {
  buildingX: number;
  buildingY: number;
  /** Prefill — Voyager fills the box with the Estimated Loan for a visitor (:161-162). */
  estimatedLoan: string;
}

const TONE_CLASS: Record<'success' | 'warning' | 'error', string> = {
  success: styles.loanVerdictSuccess,
  warning: styles.loanVerdictWarning,
  error: styles.loanVerdictError,
};

export function BankLoanRequest({ buildingX, buildingY, estimatedLoan }: BankLoanRequestProps) {
  const client = useClient();
  const [amount, setAmount] = useState(estimatedLoan);
  const [verdict, setVerdict] = useState<BankLoanOutcome | null>(null);
  const [inFlight, setInFlight] = useState(false);

  const canRequest = isValidLoanAmount(sanitiseLoanAmount(amount));

  async function handleRequest(): Promise<void> {
    setInFlight(true);
    try {
      const ordinal = await client.onRequestBankLoan(buildingX, buildingY, amount);
      setVerdict(bankLoanOutcomeOf(ordinal));
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div className={styles.loanRequest}>
      <div className={styles.loanRequestRow}>
        <label className={styles.loanRequestLabel} htmlFor="bank-loan-amount">Amount</label>
        <input
          id="bank-loan-amount"
          type="text"
          inputMode="decimal"
          aria-label="Amount"
          className={styles.loanRequestInput}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setVerdict(null);
          }}
        />
        <button
          type="button"
          className={styles.actionBtn}
          disabled={inFlight || !canRequest}
          onClick={() => { void handleRequest(); }}
        >
          Request
        </button>
      </div>
      {verdict !== null && (
        <div role="status" className={`${styles.loanVerdict} ${TONE_CLASS[BANK_LOAN_VERDICTS[verdict].tone]}`}>
          {BANK_LOAN_VERDICTS[verdict].message}
        </div>
      )}
    </div>
  );
}
