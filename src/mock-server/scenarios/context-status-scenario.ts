/**
 * The town sentence under the camera — `ContextStatusText` (issue 589).
 *
 * `ContextStatusText( x, y : integer ) : OleVariant` is a published FUNCTION on
 * `TClientView` (`Interface Server/InterfaceServer.pas:149`), so every frame
 * carries `"^"` and a QueryId. The façade forwards to
 * `TWorld.RDOContextStatusText( ToTycoon, x, y )` (`Kernel/World.pas:4233`) and
 * supplies the tycoon proxy id itself — the client sends two integers, x then y,
 * exactly as Voyager does (`Voyager/URLHandlers/ServerCnxHandler.pas:1444`,
 * passing `fViewCenter.x, fViewCenter.y`).
 *
 * The two exchanges are the two answers that matter: a sentence for a tile with
 * a town, and `res="%"` — the empty answer `Kernel/World.pas:4243` gives when
 * `NearestTown` finds none — for the tile the camera moves to. Voyager refreshes
 * this from a 20 s idle timer (`MapIsoHandler.pas:188`), so the camera-move ask
 * is what this scenario pins.
 */

import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The world context `ContextStatusText` is bound to (matches `FAKE_CONTEXT_IDS.worldContextId`). */
const WORLD_CONTEXT_ID = '8161308';

/** Where the camera sits first — a tile inside a town. */
export const TOWN_TILE = { x: 706, y: 436 };
/** Where it moves to — open ground, no town (`World.pas:4243`). */
export const EMPTY_TILE = { x: 120, y: 120 };

function buildRdoExchanges(text: string): RdoExchange[] {
  return [
    {
      id: 'cs-rdo-001',
      request: `C sel ${WORLD_CONTEXT_ID} call ContextStatusText "^" "#706","#436";`,
      response: `A700 res="%${text}"`,
      // The two exchanges differ only by their coordinates, so the args are part
      // of the key — without them the mock would answer the town sentence for
      // the empty tile too and the camera-move assertion would prove nothing.
      matchKeys: {
        verb: 'sel',
        targetId: WORLD_CONTEXT_ID,
        action: 'call',
        member: 'ContextStatusText',
        argsPattern: [RdoValue.int(TOWN_TILE.x).format(), RdoValue.int(TOWN_TILE.y).format()],
      },
    },
    {
      id: 'cs-rdo-002',
      request: `C sel ${WORLD_CONTEXT_ID} call ContextStatusText "^" "#120","#120";`,
      response: 'A700 res="%"',
      matchKeys: {
        verb: 'sel',
        targetId: WORLD_CONTEXT_ID,
        action: 'call',
        member: 'ContextStatusText',
        argsPattern: [RdoValue.int(EMPTY_TILE.x).format(), RdoValue.int(EMPTY_TILE.y).format()],
      },
    },
  ];
}

export function createContextStatusScenario(
  overrides?: Partial<ScenarioVariables>,
  { text = 'Podan, population 12,400' }: { text?: string } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'context-status',
    description: 'ContextStatusText: a "^" function answering the town sentence, or "" where there is no town',
    exchanges: buildRdoExchanges(text),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
