/**
 * Visual theme — which look the player chose: "Corporate Empire" (`empire`, the base palette
 * in `styles/design-tokens.css`) or the look of the original Voyager client (`legacy`,
 * `styles/theme-legacy.css`).
 *
 * One string in localStorage, keyed by `THEME_KEY`, modelled on `ui-version.ts`. The stored
 * choice wins. A fresh browser takes `?theme=` from the page URL (how a channel such as the
 * desktop shell picks its default), then `window.__SPO_THEME__` (the gateway's `SPO_THEME`,
 * served through /spo-runtime-config.js), then `empire`. A corrupt or hostile value reads as
 * `empire`, never as a crash.
 *
 * The theme is one attribute, `<html data-theme="legacy">`; `empire` removes it so the base
 * `:root` tokens apply untouched. Nothing else changes: same components, same stores.
 */

export type Theme = 'empire' | 'legacy';

export const THEME_KEY = 'spo_theme';

export const THEMES: readonly Theme[] = ['empire', 'legacy'];

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Only the two exact strings are themes; anything else is nothing. */
function asTheme(raw: unknown): Theme | null {
  return raw === 'legacy' || raw === 'empire' ? raw : null;
}

function storedTheme(): Theme | null {
  try {
    return asTheme(storage()?.getItem(THEME_KEY));
  } catch {
    return null;
  }
}

/** `?theme=` on the page URL — a channel's first-visit default, never a stored choice. */
function urlTheme(): Theme | null {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    return asTheme(new URLSearchParams(window.location.search).get('theme'));
  } catch {
    return null;
  }
}

/** The gateway's `SPO_THEME`, assigned by /spo-runtime-config.js before the bundle runs. */
function gatewayTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  return asTheme((window as unknown as Record<string, unknown>).__SPO_THEME__);
}

/** Stored choice, else the URL's `?theme=`, else the gateway default, else `empire`. */
export function loadTheme(): Theme {
  return storedTheme() ?? urlTheme() ?? gatewayTheme() ?? 'empire';
}

export function saveTheme(theme: Theme): void {
  try {
    storage()?.setItem(THEME_KEY, theme);
  } catch {
    /* private mode or a storage that throws — the choice just won't be there next time */
  }
}

/** Stamps the theme on `<html>`; `empire` clears the attribute so the base tokens apply. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'empire') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
