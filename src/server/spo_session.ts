import * as net from 'net';
import { EventEmitter } from 'events';
import { fetchWithTimeout } from './fetch-with-timeout';
import { TimeoutCategory, TIMEOUT_CONFIG, IS_PROXY_TIMEOUT_MS } from '../shared/timeout-categories';
import {
  RdoPacket,
  RdoVerb,
  RdoAction,
  RDO_CONSTANTS,
  RDO_PORTS,
  SessionPhase,
  WorldInfo,
  WsMessageType,
  CompanyInfo,
  MapData,
  ChatUser,
  BuildingFocusInfo,
  WsEventBuildingRefresh,
  WsEventAreaRefresh,
  BuildingCategory,
  BuildingInfo,
  SurfaceData,
  SurfaceType,
  BuildingDetailsResponse,
  MailMessageHeader,
  MailMessageFull,
  TycoonProfileFull,
  CurriculumData,
  BankAccountData,
  BankActionResult,
  ProfitLossData,
  CompaniesData,
  AutoConnectionsData,
  PolicyData,
  PoliticsData,
  NewspaperBoard,
  NewspaperIssue,
  NewspaperIssueList,
  PoliticalRoleInfo,
  ConnectionSearchResult,
  FavoritesItem,
  ResearchCategoryData,
  ResearchInventionDetails,
  ClusterInfo,
  ClusterFacilityPreview
} from '../shared/types';
import { RdoFramer, RdoProtocol } from './rdo';
import {
  RdoValue,
  RdoParser,
} from '../shared/rdo-types';
import { rdoCall, rdoGet, rdoIdOf } from '../shared/rdo-frame';
import type { RoadTileFacts } from '../shared/road-cost';
import { config } from '../shared/config';
import { createLogger, generateSessionId } from '../shared/logger';
import { toProxyUrl, isProxyUrl } from '../shared/proxy-utils';
import { toErrorMessage } from '../shared/error-utils';
import {
  cleanPayload as cleanPayloadHelper,
  splitMultilinePayload as splitMultilinePayloadHelper,
  parsePropertyResponse as parsePropertyResponseHelper,
  parseIdOfResponse as parseIdOfResponseHelper,
  isTrueOrdinal,
  writeRdoFrame,
  tagRdoSocket,
} from './rdo-helpers';
import type { AspActionUrl } from './asp-url-extractor';
import {
  parseBuildings as parseBuildingsHelper,
  parseSegments as parseSegmentsHelper,
  parseBuildingFocusResponse as parseBuildingFocusResponseHelper,
} from './map-parsers';

import * as chatHandler from './session/chat-handler';
import * as mailHandler from './session/mail-handler';
import * as profileFinanceHandler from './session/profile-finance-handler';
import * as autoConnectionHandler from './session/auto-connection-handler';
import * as politicsHandler from './session/politics-handler';
import * as favoritesHandler from './session/favorites-handler';
import type { FavoriteMutationResult } from './session/favorites-handler';
import * as newspaperHandler from './session/newspaper-handler';
import type { NewspaperTarget } from './session/newspaper-handler';
import * as buildingManagementHandler from './session/building-management-handler';
import * as roadHandler from './session/road-handler';
import * as zoneSurfaceHandler from './session/zone-surface-handler';
import * as buildingTemplatesHandler from './session/building-templates-handler';
import * as buildingDetailsHandler from './session/building-details-handler';
import * as buildingPropertyHandler from './session/building-property-handler';
import * as researchHandler from './session/research-handler';
import { dispatchPush } from './session/push-dispatcher';
import * as loginHandler from './session/login-handler';
import { canBufferRequest, isConnectionBoundMember } from './session/request-routing';
import { requireDaParams } from './session/asp-da-params';
import { classifyRdoError, ErrorRecovery } from './session/rdo-error-classifier';
import { handleRdoErrorResponse } from './session/rdo-error-contract';
import { RdoConnectionPool, PooledConnection } from './session/rdo-connection-pool';


// Pure utility functions moved to session/session-utils.ts — re-export for backward compat
export { parseFavoritesResponse, deriveResidenceClass } from './session/session-utils';

/** Redact password arguments from sensitive RDO commands before logging. */
const SENSITIVE_MEMBERS = new Set(['RDOLogonUser', 'Logon', 'AccountStatus', 'RDOLogonClient']);
function redactRdoRaw(member: string | undefined, raw: string): string {
  if (!member || !SENSITIVE_MEMBERS.has(member)) return raw;
  // P-L8: the previous pattern was `/,"%[^"]*"(?=\s*$)/`. `[^"]*` stops at the
  // first quote, so a password containing one — which arrives doubled on the
  // wire, `""` — ended the match early, the `$` anchor then failed, and the
  // whole frame went to the log verbatim. Passwords with a quote were the only
  // ones that leaked, which is why it went unnoticed.
  //
  // `(?:[^"]|"")*` consumes doubled quotes as data, matching the literal grammar
  // (RDOStrEncode, RDOUtils.pas:246-254). The trailing `;` is optional because
  // the framer strips it before some log sites see the frame.
  return raw.replace(/,"%(?:[^"]|"")*"(?=\s*;?\s*$)/, ',"%[REDACTED]"');
}

/** Tracks an in-flight RDO request with state machine for late response detection. */
interface PendingRdoRequest {
  resolve: (msg: RdoPacket) => void;
  reject: (err: unknown) => void;
  state: 'pending' | 'timed-out';
  sentAt: number;
  member: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/** RDO request lifecycle metrics (exposed via getQueueStatus). */
interface RdoMetrics {
  totalSent: number;
  totalResolved: number;
  totalTimedOut: number;
  totalLateResponses: number;
  totalOrphaned: number;
  totalReconnectAttempts: number;
  totalReconnectSuccesses: number;
  totalReconnectFailures: number;
  lastReconnectAt: number | null;
  totalServerBusyPollFailures: number;
}

/**
 * Escape hatches on `sendRdoRequest()` — the function every RDO call in the
 * project goes through. Both exist for the ServerBusy poll (audit O-L5), which
 * previously hand-rolled the whole primitive to get them, and drifted: it
 * bypassed `assertNotVoidPush`, the `errorCode` contract (P-M3), the metrics,
 * and logged `RDO>*` instead of `RDO>>`.
 *
 * Deliberately not exported for general use — a caller that needs either of
 * these is either the busy poll or a bug.
 */
interface RdoRequestOptions {
  /**
   * Send even while `isServerBusy`, instead of buffering.
   * Only correct for the request that DECIDES whether the server is still busy:
   * buffering it deadlocks the session, since the only other thing that clears
   * the flag is a `ModelStatusChanged` push.
   */
  bypassBusyGate?: boolean;
  /**
   * Never take a world pool connection. The busy poll measures the health of
   * the connection the session actually lives on, and a poll answered by a pool
   * connection that is about to be replaced would count as a poll failure —
   * four of those stop polling for good (legacy parity, `MAX_CONSECUTIVE_POLL_FAILURES`).
   */
  forcePrimarySocket?: boolean;
}

export class StarpeaceSession extends EventEmitter {
  public readonly sid = generateSessionId();
  public readonly startedAt = Date.now();
  public log = createLogger('Session').child({ sid: this.sid }).withRingBuffer(config.logging.ringBufferSize);
  private sockets: Map<string, net.Socket> = new Map();
  private framers: Map<string, RdoFramer> = new Map();
  /** Per-user DA connection pool (mirrors Delphi TRDOConnectionPool, MaxDAPoolCnx=8) */
  private worldPool: RdoConnectionPool | null = null;
  private static readonly WORLD_POOL_SIZE = 6;
  /**
   * Builds every raw TCP socket the session opens — named sockets and pool
   * connections alike. `purpose` is the socket name ('world', 'map', …) or
   * `pool:<host>:<port>`, so an injected factory can tell them apart.
   * Injected by the protocol test harness; production keeps the default.
   */
  private socketFactory: (purpose: string) => net.Socket = () => new net.Socket();
  /**
   * Whether this session may populate its world pool at all. Defaults to the
   * global config; the protocol harness overrides it per session so pool
   * behaviour is exercised only by the tests that opt in.
   */
  private worldPoolEnabled: boolean = config.rdo.worldPool;
  private phase: SessionPhase = SessionPhase.DISCONNECTED;
  private isClosing = false;
  private requestIdCounter: number = 1000;

  /**
   * Convert remote image URL to local proxy URL
   * Keeps original filename for debugging
   */
  public convertToProxyUrl(remoteUrl: string): string {
    if (!remoteUrl || isProxyUrl(remoteUrl)) {
      return remoteUrl;
    }

    // Use baseHost for relative URLs
    const baseHost = this.currentWorldInfo?.ip;
    return toProxyUrl(remoteUrl, baseHost);
  }

  /**
   * Get the proxied Capitol icon URL for the current game server.
   */
  public getCapitolIconUrl(): string {
    return this.convertToProxyUrl('/five/0/visual/voyager/Build/images/capitol.jpg');
  }

  // Capitol coordinates (per-world, set from DirectoryMain.asp)
  private capitolCoords: { x: number; y: number } | null = null;

  public getCapitolCoords(): { x: number; y: number } | null {
    return this.capitolCoords;
  }

  public setCapitolCoords(coords: { x: number; y: number } | null): void {
    this.capitolCoords = coords;
  }

  // Pending requests map — entries transition from 'pending' to 'timed-out'
  // to catch late responses instead of logging "Unmatched response RID"
  private pendingRequests = new Map<number, PendingRdoRequest>();
  private availableWorlds: Map<string, WorldInfo> = new Map();

  // Event synchronization
  private interfaceEventsId: string | null = null;
  private waitingForInitClient: boolean = false;
  private initClientReceived: Promise<void> | null = null;
  private initClientResolver: (() => void) | null = null;

  // Session State
  private directorySessionId: string | null = null;
  public worldContextId: string | null = null;
  public tycoonId: string | null = null;
  public currentWorldInfo: WorldInfo | null = null;
  private _rdoCnntId: string | null = null;
  public get rdoCnntId(): string | null { return this._rdoCnntId; }
  public cacherId: string | null = null;
  public worldId: string | null = null;
  public daAddr: string | null = null;
  public daPort: number | null = null;

  /** Cache of action URLs extracted from ASP HTML responses, keyed by ASP page path */
  private aspActionCache: Map<string, Map<string, AspActionUrl>> = new Map();

  // InitClient data (received during login)
  private virtualDate: number | null = null; // Server virtual date (Double)
  public accountMoney: string | null = null; // Account money (can be very large)
  public failureLevel: number | null = null; // Company status (0 = nominal, >0 = in debt)
  /**
   * The model server's pointer to our TTycoon, pushed by InitClient.
   *
   * This is the id every model-server member that dereferences a tycoon wants —
   * `RDOGetTycoon` returns `integer(Tycoon)` (Kernel/World.pas:3827), the
   * Interface Server keeps it as fTycoonProxyId (InterfaceServer.pas:3225) and
   * pushes it as InitClient's 4th argument (:1835), and Voyager hands it
   * straight back through `getTycoonId` (ServerCnxHandler.pas:2419-2421).
   *
   * Do not confuse it with {@link tycoonId}, which is the persistent
   * `TTycoon.Id` read off the Interface Server's ClientView
   * (InterfaceServer.pas:128,3237). That one belongs to the Interface Server
   * members that take a tycoon id by value (GetTycoonCookie, SetTycoonCookie,
   * CloneFacility, PickEvent); using it where a pointer is expected costs a
   * silent no-op, because the resulting access violation is swallowed
   * server-side (e.g. Kernel/Kernel.pas:4576-4578).
   *
   * The previous note here claimed the opposite — "IS-local handle, NOT valid on
   * World server" — and it is what put the wrong id on RDOConnectToTycoon.
   */
  public fTycoonProxyId: number | null = null;

  // RefreshTycoon push data (updated periodically by server)
  public lastRanking: number = 0;
  public lastBuildingCount: number = 0;
  public lastMaxBuildings: number = 0;

  // Credentials cache
  public cachedUsername: string | null = null;
  private _cachedPassword: string | null = null;
  public get cachedPassword(): string | null { return this._cachedPassword; }
  private cachedZonePath: string = 'Root/Areas/Asia/Worlds';

  // Active login identity — differs from cachedUsername during role-based company switches
  // (e.g., "President of Shamba" vs original tycoon "SPO_test3")
  public activeUsername: string | null = null;

  // Current company info (for role-based switching)
  public currentCompany: CompanyInfo | null = null;
  private availableCompanies: CompanyInfo[] = [];

  // Additional world properties
  public mailAccount: string | null = null;
  public interfaceServerId: string | null = null;
  private mailAddr: string | null = null;
  private mailPort: number | null = null;
  public mailServerId: string | null = null;
  /** Mail session id returned by LogServerOn — required by CheckNewMail (MailServer.pas:543). */
  public mailIntServerId: string | null = null;
  public worldXSize: number | null = null;
  public worldYSize: number | null = null;
  private worldSeason: number | null = null;  // 0=Winter, 1=Spring, 2=Summer, 3=Autumn

  // Known Objects Registry for bidirectional communication
  private knownObjects: Map<string, string> = new Map();

  //Last known player position from cookies
  private lastPlayerX: number = 0;
  private lastPlayerY: number = 0;
  
    // Chat state
  private currentChannel: string = ''; // Empty = lobby
  private chatUsers: Map<string, ChatUser> = new Map();
  
    // Building focus tracking
  public currentFocusedBuildingId: string | null = null;
  public currentFocusedCoords: { x: number, y: number } | null = null;
  public currentFocusedBuildingName: string | null = null;
  public currentFocusedOwnerName: string | null = null;
  
  // RDO request lifecycle metrics
  private rdoMetrics: RdoMetrics = {
    totalSent: 0,
    totalResolved: 0,
    totalTimedOut: 0,
    totalLateResponses: 0,
    totalOrphaned: 0,
    totalReconnectAttempts: 0,
    totalReconnectSuccesses: 0,
    totalReconnectFailures: 0,
    lastReconnectAt: null,
    totalServerBusyPollFailures: 0,
  };

  // GC sweep for timed-out entries that never received a late response
  private gcSweepInterval: NodeJS.Timeout | null = null;
  private readonly GC_SWEEP_INTERVAL_MS = 60_000;
  private readonly LATE_RESPONSE_GRACE_MS = 90_000;

  // NEW: Request buffering with ServerBusy pause/resume
  private requestBuffer: Array<{
    socketName: string;
    packetData: Partial<RdoPacket>;
    effectiveTimeout: number;
    resolve: (packet: RdoPacket) => void;
    reject: (err: unknown) => void;
  }> = [];
  private readonly MAX_BUFFER_SIZE = 20; // Delphi queues far more; 5 was too aggressive
  private isServerBusy: boolean = false;
  private serverBusyCheckInterval: NodeJS.Timeout | null = null;
  /** Legacy cadence: LEDsTimer (1s) gated `mod 50` → ServerBusy read every ~50s (ToolbarHandlerViewer.pas:160-162). */
  private readonly SERVER_BUSY_CHECK_INTERVAL_MS = 50_000;
  private isPolling = false;
  private consecutivePollFailures = 0;
  /** Legacy: fExceptCount < 4 gate — polling STOPS after 4 consecutive exceptions, no reconnect (ServerCnxHandler.pas:3596-3611). */
  private static readonly MAX_CONSECUTIVE_POLL_FAILURES = 4;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private readonly KEEP_ALIVE_INTERVAL_MS = 60000; // Matches Delphi CacheConnectionTimeOut

  // --- MAINTENANCE MODE (mirrors Delphi fMaintDue + fMSDownCount + MaxDownCountAllowed) ---
  private maintenanceMode = false;
  private modelServerDownCount = 0;
  private static readonly MAX_DOWN_COUNT_ALLOWED = 3; // Delphi: MaxDownCountAllowed = 3

