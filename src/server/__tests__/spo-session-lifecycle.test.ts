/**
 * StarpeaceSession — transport, timers and teardown.
 *
 * The half of `spo_session.ts` that is not a facade: `sendRdoRequest` and
 * everything it decides (ServerBusy buffering, deadlines, QueryId allocation,
 * pool routing, guards), the four background timers, the reverse channel the
 * server calls us on, and the three teardown paths.
 *
 * Every test drives the REAL session through `createProtocolTestHarness`
 * (MockTcpSocket + the strict validator), because these are the paths where a
 * hand-written double would simply agree with whatever the code does. The one
 * rule that is never bent: `sendRdoRequest` is never mocked here — it is the
 * subject.
 */

jest.mock('net', () => ({ Socket: jest.fn() }));
jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-validation/protocol-test-harness';
import type { SocketConfig } from './protocol-validation/protocol-test-harness';
import type { FallbackResponse } from './protocol-validation/mock-tcp-socket';
import type { MockTcpSocket } from './protocol-validation/mock-tcp-socket';
import { StarpeaceSession } from '../spo_session';
import { RdoProtocol } from '../rdo';
import { RdoAction, RdoVerb, SessionPhase, WsMessageType } from '../../shared/types';
import type { RdoPacket, WorldInfo } from '../../shared/types';
import { TimeoutCategory, IS_PROXY_TIMEOUT_MS } from '../../shared/timeout-categories';
import type { RdoScenario } from '../../mock-server/types/rdo-exchange-types';
import { setActiveInspectorForTest, releaseInspector } from '../session/building-details-handler';
import type { ActiveInspector } from '../session/building-details-handler';
import type { SessionContext } from '../session/session-context';

// ── Fixture ids ─────────────────────────────────────────────────────────────
const CONTEXT_ID = '8161308';
const INTERFACE_SERVER_ID = '6892548';
const CACHER_ID = '40133496';
const WORLD_OBJECT_ID = '30430748';
const MAIL_SERVER_ID = '51002448';
const TEMP_OBJECT_ID = '7';
const CURR_BLOCK = '202334236';
const OBJECT_ID = '202334237';

const WORLD: WorldInfo = {
  name: 'planitia', url: 'http://1.2.3.4', ip: '1.2.3.4', port: 8000,
  population: 0, investors: 0, online: 0, players: 0, mapSizeX: 0, mapSizeY: 0,
};

/** `idof` answers for every root object the session resolves. */
const IDOF_SCENARIO: RdoScenario = {
  name: 'idof',
  description: 'root object resolution for every service socket',
  variables: {},
  exchanges: [
    ['WSObjectCacher', CACHER_ID],
    ['World', WORLD_OBJECT_ID],
    ['MailServer', MAIL_SERVER_ID],
    ['InterfaceServer', INTERFACE_SERVER_ID],
  ].map(([name, id]) => ({
    id: `idof-${name}`,
    request: `C 0 idof "${name}"`,
    response: `A0 objid="${id}"`,
    matchKeys: { verb: 'idof', targetId: name },
  })),
};

const FALLBACKS: FallbackResponse[] = [
  { member: 'CreateObject', payload: `res="%${TEMP_OBJECT_ID}"` },
  { member: 'SetObject', payload: 'res="#0"' },
  { member: 'SetPath', payload: 'res="#0"' },
  { member: 'GetPropertyList', payload: `res="%${CURR_BLOCK}\t${OBJECT_ID}\t"` },
  { member: 'LogServerOn', payload: 'res="#51002449"' },
  { member: 'SwitchFocusEx', payload: `res="%${CURR_BLOCK}\nCar Factory"` },
  { member: 'ObjectAt', payload: `res="%${OBJECT_ID}"` },
  { member: 'ConnectFacilities', payload: 'res="%Connected"' },
  { member: 'ObjectsInArea', payload: 'res="%"' },
  { member: 'SegmentsInArea', payload: 'res="%"' },
  { member: 'Logoff', payload: 'Logoff="#0"' },
  { member: 'ServerBusy', payload: 'ServerBusy="#0"' },
  { member: 'TycoonId', payload: 'TycoonId="#22"' },
];

const socketConfig = (): SocketConfig => ({
  rdoScenarios: [IDOF_SCENARIO],
  fallbackResponses: FALLBACKS,
  disableStrictValidation: true,
});

/**
 * Six identical socket slots: world, map, construction, mail and spares, plus
 * the same answers on the pool connections. The pool stays OFF by default —
 * `enabled` only decides `setWorldPoolEnabled`, and the tests that want a
 * populated pool turn it on themselves.
 */
function makeHarness(): ProtocolTestHarness {
  return createProtocolTestHarness({
    socketConfigs: Array.from({ length: 6 }, socketConfig),
    worldPool: { enabled: false, socketConfigs: Array.from({ length: 6 }, socketConfig) },
  });
}

/** The private members a lifecycle test legitimately needs to observe. */
interface SessionInternals {
  isClosing: boolean;
  isServerBusy: boolean;
  requestIdCounter: number;
  requestBuffer: Array<{ socketName: string; reject: (err: unknown) => void }>;
  pendingRequests: Map<number, { state: string; reject: (err: unknown) => void; resolve: (p: RdoPacket) => void; sentAt: number }>;
  serverBusyCheckInterval: NodeJS.Timeout | null;
  gcSweepInterval: NodeJS.Timeout | null;
  keepAliveInterval: NodeJS.Timeout | null;
  worldReconnectAttempts: number;
  worldReconnectLastAttempt: number;
  maintenanceMode: boolean;
  modelServerDownCount: number;
  loggedOff: boolean;
  knownObjects: Map<string, string>;
  startCacherKeepAlive(): void;
  processBufferedRequests(): Promise<void>;
  /** Private, and only reachable from a caller that has already checked the world context. */
  objectAt(x: number, y: number): Promise<string>;
  /** Private, and only reachable from a dispatcher that has already checked the QueryId. */
  handleServerRequest(socketName: string, packet: RdoPacket): void;
}

function internals(harness: ProtocolTestHarness): SessionInternals {
  return harness.session as unknown as SessionInternals;
}

