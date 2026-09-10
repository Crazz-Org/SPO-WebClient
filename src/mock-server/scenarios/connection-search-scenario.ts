/**
 * Scenario 17: connection search — the supplier / customer search pair.
 *
 * `FindSuppliers` and `FindClients` are the two members a player reaches every time they look
 * for someone to connect a fluid gate to, and until this scenario existed nothing in the L1
 * substrate had ever seen either frame. The interesting argument is the ninth: a Pascal
 * `set of TFacilityRole` cast to a byte (`Cache/CacheCommon.pas:53`), where every checkbox of
 * the search form is one bit. Get the bit wrong and the frame is still well formed — the server
 * simply answers about the wrong kind of facility — so the wire format alone can never catch
 * it. Here the mask is built by the same `rolesToMask` the gateway calls, and the exchange
 * asserts the byte the reference client demonstrably sent: 54 for a supplier search
 * (`connection-search.test.ts:9`), 78 for a customer one.
 *
 * Both requests are built by the real emitter (`rdoCall`), so the fixture cannot drift from
 * what ships, and both members are `function`s of arity 9 (`rdo-members.ts:111-112`) — hence
 * the `"^"` separator and a non-empty reply, unlike the civic procedures next door.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { rolesToMask, ALL_CONNECTION_ROLES } from '@/shared/connection-roles';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The cacher the search binds to — the same id `fake-session-context.ts:94` hands a handler. */
export const CONNECTION_SEARCH_TARGET = { cacherId: '40133496' } as const;

/** The probe of the captured trace: 20 Drugs suppliers around (459, 389). */
export const CONNECTION_SEARCH_PROBE = {
  fluidId: 'Drugs',
  x: 459,
  y: 389,
  count: 20,
} as const;

/** One row of the captured `FindSuppliers` reply — 7 fields, price and quality included. */
export const CONNECTION_SEARCH_SUPPLIER_ROW =
  '463}389}Trade Center}PGI}Olympus}$80}40';

/** A `FindClients` row — 5 fields, no price or quality (`politics-handler.ts:1142-1143`). */
export const CONNECTION_SEARCH_CLIENT_ROW =
  '200}300}Small Farm}AcmeCorp}Springfield';

/**
 * The nine arguments of a search, in the Delphi order
 * (`FindSuppliers(Output, World, Town, Name: widestring; Count, X, Y, SortMode, Role: integer)`).
 * `direction` picks both the member and the role mask, exactly as `searchConnections` does.
 */
function searchArgs(direction: 'input' | 'output', worldName: string): RdoValue[] {
  return [
    RdoValue.string(CONNECTION_SEARCH_PROBE.fluidId),
    RdoValue.string(worldName),
    RdoValue.string(''),   // Town filter — empty = all
    RdoValue.string(''),   // Name/company filter — empty = all
    RdoValue.int(CONNECTION_SEARCH_PROBE.count),
    RdoValue.int(CONNECTION_SEARCH_PROBE.x),
    RdoValue.int(CONNECTION_SEARCH_PROBE.y),
    RdoValue.int(1),       // SortMode 1 = quality
    RdoValue.int(rolesToMask(direction, ALL_CONNECTION_ROLES)),
  ];
}

function buildExchange(direction: 'input' | 'output', worldName: string): RdoExchange {
  const member = direction === 'input' ? 'FindSuppliers' : 'FindClients';
  const args = searchArgs(direction, worldName);
  const row = direction === 'input'
    ? CONNECTION_SEARCH_SUPPLIER_ROW
    : CONNECTION_SEARCH_CLIENT_ROW;

  return {
    id: `connection-search-rdo-${direction === 'input' ? 'find-suppliers' : 'find-clients'}`,
    request: rdoCall(member, CONNECTION_SEARCH_TARGET.cacherId, ...args).toFrame(),
    response: `A0 res="%${row}"`,
    matchKeys: {
      verb: 'sel',
      targetId: CONNECTION_SEARCH_TARGET.cacherId,
      action: 'call',
      member,
      // The role byte is part of the match: a frame carrying the wrong one is a different
      // search, and must not fall through onto this exchange.
      argsPattern: args.map(a => a.format()),
    },
  };
}

export function createConnectionSearchScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'connection-search',
    description: 'The supplier and customer searches: FindSuppliers with Role 54, FindClients with Role 78',
    exchanges: [buildExchange('input', vars.worldName), buildExchange('output', vars.worldName)],
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
