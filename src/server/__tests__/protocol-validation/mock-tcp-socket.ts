/**
 * MockTcpSocket — Replaces net.Socket for protocol validation tests.
 *
 * Intercepts RDO commands written by StarpeaceSession, matches them
 * against RdoMock scenario data, and emits captured responses back
 * through the standard EventEmitter interface.
 *
 * Supports:
 * - Standard request→response matching via RdoMock
 * - Push triggers (emit server pushes after specific commands)
 * - Server→client requests (e.g., idof InterfaceEvents during login)
 * - RID rewriting (scenario RIDs → actual request RIDs)
 */

import { EventEmitter } from 'events';
import { RdoProtocol } from '../../../server/rdo';
import { RdoMock } from '../../../mock-server/rdo-mock';
import { RDO_CONSTANTS } from '../../../shared/types/protocol-types';
import type { RdoStrictValidator } from '../../../mock-server/rdo-strict-validator';

/** Additional data to emit when a specific RDO member is matched */
export interface PushTrigger {
  /** Trigger when a command with this member name is matched */
  triggerOnMember: string;
  /** Raw RDO strings to emit as server data (without trailing delimiter) */
  pushData: string[];
  /** Delay before emitting pushes in ms (default: 5) */
  delayMs?: number;
}

/** Fallback response for commands not found in RdoMock */
export interface FallbackResponse {
  /** Match by member name */
  member: string;
  /** Response payload (without A<rid> prefix — RID will be prepended) */
  payload: string;
}