  // --- CONSECUTIVE RDO FAILURE COUNTER (telemetry only) ---
  // Tracks consecutive RDO request timeouts. LEGACY PARITY: this never triggers
  // a reconnect — the Voyager client's ReportCnxFailure is a no-op
  // (ServerCnxHandler.pas:3394-3405); reconnection happens ONLY on a real
  // socket disconnect. Exposed via logs/metrics for diagnostics.
  private consecutiveRdoFailures = 0;

  // Map-specific throttling
  private activeMapRequests: number = 0;
  private readonly MAX_CONCURRENT_MAP_REQUESTS = 3; // Maximum 3 zone requests at once
  
  // --- REQUEST DEDUPLICATION ---
    private pendingMapRequests: Map<string, Promise<MapData>> = new Map();
    /**
     * Concurrent focusBuilding(x,y) calls for the SAME coordinates share one
     * SwitchFocusEx. The client fires REQ_BUILDING_FOCUS and the details
     * fetch in parallel on every building click — without dedup each click
     * costs the server two identical SwitchFocusEx calls.
     */
    private pendingFocusRequests: Map<string, Promise<BuildingFocusInfo>> = new Map();
    /**
     * Short-lived reuse of the last focus result. The click's two WS
     * messages are handled back-to-back (not concurrently), so the pending
     * map alone doesn't dedup them. A repeat SwitchFocusEx(id,x,y) on the
     * already-focused building makes the server do a pointless
     * unfocus+refocus of the same object (SwitchFocus, InterfaceServer.pas:906-922).
     */
    private lastFocusInfo: BuildingFocusInfo | null = null;
    private lastFocusAt = 0;
    private static readonly FOCUS_REUSE_TTL_MS = 3000;

  // --- WORLD SOCKET AUTO-RECONNECT (mirrors Delphi RenewWorldProxy) ---
  private worldReconnectLastAttempt = 0;
  private worldReconnecting: Promise<void> | null = null;
  private worldReconnectAttempts = 0;
  /** Fast phase: exponential backoff (5s, 10s, 20s) */
  private static readonly RECONNECT_FAST_RETRIES = 3;
  private static readonly RECONNECT_BASE_BACKOFF_MS = 5000; // Delphi: 5s throttle
  /** Slow phase: fixed 15s interval, mirrors Delphi TReconnectThread's persistence */
  private static readonly RECONNECT_SLOW_INTERVAL_MS = 15_000;
  private static readonly RECONNECT_SLOW_RETRIES = 20; // 15s × 20 = 5 min
  private static readonly RECONNECT_MAX_RETRIES =
    StarpeaceSession.RECONNECT_FAST_RETRIES + StarpeaceSession.RECONNECT_SLOW_RETRIES;

  // --- GRACEFUL LOGOFF (mirrors Delphi ServerCnxHandler.Logoff) ---
  /** Delphi LogoffTimeOut = 5000 (ServerCnxHandler.pas:330) */
  private static readonly LOGOFF_TIMEOUT_MS = 5000;
  /** Set once endSession() has logged off — makes it idempotent and disables auto-reconnect on the resulting socket close. */
  private loggedOff = false;

  constructor() {
    super();
  }

  // -- SessionContext compliance ------------------------------------------
  public getSocket(name: string): import('net').Socket | undefined {
    return this.sockets.get(name);
  }
  public getAspActionCache(aspPath: string): Map<string, import('./asp-url-extractor').AspActionUrl> | undefined {
    return this.aspActionCache.get(aspPath);
  }
  public setAspActionCache(aspPath: string, actions: Map<string, import('./asp-url-extractor').AspActionUrl>): void {
    this.aspActionCache.set(aspPath, actions);
  }
  public setCurrentChannel(channel: string): void {
    this.currentChannel = channel;
  }
  public setChatUsers(users: Map<string, import('../shared/types').ChatUser>): void {
    this.chatUsers = users;
  }
  public setAccountMoney(value: string): void {
    this.accountMoney = value;
  }
  public clearBuildingFocus(): void {
    this.currentFocusedBuildingId = null;
    this.currentFocusedCoords = null;
    this.currentFocusedBuildingName = null;
    this.currentFocusedOwnerName = null;
  }

  // -- PushContext implementation -------------------------------------------
  public getWaitingForInitClient(): boolean { return this.waitingForInitClient; }
  public setWaitingForInitClient(value: boolean): void { this.waitingForInitClient = value; }
  public getInitClientResolver(): (() => void) | null { return this.initClientResolver; }
  public setInitClientResolver(value: (() => void) | null): void { this.initClientResolver = value; }
  public setVirtualDate(value: number | null): void { this.virtualDate = value; }
  public setFailureLevel(value: number | null): void { this.failureLevel = value; }
  public setFTycoonProxyId(value: number | null): void { this.fTycoonProxyId = value; }
  public getLastRanking(): number { return this.lastRanking; }
  public setLastRanking(value: number): void { this.lastRanking = value; }
  public getLastBuildingCount(): number { return this.lastBuildingCount; }
  public setLastBuildingCount(value: number): void { this.lastBuildingCount = value; }
  public getLastMaxBuildings(): number { return this.lastMaxBuildings; }
  public setLastMaxBuildings(value: number): void { this.lastMaxBuildings = value; }

  /**
   * Set ServerBusy state from a ModelStatusChanged push (instant, no polling delay).
   * Mirrors Delphi fServerBusy flag update from OnSentinel/ModelStatusChanged event.
   */
  public setServerBusyFromPush(busy: boolean): void {
    const wasBusy = this.isServerBusy;
    this.isServerBusy = busy;
    if (wasBusy && !busy) {
      this.log.debug('[ServerBusy] Server now available (from push) — resuming requests');
      this.processBufferedRequests();
    } else if (!wasBusy && busy) {
      this.log.debug('[ServerBusy] Server now busy (from push) — pausing new requests');
    }
  }

  // -- LoginContext implementation ------------------------------------------
  public getPhase(): SessionPhase { return this.phase; }
  public setPhase(value: SessionPhase): void { this.phase = value; }
  public setWorldContextId(value: string | null): void { this.worldContextId = value; }
  public setInterfaceServerId(value: string | null): void { this.interfaceServerId = value; }
  public setTycoonId(value: string | null): void {
    this.tycoonId = value;
    if (value) {
      this.log = this.log.child({ tycoonId: value });
    }
  }
  public setRdoCnntId(value: string | null): void { this._rdoCnntId = value; }
  public setCacherId(value: string | null): void { this.cacherId = value; }
  public setWorldId(value: string | null): void { this.worldId = value; }
  public setDaPort(value: number | null): void { this.daPort = value; }
  public setDaAddr(value: string | null): void { this.daAddr = value; }
  public setMailAccount(value: string | null): void { this.mailAccount = value; }
  public setMailAddr(value: string | null): void { this.mailAddr = value; }
  public setMailPort(value: number | null): void { this.mailPort = value; }
  public setWorldXSize(value: number | null): void { this.worldXSize = value; }
  public setWorldYSize(value: number | null): void { this.worldYSize = value; }
  public setWorldSeason(value: number | null): void { this.worldSeason = value; }
  public setCurrentWorldInfo(value: WorldInfo | null): void { this.currentWorldInfo = value; }
  public setCachedUsername(value: string | null): void {
    this.cachedUsername = value;
    if (value) {
      this.log = this.log.child({ player: value });
    }
  }
  public setCachedPassword(value: string | null): void { this._cachedPassword = value; }
  public setCachedZonePath(value: string): void { this.cachedZonePath = value; }
  public setActiveUsername(value: string | null): void { this.activeUsername = value; }
  public setCorrelationId(corrId: string | null): void { this.log.setField('corrId', corrId); }
  public setCurrentCompany(value: CompanyInfo | null): void { this.currentCompany = value; }
  public setLastPlayerX(value: number): void { this.lastPlayerX = value; }
  public setLastPlayerY(value: number): void { this.lastPlayerY = value; }
  public getAvailableWorlds(): Map<string, WorldInfo> { return this.availableWorlds; }
  public setAvailableWorlds(worlds: Map<string, WorldInfo>): void { this.availableWorlds = worlds; }
  public getAvailableCompanies(): CompanyInfo[] { return this.availableCompanies; }
  public setAvailableCompanies(companies: CompanyInfo[]): void { this.availableCompanies = companies; }
  public pushAvailableCompany(company: CompanyInfo): void {
    if (!this.availableCompanies.some(c => c.id === company.id)) {
      this.availableCompanies.push(company);
    }
  }
  public setKnownObject(name: string, id: string): void { this.knownObjects.set(name, id); }
  public getInitClientReceived(): Promise<void> | null { return this.initClientReceived; }
  public setInitClientReceived(value: Promise<void> | null): void { this.initClientReceived = value; }
  public deleteSocket(name: string): void { this.sockets.delete(name); }
  public getSocketNames(): string[] { return Array.from(this.sockets.keys()); }
  public removeAllSocketListeners(name: string): void {
    const socket = this.sockets.get(name);
    if (socket) socket.removeAllListeners();
  }
  public destroySocket(name: string): void {
    const socket = this.sockets.get(name);
    if (socket) socket.destroy();
  }
  public deleteFramer(name: string): void { this.framers.delete(name); }
  public clearAspActionCache(): void { this.aspActionCache.clear(); }

  /**
   * Get Directory Agent address for HTTP requests
   */
  public getDAAddr(): string | null {
    return this.daAddr;
  }

  /**
   * Get the Direct Access port the ASP pages are handed.
   *
   * Filled from the InterfaceServer's `DALockPort`, exactly as Voyager fills its own
   * `fDAPort` (`Voyager/URLHandlers/ServerCnxHandler.pas:1046`) — the name follows the
   * `&DAPort=` URL parameter it feeds, not the InterfaceServer property it comes from.
   * Null until the world announces it — there is no usable fallback.
   */
  public getDAPort(): number | null {
    return this.daPort;
  }

  /**
   * Get server virtual date from InitClient
   */
  public getVirtualDate(): number | null {
    return this.virtualDate;
  }

  /**
   * Get account money from InitClient
   */
  public getAccountMoney(): string | null {
    return this.accountMoney;
  }

  /**
   * Get failure level from InitClient
   * 0 = nominal status, >0 = company in debt
   */
  public getFailureLevel(): number | null {
    return this.failureLevel;
  }

  /**
   * Get fTycoonProxyId from InitClient
   * Different from regular TycoonId
   */
  public getFTycoonProxyId(): number | null {
    return this.fTycoonProxyId;
  }

  public getWorldXSize(): number | null {
    return this.worldXSize;
  }

  public getWorldYSize(): number | null {
    return this.worldYSize;
  }

  /**
   * Get world season from InterfaceServer (0=Winter, 1=Spring, 2=Summer, 3=Autumn)
   */
  public getWorldSeason(): number | null {
    return this.worldSeason;
  }

  // -- LOGIN/DIRECTORY (facade -> login-handler) ----------------------------
  public async checkAuth(username: string, password: string): Promise<void> {
    return loginHandler.checkAuth(this, username, password);
  }

  public async connectDirectory(username: string, pass: string, zonePath?: string): Promise<WorldInfo[]> {
    return loginHandler.connectDirectory(this, username, pass, zonePath);
  }

  public getWorldInfo(name: string): WorldInfo | undefined {
    return this.availableWorlds.get(name);
  }

  /**
   * The RDO people search. Active RDO implementation: REQ_SEARCH_MENU_PEOPLE_SEARCH is
   * served by this method (#118).
   */
  public async searchPeople(searchStr: string): Promise<string[]> {
    return loginHandler.searchPeople(this, searchStr);
  }

public async loginWorld(username: string, pass: string, world: WorldInfo): Promise<{
  contextId: string;
  tycoonId: string;
  companies: CompanyInfo[];
  worldXSize: number | null;
  worldYSize: number | null;
  worldSeason: number | null;
}> {
  return loginHandler.loginWorld(this, username, pass, world);
}

public async selectCompany(companyId: string): Promise<void> {
  return loginHandler.selectCompany(this, companyId);
}

public async createCompany(
  companyName: string,
  cluster: string,
): Promise<{ success: boolean; companyName: string; companyId: string; message?: string }> {
  return loginHandler.createCompany(this, companyName, cluster);
}

public async switchCompany(company: CompanyInfo): Promise<void> {
  return loginHandler.switchCompany(this, company);
}

	/**
	 * NEW: Focus on a building at specific coordinates
	 * Sends SwitchFocusEx command with previous building tracking
	 */
	public async focusBuilding(x: number, y: number): Promise<BuildingFocusInfo> {
	  if (!this.worldContextId) {
		throw new Error('Not logged into world');
	  }

	  // Share the in-flight SwitchFocusEx when the same coordinates are
	  // requested concurrently (client sends focus + details in parallel)
	  const requestKey = `${x},${y}`;
	  const pending = this.pendingFocusRequests.get(requestKey);
	  if (pending) {
		this.log.debug(`[Session] Sharing pending focus request for ${requestKey}`);
		return pending;
	  }

	  // Reuse a just-completed focus on the same building: the click's second
	  // handler (details fetch) runs right after the first, not concurrently
	  if (
		this.lastFocusInfo
		&& this.currentFocusedCoords?.x === x
		&& this.currentFocusedCoords?.y === y
		&& Date.now() - this.lastFocusAt < StarpeaceSession.FOCUS_REUSE_TTL_MS
	  ) {
		this.log.debug(`[Session] Reusing fresh focus result for ${requestKey}`);
		return this.lastFocusInfo;
	  }

	  const promise = this.doFocusBuilding(x, y)
		.finally(() => this.pendingFocusRequests.delete(requestKey));
	  this.pendingFocusRequests.set(requestKey, promise);
	  return promise;
	}

	private async doFocusBuilding(x: number, y: number): Promise<BuildingFocusInfo> {
	  this.log.debug(`[Session] Focusing building at (${x}, ${y})`);

	  // Get previous building ID (stored WITHOUT any prefix)
	  const previousBuildingId = this.currentFocusedBuildingId || '0';

	  const packet = await this.sendRdoRequest('world', rdoCall(
	    'SwitchFocusEx', this.worldContextId!,
	    RdoValue.int(parseInt(previousBuildingId, 10)),
	    RdoValue.int(x),
	    RdoValue.int(y),
	  ).packet, undefined, TimeoutCategory.NORMAL);

	  // CRITICAL: Extract the 'res' property first (format is res="%...")
	  const responseData = parsePropertyResponseHelper(packet.payload || '', 'res');

	  const buildingInfo = parseBuildingFocusResponseHelper(responseData, x, y);

	  // Store focus state so refreshBuildingProperties can reuse name/owner
	  this.currentFocusedBuildingId = buildingInfo.buildingId;
	  this.currentFocusedCoords = { x, y };
	  this.currentFocusedBuildingName = buildingInfo.buildingName;
	  this.currentFocusedOwnerName = buildingInfo.ownerName;
	  this.lastFocusInfo = buildingInfo;
	  this.lastFocusAt = Date.now();

	  this.log.debug(`[Session] Focused on building ${buildingInfo.buildingId}: ${buildingInfo.buildingName}`);

	  return buildingInfo;
	}



  /**
   * NEW: Remove focus from current building
   * Notifies server to stop sending RefreshObject push commands
   */
	public async unfocusBuilding(): Promise<void> {
	  if (!this.worldContextId || !this.currentFocusedBuildingId) {
		this.log.debug('[Session] No building focused, skipping unfocus');
		return;
	  }

	  this.log.debug(`[Session] Unfocusing building ${this.currentFocusedBuildingId}`);

	  const socket = this.sockets.get('world');
	  if (socket) {
		const unfocusCmd = rdoCall('UnfocusObject', this.worldContextId!, RdoValue.int(parseInt(this.currentFocusedBuildingId))).toFrame();
		writeRdoFrame(socket, unfocusCmd);
		this.log.debug('[Session] Sent UnfocusObject push command');
	  }

	  // Release inspector temp object (no longer needed after unfocus)
	  this.releaseInspector();

	  // Reset tracking
	  this.currentFocusedBuildingId = null;
	  this.currentFocusedCoords = null;
	  this.currentFocusedBuildingName = null;
	  this.currentFocusedOwnerName = null;
	  this.lastFocusInfo = null;
	  this.lastFocusAt = 0;
	}

