/**
 * WsDriver — a headless client for the L2 live drive.
 *
 * Speaks the same `WsMessage` contract the browser client speaks, over a real socket to
 * a real gateway, which in turn holds the real RDO sockets to the Delphi servers. It is
 * the regression detector of doc/E2E-POLICY.md §2: everything below the pixel.
 *
 * Deliberately *not* `MockWebSocketClient` — that one never opened a socket.
 */

import WebSocket from 'ws';
import { WsMessageType } from '../shared/types/message-types';
import type { WsMessage } from '../shared/types/message-types';
import { toErrorMessage } from '../shared/error-utils';
import { TIMEOUTS } from './config';

/**
 * A frame on its way out. The concrete request interfaces in `message-types.ts` all
 * extend `WsMessage`; the index signature is what lets a caller pass one as a literal
 * without the excess-property check rejecting its own fields.
 */
export type OutboundMessage = WsMessage & Record<string, unknown>;

export interface DriverLogEntry {
  direction: 'sent' | 'received';
  type: string;
  at: string;
  wsRequestId?: string;
}

/** A gateway RESP_ERROR arriving where a result was expected. */
export class WsDriverError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly forType: string,
  ) {
    super(message);
    this.name = 'WsDriverError';
  }
}

type Waiter = {
  match: (msg: WsMessage) => boolean;
  resolve: (msg: WsMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WsDriver {
  private readonly waiters = new Set<Waiter>();
  private readonly received: WsMessage[] = [];
  private requestCounter = 0;
  private closed = false;

  readonly log: DriverLogEntry[] = [];
  /** RESP_ERROR frames seen at any point, matched or not — wire health. */
  readonly errors: WsMessage[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', raw => this.onMessage(raw));
    socket.on('close', () => {
      this.closed = true;
      this.failAllWaiters(new Error('WebSocket closed while waiting'));
    });
    socket.on('error', err => {
      this.failAllWaiters(new Error(`WebSocket error: ${toErrorMessage(err)}`));
    });
  }

  static connect(url: string, origin: string): Promise<WsDriver> {
    return new Promise((resolve, reject) => {
      // The gateway rejects an originless socket outside single-user mode (server.ts:1079).
      const socket = new WebSocket(url, { origin });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`WebSocket did not open within ${TIMEOUTS.connect} ms: ${url}`));
      }, TIMEOUTS.connect);

      socket.once('open', () => {
        clearTimeout(timer);
        resolve(new WsDriver(socket));
      });
      socket.once('error', err => {
        clearTimeout(timer);
        reject(new Error(`WebSocket failed to open: ${toErrorMessage(err)}`));
      });
    });
  }

  /** Fire and forget. */
  send(msg: OutboundMessage): string {
    if (this.closed) throw new Error(`Cannot send ${msg.type}: driver is closed`);
    const wsRequestId = msg.wsRequestId ?? `e2e-${++this.requestCounter}`;
    const framed = { ...msg, wsRequestId };
    this.socket.send(JSON.stringify(framed));
    this.log.push({ direction: 'sent', type: msg.type, at: new Date().toISOString(), wsRequestId });
    return wsRequestId;
  }

  /**
   * Send and wait for one of `expect`, correlated by `wsRequestId` when the gateway
   * echoes it. A RESP_ERROR carrying the same id rejects rather than hangs.
   */
  async request<T extends WsMessage>(
    msg: OutboundMessage,
    expect: WsMessageType | WsMessageType[],
    timeoutMs: number = TIMEOUTS.request,
  ): Promise<T> {
    const expected = Array.isArray(expect) ? expect : [expect];
    const wsRequestId = this.send(msg);
    const reply = await this.waitFor(
      candidate =>
        (expected.includes(candidate.type) || candidate.type === WsMessageType.RESP_ERROR) &&
        (candidate.wsRequestId === undefined || candidate.wsRequestId === wsRequestId),
      timeoutMs,
      `${expected.join('|')} (for ${msg.type})`,
    );

    if (reply.type === WsMessageType.RESP_ERROR) {
      const err = reply as WsMessage & { errorMessage?: string; code?: number };
      throw new WsDriverError(err.errorMessage ?? 'gateway error', err.code ?? 0, msg.type);
    }
    return reply as T;
  }

  /**
   * Wait for any message satisfying `match`, including one already received — pushes
   * that arrive before the wait starts must not be missed.
   */
  waitFor(
    match: (msg: WsMessage) => boolean,
    timeoutMs: number = TIMEOUTS.request,
    label = 'message',
  ): Promise<WsMessage> {
    const buffered = this.received.find(match);
    if (buffered) return Promise.resolve(buffered);

    return new Promise<WsMessage>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: msg => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(msg);
        },
        reject: err => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          reject(err);
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Every message of a type seen so far — for assertions after a flow. */
  seen(type: WsMessageType): WsMessage[] {
    return this.received.filter(m => m.type === type);
  }

  close(): Promise<void> {
    this.closed = true;
    this.failAllWaiters(new Error('driver closed'));
    return new Promise(resolve => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.socket.once('close', () => resolve());
      this.socket.close();
      // Do not hang on a close that never lands: the gateway parks or ends the session either way.
      setTimeout(() => resolve(), 5_000).unref?.();
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsMessage;
    } catch {
      return; // A frame we cannot parse is not a frame we can assert on.
    }
    this.received.push(msg);
    this.log.push({
      direction: 'received',
      type: msg.type,
      at: new Date().toISOString(),
      wsRequestId: msg.wsRequestId,
    });
    if (msg.type === WsMessageType.RESP_ERROR) this.errors.push(msg);

    for (const waiter of Array.from(this.waiters)) {
      if (waiter.match(msg)) waiter.resolve(msg);
    }
  }

  private failAllWaiters(err: Error): void {
    for (const waiter of Array.from(this.waiters)) waiter.reject(err);
  }
}
