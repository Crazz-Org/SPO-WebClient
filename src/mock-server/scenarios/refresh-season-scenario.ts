/**
 * Scenario 24: RefreshSeason — the server-initiated season push (issue 588).
 *
 * `RefreshSeason(Season: integer)` is a 1-arg `procedure` on `TModelEvents`
 * (`Interface Server/InterfaceServer.pas:552`), forwarded to the client's InitClient proxy
 * (`:2140-2145`) and originated by the model server (`Model Server/ModelServer.pas:1787`).
 * The reference client stored the season on the connection handler
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:3084`) and set the map's image suit from it
 * (`Voyager/URLHandlers/MapIsoHandler.pas:546-547`). This is the one push-only fixture in the
 * substrate: nothing answers it, so its single exchange has an empty `request` and `pushOnly: true`.
 */

import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Build the raw RefreshSeason push frame, as InterfaceServer emits it. */
export function buildRefreshSeasonPush(contextId: string, season: number): string {
  return `C sel ${contextId} call RefreshSeason "*" "#${season}"`;
}

export function createRefreshSeasonScenario(
  overrides?: Partial<ScenarioVariables>,
  opts?: { season?: number; contextId?: string }
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);
  const season = opts?.season ?? 0;
  const contextId = opts?.contextId ?? '8161308';

  const rdo: RdoScenario = {
    name: 'refresh-season',
    description: 'RefreshSeason server push: season changed, affects terrain textures',
    exchanges: [
      {
        id: 'season-rdo-001',
        request: '',
        response: buildRefreshSeasonPush(contextId, season),
        pushOnly: true,
        matchKeys: { action: 'call', member: 'RefreshSeason' },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
