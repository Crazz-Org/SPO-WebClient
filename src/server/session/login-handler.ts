/**
 * Login Handler — extracted from StarpeaceSession.
 *
 * Contains the login/company lifecycle: directory authentication, world login,
 * company selection, company creation, and company switching.
 * Also includes directory query helpers (parseDirectoryResult, fetchCompaniesViaHttp, etc.)
 */

import * as net from 'net';
import { fetchWithTimeout } from '../fetch-with-timeout';
import type { RdoPacket, WorldInfo, CompanyInfo, LoginPageOutcome, WorldAdmission } from '../../shared/types';
import { SessionPhase, DIRECTORY_QUERY } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall, rdoGet, rdoSet, rdoIdOf } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { config } from '../../shared/config';
import { AuthError } from '../../shared/auth-error';
import { DIR_NOERROR, DIR_NOERROR_StillTrial } from '../../shared/directory-error-codes';
import { toErrorMessage } from '../../shared/error-utils';
import {
  parsePropertyResponse as parsePropertyResponseHelper,
  parseIdOfResponse as parseIdOfResponseHelper,
  cleanPayload as cleanPayloadHelper,
  writeRdoFrame,
} from '../rdo-helpers';
import { RDO_PREFIX_STRIP } from '../../shared/rdo-types';

// ── Login Context ───────────────────────────────────────────────────────────

/**
 * Narrow interface for login/directory lifecycle operations.
 * StarpeaceSession implements this so login functions can access
 * the session state they need without importing the full class.
 */
