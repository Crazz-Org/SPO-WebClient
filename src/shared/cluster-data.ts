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
