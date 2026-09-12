/**
 * Scenario 17: Connection search — the `Role` argument of FindSuppliers / FindClients.
 *
 * The two search dialogs put a `TFacilityRoleSet` on the wire as a byte
 * (`Voyager/WHGeneralSheet.pas:155`). Nothing in the L1 substrate ever saw that
 * argument, and the client had it off by one bit for every checkbox: the mask
 * the player ticked filtered on the neighbouring member. A wrong `Role` costs no
 * crash and no error reply — the server simply answers about facilities the
 * player did not ask for — so the only place it can be caught is here, against
 * the captured frame.
 *
 * The three exchanges reproduce that frame:
 *
 *  - `cs-rdo-001` — the captured FindSuppliers trace of
 *    `src/server/__tests__/rdo/connection-search.test.ts:9-10`, `"#54"` ninth
 *    (`rolProducer|rolDistributer|rolImporter|rolCompExport`, the four boxes of
 *    `OutputSearchHandlerViewer.pas:337-351`), answered with a seven-field row.
 *  - `cs-rdo-002` — the same shape for FindClients, `"#78"` ninth
 *    (`rolProducer|rolDistributer|rolBuyer|rolCompInport`,
 *    `InputSearchHandlerViewer.pas:313-327`), answered with a five-field row.
 *  - `cs-rdo-003` — the same supplier search asked in quality order, `"#2"` EIGHTH
 *    (`smQuality`, `Cache/FluidLinks.pas:9-11`). It exists because the eighth argument
 *    is the only thing that distinguishes it from `cs-rdo-001`: matching is
 *    argument-by-argument (`rdo-mock.ts:190-194`), so a gateway that ignored the
 *    player's choice of order would land on the wrong exchange.
 *
 * Both requests are built by the real emitter (`rdoCall`), so the fixture cannot
 * drift from what ships, and the separator and arity come from the catalogue
 * rather than from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { rolesToMask, ALL_CONNECTION_ROLES } from '@/shared/connection-roles';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

// =============================================================================
// THE SEARCH
// =============================================================================

/**
 * The cache server object the search is addressed to.
 *
 * Same value as `FAKE_CONTEXT_IDS.cacherId`, so a frame the fake session
 * context emits matches this exchange by target as well as by member.
 */
export const CONNECTION_SEARCH_CACHER_ID = '40133496';

/** The query of the captured trace, field by field. */
export const CONNECTION_SEARCH_QUERY = {
  fluidId: 'Drugs',
  /** Town filter, empty = all. */
  town: '',
  /** Name/company filter, empty = all. */
  company: '',
  maxResults: 20,
  x: 459,
  y: 389,
  /** 1 = smPrice, the delivered-cost order (Cache/FluidLinks.pas:9-11). */
  sortMode: 1,
} as const;

/**
 * The nine arguments of one search, in emitter order
 * (`Cache Server/CacheServerReportForm.pas:108-109`).
 */
function searchArgs(worldName: string, role: number, sortMode: number = CONNECTION_SEARCH_QUERY.sortMode): RdoValue[] {
  const q = CONNECTION_SEARCH_QUERY;
  return [
    RdoValue.string(q.fluidId),   // Output
    RdoValue.string(worldName),   // World
    RdoValue.string(q.town),      // Town
    RdoValue.string(q.company),   // Name
    RdoValue.int(q.maxResults),   // Count
    RdoValue.int(q.x),            // X
    RdoValue.int(q.y),            // Y
    RdoValue.int(sortMode),       // SortMode
    RdoValue.int(role),           // Role
  ];
}

/** Index of the `Role` argument in the nine — what this scenario is about. */
export const ROLE_ARG_INDEX = 8;

/** Index of the `SortMode` argument, directly before `Role`. */
export const SORT_MODE_ARG_INDEX = 7;

/** `smQuality` — the order a player asks for explicitly (Cache/FluidLinks.pas:9-11). */
export const QUALITY_SORT_MODE = 2;

/** Every box of the supplier form ticked: 54. */
export const SUPPLIER_SEARCH_ROLE = rolesToMask('input', ALL_CONNECTION_ROLES);
/** Every box of the client form ticked: 78. */
export const CLIENT_SEARCH_ROLE = rolesToMask('output', ALL_CONNECTION_ROLES);

/** The argument list of each exchange, so a test can index the ninth. */
export function connectionSearchArgs(
  direction: 'input' | 'output',
  worldName: string,
  sortMode?: number,
): RdoValue[] {
  return direction === 'input'
    ? searchArgs(worldName, SUPPLIER_SEARCH_ROLE, sortMode)
    : searchArgs(worldName, CLIENT_SEARCH_ROLE, sortMode);
}

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  const supplierArgs = connectionSearchArgs('input', vars.worldName);
  const clientArgs = connectionSearchArgs('output', vars.worldName);
  const qualityArgs = connectionSearchArgs('input', vars.worldName, QUALITY_SORT_MODE);

  return [
    {
      id: 'cs-rdo-001',
      request: rdoCall('FindSuppliers', CONNECTION_SEARCH_CACHER_ID, ...supplierArgs).toFrame(),
      // x}y}FacName}Company}Town}$Price}Quality — the seven-field supplier row.
      response: 'A92 res="%463}389}Trade Center}PGI}Olympus}$80}40"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'FindSuppliers',
        argsPattern: supplierArgs.map(a => a.format()),
      },
    },
    {
      id: 'cs-rdo-002',
      request: rdoCall('FindClients', CONNECTION_SEARCH_CACHER_ID, ...clientArgs).toFrame(),
      // x}y}FacName}Company}Town — a client row carries no price or quality.
      response: 'A93 res="%463}389}Drug Store}PGI}Olympus"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'FindClients',
        argsPattern: clientArgs.map(a => a.format()),
      },
    },
    {
      id: 'cs-rdo-003',
      request: rdoCall('FindSuppliers', CONNECTION_SEARCH_CACHER_ID, ...qualityArgs).toFrame(),
      // Same seven-field supplier row — only the order the server chose differs.
      response: 'A94 res="%463}389}Trade Center}PGI}Olympus}$80}40"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'FindSuppliers',
        argsPattern: qualityArgs.map(a => a.format()),
      },
    },
  ];
}

export function createConnectionSearchScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'connection-search',
    description: 'FindSuppliers / FindClients, the TFacilityRole mask their ninth argument carries, and the SortMode of the eighth',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
