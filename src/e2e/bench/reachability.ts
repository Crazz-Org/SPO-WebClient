/**
 * An independent reachability probe for the RDO directory endpoint.
 *
 * It answers one question: does the game server accept a TCP connection from this host,
 * right now? It opens a connection and closes it without writing a byte — no login, no RDO
 * frame, no member call, nothing the world observes as traffic, and nothing that could be
 * mistaken for probing the live server for protocol facts.
 *
 * It is deliberately the directory endpoint, not the world server: every drive begins with a
 * directory logon, so that socket is the front door — if it does not open, nothing downstream
 * could have run. The world server's address is handed back by the directory at runtime and is
 * unknown to a process that never logged in, so this probe cannot answer for it.
 */
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
