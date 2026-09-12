/**
 * Fake `SessionContext` factory — the single shared test double of the RDO
 * coverage mission.
 *
 * Handlers in `src/server/session/` never see the full `StarpeaceSession`: they
 * receive the narrow `SessionContext` interface. That is the injection point, so
 * a handler is driven by handing it a fake context and reading back what it did.
 *
 * WHY IT IS SHARED. Four test files already grew their own `makeCtx()` and they
 * have diverged on the one thing that must not vary — how a frame is read off
 * the socket. `building-mutations.test.ts:35-40` decodes the Buffer as latin1;
 * `mail-handler-emission.test.ts:30` does `write: () => true` and throws the
 * frame away, so it can assert nothing about the fire-and-forget `"*"` channel.
 * Latin-1 is the codec of the whole `writeRdoFrame` path (`rdo-helpers.ts:80`,
 * `RDOUtils.pas` WideStrToStr): it is an invariant of the protocol, not a detail
 * each test file gets to re-decide.
 *
 * WHAT IT IS NOT. A factory, not a framework. It has no scenario DSL, it never
 * infers a response from the member being called, and it holds no state between
 * tests. A fake clever enough to make a test pass for the wrong reason costs
 * more than it saves.
 *
 * DEFAULTS ARE PLUMBING ONLY — log sinks, sockets, context ids. No business
 * value is ever supplied: `cacherGetPropertyList`, `focusBuilding`,
 * `fetchAspPage` & co. are bare `jest.fn()` with NO implementation, so a test
 * that forgot to declare what the server answers fails loudly instead of
 * quietly picking up someone else's fixture.
 *
 * Excluded from coverage (`!src/**\/__tests__/**` in `jest.config.js`) and not
 * matched by `testMatch`: this is neither production code nor a test. Same
 * standing as `__tests__/protocol-validation/protocol-test-harness.ts`.
 */

import type { Socket } from 'net';
import type { RdoPacket, WorldInfo, CompanyInfo, ChatUser, BuildingDetailsResponse } from '../../../shared/types';
import { SessionPhase } from '../../../shared/types';
import type { TimeoutCategory } from '../../../shared/timeout-categories';
import type { AspActionUrl } from '../../asp-url-extractor';
import type { SessionContext } from '../../session/session-context';
import type { PushContext } from '../../session/push-dispatcher';
import type { LoginContext } from '../../session/login-handler';

// ── What the fake records ───────────────────────────────────────────────────

/** One `sendRdoRequest()` call, exactly as the handler issued it. */
export interface SentRequest {
  socketName: string;
  packet: Partial<RdoPacket>;
  timeoutMs: number | undefined;
  category: TimeoutCategory;
}

/**
 * How the fake answers a synchronous request.
 *
 * - a `string` is taken as the response payload (`res="#0"`, `objid="…"`, …);
 * - an `RdoPacket` is returned as-is, for the rare test that needs `errorCode`;
 * - an `Error` is REJECTED, which is how the timeout and server-error branches
 *   are reached — production rejects with `Error('Request timeout: <member>')`
 *   (`spo_session.ts:2403`) or with `RdoServerError` (`rdo-error-contract.ts`).
 *
 * `callIndex` is 0-based and lets a responder answer a sequence differently
 * without the fake having to know anything about members.
 */
export type Responder = (packet: Partial<RdoPacket>, callIndex: number) => string | RdoPacket | Error;

/** The default answers nothing at all — see the header note on defaults. */
const EMPTY_RESPONDER: Responder = () => '';

/**
 * Session ids handed to the fake context.
 *
 * Deliberately distinct from one another and from any value a test is likely to
 * pass as an argument: a handler that hardcodes an id, or swaps two of them,
 * then shows up as a wrong target on the wire instead of matching by accident.
 * Values are shaped like the live captures.
 */
export const FAKE_CONTEXT_IDS = {
  worldContextId: '8161308',
  interfaceServerId: '44917624',
  /**
   * The persistent `TTycoon.Id` off the Interface Server's ClientView
   * (Interface Server/InterfaceServer.pas:128,3237). Deliberately unrelated to
   * {@link tycoonProxyId} so a test that confuses the two fails loudly.
   */
  tycoonId: '4666201923',
  /**
   * The model server's pointer to the TTycoon, pushed by InitClient
   * (InterfaceServer.pas:1835) and originally `integer(Tycoon)`
   * (Kernel/World.pas:3827). This is what a member that dereferences a tycoon
   * must receive.
   */
  tycoonProxyId: 30440112,
  cacherId: '40133496',
  worldId: '30430748',
  mailServerId: '51002448',
  mailIntServerId: '51002449',
} as const;

