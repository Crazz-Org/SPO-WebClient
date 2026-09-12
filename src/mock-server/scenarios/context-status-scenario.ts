/**
 * Scenario 23: Context status — the town under the camera.
 * RDO: ContextStatusText (client view, `Interface Server/InterfaceServer.pas:149`)
 * WS: REQ_CONTEXT_STATUS -> RESP_CONTEXT_STATUS
 *
 * NOT a capture. In the checked-in Kernel, `TTown.GetContextStatusStr` is a stub
 * that returns '' (`Kernel/Kernel.pas:9307-9310`), so no live session can produce
 * a non-empty sentence to capture — whether the deployed model server carries a
 * fuller implementation is [UNKNOWN]. The first exchange therefore carries a
 * *plausible* sentence, chosen only to prove the client renders whatever string
 * the server sends; the second carries the answer the source guarantees, '' for
 * "no town at (x, y)" (`Kernel/World.pas:4243`).
 */

import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The sentence `ctx-rdo-001` answers — plausible, not captured (see file header). */
export const PLAUSIBLE_CONTEXT_SENTENCE = 'Helartia — population 12 480, ruled by SPO_test3';

/** The camera position `ctx-rdo-001` answers for. */
export const CONTEXT_TOWN_POSITION = { x: 472, y: 392 };

/** A camera position with no town under it — `ctx-rdo-002`. */
export const CONTEXT_EMPTY_POSITION = { x: 5, y: 5 };

export function createContextStatusScenario(
  overrides?: Partial<ScenarioVariables>
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'context-status',
    description: 'Context status: the town under the camera, via ContextStatusText(x, y)',
    exchanges: [
      {
        id: 'ctx-rdo-001',
        request: `C 80 sel ${vars.clientViewId} call ContextStatusText "^" "#${CONTEXT_TOWN_POSITION.x}","#${CONTEXT_TOWN_POSITION.y}"`,
        response: `A80 res="%${PLAUSIBLE_CONTEXT_SENTENCE}"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'ContextStatusText',
          argsPattern: [`"#${CONTEXT_TOWN_POSITION.x}"`, `"#${CONTEXT_TOWN_POSITION.y}"`],
        },
      },
      {
        id: 'ctx-rdo-002',
        request: `C 81 sel ${vars.clientViewId} call ContextStatusText "^" "#${CONTEXT_EMPTY_POSITION.x}","#${CONTEXT_EMPTY_POSITION.y}"`,
        response: `A81 res="%"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'ContextStatusText',
          argsPattern: [`"#${CONTEXT_EMPTY_POSITION.x}"`, `"#${CONTEXT_EMPTY_POSITION.y}"`],
        },
      },
    ],
    variables: {
      clientViewId: vars.clientViewId,
    },
  };

  return { rdo };
}
