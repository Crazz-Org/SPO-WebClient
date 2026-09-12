/**
 * `connection-reachability` — the road-flag sweep after a connection search (issue #584).
 *
 * `FindSuppliers` answers four seven-field rows; the sweep that follows reads
 * `NearCircuits` off the building and each candidate through one shared temp
 * object (`SetObject` + `GetPropertyList('NearCircuits')`), and compares them as
 * `TFluidLink.Intercept` does (`~/SPO-Original/Cache/FluidLinks.pas:116-134`):
 * either side empty is false (`:121`), otherwise true iff the two comma lists
 * share one id. `NearCircuits` itself is a cached string, not an RDO member
 * (`RenderCircuitStr`, `~/SPO-Original/Kernel/KernelCache.pas:156-165` /
 * `:440`), so it never enters `rdo-members.ts`.
 *
 * `SetObject` is a `WordBool`-returning `function`
 * (`Cache Server/CachedObjectAuto.pas:15`) — `resolveConnectionReachability`
 * reads that answer itself rather than through `ctx.cacherSetObject` (which
 * discards it), because that boolean is the only way to tell "nothing loaded
 * here" from "loaded, with an empty circuit string". Every `SetObject` frame
 * here therefore answers `#-1` (loaded); the `Ghost Farm` candidate has no
 * `NEAR_CIRCUITS_AT` entry and the drive answers its read with a rejection, to
 * exercise the "read failed" arm of the same `unknown` outcome.
 *
 * Every request is built by the real emitter (`rdoCall(...).toFrame()`), so the
 * separator and arity come from the catalogue, never from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { rolesToMask, ALL_CONNECTION_ROLES } from '@/shared/connection-roles';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

export const REACHABILITY_CACHER_ID = '40133496';
export const REACHABILITY_TEMP_OBJECT = '900002';

export const REACHABILITY_BUILDING = {
  x: 472, y: 392, fluidId: 'Cotton', nearCircuits: '17,42,',
} as const;

export const REACHABILITY_CANDIDATES = [
  { name: 'Near Farm', x: 480, y: 392, circuits: '17,', expect: 'connected' },
  { name: 'Far Farm', x: 600, y: 700, circuits: '99,', expect: 'isolated' },
  // The FluidLinks.pas:121 case — an empty circuit string is never a match.
  { name: 'Roadless Farm', x: 300, y: 300, circuits: '', expect: 'isolated' },
  // No table entry: the drive answers this read with a rejection, so the row
  // must come back 'unknown', never a false 'isolated'.
  { name: 'Ghost Farm', x: 11, y: 11, circuits: null, expect: 'unknown' },
] as const;

/** `GetPropertyList('NearCircuits')` answer, keyed by the position last bound with `SetObject`. */
export const NEAR_CIRCUITS_AT: Record<string, string> = {
  [`${REACHABILITY_BUILDING.x},${REACHABILITY_BUILDING.y}`]: REACHABILITY_BUILDING.nearCircuits,
  ...Object.fromEntries(
    REACHABILITY_CANDIDATES.filter(c => c.circuits !== null).map(c => [`${c.x},${c.y}`, c.circuits as string]),
  ),
};

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  const findArgs = [
    RdoValue.string(REACHABILITY_BUILDING.fluidId),
    RdoValue.string(vars.worldName),
    RdoValue.string(''),
    RdoValue.string(''),
    RdoValue.int(20),
    RdoValue.int(REACHABILITY_BUILDING.x),
    RdoValue.int(REACHABILITY_BUILDING.y),
    RdoValue.int(1),
    RdoValue.int(rolesToMask('input', ALL_CONNECTION_ROLES)),
  ];

  const rows = REACHABILITY_CANDIDATES
    .map(c => `${c.x}}${c.y}}${c.name}}Owner ${c.name}}Town}$1}90`)
    .join('\r\n');

  const setObjectExchange = (id: string, x: number, y: number): RdoExchange => ({
    id,
    request: rdoCall('SetObject', REACHABILITY_TEMP_OBJECT, RdoValue.int(x), RdoValue.int(y)).toFrame(),
    response: 'A200 res="#-1"',
    matchKeys: {
      verb: 'sel', targetId: REACHABILITY_TEMP_OBJECT, action: 'call', member: 'SetObject',
      argsPattern: [RdoValue.int(x).format(), RdoValue.int(y).format()],
    },
  });

  return [
    {
      id: 'cr-rdo-find',
      request: rdoCall('FindSuppliers', REACHABILITY_CACHER_ID, ...findArgs).toFrame(),
      response: `A200 res="%${rows}"`,
      matchKeys: {
        verb: 'sel', targetId: REACHABILITY_CACHER_ID, action: 'call', member: 'FindSuppliers',
        argsPattern: findArgs.map(a => a.format()),
      },
    },
    {
      id: 'cr-rdo-create',
      request: rdoCall('CreateObject', REACHABILITY_CACHER_ID, RdoValue.string(vars.worldName)).toFrame(),
      response: `A200 res="#${REACHABILITY_TEMP_OBJECT}"`,
      matchKeys: {
        verb: 'sel', targetId: REACHABILITY_CACHER_ID, action: 'call', member: 'CreateObject',
        argsPattern: [RdoValue.string(vars.worldName).format()],
      },
    },
    setObjectExchange('cr-rdo-set-self', REACHABILITY_BUILDING.x, REACHABILITY_BUILDING.y),
    setObjectExchange('cr-rdo-set-near', REACHABILITY_CANDIDATES[0].x, REACHABILITY_CANDIDATES[0].y),
    setObjectExchange('cr-rdo-set-far', REACHABILITY_CANDIDATES[1].x, REACHABILITY_CANDIDATES[1].y),
    setObjectExchange('cr-rdo-set-roadless', REACHABILITY_CANDIDATES[2].x, REACHABILITY_CANDIDATES[2].y),
    setObjectExchange('cr-rdo-set-ghost', REACHABILITY_CANDIDATES[3].x, REACHABILITY_CANDIDATES[3].y),
    {
      // Documents the wire shape of the NearCircuits read; the drive answers
      // per bound coordinate from NEAR_CIRCUITS_AT (RdoMock's exact match
      // returns the first exchange every time for identical frames, rdo-mock.ts:97-118).
      id: 'cr-rdo-near',
      request: rdoCall('GetPropertyList', REACHABILITY_TEMP_OBJECT, RdoValue.string('NearCircuits\t')).toFrame(),
      response: `A200 res="%${REACHABILITY_BUILDING.nearCircuits}"`,
      matchKeys: {
        verb: 'sel', targetId: REACHABILITY_TEMP_OBJECT, action: 'call', member: 'GetPropertyList',
        argsPattern: [RdoValue.string('NearCircuits\t').format()],
      },
    },
    {
      // CloseObject is a procedure — no reply carries anything.
      id: 'cr-rdo-close',
      request: rdoCall('CloseObject', REACHABILITY_CACHER_ID, RdoValue.int(parseInt(REACHABILITY_TEMP_OBJECT, 10))).toFrame(),
      response: 'A200',
      matchKeys: {
        verb: 'sel', targetId: REACHABILITY_CACHER_ID, action: 'call', member: 'CloseObject',
        argsPattern: [RdoValue.int(parseInt(REACHABILITY_TEMP_OBJECT, 10)).format()],
      },
    },
  ];
}

export function createConnectionReachabilityScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'connection-reachability',
    description: 'FindSuppliers plus the NearCircuits sweep (SetObject + GetPropertyList) that resolves the connected/isolated/unknown road flag',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
