/**
 * `bank-tv-live-reads` — the six inspector values the object cache never holds.
 *
 * `TBankBlock.StoreToCache` (`StdBlocks/Banks.pas:188-206`) writes the loan list
 * alone — `LoanCount`, `Debtor{i}`, `Interest{i}`, `Amount{i}`, `Slice{i}`,
 * `Term{i}` — and the bank's own budget write is commented out at `:193`.
 * `TBroadcaster.StoreToCache` (`StdBlocks/Broadcast.pas:431-453`) writes antenna
 * data alone. The cacher answers an empty string for a name it does not hold, so
 * Estimated Loan, Interest, Term, Budget, Hours On Air and Commercials rendered
 * blank for every bank and every TV station.
 *
 * The reference client never asked the cache for them. It binds to `CurrBlock`
 * and reads live: `RDOEstimateLoan(getTycoonId)` then `BudgetPerc` / `Interest` /
 * `Term` (`Voyager/BankGeneralSheet.pas:258-273`), and `HoursOnAir` /
 * `Commercials` (`Voyager/TVGeneralSheet.pas:269-275`).
 *
 * Two traps this fixture encodes:
 *
 *  - `RDOEstimateLoan` answers a **FormatMoney string** (`$5,000,000`;
 *    `Utils/Misc/MathUtils.pas:87-109`), not a number. The gateway strips the
 *    currency punctuation, so the exchange must answer the punctuated form or a
 *    gateway that forgot to strip it would still pass.
 *  - Its single argument is the **InitClient proxy id**
 *    (`Voyager/URLHandlers/ServerCnxHandler.pas:514-516`), which the server
 *    pointer-casts — `TMoneyDealer(ClientId)` (`Banks.pas:149`). The persistent
 *    `TTycoon.Id` would dereference nothing, with no error to show for it, so the
 *    argument is pinned here.
 *
 * Every request is built by the real emitter (`rdoCall(...)` / `rdoGet(...)`), so
 * the separator and arity come from the catalogue, never from this file.
 */

import { rdoCall, rdoGet } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The `CurrBlock` the bank answers with. */
export const BANK_LIVE_READS_BLOCK = '130200101';

/** The `CurrBlock` the TV station answers with. */
export const TV_LIVE_READS_BLOCK = '130300201';

/** The InitClient proxy id `RDOEstimateLoan` carries as its single argument. */
export const BANK_LIVE_READS_TYCOON = 30440112;

/** What the bank block answers. `estLoan` is FormatMoney output, punctuation included. */
export const BANK_LIVE_READS_ANSWERS = {
  estLoan: '$5,000,000',
  budgetPerc: '75',
  interest: '12',
  term: '5',
} as const;

/**
 * What the TV block answers. `18` sits inside the 0..24 slider Voyager draws
 * (`TVGeneralSheet.dfm` peHoursOnAir); the old cache fixture's `80` did not.
 */
export const TV_LIVE_READS_ANSWERS = { hoursOnAir: '18', commercials: '35' } as const;

function buildRdoExchanges(): RdoExchange[] {
  const tycoon = RdoValue.int(BANK_LIVE_READS_TYCOON).format();

  return [
    {
      id: 'btl-rdo-estloan',
      request: rdoCall(
        'RDOEstimateLoan', BANK_LIVE_READS_BLOCK, RdoValue.int(BANK_LIVE_READS_TYCOON),
      ).toFrame(),
      response: `A200 res="%${BANK_LIVE_READS_ANSWERS.estLoan}"`,
      matchKeys: {
        verb: 'sel', targetId: BANK_LIVE_READS_BLOCK, action: 'call', member: 'RDOEstimateLoan',
        argsPattern: [tycoon],
      },
    },
    {
      id: 'btl-rdo-budgetperc',
      request: rdoGet('BudgetPerc', BANK_LIVE_READS_BLOCK).toFrame(),
      response: `A200 BudgetPerc="#${BANK_LIVE_READS_ANSWERS.budgetPerc}"`,
      matchKeys: {
        verb: 'sel', targetId: BANK_LIVE_READS_BLOCK, action: 'get', member: 'BudgetPerc',
      },
    },
    {
      id: 'btl-rdo-interest',
      request: rdoGet('Interest', BANK_LIVE_READS_BLOCK).toFrame(),
      response: `A200 Interest="#${BANK_LIVE_READS_ANSWERS.interest}"`,
      matchKeys: {
        verb: 'sel', targetId: BANK_LIVE_READS_BLOCK, action: 'get', member: 'Interest',
      },
    },
    {
      id: 'btl-rdo-term',
      request: rdoGet('Term', BANK_LIVE_READS_BLOCK).toFrame(),
      response: `A200 Term="#${BANK_LIVE_READS_ANSWERS.term}"`,
      matchKeys: {
        verb: 'sel', targetId: BANK_LIVE_READS_BLOCK, action: 'get', member: 'Term',
      },
    },
    {
      id: 'btl-rdo-hoursonair',
      request: rdoGet('HoursOnAir', TV_LIVE_READS_BLOCK).toFrame(),
      response: `A200 HoursOnAir="#${TV_LIVE_READS_ANSWERS.hoursOnAir}"`,
      matchKeys: {
        verb: 'sel', targetId: TV_LIVE_READS_BLOCK, action: 'get', member: 'HoursOnAir',
      },
    },
    {
      // Two m on the wire — the published property (StdBlocks/Broadcast.pas:53).
      // The inspector stores the answer under the one-m key `Comercials`
      // (Voyager/TVGeneralSheet.pas:15).
      id: 'btl-rdo-commercials',
      request: rdoGet('Commercials', TV_LIVE_READS_BLOCK).toFrame(),
      response: `A200 Commercials="#${TV_LIVE_READS_ANSWERS.commercials}"`,
      matchKeys: {
        verb: 'sel', targetId: TV_LIVE_READS_BLOCK, action: 'get', member: 'Commercials',
      },
    },
  ];
}

export function createBankTvLiveReadsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'bank-tv-live-reads',
    description: 'The six bank and TV inspector values read live off CurrBlock, not from the cache',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