export interface LoginContext {
  // ── Logging ──
  readonly log: {
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  // ── RDO Transport ──
  sendRdoRequest(socketName: string, packetData: Partial<RdoPacket>, timeoutMs: number | undefined, category: TimeoutCategory): Promise<RdoPacket>;
  getSocket(name: string): net.Socket | undefined;
  createSocket(name: string, host: string, port: number): Promise<net.Socket>;
  deleteSocket(name: string): void;
  /** Construct the per-user world connection pool (empty) after the primary socket is connected */
  initWorldPool(host: string, port: number): void;
  /** Populate that pool — only once the session is bound to the primary socket */
  populateWorldPool(): void;

  // ── Event Emission ──
  emit(event: string, ...args: unknown[]): boolean;

  // ── Read-only state ──
  readonly worldContextId: string | null;
  readonly tycoonId: string | null;
  readonly interfaceServerId: string | null;
  readonly worldId: string | null;
  readonly currentWorldInfo: WorldInfo | null;
  readonly cachedUsername: string | null;
  readonly cachedPassword: string | null;
  readonly rdoCnntId: string | null;
  readonly currentCompany: CompanyInfo | null;

  // ── Phase management ──
  getPhase(): SessionPhase;
  setPhase(phase: SessionPhase): void;

  // ── Session state setters ──
  setWorldContextId(value: string | null): void;
  setInterfaceServerId(value: string | null): void;
  setTycoonId(value: string | null): void;
  setRdoCnntId(value: string | null): void;
  setCacherId(value: string | null): void;
  setWorldId(value: string | null): void;
  setDaPort(value: number | null): void;
  setDaAddr(value: string | null): void;
  setMailAccount(value: string | null): void;
  setMailAddr(value: string | null): void;
  setMailPort(value: number | null): void;
  setWorldXSize(value: number | null): void;
  setWorldYSize(value: number | null): void;
  setWorldSeason(value: number | null): void;
  setCurrentWorldInfo(value: WorldInfo | null): void;
  setCachedUsername(value: string | null): void;
  setCachedPassword(value: string | null): void;
  setCachedZonePath(value: string): void;
  setAtWorldLimit(value: boolean | null): void;
  setActiveUsername(value: string | null): void;
  setCurrentCompany(value: CompanyInfo | null): void;
  setLastPlayerX(value: number): void;
  setLastPlayerY(value: number): void;

  // ── Collections ──
  getAvailableWorlds(): Map<string, WorldInfo>;
  setAvailableWorlds(worlds: Map<string, WorldInfo>): void;
  getAvailableCompanies(): CompanyInfo[];
  setAvailableCompanies(companies: CompanyInfo[]): void;
  pushAvailableCompany(company: CompanyInfo): void;

  // ── Known Objects ──
  setKnownObject(name: string, id: string): void;

  // ── InitClient synchronization ──
  setWaitingForInitClient(value: boolean): void;
  getInitClientReceived(): Promise<void> | null;
  setInitClientReceived(value: Promise<void> | null): void;
  setInitClientResolver(value: (() => void) | null): void;

  // ── Lifecycle hooks ──
  startServerBusyPolling(): void;
  startGcSweep(): void;
  stopCacherKeepAlive(): void;

  // ── Socket management (for switchCompany cleanup) ──
  getSocketNames(): string[];
  removeAllSocketListeners(name: string): void;
  destroySocket(name: string): void;
  deleteFramer(name: string): void;

  // ── State reset (for switchCompany) ──
  clearAspActionCache(): void;
  clearBuildingFocus(): void;
}

// ── Parse Season Value ──────────────────────────────────────────────────────

function parseSeasonValue(value: string): number {
  const num = parseInt(value, 10);
  if (!isNaN(num) && num >= 0 && num <= 3) return num;
  const map: Record<string, number> = { winter: 0, spring: 1, summer: 2, autumn: 3, fall: 3 };
  return map[value.toLowerCase()] ?? 2; // default Summer
}

// ── Directory Methods ───────────────────────────────────────────────────────

/**
 * Auth-only check: validates credentials against the Directory Server
 * without querying the world list. Throws AuthError on failure.
 */
export async function checkAuth(ctx: LoginContext, username: string, password: string): Promise<void> {
  return performDirectoryAuth(ctx, username, password);
}

/**
 * Connect to Directory Service in two ephemeral phases:
 * 1. Authentication Check
 * 2. World List Retrieval
 */
export async function connectDirectory(
  ctx: LoginContext,
  username: string,
  pass: string,
  zonePath?: string,
): Promise<WorldInfo[]> {
  ctx.setPhase(SessionPhase.DIRECTORY_CONNECTED);
  ctx.setCachedUsername(username);
  ctx.setActiveUsername(username);
  ctx.setCachedPassword(pass);
  ctx.setCachedZonePath(zonePath || 'Root/Areas/Asia/Worlds');
  // A re-connect (a zone change, a server switch) must not carry the previous answer.
  ctx.setAtWorldLimit(null);

  // Run auth and world query in parallel (independent sockets & sessions)
  ctx.log.info('Directory: connecting...');
  const [, worlds] = await Promise.all([
    performDirectoryAuth(ctx, username, pass),
    performDirectoryQuery(ctx, username, zonePath),
  ]);
  ctx.log.info('Directory: auth + query complete');
  return worlds;
}

/**
 * Directory Server ops run at the legacy 20 s deadline
 * (DSProxy.TimeOut := 20000, LogonHandlerViewer.pas:341).
 */
function sendDirectoryRequest(ctx: LoginContext, socketName: string, packetData: Partial<RdoPacket>): Promise<RdoPacket> {
  return ctx.sendRdoRequest(socketName, packetData, undefined, TimeoutCategory.DIRECTORY);
}

/**
 * Helper Phase 1: Auth -> EndSession
 */
async function performDirectoryAuth(ctx: LoginContext, username: string, pass: string): Promise<void> {
  const socket = await ctx.createSocket('directory_auth', config.rdo.directoryHost, config.rdo.ports.directory);
  try {
    // 1. Resolve & Open Session
    const idPacket = await sendDirectoryRequest(ctx, 'directory_auth',rdoIdOf('DirectoryServer').packet);
    const directoryServerId = parseIdOfResponseHelper(idPacket.payload);
    // RDOOpenSession is a published METHOD (DirectoryServer.pas:143), but the legacy
    // client reads it as a zero-arg COM property-get (RDOObjectProxy.pas:388-399 routes
    // PROPERTYGET+0args → MarshalPropertyGet; LogonHandlerViewer.pas:342) — byte-exact
    // wire is `get RDOOpenSession`, served by the Delphi get→CallMethod fallthrough.
    const sessionPacket = await sendDirectoryRequest(ctx, 'directory_auth',rdoGet('RDOOpenSession', directoryServerId).packet);
    const sessionId = parsePropertyResponseHelper(sessionPacket.payload || '', 'RDOOpenSession');

    // 2. Map & Logon
    await sendDirectoryRequest(ctx, 'directory_auth',rdoCall(
      'RDOMapSegaUser', sessionId,
      RdoValue.string(username),
    ).packet);
    const logonPacket = await sendDirectoryRequest(ctx, 'directory_auth',rdoCall(
      'RDOLogonUser', sessionId,
      RdoValue.string(username),
      RdoValue.string(pass),
    ).packet);
    const res = parsePropertyResponseHelper(logonPacket.payload || '', 'res');
    const authCode = parseInt(res, 10);
    // Voyager treats DIR_NOERROR and DIR_NOERROR_StillTrial (-1) alike
    // (LogonHandlerViewer.pas:548-565). NaN from a bodiless answer still refuses.
    if (authCode !== DIR_NOERROR && authCode !== DIR_NOERROR_StillTrial) throw new AuthError(authCode);

    // 3. End Session & Close — fire-and-forget without RID: ACCEPTED DIVERGENCE
    // (audit 2026-07-02, P2 — the captured legacy client sends this WITH a RID and
    // waits for the "A<id> ;" ack (live capture); wire-legal either way, TCP
    // delivers before FIN).
    writeRdoFrame(socket, rdoCall('RDOEndSession', sessionId).toFrame());
    ctx.log.debug('[Session] Directory Authentication Success');
  } finally {
    socket.end();
    ctx.deleteSocket('directory_auth');
  }
}

/**
 * Helper Phase 2: OpenSession -> QueryKey -> CanJoinNewWorld -> EndSession
 */
async function performDirectoryQuery(ctx: LoginContext, username: string, zonePath?: string): Promise<WorldInfo[]> {
  const socket = await ctx.createSocket('directory_query', config.rdo.directoryHost, config.rdo.ports.directory);
  try {
    // 1. Resolve & Open NEW Session
    const idPacket = await sendDirectoryRequest(ctx, 'directory_query',rdoIdOf('DirectoryServer').packet);
    const directoryServerId = parseIdOfResponseHelper(idPacket.payload);
    const sessionPacket = await sendDirectoryRequest(ctx, 'directory_query',rdoGet('RDOOpenSession', directoryServerId).packet);
    const sessionId = parsePropertyResponseHelper(sessionPacket.payload || '', 'RDOOpenSession');

    // 2. Query Worlds
    const worldPath = zonePath || 'Root/Areas/Asia/Worlds';
    const queryPacket = await sendDirectoryRequest(ctx, 'directory_query',rdoCall(
      'RDOQueryKey', sessionId,
      RdoValue.string(worldPath),
      RdoValue.string(DIRECTORY_QUERY.QUERY_BLOCK),
    ).packet);
    const resValue = parsePropertyResponseHelper(queryPacket.payload || '', 'res');
    const worlds = parseDirectoryResult(ctx, resValue);
    const worldMap = new Map<string, WorldInfo>();
    for (const w of worlds) {
      worldMap.set(w.name, w);
    }
    ctx.setAvailableWorlds(worldMap);

    // 2b. World limit — may this player join ANOTHER world? (logonComplete.asp:100-106)
    ctx.setAtWorldLimit(await checkWorldLimit(ctx, sessionId, username));

    // 3. End Session & Close — fire-and-forget without RID: ACCEPTED DIVERGENCE
    // (audit 2026-07-02, P2 — the captured legacy client sends this WITH a RID and
    // waits for the "A<id> ;" ack (live capture); wire-legal either way, TCP
    // delivers before FIN).
    writeRdoFrame(socket, rdoCall('RDOEndSession', sessionId).toFrame());
    return worlds;
  } finally {
    socket.end();
    ctx.deleteSocket('directory_query');
  }
}

/** `USERS_KEY & "/" & Mid(ALPHABET, idx, 1)` — DirectoryServer.wsc:175, :606, :838-871. */
const SEARCH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const USERS_KEY = 'Root/Users';
/** Byte-for-byte `"Alias" & vbCrLf` — DirectoryServer.wsc:835-836. */
const SEARCH_VALUE_NAMES = 'Alias\r\n';

/**
 * A directory boolean olevariant answer: any non-zero ordinal is true
 * (`#-1` / `#0` convention, `shared/CLAUDE.md`), plus the literal string
 * `"false"` a caller might hand back case-insensitively.
 */
function isTrueAnswer(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/**
 * Search for people/tycoons via RDOSearchKey on the Directory Server.
 * Mirrors `SearchUsers` (DirectoryServer.wsc:830-880): one session, one bucket
 * per letter of `Root/Users/<Letter>`, single-character searches narrowed to
 * their own bucket. Opens an ephemeral directory session and closes it.
 */
export async function searchPeople(ctx: LoginContext, searchStr: string): Promise<string[]> {
  if (!searchStr.trim()) return [];

  const socket = await ctx.createSocket('directory_search', config.rdo.directoryHost, config.rdo.ports.directory);
  try {
    // 1. Resolve DirectoryServer object
    const idPacket = await sendDirectoryRequest(ctx, 'directory_search',rdoIdOf('DirectoryServer').packet);
    const directoryServerId = parseIdOfResponseHelper(idPacket.payload);

    // 2. Open Session
    const sessionPacket = await sendDirectoryRequest(ctx, 'directory_search',rdoGet('RDOOpenSession', directoryServerId).packet);
    const sessionId = parsePropertyResponseHelper(sessionPacket.payload || '', 'RDOOpenSession');

    // 3. Bucket selection: a single letter narrows to its own bucket with
    //    pattern "*" (wsc:841-847); anything else sweeps all 26 buckets.
    //    Deliberate, safe divergence: a single non-letter character falls
    //    through to the full sweep instead of the wsc's negative Mid index.
    const singleLetter = /^[A-Za-z]$/.test(searchStr) ? searchStr.toUpperCase() : null;
    const buckets = singleLetter ? [singleLetter] : SEARCH_ALPHABET.split('');
    const pattern = singleLetter ? '*' : `*${searchStr}*`;

    // 4. One directory session for the whole sweep.
    const names: string[] = [];
    for (const letter of buckets) {
      const setKeyPacket = await sendDirectoryRequest(ctx, 'directory_search',rdoCall(
        'RDOSetCurrentKey', sessionId,
        RdoValue.string(`${USERS_KEY}/${letter}`),
      ).packet);
      const setKeyRes = parsePropertyResponseHelper(setKeyPacket.payload || '', 'res');
      if (!isTrueAnswer(setKeyRes)) continue;

      // P-M1: the pattern MUST carry the OLEString prefix explicitly. Passed raw,
      // its leading `*` was read as the VoidId type prefix, and the Delphi decoder
      // returns `Unassigned` for VoidId (RDOUtils.pas:351-352) — the search pattern
      // was destroyed before RDOSearchKey(SearchPattern, ValueNameList: widestring)
      // ever saw it (Directory Server/DirectoryServer.pas:78). Wire form must be
      // "%*<pattern>*", never "*<pattern>*". ValueNameList must be non-empty — the
      // server wraps its whole body in `if valueNames.Count > 0`
      // (DirectoryManager.pas:976-1104) and answers empty otherwise.
      const searchPacket = await sendDirectoryRequest(ctx, 'directory_search',rdoCall(
        'RDOSearchKey', sessionId,
        RdoValue.string(pattern),
        RdoValue.string(SEARCH_VALUE_NAMES),
      ).packet);
      const resValue = parsePropertyResponseHelper(searchPacket.payload || '', 'res');
      names.push(...parseSearchKeyResults(ctx, resValue));
    }

    // 5. End Session (fire-and-forget — void push, no RID)
    writeRdoFrame(socket, rdoCall('RDOEndSession', sessionId).toFrame());

    return names;
  } catch (err: unknown) {
    ctx.log.error('[Session] searchPeople failed:', toErrorMessage(err));
    throw err;
  } finally {
    socket.end();
    ctx.deleteSocket('directory_search');
  }
}

// ── World Login ─────────────────────────────────────────────────────────────

export interface LoginWorldResult {
  contextId: string;
  tycoonId: string;
  companies: CompanyInfo[];
  worldXSize: number | null;
  worldYSize: number | null;
  worldSeason: number | null;
  loginPage?: LoginPageOutcome;
  admission?: WorldAdmission;
}

export async function loginWorld(
  ctx: LoginContext,
  username: string,
  pass: string,
  world: WorldInfo,
): Promise<LoginWorldResult> {
  ctx.setPhase(SessionPhase.WORLD_CONNECTING);
  ctx.setCurrentWorldInfo(world);

  ctx.log.info(`Connecting to world ${world.name} (${world.ip}:${world.port})`);

  // Connect to World Server
  await ctx.createSocket('world', world.ip, world.port);

  // Initialize per-user DA connection pool (mirrors Delphi TRDOConnectionPool)
  ctx.initWorldPool(world.ip, world.port);

  // Generate Virtual Client ID for InterfaceEvents BEFORE any requests
  const virtualEventId = (Math.floor(Math.random() * 6000000) + 38000000).toString();
  ctx.setKnownObject('InterfaceEvents', virtualEventId);
  ctx.log.debug(`[Session] Virtual InterfaceEvents ID: ${virtualEventId}`);

  // 1. Resolve InterfaceServer
  const idPacket = await ctx.sendRdoRequest('world', rdoIdOf('InterfaceServer').packet, undefined, TimeoutCategory.FAST);
  const interfaceServerId = parseIdOfResponseHelper(idPacket.payload);
  ctx.setInterfaceServerId(interfaceServerId);
  ctx.log.debug(`[Session] InterfaceServer ID: ${interfaceServerId}`);

  // 2. Retrieve World Properties (10 properties)
  await fetchWorldProperties(ctx, interfaceServerId);

  // 2b. Admission — may this player found a company here? (logonComplete.asp:143-144)
  const admission = await checkWorldAdmission(ctx, interfaceServerId, username);

  // 3. Check AccountStatus
  const statusPacket = await ctx.sendRdoRequest('world', rdoCall(
    'AccountStatus', interfaceServerId,
    RdoValue.string(username),
    RdoValue.string(pass),
  ).packet, undefined, TimeoutCategory.FAST);
  const statusPayload = parsePropertyResponseHelper(statusPacket.payload!, 'res');
  ctx.log.debug(`[Session] AccountStatus: ${statusPayload}`);

  // 4. Authenticate (call Logon)
  const logonPacket = await ctx.sendRdoRequest('world', rdoCall(
    'Logon', interfaceServerId,
    RdoValue.string(username),
    RdoValue.string(pass),
  ).packet, undefined, TimeoutCategory.NORMAL);

  let contextId = cleanPayloadHelper(logonPacket.payload!);
  if (contextId.includes('res')) {
    contextId = parsePropertyResponseHelper(logonPacket.payload!, 'res');
  }

  if (!contextId || contextId === '0' || contextId.startsWith('error')) {
    throw new Error(`Login failed: ${logonPacket.payload}`);
  }

  ctx.setWorldContextId(contextId);
  ctx.log.debug(`[Session] Authenticated. Context RDO: ${contextId}`);

  // NOTE: Delphi fISProxy.BindTo(fClientViewId) is a LOCAL proxy operation (sets ObjectId
  // property on the proxy), NOT a network IDOF call. Sending IDOF with a numeric contextId
  // causes errIllegalObject (code 2) on the Delphi server and corrupts the connection state,
  // making ObjectsInArea/SegmentsInArea return empty results. Removed in fix for map loading bug.

  // 5. Retrieve User Properties — sequential (legacy client sends one at a time)
  const mailPacket = await ctx.sendRdoRequest('world', rdoGet('MailAccount', contextId).packet, undefined, TimeoutCategory.FAST);
  ctx.setMailAccount(parsePropertyResponseHelper(mailPacket.payload!, 'MailAccount'));
  ctx.log.debug(`[Session] MailAccount: ${ctx.currentWorldInfo?.name}`);

  const tycoonPacket = await ctx.sendRdoRequest('world', rdoGet('TycoonId', contextId).packet, undefined, TimeoutCategory.FAST);
  const tycoonId = parsePropertyResponseHelper(tycoonPacket.payload!, 'TycoonId');
  ctx.setTycoonId(tycoonId);

  const cnntPacket = await ctx.sendRdoRequest('world', rdoGet('RDOCnntId', contextId).packet, undefined, TimeoutCategory.FAST);
  const rdoCnntId = parsePropertyResponseHelper(cnntPacket.payload!, 'RDOCnntId');
  ctx.setRdoCnntId(rdoCnntId);

  // 6. Setup InitClient waiter BEFORE RegisterEventsById
  ctx.setWaitingForInitClient(true);
  const initClientPromise = new Promise<void>((resolve) => {
    ctx.setInitClientResolver(resolve);
  });
  ctx.setInitClientReceived(initClientPromise);

  // 7. Register Events - This triggers server's "C <rid> idof InterfaceEvents"
  // IMPORTANT: Don't await this! The server sends InitClient push BEFORE responding
  ctx.sendRdoRequest('world', rdoCall(
    'RegisterEventsById', contextId,
    RdoValue.int(parseInt(rdoCnntId, 10)),
  ).packet, undefined, TimeoutCategory.NORMAL).catch(() => {
    ctx.log.debug(`[Session] RegisterEventsById completed (or timed out, which is normal)`);
  });

  // CRITICAL: Wait for server to send InitClient push command (with timeout)
  ctx.log.debug(`[Session] Waiting for server InitClient push...`);
  let initTimeoutHandle: ReturnType<typeof setTimeout>;
  const initClientTimeout = new Promise<never>((_, reject) =>
    initTimeoutHandle = setTimeout(() => reject(new Error('InitClient push timeout after 15s')), 15000),
  );
  await Promise.race([initClientPromise, initClientTimeout]);
  clearTimeout(initTimeoutHandle!);
  ctx.log.debug(`[Session] InitClient received, continuing...`);

  // 7b. Only now may the world pool hold connections. Everything above binds
  // the server-side session to the connection that carried it: `get RDOCnntId`
  // is answered with the id of the carrying connection
  // (RDOQueryServer.pas:269-274) and RegisterEventsById binds the TClientView to
  // it as push channel and teardown trigger (InterfaceServer.pas:1919-1923). A
  // pool populated before this point can carry those frames.
  ctx.populateWorldPool();

  // 8. SetLanguage - CLIENT sends this as PUSH command (no RID)
  const socket = ctx.getSocket('world');
  if (socket) {
    const setLangCmd = rdoCall('SetLanguage', contextId, RdoValue.string('0')).toFrame();
    writeRdoFrame(socket, setLangCmd);
    ctx.log.debug(`[Session] Sent SetLanguage push command`);
  }

  // 9. GetCompanyCount
  const companyCountPacket = await ctx.sendRdoRequest('world', rdoGet('GetCompanyCount', contextId).packet, undefined, TimeoutCategory.FAST);
  const companyCountStr = parsePropertyResponseHelper(companyCountPacket.payload!, 'GetCompanyCount');
  const companyCount = parseInt(companyCountStr, 10) || 0;
  ctx.log.debug(`[Session] Company Count: ${companyCount}`);

  // 10. Fetch companies via HTTP for UI
  const httpResult = await fetchCompaniesViaHttp(ctx, world.ip, username);

  let companies: CompanyInfo[] = [];
  let loginPage: LoginPageOutcome | undefined;

  if (httpResult.kind === 'companies') {
    companies = httpResult.companies;
    if (companyCount > 0 && companies.length === 0) {
      ctx.log.error(`[Session] GetCompanyCount says ${companyCount} but chooseCompany.asp listed none — company scrape failed`);
      loginPage = { kind: 'error', errorCode: 'COMPANY_LIST_MISMATCH' };
    }
  } else if (httpResult.kind === 'denied') {
    loginPage = { kind: 'denied', expiresOn: httpResult.expiresOn };
  } else if (httpResult.kind === 'error') {
    loginPage = { kind: 'error', errorCode: httpResult.errorCode };
  }
  // 'unreachable': companies stays [], loginPage stays undefined — as today.

  ctx.setAvailableCompanies(companies);

  ctx.log.info('Login phase complete. Waiting for company selection...');

  // NOTE: Phase remains WORLD_CONNECTING until selectCompany() is called
  return {
    contextId, tycoonId, companies,
    worldXSize: ctx.currentWorldInfo?.mapSizeX ?? null,
    worldYSize: ctx.currentWorldInfo?.mapSizeY ?? null,
    worldSeason: null, // worldSeason is set during fetchWorldProperties
    loginPage,
    admission,
  };
}

// ── Company Selection ───────────────────────────────────────────────────────

export async function selectCompany(ctx: LoginContext, companyId: string): Promise<void> {
  const worldContextId = ctx.worldContextId;
  if (!worldContextId) {
    throw new Error('Not logged into world');
  }

  ctx.log.debug(`[Session] Selecting company ID: ${companyId}`);

  // Store the selected company for ASP requests (bank, profile, etc.)
  const matched = ctx.getAvailableCompanies().find(c => c.id === companyId);
  if (matched) {
    ctx.setCurrentCompany(matched);
    ctx.log.debug(`[Session] Current company set: ${matched.name}`);
  }

  // 1. EnableEvents (set to -1 to activate).
  //    Explicit RdoValue.int: this used to lean on formatTypedToken's implicit
  //    numeric auto-typing for SET (O-L7). The bytes are identical ("#-1"), but
  //    the dependency was invisible — and a silent fallback to "%-1" would kill
  //    every push with no error anywhere.
  const enableEvents = await ctx.sendRdoRequest('world', rdoSet('EnableEvents', worldContextId, RdoValue.int(-1)).packet, undefined, TimeoutCategory.NORMAL);
  // P-L1: the reply used to be discarded. Combined with P-M3 — no call site
  // reads errorCode — an error here was indistinguishable from success, and
  // this is the call that turns pushes ON. Failing it silently produces the
  // exact symptom O-H1 produced: a session that looks connected, loads the map,
  // and never updates again. Cheap to check, and the only place it can be.
  if (enableEvents.errorCode && enableEvents.errorCode > 0) {
    throw new Error(
      `EnableEvents failed (${enableEvents.errorName ?? 'error'} ${enableEvents.errorCode}) — ` +
      `the session would receive no pushes at all`
    );
  }
  ctx.log.debug(`[Session] EnableEvents activated`);

  // 2. First PickEvent - Subscribe to Tycoon updates
  // Delphi: TClientView.PickEvent(TycoonId: integer) — must be "#" int, not "%" string
  await ctx.sendRdoRequest('world', rdoCall(
    'PickEvent', worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId!, 10)),
  ).packet, undefined, TimeoutCategory.NORMAL);
  ctx.log.debug(`[Session] PickEvent #1 sent`);

