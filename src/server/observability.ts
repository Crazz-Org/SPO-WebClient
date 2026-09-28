/**
 * Gateway observability — the public health check, the local-only metrics
 * readout, and the periodic `METRICS` log line.
 *
 * This lives here rather than inline in `server.ts` for the same reason as
 * `session/diagnostics-readouts.ts`: `server.ts` is the HTTP/WS bootstrap and
 * cannot be exercised without booting the gateway. The route wiring stays
 * there; everything these endpoints decide and return is decided here, where
 * it can be asserted.
 *
 * Delphi reachability is measured by a cached TCP connect to the directory
 * server — open, then close, writing nothing — once a minute. No HTTP request
 * ever opens a socket to Delphi. Nothing here starts at module load: the probe
 * and the log timer are started by `startGateway()` once it is listening.
 */

import type * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../shared/config';
import { toErrorMessage } from '../shared/error-utils';
import { SessionPhase } from '../shared/types';
import type { ClientErrorCounts } from './client-error-endpoint';

export const DIRECTORY_PROBE_INTERVAL_MS = 60_000;
export const DIRECTORY_PROBE_TIMEOUT_MS = 5_000;
/** Two intervals, so a single dropped probe or timer jitter does not flip the status. */
export const DIRECTORY_STALE_MS = 2 * DIRECTORY_PROBE_INTERVAL_MS;
export const METRICS_LOG_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Local-only predicate
// ---------------------------------------------------------------------------

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOOPBACK_V4_MAPPED = /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i;

/**
 * True only for a request whose raw socket peer is loopback AND which carries no
 * `X-Forwarded-For` header at all (an empty one refuses too). Anything that came
 * through nginx carries the header, so it is refused even though nginx connects
 * from loopback. Reads the socket peer directly — never the proxy-aware client IP.
 */
export function isLocalOnlyRequest(req: {
  headers: http.IncomingHttpHeaders;
  socket: { remoteAddress?: string };
}): boolean {
  if (req.headers['x-forwarded-for'] !== undefined) return false;
  const peer = req.socket.remoteAddress;
  if (peer === undefined) return false;
  return peer === '::1' || LOOPBACK_V4.test(peer) || LOOPBACK_V4_MAPPED.test(peer);
}

// ---------------------------------------------------------------------------
// Directory probe
// ---------------------------------------------------------------------------

/** The slice of `net.Socket` the probe uses; a test fake needs only these. */
export interface ProbeSocket {
  setTimeout(ms: number, callback: () => void): void;
  once(event: 'connect', listener: () => void): void;
  once(event: 'error', listener: (err: Error) => void): void;
  destroy(): void;
}
export type ProbeSocketFactory = (host: string, port: number) => ProbeSocket;

const defaultCreateSocket: ProbeSocketFactory = (host, port) => net.createConnection({ host, port });

export interface DirectoryProbeState {
  lastOkAt: number | null;
  lastAttemptAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface DirectoryProbeOptions {
  target: () => { host: string; port: number };
  createSocket?: ProbeSocketFactory;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
}

export class DirectoryProbe {
  private readonly target: () => { host: string; port: number };
  private readonly createSocket: ProbeSocketFactory;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: DirectoryProbeState = {
    lastOkAt: null,
    lastAttemptAt: null,
    consecutiveFailures: 0,
    lastError: null,
  };

  constructor(options: DirectoryProbeOptions) {
    this.target = options.target;
    this.createSocket = options.createSocket ?? defaultCreateSocket;
    this.timeoutMs = options.timeoutMs ?? DIRECTORY_PROBE_TIMEOUT_MS;
    this.intervalMs = options.intervalMs ?? DIRECTORY_PROBE_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** One TCP connect-and-close. Never rejects; writes zero bytes. */
  probeOnce(): Promise<void> {
    this.state.lastAttemptAt = this.now();
    const { host, port } = this.target();
    return new Promise(resolve => {
      const socket = this.createSocket(host, port);
      let settled = false;
      const finish = (ok: boolean, error: string | null): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        this.recordOutcome(ok, error);
        resolve();
      };
      socket.setTimeout(this.timeoutMs, () => finish(false, `connect timed out after ${this.timeoutMs}ms`));
      socket.once('connect', () => finish(true, null));
      socket.once('error', (err: Error) => finish(false, toErrorMessage(err)));
    });
  }

  recordOutcome(ok: boolean, error: string | null): void {
    if (ok) {
      this.state.lastOkAt = this.now();
      this.state.consecutiveFailures = 0;
      this.state.lastError = null;
    } else {
      this.state.consecutiveFailures++;
      this.state.lastError = error;
    }
  }

