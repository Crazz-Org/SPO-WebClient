/**
 * CrashScreen — the player-facing screen shown when the React tree crashes.
 *
 * Mounted by the root boundary in main.tsx, so it also covers a lazy chunk that no longer
 * exists after a deploy (the rejected import is thrown during render). It reads no store and
 * no client context: it shows exactly when the tree under it is broken. The only action is a
 * full page reload — the old client logs out on `beforeunload` and the new page starts clean.
 */

import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { reloadPage } from '../../page-reload';
import styles from './CrashScreen.module.css';

export function CrashScreen() {
  return (
    <div className={styles.overlay} role="alert" aria-live="assertive">
      <div className={styles.card}>
        <p className={styles.title}>Something went wrong</p>
        <p className={styles.message}>
          Something went wrong and the game stopped responding. Reloading the page usually fixes it.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.reloadBtn} onClick={() => reloadPage()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

/** The app's root boundary: any render crash below it ends on the crash screen. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<CrashScreen />}>{children}</ErrorBoundary>;
}