function fakeInspector(tempObjectId: string): ActiveInspector {
  return {
    tempObjectId, x: 706, y: 436, visualClass: 'CarFactoryA',
    mutex: { runExclusive: (fn: () => unknown) => fn() } as unknown as ActiveInspector['mutex'],
    gateMap: '0000',
    hasSupplies: false, hasProducts: false, hasCompInputs: false, isWarehouse: false,
  };
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** The `ws_event` payloads these tests care about. */
interface WsEvent {
  type: string;
  active?: boolean;
  building?: { buildingId: string; x: number; y: number };
}

/** Collect everything the session emits towards the browser. */
function collectWsEvents(session: StarpeaceSession): WsEvent[] {
  const events: WsEvent[] = [];
  session.on('ws_event', (event: unknown) => { events.push(event as WsEvent); });
  return events;
}

let harness: ProtocolTestHarness;

beforeEach(() => {
  jest.clearAllMocks();
  harness = makeHarness();
});

afterEach(() => {
  harness.session.destroy();
  harness.cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** A harness whose only socket answers `member` with `payload` and nothing else. */
function answering(member: string, payload: string): ProtocolTestHarness {
  return createProtocolTestHarness({
    socketConfigs: [{
      rdoScenarios: [IDOF_SCENARIO],
      fallbackResponses: [{ member, payload }],
      disableStrictValidation: true,
    }],
  });
}

/** Bring the session to the state every post-login test assumes. */
async function connectWorld(): Promise<MockTcpSocket> {
  await harness.session.createSocket('world', WORLD.ip, WORLD.port);
  harness.session.setWorldContextId(CONTEXT_ID);
  harness.session.setCurrentWorldInfo(WORLD);
  harness.session.setPhase(SessionPhase.WORLD_CONNECTED);
  return harness.getSockets()[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket creation
// ═══════════════════════════════════════════════════════════════════════════

describe('createSocket', () => {
  it('builds its socket through the default factory when none is injected', async () => {
    // The harness injects a factory; a plain session uses `new net.Socket()`,
    // which the module mock resolves to the same MockTcpSocket implementation.
    const plain = new StarpeaceSession();
    await expect(plain.createSocket('world', WORLD.ip, WORLD.port)).resolves.toBeDefined();
    expect(plain.getSocket('world')).toBeDefined();
    plain.destroy();
  });

  it('rejects the creation promise when the socket errors before it connects', async () => {
    const failing = createProtocolTestHarness({ socketConfigs: [socketConfig()] });
    const netMock = jest.requireMock('net') as { Socket: jest.Mock };
    const original = netMock.Socket.getMockImplementation();
    netMock.Socket.mockImplementation(() => {
      const socket = original!() as MockTcpSocket;
      socket.failNextConnect = true;
      return socket;
    });

    await expect(failing.session.createSocket('world', WORLD.ip, 9)).rejects.toThrow(/ECONNREFUSED/);
    // Nothing is registered: a socket only enters the map once connected.
    expect(failing.session.getSocket('world')).toBeUndefined();

    failing.session.destroy();
    failing.cleanup();
  });

  it('survives a handler that throws on one frame, and keeps reading the socket', async () => {
    const socket = await connectWorld();
    const error = jest.spyOn(harness.session.log, 'error');
    jest.spyOn(RdoProtocol, 'parse').mockImplementationOnce(() => { throw new Error('unreadable frame'); });

    socket.emit('data', Buffer.from('A1 res="#0";', 'latin1'));

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Error processing RDO frame on world'));
    // The socket is still live: a later frame is processed normally.
    expect(() => socket.emit('data', Buffer.from('A2 res="#0";', 'latin1'))).not.toThrow();
  });

  it('logs a socket error raised after the connection is established', async () => {
    const socket = await connectWorld();
    const error = jest.spyOn(harness.session.log, 'error');

    socket.emit('error', new Error('ECONNRESET'));

    expect(error).toHaveBeenCalledWith('[Session] Socket error on world:', expect.any(Error));
  });

  it('attempts an auto-reconnect when the world socket closes mid-play', async () => {
    const socket = await connectWorld();
    const reconnect = jest.spyOn(harness.session, 'attemptWorldReconnect')
      .mockRejectedValue(new Error('still down'));
    const error = jest.spyOn(harness.session.log, 'error');

    socket.emit('close');
    await flush();

    // The socket `close` event is the ONLY reconnect trigger, and a failed
    // attempt is logged rather than left as an unhandled rejection.
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[Session] World auto-reconnect failed:', 'still down');
  });

  it('stops the cacher KeepAlive when the map socket closes instead of reconnecting', async () => {
    await connectWorld();
    await harness.session.connectMapService();
    const socket = harness.getSockets()[1];
    const reconnect = jest.spyOn(harness.session, 'attemptWorldReconnect').mockResolvedValue(undefined);

    socket.emit('close');
    await flush();

    // The cacher session is per-inspector, and the map socket is re-created
    // on the next request — reconnecting it eagerly buys nothing.
    expect(reconnect).not.toHaveBeenCalled();
    expect(internals(harness).keepAliveInterval).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Service connections
// ═══════════════════════════════════════════════════════════════════════════

describe('service connections', () => {
  it('resolves the cacher root once and starts the KeepAlive timer', async () => {
    await connectWorld();

    await harness.session.connectMapService();

    expect(harness.session.cacherId).toBe(CACHER_ID);
    expect(internals(harness).keepAliveInterval).not.toBeNull();
    expect(harness.getCapturedCommands(1)[0]).toMatch(/idof "WSObjectCacher"/);

    // Idempotent: a second call is a no-op, not a second socket.
    await harness.session.connectMapService();
    expect(harness.getSockets()).toHaveLength(2);
  });

  it('refuses to start a KeepAlive with no cacher to keep alive', async () => {
    await connectWorld();
    const warn = jest.spyOn(harness.session.log, 'warn');
    harness.session.setCacherId(null);

    internals(harness).startCacherKeepAlive();

    expect(warn).toHaveBeenCalledWith('[KeepAlive] Cannot start: no cacherId');
    expect(internals(harness).keepAliveInterval).toBeNull();
  });

  it('arms the KeepAlive timer once, whatever calls it', async () => {
    await connectWorld();
    await harness.session.connectMapService();
    const timer = internals(harness).keepAliveInterval;

    internals(harness).startCacherKeepAlive();

    expect(internals(harness).keepAliveInterval).toBe(timer);
  });

  it('logs the construction service on with the ACTIVE identity', async () => {
    await connectWorld();
    harness.session.setCachedUsername('SPO_test3');
    harness.session.setCachedPassword('test3');
    harness.session.setActiveUsername('Mayor of Kalisz');

    await harness.session.connectConstructionService();

    expect(harness.session.worldId).toBe(WORLD_OBJECT_ID);
    const writes = harness.getSockets()[1].getCapturedWrites().join('\n');
    // RDOLogonClient is fire-and-forget on the World object, under the role.
    expect(writes).toContain(`sel ${WORLD_OBJECT_ID} call RDOLogonClient "*"`);
    expect(writes).toContain('%Mayor of Kalisz');

    await harness.session.connectConstructionService();
    expect(harness.getSockets()).toHaveLength(2);
  });

  it('dials loopback when no world address is known yet', async () => {
    // Defensive default rather than a crash: a service asked for before the
    // world properties arrived still produces a well-formed connect.
    await harness.session.connectMapService();
    expect(harness.session.cacherId).toBe(CACHER_ID);

    harness.session.setCachedUsername('SPO_test3');
    harness.session.setCachedPassword('test3');
    await harness.session.connectConstructionService();
    expect(harness.session.worldId).toBe(WORLD_OBJECT_ID);
  });

  it('does not log on to a World object that resolved to nothing', async () => {
    const unresolved = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [{
          name: 'idof-empty', description: 'World resolves to an empty id', variables: {},
          exchanges: [{
            id: 'idof-world-empty',
            request: 'C 0 idof "World"',
            response: 'A0 objid="#"',
            matchKeys: { verb: 'idof', targetId: 'World' },
          }],
        }],
        disableStrictValidation: true,
      }],
    });
    unresolved.session.setCachedUsername('SPO_test3');
    unresolved.session.setCachedPassword('test3');

    await unresolved.session.connectConstructionService();

    expect(unresolved.session.worldId).toBe('');
    // Sending RDOLogonClient on `sel 0` would be a null pointer server-side.
    expect(unresolved.getSockets()[0].getCapturedWrites().join('\n')).not.toContain('RDOLogonClient');

    unresolved.session.destroy();
    unresolved.cleanup();
  });

  it('refuses to connect the construction service without cached credentials', async () => {
    await connectWorld();

    await expect(harness.session.connectConstructionService())
      .rejects.toThrow('Credentials not cached - cannot connect to construction service');
  });

  it('registers with the mail server to obtain a real ServerId', async () => {
    await connectWorld();
    harness.session.setMailAddr('1.2.3.5');
    harness.session.setMailPort(1234);

    await harness.session.connectMailService();

    expect(harness.session.mailServerId).toBe(MAIL_SERVER_ID);
    // CheckNewMail casts the ServerId to a POINTER (MailServer.pas:543);
    // "#0" AVs the server and makes the call always answer -1.
    expect(harness.session.mailIntServerId).toBe('51002449');
    await harness.session.connectMailService();
    expect(harness.getSockets()).toHaveLength(2);
  });

  it('disables the RDO unread count rather than failing when LogServerOn is refused', async () => {
    const refused = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [IDOF_SCENARIO],
        // errUnexistentMethod — an old mail server that does not publish it.
        fallbackResponses: [{ member: 'LogServerOn', payload: 'error 9' }],
        disableStrictValidation: true,
      }],
    });
    refused.session.setMailAddr('1.2.3.5');
    refused.session.setMailPort(1234);
    const warn = jest.spyOn(refused.session.log, 'warn');

    // The mail socket still comes up: the unread COUNT is what is lost, not mail.
    await expect(refused.session.connectMailService()).resolves.toBeUndefined();

    expect(refused.session.mailServerId).toBe(MAIL_SERVER_ID);
    expect(refused.session.mailIntServerId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[Mail] LogServerOn failed — RDO unread count disabled:', expect.any(String),
    );

    refused.session.destroy();
    refused.cleanup();
  });

  it('treats a zero ServerId as no session at all', async () => {
    const zeroHarness = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [IDOF_SCENARIO],
        fallbackResponses: [{ member: 'LogServerOn', payload: 'res="#0"' }],
        disableStrictValidation: true,
      }],
    });
    zeroHarness.session.setMailAddr('1.2.3.5');
    zeroHarness.session.setMailPort(1234);

    await zeroHarness.session.connectMailService();

    expect(zeroHarness.session.mailIntServerId).toBeNull();
    zeroHarness.session.destroy();
    zeroHarness.cleanup();
  });

  it('refuses to connect the mail service before login announced the address', async () => {
    await expect(harness.session.connectMailService())
      .rejects.toThrow('Mail server address/port not available - ensure world login completed');
  });

  it('re-opens the mail socket only after a real loss', async () => {
    await connectWorld();
    harness.session.setMailAddr('1.2.3.5');
    harness.session.setMailPort(1234);

    await harness.session.ensureMailConnection();
    expect(harness.getSockets()).toHaveLength(2);

    // Already connected → nothing happens.
    await harness.session.ensureMailConnection();
    expect(harness.getSockets()).toHaveLength(2);

    // The server closed it: the ids are stale and must be re-resolved.
    harness.session.deleteSocket('mail');
    await harness.session.ensureMailConnection();
    expect(harness.getSockets()).toHaveLength(3);
    expect(harness.session.mailServerId).toBe(MAIL_SERVER_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cacher object pool
// ═══════════════════════════════════════════════════════════════════════════

describe('cacher object pool', () => {
  it('threads one temp object through create → set → read → close', async () => {
    await connectWorld();
    await harness.session.connectMapService();

    const values = await harness.session.getCacherPropertyListAt(706, 436, ['CurrBlock', 'ObjectId']);

    expect(values).toEqual([CURR_BLOCK, OBJECT_ID]);
    const commands = harness.getCapturedCommands(1);
    const create = commands.find(c => c.includes('CreateObject'));
    const setObject = commands.find(c => c.includes('SetObject'));
    const read = commands.find(c => c.includes('GetPropertyList'));
    // Every data call targets the TEMP object the server handed back.
    expect(create).toContain(`sel ${CACHER_ID} call CreateObject`);
    expect(setObject).toContain(`sel ${TEMP_OBJECT_ID} call SetObject "^" "#706","#436"`);
    expect(read).toContain(`sel ${TEMP_OBJECT_ID} call GetPropertyList`);
    // CloseObject is a procedure — fire-and-forget on the cacher ROOT.
    const writes = harness.getSockets()[1].getCapturedWrites().join('\n');
    expect(writes).toContain(`sel ${CACHER_ID} call CloseObject "*" "#${TEMP_OBJECT_ID}"`);
  });

  it('closes the temp object even when the read fails', async () => {
    await connectWorld();
    await harness.session.connectMapService();
    jest.spyOn(harness.session, 'cacherGetPropertyList').mockRejectedValue(new Error('boom'));

    await expect(harness.session.getCacherPropertyListAt(706, 436, ['CurrBlock'])).rejects.toThrow('boom');

    const writes = harness.getSockets()[1].getCapturedWrites().join('\n');
    expect(writes).toContain('call CloseObject "*"');
  });

  it('refuses to create a temp object before the cacher and the world are known', async () => {
    await expect(harness.session.cacherCreateObject()).rejects.toThrow('Missing cacherId');

    harness.session.setCacherId(CACHER_ID);
    await expect(harness.session.cacherCreateObject()).rejects.toThrow('Missing world name for CreateObject');
  });

  it('refuses to read properties before the map service is initialised', async () => {
    await connectWorld();
    jest.spyOn(harness.session, 'connectMapService').mockResolvedValue(undefined);

    await expect(harness.session.getCacherPropertyListAt(706, 436, ['CurrBlock']))
      .rejects.toThrow('Map service not initialized (missing cacherId)');
  });

  it('names the path it reads properties from', async () => {
    await connectWorld();
    await harness.session.connectMapService();

    await harness.session.cacherSetPath(TEMP_OBJECT_ID, 'Tycoons\\SPO_test3.five\\');

    // P-M2: the path interpolates a browser-supplied tycoon name — explicit OLEString.
    expect(harness.getCapturedCommands(1).find(c => c.includes('SetPath')))
      .toContain(`sel ${TEMP_OBJECT_ID} call SetPath "^" "%Tycoons\\SPO_test3.five\\"`);
  });

  it('keeps empty values positional, and says so when the server answers short', async () => {
    const shortHarness = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [IDOF_SCENARIO],
        // Two requested properties, one value: the cache had nothing for the second.
        fallbackResponses: [{ member: 'GetPropertyList', payload: 'res="%\tCarFactoryA\t"' }],
        disableStrictValidation: true,
      }],
    });
    const warn = jest.spyOn(shortHarness.session.log, 'warn');
    await shortHarness.session.createSocket('map', WORLD.ip, 7000);

    const values = await shortHarness.session.cacherGetPropertyList(TEMP_OBJECT_ID, ['Name', 'Class', 'Missing']);

    // The leading empty value survives: positional alignment is the contract.
    expect(values).toEqual(['', 'CarFactoryA']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 values for 3 requested properties'));
    shortHarness.session.destroy();
    shortHarness.cleanup();
  });

  it('falls back to the generic payload cleaner when the answer is not res="…"', async () => {
    const oddHarness = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [IDOF_SCENARIO],
        fallbackResponses: [{ member: 'GetPropertyList', payload: 'GetPropertyList="%CarFactoryA"' }],
        disableStrictValidation: true,
      }],
    });
    await oddHarness.session.createSocket('map', WORLD.ip, 7000);

    // cleanPayload() is the generic cleaner: it strips the trailing quote it
    // finds and leaves the rest alone, so the value is returned as one opaque
    // token. Nothing downstream can use it — which is the point of pinning it:
    // the tab-splitting contract only holds for the `res="…"` form.
    await expect(oddHarness.session.cacherGetPropertyList(TEMP_OBJECT_ID, ['Class']))
      .resolves.toEqual(['GetPropertyList="%CarFactoryA']);

    oddHarness.session.destroy();
    oddHarness.cleanup();
  });

  it('reads a bodiless answer as no temp object and no values', async () => {
    const bodiless = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [IDOF_SCENARIO],
        fallbackResponses: [
          { member: 'CreateObject', payload: '' },
          { member: 'GetPropertyList', payload: '' },
        ],
        disableStrictValidation: true,
      }],
    });
    const warn = jest.spyOn(bodiless.session.log, 'warn');
    await bodiless.session.createSocket('map', WORLD.ip, 7000);
    bodiless.session.setCacherId(CACHER_ID);
    bodiless.session.setCurrentWorldInfo(WORLD);

    await expect(bodiless.session.cacherCreateObject()).resolves.toBe('');
    await expect(bodiless.session.cacherGetPropertyList(TEMP_OBJECT_ID, ['Name'])).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('0 values for 1 requested properties'));

    bodiless.session.destroy();
    bodiless.cleanup();
  });

  it('keeps a value that carries no type prefix intact', async () => {
    const untyped = answering('GetPropertyList', 'res="40133496\t"');
    await untyped.session.createSocket('map', WORLD.ip, 7000);

    // The prefix strip is conditional: a bare ordinal must not lose its first digit.
    await expect(untyped.session.cacherGetPropertyList(TEMP_OBJECT_ID, ['CurrBlock']))
      .resolves.toEqual(['40133496']);

    untyped.session.destroy();
    untyped.cleanup();
  });

  it('does not try to close a temp object with no cacher or no map socket', async () => {
    // No cacherId at all.
    expect(() => harness.session.cacherCloseObject(TEMP_OBJECT_ID)).not.toThrow();

    // A cacher, but the map socket is gone.
    harness.session.setCacherId(CACHER_ID);
    expect(() => harness.session.cacherCloseObject(TEMP_OBJECT_ID)).not.toThrow();
    expect(harness.getAllCapturedCommands()).toHaveLength(0);
  });

  it('reports a CloseObject it could not even build instead of throwing at the caller', async () => {
    await connectWorld();
    await harness.session.connectMapService();
    const warn = jest.spyOn(harness.session.log, 'warn');

    // An id that is not an integer cannot be encoded as an OrdinalId argument.
    harness.session.cacherCloseObject('not-an-id');

    expect(warn).toHaveBeenCalledWith('[cacherCloseObject] Failed:', expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Building focus
// ═══════════════════════════════════════════════════════════════════════════

describe('building focus', () => {
  it('refuses to focus before the world session exists', async () => {
    await expect(harness.session.focusBuilding(706, 436)).rejects.toThrow('Not logged into world');
  });

  it('refuses an empty SwitchFocusEx answer rather than inventing a building', async () => {
    const empty = answering('SwitchFocusEx', '');
    await empty.session.createSocket('world', WORLD.ip, WORLD.port);
    empty.session.setWorldContextId(CONTEXT_ID);

    await expect(empty.session.focusBuilding(706, 436)).rejects.toThrow(/building focus/i);
    expect(empty.session.currentFocusedBuildingId).toBeNull();

    empty.session.destroy();
    empty.cleanup();
  });

  it('sends SwitchFocusEx with the PREVIOUS building id and stores the new focus', async () => {
    await connectWorld();

    const info = await harness.session.focusBuilding(706, 436);

    expect(info.buildingId).toBe(CURR_BLOCK);
    // Delphi: SwitchFocusEx(previousId, x, y: integer) — 0 means "nothing focused".
    expect(harness.getCapturedCommands(0)[0])
      .toMatch(new RegExp(`sel ${CONTEXT_ID} call SwitchFocusEx "\\^" "#0","#706","#436"$`));
    expect(harness.session.currentFocusedBuildingId).toBe(CURR_BLOCK);
    expect(harness.session.currentFocusedCoords).toEqual({ x: 706, y: 436 });
  });

  it('shares one SwitchFocusEx between concurrent requests for the same tile', async () => {
    await connectWorld();

    const [a, b] = await Promise.all([
      harness.session.focusBuilding(706, 436),
      harness.session.focusBuilding(706, 436),
    ]);

    expect(a).toBe(b);
    expect(harness.getCapturedCommands(0).filter(c => c.includes('SwitchFocusEx'))).toHaveLength(1);
  });

  it('reuses a just-completed focus, and re-asks once the reuse window closes', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();

    await harness.session.focusBuilding(706, 436);
    await harness.session.focusBuilding(706, 436);
    // A repeat SwitchFocusEx on the focused building makes the server unfocus
    // and refocus the same object (InterfaceServer.pas:906-922).
    expect(harness.getCapturedCommands(0).filter(c => c.includes('SwitchFocusEx'))).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(3_100);
    const again = harness.session.focusBuilding(706, 436);
    await jest.advanceTimersByTimeAsync(10);
    await again;
    expect(harness.getCapturedCommands(0).filter(c => c.includes('SwitchFocusEx'))).toHaveLength(2);
  });

  it('says nothing on the wire when there is nothing to unfocus', async () => {
    await connectWorld();

    await harness.session.unfocusBuilding();

    expect(harness.getAllCapturedCommands()).toHaveLength(0);
  });

  it('sends UnfocusObject fire-and-forget and clears the focus state', async () => {
    await connectWorld();
    await harness.session.focusBuilding(706, 436);

    await harness.session.unfocusBuilding();

    const writes = harness.getSockets()[0].getCapturedWrites().join('\n');
    expect(writes).toContain(`sel ${CONTEXT_ID} call UnfocusObject "*" "#${CURR_BLOCK}"`);
    expect(harness.session.currentFocusedBuildingId).toBeNull();
    expect(harness.session.currentFocusedCoords).toBeNull();
    expect(harness.session.currentFocusedBuildingName).toBeNull();
    expect(harness.session.currentFocusedOwnerName).toBeNull();
  });

  it('clears the focus state even with no socket left to tell the server', async () => {
    await connectWorld();
    await harness.session.focusBuilding(706, 436);
    harness.session.deleteSocket('world');

    await harness.session.unfocusBuilding();

    expect(harness.session.currentFocusedBuildingId).toBeNull();
  });
});

describe('connectFacilitiesByCoords', () => {
  it('resolves both ends with ObjectAt before calling ConnectFacilities', async () => {
    await connectWorld();

    const result = await harness.session.connectFacilitiesByCoords(700, 430, 706, 436);

    const commands = harness.getCapturedCommands(0);
    expect(commands[0]).toContain(`sel ${CONTEXT_ID} call ObjectAt "^" "#700","#430"`);
    expect(commands[1]).toContain(`sel ${CONTEXT_ID} call ObjectAt "^" "#706","#436"`);
    // Both ids are the ones the server returned, threaded as integers.
    expect(commands[2]).toContain(`call ConnectFacilities "^" "#${OBJECT_ID}","#${OBJECT_ID}"`);
    expect(result).toEqual({ success: true, resultMessage: 'Connected' });
  });

  it('refuses before the world session exists', async () => {
    await expect(harness.session.connectFacilitiesByCoords(1, 2, 3, 4))
      .rejects.toThrow('Not logged into world');
  });

  it('refuses when there is no object at a coordinate', async () => {
    const emptyHarness = answering('ObjectAt', 'res="%"');
    await emptyHarness.session.createSocket('world', WORLD.ip, WORLD.port);
    emptyHarness.session.setWorldContextId(CONTEXT_ID);

    await expect(emptyHarness.session.connectFacilitiesByCoords(700, 430, 706, 436))
      .rejects.toThrow('No object found at (700, 430)');

    emptyHarness.session.destroy();
    emptyHarness.cleanup();
  });

  it('refuses a bodiless ObjectAt answer the same way', async () => {
    const bodiless = answering('ObjectAt', '');
    await bodiless.session.createSocket('world', WORLD.ip, WORLD.port);
    bodiless.session.setWorldContextId(CONTEXT_ID);

    await expect(bodiless.session.connectFacilitiesByCoords(700, 430, 706, 436))
      .rejects.toThrow('No object found at (700, 430)');

    bodiless.session.destroy();
    bodiless.cleanup();
  });

  it('guards the ObjectAt lookup itself, not only its caller', async () => {
    await connectWorld();
    harness.session.setWorldContextId(null);

    // `objectAt` is private and every caller checks the context first, so this
    // guard is only reachable from here. It is kept because the method is one
    // `await` away from being reused by a caller that forgets.
    await expect(internals(harness).objectAt(706, 436)).rejects.toThrow('Not logged into world');
  });

  it('reports a connection with no message as an empty message, not undefined', async () => {
    const withoutMessage = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [],
        fallbackResponses: [
          { member: 'ObjectAt', payload: `res="%${OBJECT_ID}"` },
          { member: 'ConnectFacilities', payload: '' },
        ],
        disableStrictValidation: true,
      }],
    });
    await withoutMessage.session.createSocket('world', WORLD.ip, WORLD.port);
    withoutMessage.session.setWorldContextId(CONTEXT_ID);

    await expect(withoutMessage.session.connectFacilitiesByCoords(700, 430, 706, 436))
      .resolves.toEqual({ success: true, resultMessage: '' });

    withoutMessage.session.destroy();
    withoutMessage.cleanup();
  });

  it('classifies the World.pas:3724 refusal as a failure', async () => {
    const refused = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [],
        fallbackResponses: [
          { member: 'ObjectAt', payload: `res="%${OBJECT_ID}"` },
          { member: 'ConnectFacilities', payload: 'res="%You are not allowed to do that!"' },
        ],
        disableStrictValidation: true,
      }],
    });
    await refused.session.createSocket('world', WORLD.ip, WORLD.port);
    refused.session.setWorldContextId(CONTEXT_ID);

    await expect(refused.session.connectFacilitiesByCoords(700, 430, 706, 436))
      .resolves.toEqual({ success: false, resultMessage: 'You are not allowed to do that!' });

    refused.session.destroy();
    refused.cleanup();
  });

  it('treats "There is nothing to trade!" as an outcome, not a refusal', async () => {
    const nothingToTrade = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [],
        fallbackResponses: [
          { member: 'ObjectAt', payload: `res="%${OBJECT_ID}"` },
          { member: 'ConnectFacilities', payload: 'res="%There is nothing to trade!"' },
        ],
        disableStrictValidation: true,
      }],
    });
    await nothingToTrade.session.createSocket('world', WORLD.ip, WORLD.port);
    nothingToTrade.session.setWorldContextId(CONTEXT_ID);

    await expect(nothingToTrade.session.connectFacilitiesByCoords(700, 430, 706, 436))
      .resolves.toEqual({ success: true, resultMessage: 'There is nothing to trade!' });

    nothingToTrade.session.destroy();
    nothingToTrade.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Map area, viewport and cloning