  // 3. Get Tycoon Cookies — sequential (legacy client sends one at a time)
  // Delphi: GetTycoonCookie(TycoonId: integer; CookieId: widestring)
  const lastYPacket = await ctx.sendRdoRequest('world', rdoCall(
    'GetTycoonCookie', worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId!, 10)),
    RdoValue.string('LastY.0'),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const lastY = parsePropertyResponseHelper(lastYPacket.payload!, 'res');
  ctx.setLastPlayerY(parseInt(lastY, 10) || 0);
  ctx.log.debug(`[Session] Cookie LastY.0: ${lastY}`);

  const lastXPacket = await ctx.sendRdoRequest('world', rdoCall(
    'GetTycoonCookie', worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId!, 10)),
    RdoValue.string('LastX.0'),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const lastX = parsePropertyResponseHelper(lastXPacket.payload!, 'res');
  ctx.setLastPlayerX(parseInt(lastX, 10) || 0);
  ctx.log.debug(`[Session] Cookie LastX.0: ${lastX}`);

  const allCookiesPacket = await ctx.sendRdoRequest('world', rdoCall(
    'GetTycoonCookie', worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId!, 10)),
    RdoValue.string(''),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const allCookies = parsePropertyResponseHelper(allCookiesPacket.payload!, 'res');
  ctx.log.debug(`[Session] All Cookies:\n${allCookies}`);

