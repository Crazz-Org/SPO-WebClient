/**
 * Default channel — the chat channel a player pinned to rejoin automatically on login.
 *
 * One string in localStorage, keyed by `DEFAULT_CHANNEL_KEY`. Modelled on
 * `chat-visibility.ts`'s `storage()` guard and try/catch discipline — a corrupt or absent
 * value must read as "no default" (today's behaviour), never as a crash.
 */

export const DEFAULT_CHANNEL_KEY = 'spo_default_channel';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The display name the player pinned, or `null` when nothing is pinned. */
export function loadDefaultChannel(): string | null {
  try {
    const raw = storage()?.getItem(DEFAULT_CHANNEL_KEY);
    return raw ? raw : null;
  } catch {
    return null;
  }
}

/** `null` clears the preference (removeItem); a name stores it verbatim. */
export function saveDefaultChannel(name: string | null): void {
  try {
    if (name) {
      storage()?.setItem(DEFAULT_CHANNEL_KEY, name);
    } else {
      storage()?.removeItem(DEFAULT_CHANNEL_KEY);
    }
  } catch {
    /* private mode or a storage that throws — the record just won't be there next time */
  }
}
