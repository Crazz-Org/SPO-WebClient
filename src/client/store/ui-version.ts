/**
 * UI version — which in-game interface the player chose: the classic one (`v1`) or the
 * experimental "Command Deck" (`v2`, `src/client/v2/`).
 *
 * One string in localStorage, keyed by `UI_VERSION_KEY`. Modelled on `chat-visibility.ts`'s
 * `storage()` guard and try/catch discipline — a corrupt or absent value must read as the
 * classic interface, never as a crash.
 */

export type UiVersion = 'v1' | 'v2';

export const UI_VERSION_KEY = 'spo_ui_version';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Default is `'v1'`. Only the exact stored string `'v2'` yields `'v2'`. */
export function loadUiVersion(): UiVersion {
  try {
    const raw = storage()?.getItem(UI_VERSION_KEY);
    return raw === 'v2' ? 'v2' : 'v1';
  } catch {
    return 'v1';
  }
}

export function saveUiVersion(version: UiVersion): void {
  try {
    storage()?.setItem(UI_VERSION_KEY, version);
  } catch {
    /* private mode or a storage that throws — the choice just won't be there next time */
  }
}
