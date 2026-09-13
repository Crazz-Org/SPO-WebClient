/**
 * `bank-loan` — the bank block's loan request, and its four answers.
 *
 * `TBankBlock.RDOAskLoan( ClientId : integer; Amount : widestring ) : olevariant`
 * (`StdBlocks/Banks.pas:46`) is the one member the inspector's write path calls
 * for its RESULT rather than its effect. It answers an ordinal of
 * `TBankRequestResult = (brqApproved, brqRejected, brqNotEnoughFunds, brqError)`
 * (`Voyager/BankGeneralSheet.pas:22`), and the player has to be able to tell the
 * four apart — a rejection and a bank with no cash are both a perfectly
 * successful round-trip.
 *
 * Three things this fixture pins that nothing else can:
 *
 *  - It is a **function**, so the frame carries `"^"`. `"*"` on a function is an
 *    arbitrary memory write with no error to show for it, and the separator here
 *    comes from the catalogue via `rdoCall` — never from this file.
 *  - Its first argument is the **security id**, i.e. the InitClient proxy id
 *    (`Voyager/URLHandlers/ServerCnxHandler.pas:2524-2527`, `:514-516`), which
 *    the server pointer-casts — `TMoneyDealer(ClientId)` (`Banks.pas:165`). The
 *    persistent `TTycoon.Id` would dereference nothing. The second travels as a
 *    `%` **string** with `$` and `,` already stripped
 *    (`BankGeneralSheet.pas:435-436`), because the server `StrToFloat`s it.
 *  - The fourth ordinal, `3` (`brqError`), can only ever be manufactured
 *    **client-side**: the server enum has three values (`Kernel/Kernel.pas:1750`)
 *    and `RDOAskLoan` folds every failure, exceptions included, into
 *    `brqRejected` (`Banks.pas:166,169`). This fixture is therefore the only
 *    place `3` can be exercised at all.
 *
 * The four exchanges use four DIFFERENT amounts on purpose: `RdoMock`'s match
 * hierarchy is argument-sensitive at its first tier and falls through to
 * `action+member` when arguments differ, so one amount per ordinal is what makes
 * the four distinguishable.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';
import type { BankLoanOutcome } from '@/shared/building-details';

/** The `CurrBlock` the bank answers with, and the id the call binds to. */
export const BANK_LOAN_BLOCK = '130200301';

/**
 * The security id the request carries as its first argument — the InitClient
 * proxy id, not the persistent tycoon id.
 */
export const BANK_LOAN_SECURITY_ID = 30440112;

/**
 * One amount per ordinal, already sanitised — this is the form that reaches the
 * wire, whatever the player typed.
 */
export const BANK_LOAN_CASES: ReadonlyArray<{
  id: string;
  amount: string;
  ordinal: string;
  outcome: BankLoanOutcome;
}> = [
  { id: 'bkl-rdo-approved', amount: '1000000', ordinal: '0', outcome: 'approved' },
  { id: 'bkl-rdo-rejected', amount: '2000000', ordinal: '1', outcome: 'rejected' },
  { id: 'bkl-rdo-notenoughfunds', amount: '3000000', ordinal: '2', outcome: 'notEnoughFunds' },
  { id: 'bkl-rdo-error', amount: '4000000', ordinal: '3', outcome: 'error' },
];

function buildRdoExchanges(): RdoExchange[] {
  const secId = RdoValue.int(BANK_LOAN_SECURITY_ID).format();

  return BANK_LOAN_CASES.map(({ id, amount, ordinal }) => ({
    id,
    request: rdoCall(
      'RDOAskLoan', BANK_LOAN_BLOCK,
      RdoValue.int(BANK_LOAN_SECURITY_ID), RdoValue.string(amount),
    ).toFrame(),
    response: `A200 res="#${ordinal}"`,
    matchKeys: {
      verb: 'sel' as const, targetId: BANK_LOAN_BLOCK, action: 'call' as const,
      member: 'RDOAskLoan',
      argsPattern: [secId, RdoValue.string(amount).format()],
    },
  }));
}

export function createBankLoanScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'bank-loan',
    description: 'RDOAskLoan on the bank block, answering each of the four TBankRequestResult ordinals',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
