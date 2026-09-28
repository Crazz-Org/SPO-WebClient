/**
 * Player notes — the content of the in-game "What's New" popup.
 *
 * Each note is written by hand, in the pull request that ships a change a player can notice,
 * into `player-notes.json`. Nothing here is derived from commit subjects: a change without a
 * note shows nothing in-game.
 *
 * Which notes a player has already seen is remembered as a set of note ids under one
 * `localStorage` key. Same `storage()` guard and try/catch discipline as `backup-notice.ts`:
 * an unavailable or unreadable storage means no popup, never a crash.
 */

import rawNotes from './player-notes.json';

export type PlayerNoteType = 'added' | 'fixed' | 'changed';

export interface PlayerNote {
  /** Issue number of the card that shipped the change (the PR number when there is no card). */
  id: number;
  /** `YYYY-MM-DD`, the day the note was written. */
  date: string;
  type: PlayerNoteType;
  /** One plain sentence, at most 200 characters. */
  text: string;
}

export const SEEN_NOTES_KEY = 'spo-seen-notes';

/** Newest date first; on the same date, the higher id first. Returns a new array. */
export function sortPlayerNotes(notes: readonly PlayerNote[]): PlayerNote[] {
  return [...notes].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
}

export const PLAYER_NOTES: readonly PlayerNote[] = sortPlayerNotes(rawNotes as PlayerNote[]);

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored ids, or null when the key is absent, unparseable or not an array. */
function readSeenIds(store: Storage): number[] | null {
  const raw = store.getItem(SEEN_NOTES_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((v): v is number => typeof v === 'number');
}

/** Record every given note as seen. A storage failure is swallowed. */
export function markAllNotesSeen(notes: readonly PlayerNote[] = PLAYER_NOTES): void {
  try {
    storage()?.setItem(SEEN_NOTES_KEY, JSON.stringify(notes.map((n) => n.id)));
  } catch {
    // storage full or denied — the notes will simply show again next time
  }
}

/**
 * The notes this browser has not seen yet.
 *
 * A first visit — or a browser that only holds the old version key — records every current id
 * silently and returns nothing, so no popup opens. The seen state is a set of ids rather than
 * "the newest id seen" because a card with a lower issue number can merge after a higher one.
 * This never marks anything seen when the key is present: closing the modal does.
 */
export function takeUnseenNotes(notes: readonly PlayerNote[] = PLAYER_NOTES): PlayerNote[] {
  try {
    const store = storage();
    if (!store) return [];
    const seen = readSeenIds(store);
    if (seen === null) {
      markAllNotesSeen(notes);
      return [];
    }
    const seenSet = new Set(seen);
    return notes.filter((n) => !seenSet.has(n.id));
  } catch {
    return [];
  }
}
