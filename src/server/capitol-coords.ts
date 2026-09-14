/**
 * The Capitol coordinates the browser's search menu waits on.
 *
 * The browser blocks its search-menu flow until a RESP_CAPITOL_COORDS arrives, so this
 * answer is not optional: when the Directory Agent is slow or unreachable, the fetch
 * rejects and the socket must still be told "no Capitol" rather than left silent. A
 * rejection that only logged turned a transient DA timeout into a full client-side hang
 * for every flow gated on the search menu.
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

/**
 * Fetch the search menu's home page and answer the socket with whatever Capitol it
 * names. A fetch that rejects — a slow or unreachable Directory Agent — is logged and
 * then answered as "no Capitol", never left silent.
 */
export async function pushCapitolCoords(
  source: CapitolCoordsSource,
  ws: CapitolCoordsSocket,
  session: CapitolCoordsSession,
): Promise<void> {
  let coords: CapitolCoords | null = null;
  try {
    coords = findCapitolCoords(await source.getHomePage());
  } catch (err: unknown) {
    logger.error(`Failed to fetch Capitol coords: ${toErrorMessage(err)}`);
  }
  sendCapitolCoords(ws, session, coords);
  logger.debug(`Capitol coords: ${coords ? `${coords.x},${coords.y}` : 'none'}`);
}
