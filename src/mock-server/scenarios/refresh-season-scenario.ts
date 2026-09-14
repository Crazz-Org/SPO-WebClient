/**
 * RefreshSeason — the world's season turning, pushed to every client view.
 *
 * `Model Server/ModelServer.pas:1781-1787` drives the season change, which
 * `Interface Server/InterfaceServer.pas:3721-3737` pushes to every ClientView;
 * `Voyager/URLHandlers/ServerCnxHandler.pas:3077-3088` raises `evnRefreshSeason`
 * and `Voyager/URLHandlers/MapIsoHandler.pas:546-547` assigns it straight to
 * the terrain suit — no reload, no re-login. `RefreshSeason` is a
 * `procedure( Season : integer )` (`Protocol/Protocol.pas:203`,
 * `Interface Server/InterfaceServer.pas:227`); the integer is the ordinal of
 * `TSeason = (seasWinter, seasSpring, seasSummer, seasFall)`
 * (`Kernel/Seasons.pas:9`), the same 0..3 ordering as our own `Season` enum.
 *
 * A season change has no request of its own — it is a pure unsolicited push —
 * so this is a single `pushOnly: true` exchange, addressed to the client view
 * with `"*"` and no QueryId because a `procedure` has nothing to answer.
 */

import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The raw push frame RefreshSeason arrives as. */
export function refreshSeasonPush(targetId: string, season: number): string {
  return `C sel ${targetId} call RefreshSeason "*" "#${season}";`;
}

function buildRdoExchanges(clientViewId: string, season: number): RdoExchange[] {
  return [
    {
      id: 'refresh-season-push',
      request: '',
      response: refreshSeasonPush(clientViewId, season),
      pushOnly: true,
    },
  ];
}

/**
 * `season` defaults to `0` (WINTER) on purpose: the terrain renderer's own
 * default is `SUMMER`, so a handler that silently did nothing cannot pass by
 * coincidence.
 */
export function createRefreshSeasonScenario(
  overrides?: Partial<ScenarioVariables>,
  { season = 0 }: { season?: number } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'refresh-season',
    description: 'RefreshSeason: the world season turning, pushed to every client view — no reload, no re-login',
    exchanges: buildRdoExchanges(vars.clientViewId, season),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
