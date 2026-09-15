/**
 * An independent reachability probe for the game server.
 *
 * It answers one question: do the sockets a drive needs accept a TCP connection from this
 * host, right now? It opens a connection and closes it without writing a byte — no login, no
 * RDO frame, no member call, nothing the world observes as traffic, and nothing that could be
 * mistaken for probing the live server for protocol facts.
 *
 * Two endpoints, because the game server is two sockets:
 *
 * - the **directory front door** (`RDO_DIR_HOST`, port 1111) the gateway is configured with.
 *   Every drive begins with a directory logon, so if that socket does not open, nothing
 *   downstream could have run.
 * - the **world server** the directory hands back at runtime (`158.69.153.134:8000` on
 *   2026-09-13). Its address is unknown to a process that never logged in — so instead of
 *   guessing it, the probe reads it out of the drive's own log: a failed connect is logged by
 *   Node as `connect ETIMEDOUT <ip>:<port>`, which names the exact endpoint the drive could
 *   not reach. Re-dialling that endpoint, after the fact and outside the drive, is what tells
 *   "the world server is down" apart from "this change broke the login path".
 */
import * as fs from 'fs';
import * as net from 'net';
import { config } from '../../shared/config';
import { toErrorMessage } from '../../shared/error-utils';

/** host:port of the RDO front door, and how the attempt went. */
export interface ReachabilityResult {
  ok: boolean;
  /** `host:port` — named in the detail so a human knows what was tried. */
  target: string;
  detail: string;
}

/** How long a connect attempt may take before the answer is "no". */
export const GAME_SERVER_PROBE_TIMEOUT_MS = 10_000;

/** A host and a port the drive needed to reach. */
export interface Endpoint {
  host: string;
  port: number;
}

/**
 * How many log-named endpoints are re-dialled at most. A drive that failed every flow names
 * the same one or two addresses over and over; the cap bounds the worst case (a log full of
 * distinct addresses) so the probe cannot outlast the job it is explaining.
 */
export const MAX_LOG_ENDPOINTS = 4;

/**
 * Node writes a refused or timed-out connect as `connect ECONNREFUSED 1.2.3.4:8000`, and that
 * text reaches the drive's log verbatim. It is the only place the world server's address is
 * written down on this host.
 */
const CONNECT_FAILURE = /connect E[A-Z]+ (\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/g;

/** Every distinct endpoint the drive's own log says it could not connect to, in first-seen order. */
export function endpointsFromDriveLog(text: string): Endpoint[] {
  const seen = new Set<string>();
  const found: Endpoint[] = [];
  for (const match of text.matchAll(CONNECT_FAILURE)) {
    const host = match[1];
    const port = Number(match[2]);
    const label = `${host}:${port}`;
    if (seen.has(label)) continue;
    seen.add(label);
    found.push({ host, port });
  }
  return found;
}

/** The endpoint the gateway itself dials first — src/shared/config.ts's `rdo` block. */
export function gameServerTarget(): { host: string; port: number } {
  return { host: config.rdo.directoryHost, port: config.rdo.ports.directory };
}

/** The slice of `net.Socket` the probe uses; a test fake needs only these. */
export interface ProbeSocket {
  setTimeout(ms: number, callback: () => void): void;
  once(event: 'connect', listener: () => void): void;
  once(event: 'error', listener: (err: Error) => void): void;
  destroy(): void;
}
export type SocketFactory = (host: string, port: number) => ProbeSocket;

const defaultCreateSocket: SocketFactory = (host, port) => net.createConnection({ host, port });

/** Never rejects: the answer is always a ReachabilityResult. */
export function probeGameServer(
  target: { host: string; port: number } = gameServerTarget(),
  timeoutMs: number = GAME_SERVER_PROBE_TIMEOUT_MS,
  createSocket: SocketFactory = defaultCreateSocket,
): Promise<ReachabilityResult> {
  const { host, port } = target;
  const label = `${host}:${port}`;
  return new Promise(resolve => {
    const socket = createSocket(host, port);
    let settled = false;
    const finish = (result: ReachabilityResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => {
      finish({ ok: false, target: label, detail: `connect timed out after ${timeoutMs}ms` });
    });
    socket.once('connect', () => {
      finish({ ok: true, target: label, detail: 'connected' });
    });
    socket.once('error', (err: Error) => {
      finish({ ok: false, target: label, detail: toErrorMessage(err) });
    });
  });
}

/** Reads the drive's log file; a test hands in the text directly. */
export type LogReader = (logFile: string) => string;

const defaultReadLog: LogReader = logFile => fs.readFileSync(logFile, 'utf8');

/**
 * The whole answer for one failed drive: the directory front door first, then every world
 * server the drive's own log says it could not reach.
 *
 * `ok: false` is only ever returned for an endpoint this probe itself failed to open, after
 * the drive had already finished — that, and nothing else, is what downgrades a FAIL. A log
 * that cannot be read, or that names no failed endpoint, leaves `ok: true`: the probe has no
 * evidence of an outage, so the drive's FAIL stands.
 */
export async function probeDriveEndpoints(
  logFile: string,
  createSocket: SocketFactory = defaultCreateSocket,
  timeoutMs: number = GAME_SERVER_PROBE_TIMEOUT_MS,
  readLog: LogReader = defaultReadLog,
): Promise<ReachabilityResult> {
  const front = await probeGameServer(gameServerTarget(), timeoutMs, createSocket);
  if (!front.ok) return front;

  let text: string;
  try {
    text = readLog(logFile);
  } catch (err: unknown) {
    return {
      ok: true,
      target: front.target,
      detail: `the directory front door answered, and the drive log could not be read (${toErrorMessage(err)}), so no world server was probed`,
    };
  }

  const endpoints = endpointsFromDriveLog(text).slice(0, MAX_LOG_ENDPOINTS);
  if (endpoints.length === 0) {
    return {
      ok: true,
      target: front.target,
      detail: 'the directory front door answered, and the drive log names no unreachable endpoint',
    };
  }

  const answered: string[] = [];
  for (const endpoint of endpoints) {
    const result = await probeGameServer(endpoint, timeoutMs, createSocket);
    if (!result.ok) {
      return {
        ok: false,
        target: result.target,
        detail: `${result.detail} — the drive's own log names this endpoint as unreachable, and it is still unreachable now (the directory front door ${front.target} answered)`,
      };
    }
    answered.push(result.target);
  }
  return {
    ok: true,
    target: [front.target, ...answered].join(', '),
    detail: 'every endpoint the drive failed to reach answers this probe',
  };
}
