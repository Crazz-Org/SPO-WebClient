/**
 * The bank sheet's loan request — an amount box and a Request button, offered to
 * VISITORS ONLY.
 *
 * That inversion is Voyager's, not a guess: `eBorrow` and `fbRequest` are
 * `Enabled := not fOwnsFacility` (Voyager/BankGeneralSheet.pas:156,160) — you
 * borrow from someone else's bank, so the owner never sees the control, while
 * the interest, term and budget sliders beside it are the owner's alone.
 *
 * The four answers each get their own line (`:446-468`). A generic failure toast
 * would tell a player "it didn't work" where the bank actually said "I have no
 * funds" or "no"; the reference client coloured the panel green or maroon and
 * named the case, and so does this.
 *
 * Entering the box or typing in it hides the previous verdict (`:472-480`) —
 * without that, the panel from the last request sits beside a new amount and
 * reads as its answer.
 */

import { useCallback, useState } from 'react';
import type { BankLoanVerdict } from '@/shared/types';
import { useClient } from '../../context';
import { parseCurrencyInput } from './property-utils';
import styles from './PropertyGroup.module.css';

/** One label per outcome — Literal9..Literal12 of BankGeneralSheet.pas:449-465. */
export const BANK_LOAN_LABELS: Record<BankLoanVerdict, string> = {
  approved: 'Loan approved',                             // Literal9,  clGreen  (:449-450)
  rejected: 'Loan rejected',                             // Literal10, clMaroon (:454-455)
  notEnoughFunds: 'The bank does not have enough funds', // Literal11, clMaroon (:459-460)
  error: 'The loan request failed',                      // Literal12, clMaroon (:464-465)
};

interface BankLoanRequestProps {
  /** The bank's own estimate, which Voyager prefills the box with (:161-162). */
  estLoan: string;
  buildingX: number;
  buildingY: number;
}

export function BankLoanRequest({ estLoan, buildingX, buildingY }: BankLoanRequestProps) {
  const client = useClient();
  const [amount, setAmount] = useState(estLoan);
  const [verdict, setVerdict] = useState<BankLoanVerdict | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** :472-480 — eBorrowEnter and eBorrowKeyDown both hide the panel. */
  const clearVerdict = useCallback(() => setVerdict(null), []);

  const handleRequest = useCallback(async () => {
    // :435-436 — Voyager strips '$' and ',' before packing; the gateway refuses
    // anything else, so a box that is not a plain amount never leaves here.
    const stripped = amount.replace(/[$,\s]/g, '');
    if (parseCurrencyInput(amount) === null) {
      setFormError('Amount must be a number like $1,000,000');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      setVerdict(await client.onRequestBankLoan(buildingX, buildingY, stripped));
    } finally {
      setBusy(false);
    }
  }, [amount, buildingX, buildingY, client]);

  return (
    <div className={styles.upgradeContainer}>
      <div className={styles.upgradeRow}>
        <span className={styles.upgradeLabel}>Amount</span>
        <input
          type="text"
          aria-label="Loan amount"
          className={styles.textInput}
          value={amount}
          onFocus={clearVerdict}
          onChange={(e) => {
            setAmount(e.target.value);
            clearVerdict();
          }}
        />
        <button
          type="button"
          className={styles.actionBtn}
          disabled={busy}
          onClick={() => { void handleRequest(); }}
        >
          Request
        </button>
      </div>
      {formError !== null && (
        <div className={styles.filmFormError} role="alert">{formError}</div>
      )}
      {verdict !== null && (
        <div
          role="status"
          data-testid="loan-verdict"
          data-verdict={verdict}
          className={verdict === 'approved' ? styles.loanVerdictOk : styles.loanVerdictBad}
        >
          {BANK_LOAN_LABELS[verdict]}
        </div>
      )}
    </div>
  );
}
