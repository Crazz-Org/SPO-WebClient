/**
 * reconnect-utils — Pure helpers for WebSocket auto-reconnect backoff.
 * Kept separate so logic can be unit-tested without a browser environment.
 *
 * Two-phase strategy (mirrors Delphi TReconnectThread which never gives up):
 *   Phase 1 (FAST): Exponential backoff [2s, 4s, 8s, 16s, 30s] — 5 attempts
 *   Phase 2 (SLOW): Fixed 30s interval — continues for 5 more minutes (10 attempts)
 *   Total: up to 15 attempts over ~6 minutes before giving up.
 *
 * Every delay carries ±25% jitter (audit V5): fixed delays synchronize all
 * clients into a thundering herd after a shared server outage.
 */

/** Fast-phase attempts with exponential backoff. */
export const FAST_PHASE_DELAYS_MS = [2000, 4000, 8000, 16000, 30000] as const;

/** Slow-phase: fixed interval after fast phase exhausted. */
export const SLOW_PHASE_INTERVAL_MS = 30_000;

/** Total slow-phase attempts (30s × 10 = 5 min of slow retries). */
export const SLOW_PHASE_MAX_ATTEMPTS = 10;

/** Total max attempts across both phases. */
export const MAX_RECONNECT_ATTEMPTS = FAST_PHASE_DELAYS_MS.length + SLOW_PHASE_MAX_ATTEMPTS;

/** ±25% jitter. `random` is injectable for deterministic tests. */
export function applyJitter(ms: number, random: () => number = Math.random): number {
  return Math.round(ms * (0.75 + random() * 0.5));
}

/**
 * Returns the delay (ms) to wait before the given attempt (0-based), jittered ±25%.
 * Fast phase: escalating delays. Slow phase: fixed 30s.
 */
export function getReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = attempt < FAST_PHASE_DELAYS_MS.length
    ? FAST_PHASE_DELAYS_MS[attempt]
    : SLOW_PHASE_INTERVAL_MS;
  return applyJitter(base, random);
}

/** Returns true when no more reconnect attempts should be made. */
export function isMaxAttempts(attempt: number): boolean {
  return attempt >= MAX_RECONNECT_ATTEMPTS;
}

/** Returns true when we're in the slow-poll phase (for UI messaging). */
export function isSlowPhase(attempt: number): boolean {
  return attempt >= FAST_PHASE_DELAYS_MS.length;
}

/** Shown whenever the gateway cannot be reached: startup screen, final overlay, sign-in (issue 1048). */
export const GATEWAY_UNREACHABLE_MESSAGE = 'The game server is not responding. Try again in a few minutes.';