// ── Socket capture ──────────────────────────────────────────────────────────

/**
 * A socket that keeps every frame written to it, decoded from latin1.
 *
 * `writeRdoFrame()` hands `socket.write()` a Buffer built with
 * `Buffer.from(clampToWireBytes(frame), 'latin1')`. Decoding it back with the
 * same codec is what makes an assertion on accented text meaningful; decoding
 * as UTF-8, or not decoding at all, tests something production does not do.
 */
function createCaptureSocket(sink: string[]): Socket {
  const socket = {
    write(chunk: Buffer | string): boolean {
      sink.push(Buffer.isBuffer(chunk) ? chunk.toString('latin1') : chunk);
      return true;
    },
    end(): void { /* no-op */ },
    destroy(): void { /* no-op */ },
    removeAllListeners(): void { /* no-op */ },
    destroyed: false,
  };
  return socket as unknown as Socket;
}

// ── SessionContext ──────────────────────────────────────────────────────────

/** Mock handles on the cacher object pool, for `expect(...)` and configuration. */
export interface CacherMocks {
  createObject: jest.MockedFunction<SessionContext['cacherCreateObject']>;
  setObject: jest.MockedFunction<SessionContext['cacherSetObject']>;
  setPath: jest.MockedFunction<SessionContext['cacherSetPath']>;
  getPropertyList: jest.MockedFunction<SessionContext['cacherGetPropertyList']>;
  closeObject: jest.MockedFunction<SessionContext['cacherCloseObject']>;
}

export interface LogMocks {
  debug: jest.MockedFunction<SessionContext['log']['debug']>;
  info: jest.MockedFunction<SessionContext['log']['info']>;
  warn: jest.MockedFunction<SessionContext['log']['warn']>;
  error: jest.MockedFunction<SessionContext['log']['error']>;
  setField: jest.MockedFunction<SessionContext['log']['setField']>;
}

export interface FakeSessionCtx {
  /** Hand this to the handler under test. */
  ctx: SessionContext;
  /** Every `sendRdoRequest()`, in call order — the `"^"` channel. */
  sent: SentRequest[];
  /**
   * Every `writeRdoFrame()` frame, by socket name, decoded latin1 — the
   * fire-and-forget `"*"` channel. Pre-seeded with `[]` for each declared
   * socket, so `expect(frames.construction).toHaveLength(0)` states "nothing
   * was emitted" rather than tripping over `undefined`.
   */
  frames: Record<string, string[]>;
  /** Install the responder for subsequent `sendRdoRequest()` calls. */
  respond(fn: Responder): void;
  cacher: CacherMocks;
  log: LogMocks;
}

export interface FakeSessionOptions extends Partial<SessionContext> {
  /**
   * Socket names `getSocket()` resolves. Any other name yields `undefined` —
   * that is the "socket absente" branch, and it is the default for every name,
   * on purpose.
   */
  sockets?: string[];
}

/**
 * Build a fake `SessionContext`.
 *
 * Configure business answers on the returned mocks
 * (`fake.cacher.getPropertyList.mockResolvedValue([...])`, `fake.respond(...)`)
 * rather than through `overrides` where possible: `overrides` replaces the
 * method on `ctx`, and the `cacher` / `log` handles then point at whatever the
 * override installed, which is only usable if it is itself a `jest.fn()`.
 */
