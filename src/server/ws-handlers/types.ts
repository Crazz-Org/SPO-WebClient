import type { WebSocket } from 'ws';
import type { StarpeaceSession } from '../spo_session';
import type { SearchMenuService } from '../search-menu-service';
import type { FacilityDimensionsCache } from '../facility-dimensions-cache';
import type { DatInventionIndex } from '../../shared/research-dat-parser';
import type { WsMessage } from '../../shared/types';

export interface WsHandlerContext {
  ws: WebSocket;
  session: StarpeaceSession;
  searchMenuService: SearchMenuService | null;
  facilityDimensionsCache: () => FacilityDimensionsCache;
  inventionIndex: DatInventionIndex | null;
  connectedClients: Map<WebSocket, string>;
  gmUsernames: Set<string>;
  /** Called once the world accepted a REQ_LOGIN_WORLD; the bug-report ticket records who logged in. */
  onWorldLogin?: (username: string, worldName: string) => void;
}

export type WsHandler = (ctx: WsHandlerContext, msg: WsMessage) => Promise<void>;
