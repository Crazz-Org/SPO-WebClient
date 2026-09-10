/**
 * The role filter of a supplier / customer search, and the only place its bits are named.
 *
 * The ninth argument of `FindSuppliers` / `FindClients` is a Pascal `set of TFacilityRole`
 * (`Cache/OutputSearch.pas:45` — `aRole : TFacilityRoleSet`) cast to a byte, so **bit n is
 * enum ordinal n** and the enum is
 * `(rolNeutral, rolProducer, rolDistributer, rolBuyer, rolImporter, rolCompExport, rolCompInport)`
 * (`Cache/CacheCommon.pas:53`). The client used to start the table at `rolProducer = 1`, which
 * shifted every checkbox one position down — Factories asked the server for `rolNeutral` — and
 * put the two company-warehouse roles out of reach entirely.
 *
 * Which boxes each direction offers, and which role each one contributes, is Voyager's, not
 * ours: `TOutputSearchViewer.GetRoles` (`Voyager/URLHandlers/OutputSearchHandlerViewer.pas:337-351`)
 * for the supplier search, `TInputSearchViewer.GetRoles`
 * (`Voyager/URLHandlers/InputSearchHandlerViewer.pas:313-327`) for the customer search. Both end
 * on `result := byte(rl)`, so all boxes checked is 54 for suppliers and 78 for clients — 54 being
 * exactly what the captured trace carries (`src/server/__tests__/rdo/connection-search.test.ts:9`).
 */

/** `TFacilityRoleSet` bits — `Cache/CacheCommon.pas:53`, bit n = enum ordinal n. */
export const FACILITY_ROLE = {
  neutral: 1,
  producer: 2,
  distributer: 4,
  buyer: 8,
  importer: 16,
  compExport: 32,
  compInport: 64,
} as const;

/** One flag per checkbox a search form can offer. Each direction reads only the boxes it shows. */
export interface ConnectionRoleFlags {
  /** Factories. */
  producer: boolean;
  /** Warehouses. */
  distributer: boolean;
  /** Trade Centers — supplier search only. */
  importer: boolean;
  /** Stores — customer search only. */
  buyer: boolean;
  /** Export Warehouses — supplier search only. */
  compExport: boolean;
  /** Import Warehouses — customer search only. */
  compInport: boolean;
}

/** Every box ticked, the state both search forms open in. */
export const ALL_CONNECTION_ROLES: ConnectionRoleFlags = {
  producer: true,
  distributer: true,
  importer: true,
  buyer: true,
  compExport: true,
  compInport: true,
};

/** The boxes each direction actually shows, in the order Voyager's `GetRoles` reads them. */
const ROLES_BY_DIRECTION: Record<'input' | 'output', (keyof ConnectionRoleFlags)[]> = {
  // FindSuppliers — OutputSearchHandlerViewer.pas:337-351. All checked = 32+4+16+2 = 54.
  input: ['compExport', 'distributer', 'importer', 'producer'],
  // FindClients — InputSearchHandlerViewer.pas:313-327. All checked = 64+4+8+2 = 78.
  output: ['compInport', 'distributer', 'buyer', 'producer'],
};

/**
 * The `Role` argument for a search in one direction.
 *
 * A flag the direction does not show contributes nothing, and no box ticked is 0 — the same
 * `byte([])` Voyager sends. There is deliberately no fallback: a default belongs to whoever
 * omits the filter, never to a player who unticked every box.
 */
export function rolesToMask(direction: 'input' | 'output', roles: ConnectionRoleFlags): number {
  let mask = 0;
  for (const flag of ROLES_BY_DIRECTION[direction]) {
    if (roles[flag]) mask |= FACILITY_ROLE[flag];
  }
  return mask;
}
