/**
 * Trade settings — the six frames the two trade controls can ever emit.
 *
 * `RDOSetRole` and `RDOSetTradeLevel` are both Pascal `procedure`s with one
 * integer argument (`StdBlocks/Warehouses.pas:527`, `Kernel/Kernel.pas:6408`),
 * and neither range-checks what it is handed. The reference client never let a
 * player send anything but three values per member — 2/5/6 for the role, 0/2/3
 * for the level, with `1` (`tlvPupil`) deliberately unreachable — so the legal
 * arguments are part of the protocol, not a UI nicety.
 *
 * There is nothing in a reply that could catch a wrong one: a `procedure`
 * answers nothing (`OB-28`), so the **response is empty on purpose** and the
 * frame itself is the only evidence. This scenario fixes one exchange per legal
 * value of each member; anything else the client emits matches nothing here.
 *
 * Every request is built by the real emitter (`rdoCall`), so the separator and
 * the arity come from the catalogue rather than from this file, and the values
 * come from `shared/building-details/trade-settings.ts` — the same lists the
 * controls build their options from, never restated.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoMemberName } from '@/shared/rdo-members';
import {
  TRADE_MODE_VALUES,
  TRADE_LEVEL_VALUES,
} from '@/shared/building-details/trade-settings';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/**
 * The ids the gateway threads through a facility write.
 *
 * `CurrBlock` and `ObjectId` are deliberately different and neither is a
 * coordinate or a session id — the case that tells the two bind tables apart
 * (`building-property-handler.test.ts:43-54`). Both trade members bind to
 * `CurrBlock`.
 */
export const TRADE_TARGETS = {
  currBlock: '40133497',
  objectId: '40133512',
  tempObject: 'cacher-obj-551',
} as const;

/** One member, and every argument the client is allowed to send it. */
interface TradeMutation {
  slug: string;
  member: RdoMemberName;
  values: readonly number[];
}

const TRADE_MUTATIONS: TradeMutation[] = [
  { slug: 'rdo-set-role', member: 'RDOSetRole', values: TRADE_MODE_VALUES },
  { slug: 'rdo-set-trade-level', member: 'RDOSetTradeLevel', values: TRADE_LEVEL_VALUES },
];

function buildRdoExchanges(): RdoExchange[] {
  const exchanges: RdoExchange[] = [];

  for (const mutation of TRADE_MUTATIONS) {
    for (const value of mutation.values) {
      const arg = RdoValue.int(value);
      exchanges.push({
        id: `trade-${mutation.slug}-${value}`,
        request: rdoCall(mutation.member, TRADE_TARGETS.currBlock, arg).toFrame(),
        // A `procedure` answers nothing — there is no reply to capture (OB-28).
        response: '',
        matchKeys: {
          verb: 'sel',
          targetId: TRADE_TARGETS.currBlock,
          action: 'call',
          member: mutation.member,
          argsPattern: [arg.format()],
        },
      });
    }
  }

  return exchanges;
}

export function createTradeSettingsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'trade-settings',
    description: 'RDOSetRole 2|5|6 and RDOSetTradeLevel 0|2|3 — every argument the controls can send',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
