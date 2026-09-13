/**
 * Chase — following another player's camera.
 *
 * Two published FUNCTIONS on `TClientView`, the same proxy `SayThis` and
 * `GetUserList` are reached through:
 *
 *  - `function Chase( UserName : widestring ) : OleVariant`
 *    (`Interface Server/InterfaceServer.pas:189`). Its body (`:1579-1607`) looks
 *    the target up by name and refuses self, an unknown name, or a user already
 *    chasing us with `ERROR_InvalidUserName = 12` (`Protocol/Protocol.pas:41`);
 *    otherwise it inserts us into the target's chaser list, answers
 *    `NOERROR = 0` (`Protocol.pas:29`) and **immediately pushes a `MoveTo`**
 *    onto the target's viewport centre (`:1592`).
 *  - `function StopChase : OleVariant` (`:190`, body `:1610-1632`), which
 *    removes us again and answers `ERROR_Unknown = 1` (`Protocol.pas:30`) when
 *    we were not chasing anybody.
 *
 * Both are functions, so every frame here carries `"^"` and a QueryId and the
 * server answers `res="#<code>"`. A `"*"` on either would be an arbitrary
 * memory write on the real server, with no error to show for it — which is why
 * the requests below are built by the real emitter (`rdoCall`) and the
 * separator comes from the catalogue rather than from this file.
 *
 * **The mirroring is the push, not the reply.** Every `SetViewedArea` of the
 * followed player pushes `MoveTo(x + dx div 2, y + dy div 2)` to each chaser
 * (`:707-716`, `:742`) — that push, and nothing in the reply, is what moves the
 * follower's camera. `CHASE_MOVE_TO_PUSH` is the first of them, the one the
 * accepted `Chase` sends straight away.
 *
 * The abort has no frame of its own: when the followed player leaves, the only
 * notice is the ordinary `NotifyUserListChange`, and the reference client
 * clears its `fChasedUser` off exactly that
 * (`Voyager.1/URLHandlers/ServerCnxHandler.pas:3029-3039`).
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The player being followed. */
export const CHASED_USER = 'Mayor of Podan';

/** Where their viewport is centred when the chase starts. */
export const CHASE_MOVE_TO = { x: 706, y: 436 };

/**
 * The `MoveTo` the accepted `Chase` pushes straight away. A push: `"*"`, no
 * QueryId, nothing to answer — shaped exactly like the live pushes the
 * dispatcher already reads.
 */
export function chaseMoveToPush(clientViewId: string): string {
  return `C sel ${clientViewId} call MoveTo "*" "#${CHASE_MOVE_TO.x}","#${CHASE_MOVE_TO.y}";`;
}

/** The LEAVE push that aborts the chase server-side. */
export function chaseLeavePush(clientViewId: string): string {
  return `C sel ${clientViewId} call NotifyUserListChange "*" "%${CHASED_USER}","#1";`;
}

function buildRdoExchanges(clientViewId: string, chaseResult: number): RdoExchange[] {
  const name = RdoValue.string(CHASED_USER);

  return [
    {
      id: 'chase-start',
      request: rdoCall('Chase', clientViewId, name).toFrame(),
      response: `A1 res="#${chaseResult}"`,
      // The server's own first MoveTo (InterfaceServer.pas:1592) — only sent
      // when it accepted.
      pushes: chaseResult === 0 ? [chaseMoveToPush(clientViewId)] : [],
      matchKeys: {
        verb: 'sel',
        targetId: clientViewId,
        action: 'call',
        member: 'Chase',
        argsPattern: [name.format()],
      },
    },
    {
      id: 'chase-stop',
      request: rdoCall('StopChase', clientViewId).toFrame(),
      response: 'A2 res="#0"',
      matchKeys: {
        verb: 'sel',
        targetId: clientViewId,
        action: 'call',
        member: 'StopChase',
      },
    },
  ];
}

export function createChaseScenario(
  overrides?: Partial<ScenarioVariables>,
  { chaseResult = 0 }: { chaseResult?: number } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'chase',
    description: 'Chase / StopChase: two "^" functions on the ClientView, plus the MoveTo push that mirrors the followed camera',
    exchanges: buildRdoExchanges(vars.clientViewId, chaseResult),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