  // 4. ClientAware - Notify ready (first call)
  const socket = ctx.getSocket('world');
  if (socket) {
    const clientAwareCmd = rdoCall('ClientAware', worldContextId).toFrame();
    writeRdoFrame(socket, clientAwareCmd);
    ctx.log.debug(`[Session] Sent ClientAware #1`);
  }

  // 5. Second PickEvent
  await ctx.sendRdoRequest('world', rdoCall(
    'PickEvent', worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId!, 10)),
  ).packet, undefined, TimeoutCategory.NORMAL);
  ctx.log.debug(`[Session] PickEvent #2 sent`);

  // 6. Second ClientAware
  if (socket) {
    const clientAwareCmd2 = rdoCall('ClientAware', worldContextId).toFrame();
    writeRdoFrame(socket, clientAwareCmd2);
    ctx.log.debug(`[Session] Sent ClientAware #2`);
  }

  // NOW the session is fully ready for game
  ctx.setPhase(SessionPhase.WORLD_CONNECTED);

  // Start ServerBusy polling and GC sweep now that we're fully connected
  ctx.startServerBusyPolling();
  ctx.startGcSweep();

  ctx.log.info(`Company ${companyId} selected - Ready for game!`);
}

// ── Company Creation ────────────────────────────────────────────────────────

