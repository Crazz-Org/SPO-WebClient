import { ZONE_TYPES, ZoneType } from '@/shared/types';
import type { PoliticalRoleInfo, ZoneTypeInfo } from '@/shared/types';

/**
 * The zone types a player's office actually let them paint, as the legacy
 * `MayorOptions.asp` laid out its tiles.
 *
 * Mayor / capital mayor / president (`MayorOptions.asp:96-232`, `ZoneId=` at
 * `:134 :150 :164 :180 :194 :210 :224`): 3, 4, 5, 7, 6, 8, 9, in that order — the
 * page lays 7 (Offices & Commercial) before 6 (Industrial).
 *
 * Minister, by ministry (`MayorOptions.asp:253-378`): Housing -> 3,4,5; Commerce
 * -> 7,9; Heavy Industry / Light Industry / Agriculture -> 6; Education / Health /
 * Defense -> 8.
 *
 * Everyone the page rendered for got De-zone (`MayorOptions.asp:381-395`, outside
 * every `if`) — appended here regardless of office.
 *
 * Reserved (1) is present only inside an HTML comment (`:231-249`) and Residential
 * (2) has no tile anywhere in the page — neither is ever offered, to anyone.
 */

const BY_ID = new Map(ZONE_TYPES.map((z) => [z.id, z]));

const MAYOR_ZONE_IDS: ZoneType[] = [
  ZoneType.HI_RESIDENTIAL,
  ZoneType.MID_RESIDENTIAL,
  ZoneType.LO_RESIDENTIAL,
  ZoneType.COMMERCIAL,
  ZoneType.INDUSTRIAL,
  ZoneType.CIVICS,
  ZoneType.OFFICES,
];

const MINISTRY_ZONE_IDS: Record<string, ZoneType[]> = {
  housing: [ZoneType.HI_RESIDENTIAL, ZoneType.MID_RESIDENTIAL, ZoneType.LO_RESIDENTIAL],
  commerce: [ZoneType.COMMERCIAL, ZoneType.OFFICES],
  'heavy industry': [ZoneType.INDUSTRIAL],
  'light industry': [ZoneType.INDUSTRIAL],
  agriculture: [ZoneType.INDUSTRIAL],
  education: [ZoneType.CIVICS],
  health: [ZoneType.CIVICS],
  defense: [ZoneType.CIVICS],
};

function normaliseMinistry(ministry: string): string {
  return ministry.trim().toLowerCase().replace(/^ministry of /, '');
}

function toZoneTypeInfos(ids: ZoneType[]): ZoneTypeInfo[] {
  return ids.map((id) => BY_ID.get(id)).filter((z): z is ZoneTypeInfo => z !== undefined);
}

export function zonePickerOptions(role: PoliticalRoleInfo | undefined): ZoneTypeInfo[] {
  if (!role) return [];

  if (role.isPresident || role.isCapitalMayor || role.isMayor) {
    return toZoneTypeInfos([...MAYOR_ZONE_IDS, ZoneType.NONE]);
  }

  if (role.isMinister) {
    const ids = MINISTRY_ZONE_IDS[normaliseMinistry(role.ministry)] ?? [];
    return toZoneTypeInfos([...ids, ZoneType.NONE]);
  }

  return [];
}
