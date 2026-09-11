/**
 * The `Role` argument of `FindSuppliers` / `FindClients` — one place, one rule.
 *
 * The server takes a Delphi set, `TFacilityRoleSet`, cast to a byte. Its element
 * type is
 * `TFacilityRole = (rolNeutral, rolProducer, rolDistributer, rolBuyer, rolImporter, rolCompExport, rolCompInport)`
 * (`Voyager/WHGeneralSheet.pas:155`), so `byte(rl)` gives every member the bit of
 * its ordinal — rolNeutral is bit 0, not rolProducer. The client used to start
 * the table at rolProducer = 1, which shifted every checkbox onto its neighbour's
 * member.
 *
 * The two reference forms build the mask like this, and they are what these
 * helpers reproduce:
 *
 *  - supplier search (`FindSuppliers`, our `direction: 'input'`) —
 *    `Voyager/URLHandlers/OutputSearchHandlerViewer.pas:337-351`: Export
 *    Warehouses → rolCompExport, Regular Warehouses → rolDistributer, City Trade
 *    Centers → rolImporter, Factories → rolProducer. All four = **54**, the `#54`
 *    of the captured trace (`src/server/__tests__/rdo/connection-search.test.ts:9`).
 *  - client search (`FindClients`, our `direction: 'output'`) —
 *    `Voyager/URLHandlers/InputSearchHandlerViewer.pas:313-327`: Import
 *    Warehouses → rolCompInport, Regular Warehouses → rolDistributer, Stores →
 *    rolBuyer, Factories → rolProducer. All four = **78**.
 */

/** TFacilityRole bit values — `byte(TFacilityRoleSet)`, WHGeneralSheet.pas:155. */
export const ROL_NEUTRAL = 1;
export const ROL_PRODUCER = 2;
export const ROL_DISTRIBUTER = 4;
export const ROL_BUYER = 8;
export const ROL_IMPORTER = 16;
export const ROL_COMP_EXPORT = 32;
export const ROL_COMP_INPORT = 64;

/** `'input'` looks for suppliers (FindSuppliers); `'output'` for clients (FindClients). */
export type SearchDirection = 'input' | 'output';

/** One flag per checkbox the two Voyager search forms offer. */
export interface ConnectionRoleFlags {
  /** Factories — both directions. */
  producer: boolean;
  /** Regular Warehouses — both directions. */
  distributer: boolean;
  /** City Trade Centers — supplier search only (OutputSearchHandlerViewer.pas:346). */
  importer: boolean;
  /** Export Warehouses — supplier search only (OutputSearchHandlerViewer.pas:342). */
  exporter: boolean;
  /** Stores — client search only (InputSearchHandlerViewer.pas:322). */
  buyer: boolean;
  /** Import Warehouses — client search only (InputSearchHandlerViewer.pas:318). */
  compImporter: boolean;
}

/** Every box ticked — how both dialogs open. */
export const ALL_CONNECTION_ROLES: ConnectionRoleFlags = {
  producer: true,
  distributer: true,
  importer: true,
  exporter: true,
  buyer: true,
  compImporter: true,
};

/**
 * The `Role` argument Voyager's `GetRoles` would emit for this direction and
 * checkbox state.
 *
 * A flag the direction does not show never contributes, so a remembered
 * `buyer` / `compImporter` cannot leak into a supplier search, nor
 * `importer` / `exporter` into a client search. Nothing ticked returns 0 —
 * what `byte([])` returns; there is no fallback here and none downstream.
 */
export function rolesToMask(direction: SearchDirection, roles: ConnectionRoleFlags): number {
  let mask = 0;
  if (roles.producer) mask |= ROL_PRODUCER;
  if (roles.distributer) mask |= ROL_DISTRIBUTER;
  if (direction === 'input') {
    if (roles.importer) mask |= ROL_IMPORTER;
    if (roles.exporter) mask |= ROL_COMP_EXPORT;
  } else {
    if (roles.buyer) mask |= ROL_BUYER;
    if (roles.compImporter) mask |= ROL_COMP_INPORT;
  }
  return mask;
}