export async function createCompany(
  ctx: LoginContext,
  companyName: string,
  cluster: string,
): Promise<{ success: boolean; companyName: string; companyId: string; message?: string }> {
  if (!ctx.worldContextId) {
    return { success: false, companyName: '', companyId: '', message: 'Not connected to world' };
  }

  const username = ctx.cachedUsername || '';
  ctx.log.debug(`[Session] Creating company: "${companyName}" in cluster "${cluster}" for user "${username}"`);

  try {
    // InterfaceServer.NewCompany(name, cluster) — only 2 args.
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'NewCompany', ctx.worldContextId,
      RdoValue.string(companyName),
      RdoValue.string(cluster),
    ).packet, undefined, TimeoutCategory.VERY_SLOW);

    const payload = packet.payload || '';
    ctx.log.debug(`[Session] NewCompany response: ${payload}`);

    // Response is always a widestring:
    //   Success: res="%[CompanyName,CompanyId]"
    //   Error:   res="%<errorCode>"
    const resMatch = /res="%(.*)"/.exec(payload);
    if (resMatch) {
      const resultStr = resMatch[1];

      // Success: "[Name,Id]"
      const companyMatch = /^\[(.+),(\d+)]$/.exec(resultStr);
      if (companyMatch) {
        const newName = companyMatch[1];
        const newId = companyMatch[2];
        ctx.log.info(`[Session] Company created: "${newName}" (ID: ${newId})`);
        ctx.pushAvailableCompany({ id: newId, name: newName, ownerRole: username });
        return { success: true, companyName: newName, companyId: newId };
      }

      // Error: numeric error code as string
      const errorCode = parseInt(resultStr, 10);
      if (!isNaN(errorCode)) {
        // TWorld.RDONewCompany, Kernel/World.pas:4110-4184; values Protocol/Protocol.pas:30-43.
        const errorMessages: Record<number, string> = {
          1: 'Server error while creating the company',                               // :4179 ERROR_Unknown
          6: 'Unknown cluster',                                                        // :4172
          7: 'Your tycoon level is too low for this seal, or you already own 26 companies', // :4146/:4170, MaxCompaniesAllowed World.pas:31
          11: 'Company name already taken',                                            // :4174
          14: 'That name is invalid or longer than 50 characters',                     // :4133/:4181 (also :4168)
        };
        const msg = errorMessages[errorCode] || `Failed with error code ${errorCode}`;
        ctx.log.warn(`[Session] Company creation failed: ${msg}`);
        return { success: false, companyName: '', companyId: '', message: msg };
      }

      // Non-numeric, non-bracket string — unexpected
      ctx.log.warn(`[Session] Unexpected NewCompany result: "${resultStr}"`);
      return { success: false, companyName: '', companyId: '', message: `Unexpected result: ${resultStr}` };
    }

    // Fallback: integer-typed error
    const intMatch = /res="#(-?\d+)"/.exec(payload);
    if (intMatch) {
      const errorCode = parseInt(intMatch[1], 10);
      ctx.log.warn(`[Session] Company creation failed with integer error: ${errorCode}`);
      return { success: false, companyName: '', companyId: '', message: `Failed with error code ${errorCode}` };
    }

    ctx.log.warn(`[Session] Unexpected NewCompany payload: ${payload}`);
    return { success: false, companyName: '', companyId: '', message: 'Unexpected response from server' };
  } catch (e: unknown) {
    ctx.log.error('[Session] Failed to create company:', e);
    return { success: false, companyName: '', companyId: '', message: toErrorMessage(e) };
  }
}

// ── Company Switching ───────────────────────────────────────────────────────

export async function switchCompany(ctx: LoginContext, company: CompanyInfo): Promise<void> {
  if (!ctx.currentWorldInfo || !ctx.cachedPassword) {
    throw new Error('Cannot switch company: world or credentials not available');
  }

  ctx.log.debug(`[Session] Switching to company: ${company.name} (ownerRole: ${company.ownerRole})`);

  // Store the company we're switching to
  ctx.setCurrentCompany(company);

  // Determine the username to use for login
  const loginUsername = company.ownerRole || ctx.cachedUsername || '';

  // Update the active identity so ASP page fetches use the correct tycoon
  ctx.setActiveUsername(loginUsername);

  if (company.ownerRole && company.ownerRole !== ctx.cachedUsername) {
    ctx.log.debug(`[Session] Role-based login detected: switching from "${ctx.cachedUsername}" to role "${company.ownerRole}"`);
  }

  // Stop cacher KeepAlive before closing sockets
  ctx.stopCacherKeepAlive();

  // Close existing sockets except directory
  ctx.log.debug('[Session] Closing existing world connections for company switch...');
  const socketsToClose = ctx.getSocketNames().filter(name => name !== 'directory_auth' && name !== 'directory_query');

  for (const socketName of socketsToClose) {
    ctx.removeAllSocketListeners(socketName);
    ctx.destroySocket(socketName);
    ctx.deleteSocket(socketName);
    ctx.deleteFramer(socketName);
  }

  // Reset session state
  ctx.setWorldContextId(null);
  ctx.setTycoonId(null);
  ctx.setInterfaceServerId(null);
  ctx.setRdoCnntId(null);
  ctx.setCacherId(null);
  ctx.setWorldId(null);
  ctx.setDaPort(null);
  ctx.clearAspActionCache();
  ctx.clearBuildingFocus();

  // Re-login to world with the role username
  const result = await loginWorld(ctx, loginUsername, ctx.cachedPassword!, ctx.currentWorldInfo);

  ctx.log.debug(`[Session] Re-logged in as "${loginUsername}", contextId: ${result.contextId}`);
  ctx.log.debug(`[Session] After switchCompany - interfaceServerId: ${ctx.interfaceServerId}, worldId: ${ctx.worldId}`);

  // Ensure the target company exists in the refreshed list — the ASP endpoint
  // may serve a cached response that does not yet include a freshly created company.
  const exists = ctx.getAvailableCompanies().find(c => c.id === company.id);
  if (!exists) {
    ctx.log.warn(`[Session] Company "${company.name}" (${company.id}) missing from refreshed list — re-injecting`);
    ctx.pushAvailableCompany(company);
  }

  // Small delay to ensure socket is fully ready before selecting company
  await new Promise(resolve => setTimeout(resolve, 200));

  // Select the specific company
  await selectCompany(ctx, company.id);

  ctx.log.debug(`[Session] Company switch complete - now playing as ${company.name}`);
}

// ── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch world properties from InterfaceServer (9 sequential GET commands).
 *
 * The list and its order follow Voyager's own sweep
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1043-1051`), with one deliberate
 * omission: `DSArea`. Voyager reads it only to persist `Root/Areas/<area>/Worlds/
 * <world>/Interface` in its local registry so a later sign-in can re-find the
 * Interface Server without the world list (`:2610`, `LogonHandlerViewer.pas:554`).
 * The gateway resolves that address from the Directory Server on every login, so it
 * has no key to cache and no use for the area name.
 */
async function fetchWorldProperties(ctx: LoginContext, interfaceServerId: string): Promise<void> {
  const props = [
    'WorldName', 'WorldURL', 'DAAddr', 'DALockPort',
    'MailAddr', 'MailPort', 'WorldXSize', 'WorldYSize', 'WorldSeason',
  ] as const;

  for (const prop of props) {
    // Pre-login property reads on the InterfaceServer — the legacy proxy's
    // DefTimeOut = 60 s window, before ISProxyTimeOut takes over in play.
    const packet = await ctx.sendRdoRequest('world', rdoGet(
      prop, interfaceServerId,
    ).packet, undefined, TimeoutCategory.FAST);
    const value = parsePropertyResponseHelper(packet.payload!, prop);
    ctx.log.debug(`[Session] ${prop}: ${value}`);

    if (prop === 'WorldName' && value && ctx.currentWorldInfo) {
      const wi = { ...ctx.currentWorldInfo, name: value };
      ctx.setCurrentWorldInfo(wi);
    }
    if (prop === 'DAAddr') ctx.setDaAddr(value);
    // The `DAPort` this feeds is the one the ASP pages receive, and Voyager fills it
    // from the Interface Server's `DALockPort`, never from its `DAPort`
    // (`Voyager/URLHandlers/ServerCnxHandler.pas:1046`, `:2756` — and both
    // `getDAPort` and `getDALockPort` return that same field, `:2469-2477`).
    // The two are different sockets on the Model Server: `DAPort` is the 8-thread
    // channel the Interface Server keeps for itself, `DALockPort` is `DAPort + 1`,
    // a 1-thread serialising listener opened for outside callers
    // (`Interface Server/InterfaceServer.pas:2639-2640`,
    // `Model Server/ModelServer.pas:1256`, `:1258`).
    if (prop === 'DALockPort') ctx.setDaPort(parseInt(value, 10));
    if (prop === 'MailAddr') ctx.setMailAddr(value);
    if (prop === 'MailPort') ctx.setMailPort(parseInt(value, 10));
    if (prop === 'WorldXSize') {
      const xSize = parseInt(value, 10) || null;
      ctx.setWorldXSize(xSize);
      if (ctx.currentWorldInfo) {
        const wi = { ...ctx.currentWorldInfo, mapSizeX: xSize ?? undefined };
        ctx.setCurrentWorldInfo(wi);
      }
    }
    if (prop === 'WorldYSize') {
      const ySize = parseInt(value, 10) || null;
      ctx.setWorldYSize(ySize);
      if (ctx.currentWorldInfo) {
        const wi = { ...ctx.currentWorldInfo, mapSizeY: ySize ?? undefined };
        ctx.setCurrentWorldInfo(wi);
      }
    }
    if (prop === 'WorldSeason') ctx.setWorldSeason(parseSeasonValue(value));
  }
}

/**
 * Ask the Interface Server whether this player may found a company here —
 * `CanJoinWorldEx` (Interface Server/InterfaceServer.pas:441, :3471-3486), the call
 * logonComplete.asp:143-144 makes against `InterfaceServer` before the company page.
 * `-1` is a full world, a positive number is the nobility shortfall, `0` is "go ahead".
 * Anything else — timeout, an error reply from a server without the member, an
 * unparsable answer — returns undefined and the login proceeds exactly as before.
 */
async function checkWorldAdmission(
  ctx: LoginContext, interfaceServerId: string, username: string,
): Promise<WorldAdmission | undefined> {
  try {
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'CanJoinWorldEx', interfaceServerId,
      RdoValue.string(username),
    ).packet, undefined, TimeoutCategory.FAST);
    // An error reply normally rejects (config.rdo.errorContract defaults to
    // reject-except-stale), but in `observe` mode it arrives as a success packet
    // carrying errorCode — both paths degrade to today's flow.
    if (packet.errorCode && packet.errorCode > 0) {
      ctx.log.warn(`[Session] CanJoinWorldEx answered ${packet.errorName ?? 'error'} ${packet.errorCode} — proceeding without the admission check`);
      return undefined;
    }
    const raw = parsePropertyResponseHelper(packet.payload ?? '', 'res');
    const code = parseInt(raw, 10);
    ctx.log.debug(`[Session] CanJoinWorldEx: ${raw}`);
    if (code === -1) return { kind: 'full' };
    if (code > 0) return { kind: 'nobility', shortfall: code };
    return undefined;              // 0 (admitted) or NaN (unreadable): today's flow
  } catch (err: unknown) {
    ctx.log.warn(`[Session] CanJoinWorldEx failed — proceeding without the admission check: ${toErrorMessage(err)}`);
    return undefined;
  }
}

/**
 * Ask the Directory Server whether this account may join ANOTHER world —
 * `RDOCanJoinNewWorld(Alias)` (DServer/DirectoryServer.pas:116, a 1-arg `function`),
 * body `:1217-1234`: a boolean olevariant, `#-1` may join / `#0` at the nobility-bound
 * world limit, or `DIR_ERROR_Unknown` on exception. `logonComplete.asp:100-106` asked it
 * in a bare directory session before any Interface Server check. Only a literal `0` is a
 * refusal (Kernel/World.pas:6031-6033 reads the variant the same way); an error reply, a
 * timeout or an unreadable answer returns null and the login proceeds exactly as before.
 * Returns true when the player IS at the limit.
 */