  /**
   * Get the object ID at given map coordinates via ObjectAt RDO call.
   */
  private async objectAt(x: number, y: number): Promise<string> {
    if (!this.worldContextId) throw new Error('Not logged into world');

    const packet = await this.sendRdoRequest('world', rdoCall(
      'ObjectAt', this.worldContextId,
      RdoValue.int(x),
      RdoValue.int(y),
    ).packet, undefined, TimeoutCategory.NORMAL);

    const objectId = parsePropertyResponseHelper(packet.payload || '', 'res');
    if (!objectId) throw new Error(`No object found at (${x}, ${y})`);
    return objectId;
  }

  /**
   * Connect two facilities by their map coordinates.
   * Uses ObjectAt to resolve IDs, then ConnectFacilities RDO call.
   * Returns the server's connection result message.
   */
  public async connectFacilitiesByCoords(
    sourceX: number, sourceY: number,
    targetX: number, targetY: number,
  ): Promise<{ success: boolean; resultMessage: string }> {
    if (!this.worldContextId) throw new Error('Not logged into world');

    this.log.debug(`[Session] ConnectFacilities: source=(${sourceX},${sourceY}) target=(${targetX},${targetY})`);

    // Resolve object IDs via ObjectAt
    const sourceObjectId = await this.objectAt(sourceX, sourceY);
    const targetObjectId = await this.objectAt(targetX, targetY);

    this.log.debug(`[Session] ConnectFacilities: sourceId=${sourceObjectId} targetId=${targetObjectId}`);

    // Call ConnectFacilities(sourceId, targetId) on worldContextId
    const packet = await this.sendRdoRequest('world', rdoCall(
      'ConnectFacilities', this.worldContextId,
      RdoValue.int(parseInt(sourceObjectId, 10)),
      RdoValue.int(parseInt(targetObjectId, 10)),
    ).packet, undefined, TimeoutCategory.SLOW);

    const resultMessage = parsePropertyResponseHelper(packet.payload || '', 'res') || '';
    this.log.debug(`[Session] ConnectFacilities result: ${resultMessage}`);

    return { success: true, resultMessage };
  }

  /**
   * Check if a push command is a RefreshObject update.
   * Called from processSingleCommand when detecting push commands.
   */
  public isRefreshObjectPush(packet: RdoPacket): boolean {
    return packet.type === 'PUSH' &&
           packet.member === 'RefreshObject' &&
           packet.separator === '"*"';
  }

  /**
   * Check if a push command is a RefreshArea notification (map visual update).
   * Server format: C sel <tycoonProxy> call RefreshArea "*" "#x","#y","#dx","#dy","%data"
   */
  public isRefreshAreaPush(packet: RdoPacket): boolean {
    return packet.type === 'PUSH' &&
           packet.member === 'RefreshArea' &&
           packet.separator === '"*"';
  }

  /**
   * Parse RefreshArea push payload to extract the affected rectangular area.
   * Args: [x, y, dx, dy, data] where x/y are top-left coords and dx/dy are dimensions.
   */
  public parseRefreshAreaPush(packet: RdoPacket): { x: number; y: number; width: number; height: number } | null {
    try {
      if (!packet.args || packet.args.length < 4) {
        this.log.warn(`[Session] RefreshArea missing args (got ${packet.args?.length ?? 0}, need 4)`);
        return null;
      }

      const x = RdoParser.asInt(packet.args[0]);
      const y = RdoParser.asInt(packet.args[1]);
      const width = RdoParser.asInt(packet.args[2]);
      const height = RdoParser.asInt(packet.args[3]);

      if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
        this.log.warn(`[Session] RefreshArea has non-numeric coords: x=${x}, y=${y}, w=${width}, h=${height}`);
        return null;
      }

      return { x, y, width, height };
    } catch (e: unknown) {
      this.log.warn(`[Session] Failed to parse RefreshArea:`, toErrorMessage(e));
      return null;
    }
  }

  /**
   * Parse RefreshObject push payload.
   * Returns buildingId, kindOfChange, and optionally buildingInfo (only when focused coords available).
   * Format: C sel <proxy> call RefreshObject "*" "#buildingId","#kindOfChange","%extraInfo"
   *   kindOfChange: 0=fchStatus, 1=fchStructure (visual changed), 2=fchDestruction
   */
  public parseRefreshObjectPush(packet: RdoPacket): {
    buildingId: string;
    kindOfChange: number;
    buildingInfo: BuildingFocusInfo | null;
  } | null {
    try {
      if (!packet.args || packet.args.length < 2) {
        this.log.warn(`[Session] RefreshObject missing args`);
        return null;
      }

      // Extract building ID from args[0] — format: "#202334236"
      const buildingId = RdoParser.getValue(packet.args[0]);

      // Extract kindOfChange from args[1] — format: "#0", "#1", or "#2"
      const kindOfChange = RdoParser.asInt(packet.args[1]);

      // Parse building focus info only if we have coords and full data (args[2])
      let buildingInfo: BuildingFocusInfo | null = null;
      if (this.currentFocusedCoords && packet.args.length >= 3) {
        let dataString = packet.args[2];
        dataString = cleanPayloadHelper(dataString);
        if (dataString.startsWith('%')) {
          dataString = dataString.substring(1);
        }
        const fullPayload = buildingId + '\n' + dataString;
        try {
          buildingInfo = parseBuildingFocusResponseHelper(
            fullPayload,
            this.currentFocusedCoords.x,
            this.currentFocusedCoords.y
          );
        } catch {
          this.log.debug(`[Session] Could not parse RefreshObject ExtraInfo for building ${buildingId}`);
        }
      }

      return { buildingId, kindOfChange, buildingInfo };
    } catch (e: unknown) {
      this.log.warn(`[Session] Failed to parse RefreshObject:`, toErrorMessage(e));
      return null;
    }
  }





  // ===========================================================================
  // ASP HTTP HELPERS
  // ===========================================================================

  /**
   * Build common query parameters for IS ASP page requests.
   * All profile ASP pages require these base params to identify the session.
   */
  public buildAspBaseParams(): URLSearchParams {
    return new URLSearchParams({
      Tycoon: this.activeUsername || this.cachedUsername || '',
      Password: this.cachedPassword || '',
      Company: this.currentCompany?.name || '',
      WorldName: this.currentWorldInfo?.name || '',
      ...requireDaParams({ daAddr: this.daAddr, daPort: this.daPort }),
      ISAddr: this.currentWorldInfo?.ip || '',
      ISPort: '8000',
      ClientViewId: String(this.interfaceServerId || '0'),
    });
  }

