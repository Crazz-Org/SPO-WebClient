/**
 * SessionContext — Narrow interface for extracted handler modules.
 *
 * `StarpeaceSession` implements this interface so that handler functions
 * can call session methods without importing the full class.
 * This prevents circular imports and keeps handlers independently testable.
 */

import type { RdoPacket, WorldInfo, CompanyInfo, ChatUser } from '../../shared/types';
import type { TimeoutCategory } from '../../shared/timeout-categories';
import type { AspActionUrl } from '../asp-url-extractor';

export interface SessionContext {
  // ── RDO Transport ──────────────────────────────────────────────────────
  sendRdoRequest(socketName: string, packetData: Partial<RdoPacket>, timeoutMs: number | undefined, category: TimeoutCategory): Promise<RdoPacket>;

  // ── Socket access (for fire-and-forget push commands) ──────────────────
  getSocket(name: string): import('net').Socket | undefined;

  // ── Cacher Object Pool ─────────────────────────────────────────────────
  cacherCreateObject(): Promise<string>;
  cacherSetObject(tempObjectId: string, x: number, y: number): Promise<void>;
  cacherSetPath(tempObjectId: string, path: string): Promise<void>;
  cacherGetPropertyList(tempObjectId: string, propertyNames: string[]): Promise<string[]>;
  cacherCloseObject(tempObjectId: string): void;

  // ── ASP/HTTP Utilities ─────────────────────────────────────────────────
  buildAspBaseParams(): URLSearchParams;
  buildAspUrl(aspPath: string, extraParams?: Record<string, string>): string;
  fetchAspPage(aspPath: string, extraParams?: Record<string, string>): Promise<string>;

  // ── Service Connections ────────────────────────────────────────────────
  connectMapService(): Promise<void>;
  connectConstructionService(): Promise<void>;
  ensureMailConnection(): Promise<void>;

  // ── Higher-level building helpers ──────────────────────────────────────
  getCacherPropertyListAt(x: number, y: number, propertyNames: string[]): Promise<string[]>;
  focusBuilding(x: number, y: number): Promise<{ buildingId: string; buildingName: string; ownerName: string }>;

  // ── Cross-handler calls ────────────────────────────────────────────────
  manageConstruction(x: number, y: number, action: 'START' | 'STOP' | 'DOWN', count?: number): Promise<{ status: string; error?: string }>;

  // ── ASP Action Cache ───────────────────────────────────────────────────
  getAspActionCache(aspPath: string): Map<string, AspActionUrl> | undefined;
  setAspActionCache(aspPath: string, actions: Map<string, AspActionUrl>): void;

  // ── Read-only Session State ────────────────────────────────────────────
  readonly worldContextId: string | null;
  readonly interfaceServerId: string | null;
  readonly tycoonId: string | null;
  readonly cacherId: string | null;
  readonly worldId: string | null;
  readonly currentWorldInfo: WorldInfo | null;
  readonly activeUsername: string | null;
  readonly cachedUsername: string | null;
  readonly cachedPassword: string | null;
  readonly currentCompany: CompanyInfo | null;
  readonly daAddr: string | null;
  readonly daPort: number | null;
  readonly mailServerId: string | null;
  /** Mail session id from LogServerOn — required by CheckNewMail (MailServer.pas:543). */
  readonly mailIntServerId: string | null;
  readonly mailAccount: string | null;
  readonly worldXSize: number | null;
  readonly worldYSize: number | null;
  readonly fTycoonProxyId: number | null;
  readonly accountMoney: string | null;
  readonly failureLevel: number | null;
  readonly lastRanking: number;
  readonly lastBuildingCount: number;
  readonly lastMaxBuildings: number;
  /** The session language, carried as `LangId` on every ASP fetch. */
  readonly languageId: string;

  // ── Writable State (explicit setters) ──────────────────────────────────
  setCurrentChannel(channel: string): void;
  setChatUsers(users: Map<string, ChatUser>): void;
  setAccountMoney(value: string): void;

  // ── Building Focus State ───────────────────────────────────────────────
  readonly currentFocusedBuildingId: string | null;
  readonly currentFocusedCoords: { x: number; y: number } | null;
  readonly currentFocusedBuildingName: string | null;
  readonly currentFocusedOwnerName: string | null;
  clearBuildingFocus(): void;

  // ── Event Emission + Helpers ───────────────────────────────────────────
  emit(event: string, ...args: unknown[]): boolean;
  convertToProxyUrl(remoteUrl: string): string;

  // ── Logging ────────────────────────────────────────────────────────────
  readonly log: {
    debug(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    setField(key: string, value: string | null): void;
  };
}
