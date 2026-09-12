/**
 * `bank-loan` — a visitor asks another tycoon's bank for a loan, and gets each of
 * the four possible answers.
 *
 * `TBankBlock` publishes `RDOAskLoan( ClientId : integer; Amount : widestring ) : olevariant`
 * (`StdBlocks/Banks.pas:46`), a 2-argument function, and answers an ordinal of
 * `TBankRequestResult` (`Kernel/Kernel.pas:1750` — brqApproved, brqRejected,
 * brqNotEnoughFunds). Voyager adds a fourth, client-side ordinal `brqError`
 * (`Voyager/BankGeneralSheet.pas:22`) for the call that never got an answer, and
 * the gateway reads an unknown ordinal the same way — so `'3'` belongs on the
 * wire here too.
 *
 * WHY EACH CASE CARRIES ITS OWN AMOUNT. `RdoMock.exactMatch` returns the first
 * exchange whose five keys match, whether or not it was already consumed
 * (`rdo-mock.ts:110-113`). Four exchanges with identical frames would therefore
 * all answer `#0`, and the scenario would prove nothing beyond "the first one
 * came back". Giving each ordinal its own amount puts the distinction on the
 * wire: the verdict follows the argument that was actually sent.
 *
 * Every request is built by the real emitter (`rdoCall(...).toFrame()`), so the
 * separator and arity come from the catalogue, never from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { BankLoanVerdict } from '@/shared/types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The `CurrBlock` the bank answers with. */
export const BANK_LOAN_BLOCK = '130200144';

/**
 * The security id on the wire — the model server's pointer to the tycoon
 * (`TMoneyDealer(ClientId)`, `StdBlocks/Banks.pas:165`). Equal to
 * `FAKE_CONTEXT_IDS.tycoonProxyId`, which the scenario test asserts: a scenario
 * whose id drifted from the one the gateway sends would match nothing.
 */
export const BANK_LOAN_CLIENT_ID = 30440112;

/** One amount per ordinal — see the header note on `exactMatch`. */
export const BANK_LOAN_CASES = [
  { id: 'bl-rdo-approved', amount: '1000000', ordinal: '0', verdict: 'approved' },
  { id: 'bl-rdo-rejected', amount: '2000000', ordinal: '1', verdict: 'rejected' },
  { id: 'bl-rdo-not-enough-funds', amount: '3000000', ordinal: '2', verdict: 'notEnoughFunds' },
  { id: 'bl-rdo-error', amount: '4000000', ordinal: '3', verdict: 'error' },
] as const satisfies ReadonlyArray<{ id: string; amount: string; ordinal: string; verdict: BankLoanVerdict }>;

function buildRdoExchanges(): RdoExchange[] {
  return BANK_LOAN_CASES.map(({ id, amount, ordinal }) => ({
    id,
    request: rdoCall(
      'RDOAskLoan', BANK_LOAN_BLOCK,
      RdoValue.int(BANK_LOAN_CLIENT_ID), RdoValue.string(amount),
    ).toFrame(),
    response: `A200 res="#${ordinal}"`,
    matchKeys: {
      verb: 'sel', targetId: BANK_LOAN_BLOCK, action: 'call', member: 'RDOAskLoan',
      argsPattern: [RdoValue.int(BANK_LOAN_CLIENT_ID).format(), RdoValue.string(amount).format()],
    },
  }));
}

export function createBankLoanScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'bank-loan',
    description: 'RDOAskLoan answering each of the four TBankRequestResult ordinals in turn',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