// ═══════════════════════════════════════════════════════════════════════════

describe('loadMapArea', () => {
  it('refuses before the world session exists', async () => {
    await expect(harness.session.loadMapArea(700, 430)).rejects.toThrow('Not logged into world');
  });

  it('defaults to the last known player position and the 64×64 viewport', async () => {
    await connectWorld();
    harness.session.setLastPlayerX(706);
    harness.session.setLastPlayerY(436);

    const data = await harness.session.loadMapArea();

    expect(data).toMatchObject({ x: 706, y: 436, w: 64, h: 64 });
    const commands = harness.getCapturedCommands(0);
    expect(commands[0]).toContain('call ObjectsInArea "^" "#706","#436","#64","#64"');
    // SegmentsInArea(CircuitId, x1, y1, x2, y2) — the rectangle, not a size.
    expect(commands[1]).toContain('call SegmentsInArea "^" "#1","#706","#436","#770","#500"');
  });

  it('shares one pair of reads between concurrent requests for the same origin', async () => {
    await connectWorld();

    const [a, b] = await Promise.all([
      harness.session.loadMapArea(700, 430),
      harness.session.loadMapArea(700, 430),
    ]);

    expect(a).toBe(b);
    expect(harness.getCapturedCommands(0).filter(c => c.includes('ObjectsInArea'))).toHaveLength(1);
  });

  it('refuses a fourth simultaneous area rather than flooding the server', async () => {
    await connectWorld();

    const inFlight = [
      harness.session.loadMapArea(1, 1),
      harness.session.loadMapArea(2, 2),
      harness.session.loadMapArea(3, 3),
    ];
    await expect(harness.session.loadMapArea(4, 4))
      .rejects.toThrow('Maximum concurrent map requests reached (3)');

    await Promise.all(inFlight);
  });
});

