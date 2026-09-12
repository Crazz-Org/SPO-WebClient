/**
 * `gate-map` — a factory whose `GateMap` disables the middle input gate.
 *
 * `listGates` (`building-details-handler.ts:1235-1259`) applies the Voyager
 * finger-strip rule to any non-warehouse facility: a gate is listed unless the
 * map has an explicit `'0'` at its position (`Voyager/SupplySheetForm.pas:382`,
 * `Voyager/ProdSheetForm.pas:324`). This scenario fixes the whole exchange set
 * for a factory with `GateMap = '101'` and three input names — two supplies come
 * back, and the middle gate is never `SetPath`-ed nor header-read.
 *
 * The trap: `gm-rdo-setpath-ore` answers the disabled middle gate's `SetPath`
 * exactly as the two enabled gates' do. A gateway that (re-)introduces the old
 * warehouse-only filter would open all three gates, and this exchange would
 * happily answer the one that must never be asked for — so a passing drive test
 * that also asserts the middle id is unconsumed (`RdoMock.getConsumedIds`,
 * OB-28-style: a mutation is proven by what was asked, not by what would have
 * answered) is the only thing that catches it.
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
export const GATE_MAP_TARGETS = {
  tempObject: '900001',
} as const;

/** The three input gates `GetInputNames` answers with. */
export const GATE_MAP_INPUTS = [
  { path: 'Inputs/Chemicals', name: 'Chemicals' },
  { path: 'Inputs/Ore', name: 'Ore' },
  { path: 'Inputs/Fuel', name: 'Fuel' },
] as const;

/** Bit 0 and bit 2 enabled, bit 1 (Ore) disabled. */
export const GATE_MAP_VALUE = '101';

/**
 * The supply header, same list and order as `Voyager/SupplySheetForm.pas:460`
 * and `building-details-handler.ts:998-1001` — restated here so the scenario's
 * `GetPropertyList` exchange can cite the exact query a gate's header read
 * builds, without importing a private module constant.
 */
export const SUPPLY_HEADER_NAMES = [
  'MetaFluid', 'FluidValue', 'LastCostPerc', 'minK', 'MaxPrice',
  'QPSorted', 'SortMode', 'cnxCount', 'Selected', 'ObjectId',
] as const;

function buildRdoExchanges(): RdoExchange[] {
  const { tempObject } = GATE_MAP_TARGETS;
  const [chemicals, ore, fuel] = GATE_MAP_INPUTS;

  const gateMapQuery = 'GateMap\t';
  const inputsWire = GATE_MAP_INPUTS.map(g => `${g.path}::\n${g.name}`).join('\r\n');
  const headerQuery = `${SUPPLY_HEADER_NAMES.join('\t')}\t`;

  return [
    {
      id: 'gm-rdo-gatemap',
      request: rdoCall('GetPropertyList', tempObject, RdoValue.string(gateMapQuery)).toFrame(),
      response: `A200 res="%${GATE_MAP_VALUE}"`,
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${gateMapQuery}"`],
      },
    },
    {
      id: 'gm-rdo-inputs',
      request: rdoCall('GetInputNames', tempObject, RdoValue.int(0), RdoValue.string('0')).toFrame(),
      response: `A200 res="%${inputsWire}"`,
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetInputNames',
        argsPattern: ['"#0"', '"%0"'],
      },
    },
    {
      id: 'gm-rdo-setpath-chemicals',
      request: rdoCall('SetPath', tempObject, RdoValue.string(chemicals.path)).toFrame(),
      response: 'A200 res="#-1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'SetPath',
        argsPattern: [`"%${chemicals.path}"`],
      },
    },
    {
      // The trap: the disabled middle gate answers just as readily as the two
      // enabled ones. Nothing about the response distinguishes it — only the
      // fact that a correct client never sends this request does.
      id: 'gm-rdo-setpath-ore',
      request: rdoCall('SetPath', tempObject, RdoValue.string(ore.path)).toFrame(),
      response: 'A200 res="#-1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'SetPath',
        argsPattern: [`"%${ore.path}"`],
      },
    },
    {
      id: 'gm-rdo-setpath-fuel',
      request: rdoCall('SetPath', tempObject, RdoValue.string(fuel.path)).toFrame(),
      response: 'A200 res="#-1"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'SetPath',
        argsPattern: [`"%${fuel.path}"`],
      },
    },
    {
      // The supply header read that follows a SetPath. cnxCount (index 7 of
      // SUPPLY_HEADER_NAMES) answers 0 so the gate opens with no connections.
      id: 'gm-rdo-header',
      request: rdoCall('GetPropertyList', tempObject, RdoValue.string(headerQuery)).toFrame(),
      response: 'A200 res="%CHEMICALS\t120\t\t\t\t\t\t0\t1\t40133600"',
      matchKeys: {
        verb: 'sel', targetId: tempObject, action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${headerQuery}"`],
      },
    },
  ];
}

export function createGateMapScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'gate-map',
    description: 'A factory with GateMap = \'101\' over three input names — two supplies listed, the middle gate never addressed',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
