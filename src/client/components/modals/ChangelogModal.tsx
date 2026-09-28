/**
 * ChangelogModal — "What's New": the player notes, grouped by date, newest first.
 *
 * Auto-opens only when a player note has not been seen yet (via the useChangelogCheck hook).
 * Also opened by clicking the VersionBadge; with no notes it says so.
 */

import { X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { PLAYER_NOTES, markAllNotesSeen, type PlayerNote } from '../../player-notes';
import styles from './ChangelogModal.module.css';

const DOT_CLASS: Record<string, string> = {
  added: styles.dotAdded,
  fixed: styles.dotFixed,
  changed: styles.dotChanged,
};

/** Consecutive notes of the same date, in the (already sorted) order of PLAYER_NOTES. */
const NOTE_GROUPS: { date: string; notes: PlayerNote[] }[] = [];
for (const note of PLAYER_NOTES) {
  const last = NOTE_GROUPS[NOTE_GROUPS.length - 1];
  if (last && last.date === note.date) last.notes.push(note);
  else NOTE_GROUPS.push({ date: note.date, notes: [note] });
}

export function ChangelogModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);

  if (modal !== 'changelog') return null;

  const handleClose = () => {
    markAllNotesSeen();
    closeModal();
  };

  return (
    <>
      <div className={styles.backdrop} onClick={handleClose} />
      <div className={styles.modal} role="dialog" aria-label="What's New">
        <div className={styles.header}>
          <h2 className={styles.title}>What&apos;s New</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.content}>
          {NOTE_GROUPS.length === 0 ? (
            <p className={styles.entry}>Nothing new to report yet.</p>
          ) : (
            NOTE_GROUPS.map((group) => (
              <section key={group.date} className={styles.release}>
                <h3 className={styles.versionHeader}>
                  <span className={styles.date}>{group.date}</span>
                </h3>
                <ul className={styles.entries}>
                  {group.notes.map((note) => (
                    <li key={note.id} className={styles.entry}>
                      <span className={`${styles.dot} ${DOT_CLASS[note.type] ?? ''}`} />
                      <span>{note.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