describe('viewport and cloning', () => {
  it('tells the server which rectangle the client is watching', async () => {
    await connectWorld();

    harness.session.updateCameraPosition(706, 436, 700, 430, 64, 48);

    // Without SetViewedArea the server's IntersectRect against the client
    // viewport always fails, so no RefreshArea/RefreshObject push ever arrives.
    expect(harness.getSockets()[0].getCapturedWrites().join('\n'))
      .toContain(`sel ${CONTEXT_ID} call SetViewedArea "*" "#700","#430","#64","#48"`);
    expect(harness.session.getPlayerPosition()).toEqual({ x: 706, y: 436 });
  });

  it('ignores a degenerate viewport and a session that cannot receive pushes', async () => {
    await connectWorld();

    harness.session.updateCameraPosition(1, 1, 700, 430, 0, 48);
    harness.session.updateCameraPosition(1, 1, 700, 430, 64, 0);
    expect(harness.getSockets()[0].getCapturedWrites()).toHaveLength(0);

    harness.session.deleteSocket('world');
    harness.session.updateCameraPosition(1, 1, 700, 430, 64, 48);
    harness.session.setWorldContextId(null);
    harness.session.updateCameraPosition(1, 1, 700, 430, 64, 48);
    expect(harness.getSockets()[0].getCapturedWrites()).toHaveLength(0);
  });

  it('clones a facility on the ClientView, never on the building', async () => {
    await connectWorld();
    harness.session.setTycoonId('4666201923');

    harness.session.cloneFacility(706, 436, 3);

    // Delphi: TClientView.CloneFacility(x, y, options, useless, tycoonId: integer)
    // — ManagementSheet.pas:388-403. A void procedure: "*", no QueryId.
    expect(harness.getSockets()[0].getCapturedWrites().join('\n'))
      .toContain(`sel ${CONTEXT_ID} call CloneFacility "*" "#706","#436","#3","#0","#4666201923"`);
  });

  it('refuses to clone without a ClientView, a tycoon or a socket', async () => {
    await connectWorld();
    harness.session.setWorldContextId(null);
    expect(() => harness.session.cloneFacility(1, 2, 3)).toThrow('World context not initialized');

    harness.session.setWorldContextId(CONTEXT_ID);
    expect(() => harness.session.cloneFacility(1, 2, 3)).toThrow('Tycoon ID not available');

    harness.session.setTycoonId('4666201923');
    harness.session.deleteSocket('world');
    expect(() => harness.session.cloneFacility(1, 2, 3)).toThrow('World socket not available');
  });
});

describe('executeRdo — the generic escape hatch', () => {
  it('refuses a service that is not connected', async () => {
    await expect(harness.session.executeRdo('construction', { verb: RdoVerb.IDOF, targetId: 'World' }))
      .rejects.toThrow('Service construction not connected');
  });

  it('returns the raw payload of whatever it was asked to send', async () => {
    await connectWorld();

    const payload = await harness.session.executeRdo('world', {
      verb: RdoVerb.SEL, targetId: CONTEXT_ID, action: RdoAction.GET, member: 'TycoonId',
    });

    expect(payload).toBe('TycoonId="#22"');
  });

  it('reports an empty answer as an empty string', async () => {
    await connectWorld();
    const silent = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [], fallbackResponses: [{ member: 'Ping', payload: '' }],
        disableStrictValidation: true,
      }],
    });
    await silent.session.createSocket('world', WORLD.ip, WORLD.port);

    await expect(silent.session.executeRdo('world', {
      verb: RdoVerb.SEL, targetId: CONTEXT_ID, action: RdoAction.GET, member: 'Ping',
    }, TimeoutCategory.FAST)).resolves.toBe('');

    silent.session.destroy();
    silent.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sendRdoRequest — buffering, guards, ids
