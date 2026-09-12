/**
 * AuthStage — Full-screen centered authentication card.
 *
 * Stage A of the cinematic login flow.
 * Glassmorphed card with username/password + gold "Enter the World" button.
 */

import { useState, useCallback, useEffect, type KeyboardEvent } from 'react';
import { GlassCard } from '../common';
import { showToast } from '../common/Toast';
import { APP_VERSION, BUILD_DATE } from '../../version';
import type { RememberedSession } from '../../store/remembered-session';
import { LANGUAGES, normalizeLanguageId } from '@/shared/language';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import styles from './AuthStage.module.css';

interface AuthStageProps {
  onConnect: (username: string, password: string) => void;
  isLoading: boolean;
  status: string;
  rememberedSession?: RememberedSession | null;
  resumeTarget?: RememberedSession | null;
  onResume?: (password: string) => void;
  onForgetSession?: () => void;
}

/**
 * Single-user mode: the gateway serves one local player, so remembering a username is safe.
 * Read per render rather than once at module load — `/spo-runtime-config.js` sets the flag
 * before the app mounts, and a captured constant would freeze whichever value happened to
 * be there when this module was first evaluated.
 */
function isSingleUserMode(): boolean {
  return typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__SPO_SINGLE_USER__ === true;
}

/**
 * Registration page for "Create an account". Set by `/spo-runtime-config.js` as
 * `window.__SPO_REGISTER_URL__`; empty means no action is offered. Only an http(s) URL is
 * honoured — anything else is treated as unset rather than rendered into an href.
 */
function getRegisterUrl(): string {
  if (typeof window === 'undefined') return '';
  const raw = (window as unknown as Record<string, unknown>).__SPO_REGISTER_URL__;
  if (typeof raw !== 'string') return '';
  return /^https?:\/\//i.test(raw) ? raw : '';
}

export function AuthStage({
  onConnect, isLoading, status, rememberedSession, resumeTarget, onResume, onForgetSession,
}: AuthStageProps) {
  const isSingleUser = isSingleUserMode();
  const registerUrl = getRegisterUrl();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberUsername, setRememberUsername] = useState(false);
  const client = useClient();
  // The language must be picked before the login is sent — it travels with it.
  const languageId = normalizeLanguageId(useGameStore((s) => s.settings.languageId));

  const handleLanguageChange = useCallback(
    (value: string) => {
      const picked = normalizeLanguageId(value);
      useGameStore.getState().updateSettings({ languageId: picked });
      client.onSettingsChange({ ...useGameStore.getState().settings, languageId: picked });
    },
    [client],
  );

  // Load saved username on mount (single-user mode only)
  useEffect(() => {
    if (!isSingleUser) return;
    const saved = localStorage.getItem('spo_last_username');
    if (saved) {
      setUsername(saved);
      setRememberUsername(true);
    }
  }, [isSingleUser]);

  // The remembered record only pre-fills the username when the field is still empty —
  // the single-user effect above wins if both apply.
  useEffect(() => {
    if (!rememberedSession) return;
    setUsername((prev) => (prev === '' ? rememberedSession.username : prev));
  }, [rememberedSession]);

  const handleResume = useCallback(() => {
    if (!password.trim()) {
      showToast('Enter your password', 'warning');
      return;
    }
    onResume?.(password);
  }, [password, onResume]);

  const handleConnect = useCallback(() => {
    if (!username.trim() || !password.trim()) {
      showToast('Enter username and password', 'warning');
      return;
    }
    if (isSingleUser) {
      if (rememberUsername) {
        localStorage.setItem('spo_last_username', username);
      } else {
        localStorage.removeItem('spo_last_username');
      }
    }
    onConnect(username, password);
  }, [isSingleUser, username, password, rememberUsername, onConnect]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleConnect();
    },
    [handleConnect],
  );

  return (
    <div className={styles.stage}>
      <h1 className={styles.logo}>STARPEACE ONLINE</h1>
      <p className={styles.tagline}>Build your empire. Shape the world.</p>

      <GlassCard maxWidth={380} className={styles.authCard}>
        {resumeTarget ? (
          <>
            <p className={styles.resumeStatus}>
              Returning to {resumeTarget.worldName} as {resumeTarget.companyName}…
            </p>
            <button className={styles.connectBtn} disabled>
              Connecting...
            </button>
          </>
        ) : (
          <>
            <div className={styles.fieldGroup}>
              <input
                type="text"
                className={styles.input}
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                autoComplete="username"
              />
              <input
                type="password"
                className={styles.input}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
              />
              <select
                aria-label="Language"
                className={styles.languageSelect}
                value={languageId}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>{lang.label}</option>
                ))}
              </select>
            </div>
            {isSingleUser && (
              <label className={styles.rememberMe}>
                <input
                  type="checkbox"
                  checked={rememberUsername}
                  onChange={(e) => setRememberUsername(e.target.checked)}
                />
                Remember username
              </label>
            )}
            {rememberedSession && (
              <div className={styles.resumeRow}>
                <button
                  className={styles.resumeBtn}
                  onClick={handleResume}
                  aria-label={`Return to ${rememberedSession.worldName} as ${rememberedSession.companyName}`}
                >
                  Return to {rememberedSession.worldName} as {rememberedSession.companyName}
                </button>
                <button
                  type="button"
                  className={styles.forgetBtn}
                  onClick={onForgetSession}
                  aria-label="Forget remembered session"
                >
                  ×
                </button>
              </div>
            )}
            <button
              className={styles.connectBtn}
              onClick={handleConnect}
              disabled={isLoading || status === 'connecting'}
            >
              {isLoading ? 'Connecting...' : 'Enter the World'}
            </button>
            {registerUrl && (
              <a
                className={styles.registerLink}
                href={registerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Create an account
              </a>
            )}
          </>
        )}
      </GlassCard>

      <span className={styles.version}>Beta {APP_VERSION} ({BUILD_DATE})</span>
    </div>
  );
}