async function checkWorldLimit(ctx: LoginContext, sessionId: string, username: string): Promise<boolean | null> {
  try {
    const packet = await sendDirectoryRequest(ctx, 'directory_query', rdoCall(
      'RDOCanJoinNewWorld', sessionId,
      RdoValue.string(username),
    ).packet);
    if (packet.errorCode && packet.errorCode > 0) {
      ctx.log.warn(`[Session] RDOCanJoinNewWorld answered ${packet.errorName ?? 'error'} ${packet.errorCode} — proceeding without the world-limit check`);
      return null;
    }
    const raw = parsePropertyResponseHelper(packet.payload ?? '', 'res');
    const code = parseInt(raw, 10);
    ctx.log.debug(`[Session] RDOCanJoinNewWorld: ${raw}`);
    if (Number.isNaN(code)) {
      ctx.log.warn(`[Session] RDOCanJoinNewWorld answered "${raw}" — proceeding without the world-limit check`);
      return null;
    }
    return code === 0;
  } catch (err: unknown) {
    ctx.log.warn(`[Session] RDOCanJoinNewWorld failed — proceeding without the world-limit check: ${toErrorMessage(err)}`);
    return null;
  }
}

type FetchCompaniesResult =
  | { kind: 'companies'; companies: CompanyInfo[]; realContextId: string | null }
  | { kind: 'denied'; expiresOn: string }
  | { kind: 'error'; errorCode: string }
  | { kind: 'unreachable' };

/**
 * Fetch companies via HTTP (ASP endpoint)
 */
async function fetchCompaniesViaHttp(
  ctx: LoginContext,
  worldIp: string,
  username: string,
): Promise<FetchCompaniesResult> {
  const params = new URLSearchParams({
    frame_Id: 'LogonView',
    frame_Class: 'HTMLView',
    frame_Align: 'client',
    ResultType: 'NORMAL',
    Logon: 'FALSE',
    frame_NoBorder: 'True',
    frame_NoScrollBars: 'true',
    ClientViewId: '0',
    WorldName: ctx.currentWorldInfo?.name || 'Shamba',
    UserName: username,
    DSAddr: config.rdo.directoryHost,
    DSPort: String(config.rdo.ports.directory),
    ISAddr: worldIp,
    ISPort: '8000',
    LangId: '0',
  });

  const url = `http://${worldIp}/Five/0/Visual/Voyager/NewLogon/logonComplete.asp?${params.toString().replace(/\+/g, '%20')}`;
  ctx.log.debug(`[HTTP] Fetching companies from ${url}`);

  try {
    const response = await fetchWithTimeout(url, { redirect: 'follow' });
    const text = await response.text();
    const finalUrl = response.url;
    const finalUrlLower = finalUrl.toLowerCase();

    if (finalUrlLower.includes('/logonnoaccess.asp')) {
      const paMatch = /[?&]PA=([^&]*)/i.exec(finalUrl);
      const expiresOn = paMatch ? decodeURIComponent(paMatch[1]) : '';
      ctx.log.warn(`[HTTP] Login denied by logonNoAccess.asp — access expired on ${expiresOn}`);
      return { kind: 'denied', expiresOn };
    }

    if (finalUrlLower.includes('/logonerror.asp')) {
      const errorMatch = /[?&]ErrorCode=([^&]*)/i.exec(finalUrl);
      const errorCode = errorMatch ? decodeURIComponent(errorMatch[1]) : 'UNKNOWN';
      ctx.log.warn(`[HTTP] Login rejected by logonError.asp — ${errorCode}`);
      return { kind: 'error', errorCode };
    }

    // Extract ClientViewId (priority: URL > body)
    let realId: string | null = null;
    const matchUrl = /ClientViewId=(\d+)/i.exec(finalUrl);
    if (matchUrl) realId = matchUrl[1];

    if (!realId) {
      const matchBody = /ClientViewId=(\d+)/i.exec(text);
      if (matchBody) realId = matchBody[1];
    }

    // Parse companies with regex
    const companies: CompanyInfo[] = [];
    const tdRegex = /<td[^>]*companyId="(\d+)"[^>]*>/gi;
    let tdMatch;

    while ((tdMatch = tdRegex.exec(text)) !== null) {
      const companyId = tdMatch[1];
      const tdElement = tdMatch[0];

      const nameMatch = /companyName="([^"]+)"/i.exec(tdElement);
      const companyName = nameMatch ? nameMatch[1] : `Company ${companyId}`;

      const roleMatch = /companyOwnerRole="([^"]*)"/i.exec(tdElement);
      const ownerRole = roleMatch ? roleMatch[1] : username;

      ctx.log.debug(`[HTTP] Company parsed - ID: ${companyId}, Name: ${companyName}, ownerRole: ${ownerRole} ${roleMatch ? '(from HTML)' : '(defaulted to username)'}`);

      companies.push({ id: companyId, name: companyName, ownerRole });
    }

    ctx.log.debug(`[HTTP] Found ${companies.length} companies, realContextId: ${realId}`);
    return { kind: 'companies', companies, realContextId: realId };
  } catch (e: unknown) {
    ctx.log.error('[HTTP] Failed to fetch companies:', e);
    return { kind: 'unreachable' };
  }
}

/**
 * Parse directory query result into WorldInfo array.
 */
function parseDirectoryResult(ctx: LoginContext, payload: string): WorldInfo[] {
  let raw = payload.trim();
  raw = raw.replace(RDO_PREFIX_STRIP, '');
  const lines = raw.split(/\n/);
  const data: Map<string, string> = new Map();

  for (const line of lines) {
    if (!line.includes('=')) continue;
    const parts = line.split('=');
    const key = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join('=').trim();
    data.set(key, value);
  }

  const countStr = data.get('count');
  if (!countStr) {
    ctx.log.warn('[Session] Directory Parse Error: "count" key not found in response.');
    ctx.log.warn('[Session] First 5 keys:', Array.from(data.keys()).slice(0, 5));
    return [];
  }

  const count = parseInt(countStr, 10);
  const worlds: WorldInfo[] = [];

  for (let i = 0; i < count; i++) {
    const name = data.get(`key${i}`) || 'Unknown';
    const url = data.get(`interface/url${i}`) || '';
    const ip = data.get(`interface/ip${i}`) || '127.0.0.1';
    const port = parseInt(data.get(`interface/port${i}`) || '0', 10);
    const date = data.get(`general/date${i}`);
    const population = parseInt(data.get(`general/population${i}`) || '0', 10);
    const investors = parseInt(data.get(`general/investors${i}`) || '0', 10);
    const online = parseInt(data.get(`general/online${i}`) || '0', 10);
    const runningStr = data.get(`interface/running${i}`) || '';
    const running3 = runningStr.toLowerCase() === 'true';

    if (port === 0) continue;

    worlds.push({
      name, url, ip, port,
      season: date,
      date: date,
      population,
      investors,
      online,
      players: online,
      mapSizeX: 0,
      mapSizeY: 0,
      running3,
    });
  }

  return worlds;
}

/**
 * Parse RDOSearchKey results (Count=N, Key0=key0, Alias0=alias0, Key1=..., ...)
 * — names come from `Alias<i>`, the value the ASP reads (DirectoryServer.wsc:866).
 */