export function makeSessionCtx(overrides: FakeSessionOptions = {}): FakeSessionCtx {
  const { sockets = [], ...rest } = overrides;

  const sent: SentRequest[] = [];
  const frames: Record<string, string[]> = {};
  const socketsByName = new Map<string, Socket>();
  for (const name of sockets) {
    frames[name] = [];
    socketsByName.set(name, createCaptureSocket(frames[name]));
  }

  let responder: Responder = EMPTY_RESPONDER;
  let nextRid = 1;

  const base: SessionContext = {
    // ── RDO transport ────────────────────────────────────────────────────
    sendRdoRequest: jest.fn(async (
      socketName: string,
      packetData: Partial<RdoPacket>,
      timeoutMs: number | undefined,
      category: TimeoutCategory,
    ): Promise<RdoPacket> => {
      const callIndex = sent.length;
      sent.push({ socketName, packet: packetData, timeoutMs, category });
      const answer = responder(packetData, callIndex);
      if (answer instanceof Error) throw answer;
      const rid = packetData.rid ?? nextRid++;
      if (typeof answer === 'string') {
        return { raw: '', type: 'RESPONSE', rid, payload: answer };
      }
      return answer;
    }),

    getSocket: jest.fn((name: string) => socketsByName.get(name)),

    // ── Cacher object pool — no business defaults ────────────────────────
    cacherCreateObject: jest.fn(),
    cacherSetObject: jest.fn(async () => undefined),
    cacherSetPath: jest.fn(async () => undefined),
    cacherGetPropertyList: jest.fn(),
    cacherCloseObject: jest.fn(() => undefined),

    // ── ASP / HTTP ───────────────────────────────────────────────────────
    buildAspBaseParams: jest.fn(() => new URLSearchParams()),
    buildAspUrl: jest.fn((aspPath: string) => `asp:${aspPath}`),
    fetchAspPage: jest.fn(),

    // ── Service connections — plumbing, resolve quietly ──────────────────
    connectMapService: jest.fn(async () => undefined),
    connectConstructionService: jest.fn(async () => undefined),
    ensureMailConnection: jest.fn(async () => undefined),

    // ── Higher-level helpers — no business defaults ──────────────────────
    getCacherPropertyListAt: jest.fn(),
    focusBuilding: jest.fn(),
    manageConstruction: jest.fn(),

    // ── ASP action cache — empty, not absent ─────────────────────────────
    getAspActionCache: jest.fn(() => undefined),
    setAspActionCache: jest.fn(() => undefined),

    // ── In-flight dedup map ──────────────────────────────────────────────

    // ── Session state: ids are plumbing, everything else stays null ──────
    worldContextId: FAKE_CONTEXT_IDS.worldContextId,
    interfaceServerId: FAKE_CONTEXT_IDS.interfaceServerId,
    tycoonId: FAKE_CONTEXT_IDS.tycoonId,
    cacherId: FAKE_CONTEXT_IDS.cacherId,
    worldId: FAKE_CONTEXT_IDS.worldId,
    mailServerId: FAKE_CONTEXT_IDS.mailServerId,
    mailIntServerId: FAKE_CONTEXT_IDS.mailIntServerId,
    currentWorldInfo: null as WorldInfo | null,
    activeUsername: null,
    cachedUsername: null,
    cachedPassword: null,
    currentCompany: null as CompanyInfo | null,
    daAddr: null,
    daPort: null,
    mailAccount: null,
    worldXSize: null,
    worldYSize: null,
    fTycoonProxyId: FAKE_CONTEXT_IDS.tycoonProxyId as number | null,
    accountMoney: null,
    failureLevel: null,
    lastRanking: 0,
    lastBuildingCount: 0,
    lastMaxBuildings: 0,

    // ── Writable state ───────────────────────────────────────────────────
    setCurrentChannel: jest.fn((_channel: string) => undefined),
    setChatUsers: jest.fn((_users: Map<string, ChatUser>) => undefined),
    setAccountMoney: jest.fn((_value: string) => undefined),

    // ── Building focus ───────────────────────────────────────────────────
    currentFocusedBuildingId: null,
    currentFocusedCoords: null,
    currentFocusedBuildingName: null,
    currentFocusedOwnerName: null,
    clearBuildingFocus: jest.fn(() => undefined),

    // ── Emission + helpers ───────────────────────────────────────────────
    emit: jest.fn(() => true),
    // Deliberately NOT the identity: a handler that forgets to proxy a URL
    // must not produce the same string as one that proxies it.
    convertToProxyUrl: jest.fn((remoteUrl: string) => `proxy:${remoteUrl}`),

    // ── Logging ──────────────────────────────────────────────────────────
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      setField: jest.fn(),
    },
  };

  const ctx: SessionContext = { ...base, ...rest };

  return {
    ctx,
    sent,
    frames,
    respond: (fn: Responder) => { responder = fn; },
    cacher: {
      createObject: ctx.cacherCreateObject as CacherMocks['createObject'],
      setObject: ctx.cacherSetObject as CacherMocks['setObject'],
      setPath: ctx.cacherSetPath as CacherMocks['setPath'],
      getPropertyList: ctx.cacherGetPropertyList as CacherMocks['getPropertyList'],
      closeObject: ctx.cacherCloseObject as CacherMocks['closeObject'],
    },
    log: {
      debug: ctx.log.debug as LogMocks['debug'],
      info: ctx.log.info as LogMocks['info'],
      warn: ctx.log.warn as LogMocks['warn'],
      error: ctx.log.error as LogMocks['error'],
      setField: ctx.log.setField as LogMocks['setField'],
    },
  };
}

