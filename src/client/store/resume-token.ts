/**
 * Resume token — the key that lets this tab re-attach its parked gateway session.
 *
 * The gateway pushes a fresh token (EVENT_SESSION_RESUME_TOKEN) once the world is entered and
 * after every re-attach; the client keeps the latest one here and sends it back first on a new
 * socket (REQ_RESUME_SESSION).
 *
 * Why `sessionStorage`: it belongs to one tab, survives a reload and a tab discard, and dies when
 * the tab closes. A second tab therefore never sees the first tab's token and cannot take over its
 * session — which is why the token is never kept in the browser's shared, cross-tab storage.
 *
 * Accepted residual risk (maintainer decision, 2026-09-27): the token is not bound to the IP,
 * because mobile players switch between Wi-Fi and mobile data. It is a high-entropy random value,
 * single-use, rotated on every re-attach and bound to the username; someone who reads it from the
 * tab before its next use can re-attach from anywhere, for at most the park duration.
 *
 * Modelled on `remembered-session.ts`'s `storage()` guard and try/catch discipline — a corrupt,
 * absent or throwing storage reads as "no token", never as a crash.
 */

export const RESUME_TOKEN_KEY = 'spo_resume_token';

/** The token and the login username the gateway parked the session under. */
export interface HeldResumeToken {
  username: string;
  token: string;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isHeldResumeToken(value: unknown): value is HeldResumeToken {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.username === 'string' && v.username !== ''
    && typeof v.token === 'string' && v.token !== '';
}

/** Read the held token. `null` on no storage, no key, bad JSON, a missing or empty field. */
export function loadResumeToken(): HeldResumeToken | null {
  try {
    const raw = storage()?.getItem(RESUME_TOKEN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isHeldResumeToken(parsed) ? { username: parsed.username, token: parsed.token } : null;
  } catch {
    return null;
  }
}

/** Keep `held`, replacing any earlier token (every rotation). */
export function saveResumeToken(held: HeldResumeToken): void {
  try {
    storage()?.setItem(RESUME_TOKEN_KEY, JSON.stringify({ username: held.username, token: held.token }));
  } catch {
    /* private mode or a storage that throws — the next drop just falls back to the login replay */
  }
}

/** Forget the token (Logout, or any resume refusal). */
export function clearResumeToken(): void {
  try {
    storage()?.removeItem(RESUME_TOKEN_KEY);
  } catch {
    /* same as above */
  }
}