function parseSearchKeyResults(ctx: LoginContext, payload: string): string[] {
  let raw = payload.trim();
  raw = raw.replace(RDO_PREFIX_STRIP, '');
  if (!raw) return [];
  const lines = raw.split(/\n/);
  const data: Map<string, string> = new Map();

  for (const line of lines) {
    if (!line.includes('=')) continue;
    const parts = line.split('=');
    const key = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join('=').trim();
    data.set(key, value);
  }

  const countStr = data.get('count');
  if (!countStr) {
    ctx.log.warn('[Session] SearchKey: no "count" key in response');
    return [];
  }

  const count = parseInt(countStr, 10);
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    const name = data.get(`alias${i}`);
    if (name) names.push(name);
  }

  return names;
}

// ── World Socket Reconnection ────────────────────────────────────────────────

/**
 * Reconnect the world socket: new TCP socket + IDOF + full re-Logon.
 *
 * There is deliberately no "light" path. See the comment at step 3 — the probe
 * that used to select it cannot fail, because the Delphi ClientView survives its
 * own logoff (O-H1).
 */
export async function reconnectWorldSocket(ctx: LoginContext): Promise<void> {
  const world = ctx.currentWorldInfo;
  if (!world) throw new Error('No world info for reconnection');

  ctx.log.info(`[Reconnect] Connecting to ${world.ip}:${world.port}...`);

  // 1. Create new TCP socket
  await ctx.createSocket('world', world.ip, world.port);

  // 1b. Re-initialize world connection pool
  ctx.initWorldPool(world.ip, world.port);

  // 2. Re-resolve InterfaceServer IDOF (may have changed after server restart)
  const idPacket = await ctx.sendRdoRequest('world', rdoIdOf('InterfaceServer').packet, undefined, TimeoutCategory.FAST);
  const newId = parseIdOfResponseHelper(idPacket.payload);
  ctx.setInterfaceServerId(newId);
  ctx.log.debug(`[Reconnect] InterfaceServer ID: ${newId}`);

  // 3. Always re-Logon. There is no correct cheap path, and the cheap path we
  //    had was worse than useless: it reported success while leaving the player
  //    invisible.
  //
  //    The old code probed the OLD ClientViewId with `get TycoonId` and took a
  //    "light" path when it answered. That probe cannot fail. On disconnect,
  //    TInterfaceServer.Logoff (InterfaceServer.pas:3296-3331) does:
  //        fClients.Extract(ClientView);              // :3314 — Extract, not Remove
  //        ClientView.fClientEventsProxy := Unassigned;  // :3317
  //        ClientView.fClientConnection  := nil;         // :3318
  //        //ClientView.Free;                            // :3326 — COMMENTED OUT
  //    so the object is leaked but alive. `get TycoonId` reads a plain field and
  //    answers normally, essentially always — while we have already been removed
  //    from fClients, which is the list the IS iterates to deliver pushes.
  //
  //    Result: the map loaded, buildings opened, and nothing ever updated again;
  //    other players could not see us; and the gateway announced
  //    EVENT_WORLD_RECONNECTED. No published member exposes fClients membership,
  //    so no cheaper probe can be made reliable. The legacy client re-Logons
  //    every time (ServerCnxHandler.pas:3407-3473); so do we now.
  //
  //    This also removes O-H2: the light path re-used the RDOCnntId read from the
  //    OLD socket, and that id is the memory address of the socket object
  //    (WinSockRDOConnectionsServer.pas:664-668). Best case it matched nothing;
  //    worst case Delphi had recycled the address for another client's socket and
  //    our pushes went down their wire.
  //    fullWorldRelogin re-reads RDOCnntId from the NEW socket and re-runs
  //    RegisterEventsById, SetLanguage and selectCompany (which carries
  //    EnableEvents and PickEvent), so the light path's steps 4-7 were not just
  //    redundant — they replayed those calls against stale ids.
  await fullWorldRelogin(ctx);
}

/**
 * Full re-login: Logon + RegisterEvents + re-select company.
 * Used when server-side session has expired during disconnect.
 */
async function fullWorldRelogin(ctx: LoginContext): Promise<void> {
  const username = ctx.cachedUsername;
  const password = ctx.cachedPassword;
  if (!username || !password) throw new Error('No cached credentials for re-login');

  const interfaceServerId = ctx.interfaceServerId;
  if (!interfaceServerId) throw new Error('No interfaceServerId for re-login');

  // Logon
  const logonPacket = await ctx.sendRdoRequest('world', rdoCall(
    'Logon', interfaceServerId,
    RdoValue.string(username),
    RdoValue.string(password),
  ).packet, undefined, TimeoutCategory.NORMAL);

  let contextId = cleanPayloadHelper(logonPacket.payload!);
  if (contextId.includes('res')) {
    contextId = parsePropertyResponseHelper(logonPacket.payload!, 'res');
  }
  if (!contextId || contextId === '0') throw new Error('Re-login failed');

  ctx.setWorldContextId(contextId);

  // Re-read essential properties
  const tycoonPacket = await ctx.sendRdoRequest('world', rdoGet('TycoonId', contextId).packet, undefined, TimeoutCategory.FAST);
  ctx.setTycoonId(parsePropertyResponseHelper(tycoonPacket.payload!, 'TycoonId'));

  const cnntPacket = await ctx.sendRdoRequest('world', rdoGet('RDOCnntId', contextId).packet, undefined, TimeoutCategory.FAST);
  ctx.setRdoCnntId(parsePropertyResponseHelper(cnntPacket.payload!, 'RDOCnntId'));

  // Re-register the InterfaceEvents virtual object BEFORE RegisterEventsById.
  // attemptWorldReconnect clears knownObjects, and RegisterEventsById makes the
  // server turn around and ask us `idof "InterfaceEvents"` — if we cannot
  // resolve it, that handshake dies and InitClient never arrives. The initial
  // login path registers it first for exactly this reason (see :348-351).
  // This lives here rather than in the caller so every path into re-login is
  // correct: the old `catch` branch called this function without it.
  const virtualEventId = (Math.floor(Math.random() * 6000000) + 38000000).toString();
  ctx.setKnownObject('InterfaceEvents', virtualEventId);
  ctx.log.debug(`[Reconnect] InterfaceEvents virtual ID: ${virtualEventId}`);

  // RegisterEvents + SetLanguage
  const rdoCnntId = ctx.rdoCnntId;
  if (rdoCnntId) {
    ctx.sendRdoRequest('world', rdoCall(
      'RegisterEventsById', contextId,
      RdoValue.int(parseInt(rdoCnntId, 10)),
    ).packet, undefined, TimeoutCategory.NORMAL).catch(() => {
      ctx.log.debug('[Reconnect] RegisterEventsById completed (or timed out, normal)');
    });
  }

  // Same ordering rule as the initial login: the pool stays empty until the
  // session is bound to the new primary socket. initWorldPool() above only
  // reconstructed it — reconnection drained the old connections precisely
  // because they belonged to a session that no longer exists.
  ctx.populateWorldPool();

  const socket = ctx.getSocket('world');
  if (socket) {
    const setLangCmd = rdoCall('SetLanguage', contextId, RdoValue.string('0')).toFrame();
    writeRdoFrame(socket, setLangCmd);
  }

  // Re-select company if one was active
  const company = ctx.currentCompany;
  if (company) {
    await selectCompany(ctx, company.id);
  }

  ctx.log.info(`[Reconnect] Full re-login complete (contextId=${contextId})`);
}
