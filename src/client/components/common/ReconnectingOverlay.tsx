/**
 * ReconnectingOverlay — Connection status overlay.
 *
 * Two modes:
 * 1. Reconnecting: spinner + attempt counter + "Try now" button — titled "Server restarting"
 *    after a close with code 1012, otherwise "Connection lost"
 * 2. Disconnected with reason: error icon + explanation + "Return to home page" button
 */

import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { isSlowPhase, MAX_RECONNECT_ATTEMPTS } from '../../handlers/reconnect-utils';
import styles from './ReconnectingOverlay.module.css';
import spinnerStyles from '../startup/LoadingSpinner.module.css';

const REASON_MESSAGES: Record<string, string> = {
  connection_lost: 'Unable to reach the server after multiple attempts. Please check your internet connection.',
  session_expired: 'Your session has expired. Please log in again.',
};

function handleReturnHome() {
  window.location.href = '/';
}

export function ReconnectingOverlay() {
  const status = useGameStore((s) => s.status);
  const attempt = useGameStore((s) => s.reconnectAttempt);
  const disconnectReason = useGameStore((s) => s.disconnectReason);
  const serverRestarting = useGameStore((s) => s.serverRestarting);
  const client = useClient();

  const isReconnecting = status === 'reconnecting';
  const isDisconnectedWithReason = disconnectReason !== null;

  if (!isReconnecting && !isDisconnectedWithReason) return null;

  // Disconnected with reason — show error state
  if (isDisconnectedWithReason && !isReconnecting) {
    return (
      <div className={styles.overlay} role="alert" aria-live="assertive">
        <div className={styles.card}>
          <svg className={styles.errorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <p className={styles.title}>Connection lost</p>
          <p className={styles.errorMessage}>
            {REASON_MESSAGES[disconnectReason] ?? REASON_MESSAGES.connection_lost}
          </p>
          <button className={styles.homeBtn} onClick={handleReturnHome}>
            Return to home page
          </button>
        </div>
      </div>
    );
  }

  // Reconnecting — show spinner + retry
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.card}>
        <div className={spinnerStyles.spinner}>
          <div className={spinnerStyles.dot} />
          <div className={spinnerStyles.dot} />
          <div className={spinnerStyles.dot} />
        </div>
        <p className={styles.title}>{serverRestarting ? 'Server restarting' : 'Connection lost'}</p>
        {serverRestarting && (
          <p className={styles.attempt}>The game will reconnect automatically.</p>
        )}
        <p className={styles.attempt}>
          {isSlowPhase(attempt - 1)
            ? `Reconnecting… slow poll (attempt ${attempt} of ${MAX_RECONNECT_ATTEMPTS})`
            : `Reconnecting… attempt ${attempt} of ${MAX_RECONNECT_ATTEMPTS}`}
        </p>
        <button
          className={styles.retryBtn}
          onClick={() => client.onTriggerReconnect()}
        >
          Try now
        </button>
      </div>
    </div>
  );
}
