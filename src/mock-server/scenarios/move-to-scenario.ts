/**
 * Scenario 22: MoveTo server push — the Interface Server requests a camera pan.
 *
 * The only push-only exchange in the registry: no client request precedes it, the fake
 * Interface Server simply emits it (`TISEvents.MoveTo(x, y)`,
 * Voyager/URLHandlers/ServerCnxHandler.pas:489).
 *
 * Captured RDO push:
 *   C sel 41003058 call MoveTo "*" "#706","#436";
 */

import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** IS events proxy id, same capture as push-dispatcher.test.ts:37 */
export const MOVE_TO_PUSH_TARGET = '41003058';
export const CAPTURED_MOVE_TO = { x: 706, y: 436 };

export function buildMoveToPush(): string {
  return `C sel ${MOVE_TO_PUSH_TARGET} call MoveTo "*" "#${CAPTURED_MOVE_TO.x}","#${CAPTURED_MOVE_TO.y}";`;
}

export function createMoveToScenario(
  overrides?: Partial<ScenarioVariables>
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'move-to',
    description: 'MoveTo server push: camera pan with no preceding client request',
    exchanges: [
      {
        id: 'moveto-rdo-001',
        request: '',
        response: buildMoveToPush(),
        pushOnly: true,
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
