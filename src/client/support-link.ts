/**
 * Support entry point — Settings and the mobile menu send a stuck player here.
 *
 * The destination is configuration (`SPO_SUPPORT_URL` -> `window.__SPO_SUPPORT_URL__`), unlike
 * the legacy Voyager toolbar's hardcoded support page (`toolbar.asp:285`). Unlike the register
 * link, an absent configuration does not mean "no action" — the entry is always offered, so a
 * shipped default stands in when the gateway announces nothing.
 */

/** Used when the gateway announces no `SPO_SUPPORT_URL` — the entry is never dead. */
export const DEFAULT_SUPPORT_URL = 'https://github.com/Crazz-Org/SPO-WebClient/issues';

/**
 * Read per call, never captured at module load — `/spo-runtime-config.js` sets the global
 * before the app mounts, and a captured constant would freeze whichever value happened to be
 * there when this module was first evaluated. Only an http(s) URL is honoured.
 */
export function getSupportUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_SUPPORT_URL;
  const raw = (window as unknown as Record<string, unknown>).__SPO_SUPPORT_URL__;
  if (typeof raw !== 'string') return DEFAULT_SUPPORT_URL;
  return /^https?:\/\//i.test(raw) ? raw : DEFAULT_SUPPORT_URL;
}

/**
 * Appends the legacy parameter names (`toolbar.asp:285`) so a report can be identified, omitting
 * either that is empty. Preserves any query string `base` already carries.
 */
export function buildSupportUrl(base: string, worldName: string, username: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  if (worldName) url.searchParams.set('WorldName', worldName);
  if (username) url.searchParams.set('UserName', username);
  return url.toString();
}
