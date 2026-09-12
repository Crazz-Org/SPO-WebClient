/**
 * Scenario: world login — the world-socket exchanges `loginWorld` drives, with the
 * admission question the reference client asked before offering company creation.
 *
 * `InterfaceServer.CanJoinWorldEx` is declared
 * `function CanJoinWorldEx(Name : widestring) : OleVariant` in
 * `Interface Server/InterfaceServer.pas:441`; its body (`:3471-3486`) answers `-1` for a
 * world at its user cap, `0` when the player's nobility reaches the world's `MinNobility`,
 * and otherwise the positive shortfall. `logonComplete.asp:143-152` binds to
 * `InterfaceServer`, makes that one-argument call, and turns `-1` into `CanPlay=NOROOM`
 * and a positive code into `CanPlay=<code>`.
 *
 * RDO only — the company list itself is served by the HTTP scenario.
 */

import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The id `idof "InterfaceServer"` answers with, and the target every pre-Logon frame carries. */
export const WORLD_LOGIN_INTERFACE_SERVER_ID = '6892548';

/** The connection id `get RDOCnntId` answers with, and RegisterEventsById's argument. */
export const WORLD_LOGIN_RDO_CNNT_ID = '12345678';

/** How the world answers CanJoinWorldEx. */
export interface WorldLoginOptions {
  /** `-1` = full, `0` = admitted (default), `> 0` = nobility shortfall. */
  canJoin?: number;
}

export function createWorldLoginScenario(
  overrides?: Partial<ScenarioVariables>,
  options?: WorldLoginOptions,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);
  const canJoin = options?.canJoin ?? 0;

  const rdo: RdoScenario = {
    name: 'world-login',
    description: 'World login RDO exchanges: idof, CanJoinWorldEx, AccountStatus, Logon, RegisterEventsById',
    exchanges: [
      {
        id: 'wlogin-rdo-idof',
        request: `C 0 idof "InterfaceServer"`,
        response: `A0 objid="${WORLD_LOGIN_INTERFACE_SERVER_ID}"`,
        matchKeys: { verb: 'idof', targetId: 'InterfaceServer' },
      },
      {
        // One widestring argument, against the InterfaceServer id, before AccountStatus.
        id: 'wlogin-rdo-canjoin',
        request: `C 1 sel ${WORLD_LOGIN_INTERFACE_SERVER_ID} call CanJoinWorldEx "^" "%${vars.username}"`,
        response: `A1 res="#${canJoin}"`,
        matchKeys: {
          verb: 'sel',
          targetId: WORLD_LOGIN_INTERFACE_SERVER_ID,
          action: 'call',
          member: 'CanJoinWorldEx',
          argsPattern: [`"%${vars.username}"`],
        },
      },
      {
        id: 'wlogin-rdo-acct',
        request: `C 2 sel ${WORLD_LOGIN_INTERFACE_SERVER_ID} call AccountStatus "^" "%${vars.username}","%${vars.password}"`,
        response: `A2 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AccountStatus' },
      },
      {
        id: 'wlogin-rdo-logon',
        request: `C 3 sel ${WORLD_LOGIN_INTERFACE_SERVER_ID} call Logon "^" "%${vars.username}","%${vars.password}"`,
        response: `A3 res="#${vars.clientViewId}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Logon' },
      },
      {
        id: 'wlogin-rdo-regevt',
        request: `C 4 sel ${vars.clientViewId} call RegisterEventsById "^" "#${WORLD_LOGIN_RDO_CNNT_ID}"`,
        response: `A4 res="#1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RegisterEventsById' },
      },
    ],
    variables: {},
  };

  return { rdo };
}