export class MockTcpSocket extends EventEmitter {
  private rdoMock: RdoMock;
  private validator: RdoStrictValidator | null;
  private capturedCommands: string[] = [];
  private capturedWrites: string[] = [];
  private pushTriggers: PushTrigger[] = [];
  private fallbackResponses: FallbackResponse[] = [];
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];

  writable = true;
  readable = true;
  destroyed = false;

  constructor(rdoMock: RdoMock, validator?: RdoStrictValidator) {
    super();
    this.rdoMock = rdoMock;
    this.validator = validator ?? null;
  }

  /** Add a push trigger — emits extra data when a matching command is sent */
  addPushTrigger(trigger: PushTrigger): void {
    this.pushTriggers.push(trigger);
  }

  /** Add fallback responses for commands not in RdoMock scenarios */
  addFallbackResponse(fallback: FallbackResponse): void {
    this.fallbackResponses.push(fallback);
  }

  /**
   * Called by StarpeaceSession when sending RDO commands.
   * Captures the command, matches against RdoMock, and emits the response.
   */
  write(data: string | Buffer, encoding?: string, callback?: () => void): boolean {
    const raw = typeof data === 'string' ? data : data.toString('latin1');
    this.capturedWrites.push(raw);

    // Strip trailing delimiter for parsing
    const stripped = raw.replace(/;[\s]*$/, '').trim();
    if (!stripped) {
      if (callback) callback();
      return true;
    }

    // If this is a response (from handleServerRequest auto-reply), don't process
    if (stripped.startsWith(RDO_CONSTANTS.CMD_PREFIX_ANSWER)) {
      if (callback) callback();
      return true;
    }

    // Only process client commands (C prefix)
    if (stripped.startsWith(RDO_CONSTANTS.CMD_PREFIX_CLIENT)) {
      this.capturedCommands.push(stripped);
    }

    const parsed = RdoProtocol.parse(stripped);

    // Strict validation (non-blocking — violations collected for afterEach assertion)
    if (this.validator && stripped.startsWith(RDO_CONSTANTS.CMD_PREFIX_CLIENT)) {
      this.validator.validate(parsed, stripped);
    }

    const match = this.rdoMock.match(stripped);

    if (match) {
      this.emitResponse(match.response, parsed.rid);
      this.checkPushTriggers(parsed.member);

      // Emit any push commands from the match
      if (match.pushes && match.pushes.length > 0) {
        const timer = setTimeout(() => {
          for (const push of match.pushes) {
            this.emitRaw(push);
          }
        }, 15);
        this.pendingTimers.push(timer);
      }
    } else if (parsed.member) {
      // Try fallback responses
      const fallback = this.fallbackResponses.find(f => f.member === parsed.member);
      if (fallback) {
        const response = parsed.rid !== undefined
          ? `A${parsed.rid} ${fallback.payload}`
          : `A0 ${fallback.payload}`;
        this.emitRaw(response);
      }
      // If no match and no fallback, still check push triggers
      this.checkPushTriggers(parsed.member);
    }

    if (callback) callback();
    return true;
  }

  /**
   * When set, the next connect() emits 'error' instead of succeeding.
   * Lets a test drive the pool's "could not be populated" fallback.
   */
  failNextConnect = false;

  /** Simulates socket.connect() — resolves immediately */
  connect(port: number, host: string, callback?: () => void): this {
    if (this.failNextConnect) {
      this.failNextConnect = false;
      setImmediate(() => this.emit('error', new Error(`ECONNREFUSED ${host}:${port}`)));
      return this;
    }
    if (callback) {
      setImmediate(callback);
    }
    return this;
  }

  end(): void {
    this.clearPendingTimers();
    this.destroyed = true;
    setImmediate(() => this.emit('close'));
  }

  destroy(): this {
    this.clearPendingTimers();
    this.destroyed = true;
    setImmediate(() => this.emit('close'));
    return this;
  }

  /** Stub for socket.setKeepAlive() */
  setKeepAlive(): this {
    return this;
  }

  /** Stub for socket.setNoDelay() */
  setNoDelay(): this {
    return this;
  }

  /** Stub for socket.setTimeout() */
  setTimeout(): this {
    return this;
  }

  ref(): this { return this; }
  unref(): this { return this; }

  // === Test inspection methods ===

  /** Get all client commands captured (C prefix, stripped of delimiter) */
  getCapturedCommands(): string[] {
    return [...this.capturedCommands];
  }

  /** Get all raw writes (including responses and delimiters) */
  getCapturedWrites(): string[] {
    return [...this.capturedWrites];
  }

  /** Get command count */
  getCommandCount(): number {
    return this.capturedCommands.length;
  }

  /** Find commands matching a member name */
  getCommandsByMember(member: string): string[] {
    return this.capturedCommands.filter(cmd => cmd.includes(member));
  }

  /** Get the strict validator (if configured) */
  getValidator(): RdoStrictValidator | null {
    return this.validator;
  }

  /** Reset captured data */
  reset(): void {
    this.capturedCommands = [];
    this.capturedWrites = [];
    this.clearPendingTimers();
  }

  // === Internal helpers ===

  /** Cancel all pending setTimeout timers to prevent worker leaks */
  private clearPendingTimers(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers = [];
  }

  /** Emit a response with RID rewriting */
  private emitResponse(response: string, actualRid?: number): void {
    const rewritten = this.rewriteRid(response, actualRid);
    this.emitRaw(rewritten);
  }

  /** Emit raw RDO data as a socket 'data' event (with delimiter) */
  private emitRaw(data: string): void {
    const withDelimiter = data.endsWith(RDO_CONSTANTS.PACKET_DELIMITER)
      ? data
      : data + RDO_CONSTANTS.PACKET_DELIMITER;
    setImmediate(() => {
      if (!this.destroyed) {
        this.emit('data', Buffer.from(withDelimiter, 'latin1'));
      }
    });
  }

  /** Check and fire push triggers for a matched member */
  private checkPushTriggers(member?: string): void {
    if (!member) return;

    for (const trigger of this.pushTriggers) {
      if (trigger.triggerOnMember === member) {
        const delay = trigger.delayMs ?? 5;
        const timer = setTimeout(() => {
          for (const pushData of trigger.pushData) {
            this.emitRaw(pushData);
          }
        }, delay);
        this.pendingTimers.push(timer);
      }
    }
  }

  /** Replace scenario RID in response with the actual request RID */
  private rewriteRid(response: string, actualRid?: number): string {
    if (actualRid === undefined) return response;
    // Match A followed by digits at start of string
    return response.replace(/^A\d+/, `A${actualRid}`);
  }
}
