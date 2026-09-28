/**
 * Per-socket message guard for the gateway WebSocket (policy SEC-W-6).
 *
 * A token bucket bounds how fast one socket may send, and a counter bounds how many
 * RDO-lane messages may wait on its serial queue. The caller (`server.ts`) closes the socket
 * when either refuses; this module holds no socket and logs nothing, so tests drive it alone.
 */

/**
 * Sustained per-socket message rate, in messages per second.
 * Maintainer decision 2026-09-27: "per-socket token bucket 20 messages/s sustained, burst 50;
 * max 100 queued messages per socket; exceeding either closes with code 1008". Policy SEC-W-6.
 */
export const WS_MESSAGE_RATE_PER_SECOND = 20;

/**
 * Bucket capacity: messages a socket may send at once before the sustained rate applies.
 * Maintainer decision 2026-09-27: "per-socket token bucket 20 messages/s sustained, burst 50;
 * max 100 queued messages per socket; exceeding either closes with code 1008". Policy SEC-W-6.
 */
export const WS_MESSAGE_BURST = 50;

/**
 * Most RDO-lane messages one socket may have enqueued and not yet settled.
 * Maintainer decision 2026-09-27: "per-socket token bucket 20 messages/s sustained, burst 50;
 * max 100 queued messages per socket; exceeding either closes with code 1008". Policy SEC-W-6.
 */
export const WS_MAX_QUEUED_MESSAGES = 100;

/**
 * Close code sent when the guard closes a socket (1008 = policy violation).
 * Maintainer decision 2026-09-27: "per-socket token bucket 20 messages/s sustained, burst 50;
 * max 100 queued messages per socket; exceeding either closes with code 1008". Policy SEC-W-6.
 */
export const WS_GUARD_CLOSE_CODE = 1008;

/** Close reason when the token bucket is empty (policy SEC-W-6). */
export const WS_RATE_EXCEEDED_REASON = 'Message rate exceeded';

/** Close reason when the RDO-lane queue is full (policy SEC-W-6). */
export const WS_QUEUE_EXCEEDED_REASON = 'Too many queued messages';

export interface WsMessageGuardLimits {
  ratePerSecond: number;
  burst: number;
  maxQueued: number;
}

/** One per socket: a token bucket for the message rate and a counter for the RDO queue. */
export class WsMessageGuard {
  private tokens: number;
  private last: number;
  private pending = 0;

  constructor(
    private readonly limits: WsMessageGuardLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = limits.burst;
    this.last = now();
  }

  /**
   * Refills the bucket for the time elapsed, then takes one token. `false` = bucket empty.
   * A wall clock that steps backwards counts as no time elapsed, never as negative time.
   */
  takeToken(): boolean {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last);
    this.tokens = Math.min(
      this.limits.burst,
      this.tokens + (elapsed * this.limits.ratePerSecond) / 1000,
    );
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Counts one more queued message. `false` (and no count) when the queue is already full. */
  enqueue(): boolean {
    if (this.pending >= this.limits.maxQueued) return false;
    this.pending += 1;
    return true;
  }

  /** One queued message has settled. Never goes below zero. */
  settle(): void {
    if (this.pending > 0) this.pending -= 1;
  }

  get queued(): number {
    return this.pending;
  }
}
