/**
 * `channel-list-change` — the Interface Server broadcasting that a chat
 * channel appeared or disappeared, to every `TClientView` in the world.
 *
 * `NotifyChannelListChange( Name, Password, Change )` is a `procedure`
 * (`Protocol/Protocol.pas`), so every frame here carries `"*"`, no QueryId
 * and no reply. `create-channel-scenario.ts` already carries the inclusion
 * half of this push (fired from `ClientCreatedChannel`,
 * `Interface Server/InterfaceServer.pas:4594`); this scenario is the pair
 * that also exercises the exclusion, `uchExclusion = 1`
 * (`Protocol/Protocol.pas:120`).
 *
 * The exclusion is rare: it only fires when the last member of a
 * non-system channel leaves it (`Interface Server/InterfaceServer.pas:4691`).
 * The third exchange pushes it for the name `'Lobby'` — the WebClient's own
 * synthesised default-channel row, which has no counterpart in the Delphi
 * list and so must never be removable by anything the server sends.
 */

import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The channel both the inclusion and the exclusion push name. */
export const CHANGED_CHANNEL = 'Traders';
/** The password both pushes carry. */
export const CHANGED_PASSWORD = 's3cret';

/**
 * `NotifyChannelListChange` is inbound only, so it is written out literally
 * rather than built by `rdoCall` — it must not, and cannot, appear in the
 * catalogue of what this client emits.
 */
function channelListChangePush(clientViewId: string, name: string, password: string, change: 0 | 1): string {
  return `C sel ${clientViewId} call NotifyChannelListChange "*" "%${name}","%${password}","#${change}";`;
}

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  const { clientViewId } = vars;

  return [
    {
      id: 'channel-list-change-inclusion',
      request: '',
      response: channelListChangePush(clientViewId, CHANGED_CHANNEL, CHANGED_PASSWORD, 0),
      pushOnly: true,
    },
    {
      id: 'channel-list-change-exclusion',
      request: '',
      response: channelListChangePush(clientViewId, CHANGED_CHANNEL, CHANGED_PASSWORD, 1),
      pushOnly: true,
    },
    {
      id: 'channel-list-change-lobby-exclusion',
      request: '',
      response: channelListChangePush(clientViewId, 'Lobby', '', 1),
      pushOnly: true,
    },
  ];
}

export function createChannelListChangeScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'channel-list-change',
    description: 'NotifyChannelListChange: an inclusion and an exclusion for the same channel, plus an exclusion naming the synthesised Lobby row that must never be removed',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
