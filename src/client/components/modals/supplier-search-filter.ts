/**
 * The two rules `TycoonSuppliesSearch.asp` applies that the generic connection
 * picker does not — the auto-connection supplier search only.
 *
 * Source: `SPO-ASP/Five/0/Visual/Voyager/NewTycoon/TycoonSuppliesSearch.asp`
 * (the `NewTycoon/` copy is the one the gateway fetches, `auto-connection-handler.ts:63`).
 */

import {
  ALL_CONNECTION_ROLES,
  ROL_DISTRIBUTER,
  rolesToMask,
  type ConnectionRoleFlags,
} from '@/shared/connection-roles';
import type { ConnectionSearchResult } from '@/shared/types';

/** The rows `TycoonSuppliesSearch.asp:43-44` renders: every utility but exactly "Trade Center". */
export function excludeTradeCenters(
  results: readonly ConnectionSearchResult[],
): ConnectionSearchResult[] {
  return results.filter((r) => r.facilityName !== 'Trade Center');
}

/**
 * The `Role` `TycoonSuppliesSearch.asp:26-30` sends: `OnlyDist` on → ROLE_Distributer
 * alone; off → the ticked boxes, through `rolesToMask('input', …)`.
 */
export function supplierSearchMask(warehousesOnly: boolean, roles: ConnectionRoleFlags): number {
  return warehousesOnly ? ROL_DISTRIBUTER : rolesToMask('input', roles);
}

/**
 * How the auto-connection search opens — the ASP default, producers + importers +
 * distributers (`TycoonSuppliesSearch.asp:29`). Export Warehouses stays a box the
 * player may tick, it just starts off.
 */
export const ASP_SUPPLIER_ROLES: ConnectionRoleFlags = {
  ...ALL_CONNECTION_ROLES,
  exporter: false,
};