// ── PushContext ─────────────────────────────────────────────────────────────

/**
 * `PushContext` (`push-dispatcher.ts:38`) is the read/write face of the session
 * seen by incoming server pushes: getters, setters and `emit`. Every member is
 * a mock — the dispatcher is pure parsing, so what a test asserts is which
 * setter was called with which parsed value.
 *
 * The getters that gate control flow (`getWaitingForInitClient`) return the
 * quiescent value; a test that exercises the login window says so itself.
 */
export interface FakePushCtx {
  ctx: PushContext;
  emit: jest.MockedFunction<PushContext['emit']>;
  log: Pick<LogMocks, 'debug' | 'warn' | 'error'>;
}

export function makePushCtx(overrides: Partial<PushContext> = {}): FakePushCtx {
  const base: PushContext = {
    log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    emit: jest.fn(() => true),

    getWaitingForInitClient: jest.fn(() => false),
    setWaitingForInitClient: jest.fn(),
    getInitClientResolver: jest.fn(() => null),
    setInitClientResolver: jest.fn(),

    getVirtualDate: jest.fn(() => null),
    setVirtualDate: jest.fn(),
    getAccountMoney: jest.fn(() => null),
    setAccountMoney: jest.fn(),
    getFailureLevel: jest.fn(() => null),
    setFailureLevel: jest.fn(),
    getFTycoonProxyId: jest.fn(() => null),
    setFTycoonProxyId: jest.fn(),
    getCurrentChannel: jest.fn(() => ''),
    setCurrentChannel: jest.fn(),

    getLastRanking: jest.fn(() => 0),
    setLastRanking: jest.fn(),
    getLastBuildingCount: jest.fn(() => 0),
    setLastBuildingCount: jest.fn(),
    getLastMaxBuildings: jest.fn(() => 0),
    setLastMaxBuildings: jest.fn(),

    setServerBusyFromPush: jest.fn(),
    setWorldSeason: jest.fn(),
  };

  const ctx: PushContext = { ...base, ...overrides };

  return {
    ctx,
    emit: ctx.emit as jest.MockedFunction<PushContext['emit']>,
    log: {
      debug: ctx.log.debug as LogMocks['debug'],
      warn: ctx.log.warn as LogMocks['warn'],
      error: ctx.log.error as LogMocks['error'],
    },
  };
}

// ── LoginContext ────────────────────────────────────────────────────────────

/**
 * The session state a `LoginContext` carries between steps.
 *
 * WHY THE SETTERS WRITE HERE. `LoginContext` is the only handler context whose
 * writes are read back inside the same call: `fullWorldRelogin` does
 * `setRdoCnntId(…)` and then reads `ctx.rdoCnntId` to build
 * `RegisterEventsById`; `loginWorld` sets the InitClient resolver and then
 * awaits the promise it installed; `switchCompany` nulls the world state and
 * then re-enters `loginWorld`, which fills it again. A fake whose setters only
 * recorded would take the wrong branch at every one of those points — and the
 * question ("does the id the server returned reach the next frame?")
 * would be unanswerable.
 *
 * So the setters both RECORD (they stay `jest.fn()`) and WRITE, exactly as
 * `StarpeaceSession` does. That mirrors production; it invents nothing. Every
 * field starts null/empty — no business value is supplied by default, and a
 * test that needs a logged-in session says so in its own `overrides`.
 */
