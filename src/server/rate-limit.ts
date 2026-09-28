/**
 * Per-IP ceilings of the gateway and the in-memory fixed-window limiter that enforces them.
 *
 * These are the production values (policy SEC-H-4, SEC-W-3, SEC-W-5; maintainer decision
 * 2026-09-27). The bench gateway is unthrottled through SINGLE_USER_MODE (#1029), not through
 * these numbers — and production refuses to start in that mode (SEC-R-2, production-config.ts).
 * `rate-limit.test.ts` pins them: raising one fails CI.
 */
import { WsMessageType } from '../shared/types';

export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
/** Max attempts per auth-bearing message type, per IP, per window (SEC-H-4, SEC-W-5). */
export const RATE_LIMIT_MAX_AUTH = 10;
/** Max `/proxy-image` requests per IP per window (SEC-H-4). */
export const RATE_LIMIT_MAX_PROXY = 60;
/** Max simultaneous WebSocket connections per IP (SEC-W-3, maintainer decision 2026-09-27). */
export const WS_MAX_CONNECTIONS_PER_IP = 20;
const RATE_LIMIT_MAX_ENTRIES = 10_000; // max entries before forced cleanup

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(ip: string, category: string, maxRequests: number): boolean {
  const key = `${category}:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    // Prevent unbounded growth: evict expired entries when map is too large
    if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetTime) rateLimitMap.delete(k);
      }
    }
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= maxRequests;
}

/** The message types that carry credentials — each is counted in its own per-IP bucket. */
export const AUTH_RATE_LIMITED_TYPES: ReadonlySet<string> = new Set<string>([
  WsMessageType.REQ_AUTH_CHECK,
  WsMessageType.REQ_CONNECT_DIRECTORY,
  WsMessageType.REQ_LOGIN_WORLD,
]);

/**
 * One bucket per auth-bearing message type per IP, so a full three-message login consumes one
 * unit of each and 10 complete logins fit in a window. Non-auth types pass uncounted.
 */
export function checkAuthRateLimit(ip: string, msgType: string): boolean {
  if (!AUTH_RATE_LIMITED_TYPES.has(msgType)) return true;
  return checkRateLimit(ip, `auth:${msgType}`, RATE_LIMIT_MAX_AUTH);
}

/**
 * A resume token is a credential too: `REQ_RESUME_SESSION` gets its own per-IP `auth:` bucket at
 * the same ceiling. Kept out of `AUTH_RATE_LIMITED_TYPES`, whose three members are pinned.
 */
export function checkResumeRateLimit(ip: string): boolean {
  return checkRateLimit(ip, `auth:${WsMessageType.REQ_RESUME_SESSION}`, RATE_LIMIT_MAX_AUTH);
}

/** Delete expired entries; returns how many were removed. */
export function sweepExpiredRateLimits(now: number = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
      removed++;
    }
  }
  return removed;
}
