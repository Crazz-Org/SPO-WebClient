/**
 * The Capitol coordinates the browser's search menu waits on.
 *
 * The browser blocks its search-menu flow until a RESP_CAPITOL_COORDS arrives, so this
 * answer is not optional. A fetch that rejects — a slow or unreachable Directory Agent —
 * is retried up to a short budget before giving up, so a login during a transient DA hang
 * still gets the real Capitol once the DA recovers. The socket is answered exactly once,
 * either with the Capitol that finally arrived or with `hasCapitol: false` once the budget
 * is spent — never left silent.
 */

import type { SearchMenuCategory } from '../shared/types/domain-types';
import { WsMessageType, type WsRespCapitolCoords } from '../shared/types/message-types';
import { createLogger } from '../shared/logger';
import { toErrorMessage } from '../shared/error-utils';

const logger = createLogger('CapitolCoords');

/** A map position, as the search menu reports it. */
export interface CapitolCoords {
  x: number;
  y: number;
}

/** Just enough of the WebSocket to answer on it. */
export interface CapitolCoordsSocket {
  send(data: string): void;
}

/** Just enough of the session to remember the answer. */
export interface CapitolCoordsSession {
  setCapitolCoords(coords: CapitolCoords | null): void;
}

/**
 * The Capitol entry of a search-menu home page, or `null` when the page has no usable
 * one — absent, disabled, or carrying an incomplete position.
 */
export function findCapitolCoords(categories: SearchMenuCategory[]): CapitolCoords | null {
  const capitol = categories.find(c => c.label === 'Capitol' && c.enabled && c.x != null && c.y != null);
  return capitol ? { x: capitol.x!, y: capitol.y! } : null;
}

/**
 * Record the coordinates on the session and answer the socket. Always answers: `null`
 * becomes `hasCapitol: false`, which is what the browser needs to stop waiting.
 */
export function sendCapitolCoords(
  ws: CapitolCoordsSocket,
  session: CapitolCoordsSession,
  coords: CapitolCoords | null,
): void {
  session.setCapitolCoords(coords);
  const resp: WsRespCapitolCoords = {
    type: WsMessageType.RESP_CAPITOL_COORDS,
    x: coords?.x ?? 0,
    y: coords?.y ?? 0,
    hasCapitol: coords !== null,
  };
  ws.send(JSON.stringify(resp));
}

/** Just enough of the search menu to ask it for its home page. */
export interface CapitolCoordsSource {
  getHomePage(): Promise<SearchMenuCategory[]>;
}

/** Attempts spent on a rejecting home-page fetch, including the first. */
const DEFAULT_ATTEMPTS = 4;
/** Pause between two attempts, in milliseconds. */
const DEFAULT_DELAY_MS = 2000;

/** How much the fetch may retry, and how it waits. Tests inject `sleep`. */
export interface CapitolCoordsRetryOptions {
  /** Total attempts including the first. Clamped to at least 1. Default 4. */
  attempts?: number;
  /** Pause between attempts, in ms. Default 2000. */
  delayMs?: number;
  /** Injected by tests so no real time passes; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Fetch the search menu's home page and answer the socket with whatever Capitol it
 * names. A fetch that rejects — a slow or unreachable Directory Agent — is retried up
 * to the budget before the socket is answered "no Capitol"; a fetch that resolves with
 * no usable Capitol entry answers immediately, since retrying would only delay a real
 * answer. Exactly one RESP_CAPITOL_COORDS is sent, on every path.
 */
export async function pushCapitolCoords(
  source: CapitolCoordsSource,
  ws: CapitolCoordsSocket,
  session: CapitolCoordsSession,
  options: CapitolCoordsRetryOptions = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); }));

  let coords: CapitolCoords | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      coords = findCapitolCoords(await source.getHomePage());
      break;
    } catch (err: unknown) {
      logger.error(`Failed to fetch Capitol coords (attempt ${attempt}/${attempts}): ${toErrorMessage(err)}`);
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  sendCapitolCoords(ws, session, coords);
  logger.debug(`Capitol coords: ${coords ? `${coords.x},${coords.y}` : 'none'}`);
}