export interface FakeLoginState {
  phase: SessionPhase;
  worldContextId: string | null;
  tycoonId: string | null;
  interfaceServerId: string | null;
  rdoCnntId: string | null;
  cacherId: string | null;
  worldId: string | null;
  daAddr: string | null;
  daPort: number | null;
  mailAccount: string | null;
  mailAddr: string | null;
  mailPort: number | null;
  worldXSize: number | null;
  worldYSize: number | null;
  worldSeason: number | null;
  accountStatus: number | null;
  currentWorldInfo: WorldInfo | null;
  cachedUsername: string | null;
  cachedPassword: string | null;
  cachedZonePath: string;
  activeUsername: string | null;
  currentCompany: CompanyInfo | null;
  lastPlayerX: number;
  lastPlayerY: number;
  availableWorlds: Map<string, WorldInfo>;
  availableCompanies: CompanyInfo[];
  knownObjects: Map<string, string>;
  waitingForInitClient: boolean;
  initClientReceived: Promise<void> | null;
  /** Set by `loginWorld` before `RegisterEventsById`; a test calls it to stand in for the InitClient push. */
  initClientResolver: (() => void) | null;
}

/** Mock handles on the LoginContext members that are pure side effects. */
export interface LoginHookMocks {
  /** Exposed for `invocationCallOrder` — several login rules are about ORDER. */
  sendRdoRequest: jest.MockedFunction<LoginContext['sendRdoRequest']>;
  createSocket: jest.MockedFunction<LoginContext['createSocket']>;
  deleteSocket: jest.MockedFunction<LoginContext['deleteSocket']>;
  initWorldPool: jest.MockedFunction<LoginContext['initWorldPool']>;
  populateWorldPool: jest.MockedFunction<LoginContext['populateWorldPool']>;
  emit: jest.MockedFunction<LoginContext['emit']>;
  setKnownObject: jest.MockedFunction<LoginContext['setKnownObject']>;
  startServerBusyPolling: jest.MockedFunction<LoginContext['startServerBusyPolling']>;
  startGcSweep: jest.MockedFunction<LoginContext['startGcSweep']>;
  stopCacherKeepAlive: jest.MockedFunction<LoginContext['stopCacherKeepAlive']>;
  removeAllSocketListeners: jest.MockedFunction<LoginContext['removeAllSocketListeners']>;
  destroySocket: jest.MockedFunction<LoginContext['destroySocket']>;
  deleteFramer: jest.MockedFunction<LoginContext['deleteFramer']>;
  clearAspActionCache: jest.MockedFunction<LoginContext['clearAspActionCache']>;
  clearBuildingFocus: jest.MockedFunction<LoginContext['clearBuildingFocus']>;
  setPhase: jest.MockedFunction<LoginContext['setPhase']>;
  setCurrentCompany: jest.MockedFunction<LoginContext['setCurrentCompany']>;
  setActiveUsername: jest.MockedFunction<LoginContext['setActiveUsername']>;
  pushAvailableCompany: jest.MockedFunction<LoginContext['pushAvailableCompany']>;
}

export interface FakeLoginCtx {
  /** Hand this to the login handler under test. */
  ctx: LoginContext;
  /** Every `sendRdoRequest()`, in call order — the `"^"` channel. */
  sent: SentRequest[];
  /**
   * Every `writeRdoFrame()` frame, by socket name, decoded latin1.
   * Directory sockets are created by the handler itself, so their lists appear
   * as soon as `createSocket()` runs.
   */
  frames: Record<string, string[]>;
  respond(fn: Responder): void;
  /** Live session state — read it to assert what the handler stored. */
  state: FakeLoginState;
  hooks: LoginHookMocks;
  log: Pick<LogMocks, 'debug' | 'info' | 'warn' | 'error'>;
}

export interface FakeLoginOptions extends Partial<FakeLoginState> {
  /** Socket names that already exist before the handler runs (e.g. `['world']`). */
  sockets?: string[];
}

/**
 * Build a fake `LoginContext`.
 *
 * `createSocket(name, …)` registers a capture socket under `name` and returns
 * it, so the frames the directory phases write fire-and-forget (`RDOEndSession`)
 * land in `frames[name]`.
 */
