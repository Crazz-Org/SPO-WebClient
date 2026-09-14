/**
 * `bank-loan-request` — the Request button of a bank's borrow box.
 *
 * `TBankBlock` publishes `function RDOAskLoan( ClientId : integer; Amount :
 * widestring ) : olevariant` (`StdBlocks/Banks.pas:46`), and the reference
 * client binds to `CurrBlock` and sends `(StrToInt(getSecurityId), Amount)` —
 * integer first, sanitised amount second (`Voyager/BankGeneralSheet.pas:434-439`).
 *
 * Two traps this fixture exists to catch:
 *
 *  - **The name collision.** `TTycoon` publishes an unrelated 1-argument
 *    `RDOAskLoan` (`Kernel/Kernel.pas:2522`) whose answers are Protocol codes,
 *    not `TBankRequestResult` ordinals. A 1-argument frame sent at the block
 *    would reach a member that is not there; the arity pinned here, and in the
 *    name-keyed catalogue, is the block form alone.
 *  - **The pointer cast.** The first argument is the InitClient proxy id
 *    (`Voyager/URLHandlers/ServerCnxHandler.pas:514-516`), which the server
 *    pointer-casts — `TMoneyDealer(ClientId)` (`Banks.pas:165`). The persistent
 *    `TTycoon.Id` would dereference nothing, with no error to show for it, so
 *    the argument is pinned here.
 *
 * The `{ result }` option picks which of the four ordinals the block answers, so
 * one factory covers approved / rejected / not-enough-funds / error.
 *
 * Every request is built by the real emitter (`rdoCall(...).toFrame()`), so the
 * separator and arity come from the catalogue, never from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The `CurrBlock` the bank answers with — the same block as `bank-tv-live-reads`. */
export const BANK_LOAN_BLOCK = '130200101';

/** The InitClient proxy id `RDOAskLoan` carries as its first argument. */
export const BANK_LOAN_TYCOON = 30440112;

/** What the player types into the borrow box. */
export const BANK_LOAN_RAW_AMOUNT = '$5,000,000';

/** The sanitised form the wire carries (`BankGeneralSheet.pas:435-436`). */
export const BANK_LOAN_AMOUNT = '5000000';

function buildRdoExchanges(result: number): RdoExchange[] {
  return [
    {
      id: 'bl-rdo-ask-loan',
      request: rdoCall(
        'RDOAskLoan', BANK_LOAN_BLOCK,
        RdoValue.int(BANK_LOAN_TYCOON), RdoValue.string(BANK_LOAN_AMOUNT),
      ).toFrame(),
      response: `A200 res="#${result}"`,
      matchKeys: {
        verb: 'sel', targetId: BANK_LOAN_BLOCK, action: 'call', member: 'RDOAskLoan',
        argsPattern: [
          RdoValue.int(BANK_LOAN_TYCOON).format(),
          RdoValue.string(BANK_LOAN_AMOUNT).format(),
        ],
      },
    },
  ];
}

export function createBankLoanRequestScenario(
  overrides?: Partial<ScenarioVariables>,
  { result = 0 }: { result?: number } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'bank-loan-request',
    description: 'RDOAskLoan(proxyId, amount) on the bank block, answering one TBankRequestResult ordinal',
    exchanges: buildRdoExchanges(result),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
