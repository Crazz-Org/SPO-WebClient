/**
 * `service-figures` — the live Offer / Demand pair of one service, off the block.
 *
 * `TServiceBlock` publishes two 1-argument functions,
 * `RDOGetDemand(index) : OleVariant` and `RDOGetSupply(index) : OleVariant`
 * (`StdBlocks/ServiceBlock.pas:309-310`), and the reference client reads them
 * for the selected finger alone on its refresh timer
 * (`Voyager/SrvGeneralSheetForm.pas:411-413`).
 *
 * The trap: the answers here deliberately DISAGREE with the cached
 * `srvSupplies0` / `srvDemands0` columns `building-details-scenario.ts:193-194`
 * serves (`'5'` and `'12'`). A client that still drew the cached columns for
 * the selected card would render 5 / 12 while the block is answering 64 / 37,
 * and nothing but that disagreement can catch it — both sources are plausible
 * numbers in the same range.
 *
 * Every request is built by the real emitter (`rdoCall(...).toFrame()`), so the
 * separator and arity come from the catalogue, never from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The `CurrBlock` the service building answers with. */
export const SERVICE_FIGURES_BLOCK = '128629376';

/** The selected service — the single argument both members carry. */
export const SERVICE_FIGURES_INDEX = 1;

/** What the block answers: `RDOGetDemand` feeds Local Demand, `RDOGetSupply` feeds Supply. */
export const SERVICE_FIGURES_ANSWERS = { demand: '37', supply: '64' } as const;

/** The cached columns of `building-details-scenario.ts:193-194` — deliberately different. */
export const SERVICE_FIGURES_CACHED = { srvSupplies: '5', srvDemands: '12' } as const;

function buildRdoExchanges(): RdoExchange[] {
  const index = RdoValue.int(SERVICE_FIGURES_INDEX).format();

  return [
    {
      id: 'sf-rdo-demand',
      request: rdoCall(
        'RDOGetDemand', SERVICE_FIGURES_BLOCK, RdoValue.int(SERVICE_FIGURES_INDEX),
      ).toFrame(),
      response: `A200 res="#${SERVICE_FIGURES_ANSWERS.demand}"`,
      matchKeys: {
        verb: 'sel', targetId: SERVICE_FIGURES_BLOCK, action: 'call', member: 'RDOGetDemand',
        argsPattern: [index],
      },
    },
    {
      id: 'sf-rdo-supply',
      request: rdoCall(
        'RDOGetSupply', SERVICE_FIGURES_BLOCK, RdoValue.int(SERVICE_FIGURES_INDEX),
      ).toFrame(),
      response: `A200 res="#${SERVICE_FIGURES_ANSWERS.supply}"`,
      matchKeys: {
        verb: 'sel', targetId: SERVICE_FIGURES_BLOCK, action: 'call', member: 'RDOGetSupply',
        argsPattern: [index],
      },
    },
  ];
}

export function createServiceFiguresScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'service-figures',
    description: 'RDOGetDemand / RDOGetSupply for one selected service, answering against the cached columns',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
