import type { WebSocket } from 'ws';
import type { StarpeaceSession } from '../spo_session';
import type { SearchMenuService } from '../search-menu-service';
import type { FacilityDimensionsCache } from '../facility-dimensions-cache';
import type { DatInventionIndex } from '../../shared/research-dat-parser';
import type { WsMessage, WsReqResumeSession } from '../../shared/types';

export interface WsHandlerContext {
  ws: WebSocket;
  session: StarpeaceSession;
  searchMenuService: SearchMenuService | null;
  facilityDimensionsCache: () => FacilityDimensionsCache;
  inventionIndex: DatInventionIndex | null;
  connectedClients: Map<WebSocket, string>;
  gmUsernames: Set<string>;
  /** Re-attach a parked gateway session to this WebSocket (server.ts owns the registry). */
  resumeSession?: (req: WsReqResumeSession) => Promise<void>;
  /** End every parked session of this username and wait for its Logoff, before a fresh login. */
  evictParkedSession?: (username: string) => Promise<void>;
}

export type WsHandler = (ctx: WsHandlerContext, msg: WsMessage) => Promise<void>;
