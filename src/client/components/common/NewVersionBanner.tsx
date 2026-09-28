/**
 * NewVersionBanner — shown after a reconnect finds that the gateway now serves a different
 * client bundle (issue 1050). No forced reload mid-game and no close control (maintainer
 * decision 2026-09-27): the player reloads when it suits them.
 */

import { useUiStore } from '../../store/ui-store';
import { reloadPage } from '../../page-reload';
import styles from './NewVersionBanner.module.css';

export function NewVersionBanner() {
  const newVersionAvailable = useUiStore((s) => s.newVersionAvailable);
  if (!newVersionAvailable) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.text}>New version available</span>
      <button type="button" className={styles.reloadBtn} onClick={() => reloadPage()}>
        Reload
      </button>
    </div>
  );
}
