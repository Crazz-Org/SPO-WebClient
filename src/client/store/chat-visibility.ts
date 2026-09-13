/**
 * Chat visibility — whether the desktop ChatStrip is mounted at all.
 *
 * One boolean in localStorage, keyed by `CHAT_VISIBLE_KEY`. Modelled on
 * `remembered-session.ts`'s `storage()` guard and try/catch discipline — a corrupt or absent
 * value must read as "chat visible" (the default a player who never touched the control keeps),
 * never as a crash.
 */

export const CHAT_VISIBLE_KEY = 'spo_chat_visible';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Default is `true`. Only the exact stored string `'false'` yields `false`. */
export function loadChatVisible(): boolean {
  try {
    const raw = storage()?.getItem(CHAT_VISIBLE_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function saveChatVisible(visible: boolean): void {
  try {
    storage()?.setItem(CHAT_VISIBLE_KEY, String(visible));
  } catch {
    /* private mode or a storage that throws — the record just won't be there next time */
  }
}
