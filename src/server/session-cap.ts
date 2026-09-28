/**
 * Global game-session cap (policy SEC-W-3).
 *
 * A slot is one admitted game session. A session takes a slot when its `REQ_LOGIN_WORLD`
 * passes `tryAdmit`, and gives it back when it is destroyed — whatever ended it (close, logout,
 * park expiry, eviction, shutdown) — because `StarpeaceSession.destroy()` emits `destroyed`
 * once and the cap listens for it. A failed world login gives it back through `release`.
 * A parked session keeps its slot: parking only delays `destroy()`.
 */
import type { GatewayMetrics } from './observability';

/**
 * The default cap: `recommendedCap` in `src/__tests__/load/session-capacity.json`, measured by
 * card L12-1 against the container's 512 MB limit. Re-measure with `npm run load:sessions`;
 * `session-cap.test.ts` pins this constant to that file, so a new measurement forces this line.
 */
export const DEFAULT_MAX_SESSIONS = 4550;

/** The sentence a refused world login receives. */
export const SERVER_FULL_MESSAGE = 'The server is full. Please try again in a few minutes.';

/**
 * WebSocket close code 1013 "Try Again Later" — IANA-registered (RFC 6455 §7.4 registry).
 * Declared in the gateway; nothing goes into `src/shared/`.
 */
export const WS_TRY_AGAIN_LATER_CLOSE_CODE = 1013;

/** Short close reason sent with the 1013 close. */
export const SERVER_FULL_CLOSE_REASON = 'Server full';

/** Reads `SPO_MAX_SESSIONS`: unset or empty gives the default, a positive integer that value; anything else throws. */
export function parseMaxSessions(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_SESSIONS;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_MAX_SESSIONS;
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  throw new Error(`SPO_MAX_SESSIONS must be a positive integer, got "${raw}"`);
}

/** What the cap needs of a session: one `destroyed` notification. */
export interface DestroyNotifier {
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface SessionCapCounters {
  /** Sessions holding a slot now, parked ones included. */
  admitted: number;
  /** The cap in force. */
  max: number;
  /** Refusals since start. */
  refusedFull: number;
}

export class SessionCap<S extends DestroyNotifier = DestroyNotifier> {
  private readonly admitted = new Set<S>();
  private readonly subscribed = new WeakSet<S>();
  private refused = 0;

  constructor(private max: number = DEFAULT_MAX_SESSIONS) {}

  setMax(max: number): void {
    this.max = max;
  }

  /**
   * Admit a session, or refuse it when the cap is reached. `notCounted` are sessions the caller
   * is about to end (the player's own parked session a fresh login evicts): they do not count.
   * An already-admitted session passes and takes no second slot.
   */
  tryAdmit(session: S, notCounted: readonly S[] = []): boolean {
    if (this.admitted.has(session)) return true;
    let discount = 0;
    for (const s of new Set(notCounted)) {
      if (this.admitted.has(s)) discount++;
    }
    if (this.admitted.size - discount >= this.max) {
      this.refused++;
      return false;
    }
    this.admitted.add(session);
    if (!this.subscribed.has(session)) {
      this.subscribed.add(session);
      session.once('destroyed', () => this.release(session));
    }
    return true;
  }

  /** Give the slot back; a no-op for a session that holds none. */
  release(session: S): void {
    this.admitted.delete(session);
  }

  isAdmitted(session: S): boolean {
    return this.admitted.has(session);
  }

  counters(): SessionCapCounters {
    return { admitted: this.admitted.size, max: this.max, refusedFull: this.refused };
  }
}

export type CappedGatewayMetrics = GatewayMetrics & { sessions: SessionCapCounters };

/** Adds the cap counters to #1057's metrics object, under `sessions`. */
export function withSessionCap(metrics: GatewayMetrics, counters: SessionCapCounters): CappedGatewayMetrics {
  return { ...metrics, sessions: { ...metrics.sessions, ...counters } };
}
