/**
 * The zone types a given office is offered in the paint picker — the legacy
 * page's own restriction, `MayorOptions.asp`. `ZONE_TYPES` itself carries all
 * ten entries (map/minimap colour source too); this filters that catalogue
 * down to the ids one office actually saw a button for.
 *
 * Precedence mirrors `officeLabel()` (`office-label.ts:14-19`) so the header
 * and the list can never disagree: president/capital-mayor, then mayor, then
 * minister, then no office.
 */

import { ZONE_TYPES, ZoneType } from '@/shared/types';
import type { PoliticalRoleInfo, ZoneTypeInfo } from '@/shared/types';

/** Mayor and President — `MayorOptions.asp:96`, buttons `:134-224`. */
const MAYOR_ZONE_IDS = [3, 4, 5, 7, 6, 8, 9, 0];

/**
 * Ministry name (trimmed, lower-cased) → the zone ids that ministry's
 * options block offers, De-zone appended (`MayorOptions.asp:253-378`, the
 * `end if`s closing at `:379` and the shared De-zone cell at `:381-395`).
 */
const MINISTRY_ZONE_IDS: Record<string, number[]> = {
  housing: [3, 4, 5, 0],
  commerce: [7, 9, 0],
  'heavy industry': [6, 0],
  'light industry': [6, 0],
  agriculture: [6, 0],
  education: [8, 0],
  health: [8, 0],
  defense: [8, 0],
};

/** An unrecognised or empty ministry falls through to the ASP `else` at `:381` — De-zone alone. */
const UNKNOWN_MINISTRY_ZONE_IDS = [0];

function zoneIdsForRole(role: PoliticalRoleInfo): number[] {
  if (role.isPresident || role.isCapitalMayor || role.isMayor) return MAYOR_ZONE_IDS;
  if (role.isMinister) {
    const key = role.ministry.trim().toLowerCase();
    return MINISTRY_ZONE_IDS[key] ?? UNKNOWN_MINISTRY_ZONE_IDS;
  }
  return [];
}

/** Looked up by id rather than filtered, since ids do not appear in `ZONE_TYPES` order for every office. */
const ZONE_TYPES_BY_ID = new Map<ZoneType, ZoneTypeInfo>(ZONE_TYPES.map((z) => [z.id, z]));

export function zonesForOffice(role: PoliticalRoleInfo | undefined): ZoneTypeInfo[] {
  if (!role) return [];
  return zoneIdsForRole(role)
    .map((id) => ZONE_TYPES_BY_ID.get(id))
    .filter((z): z is ZoneTypeInfo => z !== undefined);
}