export function makeLoginCtx(overrides: FakeLoginOptions = {}): FakeLoginCtx {
  const { sockets = [], ...stateOverrides } = overrides;

  const state: FakeLoginState = {
    phase: SessionPhase.DISCONNECTED,
    worldContextId: null,
    tycoonId: null,
    interfaceServerId: null,
    rdoCnntId: null,
    cacherId: null,
    worldId: null,
    daAddr: null,
    daPort: null,
    mailAccount: null,
    mailAddr: null,
    mailPort: null,
    worldXSize: null,
    worldYSize: null,
    worldSeason: null,
    accountStatus: null,
    currentWorldInfo: null,
    cachedUsername: null,
    cachedPassword: null,
    cachedZonePath: '',
    activeUsername: null,
    currentCompany: null,
    lastPlayerX: 0,
    lastPlayerY: 0,
    availableWorlds: new Map<string, WorldInfo>(),
    availableCompanies: [],
    knownObjects: new Map<string, string>(),
    waitingForInitClient: false,
    initClientReceived: null,
    initClientResolver: null,
    ...stateOverrides,
  };

  const sent: SentRequest[] = [];
  const frames: Record<string, string[]> = {};
  const socketsByName = new Map<string, Socket>();

  const openSocket = (name: string): Socket => {
    const sink: string[] = [];
    frames[name] = sink;
    const socket = createCaptureSocket(sink);
    socketsByName.set(name, socket);
    return socket;
  };
  for (const name of sockets) openSocket(name);

  let responder: Responder = EMPTY_RESPONDER;
  let nextRid = 1;

  const ctx: LoginContext = {
    log: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },

    sendRdoRequest: jest.fn(async (
      socketName: string,
      packetData: Partial<RdoPacket>,
      timeoutMs: number | undefined,
      category: TimeoutCategory,
    ): Promise<RdoPacket> => {
      const callIndex = sent.length;
      sent.push({ socketName, packet: packetData, timeoutMs, category });
      const answer = responder(packetData, callIndex);
      if (answer instanceof Error) throw answer;
      const rid = packetData.rid ?? nextRid++;
      if (typeof answer === 'string') {
        return { raw: '', type: 'RESPONSE', rid, payload: answer };
      }
      return answer;
    }),

    getSocket: jest.fn((name: string) => socketsByName.get(name)),
    createSocket: jest.fn(async (name: string) => openSocket(name)),
    deleteSocket: jest.fn((name: string) => { socketsByName.delete(name); }),
    initWorldPool: jest.fn(),
    populateWorldPool: jest.fn(),

    emit: jest.fn(() => true),

    // ── Read-only state, backed by `state` ───────────────────────────────
    get worldContextId() { return state.worldContextId; },
    get tycoonId() { return state.tycoonId; },
    get interfaceServerId() { return state.interfaceServerId; },
    get worldId() { return state.worldId; },
    get currentWorldInfo() { return state.currentWorldInfo; },
    get cachedUsername() { return state.cachedUsername; },
    get cachedPassword() { return state.cachedPassword; },
    get rdoCnntId() { return state.rdoCnntId; },
    get currentCompany() { return state.currentCompany; },

    getPhase: jest.fn(() => state.phase),
    setPhase: jest.fn((value: SessionPhase) => { state.phase = value; }),

    setWorldContextId: jest.fn((value: string | null) => { state.worldContextId = value; }),
    setInterfaceServerId: jest.fn((value: string | null) => { state.interfaceServerId = value; }),
    setTycoonId: jest.fn((value: string | null) => { state.tycoonId = value; }),
    setRdoCnntId: jest.fn((value: string | null) => { state.rdoCnntId = value; }),
    setCacherId: jest.fn((value: string | null) => { state.cacherId = value; }),
    setWorldId: jest.fn((value: string | null) => { state.worldId = value; }),
    setDaPort: jest.fn((value: number | null) => { state.daPort = value; }),
    setDaAddr: jest.fn((value: string | null) => { state.daAddr = value; }),
    setMailAccount: jest.fn((value: string | null) => { state.mailAccount = value; }),
    setMailAddr: jest.fn((value: string | null) => { state.mailAddr = value; }),
    setMailPort: jest.fn((value: number | null) => { state.mailPort = value; }),
    setWorldXSize: jest.fn((value: number | null) => { state.worldXSize = value; }),
    setWorldYSize: jest.fn((value: number | null) => { state.worldYSize = value; }),
    setWorldSeason: jest.fn((value: number | null) => { state.worldSeason = value; }),
    setCurrentWorldInfo: jest.fn((value: WorldInfo | null) => { state.currentWorldInfo = value; }),
    setCachedUsername: jest.fn((value: string | null) => { state.cachedUsername = value; }),
    setCachedPassword: jest.fn((value: string | null) => { state.cachedPassword = value; }),
    setCachedZonePath: jest.fn((value: string) => { state.cachedZonePath = value; }),
    setActiveUsername: jest.fn((value: string | null) => { state.activeUsername = value; }),
    setCurrentCompany: jest.fn((value: CompanyInfo | null) => { state.currentCompany = value; }),
    setLastPlayerX: jest.fn((value: number) => { state.lastPlayerX = value; }),
    setLastPlayerY: jest.fn((value: number) => { state.lastPlayerY = value; }),
    setAccountStatus: jest.fn((value: number | null) => { state.accountStatus = value; }),

    getAvailableWorlds: jest.fn(() => state.availableWorlds),
    setAvailableWorlds: jest.fn((worlds: Map<string, WorldInfo>) => { state.availableWorlds = worlds; }),
    getAvailableCompanies: jest.fn(() => state.availableCompanies),
    setAvailableCompanies: jest.fn((companies: CompanyInfo[]) => { state.availableCompanies = companies; }),
    pushAvailableCompany: jest.fn((company: CompanyInfo) => { state.availableCompanies.push(company); }),

    setKnownObject: jest.fn((name: string, id: string) => { state.knownObjects.set(name, id); }),

    setWaitingForInitClient: jest.fn((value: boolean) => { state.waitingForInitClient = value; }),
    getInitClientReceived: jest.fn(() => state.initClientReceived),
    setInitClientReceived: jest.fn((value: Promise<void> | null) => { state.initClientReceived = value; }),
    setInitClientResolver: jest.fn((value: (() => void) | null) => { state.initClientResolver = value; }),

    startServerBusyPolling: jest.fn(),
    startGcSweep: jest.fn(),
    stopCacherKeepAlive: jest.fn(),

    getSocketNames: jest.fn(() => Array.from(socketsByName.keys())),
    removeAllSocketListeners: jest.fn(),
    destroySocket: jest.fn(),
    deleteFramer: jest.fn(),

    clearAspActionCache: jest.fn(),
    clearBuildingFocus: jest.fn(),
  };

  return {
    ctx,
    sent,
    frames,
    respond: (fn: Responder) => { responder = fn; },
    state,
    hooks: {
      sendRdoRequest: ctx.sendRdoRequest as LoginHookMocks['sendRdoRequest'],
      createSocket: ctx.createSocket as LoginHookMocks['createSocket'],
      deleteSocket: ctx.deleteSocket as LoginHookMocks['deleteSocket'],
      initWorldPool: ctx.initWorldPool as LoginHookMocks['initWorldPool'],
      populateWorldPool: ctx.populateWorldPool as LoginHookMocks['populateWorldPool'],
      emit: ctx.emit as LoginHookMocks['emit'],
      setKnownObject: ctx.setKnownObject as LoginHookMocks['setKnownObject'],
      startServerBusyPolling: ctx.startServerBusyPolling as LoginHookMocks['startServerBusyPolling'],
      startGcSweep: ctx.startGcSweep as LoginHookMocks['startGcSweep'],
      stopCacherKeepAlive: ctx.stopCacherKeepAlive as LoginHookMocks['stopCacherKeepAlive'],
      removeAllSocketListeners: ctx.removeAllSocketListeners as LoginHookMocks['removeAllSocketListeners'],
      destroySocket: ctx.destroySocket as LoginHookMocks['destroySocket'],
      deleteFramer: ctx.deleteFramer as LoginHookMocks['deleteFramer'],
      clearAspActionCache: ctx.clearAspActionCache as LoginHookMocks['clearAspActionCache'],
      clearBuildingFocus: ctx.clearBuildingFocus as LoginHookMocks['clearBuildingFocus'],
      setPhase: ctx.setPhase as LoginHookMocks['setPhase'],
      setCurrentCompany: ctx.setCurrentCompany as LoginHookMocks['setCurrentCompany'],
      setActiveUsername: ctx.setActiveUsername as LoginHookMocks['setActiveUsername'],
      pushAvailableCompany: ctx.pushAvailableCompany as LoginHookMocks['pushAvailableCompany'],
    },
    log: {
      debug: ctx.log.debug as LogMocks['debug'],
      info: ctx.log.info as LogMocks['info'],
      warn: ctx.log.warn as LogMocks['warn'],
      error: ctx.log.error as LogMocks['error'],
    },
  };
}

/**
 * without reaching back into `shared/types` for it.
 */
export type { BuildingDetailsResponse, AspActionUrl };
