/**
 * Cluster Data — Static metadata for company creation cluster selection.
 *
 * Display names and ordering extracted from the original game's
 * createCompany.asp / toptabs.asp / info.asp pages.
 */

/** Canonical cluster IDs in display order (matches original tab order). */
export const CLUSTER_IDS = ['Dissidents', 'PGI', 'Mariko', 'Moab', 'Magna'] as const;

export type ClusterId = (typeof CLUSTER_IDS)[number];

/** Human-readable display names for each cluster. */
export const CLUSTER_DISPLAY_NAMES: Record<ClusterId, string> = {
  Dissidents: 'Dissidents',
  PGI: 'PGI',
  Mariko: 'Mariko Enterprises',
  Moab: 'The Moab',
  Magna: 'Magna Corp',
};

/** Server cap on a company name — Kernel/World.pas:4133. */
export const MAX_COMPANY_NAME_LENGTH = 50;

/**
 * Characters the server refuses in a company name — ValidName, Cache/CacheCommon.pas:64,110-125,
 * with BackslashChar '}', NameSeparator '{' and LinkSep '%' from Cache/SpecialChars.pas:6-8.
 * '&' and '+' are NOT in the server list; the old client ban came from the ASP page's URL, not
 * from the server (NewLogon/entername.asp:47,57).
 */
const SERVER_FORBIDDEN_CHARS = /[\\/:*?"<>|{}%\0]/;

/**
 * Returns the reason the server would refuse `name` (already trimmed), or null when the name
 * passes every check `RDONewCompany` applies before creating the company.
 */
export function companyNameProblem(name: string): string | null {
  if (name.length === 0) return 'Company name cannot be empty';
  if (name.length > MAX_COMPANY_NAME_LENGTH) {
    return `Company name must be ${MAX_COMPANY_NAME_LENGTH} characters or less`;
  }
  if (SERVER_FORBIDDEN_CHARS.test(name)) {
    return 'Company name cannot contain: \\ / : * ? " < > | { } %';
  }
  if (name.includes('..')) return 'Company name cannot contain ".."';
  return null;
}

/**
 * Refusal sentence shown in place of the name field when the Magna seal is locked —
 * verbatim from `~/SPO-ASP/Five/0/language/NewLogon.lng:86`, shown by
 * `NewLogon/entername.asp:123-127` when `CanBuildAdvanced = 0`.
 */
export const MAGNA_REFUSAL =
  'Sorry, you need to achieve the level Paradigm or to have at least 100 Nobility Points to have access to the Magna Seal.';

/**
 * Mirrors `TTycoon.GetCanBuildAdvanced` (`Kernel/Kernel.pas:13155`):
 * `(tier >= 4) or ((tier >= WL.MinLevelToBuildAdvanced) and (GetNobPoints >= 100))`.
 * The world's `MinLevelToBuildAdvanced` term is not known to the client; this uses the
 * two-clause form the reference client's own sentence states — Paradigm (tier 4) or 100
 * nobility. An unknown profile (both undefined) is refused, matching the ASP's
 * `CanBuildAdvanced = 0` fallback when `SetPath` fails.
 */
export function canBuildAdvanced(
  levelTier: number | undefined,
  nobPoints: number | undefined,
): boolean {
  return (levelTier ?? 0) >= 4 || (nobPoints ?? 0) >= 100;
}
