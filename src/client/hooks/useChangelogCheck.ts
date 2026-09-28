import { useEffect } from 'react';
import { useUiStore } from '../store/ui-store';
import { takeUnseenNotes } from '../player-notes';

/**
 * Opens the "What's New" modal when at least one player note has not been seen in this browser.
 * A first visit (or a browser without the seen-notes key) records every note id silently, with
 * no popup; unavailable storage means no popup, never a crash. With no notes it never opens.
 */
export function useChangelogCheck() {
  const openModal = useUiStore((s) => s.openModal);

  useEffect(() => {
    if (takeUnseenNotes().length === 0) return;
    const timer = setTimeout(() => openModal('changelog'), 500);
    return () => clearTimeout(timer);
  }, [openModal]);
}
