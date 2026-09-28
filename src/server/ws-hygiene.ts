/**
 * WebSocket hygiene — the dead-socket heartbeat (policy SEC-W-6).
 *
 * Pure module: no import of server.ts or spo_session.ts. The heartbeat only ever terminates a
 * WebSocket; the gateway's own `ws.on('close')` handler does the rest (logoff, per-IP slot).
 */

/** Ping interval for dead-socket detection (policy SEC-W-6, maintainer decision 2026-09-27). */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** The slice of a `ws` WebSocket the heartbeat touches — structural, so tests pass a fake. */
export interface HeartbeatSocket {
  ping(): void;
  terminate(): void;
  on(event: 'pong', listener: () => void): unknown;
}

/** The slice of a `ws` WebSocketServer the heartbeat touches. */
export interface HeartbeatServer {
  readonly clients: Iterable<HeartbeatSocket>;
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}

/**
 * Every `intervalMs`, terminate each socket in `wss.clients` whose previous ping got no pong,
 * and ping the others. A socket that dies just after answering is closed on the second tick
 * after its death, so within 2 × `intervalMs`. Returns an idempotent stop function; the
 * heartbeat also stops when `wss` emits `close`.
 */
export function startHeartbeat(wss: HeartbeatServer, intervalMs: number): () => void {
  const awaitingPong = new WeakMap<HeartbeatSocket, boolean>();

  const tick = (): void => {
    for (const ws of wss.clients) {
      const state = awaitingPong.get(ws);
      if (state === true) {
        ws.terminate();
        continue;
      }
      if (state === undefined) {
        ws.on('pong', () => awaitingPong.set(ws, false));
      }
      awaitingPong.set(ws, true);
      try {
        ws.ping();
      } catch {
        // Not open yet (CONNECTING) — the next tick decides.
      }
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();

  const stop = (): void => {
    clearInterval(timer);
    wss.removeListener('close', stop);
  };
  wss.once('close', stop);
  return stop;
}