  /** Probes now, then every interval. Idempotent; the timer never keeps the process alive. */
  start(): void {
    if (this.timer !== null) return;
    void this.probeOnce();
    this.timer = setInterval(() => void this.probeOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): DirectoryProbeState {
    return { ...this.state };
  }
}

function isDirectoryReachable(state: DirectoryProbeState, now: number): boolean {
  return state.lastOkAt !== null && now - state.lastOkAt <= DIRECTORY_STALE_MS;
}

function ageSeconds(at: number | null, now: number): number | null {
  return at === null ? null : Math.floor((now - at) / 1000);
}

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------

export interface HealthBody {
  status: 'ok' | 'unavailable';
  directory: 'reachable' | 'unreachable' | 'unknown';
  directoryLastOkAgeS: number | null;
  gateway: 'ready' | 'starting';
}

/**
 * 200 iff the directory answered a probe within `DIRECTORY_STALE_MS`, else 503.
 * The gateway's start state is shown in the body only — it never sets the status.
 */
export function buildHealth(
  state: DirectoryProbeState,
  gatewayReady: boolean,
  now: number,
): { statusCode: 200 | 503; body: HealthBody } {
  let directory: HealthBody['directory'];
  if (state.lastAttemptAt === null && state.lastOkAt === null) directory = 'unknown';
  else if (isDirectoryReachable(state, now)) directory = 'reachable';
  else directory = 'unreachable';
  const ok = directory === 'reachable';
  return {
    statusCode: ok ? 200 : 503,
    body: {
      status: ok ? 'ok' : 'unavailable',
      directory,
      directoryLastOkAgeS: ageSeconds(state.lastOkAt, now),
      gateway: gatewayReady ? 'ready' : 'starting',
    },
  };
}

// ---------------------------------------------------------------------------
// Session registry
// ---------------------------------------------------------------------------

export interface ObservedSession {
  getPhase(): SessionPhase;
  getQueueStatus(): {
    rdoMetrics: {
      totalSent: number;
      totalTimedOut: number;
      totalErrorReplies: number;
      totalLateResponses: number;
      totalReconnectFailures: number;
    };
  };
}

export interface RdoTotals {
  sent: number;
  timedOut: number;
  errorReplies: number;
  lateResponses: number;
  reconnectFailures: number;
}

export interface SessionsSnapshot {
  total: number;
  byPhase: Record<SessionPhase, number>;
  rdo: RdoTotals;
}

function addRdo(into: RdoTotals, session: ObservedSession): void {
  const m = session.getQueueStatus().rdoMetrics;
  into.sent += m.totalSent;
  into.timedOut += m.totalTimedOut;
  into.errorReplies += m.totalErrorReplies;
  into.lateResponses += m.totalLateResponses;
  into.reconnectFailures += m.totalReconnectFailures;
}

/** Live sessions plus the folded counters of every session that has ended. */
export class SessionRegistry {
  private readonly live = new Set<ObservedSession>();
  private readonly retired: RdoTotals = { sent: 0, timedOut: 0, errorReplies: 0, lateResponses: 0, reconnectFailures: 0 };

  add(session: ObservedSession): void {
    this.live.add(session);
  }

  /** Folds the session's final counters into the retired total; a second call is a no-op. */
  remove(session: ObservedSession): void {
    if (!this.live.has(session)) return;
    addRdo(this.retired, session);
    this.live.delete(session);
  }

  snapshot(): SessionsSnapshot {
    const byPhase = {} as Record<SessionPhase, number>;
    for (const phase of Object.values(SessionPhase)) byPhase[phase] = 0;
    const rdo: RdoTotals = { ...this.retired };
    for (const session of this.live) {
      byPhase[session.getPhase()]++;
      addRdo(rdo, session);
    }
    return { total: this.live.size, byPhase, rdo };
  }
}

// ---------------------------------------------------------------------------
// /api/metrics and the METRICS log line
// ---------------------------------------------------------------------------

export interface GatewayMetrics {
  version: string;
  startedAt: string;
  uptimeS: number;
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
  sockets: { websocketsOpen: number };
  sessions: { total: number; byPhase: Record<SessionPhase, number> };
  rdo: RdoTotals;
  directory: {
    reachable: boolean | null;
    lastOkAgeS: number | null;
    lastProbeAgeS: number | null;
    consecutiveFailures: number;
    lastError: string | null;
  };
  /** Browser error reports on `/api/client-error` since process start. */
  clientErrors: ClientErrorCounts;
}

export function buildMetrics(input: {
  version: string;
  startedAtMs: number;
  now: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  websocketsOpen: number;
  sessions: SessionsSnapshot;
  directory: DirectoryProbeState;
  clientErrors: ClientErrorCounts;
}): GatewayMetrics {
  const { now, directory } = input;
  return {
    version: input.version,
    startedAt: new Date(input.startedAtMs).toISOString(),
    uptimeS: Math.floor((now - input.startedAtMs) / 1000),
    memory: {
      rssBytes: input.memory.rss,
      heapUsedBytes: input.memory.heapUsed,
      heapTotalBytes: input.memory.heapTotal,
    },
    sockets: { websocketsOpen: input.websocketsOpen },
    sessions: { total: input.sessions.total, byPhase: input.sessions.byPhase },
    rdo: { ...input.sessions.rdo },
    directory: {
      reachable: directory.lastAttemptAt === null && directory.lastOkAt === null
        ? null
        : isDirectoryReachable(directory, now),
      lastOkAgeS: ageSeconds(directory.lastOkAt, now),
      lastProbeAgeS: ageSeconds(directory.lastAttemptAt, now),
      consecutiveFailures: directory.consecutiveFailures,
      lastError: directory.lastError,
    },
    clientErrors: { ...input.clientErrors },
  };
}

/** The `version` field of the manifest next to `src/` / `dist/`; `'unknown'` if unreadable. */
export function readGatewayVersion(packageJsonPath: string = path.join(__dirname, '../../package.json')): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (parsed !== null && typeof parsed === 'object') {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') return version;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Logs `METRICS` at `info` every interval, on a timer that never keeps the process alive. */
export function startMetricsLog(
  collect: () => GatewayMetrics,
  log: { info(message: string, meta?: unknown): void },
  intervalMs: number = METRICS_LOG_INTERVAL_MS,
): { stop(): void } {
  const timer = setInterval(() => log.info('METRICS', collect()), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// Module singletons — no timer and no socket at load
// ---------------------------------------------------------------------------

export const directoryProbe = new DirectoryProbe({
  target: () => ({ host: config.rdo.directoryHost, port: config.rdo.ports.directory }),
});
export const sessionRegistry = new SessionRegistry();
export const PROCESS_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1000);
