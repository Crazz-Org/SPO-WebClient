/**
 * Push liveness watchdog — re-arms `EnableEvents` when the push channel is
 * silent while the request channel still answers.
 *
 * Why it exists (Interface Server/InterfaceServer.pas):
 *
 *   TClientView.RegisterEventsById sets `EnableEvents := true` (:1924), sends
 *   the client data and new-mail count, then `EnableEvents := false` (:1928);
 *   TClientView.RefreshDate / RefreshTycoon push only when
 *   `fConnected and fEnableEvents`.
 *
 * so a `set EnableEvents #-1` that the IS applies BEFORE RegisterEventsById
 * finishes is overwritten by that trailing `false`, and the session receives
 * no pushes at all while every request still answers. The login paths now
 * await the RegisterEventsById reply before EnableEvents; this watchdog is the
 * backstop for any other way the flag ends up false.
 *
 * Legacy parity covers the re-sent `set EnableEvents` form only: Voyager sets
 * `fISProxy.EnableEvents := true` with `WaitForAnswer`
 * (Voyager.1/URLHandlers/ServerCnxHandler.pas:1923-1944,
 * TServerCnxHandler.EnableEvents) and calls it on reconnect (:3227). Voyager
 * has no periodic watchdog — this one is new, which is why it is capped:
 * after MAX_CONSECUTIVE_RESENDS re-sends with no RefreshDate in between it
 * stops re-sending for the session and logs one ERROR; a RefreshDate resets
 * the count. `TClientView.SetEnableEvents` only assigns the field (:695-701),
 * so a re-send is harmless, but an unbounded loop against a server that never
 * pushes again is load with no effect. The watchdog never reconnects.
 *
 * It also logs the first push after each (re-)login at INFO, so the next
 * silent session is diagnosable from the log alone.
 */

export type EventsTrigger = 'login' | 're-login';

export interface PushLivenessDeps {
  readonly log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
  /** Wall-clock ms; injectable for tests. */
  now(): number;
  /** Wall-clock ms of the last RDO reply the session received, 0 if none. */
  lastAnswerAt(): number;
  /** Send `set EnableEvents #-1` on the session's current ClientView. Rejects on failure. */
  resendEnableEvents(): Promise<void>;
}

export class PushLiveness {
  /** No RefreshDate for this long after EnableEvents (or the last RefreshDate) = silent. */
  static readonly STALE_MS = 120_000;
  /** Minimum spacing between two re-sends. */
  static readonly RESEND_MIN_INTERVAL_MS = 120_000;
  /** How often the watchdog looks. */
  static readonly CHECK_INTERVAL_MS = 15_000;
  /** Re-sends in a row, with no RefreshDate between them, before the watchdog gives up. */
  static readonly MAX_CONSECUTIVE_RESENDS = 3;

  private timer: ReturnType<typeof setInterval> | null = null;
  private trigger: EventsTrigger | null = null;
  private armedAt = 0;
  private firstPushSeen = false;
  private lastRefreshDateAt = 0;
  private lastResendAt = 0;
  private resendCount = 0;
  /** Re-sends since the last RefreshDate (or arm); capped by MAX_CONSECUTIVE_RESENDS. */
  private consecutiveResends = 0;
  private gaveUp = false;
  private resendInFlight = false;

  constructor(private readonly deps: PushLivenessDeps) {}

  /** EnableEvents was just accepted by the server. */
  arm(trigger: EventsTrigger): void {
    this.trigger = trigger;
    this.armedAt = this.deps.now();
    this.firstPushSeen = false;
    this.lastRefreshDateAt = 0;
    this.lastResendAt = 0;
    this.resendCount = 0;
    this.consecutiveResends = 0;
    this.gaveUp = false;
    if (!this.timer) {
      this.timer = setInterval(() => this.check(), PushLiveness.CHECK_INTERVAL_MS);
      if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) this.timer.unref();
    }
  }

  /** The session is leaving the world (cleanup, destroy, reconnect start). */
  disarm(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.trigger = null;
  }

  get isArmed(): boolean {
    return this.trigger !== null;
  }

  /** Every push the session receives, by member name. */
  onPush(member: string | undefined): void {
    if (!this.trigger) return;
    const now = this.deps.now();
    if (!this.firstPushSeen) {
      this.firstPushSeen = true;
      this.deps.log.info(
        `[Events] First push after ${this.trigger}: ${member ?? '?'} ` +
        `${((now - this.armedAt) / 1000).toFixed(1)}s after EnableEvents`,
      );
    }
    if (member === 'RefreshDate') {
      if (this.resendCount > 0 && this.lastRefreshDateAt <= this.lastResendAt) {
        this.deps.log.info(
          `[Events] RefreshDate resumed ${((now - this.lastResendAt) / 1000).toFixed(1)}s ` +
          `after EnableEvents re-send #${this.resendCount}`,
        );
      }
      this.lastRefreshDateAt = now;
      this.consecutiveResends = 0;
      this.gaveUp = false;
    }
  }

  /** One watchdog pass. Public for tests. */
  check(): void {
    if (!this.trigger || this.resendInFlight) return;
    const now = this.deps.now();
    const silentSince = Math.max(this.armedAt, this.lastRefreshDateAt);
    const silentMs = now - silentSince;
    if (silentMs < PushLiveness.STALE_MS) return;
    if (this.lastResendAt > 0 && now - this.lastResendAt < PushLiveness.RESEND_MIN_INTERVAL_MS) return;

    // Only the "pushes off, requests on" case is ours. When requests are not
    // answering either, the server (or the socket) is stalled, and that is the
    // reconnect machinery's job, not this one's.
    const lastAnswer = this.deps.lastAnswerAt();
    if (!(lastAnswer > 0 && now - lastAnswer < PushLiveness.STALE_MS)) {
      this.deps.log.debug(
        `[Events] No RefreshDate for ${Math.round(silentMs / 1000)}s, but no RDO reply ` +
        `in ${PushLiveness.STALE_MS / 1000}s either — not re-sending EnableEvents`,
      );
      return;
    }

    if (this.consecutiveResends >= PushLiveness.MAX_CONSECUTIVE_RESENDS) {
      if (!this.gaveUp) {
        this.gaveUp = true;
        this.deps.log.error(
          `[Events] No RefreshDate push for ${Math.round(silentMs / 1000)}s after ${this.trigger} ` +
          `and ${this.consecutiveResends} EnableEvents re-sends — no longer re-sending for this session`,
        );
      }
      return;
    }

    this.lastResendAt = now;
    this.resendCount++;
    this.consecutiveResends++;
    this.resendInFlight = true;
    const n = this.resendCount;
    this.deps.log.warn(
      `[Events] No RefreshDate push for ${Math.round(silentMs / 1000)}s after ${this.trigger} ` +
      `while requests still answer — re-sending EnableEvents (#${n})`,
    );
    this.deps.resendEnableEvents().then(
      () => { this.deps.log.debug(`[Events] EnableEvents re-send #${n} accepted`); },
      (err: unknown) => {
        this.deps.log.warn(`[Events] EnableEvents re-send #${n} failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    ).finally(() => { this.resendInFlight = false; });
  }
}
