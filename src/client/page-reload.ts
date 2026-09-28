/**
 * The one place the client reloads the page. A module function so jsdom tests can mock it
 * (jsdom forbids redefining window.location.reload). Used by logout (issue 1042) and by the
 * startup screen's Retry (issue 1048).
 */
export function reloadPage(): void {
  window.location.reload();
}
