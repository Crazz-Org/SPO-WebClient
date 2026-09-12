/**
 * The session language — the `LangId` Voyager carried on every page it fetched and sent to
 * the world with `SetLanguage`.
 *
 * Voyager keeps one `ActiveLanguage : string = '0'` (`Voyager/ClientMLS.pas:6`), read from the
 * registry at start-up (`ClientMLS.pas:47-69`) and chosen in the Options screen
 * (`Voyager/URLHandlers/OptionsHandlerViewer.pas:593-600`). It is sent to the world right after
 * `RegisterEventsById` (`Voyager/URLHandlers/ServerCnxHandler.pas:2792`) and stored on the
 * server-side ClientView (`Interface Server/InterfaceServer.pas:1719-1722`), which is what the
 * Politics pages read back as `Obj.LangId`.
 */

/** The six ids are the six ASP instances `Five/<n>/`, each pinning its own in `Includes/language.inc`. */
export type LanguageId = '0' | '1' | '2' | '3' | '4' | '5';

export const DEFAULT_LANGUAGE_ID: LanguageId = '0';

/** Named by the first string of each instance's `language/Voyager.lng`. */
export const LANGUAGES: ReadonlyArray<{ id: LanguageId; label: string }> = [
  { id: '0', label: 'English' },
  { id: '1', label: 'Español' },
  { id: '2', label: 'Français' },
  { id: '3', label: 'Deutsch' },
  { id: '4', label: 'Italiano' },
  { id: '5', label: 'Português' },
];

/**
 * Untrusted input (a WebSocket field, a localStorage blob) to a catalogued id.
 * Anything that is not one of the six ids becomes the default — this is the single gate that
 * keeps a client-supplied value out of an RDO frame and out of a URL.
 */
export function normalizeLanguageId(raw: unknown): LanguageId {
  if (typeof raw !== 'string') return DEFAULT_LANGUAGE_ID;
  const match = LANGUAGES.find((lang) => lang.id === raw);
  return match ? match.id : DEFAULT_LANGUAGE_ID;
}

/**
 * Append the language to an ASP URL the way Voyager did: `?LangId=` when the URL carries no
 * query, `&LangId=` otherwise (`Voyager/URLHandlers/HTMLHandler.pas:141-143`).
 *
 * Idempotent — a URL that already carries a `LangId` is returned untouched, because cached
 * form-action URLs are re-fetched through the same boundary.
 */
export function withLangId(url: string, languageId: string): string {
  if (/[?&]LangId=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}LangId=${encodeURIComponent(languageId)}`;
}
