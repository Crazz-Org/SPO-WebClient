import type { PoliticalRoleInfo } from '@/shared/types';

/**
 * The office a player is acting as, as the legacy city-planning header showed it.
 *
 * Precedence follows `MayorOptions.asp:74-90`: president first, then mayor, then
 * minister — the legacy page guarded its mayor block on the company NOT being a
 * ministry, so a player holding both offices read as the higher one. A capital
 * mayor reads as president, the same call `client-bridge.ts:958` already makes,
 * so the client has one answer and not two.
 *
 * Returns `null` when the player holds no office — the caller renders no header.
 */
export function officeLabel(role: PoliticalRoleInfo | undefined): string | null {
  if (!role) return null;
  if (role.isPresident || role.isCapitalMayor) return 'President';
  if (role.isMayor) return role.town ? `Mayor of ${role.town}` : 'Mayor';
  if (role.isMinister) return role.ministry ? `Minister of ${role.ministry}` : 'Minister';
  return null;
}