// ═══════════════════════════════════════════════════════════════════════════

const GET_TYCOON: Partial<RdoPacket> = {
  verb: RdoVerb.SEL, targetId: CONTEXT_ID, action: RdoAction.GET, member: 'TycoonId',
};

describe('sendRdoRequest — refusals', () => {
  it('rejects once the session is closing', async () => {
    await connectWorld();
    internals(harness).isClosing = true;

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST))
      .rejects.toThrow('Session is closing');
  });

  it('rejects a request for a socket that is not open', async () => {
    await expect(harness.session.sendRdoRequest('mail', GET_TYCOON, undefined, TimeoutCategory.FAST))
      .rejects.toThrow('Socket mail not active');
  });

  // The two separator-guard tests that stood here are gone with the guards.
  // `"*"` on a function and `"^"` on a procedure were rejected at run time by
  // assertNotVoidPush / assertNotVariantOnVoidMember; the separator is now
  // derived from the member's kind (shared/rdo-members.ts) and cannot be stated
  // at a call site, so neither frame can be built to begin with.
  // shared/rdo-frame.test.ts covers the derivation.

  it('lets a VOID_MEMBER through with the void separator and a QueryId', async () => {
    await connectWorld();
    const voidHarness = createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [], fallbackResponses: [{ member: 'AddLine', payload: '' }],
        disableStrictValidation: true,
      }],
    });
    await voidHarness.session.createSocket('mail', '1.2.3.5', 1234);

    // The reference client's form: `C 2174 sel … call AddLine "*" "%text";` → `A2174 ;`
    await expect(voidHarness.session.sendRdoRequest('mail', {
      verb: RdoVerb.SEL, targetId: '30430748', action: RdoAction.CALL,
      member: 'AddLine', separator: '"*"', args: ['"%test message"'],
    }, undefined, TimeoutCategory.NORMAL)).resolves.toBeDefined();
    expect(voidHarness.getCapturedCommands(0)[0]).toMatch(/^C \d+ sel 30430748 call AddLine "\*"/);

    voidHarness.session.destroy();
    voidHarness.cleanup();
  });
});

describe('sendRdoRequest — ServerBusy buffering', () => {
  it('buffers instead of sending while the server says it is busy', async () => {
    await connectWorld();
    harness.session.setServerBusyFromPush(true);

    const pending = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    await flush();

    expect(harness.getCapturedCommands(0)).toHaveLength(0);
    expect(harness.session.getQueueStatus().buffered).toBe(1);

    // Releasing the flag flushes the queue through the normal path.
    harness.session.setServerBusyFromPush(false);
    await expect(pending).resolves.toMatchObject({ payload: 'TycoonId="#22"' });
    expect(harness.session.getQueueStatus().buffered).toBe(0);
  });

  it('drops a request rather than growing the buffer past its bound', async () => {
    await connectWorld();
    harness.session.setServerBusyFromPush(true);

    const buffered = Array.from({ length: 20 }, () =>
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST));
    expect(harness.session.getQueueStatus().buffered).toBe(20);

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST))
      .rejects.toThrow('Request buffer full - server busy');

    harness.session.setServerBusyFromPush(false);
    await Promise.all(buffered);
  });

  it('expires a buffered request at its own deadline instead of hanging for ever', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);
    const warn = jest.spyOn(harness.session.log, 'warn');

    const pending = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    const settled = pending.then(() => null, (err: Error) => err);

    // The deadline covers the WAIT, not just the round trip: after four failed
    // polls nothing else can ever clear the busy flag (stop@4).
    await jest.advanceTimersByTimeAsync(60_001);

    await expect(settled).resolves.toMatchObject({
      message: 'Request timeout while server busy: TycoonId',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('waiting for the server to stop being busy'));
    expect(harness.session.getQueueStatus().buffered).toBe(0);
  });

  it('disarms the wait deadline once the request is actually dispatched', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);

    const pending = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    harness.session.setServerBusyFromPush(false);
    await jest.advanceTimersByTimeAsync(120_000);

    await expect(pending).resolves.toMatchObject({ payload: 'TycoonId="#22"' });
  });

  it('lets a dispatched request own its deadline instead of cancelling it twice', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);

    // Buffered, then dispatched, then never answered. The wait timer fires
    // AFTER the dispatch, finds the entry gone, and leaves the in-flight
    // request to its own deadline rather than rejecting it early.
    const pending = harness.session.sendRdoRequest(
      'world', { ...GET_TYCOON, member: 'NeverAnswered' }, 40_000, TimeoutCategory.NORMAL);
    const settled = pending.then(() => null, (err: Error) => err);

    harness.session.setServerBusyFromPush(false);
    await jest.advanceTimersByTimeAsync(41_000);

    await expect(settled).resolves.toMatchObject({ message: 'Request timeout: NeverAnswered' });
  });

  it('names an anonymous request "request" when it expires in the queue', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);
    const warn = jest.spyOn(harness.session.log, 'warn');

    const pending = harness.session.sendRdoRequest('world', {
      verb: RdoVerb.SEL, targetId: CONTEXT_ID, action: RdoAction.GET,
    }, 30_000, TimeoutCategory.FAST);
    const settled = pending.then(() => null, (err: Error) => err);
    await jest.advanceTimersByTimeAsync(31_000);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Buffer] request expired after'));
    await expect(settled).resolves.toMatchObject({
      message: 'Request timeout while server busy: unknown',
    });
  });

  it('flushes the buffer one request at a time, not as a burst', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);

    const pending = [
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST),
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST),
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST),
    ];

    harness.session.setServerBusyFromPush(false);
    await jest.advanceTimersByTimeAsync(10);
    expect(harness.getCapturedCommands(0).length).toBe(1);

    await jest.advanceTimersByTimeAsync(200);
    expect(harness.getCapturedCommands(0).length).toBe(3);
    await Promise.all(pending);
  });

  it('stops flushing when the server goes busy again mid-drain', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.setServerBusyFromPush(true);
    const pending = [
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST),
      harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST),
    ];

    harness.session.setServerBusyFromPush(false);
    await jest.advanceTimersByTimeAsync(10);
    harness.session.setServerBusyFromPush(true);
    await jest.advanceTimersByTimeAsync(500);

    expect(harness.getCapturedCommands(0).length).toBe(1);
    expect(harness.session.getQueueStatus().buffered).toBe(1);

    harness.session.setServerBusyFromPush(false);
    await jest.advanceTimersByTimeAsync(200);
    await Promise.all(pending);
  });
});

describe('QueryId allocation', () => {
  it('never hands out an id a pending request already owns', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const socket = await connectWorld();

    // A request that is never answered keeps its id in flight.
    const first = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const firstSettled = first.then(() => null, (err: Error) => err);
    await flush();
    const firstRid = Number(socket.getCapturedCommands()[0].match(/^C (\d+)/)![1]);

    // O-L6: rewinding the counter used to hand the same id out again, and `set`
    // would overwrite the live entry — its promise never settling.
    internals(harness).requestIdCounter = firstRid;
    await harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);

    const secondRid = Number(socket.getCapturedCommands()[1].match(/^C (\d+)/)![1]);
    expect(secondRid).not.toBe(firstRid);
    expect(internals(harness).pendingRequests.has(firstRid)).toBe(true);

    await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);
    await firstSettled;
  });
});

describe('world socket routing', () => {
  /** Populate the pool the way `reconnectWorldSocket` does. */
  async function populatePool(): Promise<void> {
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();
  }

  it('falls back to the primary socket when the pool cannot hand out a connection', async () => {
    await connectWorld();
    await populatePool();
    jest.spyOn(harness.session.getWorldPool()!, 'getConnection')
      .mockRejectedValue(new Error('all slots busy'));

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.NORMAL))
      .resolves.toMatchObject({ payload: 'TycoonId="#22"' });

    expect(harness.getCapturedCommands(0).join('\n')).toContain('get TycoonId');
    expect(harness.getPoolCapturedCommands()).toHaveLength(0);
  });

  it('reconnects on demand when the world socket vanished under a live session', async () => {
    await connectWorld();
    harness.session.deleteSocket('world');
    const reconnect = jest.spyOn(harness.session, 'attemptWorldReconnect').mockResolvedValue(undefined);
    const warn = jest.spyOn(harness.session.log, 'warn');

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST))
      .rejects.toThrow('Socket world not active');

    // Delphi RenewWorldProxy: a request that finds no transport asks for one
    // rather than failing the caller outright.
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[Session] World socket not active, attempting reconnect before request...');
  });

  it('routes onto the pool the reconnect rebuilt', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    jest.spyOn(harness.session, 'attemptWorldReconnect').mockImplementation(async () => {
      // Exactly what reconnectWorldSocket does: a new primary socket, then a
      // fresh pool populated past the session-binding frames.
      await harness.session.createSocket('world', WORLD.ip, WORLD.port);
      harness.session.initWorldPool(WORLD.ip, WORLD.port);
      harness.session.populateWorldPool();
      await flush();
    });
    harness.session.deleteSocket('world');

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.NORMAL))
      .resolves.toMatchObject({ payload: 'TycoonId="#22"' });

    expect(harness.getPoolCapturedCommands().join('\n')).toContain('get TycoonId');
  });

  it('falls back to the rebuilt primary socket when the rebuilt pool refuses', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    jest.spyOn(harness.session, 'attemptWorldReconnect').mockImplementation(async () => {
      await harness.session.createSocket('world', WORLD.ip, WORLD.port);
      harness.session.initWorldPool(WORLD.ip, WORLD.port);
      harness.session.populateWorldPool();
      await flush();
      jest.spyOn(harness.session.getWorldPool()!, 'getConnection')
        .mockRejectedValue(new Error('all slots busy'));
    });
    harness.session.deleteSocket('world');

    await expect(harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.NORMAL))
      .resolves.toMatchObject({ payload: 'TycoonId="#22"' });

    expect(harness.getPoolCapturedCommands()).toHaveLength(0);
  });
});

