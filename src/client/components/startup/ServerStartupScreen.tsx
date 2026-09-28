/**
 * ServerStartupScreen — Branded loading screen shown while the server
 * initialises its services. Driven by SSE progress from /api/startup-status.
 * Fades out automatically once the server reports ready.
 *
 * Shows rotating funny quotes and an orbiting-dots spinner so the user
 * knows the app isn't stuck. When the gateway is unreachable (issue 1048) the
 * quote gives way to an error sentence and a Retry button that reloads the page.
 */

import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/game-store';
import { LoginBackground } from '../login/LoginBackground';
import { useRotatingQuote } from '../../hooks/useRotatingQuote';
import styles from './ServerStartupScreen.module.css';
import spinnerStyles from './LoadingSpinner.module.css';
import overlayStyles from '../common/ReconnectingOverlay.module.css';
import { GATEWAY_UNREACHABLE_MESSAGE } from '../../handlers/reconnect-utils';
import { reloadPage } from '../../page-reload';

export function ServerStartupScreen() {
  const { ready } = useGameStore((s) => s.serverStartup);
  const unreachable = useGameStore((s) => s.serverStartup.unreachable === true);
  const [exiting, setExiting] = useState(false);
  const [unmounted, setUnmounted] = useState(false);
  const quote = useRotatingQuote('startup', 2500);

  useEffect(() => {
    if (ready && !exiting) {
      setExiting(true);
      const t = setTimeout(() => setUnmounted(true), 500);
      return () => clearTimeout(t);
    }
  }, [ready, exiting]);

  if (unmounted) return null;

  return (
    <div className={`${styles.root} ${exiting ? styles.exiting : ''}`}>
      <LoginBackground />
      <div className={styles.content}>
        <h1 className={styles.logo}>Starpeace Online</h1>
        <p className={styles.tagline}>Preparing your empire</p>

        <div className={spinnerStyles.spinner}>
          <div className={spinnerStyles.dot} />
          <div className={spinnerStyles.dot} />
          <div className={spinnerStyles.dot} />
        </div>

        {unreachable ? (
          <>
            <p className={overlayStyles.errorMessage} role="alert">{GATEWAY_UNREACHABLE_MESSAGE}</p>
            <button type="button" className={overlayStyles.retryBtn} onClick={() => reloadPage()}>Retry</button>
          </>
        ) : (
          <div className={spinnerStyles.quoteWrap}>
            <p className={spinnerStyles.quote} key={quote}>{quote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
