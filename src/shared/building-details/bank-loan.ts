/**
 * The bank block's loan request — decoding its answer and sanitising its amount.
 *
 * `TBankBlock.RDOAskLoan(ClientId: integer; Amount: widestring): olevariant`
 * (StdBlocks/Banks.pas:46) answers with an ordinal of
 * `TBankRequestResult = (brqApproved, brqRejected, brqNotEnoughFunds, brqError)`
 * (Voyager/BankGeneralSheet.pas:22) — four values the client has to tell apart,
 * which a boolean `success` cannot express.
 */

/** The four answers, in the ordinal order of `TBankRequestResult`. */
export type BankLoanOutcome = 'approved' | 'rejected' | 'notEnoughFunds' | 'error';

/**
 * Map the raw reply ordinal onto its outcome.
 *
 * Anything that is not `0`–`3` — empty, non-numeric, out of range — is `'error'`,
 * which is Voyager's own fallback: every failure path in `fbRequestClick` assigns
 * `brqError` (Voyager/BankGeneralSheet.pas:440,442,444).
 */
export function decodeBankLoanResult(raw: string): BankLoanOutcome {
  switch (raw.trim()) {
    case '0': return 'approved';
    case '1': return 'rejected';
    case '2': return 'notEnoughFunds';
    case '3': return 'error';
    default: return 'error';
  }
}

/**
 * Strip `$`, `,` and whitespace from a typed amount.
 *
 * The exact composition Voyager applies before sending, twice over:
 * `KillSpaces(ReplaceChar(eBorrow.Text, ',', ' '))` then the same for `'$'`
 * (Voyager/BankGeneralSheet.pas:435-436). The server calls `StrToFloat` on the
 * string it receives (StdBlocks/Banks.pas:165) and raises on anything else.
 */
export function sanitiseLoanAmount(text: string): string {
  return text.replace(/[$,\s]/g, '');
}

/**
 * The sentence the player reads, per outcome.
 *
 * The runtime captions Voyager showed (`Literal9`–`Literal12`,
 * BankGeneralSheet.pas:448,453,458,463) are NOT in the repository — `Literals.tln`
 * ships with the installer, not the source — so this wording is ours and nobody
 * should later try to "restore" a literal that does not exist here. The one
 * recoverable string is the design-time caption for `brqNotEnoughFunds`,
 * `Voyager/BankGeneralSheetViewer.tln:47` ("The bank has no enough founds to pay
 * now."), whose sense the `notEnoughFunds` message carries with the grammar fixed.
 *
 * `positive` for `approved` alone mirrors `clGreen` at :450 against `clMaroon` at
 * :455, :460 and :465.
 */
export const BANK_LOAN_VERDICTS: Record<BankLoanOutcome, { message: string; tone: 'positive' | 'negative' }> = {
  approved: { message: 'Loan approved — the funds have been transferred.', tone: 'positive' },
  rejected: { message: 'The bank rejected your loan request.', tone: 'negative' },
  notEnoughFunds: { message: 'The bank does not have enough funds to pay now.', tone: 'negative' },
  error: { message: 'The loan request could not be completed.', tone: 'negative' },
};