describe('pool slot release', () => {
  it('returns a slot at most once, however many times the request settles', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();

    const pool = harness.session.getWorldPool();
    expect(pool).not.toBeNull();
    const release = jest.spyOn(pool!, 'releaseSlot');

    const pending = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const settled = pending.then(() => null, (err: Error) => err);
    await flush();

    const entry = Array.from(internals(harness).pendingRequests.values())[0];
    entry.reject(new Error('first'));
    entry.reject(new Error('second'));

    await settled;
    expect(release).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The reverse channel — requests the SERVER sends us
// ═══════════════════════════════════════════════════════════════════════════

describe('handleServerRequest', () => {
  it('resolves a name it knows and answers on the connection that asked', async () => {
    const socket = await connectWorld();
    harness.session.setKnownObject('InterfaceEvents', '38123456');

    socket.emit('data', Buffer.from('C 99999 idof "InterfaceEvents";', 'latin1'));
    await flush();

    expect(socket.getCapturedWrites().join('\n')).toContain('A99999 objid="38123456"');
  });

  it('answers errIllegalObject for a name it does not know, instead of staying silent', async () => {
    const socket = await connectWorld();

    socket.emit('data', Buffer.from('C 99998 idof "Nonsense";', 'latin1'));
    await flush();

    // O-M2: silence blocks a thread of the SHARED server for its whole timeout
    // (WinSockRDOServerClientConnection.pas:252).
    expect(socket.getCapturedWrites().join('\n')).toContain('A99998 error 5');
  });

  it('answers the AnswerStatus heartbeat with NOERROR', async () => {
    const socket = await connectWorld();

    socket.emit('data', Buffer.from(`C 99997 sel ${CONTEXT_ID} call AnswerStatus "^";`, 'latin1'));
    await flush();

    // TISEvents.AnswerStatus — ServerCnxHandler.pas:666-669.
    expect(socket.getCapturedWrites().join('\n')).toContain('A99997 res="#0"');
  });

  it('answers errUnexistentMethod for a member it does not implement', async () => {
    const socket = await connectWorld();

    socket.emit('data', Buffer.from(`C 99996 sel ${CONTEXT_ID} call SomethingElse "^";`, 'latin1'));
    await flush();

    expect(socket.getCapturedWrites().join('\n')).toContain('A99996 error 9');
  });

  it('says nothing when the server did not ask for an answer', async () => {
    const socket = await connectWorld();
    const debug = jest.spyOn(harness.session.log, 'debug');

    // No QueryId → the server is not waiting (RDOQueryServer.pas:174-178). The
    // dispatcher already filters those out, so the guard inside the handler is
    // only reachable from here — and it is what keeps the two in agreement.
    socket.emit('data', Buffer.from('C idof "InterfaceEvents";', 'latin1'));
    await flush();
    expect(socket.getCapturedWrites()).toHaveLength(0);

    internals(harness).handleServerRequest('world', {
      raw: 'C idof "InterfaceEvents"', type: 'REQUEST', verb: RdoVerb.IDOF, targetId: 'InterfaceEvents',
    });

    expect(debug).toHaveBeenCalledWith('[Session] Server request without QueryId — nothing to answer');
    expect(socket.getCapturedWrites()).toHaveLength(0);
  });

  it('names the member of an unhandled request, and the raw frame when it has none', async () => {
    const socket = await connectWorld();
    const warn = jest.spyOn(harness.session.log, 'warn');

    socket.emit('data', Buffer.from(`C 99993 sel ${CONTEXT_ID} get Something;`, 'latin1'));
    await flush();
    expect(warn).toHaveBeenCalledWith('[Session] Unhandled server request: Something');
    expect(socket.getCapturedWrites().join('\n')).toContain('A99993 error 9');

    // A selection and nothing else — there is no member to name, so the log
    // falls back to the frame, which is the only thing left to triage with.
    socket.emit('data', Buffer.from(`C 99992 sel ${CONTEXT_ID};`, 'latin1'));
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`[Session] Unhandled server request: C 99992 sel ${CONTEXT_ID}`));
    expect(socket.getCapturedWrites().join('\n')).toContain('A99992 error 9');
  });

  it('reports that it has no socket left to answer on', async () => {
    const socket = await connectWorld();
    const warn = jest.spyOn(harness.session.log, 'warn');
    // The socket is off the map but its listeners are still attached.
    harness.session.deleteSocket('world');

    socket.emit('data', Buffer.from('C 99995 idof "InterfaceEvents";', 'latin1'));
    await flush();

    expect(warn).toHaveBeenCalledWith(
      '[Session] No socket to answer server request 99995 on world',
    );
  });
});

describe('processSingleCommand — degraded answers', () => {
  it('flips the busy flag on the malformed "Aerror 17" the busy server sends', async () => {
    const socket = await connectWorld();

    // WinSockRDOConnectionsServer.pas:812 — no RID, no terminator.
    socket.emit('data', Buffer.from('Aerror 17;', 'latin1'));
    await flush();

    expect(harness.session.getQueueStatus().serverBusy).toBe(true);
  });

  it('names an unparseable answer instead of letting a request wait out its deadline', async () => {
    const socket = await connectWorld();
    const warn = jest.spyOn(harness.session.log, 'warn');

    socket.emit('data', Buffer.from('A res="#0";', 'latin1'));
    await flush();

    // P-L7: this used to fall off the end of the chain in silence, and the
    // request it belonged to then looked like "the server is slow".
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unparseable response on world'));
    expect(harness.session.getQueueStatus().rdoMetrics.totalOrphaned).toBeGreaterThan(0);
  });

  it('emits an area refresh for a RefreshArea push and ignores an unreadable one', async () => {
    const socket = await connectWorld();
    const events = collectWsEvents(harness.session);

    socket.emit('data', Buffer.from(
      `C sel ${CONTEXT_ID} call RefreshArea "*" "#700","#430","#64","#64","%data";`, 'latin1'));
    socket.emit('data', Buffer.from(
      `C sel ${CONTEXT_ID} call RefreshArea "*" "#700";`, 'latin1'));
    await flush();

    expect(events.filter(e => e.type === WsMessageType.EVENT_AREA_REFRESH)).toHaveLength(1);
  });

  it('emits a building refresh with a placeholder when the push carries no detail', async () => {
    const socket = await connectWorld();
    const events = collectWsEvents(harness.session);

    socket.emit('data', Buffer.from(
      `C sel ${CONTEXT_ID} call RefreshObject "*" "#${CURR_BLOCK}","#0";`, 'latin1'));
    socket.emit('data', Buffer.from(
      `C sel ${CONTEXT_ID} call RefreshObject "*" "#${CURR_BLOCK}";`, 'latin1'));
    await flush();

    const refreshes = events.filter(e => e.type === WsMessageType.EVENT_BUILDING_REFRESH);
    expect(refreshes).toHaveLength(1);
    // No focus → the placeholder pins the origin at (0, 0) rather than dropping it.
    expect(refreshes[0].building).toMatchObject({ buildingId: CURR_BLOCK, x: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Maintenance mode
// ═══════════════════════════════════════════════════════════════════════════

describe('maintenance mode', () => {
  /** A socket that answers every GET with ERROR_ModelServerIsDown. */
  function downHarness(): ProtocolTestHarness {
    return createProtocolTestHarness({
      socketConfigs: [{
        rdoScenarios: [],
        fallbackResponses: [{ member: 'TycoonId', payload: 'error 20' }],
        disableStrictValidation: true,
      }],
    });
  }

  it('enters maintenance after three model-server-down answers, and announces it once', async () => {
    const down = downHarness();
    await down.session.createSocket('world', WORLD.ip, WORLD.port);
    const events = collectWsEvents(down.session);

    for (let i = 0; i < 4; i++) {
      await down.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST)
        .catch(() => { /* the contract may reject; the counter is what matters */ });
    }

    // Delphi MaxDownCountAllowed = 3; our divergence counts error responses
    // rather than reconnect attempts (see the method's own note).
    expect(down.session.getQueueStatus().maintenanceMode).toBe(true);
    const announcements = events.filter(e => e.type === WsMessageType.EVENT_MAINTENANCE);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].active).toBe(true);

    down.session.destroy();
    down.cleanup();
  });

  it('leaves maintenance on the first successful answer', async () => {
    const down = downHarness();
    await down.session.createSocket('world', WORLD.ip, WORLD.port);
    const socket = down.getSockets()[0];

    for (let i = 0; i < 3; i++) {
      await down.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST).catch(() => undefined);
    }
    expect(down.session.getQueueStatus().maintenanceMode).toBe(true);

    const events = collectWsEvents(down.session);
    socket.addFallbackResponse({ member: 'Recovered', payload: 'Recovered="#1"' });
    await down.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'Recovered' }, undefined, TimeoutCategory.FAST);

    expect(down.session.getQueueStatus().maintenanceMode).toBe(false);
    expect(events.filter(e => e.type === WsMessageType.EVENT_MAINTENANCE)[0].active).toBe(false);

    down.session.destroy();
    down.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Background timers
// ═══════════════════════════════════════════════════════════════════════════

describe('background timers', () => {
  it('starts the ServerBusy poll once, whatever the caller does', async () => {
    await connectWorld();

    harness.session.startServerBusyPolling();
    const first = internals(harness).serverBusyCheckInterval;
    harness.session.startServerBusyPolling();

    expect(internals(harness).serverBusyCheckInterval).toBe(first);
  });

  it('skips a poll tick while the session is reconnecting or logging in', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const socket = await connectWorld();
    harness.session.setPhase(SessionPhase.RECONNECTING);
    harness.session.startServerBusyPolling();

    await jest.advanceTimersByTimeAsync(120_000);

    // A query on a half-ready socket is worse than a missed sample.
    expect(socket.getCommandsByMember('ServerBusy')).toHaveLength(0);
  });

  it('starts the GC sweep once and orphans entries no late answer ever claimed', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    harness.session.startGcSweep();
    const sweep = internals(harness).gcSweepInterval;
    harness.session.startGcSweep();
    expect(internals(harness).gcSweepInterval).toBe(sweep);

    const pending = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const settled = pending.then(() => null, (err: Error) => err);

    // Time out first, then outlive the 90 s late-response grace period.
    await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);
    await settled;
    expect(harness.session.getQueueStatus().timedOutAwaitingLate).toBe(1);

    await jest.advanceTimersByTimeAsync(90_000 + 60_000);

    expect(harness.session.getQueueStatus().pendingRdoRequests).toBe(0);
    expect(harness.session.getQueueStatus().rdoMetrics.totalOrphaned).toBe(1);
  });

  it('keeps the inspector alive and stops the moment its socket disappears', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    await harness.session.connectMapService();
    const ctx = harness.session as unknown as SessionContext;
    setActiveInspectorForTest(ctx, fakeInspector(TEMP_OBJECT_ID));

    await jest.advanceTimersByTimeAsync(60_100);
    expect(harness.getSockets()[1].getCapturedWrites().join('\n'))
      .toContain(`sel ${TEMP_OBJECT_ID} call KeepAlive "*"`);

    harness.session.deleteSocket('map');
    await jest.advanceTimersByTimeAsync(60_100);

    // No temp object and no socket → nothing to keep alive, timer stops.
    expect(internals(harness).keepAliveInterval).toBeNull();
    releaseInspector(ctx);
  });

  it('reports a KeepAlive it could not build instead of tearing the timer down', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    await harness.session.connectMapService();
    const ctx = harness.session as unknown as SessionContext;
    const warn = jest.spyOn(harness.session.log, 'warn');
    setActiveInspectorForTest(ctx, fakeInspector(TEMP_OBJECT_ID));
    // The socket is in the map but the write fails — a half-dead connection.
    jest.spyOn(harness.getSockets()[1], 'write').mockImplementation(() => { throw new Error('EPIPE'); });

    await jest.advanceTimersByTimeAsync(60_100);

    expect(warn).toHaveBeenCalledWith('[KeepAlive] Failed:', expect.any(String));
    expect(internals(harness).keepAliveInterval).not.toBeNull();
    releaseInspector(ctx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// World pool wiring
// ═══════════════════════════════════════════════════════════════════════════

describe('world pool wiring', () => {
  it('closes the pool it is replacing rather than leaking its sockets', async () => {
    await connectWorld();
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    const first = harness.session.getWorldPool();
    const close = jest.spyOn(first!, 'close');

    harness.session.initWorldPool(WORLD.ip, WORLD.port);

    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.session.getWorldPool()).not.toBe(first);
  });

  it('says out loud that the pool stays empty while the policy is off', async () => {
    await connectWorld();
    const info = jest.spyOn(harness.session.log, 'info');
    harness.session.initWorldPool(WORLD.ip, WORLD.port);

    harness.session.populateWorldPool();

    expect(info).toHaveBeenCalledWith(expect.stringContaining('RDO_WORLD_POOL is off'));
    expect(harness.session.getWorldPool()!.size).toBe(0);
  });

  it('does nothing when there is no pool to populate', () => {
    expect(() => harness.session.populateWorldPool()).not.toThrow();
    expect(harness.session.getWorldPool()).toBeNull();
  });

  it('reads a frame that arrived on a pool connection, and answers it there', async () => {
    await connectWorld();
    harness.session.setKnownObject('InterfaceEvents', '38123456');
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();

    const poolSocket = harness.getPoolSockets()[0];
    expect(poolSocket).toBeDefined();
    poolSocket.emit('data', Buffer.from('C 99994 idof "InterfaceEvents";', 'latin1'));
    await flush();

    // O-L1: Delphi parks the pending query on the connection object
    // (WinSockRDOServerClientConnection.pas:227-252); a reply on another socket
    // never signals it.
    expect(poolSocket.getCapturedWrites().join('\n')).toContain('A99994 objid="38123456"');
    expect(harness.getSockets()[0].getCapturedWrites().join('\n')).not.toContain('A99994');
  });

  it('survives a frame the pool connection could not hand off', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();
    const error = jest.spyOn(harness.session.log, 'error');
    jest.spyOn(RdoProtocol, 'parse').mockImplementationOnce(() => { throw new Error('unreadable'); });

    harness.getPoolSockets()[0].emit('data', Buffer.from('A1 res="#0";', 'latin1'));
    await flush();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('[Pool] Error processing RDO frame'));
  });

  it('says nothing when one pool connection of several closes', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();
    const reconnect = jest.spyOn(harness.session, 'attemptWorldReconnect').mockResolvedValue(undefined);

    // Two concurrent reads: the second finds the first connection busy, so the
    // pool grows rather than queueing behind it.
    const inFlight = [
      harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
        undefined, TimeoutCategory.NORMAL),
      harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'AlsoNeverAnswered' },
        undefined, TimeoutCategory.NORMAL),
    ].map(p => p.then(() => null, (err: Error) => err));
    await flush();
    expect(harness.getPoolSockets().length).toBeGreaterThan(1);

    harness.getPoolSockets()[0].destroy();
    await flush();
    await flush();

    // Only an empty pool means the transport is gone.
    expect(reconnect).not.toHaveBeenCalled();

    harness.session.destroy();
    await Promise.all(inFlight);
  });

  it('reconnects when the last pool connection closes under a live session', async () => {
    await connectWorld();
    harness.session.setWorldPoolEnabled(true);
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    harness.session.populateWorldPool();
    await flush();
    const reconnect = jest.spyOn(harness.session, 'attemptWorldReconnect')
      .mockRejectedValue(new Error('still down'));
    const error = jest.spyOn(harness.session.log, 'error');

    for (const socket of harness.getPoolSockets()) socket.destroy();
    await flush();
    await flush();

    expect(reconnect).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[Pool] World reconnect failed:', 'still down');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reconnection housekeeping
// ═══════════════════════════════════════════════════════════════════════════

describe('attemptWorldReconnect — housekeeping', () => {
  it('drains the pool and rejects the world traffic that was waiting', async () => {
    await connectWorld();
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    const pool = harness.session.getWorldPool();
    const drain = jest.spyOn(pool!, 'drainAll');
    jest.spyOn(harness.session, 'sendRdoRequest');
    const reconnectHandler = jest
      .spyOn(await import('../session/login-handler'), 'reconnectWorldSocket')
      .mockResolvedValue(undefined);

    harness.session.setServerBusyFromPush(true);
    const worldRequest = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    const mailRequest = harness.session.sendRdoRequest('mail', GET_TYCOON, undefined, TimeoutCategory.FAST);
    const worldSettled = worldRequest.then(() => null, (err: Error) => err);
    const mailSettled = mailRequest.then(() => null, (err: Error) => err);
    expect(harness.session.getQueueStatus().buffered).toBe(2);

    await harness.session.attemptWorldReconnect();

    expect(drain).toHaveBeenCalledTimes(1);
    expect(harness.session.getWorldPool()).toBeNull();
    // Buffered world frames belong to a session that no longer exists…
    await expect(worldSettled).resolves.toMatchObject({ message: 'World socket reconnecting' });
    // …but a buffered mail frame is untouched by a world reconnect.
    expect(harness.session.getQueueStatus().buffered).toBe(1);
    expect(reconnectHandler).toHaveBeenCalled();

    harness.session.destroy();
    await expect(mailSettled).resolves.toMatchObject({ message: 'Session destroyed' });
  });

  it('logs a failure to flush the buffer rather than rejecting the reconnect', async () => {
    await connectWorld();
    jest.spyOn(await import('../session/login-handler'), 'reconnectWorldSocket').mockResolvedValue(undefined);
    const error = jest.spyOn(harness.session.log, 'error');
    jest.spyOn(internals(harness), 'processBufferedRequests')
      .mockRejectedValue(new Error('flush exploded'));

    await expect(harness.session.attemptWorldReconnect()).resolves.toBeUndefined();
    await flush();

    expect(error).toHaveBeenCalledWith('[Reconnect] Error flushing buffered requests:', expect.any(Error));
  });

  it('waits the slow-phase interval once the fast attempts are spent', async () => {
    await connectWorld();
    const reconnectHandler = jest
      .spyOn(await import('../session/login-handler'), 'reconnectWorldSocket')
      .mockResolvedValue(undefined);
    // Divergence D3: 3 fast attempts (5/10/20 s), then 20 slow ones at 15 s.
    internals(harness).worldReconnectAttempts = 4;
    internals(harness).worldReconnectLastAttempt = 0;

    await harness.session.attemptWorldReconnect();

    expect(reconnectHandler).toHaveBeenCalledTimes(1);
    expect(internals(harness).worldReconnectAttempts).toBe(0);
  });

  it('leaves a timed-out request alone while draining, and cleans up no socket it did not open', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    const pending = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const settled = pending.then(() => null, (err: Error) => err);
    await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);
    await expect(settled).resolves.toMatchObject({ message: 'Request timeout: NeverAnswered' });
    expect(harness.session.getQueueStatus().timedOutAwaitingLate).toBe(1);

    // The reconnect fails and there is no half-open socket to tidy away: the
    // world socket was already dropped when it closed.
    jest.spyOn(await import('../session/login-handler'), 'reconnectWorldSocket')
      .mockRejectedValue(new Error('still down'));
    harness.session.deleteSocket('world');
    internals(harness).worldReconnectLastAttempt = 0;

    await expect(harness.session.attemptWorldReconnect()).rejects.toThrow('still down');

    // The already-timed-out entry is dropped, not rejected a second time.
    expect(harness.session.getQueueStatus().pendingRdoRequests).toBe(0);
  });

  it('does not reconnect while the session is being destroyed', async () => {
    await connectWorld();
    const reconnectHandler = jest
      .spyOn(await import('../session/login-handler'), 'reconnectWorldSocket')
      .mockResolvedValue(undefined);
    internals(harness).isClosing = true;

    await harness.session.attemptWorldReconnect();

    expect(reconnectHandler).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Teardown
// ═══════════════════════════════════════════════════════════════════════════

describe('savePlayerPosition', () => {
  it('writes both cookies as void pushes on the ClientView', async () => {
    await connectWorld();
    harness.session.setTycoonId('4666201923');
    harness.session.setLastPlayerX(706);
    harness.session.setLastPlayerY(436);

    await harness.session.savePlayerPosition();

    const writes = harness.getSockets()[0].getCapturedWrites().join('\n');
    expect(writes).toContain(`sel ${CONTEXT_ID} call SetTycoonCookie "*" "#4666201923","%LastX.0","%706"`);
    expect(writes).toContain(`sel ${CONTEXT_ID} call SetTycoonCookie "*" "#4666201923","%LastY.0","%436"`);
  });

  it('saves nothing without a session, and nothing at the origin', async () => {
    await harness.session.savePlayerPosition();

    await connectWorld();
    harness.session.setTycoonId('4666201923');
    await harness.session.savePlayerPosition(); // still at (0, 0)

    expect(harness.getAllCapturedCommands()).toHaveLength(0);
    expect(harness.getSockets()[0].getCapturedWrites()).toHaveLength(0);
  });

  it('gives up quietly when the socket is already gone', async () => {
    await connectWorld();
    harness.session.setTycoonId('4666201923');
    harness.session.setLastPlayerX(706);
    harness.session.getSocket('world')!.destroy();

    await expect(harness.session.savePlayerPosition()).resolves.toBeUndefined();
  });

  it('never lets a failed save block the logoff it precedes', async () => {
    await connectWorld();
    harness.session.setTycoonId('not-an-id');
    harness.session.setLastPlayerX(706);
    const debug = jest.spyOn(harness.session.log, 'debug');

    await expect(harness.session.savePlayerPosition()).resolves.toBeUndefined();

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Failed to save position'));
  });
});

describe('endSession', () => {
  it('skips the Logoff round trip while the server is busy', async () => {
    const socket = await connectWorld();
    harness.session.setServerBusyFromPush(true);

    await harness.session.endSession();

    // A buffered Logoff would hang the logout; the socket close alone triggers
    // the authoritative server-side teardown.
    const writes = socket.getCapturedWrites().join('\n');
    expect(writes).toContain('call ClientNotAware "*"');
    expect(writes).not.toContain('get Logoff');
  });

  it('destroys the socket when a graceful close is refused', async () => {
    const socket = await connectWorld();
    jest.spyOn(socket, 'end').mockImplementation(() => { throw new Error('EPIPE'); });
    const destroy = jest.spyOn(socket, 'destroy');

    await harness.session.endSession();

    expect(destroy).toHaveBeenCalled();
  });

  it('does not talk to a socket that is already destroyed', async () => {
    const socket = await connectWorld();
    socket.destroyed = true;

    await harness.session.endSession();

    expect(socket.getCapturedWrites()).toHaveLength(0);
    expect(internals(harness).loggedOff).toBe(true);
  });
});

describe('cleanupWorldSession — switching servers', () => {
  it('returns the session to a directory-only state, ready for another world', async () => {
    const socket = await connectWorld();
    harness.session.setTycoonId('4666201923');
    harness.session.setCacherId(CACHER_ID);
    harness.session.setWorldId(WORLD_OBJECT_ID);
    harness.session.setDaPort(7001);
    harness.session.setInterfaceServerId(INTERFACE_SERVER_ID);
    harness.session.setCurrentCompany({ id: '55', name: 'SPO_test3 - Green' });
    harness.session.setAvailableCompanies([{ id: '55', name: 'SPO_test3 - Green' }]);
    harness.session.setKnownObject('InterfaceEvents', '38123456');
    harness.session.initWorldPool(WORLD.ip, WORLD.port);
    const pool = harness.session.getWorldPool();
    const closePool = jest.spyOn(pool!, 'close');
    harness.session.startServerBusyPolling();
    harness.session.startGcSweep();

    // One request in flight and one buffered, both of which must be released.
    const inFlight = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const inFlightSettled = inFlight.then(() => null, (err: Error) => err);
    await flush();
    harness.session.setServerBusyFromPush(true);
    const buffered = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    const bufferedSettled = buffered.then(() => null, (err: Error) => err);

    await harness.session.cleanupWorldSession();

    await expect(inFlightSettled).resolves.toMatchObject({ message: 'Session cleaned up for server switch' });
    await expect(bufferedSettled).resolves.toMatchObject({ message: 'Session cleaned up for server switch' });
    expect(socket.destroyed).toBe(true);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(harness.session.getWorldPool()).toBeNull();
    expect(internals(harness).serverBusyCheckInterval).toBeNull();
    expect(internals(harness).gcSweepInterval).toBeNull();

    // World-level state is gone; credentials and the world list survive.
    expect(harness.session.worldContextId).toBeNull();
    expect(harness.session.tycoonId).toBeNull();
    expect(harness.session.cacherId).toBeNull();
    expect(harness.session.currentCompany).toBeNull();
    expect(harness.session.getAvailableCompanies()).toEqual([]);
    expect(harness.session.getSocketNames()).toEqual([]);
    expect(harness.session.getQueueStatus().serverBusy).toBe(false);
    // Re-armed: the next world session may log off gracefully again.
    expect(internals(harness).loggedOff).toBe(false);
    expect(harness.session.getPhase()).toBe(SessionPhase.DIRECTORY_CONNECTED);
  });

  it('drops a timed-out request without rejecting it a second time', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    await connectWorld();
    const pending = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const settled = pending.then(() => null, (err: Error) => err);
    await jest.advanceTimersByTimeAsync(IS_PROXY_TIMEOUT_MS + 1_000);
    await settled;
    // One pending and one timed-out entry, so the sweep sees both states.
    const stillPending = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'AlsoNeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const stillSettled = stillPending.then(() => null, (err: Error) => err);
    await flush();
    expect(harness.session.getQueueStatus()).toMatchObject({ pendingRdoRequests: 2, timedOutAwaitingLate: 1 });

    await harness.session.cleanupWorldSession();

    await expect(stillSettled).resolves.toMatchObject({ message: 'Session cleaned up for server switch' });
    expect(harness.session.getQueueStatus().pendingRdoRequests).toBe(0);
  });

  it('reports a socket it could not close rather than abandoning the cleanup', async () => {
    const socket = await connectWorld();
    jest.spyOn(socket, 'destroy').mockImplementationOnce(() => { throw new Error('EBADF'); });
    const error = jest.spyOn(harness.session.log, 'error');

    await harness.session.cleanupWorldSession();

    expect(error).toHaveBeenCalledWith('[Session] Error closing socket world:', expect.any(Error));
    expect(harness.session.getPhase()).toBe(SessionPhase.DIRECTORY_CONNECTED);
  });
});

describe('destroy', () => {
  it('rejects everything in flight and everything queued', async () => {
    await connectWorld();
    const inFlight = harness.session.sendRdoRequest('world', { ...GET_TYCOON, member: 'NeverAnswered' },
      undefined, TimeoutCategory.NORMAL);
    const inFlightSettled = inFlight.then(() => null, (err: Error) => err);
    await flush();
    harness.session.setServerBusyFromPush(true);
    const buffered = harness.session.sendRdoRequest('world', GET_TYCOON, undefined, TimeoutCategory.FAST);
    const bufferedSettled = buffered.then(() => null, (err: Error) => err);

    harness.session.destroy();

    await expect(inFlightSettled).resolves.toMatchObject({ message: 'Session destroyed' });
    await expect(bufferedSettled).resolves.toMatchObject({ message: 'Session destroyed' });
    expect(harness.session.getPhase()).toBe(SessionPhase.DISCONNECTED);
    // Credentials are zeroed out, not merely unreferenced.
    expect(harness.session.cachedUsername).toBeNull();
    expect(harness.session.cachedPassword).toBeNull();
  });

  it('reports a socket it could not close rather than leaving the rest open', async () => {
    const socket = await connectWorld();
    jest.spyOn(socket, 'destroy').mockImplementationOnce(() => { throw new Error('EBADF'); });
    const error = jest.spyOn(harness.session.log, 'error');

    harness.session.destroy();

    expect(error).toHaveBeenCalledWith('[Session] Error closing socket world:', expect.any(Error));
    expect(harness.session.getSocketNames()).toEqual([]);
  });
});
