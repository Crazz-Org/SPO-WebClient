/**
 * Stale tab after a deploy (issue 1050).
 *
 * A deploy replaces every hashed file under `assets/`. A tab loaded before it still asks for
 * the old lazy chunks, which now 404; Vite's preload helper then fires a cancelable
 * `vite:preloadError` on `window`. We reload once per entry bundle; a bundle that still fails
 * after that reload is left to Vite's re-throw and the root error boundary (no loop).
 *
 * After a reconnect, `checkServedBundle` compares the entry the gateway now serves with the
 * page's own, so the UI can offer a reload (never forced mid-game).
 */

import { reloadPage } from './page-reload';

export const CHUNK_RELOAD_KEY = 'spo-chunk-reload';
/** "app.js" (dev) or "assets/app.<hash>.js" (the gateway's rewrite). */
const ENTRY_SRC = /(?:^|\/)app(?:\.[^/]+)?\.js$/;
/** The hashed entry path in the served index.html. */
const SERVED_ENTRY = /src="(assets\/app\.[^"]+\.js)"/;

/** The page's own entry path: the raw src attribute (not `.src`, which is absolutised). */
export function pageEntryPath(): string | null {
  const scripts = document.querySelectorAll('script[type="module"][src]');
  for (const script of Array.from(scripts)) {
    const src = script.getAttribute('src');
    if (src && ENTRY_SRC.test(src)) return src;
  }
  return null;
}

/**
 * `vite:preloadError` handler — at most one automatic reload per entry bundle. Never calls
 * `preventDefault()`: a second failure must reach the root error boundary.
 */
export function handlePreloadError(): void {
  const entry = pageEntryPath();
  if (!entry) return;
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === entry) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, entry);
  } catch {
    return; // no storage means no guard, and a reload without a guard could loop
  }
  reloadPage();
}

export function installStaleBundleReload(): void {
  window.addEventListener('vite:preloadError', handlePreloadError);
}

/**
 * True only when both the page's and the served entry paths are found and differ.
 * Never rejects. The request is exactly `/` — the gateway maps only that URL to index.html.
 */
export async function checkServedBundle(): Promise<boolean> {
  const own = pageEntryPath();
  if (!own) return false;
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return false;
    const served = SERVED_ENTRY.exec(await res.text())?.[1];
    return served !== undefined && served !== own;
  } catch {
    return false;
  }
}
