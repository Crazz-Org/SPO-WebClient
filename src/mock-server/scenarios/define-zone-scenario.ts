/**
 * Zone painting — `DefineZone` refusal and acceptance (issue 586).
 *
 * `RDODefineZone` is a 6-argument published FUNCTION on `TWorld`
 * (`Kernel/World.pas:4502`, declared `:392`), so every frame carries `"^"` and a
 * QueryId and the server answers `res="#<code>"` — `NOERROR = 0` (`:4568`) on the
 * happy path, `ERROR_Unknown = 1` (`:4581`, `:4583`) when the tycoon id is
 * unknown or the body raises. Per-tile refusals inside an accepted call are
 * silent by design — the zoning loop simply skips a tile whose
 * reachability/ownership guard fails (`:4544-4546`) and still answers
 * `NOERROR` — so the reply says "the call was accepted", never "N tiles were
 * painted". This is the only evidence the gateway (and this scenario) has.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The world context `DefineZone` is bound to (matches `FAKE_CONTEXT_IDS.worldContextId`). */
const WORLD_CONTEXT_ID = '8161308';

/** The tycoon id `defineZone` sends first (matches `FAKE_CONTEXT_IDS.tycoonId`). */
const TYCOON_ID = 4666201923;

function buildRdoExchanges(result: number): RdoExchange[] {
  return [
    {
      id: 'dz-rdo-001',
      request: rdoCall(
        'DefineZone', WORLD_CONTEXT_ID,
        RdoValue.int(TYCOON_ID),
        RdoValue.int(2),
        RdoValue.int(100), RdoValue.int(100),
        RdoValue.int(102), RdoValue.int(102),
      ).toFrame(),
      response: `A700 res="#${result}"`,
      matchKeys: { verb: 'sel', action: 'call', member: 'DefineZone' },
    },
  ];
}

export function createDefineZoneScenario(
  overrides?: Partial<ScenarioVariables>,
  { result = 0 }: { result?: number } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'define-zone',
    description: 'DefineZone: a "^" function answering NOERROR or ERROR_Unknown; per-tile refusals are silent',
    exchanges: buildRdoExchanges(result),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
