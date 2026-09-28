/**
 * Session parking — keep a WORLD_CONNECTED gateway session alive while its browser tab is away,
 * and let the tab re-attach it with a single-use token (`doc/architecture-overview.md`
 * § Session parking).
 *
 * Pure module: no import of server.ts or spo_session.ts, so it is unit-testable on its own.
 * The Interface Server keeps a ClientView exactly as long as its TCP connection
 * (`Interface Server/InterfaceServer.pas:1799`), so the gateway keeps that connection open.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { WsMessageType, type WsMessage, type WsRespResumeSession, type WsResumeCompany } from '../shared/types';
import * as ErrorCodes from '../shared/error-codes';

/** How long a parked session waits for its tab (maintainer decision 2026-09-27). */
export const SESSION_PARK_MS_DEFAULT = 300_000;
/** Global ceiling on parked sessions (SEC-W-3). Planner choice — the card sets no number. */
export const MAX_PARKED_SESSIONS_DEFAULT = 100;
/** Bound of the replay FIFO kept while a session has no WebSocket. */
export const PARKED_EVENT_FIFO_MAX = 100;
/** Events nothing can re-read later — kept while detached and replayed after re-attach. */
export const RESUME_REPLAY_TYPES: ReadonlySet<string> = new Set<string>([
  WsMessageType.EVENT_CHAT_MSG,
  WsMessageType.EVENT_SHOW_NOTIFICATION,
  WsMessageType.EVENT_NEW_MAIL,
  WsMessageType.EVENT_TYCOON_RETIRED,
]);
/** Every refusal answers with this code and message — they reveal nothing. */
export const RESUME_REFUSED_CODE = ErrorCodes.ERROR_AccessDenied;
export const RESUME_REFUSED_MESSAGE = 'Session cannot be resumed';
/** A presented token longer than this is refused before it is hashed. */
export const RESUME_TOKEN_MAX_LENGTH = 128;

const WS_OPEN = 1;

/** `SPO_SESSION_PARK_MS`: a positive integer, otherwise the default. */
export function readParkMs(env: NodeJS.ProcessEnv): number {
  const raw = env.SPO_SESSION_PARK_MS;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return SESSION_PARK_MS_DEFAULT;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : SESSION_PARK_MS_DEFAULT;
}

/** `SPO_MAX_PARKED_SESSIONS`: an integer ≥ 0, otherwise the default. `0` turns parking off. */
export function readMaxParked(env: NodeJS.ProcessEnv): number {
  const raw = env.SPO_MAX_PARKED_SESSIONS;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return MAX_PARKED_SESSIONS_DEFAULT;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : MAX_PARKED_SESSIONS_DEFAULT;
}

/** The slice of a `ws` WebSocket a binding touches. */
export interface SessionSink {
  readyState: number;
  send(data: string): void;
  terminate(): void;
}

/** A session's current WebSocket (or none), and the replay FIFO kept while it has none. */
export class SessionBinding<S extends SessionSink = SessionSink> {
  private sink: S | null;
  private readonly fifo: WsMessage[] = [];

  constructor(sink: S | null) {
    this.sink = sink;
  }

  get current(): S | null {
    return this.sink;
  }

  attach(sink: S): void {
    this.sink = sink;
  }

  detach(): void {
    this.sink = null;
  }

  /** Send to the current socket when it is open; otherwise keep a replayable event, drop the rest. */
  deliver(payload: WsMessage): void {
    if (this.sink && this.sink.readyState === WS_OPEN) {
      this.sink.send(JSON.stringify(payload));
      return;
    }
    if (!RESUME_REPLAY_TYPES.has(payload.type)) return;
    this.fifo.push(payload);
    if (this.fifo.length > PARKED_EVENT_FIFO_MAX) this.fifo.shift();
  }

  /** The kept events in arrival order; empties the FIFO. */
  takeBuffered(): WsMessage[] {
    return this.fifo.splice(0, this.fifo.length);
  }
}

/** One token-holding session, attached or parked. */
export interface ResumeEntry {
  readonly key: string;
  tokenHash: Buffer | null;
  parked: { ip: string; timer: NodeJS.Timeout } | null;
}

export interface SessionParkOptions<T> {
  parkMs: number;
  maxParked: number;
  onExpire: (value: T) => void;
}

export interface ResumeClaim<T> {
  entry: ResumeEntry;
  value: T;
  /** The IP that parked the session, or null when it was still attached (half-open socket). */
  parkIp: string | null;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Every session that holds a resume token, keyed by upper-cased username. */
export class SessionParkRegistry<T> {
  readonly parkMs: number;
  private readonly maxParked: number;
  private readonly onExpire: (value: T) => void;
  private readonly entries = new Map<ResumeEntry, T>();

