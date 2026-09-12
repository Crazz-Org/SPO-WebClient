/**
 * Automatic buying on an input gate — the two frames the checkbox can emit, and
 * the ten header names the gate is read with.
 *
 * `RDOSelSelected` is declared on the INPUT GATE, not on the block: `published
 * procedure RDOSelSelected(value : WordBool)` on `TPullInput`
 * (`Kernel/Kernel.pas:1623`, body `:7886-7895`). The reference client binds it to
 * the `ObjectId` it read off the GATE header — `fHandler.fObjectId :=
 * Info.IntValue[tidObjectId]` (`Voyager/SupplySheetForm.pas:1001`), forked with
 * that id (`:1100`), `Proxy.BindTo(ObjId); Proxy.RDOSelSelected(Selec)`
 * (`:697-699`) — and that id is `integer(Obj)` of the gate
 * (`Cache/CacheAgent.pas:89`). A frame addressed to the facility's block reaches
 * a member the block does not publish, and nothing in a reply could say so: a
 * `procedure` answers nothing (`OB-28`), so the **responses are empty on
 * purpose** and the frame itself is the only evidence.
 *
 * The four ids below are deliberately all different, so a handler that picked
 * the block, the facility object or the cacher handle fails here rather than
 * matching by accident.
 *
 * Every request is built by the real emitter (`rdoCall`), so the separator and
 * the arity come from the catalogue rather than from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/**
 * The ids and paths one auto-buy write threads through.
 *
 * `gateObjectId` is the only legal target of `RDOSelSelected`; `currBlock` and
 * `objectId` are the two the block-bound tables would have chosen. The gate path
 * carries the `%.8x` gate index in front of the fluid name
 * (`Format('%.8x', [MetaInput.Index]) + '.' + MetaInput.Name + '.five\'`,
 * `Kernel/KernelCache.pas:491`).
 */
export const AUTO_BUY_TARGETS = {
  currBlock: '40133497',
  objectId: '40133512',
  gateObjectId: '40134021',
  tempObject: 'cacher-obj-554',
  fluidId: 'Cotton',
  facilityPath: 'Worlds\\Helartia\\Towns\\Aldebaran.five\\Facilities\\706.436.five\\',
} as const;

/** The gate's own cache folder, the one `SetPath` must land on. */
export const AUTO_BUY_GATE_PATH =
  `${AUTO_BUY_TARGETS.facilityPath}Inputs\\00000001.${AUTO_BUY_TARGETS.fluidId}.five\\`;

/**
 * The gate header, in the reference client's own order: `[tidFluidId,
 * tidFluidValue, tidLastCost, tidKmin, tidPmax, tidQPSorted, tidSortMode,
 * tidCnxCount, tidSelected, tidObjectId]`
 * (`Voyager/SupplySheetForm.pas:460`). `Selected` is the ninth — the auto-buy
 * flag `TPullInput.StoreToCache` writes (`Kernel/Kernel.pas:7815`) — and
 * `ObjectId` the tenth.
 */
export const SUPPLY_HEADER_NAMES: readonly string[] = [
  'MetaFluid', 'FluidValue', 'LastCostPerc', 'minK', 'MaxPrice',
  'QPSorted', 'SortMode', 'cnxCount', 'Selected', 'ObjectId',
];

/** The two arguments the checkbox can send: WordBool true and false. */
const AUTO_BUY_VALUES: readonly { id: string; arg: number }[] = [
  { id: 'auto-buy-on', arg: -1 },
  { id: 'auto-buy-off', arg: 0 },
];

function buildRdoExchanges(): RdoExchange[] {
  return AUTO_BUY_VALUES.map(({ id, arg }) => {
    const value = RdoValue.int(arg);
    return {
      id,
      request: rdoCall('RDOSelSelected', AUTO_BUY_TARGETS.gateObjectId, value).toFrame(),
      // A `procedure` answers nothing — there is no reply to capture (OB-28).
      response: '',
      matchKeys: {
        verb: 'sel',
        targetId: AUTO_BUY_TARGETS.gateObjectId,
        action: 'call',
        member: 'RDOSelSelected',
        argsPattern: [value.format()],
      },
    };
  });
}

export function createAutoBuyScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'auto-buy',
    description:
      'RDOSelSelected #-1|#0 addressed to the input gate’s own ObjectId, and the ten gate header names',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
