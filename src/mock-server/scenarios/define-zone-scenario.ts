/**
 * Scenario 22: DefineZone result code
 *
 * `DefineZone` is a 6-arg `function` (`Kernel/World.pas:392`, body `:4502-4592`):
 * it answers `res="#<TErrorCode>"`, `0` (NOERROR) at `:4568`, `1` (ERROR_Unknown)
 * at `:4581`/`:4583`. Per-tile refusals inside the walked rectangle are silent
 * (`:4544-4546`) — `NOERROR` means the request was processed, not that every
 * tile was zoned.
 *
 * RDO only — no `ws`/`http` halves (the registry's `ScenarioBundle` allows any
 * subset).
 */

import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

export interface CapturedDefineZoneData {
  tycoonId: string;
  zoneId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  result: number;
}

export const CAPTURED_DEFINE_ZONE_SUCCESS: CapturedDefineZoneData = {
  tycoonId: '4666201923',
  zoneId: 2,
  x1: 10,
  y1: 20,
  x2: 12,
  y2: 22,
  result: 0,
};

/** ERROR_Unknown, Kernel/World.pas:4581 */
export const CAPTURED_DEFINE_ZONE_REFUSED: CapturedDefineZoneData = {
  ...CAPTURED_DEFINE_ZONE_SUCCESS,
  result: 1,
};

export function createDefineZoneScenario(
  overrides?: Partial<ScenarioVariables>,
  opts?: { refusal?: 'unknown' }
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);
  const d = opts?.refusal === 'unknown' ? CAPTURED_DEFINE_ZONE_REFUSED : CAPTURED_DEFINE_ZONE_SUCCESS;

  const rdo: RdoScenario = {
    name: 'define-zone',
    description: 'DefineZone: result-code accept/refuse',
    exchanges: [
      {
        id: 'dz-rdo-001',
        request: `C 61 sel ${vars.clientViewId} call DefineZone "^" "#${d.tycoonId}","#${d.zoneId}","#${d.x1}","#${d.y1}","#${d.x2}","#${d.y2}"`,
        response: `A61 res="#${d.result}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'DefineZone' },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
