/**
 * The gateway's one shutdown sequence: stop accepting, stop dispatching, warn every player
 * (close 1012), log every session off in parallel, stop the services, flush the logs, exit —
 * all under a single hard deadline.
 *
 * Pure module: no import of server.ts or spo_session.ts, so it is unit-testable on its own.
 */
import { WebSocket } from 'ws';
import { toErrorMessage } from '../shared/error-utils';

/**
 * WebSocket close code "Service Restart" — IANA-registered, RFC 6455 §7.4 registry.
 * The client declares its own copy in `client.ts`; nothing is shared through `src/shared/`.
 */
export const WS_CLOSE_SERVICE_RESTART = 1012;
export const WS_CLOSE_SERVICE_RESTART_REASON = 'Server restarting';

/**
 * Hard deadline for the whole shutdown sequence.
 *
 * Docker's default stop timeout is 10 s: `docker-compose.yml` sets no `stop_grace_period` and
 * SPO-Deploy's `deploy.sh` passes no `-t`, so SIGTERM becomes SIGKILL after 10 s. Each session's
 * Logoff is bounded at 5 s (`StarpeaceSession.LOGOFF_TIMEOUT_MS`, Voyager `LogoffTimeOut = 5000`,
 * `ServerCnxHandler.pas:330`) and the sessions log off in parallel, so 5 s plus margin fits
 * strictly below Docker's 10 s.
 */
export const SHUTDOWN_DEADLINE_MS = 8000;

/** The two session methods a teardown needs — structural, so no StarpeaceSession import. */
export interface SessionTeardownTarget {
  endSession(): Promise<void>;
  destroy(): void;
}

/**
 * One connection's teardown, run at most once: `endSession()`, then `destroy()` once it settles.
 * Every call returns the same promise, so the shutdown drain and the `ws.on('close')` handler
 * can both await it without either destroying the world socket under the other's Logoff.
 */
export function createSessionTeardown(
  session: SessionTeardownTarget,
  onError: (err: unknown) => void,
): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) {
      pending = (async () => {
        try {
          await session.endSession();
        } catch (err: unknown) {
          onError(err);
        }
        session.destroy();
      })();
    }
    return pending;
  };
}

/** The slice of a `ws` WebSocket the drain touches. */
export interface DrainableSocket {
  readyState: number;
  close(code?: number, reason?: string): void;
}

/** Tracks every live connection's teardown and drains them all on shutdown. */
export class ConnectionDrain {
  private draining = false;
  private readonly connections = new Map<DrainableSocket, () => Promise<void>>();

  track(ws: DrainableSocket, teardown: () => Promise<void>): void {
    this.connections.set(ws, teardown);
  }

  untrack(ws: DrainableSocket): void {
    this.connections.delete(ws);
  }

  isDraining(): boolean {
    return this.draining;
  }

  /** Stop dispatch, send 1012 to every open socket, and await every teardown in parallel. */
  async drain(): Promise<void> {
    this.draining = true;
    const teardowns: Promise<void>[] = [];
    for (const [ws, teardown] of [...this.connections]) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(WS_CLOSE_SERVICE_RESTART, WS_CLOSE_SERVICE_RESTART_REASON);
      }
      teardowns.push(teardown());
    }
    await Promise.allSettled(teardowns);
  }
}

export interface ShutdownSequenceDeps {
  server: { close(cb?: (err?: Error) => void): void };
  drain: ConnectionDrain;
  registry: { shutdown(): Promise<void> };
  closeLogTransports: () => Promise<void>;
  exit: (code: number) => void;
  log: { info(message: string): void; error(message: string): void };
  deadlineMs?: number;
}

/**
 * Build the shutdown sequence. The first call runs it; every later call returns the same promise.
 * A step that hangs is cut by the deadline, which exits 0 (the timeout path's historical code).
 */
export function createShutdownSequence(deps: ShutdownSequenceDeps): (reason: string) => Promise<void> {
  const deadlineMs = deps.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let running: Promise<void> | null = null;

  return (reason: string) => {
    if (running) return running;

    let exited = false;
    const exitOnce = (code: number): void => {
      if (exited) return;
      exited = true;
      clearTimeout(deadline);
      deps.exit(code);
    };
    const deadline = setTimeout(() => {
      deps.log.error(`[Shutdown] Deadline of ${deadlineMs}ms reached, exiting`);
      exitOnce(0);
    }, deadlineMs);

    running = (async () => {
      deps.log.info(`[Shutdown] ${reason}: draining connections`);
      try {
        // 1. Stop accepting — the listening socket closes at once; not awaited (keep-alive
        //    and upgraded sockets would hold the callback).
        deps.server.close();
        // 2-4. Stop dispatching, warn every player (1012), log every session off in parallel.
        await deps.drain.drain();
        // 5. Stop the background services.
        await deps.registry.shutdown();
        // 6. Flush the log files.
        await deps.closeLogTransports();
        exitOnce(0);
      } catch (err: unknown) {
        deps.log.error(`[Shutdown] Error during shutdown: ${toErrorMessage(err)}`);
        exitOnce(1);
      }
    })();
    return running;
  };
}