  /**
   * Build full URL for an IS ASP page.
   * @param aspPath - Relative path under /Five/0/Visual/Voyager/ (e.g., 'NewTycoon/TycoonBankAccount.asp')
   * @param extraParams - Additional query parameters to append
   */
  public buildAspUrl(aspPath: string, extraParams?: Record<string, string>): string {
    const worldIp = this.currentWorldInfo?.ip;
    if (!worldIp) throw new Error('World IP not available');
    const params = this.buildAspBaseParams();
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        params.set(k, v);
      }
    }
    // Use %20 for spaces (not +) to match the original Voyager client behavior.
    // Legacy IIS/Classic ASP may not decode + as space in URL query strings.
    return `http://${worldIp}/Five/0/Visual/Voyager/${aspPath}?${params.toString().replace(/\+/g, '%20')}`;
  }

  /**
   * Fetch an ASP page and return the HTML text.
   */
  public async fetchAspPage(aspPath: string, extraParams?: Record<string, string>): Promise<string> {
    const url = this.buildAspUrl(aspPath, extraParams);
    this.log.debug(`[ASP] Fetching ${aspPath}`);
    const response = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`ASP request failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  public async connectMapService(): Promise<void> {
    if (this.sockets.has('map')) return;
    this.log.debug('[Session] Connecting to Map Service...');
    await this.createSocket('map', this.currentWorldInfo?.ip || '127.0.0.1', RDO_PORTS.MAP_SERVICE);
    const idPacket = await this.sendRdoRequest('map', rdoIdOf('WSObjectCacher').packet, undefined, TimeoutCategory.FAST);
    this.cacherId = parseIdOfResponseHelper(idPacket.payload);
    this.log.debug(`[Session] Map Service Ready. CacherID: ${this.cacherId}`);
    this.startCacherKeepAlive();
  }

  /**
   * NEW [HIGH-03]: Connect to Construction Service (port 7001)
   * This service handles building upgrades, downgrades, and construction operations
   */
  public async connectConstructionService(): Promise<void> {
    if (this.sockets.has('construction')) {
      this.log.debug('[Construction] Already connected');
      return;
    }

    // Use role-based identity when available (e.g., "Mayor of Shamba" after company switch)
    // Falls back to original tycoon username for regular players
    const loginUser = this.activeUsername || this.cachedUsername;
    if (!loginUser || !this.cachedPassword) {
      throw new Error('Credentials not cached - cannot connect to construction service');
    }

    this.log.debug(`[Construction] Connecting to Construction Service (port 7001) as "${loginUser}"...`);
    await this.createSocket(
      'construction',
      this.currentWorldInfo?.ip || '127.0.0.1',
      RDO_PORTS.CONSTRUCTION_SERVICE
    );

    // Resolve World object
    const idPacket = await this.sendRdoRequest('construction', rdoIdOf('World').packet, undefined, TimeoutCategory.FAST);
    this.worldId = parseIdOfResponseHelper(idPacket.payload);
    this.log.debug(`[Construction] World ID: ${this.worldId}`);

    // Logon to World (no request ID - push command with separator "*")
    const socket = this.sockets.get('construction');
    if (socket && this.worldId) {
      const logonCmd = rdoCall('RDOLogonClient', this.worldId, RdoValue.string(loginUser), RdoValue.string(this.cachedPassword!)).toFrame();
      writeRdoFrame(socket, logonCmd);
      this.log.debug(`[Construction] Sent RDOLogonClient as "${loginUser}"`);
      // Small delay to let server process logon
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.log.debug('[Construction] Service Ready');
  }

  // =========================================================================
  // MAIL SERVICE
  // =========================================================================

  /**
   * Connect to the Mail Server via RDO.
   * Uses MailAddr/MailPort obtained from InterfaceServer during login.
   * Reference: MsgComposerHandler.pas:394-401 (Voyager direct RDO connection)
   */
  public async connectMailService(): Promise<void> {
    if (this.sockets.has('mail')) {
      this.log.debug('[Mail] Already connected');
      return;
    }

    if (!this.mailAddr || !this.mailPort) {
      throw new Error('Mail server address/port not available - ensure world login completed');
    }

    this.log.debug(`[Mail] Connecting to Mail Server at ${this.mailAddr}:${this.mailPort}...`);
    await this.createSocket('mail', this.mailAddr, this.mailPort);

    // Resolve MailServer hook
    const idPacket = await this.sendRdoRequest('mail', rdoIdOf('MailServer').packet, undefined, TimeoutCategory.FAST);
    this.mailServerId = parseIdOfResponseHelper(idPacket.payload);
    this.log.debug(`[Mail] Mail Server Ready. ServerId: ${this.mailServerId}`);

    // Register with the mail server to obtain a session ServerId — mirrors the
    // Interface Server handshake (InterfaceServer.pas:4137-4156, LogServerOn).
    // CheckNewMail dereferences this id as a TInterfaceServerData POINTER
    // (MailServer.pas:543); the previous "#0" placeholder AV'd server-side and
    // made the call always return -1.
    try {
      const worldName = this.currentWorldInfo?.name || '';
      const logOnPacket = await this.sendRdoRequest('mail', rdoCall(
        'LogServerOn', this.mailServerId!,
        RdoValue.string(worldName),
      ).packet, undefined, TimeoutCategory.NORMAL);
      const serverId = parsePropertyResponseHelper(logOnPacket.payload!, 'res');
      this.mailIntServerId = serverId && serverId !== '0' ? serverId : null;
      this.log.debug(`[Mail] LogServerOn → mail session id ${this.mailIntServerId}`);
    } catch (e: unknown) {
      this.mailIntServerId = null;
      this.log.warn('[Mail] LogServerOn failed — RDO unread count disabled:', toErrorMessage(e));
    }
  }

  /**
   * Ensure the mail socket is connected, reconnecting if the server closed it.
   * The mail socket is only re-created after a REAL socket loss (the Delphi
   * MailServer has no idle connection timeout — MailConnectionTimeOut=10s is
   * the client-side CONNECT timeout, InterfaceServer.pas:14; message objects
   * expire after 15 min via fMsgTimeOut, MailServer.pas:367).
   */
  public async ensureMailConnection(): Promise<void> {
    if (!this.sockets.has('mail')) {
      this.log.debug('[Mail] Socket was closed — reconnecting...');
      this.mailServerId = null;
      this.mailIntServerId = null;
      await this.connectMailService();
    }
  }
  // -- MAIL (facade -> mail-handler) ----------------------------------------
  public async composeMail(to: string, subject: string, bodyLines: string[], headers?: string, existingDraftId?: string): Promise<boolean> {
    return mailHandler.composeMail(this, to, subject, bodyLines, headers, existingDraftId);
  }

  public async saveDraft(to: string, subject: string, bodyLines: string[], headers?: string, existingDraftId?: string): Promise<boolean> {
    return mailHandler.saveDraft(this, to, subject, bodyLines, headers, existingDraftId);
  }

  public async readMailMessage(folder: string, messageId: string): Promise<MailMessageFull> {
    return mailHandler.readMailMessage(this, folder, messageId);
  }

  public async deleteMailMessage(folder: string, messageId: string): Promise<void> {
    return mailHandler.deleteMailMessage(this, folder, messageId);
  }

  public async getMailUnreadCount(): Promise<number> {
    return mailHandler.getMailUnreadCount(this);
  }

  public async getMailFolder(folder: string): Promise<MailMessageHeader[]> {
    return mailHandler.getMailFolder(this, folder);
  }

  // -- PROFILE/FINANCE (facade -> profile-finance-handler) ------------------
  public async fetchTycoonProfile(): Promise<TycoonProfileFull> {
    return profileFinanceHandler.fetchTycoonProfile(this);
  }

  public async fetchCurriculumData(): Promise<CurriculumData> {
    return profileFinanceHandler.fetchCurriculumData(this);
  }

  public async fetchBankAccount(): Promise<BankAccountData> {
    return profileFinanceHandler.fetchBankAccount(this);
  }

  public async executeBankAction(action: string, amount?: string, toTycoon?: string, reason?: string, loanIndex?: number): Promise<BankActionResult> {
    return profileFinanceHandler.executeBankAction(this, action, amount, toTycoon, reason, loanIndex);
  }

  public async fetchProfitLoss(): Promise<ProfitLossData> {
    return profileFinanceHandler.fetchProfitLoss(this);
  }

  public async fetchCompanyProfitLoss(companyName: string, cluster: string): Promise<ProfitLossData> {
    return profileFinanceHandler.fetchCompanyProfitLoss(this, companyName, cluster);
  }

  public async fetchCompanies(): Promise<CompaniesData> {
    return profileFinanceHandler.fetchCompanies(this);
  }

  // -- AUTO-CONNECTIONS (facade -> auto-connection-handler) -----------------
  public async fetchAutoConnections(): Promise<AutoConnectionsData> {
    return autoConnectionHandler.fetchAutoConnections(this);
  }

  public async executeAutoConnectionAction(action: string, fluidId: string, suppliers?: string): Promise<{ success: boolean; message?: string }> {
    return autoConnectionHandler.executeAutoConnectionAction(this, action, fluidId, suppliers);
  }

  public async fetchPolicy(): Promise<PolicyData> {
    return autoConnectionHandler.fetchPolicy(this);
  }

  public async setPolicyStatus(tycoonName: string, status: number): Promise<{ success: boolean; message?: string }> {
    return autoConnectionHandler.setPolicyStatus(this, tycoonName, status);
  }

  public async executeCurriculumAction(action: string, value?: boolean): Promise<{ success: boolean; message?: string }> {
    return autoConnectionHandler.executeCurriculumAction(this, action, value);
  }

  // -- FAVORITES (facade -> favorites-handler) ------------------------------
  public async fetchOwnedFacilities(): Promise<FavoritesItem[]> {
    return favoritesHandler.fetchOwnedFacilities(this);
  }

  public async addFavorite(name: string, x: number, y: number): Promise<FavoriteMutationResult> {
    return favoritesHandler.addFavorite(this, name, x, y);
  }

  public async deleteFavorite(path: string): Promise<FavoriteMutationResult> {
    return favoritesHandler.deleteFavorite(this, path);
  }

  public async renameFavorite(path: string, name: string): Promise<FavoriteMutationResult> {
    return favoritesHandler.renameFavorite(this, path, name);
  }

  public async createFavoriteFolder(parentPath: string, name: string): Promise<FavoriteMutationResult> {
    return favoritesHandler.createFavoriteFolder(this, parentPath, name);
  }

  public async moveFavorite(itemPath: string, destPath: string): Promise<FavoriteMutationResult> {
    return favoritesHandler.moveFavorite(this, itemPath, destPath);
  }

  // -- POLITICS (facade -> politics-handler) --------------------------------
  public async getPoliticsData(townName: string, buildingX: number, buildingY: number, isCapitol = false): Promise<PoliticsData> {
    return politicsHandler.getPoliticsData(this, townName, buildingX, buildingY, isCapitol);
  }

  public async politicsSetRating(buildingX: number, buildingY: number, ratingId: string, value: number): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsSetRating(this, buildingX, buildingY, ratingId, value);
  }

  public async politicsSetPublicity(buildingX: number, buildingY: number, ratingId: string, value: number): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsSetPublicity(this, buildingX, buildingY, ratingId, value);
  }

  public async politicsSetProjectData(buildingX: number, buildingY: number, projectId: string, data: string): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsSetProjectData(this, buildingX, buildingY, projectId, data);
  }

  // -- NEWSPAPER (facade -> newspaper-handler) ------------------------------
  public async getNewspaperBoard(target: NewspaperTarget, path?: string): Promise<NewspaperBoard> {
    return newspaperHandler.getNewspaperBoard(this, target, path);
  }

  public async postNewspaperColumn(target: NewspaperTarget, subject: string, body: string, replyToPath?: string): Promise<{ success: boolean; message: string; board: NewspaperBoard | null }> {
    return newspaperHandler.postNewspaperColumn(this, target, subject, body, replyToPath);
  }

  public async getNewspaperIssues(target: NewspaperTarget): Promise<NewspaperIssueList> {
    return newspaperHandler.getNewspaperIssues(this, target);
  }

  public async getNewspaperIssue(target: NewspaperTarget, folder: string): Promise<NewspaperIssue> {
    return newspaperHandler.getNewspaperIssue(this, target, folder);
  }

  public async politicsVote(buildingX: number, buildingY: number, candidateName: string): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsVote(this, buildingX, buildingY, candidateName);
  }

  public async politicsLaunchCampaign(buildingX: number, buildingY: number, townName?: string): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsLaunchCampaign(this, buildingX, buildingY, townName);
  }

  public async politicsCancelCampaign(buildingX: number, buildingY: number, townName?: string): Promise<{ success: boolean; message: string }> {
    return politicsHandler.politicsCancelCampaign(this, buildingX, buildingY, townName);
  }

  public async searchConnections(buildingX: number, buildingY: number, fluidId: string, direction: 'input' | 'output', filters?: { company?: string; town?: string; maxResults?: number; roles?: number }): Promise<ConnectionSearchResult[]> {
    return politicsHandler.searchConnections(this, buildingX, buildingY, fluidId, direction, filters);
  }

public async loadMapArea(x?: number, y?: number, w: number = 64, h: number = 64): Promise<MapData> {
    if (!this.worldContextId) throw new Error('Not logged into world');
    const worldCtxId = this.worldContextId; // capture for async closure

    const targetX = x !== undefined ? x : this.lastPlayerX;
    const targetY = y !== undefined ? y : this.lastPlayerY;

    // --- DEDUPLICATION: Share pending promise instead of throwing ---
    const requestKey = `${targetX},${targetY}`;
    const pending = this.pendingMapRequests.get(requestKey);
    if (pending) {
        this.log.debug(`[Session] Sharing pending map request for ${requestKey}`);
        return pending;
    }

    // --- MAP CONCURRENCY LIMIT: Check if at max concurrent map requests ---
    if (this.activeMapRequests >= this.MAX_CONCURRENT_MAP_REQUESTS) {
        this.log.debug(`[Session] Too many concurrent map requests (${this.activeMapRequests}/${this.MAX_CONCURRENT_MAP_REQUESTS})`);
        throw new Error(`Maximum concurrent map requests reached (${this.MAX_CONCURRENT_MAP_REQUESTS})`);
    }

    // Build the promise and store it for dedup sharing
    const promise = (async (): Promise<MapData> => {
      this.activeMapRequests++;
      try {
        this.log.debug(`[Session] Loading map area at ${targetX}, ${targetY} (size ${w}x${h}) [${this.activeMapRequests}/${this.MAX_CONCURRENT_MAP_REQUESTS}]`);

        // ObjectsInArea(x, y, dx, dy: integer) — InterfaceServer.pas
        // Args MUST use RdoValue.int() — autoTypeNumeric is disabled for CALL args
        const objectsRequest: Partial<RdoPacket> = rdoCall(
          'ObjectsInArea', worldCtxId,
          RdoValue.int(targetX),
          RdoValue.int(targetY),
          RdoValue.int(w),
          RdoValue.int(h),
        ).packet;

        // SegmentsInArea(CircuitId, x1, y1, x2, y2: integer) — InterfaceServer.pas
        const modeOrLayer = 1;
        const x1 = targetX;
        const y1 = targetY;
        const x2 = targetX + w;
        const y2 = targetY + h;

        const segmentsRequest: Partial<RdoPacket> = rdoCall(
          'SegmentsInArea', worldCtxId,
          RdoValue.int(modeOrLayer),
          RdoValue.int(x1),
          RdoValue.int(y1),
          RdoValue.int(x2),
          RdoValue.int(y2),
        ).packet;

        // Both are independent read-only queries on the world context. With the
        // flag on they go out concurrently over the world pool (1 RTT instead
        // of 2); the server's own DA-pool design expects parallel connections.
        let objectsPacket: RdoPacket;
        let segmentsPacket: RdoPacket;
        if (config.rdo.parallelAreaReads) {
            [objectsPacket, segmentsPacket] = await Promise.all([
                this.sendRdoRequest('world', objectsRequest, undefined, TimeoutCategory.NORMAL),
                this.sendRdoRequest('world', segmentsRequest, undefined, TimeoutCategory.NORMAL),
            ]);
        } else {
            objectsPacket = await this.sendRdoRequest('world', objectsRequest, undefined, TimeoutCategory.NORMAL);
            segmentsPacket = await this.sendRdoRequest('world', segmentsRequest, undefined, TimeoutCategory.NORMAL);
        }

        // Parse
        const buildingsRaw = splitMultilinePayloadHelper(objectsPacket.payload!);
        const buildings = parseBuildingsHelper(buildingsRaw);

        const segmentsRaw = splitMultilinePayloadHelper(segmentsPacket.payload!);
        const segments = parseSegmentsHelper(segmentsRaw);

        this.log.debug(`[Session] Parsed ${buildings.length} buildings (from ${buildingsRaw.length} lines), ${segments.length} segments (from ${segmentsRaw.length} lines)`);

        return { x: targetX, y: targetY, w, h, buildings, segments };

      } finally {
        // Always remove from pending tracker
        this.pendingMapRequests.delete(requestKey);
        this.activeMapRequests--;
      }
    })();

    this.pendingMapRequests.set(requestKey, promise);
    return promise;
}



	/**
	 * Get the last known player position from cookies
	 */
	public getPlayerPosition(): { x: number, y: number } {
	  return {
		x: this.lastPlayerX,
		y: this.lastPlayerY
	  };
	}

  /**
   * Update the player's camera center position (for save on disconnect).
   * When viewport bounds are provided, also tells the game server via SetViewedArea
   * so it knows which area to send RefreshArea/RefreshObject pushes for.
   */
  public updateCameraPosition(x: number, y: number, viewX?: number, viewY?: number, viewW?: number, viewH?: number): void {
    this.lastPlayerX = x;
    this.lastPlayerY = y;
    if (viewX !== undefined && viewY !== undefined && viewW !== undefined && viewH !== undefined) {
      this.setViewedArea(viewX, viewY, viewW, viewH);
    }
  }

  /**
   * Tell the InterfaceServer what map area the client is viewing.
   * Required for the server to send RefreshArea/RefreshObject pushes —
   * without this, IntersectRect(buildArea, clientViewport) always fails.
   * Delphi signature: TClientView.SetViewedArea(x, y, dx, dy: integer)
   */
  private setViewedArea(x: number, y: number, dx: number, dy: number): void {
    if (!this.worldContextId) return;
    if (dx <= 0 || dy <= 0) return; // Skip degenerate viewports
    const socket = this.sockets.get('world');
    if (!socket) return;
    const cmd = rdoCall('SetViewedArea', this.worldContextId, RdoValue.int(x), RdoValue.int(y), RdoValue.int(dx), RdoValue.int(dy)).toFrame();
    writeRdoFrame(socket, cmd);
  }

  /**
   * Propagate configuration settings from a building to other buildings of the same type.
   * Fire-and-forget call on ClientView (worldContextId) — NOT on CurrBlock.
   * Delphi: TClientView.CloneFacility(x, y, options, useless, tycoonId: integer)
   * Archaeology: ManagementSheet.pas:388-403, ServerCnxHandler.pas:2262
   */
  public cloneFacility(x: number, y: number, options: number): void {
    if (!this.worldContextId) {
      throw new Error('World context not initialized');
    }
    if (!this.tycoonId) {
      throw new Error('Tycoon ID not available');
    }
    const socket = this.sockets.get('world');
    if (!socket) {
      throw new Error('World socket not available');
    }
    const cmd = rdoCall('CloneFacility', this.worldContextId, RdoValue.int(x), RdoValue.int(y), RdoValue.int(options), RdoValue.int(0), RdoValue.int(parseInt(this.tycoonId, 10))).toFrame();
    writeRdoFrame(socket, cmd);
    this.log.debug(`[CloneFacility] Sent: ${cmd}`);
  }

  /**
   * VERIFIED [HIGH-02]: Get property list at specific coordinates
   * Ensures SetObject is called before GetPropertyList with proper delay
   */
  public async getCacherPropertyListAt(x: number, y: number, propertyNames: string[]): Promise<string[]> {
    await this.connectMapService();
    if (!this.cacherId) throw new Error('Map service not initialized (missing cacherId)');
    const tempObjectId = await this.cacherCreateObject();
    try {
      // CRITICAL: SetObject MUST be called to load data into server cache
      await this.cacherSetObject(tempObjectId, x, y);
      // Now safe to retrieve properties
      return await this.cacherGetPropertyList(tempObjectId, propertyNames);
    } finally {
      await this.cacherCloseObject(tempObjectId);
    }
  }

  public async cacherCreateObject(): Promise<string> {
    if (!this.cacherId) throw new Error('Missing cacherId');
    if (!this.currentWorldInfo?.name) throw new Error('Missing world name for CreateObject');
    const packet = await this.sendRdoRequest('map', rdoCall(
      'CreateObject', this.cacherId,
      RdoValue.string(this.currentWorldInfo.name),
    ).packet, undefined, TimeoutCategory.SLOW);
    return cleanPayloadHelper(packet.payload || '');
  }

  /**
   * VERIFIED [HIGH-02]: SetObject with critical delay
   * This method MUST be called before GetPropertyList to populate server cache
   */
  public async cacherSetObject(tempObjectId: string, x: number, y: number): Promise<void> {
    await this.sendRdoRequest('map', rdoCall(
      'SetObject', tempObjectId,
      RdoValue.int(x),
      RdoValue.int(y),
    ).packet, undefined, TimeoutCategory.SLOW);
    // Brief delay for server to populate cache (reduced from 100ms)
    await new Promise(resolve => setTimeout(resolve, 30));
  }

  public async cacherSetPath(tempObjectId: string, path: string): Promise<void> {
    await this.sendRdoRequest('map', rdoCall(
      'SetPath', tempObjectId,
      RdoValue.string(path),
    ).packet, undefined, TimeoutCategory.SLOW);
    // No delay needed — Delphi SetPath is synchronous (loads file inline before responding)
  }

  public async cacherGetPropertyList(tempObjectId: string, propertyNames: string[]): Promise<string[]> {
    const query = propertyNames.join('\t') + '\t';
    const packet = await this.sendRdoRequest('map', rdoCall(
      'GetPropertyList', tempObjectId,
      RdoValue.string(query),
    ).packet, undefined, TimeoutCategory.NORMAL);
    // Extract tab-delimited values WITHOUT trimming — cleanPayload's .trim()
    // strips leading/trailing tabs, destroying empty values at the boundaries.
    // The Delphi cache server always returns one value per requested property
    // (empty string for unknown properties), so positional alignment is critical.
    const rawPayload = packet.payload || '';
    let raw: string;
    const resMatch = rawPayload.match(/^res="((?:[^"]|"")*)"$/);
    if (resMatch) {
      raw = resMatch[1].replace(/""/g, '"');
      // Strip OLE string type prefix (%) but NOT whitespace/tabs
      if (raw.length > 0 && ['#', '%', '@', '$', '^', '!', '*'].includes(raw[0])) {
        raw = raw.substring(1);
      }
    } else {
      raw = cleanPayloadHelper(rawPayload);
    }

    // Tab-split: the Delphi server appends TAB after each value, so we get
    // N values + 1 trailing empty from the final tab. Trim individual values
    // (spaces only, not tabs) but preserve empty strings for missing properties.
    const values = raw.split('\t').map(v => v.trim());
    // Remove trailing empty element from the final TAB delimiter
    if (values.length > 0 && values[values.length - 1] === '') {
      values.pop();
    }
    if (values.length < propertyNames.length) {
      this.log.warn(
        `[cacherGetPropertyList] Response has ${values.length} values for ${propertyNames.length} requested properties`
      );
      this.log.warn(`[cacherGetPropertyList] Requested: ${propertyNames.join(', ')}`);
      this.log.warn(`[cacherGetPropertyList] Received: ${values.map((v, i) => `[${i}]="${v}"`).join(', ')}`);
    }
    return values;
  }

  public cacherCloseObject(tempObjectId: string): void {
    if (!this.cacherId) return;
    const socket = this.sockets.get('map');
    if (!socket) return;
    // CloseObject is a Delphi procedure (void) — fire-and-forget, no QueryId.
    // Delphi: procedure CloseObject(Obj: integer)
    try {
      const cmd = rdoCall('CloseObject', this.cacherId, RdoValue.int(parseInt(tempObjectId, 10))).toFrame();
      writeRdoFrame(socket, cmd);
    } catch (e: unknown) {
      this.log.warn('[cacherCloseObject] Failed:', toErrorMessage(e));
    }
  }


  // -- BUILDING MANAGEMENT (facade -> building-management-handler) ----------
  public async queryTycoonPoliticalRole(tycoonName: string): Promise<PoliticalRoleInfo> {
    return buildingManagementHandler.queryTycoonPoliticalRole(this, tycoonName);
  }

  public async manageConstruction(x: number, y: number, action: 'START' | 'STOP' | 'DOWN', count?: number): Promise<{ status: string; error?: string }> {
    return buildingManagementHandler.manageConstruction(this, x, y, action, count);
  }

  public async upgradeBuildingAction(x: number, y: number, action: 'DOWNGRADE' | 'START_UPGRADE' | 'STOP_UPGRADE', count?: number): Promise<{ success: boolean, message?: string }> {
    return buildingManagementHandler.upgradeBuildingAction(this, x, y, action, count);
  }

  public async renameFacility(x: number, y: number, newName: string): Promise<{ success: boolean, message?: string }> {
    return buildingManagementHandler.renameFacility(this, x, y, newName);
  }

  public async deleteFacility(x: number, y: number): Promise<{ success: boolean, message?: string }> {
    return buildingManagementHandler.deleteFacility(this, x, y);
  }

  // -- ROADS (facade -> road-handler) ---------------------------------------
  public async buildRoad(x1: number, y1: number, x2: number, y2: number, facts?: readonly RoadTileFacts[]): Promise<{ success: boolean; cost: number; tileCount: number; message?: string; errorCode?: number; partial?: boolean }> {
    return roadHandler.buildRoad(this, x1, y1, x2, y2, facts);
  }

  public getRoadCostEstimate(x1: number, y1: number, x2: number, y2: number, facts?: readonly RoadTileFacts[]): { cost: number; tileCount: number; costPerTile: number; valid: boolean; error?: string } {
    return roadHandler.getRoadCostEstimate(x1, y1, x2, y2, facts);
  }

  public async demolishRoad(x: number, y: number): Promise<{ success: boolean; message?: string; errorCode?: number }> {
    return roadHandler.demolishRoad(this, x, y);
  }

  public async wipeCircuit(x1: number, y1: number, x2: number, y2: number): Promise<{ success: boolean; message?: string; errorCode?: number }> {
    return roadHandler.wipeCircuit(this, x1, y1, x2, y2);
  }

  /**
   * Generic escape hatch for internal callers: the packet is caller-supplied, so
   * no member-specific category can be inferred. NORMAL is the legacy in-play
   * deadline and the right default here.
   *
   * No longer reachable from the browser — the REQ_RDO_DIRECT passthrough that
   * used to expose it was removed on 2026-08-19.
   */
  public async executeRdo(serviceName: string, packetData: Partial<RdoPacket>, category: TimeoutCategory = TimeoutCategory.NORMAL): Promise<string> {
    if (!this.sockets.has(serviceName)) {
      throw new Error(`Service ${serviceName} not connected`);
    }

    const res = await this.sendRdoRequest(serviceName, packetData, undefined, category);
    return res.payload || '';
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

/**
 * Inject the socket factory used for every socket this session opens.
 * Test seam only — see {@link socketFactory}. Must be called before any
 * connection is made.
 */
public setSocketFactory(factory: (purpose: string) => net.Socket): void {
  this.socketFactory = factory;
}

/** Override whether this session may populate its world pool (test seam). */
public setWorldPoolEnabled(enabled: boolean): void {
  this.worldPoolEnabled = enabled;
}

public createSocket(name: string, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = this.socketFactory(name);
    // Disable Nagle: RDO frames are small request/response messages. With
    // Nagle on, a second frame written before the first is ACKed sits in the
    // kernel buffer for a full RTT (~100ms to the live servers) — measured
    // live 2026-07-03 (SegmentsInArea RTT doubled when sent concurrently).
    // Transport-only change: frame bytes are identical.
    socket.setNoDelay(true);
    const framer = new RdoFramer();
    // Socket stored ONLY after connect succeeds (prevents writes to unconnected socket)
    let connected = false;

    socket.connect(port, host, () => {
      connected = true;
      this.sockets.set(name, socket);
      this.framers.set(name, framer);
      tagRdoSocket(socket, name);
      this.log.debug(`[Session] Connected to ${name} (${host}:${port})`);
      resolve(socket);
    });

    socket.on('data', (chunk) => {
      const messages = framer.ingest(chunk);
      for (const msg of messages) {
        // A throw from one frame's handler must not kill the remaining frames,
        // the socket, or (via uncaughtException → shutdown) the whole gateway.
        try {
          this.processSingleCommand(name, msg);
        } catch (err: unknown) {
          this.log.error(`[Session] Error processing RDO frame on ${name}: ${toErrorMessage(err)}. Frame: ${msg.slice(0, 200)}`);
        }
      }
    });

    socket.on('error', (err) => {
      this.log.error(`[Session] Socket error on ${name}:`, err);
      // If not yet connected, reject the creation promise
      if (!connected) reject(err);
    });

    socket.on('close', () => {
      this.log.debug(`[Session] Socket closed: ${name}`);
      // Remove listeners to prevent stale message processing from delayed packets
      socket.removeAllListeners();
      this.sockets.delete(name);
      this.framers.delete(name);

      // Auto-reconnect world socket (Delphi RenewWorldProxy pattern)
      // Skipped after a graceful Logoff — the close is intentional (legacy parity:
      // the Voyager client clears OnDisconnect before logging off, ServerCnxHandler.pas:2052)
      if (name === 'world' && this.phase === SessionPhase.WORLD_CONNECTED && !this.isClosing && !this.loggedOff) {
        this.log.warn('[Session] World socket lost, attempting auto-reconnect...');
        this.attemptWorldReconnect().catch(err => {
          this.log.error('[Session] World auto-reconnect failed:', toErrorMessage(err));
        });
      }

      // Auto-reconnect cacher/map socket (mirrors Delphi OnDSDisconnect pattern)
      if (name === 'map' && this.phase === SessionPhase.WORLD_CONNECTED && !this.isClosing) {
        this.log.warn('[Session] Map/cacher socket lost — will reconnect on next map request');
        this.stopCacherKeepAlive();
      }
    });
  });
}

/**
   * Initialize the world connection pool after primary world socket is connected.
   * The primary socket (from createSocket('world', ...)) is the seed;
   * additional connections are created on-demand by the pool.
   */
  public initWorldPool(host: string, port: number): void {
    // Close existing pool if any (e.g., after reconnect)
    if (this.worldPool) {
      this.worldPool.close();
    }

    this.worldPool = new RdoConnectionPool(
      {
        host,
        port,
        maxSize: StarpeaceSession.WORLD_POOL_SIZE,
        socketFactory: () => this.socketFactory(`pool:${host}:${port}`),
      },
      {
        onData: (conn, chunk) => {
          const messages = conn.framer.ingest(chunk);
          for (const msg of messages) {
            try {
              this.processSingleCommand('world', msg, conn.socket);
            } catch (err: unknown) {
              this.log.error(`[Pool] Error processing RDO frame: ${toErrorMessage(err)}. Frame: ${msg.slice(0, 200)}`);
            }
          }
        },
        onClose: (conn) => {
          this.log.debug('[Pool] World pool connection closed');
          // If ALL pool connections are gone and primary socket too, trigger reconnect
          if (this.worldPool && this.worldPool.size === 0
              && this.phase === SessionPhase.WORLD_CONNECTED && !this.isClosing) {
            this.log.warn('[Pool] All world pool connections lost, triggering reconnect');
            this.attemptWorldReconnect().catch(err => {
              this.log.error('[Pool] World reconnect failed:', toErrorMessage(err));
            });
          }
        },
      },
      this.log,
    );

    // O-M1: constructing the pool is not populating it. `initialize()` was
    // called nowhere in production, and `getConnection()` — the only other place
    // that adds a connection — sits behind a `worldPool.size > 0` guard. Chicken
    // and egg: the pool could never hold a single connection, every world frame
    // went down the primary socket, and `config.rdo.parallelAreaReads` pipelined
    // onto one wire. The log line below claimed otherwise for months.
    //
    // Populating is now a SEPARATE step — see populateWorldPool(). It must not
    // happen here: initWorldPool() runs before the login sequence, and a pool
    // populated at that moment captures the session-establishing frames.
    this.log.debug('[Pool] World pool constructed (empty) — populated after the session is bound');
  }

  /**
   * Populate the world pool. Called ONLY once the session is bound to the
   * primary socket, i.e. after `RegisterEventsById`.
   *
   * Ordering is a correctness requirement, not a preference. `get RDOCnntId` is
   * answered by the query parser with the id of the connection carrying the
   * frame (`RDOQueryServer.pas:269-274`), and that id is handed to
   * `RegisterEventsById`, which binds the server-side `TClientView` to that
   * connection as both push channel and teardown trigger
   * (`InterfaceServer.pas:1919-1923`). Populate before login and the pool can
   * carry those frames, binding the session to a socket the pool owns and may
   * destroy on degradation — the O-H1/O-H2 zombie session, re-entered from a new
   * direction. {@link isConnectionBoundMember} keeps that specific read on the
   * primary socket even if this ordering is ever broken again.
   *
   * Populated only after O-L1 was fixed: until then, a server request arriving
   * on a pool connection would have been answered on the primary socket, and
   * Delphi's pending query — which lives on the connection object — would have
   * waited out its full timeout.
   */
  public populateWorldPool(): void {
    if (!this.worldPool) return;

    if (!this.worldPoolEnabled) {
      this.log.info('[Pool] World pool left empty (RDO_WORLD_POOL is off) — all world traffic uses the primary socket');
      return;
    }

    this.worldPool.initialize()
      .then(() => {
        this.log.info(`[Pool] World connection pool ready (max ${StarpeaceSession.WORLD_POOL_SIZE} connections)`);
      })
      .catch((err: unknown) => {
        // Non-fatal by design: the primary socket carries everything on its own,
        // which is exactly what happened for the pool's entire dormant life.
        this.log.warn(`[Pool] World pool could not be populated, falling back to the primary socket: ${toErrorMessage(err)}`);
      });
  }

  /** Get the world connection pool (null if not yet initialized). */
  public getWorldPool(): RdoConnectionPool | null {
    return this.worldPool;
  }

/**
   * Attempt world socket reconnection with backoff and dedup.
   * Triggered EXCLUSIVELY by the socket 'close' event (legacy parity: Delphi's
   * ReportCnxFailure is a no-op — never reconnect on query timeouts/errors).
   * - Two bounded phases: 3 fast attempts (5/10/20 s) + 20 slow (15 s) = 23 total
   *   over ~5.5 min, then give up (gentler than Delphi's infinite 100 ms loop)
   * - ±25% jitter on every delay to desynchronize clients after a shared outage
   * - Promise dedup so concurrent callers share one attempt
   */
  public async attemptWorldReconnect(): Promise<void> {
    // Guard: only reconnect from WORLD_CONNECTED or RECONNECTING (dedup)
    if (this.phase !== SessionPhase.WORLD_CONNECTED && this.phase !== SessionPhase.RECONNECTING) return;
    if (this.isClosing) return;

    // Dedup: share pending reconnection promise
    if (this.worldReconnecting) return this.worldReconnecting;

    // Max retries: give up after 23 bounded attempts (3 fast + 20 slow) → notify client
    if (this.worldReconnectAttempts >= StarpeaceSession.RECONNECT_MAX_RETRIES) {
      this.log.error('[Reconnect] Max retries exhausted, giving up');
      this.emit('worldDisconnected');
      return;
    }

    // Two-phase backoff (mirrors Delphi TReconnectThread persistence):
    //   Fast phase: exponential 5s, 10s, 20s
    //   Slow phase: fixed 15s interval for extended recovery
    const inSlowPhase = this.worldReconnectAttempts >= StarpeaceSession.RECONNECT_FAST_RETRIES;
    const baseBackoffMs = inSlowPhase
      ? StarpeaceSession.RECONNECT_SLOW_INTERVAL_MS
      : StarpeaceSession.RECONNECT_BASE_BACKOFF_MS * Math.pow(2, this.worldReconnectAttempts);
    // ±25% jitter (audit V5): fixed delays synchronize every client into a
    // thundering herd against the IS fServerLock after a shared server outage.
    const backoffMs = Math.round(baseBackoffMs * (0.75 + Math.random() * 0.5));
    const elapsed = Date.now() - this.worldReconnectLastAttempt;
    if (this.worldReconnectLastAttempt > 0 && elapsed < backoffMs) {
      throw new Error(`World reconnect throttled (${elapsed}ms < ${backoffMs}ms)`);
    }

    this.worldReconnecting = (async () => {
      this.worldReconnectLastAttempt = Date.now();
      this.worldReconnectAttempts++;
      this.rdoMetrics.totalReconnectAttempts++;

      // 1. Set phase → RECONNECTING (prevents new requests from executing)
      this.phase = SessionPhase.RECONNECTING;

      // 2. Stop ServerBusy polling (avoid queries on half-ready socket)
      this.stopServerBusyPolling();

      // 2b. Drain world connection pool (destroy all pooled sockets)
      if (this.worldPool) {
        this.worldPool.drainAll();
        this.worldPool = null;
      }

      // 3. Drain all pending requests (prevent ghost RID collisions — CRITICAL)
      for (const [rid, entry] of this.pendingRequests.entries()) {
        if (entry.state === 'pending') {
          clearTimeout(entry.timeoutHandle);
          entry.reject(new Error('World socket reconnecting'));
        }
        this.pendingRequests.delete(rid);
      }

      // 4. Reject buffered requests targeting 'world'
      this.requestBuffer = this.requestBuffer.filter(buf => {
        if (buf.socketName === 'world') {
          buf.reject(new Error('World socket reconnecting'));
          return false;
        }
        return true;
      });

      try {
        await loginHandler.reconnectWorldSocket(this);

        // 5. Clear stale caches (interfaceServerId may have changed)
        this.knownObjects.clear();
        this.aspActionCache.clear();

        // 6. Restart ServerBusy polling
        this.startServerBusyPolling();

        // 7. Reset phase + counters
        this.phase = SessionPhase.WORLD_CONNECTED;
        this.worldReconnectAttempts = 0;
        this.rdoMetrics.totalReconnectSuccesses++;
        this.rdoMetrics.lastReconnectAt = Date.now();

        // 8. Notify client
        this.emit('worldReconnected');
        this.log.info('[Reconnect] World socket reconnected successfully');

        // 9. Flush buffered requests (orderly, not burst)
        this.processBufferedRequests().catch(err => {
          this.log.error('[Reconnect] Error flushing buffered requests:', err);
        });

      } catch (err: unknown) {
        this.log.error('[Reconnect] Failed:', toErrorMessage(err));
        this.rdoMetrics.totalReconnectFailures++;

        // Clean up partially created socket
        const partialSocket = this.sockets.get('world');
        if (partialSocket) {
          partialSocket.removeAllListeners();
          partialSocket.destroy();
          this.sockets.delete('world');
          this.framers.delete('world');
        }

        throw err;
      } finally {
        this.worldReconnecting = null;
      }
    })();

    return this.worldReconnecting;
  }

/**
   * Start ServerBusy polling — legacy cadence (~50s, ToolbarHandlerViewer.pas:160-162)
   * with the legacy 180s blocking-read deadline. When the server is busy, new
   * requests are buffered. The ModelStatusChanged push (setServerBusyFromPush)
   * remains the primary/instant busy signal; this poll is the fallback.
   */
  /**
   * Allocate a QueryId that is not already in flight.
   *
   * O-L6: `requestIdCounter % 65536` alone could hand out an id that
   * `pendingRequests` still holds. `set` would then overwrite the live entry —
   * its promise never settling, and its timer later flipping the NEW entry to
   * 'timed-out'. It takes ~65k requests inside the 180 s window plus grace, so
   * it is debt rather than a live defect; the guard costs three lines.
   *
   * Shared by every path that allocates an id, including the ServerBusy poll,
   * which reimplements the rest of `sendRdoRequest` (O-L5).
   */
  private allocateRequestId(): number {
    let rid = this.requestIdCounter++ % 65536;
    for (let probes = 0; this.pendingRequests.has(rid) && probes < 65536; probes++) {
      rid = this.requestIdCounter++ % 65536;
    }
    return rid;
  }

  public startServerBusyPolling(): void {
    if (this.serverBusyCheckInterval) return; // Already running

    this.log.debug(`[ServerBusy] Starting ${this.SERVER_BUSY_CHECK_INTERVAL_MS / 1000}-second polling...`);

    this.serverBusyCheckInterval = setInterval(async () => {
      if (!this.worldContextId || this.phase === SessionPhase.WORLD_CONNECTING || this.phase === SessionPhase.RECONNECTING || this.isClosing) {
        return; // Skip during login, reconnection, or teardown
      }
      if (this.isPolling) return; // Previous poll still in-flight
      this.isPolling = true;

      try {
        // O-L5 CLOSED: this used to hand-roll rid allocation, frame write,
        // pendingRequests entry and timer — a second implementation of
        // sendRdoRequest that drifted from the real one (no assertNotVoidPush,
        // no errorCode contract, no metrics, logged `RDO>*` instead of `RDO>>`).
        //
        // It duplicated the primitive for exactly two reasons, now both
        // expressed as options: it must send while `isServerBusy` (it is the
        // call that clears the flag), and it must stay on the primary socket.
        // The legacy deadline is unchanged: the ServerBusy read is a blocking
        // property GET under ISProxyTimeOut = 180 s
        // (ServerCnxHandler.pas:3596-3611) — a busy-but-alive server must not be
        // counted as failed after 1 s.
        const response = await this.sendRdoRequest(
          'world',
          rdoGet('ServerBusy', this.worldContextId).packet,
          IS_PROXY_TIMEOUT_MS,
          TimeoutCategory.NORMAL,
          { bypassBusyGate: true, forcePrimarySocket: true },
        );

        this.consecutivePollFailures = 0;
        const busyValue = parsePropertyResponseHelper(response.payload!, 'ServerBusy');
        const wasBusy = this.isServerBusy;
        // Wordbool true arrives as "#-1" on the wire: any non-zero
        // ordinal means busy (audit V1 — "== '1'" misread the canonical "#-1").
        this.isServerBusy = isTrueOrdinal(busyValue);

        if (wasBusy && !this.isServerBusy) {
          this.log.debug('[ServerBusy] Server now available - resuming requests');
          this.processBufferedRequests();
        } else if (!wasBusy && this.isServerBusy) {
          this.log.debug('[ServerBusy] Server now busy - pausing new requests');
        }
      } catch (e: unknown) {
        this.consecutivePollFailures++;
        this.rdoMetrics.totalServerBusyPollFailures++;
        this.log.warn(
          `[ServerBusy] Poll failed (${this.consecutivePollFailures}/${StarpeaceSession.MAX_CONSECUTIVE_POLL_FAILURES}):`,
          toErrorMessage(e)
        );

        if (this.consecutivePollFailures >= StarpeaceSession.MAX_CONSECUTIVE_POLL_FAILURES) {
          // LEGACY PARITY: after 4 consecutive failures the Voyager client simply
          // STOPS polling (fExceptCount gate, ServerCnxHandler.pas:3596-3611) —
          // it never reconnects from here. Busy state still updates instantly via
          // the ModelStatusChanged push (setServerBusyFromPush). Polling restarts
          // on the next successful (re)connect (startServerBusyPolling).
          this.log.error(
            `[ServerBusy] ${this.consecutivePollFailures} consecutive poll failures — stopping ServerBusy polling (push channel remains active)`
          );
          this.stopServerBusyPolling();
        }
      } finally {
        this.isPolling = false;
      }
    }, this.SERVER_BUSY_CHECK_INTERVAL_MS);
  }

  /**
   * NEW: Stop ServerBusy polling
   */
  private stopServerBusyPolling(): void {
    if (this.serverBusyCheckInterval) {
      clearInterval(this.serverBusyCheckInterval);
      this.serverBusyCheckInterval = null;
    }
    this.consecutivePollFailures = 0;
  }

  /**
   * Start KeepAlive timer for the ACTIVE inspector temp object.
   *
   * Delphi ground truth: KeepAlive is published on TCachedObjectWrap (the temp
   * object, CachedObjectWrap.pas:36) — the TCacheServer root the WebClient
   * resolves as 'WSObjectCacher' publishes NO KeepAlive (CacheServerReportForm.pas:100-118),
   * so targeting cacherId (the previous behavior) produced errUnexistentMethod
   * noise every 60s. The legacy client keep-alives the open inspector object
   * (fCacheObj.KeepAlive, ObjectInspectorHandleViewer.pas:1172-1180); temp
   * objects expire after 1 minute without it (TCacheServer.CheckObject, fMaxTTL).
   *
   * Uses writeRdoFrame() directly (void push with "*" separator, no QueryId)
   * — matches the legacy client's fire-and-forget KeepAlive. sendRdoRequest()
   * is forbidden here by project convention (assertNotVoidPush, one form per
   * intent) — wire-legal but the server would just ack `A<id> ;`.
   */
  private startCacherKeepAlive(): void {
    if (this.keepAliveInterval) return;
    if (!this.cacherId) {
      this.log.warn('[KeepAlive] Cannot start: no cacherId');
      return;
    }

    this.log.debug('[KeepAlive] Starting 60s timer (targets the active inspector temp object)');
    this.keepAliveInterval = setInterval(() => {
      const socket = this.sockets.get('map');
      if (!socket || !this.cacherId) {
        this.log.debug('[KeepAlive] Map socket or cacherId gone — stopping');
        this.stopCacherKeepAlive();
        return;
      }
      // No open inspector → no temp object to keep alive → no traffic (legacy parity)
      const tempObjectId = buildingDetailsHandler.getActiveInspectorTempObjectId(this);
      if (!tempObjectId) return;
      try {
        const cmd = rdoCall('KeepAlive', tempObjectId).toFrame();
        writeRdoFrame(socket, cmd);
        this.log.debug(`[KeepAlive] Sent to inspector temp object ${tempObjectId}`);
      } catch (e: unknown) {
        this.log.warn('[KeepAlive] Failed:', toErrorMessage(e));
      }
    }, this.KEEP_ALIVE_INTERVAL_MS);
  }

  /**
   * Stop the KeepAlive timer for the Map Service cacher.
   */
  public stopCacherKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      this.log.debug('[KeepAlive] Timer stopped');
    }
  }

  /**
   * Process buffered requests when server becomes available.
   * Preserves the timeout category from when the request was originally buffered.
   */
  private async processBufferedRequests(): Promise<void> {
    while (this.requestBuffer.length > 0 && !this.isServerBusy && !this.isClosing) {
      const request = this.requestBuffer.shift();
      if (!request) break;

      // Execute with retry for GET operations (mutations skip retry via guard in executeWithRetry)
      this.executeWithRetry(request.socketName, request.packetData, request.effectiveTimeout)
        .then(request.resolve)
        .catch(request.reject);

      // Small delay between requests to avoid flooding
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  // ── GC Sweep for timed-out entries ──────────────────────────────────────

  /**
   * Start periodic GC sweep that removes timed-out entries older than the grace period.
   * Called when the first world socket connects.
   */
  public startGcSweep(): void {
    if (this.gcSweepInterval) return;
    this.gcSweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [rid, entry] of this.pendingRequests.entries()) {
        if (entry.state === 'timed-out' && (now - entry.sentAt) > this.LATE_RESPONSE_GRACE_MS) {
          this.pendingRequests.delete(rid);
          this.rdoMetrics.totalOrphaned++;
        }
      }
    }, this.GC_SWEEP_INTERVAL_MS);
  }

  private stopGcSweep(): void {
    if (this.gcSweepInterval) {
      clearInterval(this.gcSweepInterval);
      this.gcSweepInterval = null;
    }
  }

  // ── Queue Status & Metrics ──────────────────────────────────────────────

  public getQueueStatus(): {
    buffered: number;
    maxBuffer: number;
    serverBusy: boolean;
    pendingMaps: number;
    activeMapRequests: number;
    pendingRdoRequests: number;
    timedOutAwaitingLate: number;
    consecutivePollFailures: number;
    rdoMetrics: RdoMetrics;
    maintenanceMode: boolean;
    worldPoolSize: number;
    worldPoolMax: number;
  } {
    let timedOutCount = 0;
    for (const entry of this.pendingRequests.values()) {
      if (entry.state === 'timed-out') timedOutCount++;
    }
    return {
      buffered: this.requestBuffer.length,
      maxBuffer: this.MAX_BUFFER_SIZE,
      serverBusy: this.isServerBusy,
      pendingMaps: this.pendingMapRequests.size,
      activeMapRequests: this.activeMapRequests,
      pendingRdoRequests: this.pendingRequests.size,
      timedOutAwaitingLate: timedOutCount,
      consecutivePollFailures: this.consecutivePollFailures,
      rdoMetrics: { ...this.rdoMetrics },
      maintenanceMode: this.maintenanceMode,
      worldPoolSize: this.worldPool?.size ?? 0,
      worldPoolMax: StarpeaceSession.WORLD_POOL_SIZE,
    };
  }

  /**
   * Check for maintenance mode based on consecutive model server down errors.
   * Called when ERROR_ModelServerIsDown (code 20) is detected in a response.
   *
   * DIVERGENCE FROM DELPHI: Delphi's fMSDownCount increments on Cnx.Connect()
   * success (tracking recovery attempts), and the check `fMSDownCount > MaxDownCountAllowed`
   * is COMMENTED OUT in the current Delphi source. Our approach increments on errorCode=20
   * in responses, which is more defensive — we detect maintenance from error responses
   * rather than connection attempts. Threshold (3) matches Delphi's MaxDownCountAllowed.
   */
  private checkMaintenanceMode(errorCode: number): void {
    if (errorCode === 20) { // ERROR_ModelServerIsDown
      this.modelServerDownCount++;
      if (this.modelServerDownCount >= StarpeaceSession.MAX_DOWN_COUNT_ALLOWED && !this.maintenanceMode) {
        this.maintenanceMode = true;
        this.log.error(`[Maintenance] Model Server down ${this.modelServerDownCount} times — entering maintenance mode`);
        this.emit('ws_event', {
          type: WsMessageType.EVENT_MAINTENANCE,
          active: true,
          message: 'Game server appears to be in maintenance. Reconnection will continue automatically.',
        });
      }
    } else if (this.maintenanceMode && errorCode === 0) {
      // Server responded successfully — maintenance ended
      this.maintenanceMode = false;
      this.modelServerDownCount = 0;
      this.log.info('[Maintenance] Server recovered — exiting maintenance mode');
      this.emit('ws_event', {
        type: WsMessageType.EVENT_MAINTENANCE,
        active: false,
        message: 'Server is back online.',
      });
    }
  }

/**
 * Send RDO request with buffering when server is busy.
 * Supports TimeoutCategory for aligned timeout management across layers.
 */
public sendRdoRequest(
  socketName: string,
  packetData: Partial<RdoPacket>,
  timeoutMs: number | undefined,
  // O-L3: REQUIRED, not defaulted. src/server/CLAUDE.md has always demanded an
  // explicit category; 81 of 93 call sites ignored it, and a silent default is
  // exactly why nobody noticed. Read what the categories do before picking one:
  // NORMAL/SLOW/VERY_SLOW all carry the legacy in-play deadline (180 s,
  // ISProxyTimeOut) and differ only in what the call site declares about itself.
  // FAST (60 s, legacy DefTimeOut) is for pre-login and directory reads ONLY —
  // expiring earlier than the reference client is a conformity divergence.
  category: TimeoutCategory,
  options?: RdoRequestOptions,
): Promise<RdoPacket> {
  const effectiveTimeout = timeoutMs ?? TIMEOUT_CONFIG[category].rdoMs;
  return new Promise((resolve, reject) => {
    if (this.isClosing) {
      return reject(new Error('Session is closing'));
    }

    // If server is busy, buffer the request — unless this IS the request that
    // decides whether the server is still busy (O-L5). Buffering that one is a
    // deadlock: nothing else can clear the flag except a ModelStatusChanged push.
    if (this.isServerBusy && !options?.bypassBusyGate) {
      if (!canBufferRequest(this.requestBuffer.length, this.MAX_BUFFER_SIZE)) {
        // Buffer is full, drop the request
        this.log.warn('[Buffer] Buffer full, dropping request:', packetData.member);
        reject(new Error('Request buffer full - server busy'));
        return;
      }

      // O-M3: arm the deadline HERE, not when the request is finally sent.
      //
      // A buffered request used to carry no timer at all. If the ServerBusy poll
      // stops after 4 consecutive failures (`MAX_CONSECUTIVE_POLL_FAILURES`,
      // legacy parity) and no `ModelStatusChanged` push arrives, nothing can
      // ever clear `isServerBusy` — so up to 20 promises never settle and every
      // later request is rejected as "buffer full". The caller has no timeout to
      // fall back on: this buffer is our invention, the legacy client blocks on
      // SendReceive under ISProxyTimeOut instead.
      //
      // The deadline covers the wait, not just the round-trip. A request that
      // spent its whole budget queued has already failed from the caller's point
      // of view, whatever the server would have answered.
      const bufferedAt = Date.now();
      let bufferTimer: NodeJS.Timeout;

      const entry = {
        socketName,
        packetData,
        effectiveTimeout,
        resolve: (packet: RdoPacket) => { clearTimeout(bufferTimer); resolve(packet); },
        reject: (err: unknown) => { clearTimeout(bufferTimer); reject(err); },
      };

      bufferTimer = setTimeout(() => {
        const index = this.requestBuffer.indexOf(entry);
        if (index === -1) return; // already dispatched — the request owns its own timer now
        this.requestBuffer.splice(index, 1);
        this.log.warn(
          `[Buffer] ${packetData.member ?? 'request'} expired after ${Date.now() - bufferedAt}ms ` +
          `waiting for the server to stop being busy (never dispatched)`
        );
        reject(new Error(`Request timeout while server busy: ${packetData.member ?? 'unknown'}`));
      }, effectiveTimeout);

      // Add to buffer (preserve effective timeout for when request is eventually executed)
      this.requestBuffer.push(entry);
      this.log.debug(`[Buffer] Request buffered (${this.requestBuffer.length}/${this.MAX_BUFFER_SIZE}):`, packetData.member);
      return;
    }

    // Server not busy, execute with auto-retry for recoverable errors
    this.executeWithRetry(socketName, packetData, effectiveTimeout, 0, options)
      .then(resolve)
      .catch(reject);
  });
}

/**
 * Execute an RDO request with auto-retry for RECOVERABLE errors.
 * Mirrors Delphi pattern: proxy calls wrapped in try-except → RenewWorldProxy on failure.
 */
private async executeWithRetry(
  socketName: string,
  packetData: Partial<RdoPacket>,
  timeoutMs: number,
  attempt = 0,
  options?: RdoRequestOptions,
): Promise<RdoPacket> {
  const result = await this.executeRdoRequest(socketName, packetData, timeoutMs, options);

  // DELPHI PARITY: Never retry mutations (CALL/SET). Delphi pattern:
  // try→except→RenewWorldProxy→return ERROR_Unknown (InterfaceServer.pas:1359).
  // No server-side idempotency — retrying risks double execution (e.g., build twice).
  const isMutation = packetData.action === RdoAction.CALL || packetData.action === RdoAction.SET;
  if (isMutation) return result;

  // Check if the response carries an RDO error code (GET/read operations only)
  if (result.errorCode && result.errorCode > 0) {
    const classified = classifyRdoError(result.errorCode);

    if (classified.recovery === ErrorRecovery.RECOVERABLE && attempt < classified.maxRetries) {
      const delay = classified.retryBaseDelayMs * Math.pow(2, attempt);
      this.log.warn(
        `[RDO] Recoverable error ${result.errorCode} on ${packetData.member} — retry ${attempt + 1}/${classified.maxRetries} in ${delay}ms`
      );

      // LEGACY PARITY (audit V4): never reconnect from a query-level error.
      // Delphi's ReportCnxFailure is a no-op (ServerCnxHandler.pas:3394-3405);
      // reconnection is driven EXCLUSIVELY by the socket 'close' event. If the
      // transport is really dead, 'close' fires and handles it.

      await new Promise(r => setTimeout(r, delay));
      return this.executeWithRetry(socketName, packetData, timeoutMs, attempt + 1, options);
    }
  }

  return result;
}

private async executeRdoRequest(socketName: string, packetData: Partial<RdoPacket>, timeoutMs: number, options?: RdoRequestOptions): Promise<RdoPacket> {
  // For world requests: use connection pool if available (parallel RDO via multiple sockets)
  let poolConn: PooledConnection | undefined;
  let socket: net.Socket | undefined;

  // Values that belong to the carrying connection rather than to the addressed
  // object must never leave the primary socket — the session binds to whichever
  // connection answered them (RDOQueryServer.pas:269-274 → InterfaceServer.pas:1919-1923).
  const connectionBound = isConnectionBoundMember(packetData) || options?.forcePrimarySocket === true;

  if (socketName === 'world' && this.worldPool && this.worldPool.size > 0 && !connectionBound) {
    try {
      // getConnection() acquires the slot atomically with selection
      poolConn = await this.worldPool.getConnection();
      socket = poolConn.socket;
    } catch {
      // Pool unavailable — fall back to primary socket
      socket = this.sockets.get(socketName);
    }
  } else {
    socket = this.sockets.get(socketName);
  }

  // Auto-reconnect world socket on-demand (mirrors Delphi RenewWorldProxy)
  if (!socket && socketName === 'world'
      && (this.phase === SessionPhase.WORLD_CONNECTED || this.phase === SessionPhase.RECONNECTING)
      && !this.isClosing) {
    this.log.warn('[Session] World socket not active, attempting reconnect before request...');
    await this.attemptWorldReconnect();
    // After reconnect, try pool again or fall back to socket
    if (this.worldPool && this.worldPool.size > 0 && !connectionBound) {
      try {
        // getConnection() acquires the slot atomically with selection
        poolConn = await this.worldPool.getConnection();
        socket = poolConn.socket;
      } catch {
        socket = this.sockets.get(socketName);
      }
    } else {
      socket = this.sockets.get(socketName);
    }
  }

  // O-L2: every throw below this point happens with a pool slot already
  // acquired (getConnection acquires atomically with selection), so each one
  // used to leak it. The guards reject programming errors, which means the
  // leak was worst exactly when the code was already wrong.
  const releaseAcquiredSlot = () => {
    if (poolConn && this.worldPool) this.worldPool.releaseSlot(poolConn, false);
  };

  if (!socket) {
    releaseAcquiredSlot();
    throw new Error(`Socket ${socketName} not active`);
  }


  // Capture pool connection for slot release on completion
  const capturedPoolConn = poolConn;
  const pool = this.worldPool;

  return new Promise((resolve, reject) => {
    // Wrap resolve/reject to release pool slot
    const wrappedResolve = (packet: RdoPacket) => {
      releaseOnce(false);
      resolve(packet);
    };
    // O-L2: this used to contain a bare `resolve;` — an expression statement
    // with no effect — and released nothing. The timeout path does release, but
    // it is not the only rejection path: entry.reject is also called on socket
    // teardown and on the errorCode contract (P-M3). Those leaked a pool slot
    // permanently, and with a pool of 6 that is a slow strangle rather than a
    // visible failure. `released` keeps it idempotent with the timeout handler.
    let released = false;
    const releaseOnce = (timedOut: boolean) => {
      if (released) return;
      released = true;
      if (capturedPoolConn && pool) pool.releaseSlot(capturedPoolConn, timedOut);
    };
    const wrappedReject = (err: unknown) => {
      releaseOnce(false);
      reject(err);
    };

    const rid = this.allocateRequestId();
    const packet = { ...packetData, rid, type: 'REQUEST' } as RdoPacket;
    const member = packetData.member || 'unknown';

    // Set up timeout — transitions entry to 'timed-out' instead of deleting.
    // The entry stays in the map so late responses can be detected.
    const timeoutHandle = setTimeout(() => {
      const entry = this.pendingRequests.get(rid);
      if (entry && entry.state === 'pending') {
        entry.state = 'timed-out';
        this.rdoMetrics.totalTimedOut++;
        this.consecutiveRdoFailures++;
        // Release pool slot with timeout flag
        releaseOnce(true);
        this.log.warn(`[RDO] TIMEOUT RID ${rid} ${socketName}/${member} after ${timeoutMs}ms (pending=${this.pendingRequests.size}, timedOut=${this.rdoMetrics.totalTimedOut}, consecutiveFails=${this.consecutiveRdoFailures})`);
        reject(new Error(`Request timeout: ${member}`));

        // LEGACY PARITY: request-latency timeouts NEVER trigger a reconnect.
        // The Voyager client's ReportCnxFailure is a no-op (ServerCnxHandler.pas:3394-3405);
        // it reconnects ONLY on a real socket disconnect (OnSocketDisconnect →
        // ConnectionDropped). A slow-but-alive server producing timeouts on an
        // open socket must not be treated as a dead connection — doing so caused
        // synchronized relogin storms. consecutiveRdoFailures is kept as telemetry.
      }
    }, timeoutMs);

    // Store entry with state tracking — use wrappedResolve for pool slot release
    this.pendingRequests.set(rid, {
      resolve: wrappedResolve,
      reject: wrappedReject,
      state: 'pending',
      sentAt: Date.now(),
      member,
      timeoutHandle,
    });

    this.rdoMetrics.totalSent++;

    // Send the request
    const rawString = RdoProtocol.format(packet);
    this.log.debug(`RDO>> ${socketName}`, { command: member, verb: packetData.verb, rid, timeoutMs, separator: packetData.separator, raw: redactRdoRaw(packetData.member, rawString) });
    writeRdoFrame(socket!, rawString + RDO_CONSTANTS.PACKET_DELIMITER, true);
  });
}

	/**
	 * @param originSocket the connection the frame arrived on. Only differs from
	 *        the primary socket for world-pool connections, but it matters: a
	 *        server request must be answered on the connection that asked, since
	 *        Delphi's pending query is per-connection (O-L1).
	 */
	private processSingleCommand(socketName: string, raw: string, originSocket?: net.Socket) {
	  const packet = RdoProtocol.parse(raw);
	  this.log.debug(`RDO<< ${socketName}`, { type: packet.type, rid: packet.rid, raw });

	  // Check if this is a RefreshArea push (map visual update — buildings/roads changed)
	  if (this.isRefreshAreaPush(packet)) {
		const area = this.parseRefreshAreaPush(packet);
		if (area) {
		  this.log.debug(`[Session] RefreshArea at (${area.x}, ${area.y}) ${area.width}x${area.height}`);
		  this.emit('ws_event', {
			type: WsMessageType.EVENT_AREA_REFRESH,
			x: area.x,
			y: area.y,
			width: area.width,
			height: area.height,
		  } as WsEventAreaRefresh);
		}
		return;
	  }

	  // Check if this is a RefreshObject push (building state changed)
	  if (this.isRefreshObjectPush(packet)) {
		const result = this.parseRefreshObjectPush(packet);
		if (result) {
		  this.log.debug(`[Session] RefreshObject for building ${result.buildingId}, kindOfChange=${result.kindOfChange}`);
		  const building = result.buildingInfo ?? {
			buildingId: result.buildingId,
			buildingName: '',
			ownerName: '',
			salesInfo: '',
			revenue: '',
			detailsText: '',
			hintsText: '',
			x: this.currentFocusedCoords?.x ?? 0,
			y: this.currentFocusedCoords?.y ?? 0,
		  };
		  this.emit('ws_event', {
			type: WsMessageType.EVENT_BUILDING_REFRESH,
			building,
			kindOfChange: result.kindOfChange,
		  } as WsEventBuildingRefresh);
		}
		return;
	  }

	  // Handle server requests (IDOF, etc.)
	  //
	  // `packet.rid != null`, NOT `packet.rid` — QueryId 0 is a real, recurring
	  // id and `0` is falsy. TRDOServerClientConnection.GenerateQueryId returns
	  // BEFORE incrementing (WinSockRDOServerClientConnection.pas:67-73), so 0 is
	  // handed out on the server's first push request after a restart, and again
	  // on every wraparound at 65536 — shared by all clients. Dropping it left
	  // the server blocked for its full TimeOut; when the ignored frame was the
	  // `idof "InterfaceEvents"` issued inside RegisterEventsById, InitClient
	  // never arrived and login failed after 15 s, looking like a network fault.
	  // The response branch below already gets this right (`packet.rid != null`).
	  if (packet.type === 'REQUEST' && packet.rid != null) {
		this.handleServerRequest(socketName, packet, originSocket);
		return;
	  }

	  // Handle responses — state machine for late response detection
	  if (packet.type === 'RESPONSE') {
		const entry = packet.rid != null ? this.pendingRequests.get(packet.rid) : undefined;
		if (entry) {
		  this.pendingRequests.delete(packet.rid!);
		  clearTimeout(entry.timeoutHandle);

		  if (entry.state === 'pending') {
			// Normal path — resolve the promise
			if (packet.errorCode && packet.errorCode > 0) {
			  this.log.warn(`[RDO] Error response RID ${packet.rid}: ${packet.errorName} (code ${packet.errorCode})`);
			  // Maintenance mode detection (mirrors Delphi fMSDownCount)
			  this.checkMaintenanceMode(packet.errorCode);
			  // DELPHI PARITY: Error responses prove the connection is ALIVE — do NOT
			  // increment consecutiveRdoFailures. Only timeouts (in the timeout handler)
			  // indicate a dead connection. Delphi uses RenewWorldProxy in exception
			  // handlers (connection lost), not on error response codes.

			  // P-M3: no call site reads packet.errorCode, so this reply is about
			  // to be delivered as a success. Census it now, and reject once the
			  // contract is flipped (config.rdo.errorContract).
			  const contractError = handleRdoErrorResponse({
				socketName,
				member: entry.member ?? 'unknown',
				errorCode: packet.errorCode,
				errorName: packet.errorName,
				rid: packet.rid,
				payload: packet.payload,
			  }, this.log);
			  if (contractError) {
				this.rdoMetrics.totalResolved++;
				entry.reject(contractError);
				return;
			  }
			} else {
			  // Success — reset counter (mirrors Delphi ReportCnxValid)
			  this.consecutiveRdoFailures = 0;
			  // Check if maintenance mode should be cleared
			  if (this.maintenanceMode) this.checkMaintenanceMode(0);
			}
			this.rdoMetrics.totalResolved++;
			entry.resolve(packet);
		  } else {
			// Late response — request already timed out, promise already rejected
			const elapsed = Date.now() - entry.sentAt;
			this.log.warn(`[RDO] LATE RESPONSE for ${entry.member} (RID ${packet.rid}) on ${socketName} after ${elapsed}ms. Payload: ${(raw || '').slice(0, 200)}`);
			this.rdoMetrics.totalLateResponses++;
		  }
		} else if (packet.rid != null) {
		  // Truly orphaned — past grace period or unknown RID
		  this.log.warn(`[RDO] Orphaned response RID ${packet.rid} on ${socketName} (no pending entry — GC'd or never tracked). Payload: ${(raw || '').slice(0, 200)}`);
		  this.rdoMetrics.totalOrphaned++;
		} else if (packet.errorCode === 17) {
		  // Malformed busy rejection "A"+"error 17" with no RID and no terminator
		  // (WinSockRDOConnectionsServer.pas:812) — the server refused the query
		  // because it is busy. Flip the busy flag; the ModelStatusChanged push or
		  // the ServerBusy poll will clear it when the server recovers.
		  this.log.warn(`[RDO] Server busy rejection (malformed 'Aerror 17') on ${socketName}`);
		  this.setServerBusyFromPush(true);
		} else {
		  // P-L7: a response the parser could not attach a rid to — neither
		  // `A<digits>` nor `A error N` — used to fall off the end of this chain
		  // in complete silence. The request it belonged to then sat until its
		  // full 180 s timeout and surfaced as "the server is slow", with nothing
		  // in the log pointing at the malformed frame that actually caused it.
		  this.log.warn(
			`[RDO] Unparseable response on ${socketName} — no rid, no error code. ` +
			`A pending request will now wait out its full timeout. Raw: ${(raw || '').slice(0, 200)}`
		  );
		  this.rdoMetrics.totalOrphaned++;
		}
	  } else {
		// Push command
		this.handlePush(socketName, packet);
	  }
	}


  /**
   * Answer a request the SERVER sent us on the reverse channel.
   *
   * Two rules, both learned the hard way:
   *
   * 1. **Answer on the connection that asked** (O-L1). Delphi parks the pending
   *    query on the connection object and waits on its event
   *    (`WinSockRDOServerClientConnection.pas:227-252`); a reply arriving on a
   *    different socket never signals it. Latent while the world pool is empty,
   *    active the moment it is populated — which is why it is fixed first.
   *
   * 2. **Always answer** (O-M2). `WaitForSingleObject(theQuery.Event, TimeOut)`
   *    (`:252`) blocks a thread of the SHARED server for the whole timeout when
   *    we stay silent. Dropping the frame costs them a thread, not us. The
   *    legacy client always replies (`ServerCnxHandler.pas:666-669`).
   */
  private handleServerRequest(socketName: string, packet: RdoPacket, originSocket?: net.Socket) {
    this.log.debug(`[Session] Server Request: ${packet.raw}`);

    const socket = originSocket ?? this.sockets.get(socketName);
    const reply = (body: string): void => {
      if (!socket) {
        this.log.warn(`[Session] No socket to answer server request ${packet.rid} on ${socketName}`);
        return;
      }
      const frame = `${RDO_CONSTANTS.CMD_PREFIX_ANSWER}${packet.rid} ${body}${RDO_CONSTANTS.PACKET_DELIMITER}`;
      writeRdoFrame(socket, frame);
      this.log.debug(`[Session] Answered server: ${frame}`);
    };

    if (packet.rid === undefined) {
      // No QueryId — the server is not waiting on an answer (RDOQueryServer.pas:174-178).
      this.log.debug('[Session] Server request without QueryId — nothing to answer');
      return;
    }

    if (packet.verb === RdoVerb.IDOF && packet.targetId) {
      const objectId = this.knownObjects.get(packet.targetId);
      if (objectId) {
        reply(`objid="${objectId}"`);
      } else {
        // errIllegalObject. Previously just a warn — which left a Delphi thread
        // blocked for its full TimeOut on every unknown name.
        this.log.warn(`[Session] Server requested unknown object: ${packet.targetId}`);
        reply('error 5');
      }
      return;
    }

    if (packet.action === RdoAction.CALL && packet.member === 'AnswerStatus') {
      // Server liveness heartbeat on the reverse channel. Legacy client answers
      // NOERROR (TISEvents.AnswerStatus, ServerCnxHandler.pas:666-669).
      reply('res="#0"');
      return;
    }

    // errUnexistentMethod — we do not implement this member, but the server is
    // still waiting. Say so rather than letting it time out.
    this.log.warn(`[Session] Unhandled server request: ${packet.member ?? packet.raw}`);
    reply('error 9');
  }

