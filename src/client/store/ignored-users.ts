/**
 * Ignored-players list — the browser-local mute list behind issue #622.
 *
 * Reader/writer only, no React, no store import. Modelled on
 * `legacy-bookmarks.ts`'s `storage()` guard and per-world-per-player key shape.
 */

export const IGNORED_KEY_PREFIX = 'spo.ignored.';

/** One key per world and player — the shape legacy-bookmarks.ts already uses. */
export function ignoredKey(world: string, player: string): string {
  return `${IGNORED_KEY_PREFIX}${world || 'world'}.${player || 'player'}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Anything unreadable is an empty list: a corrupt key must never mute nobody-knows-who. */
export function readIgnored(key: string): string[] {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    return [];
  }
}

export function writeIgnored(key: string, names: string[]): void {
  try {
    storage()?.setItem(key, JSON.stringify(names));
  } catch {
    /* private mode or a storage that throws — the list just won't be there next time */
  }
}
