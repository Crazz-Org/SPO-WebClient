import { useEffect } from 'react';
import { APP_VERSION } from '../version';
import { useUiStore } from '../store/ui-store';

const LAST_SEEN_KEY = 'spo-last-seen-version';

/**
 * Opens the changelog modal for a returning player whose stored version differs from the
 * current one. A first visit (no stored version) records the version silently, with no popup;
 * unavailable storage means no popup, never a crash.
 */
export function useChangelogCheck() {
  const openModal = useUiStore((s) => s.openModal);

  useEffect(() => {
    let lastSeen: string | null;
    try {
      lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      if (lastSeen === null) {
        localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
        return;
      }
    } catch {
      return;
    }
    if (lastSeen !== APP_VERSION) {
      const timer = setTimeout(() => openModal('changelog'), 500);
      return () => clearTimeout(timer);
    }
  }, [openModal]);
}