private handlePush(socketName: string, packet: RdoPacket) {
  dispatchPush(this, socketName, packet);
}


  // -- CHAT (facade -> chat-handler) ----------------------------------------
  public async getChatUserList(): Promise<ChatUser[]> {
    return chatHandler.getChatUserList(this);
  }

  public async getChatChannelList(): Promise<string[]> {
    return chatHandler.getChatChannelList(this);
  }

  public async getChatChannelInfo(channelName: string): Promise<string> {
    return chatHandler.getChatChannelInfo(this, channelName);
  }

  public async joinChatChannel(channelName: string): Promise<void> {
    return chatHandler.joinChatChannel(this, channelName);
  }

  public async sendChatMessage(message: string): Promise<void> {
    return chatHandler.sendChatMessage(this, message);
  }

  public async setChatTypingStatus(isTyping: boolean): Promise<void> {
    return chatHandler.setChatTypingStatus(this, isTyping);
  }

  public getCurrentChannel(): string {
    return chatHandler.getCurrentChannel(this);
  }

  // =========================================================================
  // SESSION LIFECYCLE
  // =========================================================================

  /**
   * Save the player's current camera position to tycoon cookies.
   * Delphi: SetTycoonCookie(TycoonId, 'LastX.0', x) / SetTycoonCookie(TycoonId, 'LastY.0', y)
   * Called before endSession to persist position across sessions.
   */
  public async savePlayerPosition(): Promise<void> {
    if (!this.worldContextId || !this.tycoonId) {
      this.log.debug('[Session] Cannot save position — not connected to world');
      return;
    }
    if (this.lastPlayerX === 0 && this.lastPlayerY === 0) {
      this.log.debug('[Session] Skipping position save — position is (0, 0)');
      return;
    }

    try {
      this.log.debug(`[Session] Saving player position: (${this.lastPlayerX}, ${this.lastPlayerY})`);

      const socket = this.sockets.get('world');
      if (!socket || socket.destroyed) return;

      // SetTycoonCookie(TycoonId, CookieName, CookieValue) — void push
      const cmdX = rdoCall('SetTycoonCookie', this.worldContextId, RdoValue.int(parseInt(this.tycoonId, 10)), RdoValue.string('LastX.0'), RdoValue.string(String(this.lastPlayerX))).toFrame();
      writeRdoFrame(socket, cmdX);

      const cmdY = rdoCall('SetTycoonCookie', this.worldContextId, RdoValue.int(parseInt(this.tycoonId, 10)), RdoValue.string('LastY.0'), RdoValue.string(String(this.lastPlayerY))).toFrame();
      writeRdoFrame(socket, cmdY);

      this.log.debug('[Session] Player position saved');
    } catch (e: unknown) {
      this.log.debug(`[Session] Failed to save position: ${toErrorMessage(e)}`);
    }
  }

  /**
   * Whether the session has an active world connection (WORLD_CONNECTING or WORLD_CONNECTED).
   * Used by the gateway to detect server-switch scenarios.
   */
  public isWorldConnected(): boolean {
    return this.phase === SessionPhase.WORLD_CONNECTING
        || this.phase === SessionPhase.WORLD_CONNECTED;
  }

  /**
   * Cleanup current world session for server switching.
   * Sends RDOEndSession, closes all persistent sockets (world, mail, map, etc.),
   * resets world-level state, but preserves credentials and directory data
   * so the session can loginWorld() to a different server.
   */
  public async cleanupWorldSession(): Promise<void> {
    this.log.debug('[Session] Cleaning up world session for server switch...');

    // GUARD: Prevent reconnect from racing with cleanup (CRITICAL — security audit #2)
    this.phase = SessionPhase.WORLD_CONNECTING;
    this.worldReconnecting = null;
    this.worldReconnectAttempts = 0;

    // 0. Release active inspector temp object BEFORE closing sockets
    // (CloseObject needs the map socket to send the fire-and-forget command)
    // Mirrors Delphi ReleaseCacheObject() in TObjectInspectorContainer destructor.
    this.releaseInspector();

    // 1. Send RDOEndSession to gracefully close the game server session
    await this.endSession();

    // 2. Stop background services
    this.stopServerBusyPolling();
    this.stopCacherKeepAlive();
    this.stopGcSweep();

    // 3. Close all persistent sockets (keep directory data intact)
    for (const [name, socket] of this.sockets.entries()) {
      this.log.debug(`[Session] Closing socket: ${name}`);
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch (err: unknown) {
        this.log.error(`[Session] Error closing socket ${name}:`, err);
      }
    }
    this.sockets.clear();
    this.framers.clear();

    // 3b. Close world connection pool (mirrors destroy() pattern)
    if (this.worldPool) {
      this.worldPool.close();
      this.worldPool = null;
    }

    // 4. Clear pending requests and buffers
    for (const [, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timeoutHandle);
      if (entry.state === 'pending') {
        entry.reject(new Error('Session cleaned up for server switch'));
      }
    }
    this.pendingRequests.clear();
    const switchError = new Error('Session cleaned up for server switch');
    for (const buffered of this.requestBuffer) {
      buffered.reject(switchError);
    }
    this.requestBuffer = [];
    this.pendingMapRequests.clear();
    this.pendingFocusRequests.clear();
    this.lastFocusInfo = null;
    this.lastFocusAt = 0;

    // 5. Reset world-level state (preserve credentials + directory data)
    this.worldContextId = null;
    this.tycoonId = null;
    this.currentWorldInfo = null;
    this._rdoCnntId = null;
    this.cacherId = null;
    this.worldId = null;
    this.daPort = null;
    this.aspActionCache.clear();
    this.interfaceServerId = null;
    this.interfaceEventsId = null;
    this.mailAccount = null;
    this.mailAddr = null;
    this.mailPort = null;
    this.mailServerId = null;
    this.worldXSize = null;
    this.worldYSize = null;
    this.worldSeason = null;
    this.virtualDate = null;
    this.accountMoney = null;
    this.failureLevel = null;
    this.fTycoonProxyId = null;
    this.lastRanking = 0;
    this.lastBuildingCount = 0;
    this.lastMaxBuildings = 0;
    this.currentCompany = null;
    this.availableCompanies = [];
    this.currentFocusedBuildingId = null;
    this.currentFocusedCoords = null;
    this.currentFocusedBuildingName = null;
    this.currentFocusedOwnerName = null;
    this.isServerBusy = false;
    this.activeMapRequests = 0;
    this.knownObjects.clear();
    this.chatUsers.clear();
    this.currentChannel = '';

    // 6. Reset phase to allow new loginWorld()
    this.loggedOff = false; // re-arm graceful logoff for the next world session
    this.phase = SessionPhase.DIRECTORY_CONNECTED;

    this.log.debug('[Session] World session cleanup complete, ready for new loginWorld()');
  }

  /**
   * Gracefully log off the world session — mirrors the legacy Voyager client
   * (ServerCnxHandler.pas:2043-2063):
   *   1. ClientNotAware   — void procedure, fire-and-forget "*"
   *   2. get Logoff       — zero-arg COM property-get, 5s deadline (LogoffTimeOut)
   *   3. socket.end()     — server-side cleanup runs in TClientView.OnDisconnect
   *
   * The published TClientView.Logoff is a no-op returning NOERROR
   * (InterfaceServer.pas:2019-2022). The InterfaceServer does NOT publish
   * RDOEndSession (that is a TDirectorySession member) — the previous
   * implementation sent it here and only produced errUnexistentMethod noise.
   *
   * Idempotent: REQ_LOGOUT handler and ws.on('close') may both call this.
   */
  public async endSession(): Promise<void> {
    if (this.loggedOff) {
      this.log.debug('[Session] endSession: already logged off');
      return;
    }

    // Save camera position before ending session
    await this.savePlayerPosition();

    if (!this.worldContextId) {
      this.log.debug('[Session] No active world session to end (no worldContextId)');
      return;
    }

    // From here on the world socket close is intentional — no auto-reconnect.
    this.loggedOff = true;
    this.log.debug(`[Session] Logging off ClientView ${this.worldContextId}`);

    const socket = this.sockets.get('world');
    if (socket && !socket.destroyed) {
      try {
        // 1. ClientNotAware — legacy statement call (fire-and-forget)
        writeRdoFrame(socket, rdoCall('ClientNotAware', this.worldContextId).toFrame());

        // 2. Logoff — skip when the server is busy (a buffered request could
        //    hang logout); the socket close alone triggers full server cleanup.
        if (!this.isServerBusy) {
          await this.sendRdoRequest('world', rdoGet('Logoff', this.worldContextId).packet, StarpeaceSession.LOGOFF_TIMEOUT_MS, TimeoutCategory.NORMAL);
          this.log.debug('[Session] Logoff acknowledged by InterfaceServer');
        }
      } catch (err: unknown) {
        this.log.warn('[Session] Logoff failed or timed out — closing socket anyway:', toErrorMessage(err));
      }

      // 3. Graceful close (FIN) — Delphi TClientView.OnDisconnect performs the
      //    authoritative teardown when it sees the disconnect.
      try {
        socket.end();
      } catch {
        socket.destroy();
      }
    }
  }

  /**
   * Cleanup all resources and close all connections
   * Should be called when the WebSocket client disconnects
   */
  public destroy(): void {
    this.isClosing = true;
    this.worldReconnecting = null; // Cancel any in-progress reconnect
    this.log.debug('[Session] Destroying session and cleaning up resources...');

    // Release active inspector temp object BEFORE closing sockets
    // (CloseObject needs the map socket to send the fire-and-forget command)
    this.releaseInspector();

    // Stop ServerBusy polling
    this.stopServerBusyPolling();

    // Stop cacher KeepAlive timer
    this.stopCacherKeepAlive();

    // Close world connection pool
    if (this.worldPool) {
      this.worldPool.close();
      this.worldPool = null;
    }

    // Close all TCP sockets
    for (const [name, socket] of this.sockets.entries()) {
      this.log.debug(`[Session] Closing socket: ${name}`);
      try {
        socket.destroy();
      } catch (err: unknown) {
        this.log.error(`[Session] Error closing socket ${name}:`, err);
      }
    }

    // Stop GC sweep
    this.stopGcSweep();

    // Reject all pending RDO requests before clearing (mirrors cleanupWorldSession pattern)
    const destroyError = new Error('Session destroyed');
    for (const [, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timeoutHandle);
      if (entry.state === 'pending') {
        entry.reject(destroyError);
      }
    }
    for (const buffered of this.requestBuffer) {
      buffered.reject(destroyError);
    }

    // Clear all maps and buffers
    this.sockets.clear();
    this.framers.clear();
    this.pendingRequests.clear();
    this.availableWorlds.clear();
    this.knownObjects.clear();
    this.chatUsers.clear();
    this.requestBuffer = [];
    this.pendingMapRequests.clear();
    this.pendingFocusRequests.clear();
    this.lastFocusInfo = null;
    this.lastFocusAt = 0;

    // Reset state
    this.phase = SessionPhase.DISCONNECTED;
    this.directorySessionId = null;
    this.worldContextId = null;
    this.tycoonId = null;
    this.currentWorldInfo = null;
    this._rdoCnntId = null;
    this.cacherId = null;
    this.worldId = null;
    this.daPort = null;
    this.aspActionCache.clear();
    this.interfaceEventsId = null;
    this.currentFocusedBuildingId = null;
    this.currentFocusedCoords = null;
    this.currentFocusedBuildingName = null;
    this.currentFocusedOwnerName = null;
    this.isServerBusy = false;
    this.activeMapRequests = 0;

    // Zero out credentials from memory
    this._cachedPassword = null;
    this.cachedUsername = null;

    this.log.debug('[Session] Session destroyed successfully');
  }

  // -- ZONE/SURFACE (facade -> zone-surface-handler) -----------------------
  public async defineZone(zoneId: number, x1: number, y1: number, x2: number, y2: number): Promise<{ success: boolean; message?: string }> {
    return zoneSurfaceHandler.defineZone(this, zoneId, x1, y1, x2, y2);
  }

  public async getSurfaceData(surfaceType: SurfaceType, x1: number, y1: number, x2: number, y2: number): Promise<SurfaceData> {
    return zoneSurfaceHandler.getSurfaceData(this, surfaceType, x1, y1, x2, y2);
  }

  // -- BUILDING TEMPLATES (facade -> building-templates-handler) ------------
  public async fetchClusterInfo(clusterName: string): Promise<ClusterInfo> {
    return buildingTemplatesHandler.fetchClusterInfo(this, clusterName);
  }

  public async fetchClusterFacilities(cluster: string, folder: string): Promise<ClusterFacilityPreview[]> {
    return buildingTemplatesHandler.fetchClusterFacilities(this, cluster, folder);
  }

  public async fetchBuildingCategories(companyName: string): Promise<BuildingCategory[]> {
    return buildingTemplatesHandler.fetchBuildingCategories(this, companyName);
  }

  public async fetchBuildingFacilities(companyName: string, cluster: string, kind: string, kindName: string, folder: string, tycoonLevel: number): Promise<BuildingInfo[]> {
    return buildingTemplatesHandler.fetchBuildingFacilities(this, companyName, cluster, kind, kindName, folder, tycoonLevel);
  }

  public async placeBuilding(facilityClass: string, x: number, y: number): Promise<{ success: boolean; buildingId: string | null }> {
    return buildingTemplatesHandler.placeBuilding(this, facilityClass, x, y);
  }

  public async placeCapitol(x: number, y: number): Promise<{ success: boolean; buildingId: string | null }> {
    return buildingTemplatesHandler.placeCapitol(this, x, y);
  }

  // -- BUILDING DETAILS (facade -> building-details-handler) ----------------
  public async getBuildingBasicDetails(x: number, y: number, visualClass: string): Promise<BuildingDetailsResponse> {
    return buildingDetailsHandler.getBuildingBasicDetails(this, x, y, visualClass);
  }

  public async getBuildingTabData(x: number, y: number, tabId: string, visualClass?: string, groupIds?: string[]): Promise<{
    supplies?: import('../shared/types').BuildingSupplyData[];
    products?: import('../shared/types').BuildingProductData[];
    compInputs?: import('../shared/types').CompInputData[];
    warehouseWares?: import('../shared/types').WarehouseWareData[];
    groups?: { [groupId: string]: import('../shared/types').BuildingPropertyValue[] };
  }> {
    return buildingDetailsHandler.getBuildingTabData(this, x, y, tabId, visualClass, groupIds);
  }

  /**
   * One gate's connection rows, read on demand when the user opens it.
   * The tab request above deliberately returns gates with empty connection
   * lists; this is the other half.
   */
  public async getBuildingGateConnections(
    x: number,
    y: number,
    tabId: 'supplies' | 'products',
    path: string,
    name: string,
    visualClass?: string,
  ): Promise<{
    supply?: import('../shared/types').BuildingSupplyData;
    product?: import('../shared/types').BuildingProductData;
  }> {
    return buildingDetailsHandler.getBuildingGateConnections(this, x, y, tabId, path, name, visualClass);
  }

  public async refreshBuildingProperties(x: number, y: number, visualClass: string, activeTabId?: string): Promise<BuildingDetailsResponse> {
    return buildingDetailsHandler.refreshBuildingProperties(this, x, y, visualClass, activeTabId);
  }

  public releaseInspector(): void {
    buildingDetailsHandler.releaseInspector(this);
  }

  // -- BUILDING PROPERTY (facade -> building-property-handler) --------------
  public async setBuildingProperty(x: number, y: number, propertyName: string, value: string, additionalParams?: Record<string, string>): Promise<{ success: boolean; newValue: string; confirmed?: boolean }> {
    return buildingPropertyHandler.setBuildingProperty(this, x, y, propertyName, value, additionalParams);
  }

  // -- RESEARCH (facade -> research-handler) --------------------------------
  public async getResearchInventory(x: number, y: number, categoryIndex: number): Promise<ResearchCategoryData> {
    return researchHandler.getResearchInventory(this, x, y, categoryIndex);
  }

  public async getResearchDetails(x: number, y: number, inventionId: string): Promise<ResearchInventionDetails> {
    return researchHandler.getResearchDetails(this, x, y, inventionId);
  }

}

// parseResearchItems moved to session/session-utils.ts — re-export for backward compat
export { parseResearchItems } from './session/session-utils';
