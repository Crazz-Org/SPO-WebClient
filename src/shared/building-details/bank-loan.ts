/**
 * Bank loan request — the four answers, the amount sanitiser, and the copy.
 *
 * The bank block publishes `function RDOAskLoan( ClientId : integer; Amount :
 * widestring ) : olevariant` (`StdBlocks/Banks.pas:46`) and the reference
 * client's Request button sends the sanitised text of its borrow box
 * (`Voyager/BankGeneralSheet.pas:434-439`).
 *
 * The client enum is four-valued — `TBankRequestResult = (brqApproved,
 * brqRejected, brqNotEnoughFunds, brqError)` (`BankGeneralSheet.pas:22`) — but
 * the server enum is three-valued (`Kernel/Kernel.pas:1750`). Ordinal 3
 * (`brqError`) is a client-local sentinel Voyager synthesises whenever the proxy
 * is empty, the security id is empty, or anything throws (`:440`, `:442`,
 * `:444`), so mapping anything unexpected onto it is both faithful and defensive.
 *
 * The legacy captions themselves are NOT recoverable: `Literal9`–`Literal12`
 * resolve through a runtime `Literals.tln` table present in neither
 * `~/SPO-Original` nor `~/SPO-ASP`. The copy below is plain modern English,
 * `[UNKNOWN]` against the original wording, except where a survivor is named.
 */

/** The four outcomes of a loan request, one per `TBankRequestResult` ordinal. */
export type BankLoanOutcome = 'approved' | 'rejected' | 'notEnoughFunds' | 'error';

/**
 * Ordinals of `Voyager/BankGeneralSheet.pas:22`. 3 is the client-side sentinel,
 * and every value the server can never answer lands on it too.
 */
export function bankLoanOutcomeOf(ordinal: number): BankLoanOutcome {
  switch (ordinal) {
    case 0: return 'approved';
    case 1: return 'rejected';
    case 2: return 'notEnoughFunds';
    default: return 'error';
  }
}

/**
 * `KillSpaces(ReplaceChar(text, ',', ' '))` then the same for `'$'` —
 * `BankGeneralSheet.pas:435-436`. Currency punctuation and every space go; the
 * remainder is what the server's `StrToFloat` reads.
 */
export function sanitiseLoanAmount(text: string): string {
  return text.replace(/[$,]/g, '').replace(/\s+/g, '');
}

/**
 * True when the sanitised text is a positive decimal `StrToFloat` can read.
 * `Kernel/Kernel.pas:8911` rejects `Amount <= 0` outright, so zero is not a
 * request worth sending.
 */
export function isValidLoanAmount(sanitised: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(sanitised)) return false;
  return Number.parseFloat(sanitised) > 0;
}

/** One line of copy per outcome, plus its visual tone. Four distinct lines. */
export const BANK_LOAN_VERDICTS: Readonly<
  Record<BankLoanOutcome, { message: string; tone: 'success' | 'warning' | 'error' }>
> = {
  approved: { message: 'Loan approved.', tone: 'success' },
  // Nearest survivor: `StrTyconBank_5` (~/SPO-ASP/Five/0/language/eNewTycon.lng:21).
  // Everything failure-shaped on the server collapses here — critical trouble or
  // missing technology (`Banks.pas:166`) and any exception (`:169`).
  rejected: { message: 'The bank rejected your request.', tone: 'error' },
  // NOT a refusal: `Kernel/Kernel.pas:8829-8848` creates and credits the loan in
  // full before the budget test at `:8863`; `Amount := Owner.Budget` (`:8868`)
  // only shrinks what the bank owner is debited. Nearest survivor: the
  // design-time `lbBankResult.Caption` of `Voyager/BankGeneralSheetViewer.tln`.
  notEnoughFunds: {
    message: 'Granted, but the bank has not enough funds to pay it all now.',
    tone: 'warning',
  },
  error: { message: 'The request could not be completed.', tone: 'error' },
};
