/**
 * Disconnecting several connections — one frame, every pair in one argument.
 *
 * The reference client never sent one frame per row. `SupplySheetForm.pas:889-908`
 * walks every *selected* row of the supplier list, appends `x + ',' + y + ','`
 * for each one into a single `Cnxs` string and calls `RemoveConections(Cnxs)`
 * once, which emits one `RDODisconnectInput(fCurFluidId, Cnxs)` (`:418`);
 * `ProdSheetForm.pas:715-734` does the same for buyers and emits one
 * `RDODisconnectOutput(fCurrFluidId, Cnxs)` (`:363`). The server splits that
 * string on `,` into pairs (`Kernel/Kernel0.pas:4157-4180`, `ParseGateList`), so
 * any even number of tokens is one call — and the trailing comma is mandatory,
 * because the token after the last one is never read.
 *
 * Both members are `procedure`s, so the **response is empty on purpose**
 * (`OB-28`) and the frame itself is the only evidence the selection left whole.
 * The requests are the literal frames production emits, captured in the sibling
 * test — never rebuilt with the emitter, so a wrong catalogue entry cannot
 * produce a matching wrong fixture.
 */

import { RdoValue } from '@/shared/rdo-types';
import type { RdoMemberName } from '@/shared/rdo-members';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/**
 * The ids the gateway threads through a facility write. Both disconnect members
 * bind to `ObjectId`, not `CurrBlock`
 * (`src/server/session/building-property-handler.ts:192-196`), and the two ids
 * are deliberately different here so a frame sent against the wrong one matches
 * nothing.
 */
export const DISCONNECT_TARGETS = {
  currBlock: '40133497',
  objectId: '40133512',
  tempObject: 'cacher-obj-563',
} as const;

/** The gate the selection is fired from. */
export const DISCONNECT_FLUID = 'Plastics';

/** Three selected rows — (10,20), (30,40), (50,60) — as one `ParseGateList` string. */
export const DISCONNECT_LIST = '10,20,30,40,50,60,';

const DISCONNECT_MEMBERS: { slug: string; member: RdoMemberName; request: string }[] = [
  {
    slug: 'input',
    member: 'RDODisconnectInput',
    request: `C sel ${DISCONNECT_TARGETS.objectId} call RDODisconnectInput "*" "%${DISCONNECT_FLUID}","%${DISCONNECT_LIST}";`,
  },
  {
    slug: 'output',
    member: 'RDODisconnectOutput',
    request: `C sel ${DISCONNECT_TARGETS.objectId} call RDODisconnectOutput "*" "%${DISCONNECT_FLUID}","%${DISCONNECT_LIST}";`,
  },
];

function buildRdoExchanges(): RdoExchange[] {
  const fluidArg = RdoValue.string(DISCONNECT_FLUID);
  const listArg = RdoValue.string(DISCONNECT_LIST);

  return DISCONNECT_MEMBERS.map(({ slug, member, request }) => ({
    id: `disconnect-${slug}-3`,
    request,
    // A `procedure` answers nothing — there is no reply to capture (OB-28).
    response: '',
    matchKeys: {
      verb: 'sel',
      targetId: DISCONNECT_TARGETS.objectId,
      action: 'call',
      member,
      argsPattern: [fluidArg.format(), listArg.format()],
    },
  }));
}

export function createDisconnectConnectionsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'disconnect-connections',
    description: 'RDODisconnectInput / RDODisconnectOutput — three selected rows in one frame',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
