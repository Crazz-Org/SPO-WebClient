/**
 * `product-owner` — a factory whose products gate reads a customer's owning
 * tycoon off the eighth requested connection column.
 *
 * The cache writes `cnxCreatedBy` for an output exactly as it does for an
 * input (`Kernel/KernelCache.pas:707-712`, the `TOutput` branch), but the
 * reference client's product sheet never asked for it
 * (`Voyager/ProdSheetForm.pas:407-413` requests only the seven names below).
 * `building-details-handler.ts` now appends `cnxCreatedBy` as an eighth,
 * additive name so the seven Voyager positions still decode unchanged
 * (issue 581).
 *
 * `po-rdo-cnx0`'s `argsPattern` carries the exact query string, `cnxCreatedBy0`
 * included — a gateway that regresses to the seven-name query matches nothing
 * here, and the drive test fails.
 *
 * Every request is built by the real emitter (`rdoCall(...).toFrame()`), so the
 * separator and arity come from the catalogue, never from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The temp object id the handler test harness hands out first. */
export const PRODUCT_OWNER_TARGETS = {
  tempObject: '900002',
} as const;

/** The single output gate `GetOutputNames` answers with. */
export const PRODUCT_OWNER_GATE = { path: 'Outputs/Chemicals', name: 'Chemicals' } as const;

/**
 * Same list and order as `Voyager/ProdSheetForm.pas:387` and
 * `building-details-handler.ts` `PRODUCT_GATES.headerProps`.
 */
export const PRODUCT_HEADER_NAMES = [
  'MetaFluid', 'LastFluid', 'FluidQuality', 'PricePc',
  'AvgPrice', 'MarketPrice', 'cnxCount',
] as const;

/**
 * The seven Voyager names (`ProdSheetForm.pas:407-413`), plus the eighth,
 * additive `cnxCreatedBy` the server also writes for an output
 * (`Kernel/KernelCache.pas:707-712`).
 */
export const PRODUCT_CNX_NAMES = [
  'cnxFacilityName', 'cnxCompanyName', 'LastValueCnxInfo',
  'ConnectedCnxInfo', 'tCostCnxInfo', 'cnxXPos', 'cnxYPos', 'cnxCreatedBy',
] as const;

export const PRODUCT_OWNER = 'SPO_test3';

export const PRODUCT_OWNER_ROW = {
  facilityName: 'Drug Store 10',
  companyName: 'Yellow Inc.',
  lastValue: '120',
  connected: '1',
  cost: '$15',
  x: '477',
  y: '392',
} as const;

function buildRdoExchanges(): RdoExchange[] {
  const { tempObject } = PRODUCT_OWNER_TARGETS;
  const { path, name } = PRODUCT_OWNER_GATE;

  const gateMapQuery = 'GateMap\t';
  const headerQuery = `${PRODUCT_HEADER_NAMES.join('\t')}\t`;
  const cnxQuery = `${PRODUCT_CNX_NAMES.map(n => `${n}0`).join('\t')}\t`;

  return [
    {
      id: 'po-rdo-gatemap',
      request: rdoCall('GetPropertyList', tempObject, RdoValue.string(gateMapQuery)).toFrame(),
      response: 'A200 res="%1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${gateMapQuery}"`],
      },
    },
    {
      id: 'po-rdo-outputs',
      request: rdoCall('GetOutputNames', tempObject, RdoValue.int(0), RdoValue.string('0')).toFrame(),
      response: `A200 res="%${path}::\n${name}"`,
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetOutputNames',
        argsPattern: ['"#0"', '"%0"'],
      },
    },
    {
      id: 'po-rdo-setpath',
      request: rdoCall('SetPath', tempObject, RdoValue.string(path)).toFrame(),
      response: 'A200 res="#-1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'SetPath',
        argsPattern: [`"%${path}"`],
      },
    },
    {
      id: 'po-rdo-header',
      request: rdoCall('GetPropertyList', tempObject, RdoValue.string(headerQuery)).toFrame(),
      response: 'A200 res="%CHEMICALS\t485\t82\t110\t105\t320.50\t1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${headerQuery}"`],
      },
    },
    {
      // The trap: the query must include cnxCreatedBy0 — a gateway that still
      // asks for only the seven Voyager names matches nothing here.
      id: 'po-rdo-cnx0',
      request: rdoCall(
        'GetSubObjectProps', tempObject, RdoValue.int(0), RdoValue.string(cnxQuery),
      ).toFrame(),
      response:
        `A200 res="%${PRODUCT_OWNER_ROW.facilityName}\t${PRODUCT_OWNER_ROW.companyName}\t` +
        `${PRODUCT_OWNER_ROW.lastValue}\t${PRODUCT_OWNER_ROW.connected}\t` +
        `${PRODUCT_OWNER_ROW.cost}\t${PRODUCT_OWNER_ROW.x}\t${PRODUCT_OWNER_ROW.y}\t` +
        `${PRODUCT_OWNER}\t"`,
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetSubObjectProps',
        argsPattern: ['"#0"', `"%${cnxQuery}"`],
      },
    },
  ];
}

export function createProductOwnerScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'product-owner',
    description: 'A factory with one output gate whose customer row carries the owning tycoon in an eighth, appended column',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