  constructor(options: SessionParkOptions<T>) {
    this.parkMs = options.parkMs;
    this.maxParked = options.maxParked;
    this.onExpire = options.onExpire;
  }

  /**
   * The key is upper-cased: the Interface Server matches names case-insensitively
   * (`GetClientByName`, `Interface Server/InterfaceServer.pas:3508-3511`).
   */
  register(username: string, value: T): ResumeEntry {
    const entry: ResumeEntry = { key: username.toUpperCase(), tokenHash: null, parked: null };
    this.entries.set(entry, value);
    return entry;
  }

  /** A new token for this entry; only its SHA-256 is kept, the previous one dies. */
  issueToken(entry: ResumeEntry): string {
    const token = randomBytes(32).toString('base64url');
    entry.tokenHash = hashToken(token);
    return token;
  }

  /** Start the park timer. False when there is no token, it is already parked, or the cap is reached. */
  park(entry: ResumeEntry, ip: string): boolean {
    if (!this.entries.has(entry) || entry.tokenHash === null || entry.parked !== null) return false;
    if (this.parkedCount() >= this.maxParked) return false;
    const value = this.entries.get(entry) as T;
    const timer = setTimeout(() => this.onExpire(value), this.parkMs);
    timer.unref();
    entry.parked = { ip, timer };
    return true;
  }

  /** Consume a presented token. Null on any mismatch; a refusal changes nothing. */
  claim(username: unknown, token: unknown): ResumeClaim<T> | null {
    if (typeof username !== 'string' || typeof token !== 'string') return null;
    if (token.length === 0 || token.length > RESUME_TOKEN_MAX_LENGTH) return null;
    const key = username.toUpperCase();
    const presented = hashToken(token);
    for (const [entry, value] of this.entries) {
      if (entry.key !== key || entry.tokenHash === null) continue;
      if (!timingSafeEqual(entry.tokenHash, presented)) continue;
      const parkIp = entry.parked ? entry.parked.ip : null;
      if (entry.parked) clearTimeout(entry.parked.timer);
      entry.parked = null;
      entry.tokenHash = null;
      return { entry, value, parkIp };
    }
    return null;
  }

  /** The parked sessions of this username — what a fresh login evicts. */
  parkedFor(username: string): T[] {
    const key = username.toUpperCase();
    const out: T[] = [];
    for (const [entry, value] of this.entries) {
      if (entry.key === key && entry.parked !== null) out.push(value);
    }
    return out;
  }

  /** Remove the entry for good. Returns the park IP if it was parked, else null. Idempotent. */
  end(entry: ResumeEntry): string | null {
    if (!this.entries.delete(entry)) return null;
    entry.tokenHash = null;
    if (!entry.parked) return null;
    clearTimeout(entry.parked.timer);
    const ip = entry.parked.ip;
    entry.parked = null;
    return ip;
  }

  parkedCount(): number {
    let n = 0;
    for (const entry of this.entries.keys()) if (entry.parked !== null) n++;
    return n;
  }
}

/** The session state a resume snapshot reads — `StarpeaceSession` satisfies it as is. */
export interface ResumeSnapshotSource {
  tycoonId: string | null;
  currentWorldInfo: { name: string } | null;
  currentCompany: { id: string; name: string; ownerRole?: string } | null;
  getWorldXSize(): number | null;
  getWorldYSize(): number | null;
  getWorldSeason(): number | null;
  getAccountMoney(): string | null;
  getVirtualDate(): number | null;
  getFailureLevel(): number | null;
  getPlayerPosition(): { x: number; y: number };
  getCurrentChannel(): string;
}

export type ResumeSnapshot = Omit<WsRespResumeSession, 'type' | 'wsRequestId'>;

export function buildResumeSnapshot(username: string, source: ResumeSnapshotSource): ResumeSnapshot {
  const c = source.currentCompany;
  const company: WsResumeCompany | null = c
    ? { id: c.id, name: c.name, ...(c.ownerRole !== undefined ? { ownerRole: c.ownerRole } : {}) }
    : null;
  const pos = source.getPlayerPosition();
  return {
    username,
    tycoonId: source.tycoonId,
    worldName: source.currentWorldInfo ? source.currentWorldInfo.name : null,
    worldXSize: source.getWorldXSize(),
    worldYSize: source.getWorldYSize(),
    worldSeason: source.getWorldSeason(),
    company,
    accountMoney: source.getAccountMoney(),
    virtualDate: source.getVirtualDate(),
    failureLevel: source.getFailureLevel(),
    playerX: pos.x,
    playerY: pos.y,
    chatChannel: source.getCurrentChannel(),
  };
}
