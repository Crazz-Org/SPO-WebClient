/**
 * BackupNotice — the one-time explanation shown the first time a player meets a
 * server backup (`serverBusy` lamp lighting in `StatusPill`).
 *
 * Persisted per account in `localStorage`, same guard and try/catch discipline
 * as `store/explored-blocks.ts:12-32` — jsdom and private-mode browsers both
 * throw on access, never crash the component.
 */

import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/game-store';
import styles from './BackupNotice.module.css';

export const BACKUP_SEEN_KEY_PREFIX = 'spo.backupSeen.';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function hasSeen(username: string): boolean {
  try {
    return storage()?.getItem(`${BACKUP_SEEN_KEY_PREFIX}${username}`) === '1';
  } catch {
    return false;
  }
}

function markSeen(username: string): void {
  try {
    storage()?.setItem(`${BACKUP_SEEN_KEY_PREFIX}${username}`, '1');
  } catch {
    // Private-mode / quota-full localStorage — nothing to persist to, just close the card.
  }
}

export function BackupNotice() {
  const serverBusy = useGameStore((s) => s.serverBusy);
  const username = useGameStore((s) => s.username);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (serverBusy && username && !hasSeen(username)) {
      setVisible(true);
    }
  }, [serverBusy, username]);

  if (!visible) return null;

  const dismiss = () => {
    markSeen(username);
    setVisible(false);
  };

  return (
    <div className={styles.card} role="dialog" aria-labelledby="backup-notice-title">
      <h2 id="backup-notice-title" className={styles.title}>The world is saving</h2>
      <p className={styles.body}>
        Every so often, the world server writes a backup of everything in it. It takes a
        moment, and some actions may be slow until it finishes — nothing is lost.
      </p>
      <button type="button" className={styles.dismiss} onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
