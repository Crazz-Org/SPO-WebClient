/**
 * Backup notice — the per-account "explain the backup once" flag.
 *
 * The first time a player meets the backup lamp, one dismissible explanation is shown; this
 * module remembers, per account, that it already ran. Same `storage()` guard and try/catch
 * discipline as `explored-blocks.ts:26-32`.
 *
 * The client has no server-side preference store, so "never again for that account" means
 * "never again for that account in this browser" — the same scope every other client-side
 * preference here has (`spo.explored.*`, `spo_settings`, `spo-last-seen-version`). An
 * unreadable or full `localStorage` degrades to explaining it again, never to a crash.
 */

export const BACKUP_NOTICE_KEY_PREFIX = 'spo.seen.backup.';

/** The key the "already explained" mark is written under — one per account. */
export function backupNoticeKey(player: string): string {
  return `${BACKUP_NOTICE_KEY_PREFIX}${player || 'player'}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True iff this account has already been shown the backup explanation. */
export function hasSeenBackupNotice(player: string): boolean {
  try {
    return storage()?.getItem(backupNoticeKey(player)) === '1';
  } catch {
    return false;
  }
}

/** Mark this account as having seen the backup explanation. */
export function markBackupNoticeSeen(player: string): void {
  try {
    storage()?.setItem(backupNoticeKey(player), '1');
  } catch {
    /* private mode or a storage that throws — the mark stays unset for this session */
  }
}
