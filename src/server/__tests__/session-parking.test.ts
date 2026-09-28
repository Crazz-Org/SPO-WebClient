/**
 * Session parking (#1045), driven with real `ws` clients against the gateway's real WebSocket
 * upgrade wiring (`mountWebSocketGateway`) on this test's own `http.Server` at 127.0.0.1:0 —
 * never 8080, never `startGateway()` (pattern of gateway-drain.test.ts).
 *
 * `StarpeaceSession` is a SUBCLASS of the real one: only the directory / login / company steps
 * are short-circuited. Its world socket is a real TCP connection to a fake `net.Server` standing
 * in for the Interface Server, so the real `endSession()` (ClientNotAware, get Logoff, 5 s
 * timeout), `destroy()` and teardown run and write real frames, which the fake server records in
 * arrival order. TRUST_PROXY=true lets each client claim its own IP through X-Forwarded-For.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as http from 'http';
import * as net from 'net';
import WebSocket from 'ws';

type ServerModule = typeof import('../server');

interface FrameRecord { conn: number; frame: string }
interface MockIS {
  port: number;
  frames: FrameRecord[];
  conns: net.Socket[];
  closed: boolean[];
  answerLogoff: boolean;
}

const mockIS: MockIS = { port: 0, frames: [], conns: [], closed: [], answerLogoff: true };
const mockWorld = { name: 'Planitia', url: 'http://127.0.0.1/', ip: '127.0.0.1', port: 80 };

interface FakeSessionShape {
  log: Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;
  endSession: jest.Mock;
  destroy: jest.Mock;
  emit(event: string, ...args: unknown[]): boolean;
  getSocket(name: string): net.Socket | undefined;
}
const mockSessions: FakeSessionShape[] = [];

jest.mock('../spo_session', () => {
  const actual = jest.requireActual<typeof import('../spo_session')>('../spo_session');
  const { SessionPhase: Phase } = jest.requireActual<typeof import('../../shared/types')>('../../shared/types');
  const { rdoCall } = jest.requireActual<typeof import('../../shared/rdo-frame')>('../../shared/rdo-frame');
  const { RdoValue } = jest.requireActual<typeof import('../../shared/rdo-types')>('../../shared/rdo-types');
  const { TimeoutCategory: TC } = jest.requireActual<typeof import('../../shared/timeout-categories')>('../../shared/timeout-categories');

  class FakeSession extends actual.StarpeaceSession {
    constructor() {
      super();
      this.setWorldPoolEnabled(false);
      for (const level of ['info', 'warn', 'error', 'debug'] as const) jest.spyOn(this.log, level);
      jest.spyOn(this as unknown as { endSession: () => Promise<void> }, 'endSession');
      jest.spyOn(this as unknown as { destroy: () => void }, 'destroy');
      mockSessions.push(this as unknown as FakeSessionShape);
    }
    override async connectDirectory(): Promise<import('../../shared/types').WorldInfo[]> {
      this.setPhase(Phase.DIRECTORY_CONNECTED);
      return [mockWorld];
    }
    override getWorldInfo(name: string): import('../../shared/types').WorldInfo | undefined {
      return name === mockWorld.name ? mockWorld : undefined;
    }
    override async loginWorld(username: string, pass: string): Promise<import('../session/login-handler').LoginWorldResult> {
      if (!this.getSocket('world')) await this.createSocket('world', '127.0.0.1', mockIS.port);
      this.setInterfaceServerId('100');
      await this.sendRdoRequest(
        'world',
        rdoCall('AccountStatus', '100', RdoValue.string(username), RdoValue.string(pass)).packet,
        5000,
        TC.FAST,
      );
      this.setPhase(Phase.WORLD_CONNECTING);
      return { tycoonId: '77', contextId: '200', companies: [], worldXSize: 1000, worldYSize: 900, worldSeason: 2 } as unknown as import('../session/login-handler').LoginWorldResult;
    }
    override async selectCompany(companyId: string): Promise<void> {
      if (!this.getSocket('world')) await this.createSocket('world', '127.0.0.1', mockIS.port);
      this.setWorldContextId('200');
      this.tycoonId = '77';
      this.currentWorldInfo = mockWorld;
      this.currentCompany = { id: companyId, name: 'Acme', ownerRole: 'SPO_test3' };
      this.setLastPlayerX(10);
      this.setLastPlayerY(20);
      this.setPhase(Phase.WORLD_CONNECTED);
    }
  }
  return { ...actual, StarpeaceSession: FakeSession };
});

const PARK_MS = 60_000;
const LOGOFF_TIMEOUT_MS = 5000;
const REFUSED = { type: 'RESP_ERROR', code: 15, errorMessage: 'Session cannot be resumed' };
const FAKE_OPTS: Parameters<typeof jest.useFakeTimers>[0] = {
  doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'hrtime', 'performance'],
};

/** Wall-clock poll that keeps working while timers (and Date) are faked. */
async function until(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = process.hrtime.bigint();
  while (!cond()) {
    if (Number(process.hrtime.bigint() - start) / 1e6 > timeoutMs) throw new Error('until: timed out');
    await new Promise(r => setImmediate(r));
  }
}
/** Let pending I/O run for a while, whatever the timers are. */
async function settle(ms = 60): Promise<void> {
  const start = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - start) / 1e6 < ms) await new Promise(r => setImmediate(r));
}

const framesOf = (conn: number) => mockIS.frames.filter(f => f.conn === conn).map(f => f.frame);
const has = (conn: number, member: string) => framesOf(conn).some(f => new RegExp(`\\b${member}\\b`).test(f) && !f.startsWith('ANSWER'));
const indexOf = (pred: (f: FrameRecord) => boolean) => mockIS.frames.findIndex(pred);
const logged = (s: FakeSessionShape, msg: string) => s.log.info.mock.calls.some((c: unknown[]) => c[0] === msg);

describe('session parking', () => {
  let mod: ServerModule;
  let own: http.Server;
  let fakeIS: net.Server;
  let port: number;
  let clients: WebSocket[];
  const saved: Record<string, string | undefined> = {};
  const ENV = ['SINGLE_USER_MODE', 'TRUST_PROXY', 'SPO_SESSION_PARK_MS', 'SPO_MAX_PARKED_SESSIONS'];

  beforeEach(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    delete process.env.SINGLE_USER_MODE;
    process.env.TRUST_PROXY = 'true';
    process.env.SPO_SESSION_PARK_MS = String(PARK_MS);
    if (expect.getState().currentTestName?.includes('cap reached')) process.env.SPO_MAX_PARKED_SESSIONS = '1';
    else delete process.env.SPO_MAX_PARKED_SESSIONS;

    mockSessions.length = 0;
    mockIS.frames = [];
    mockIS.conns = [];
    mockIS.closed = [];
    mockIS.answerLogoff = true;
    clients = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);

    fakeIS = net.createServer(sock => {
      const id = mockIS.conns.push(sock) - 1;
      mockIS.closed[id] = false;
      let buf = '';
      sock.on('data', chunk => {
        buf += chunk.toString('latin1');
        let i: number;
        while ((i = buf.indexOf(';')) !== -1) {
          const frame = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          mockIS.frames.push({ conn: id, frame });
          const rid = /^C\s*(\d+)\s/.exec(frame)?.[1];
          if (!rid) continue;
          if (/\bLogoff\b/.test(frame)) {
            if (!mockIS.answerLogoff) continue;
            mockIS.frames.push({ conn: id, frame: 'ANSWER Logoff' });
          }
          sock.write(`A${rid} res="#0";`);
        }
      });
      sock.on('close', () => { mockIS.closed[id] = true; });
      sock.on('error', () => undefined);
    });
    await new Promise<void>(r => fakeIS.listen(0, '127.0.0.1', () => r()));
    mockIS.port = (fakeIS.address() as net.AddressInfo).port;

    jest.resetModules();
    jest.useFakeTimers();
    mod = require('../server') as ServerModule;
    jest.clearAllTimers(); // the module-load heartbeat and every other load-time timer
    jest.useRealTimers();

    own = http.createServer();
    mod.mountWebSocketGateway(own);
    await new Promise<void>(r => own.listen(0, '127.0.0.1', () => r()));
    port = (own.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    jest.useRealTimers();
    await Promise.all(clients.map(c => new Promise<void>(resolve => {
      if (c.readyState === WebSocket.CLOSED) return resolve();
      c.once('close', () => resolve());
      c.terminate();
    })));
    await settle(20);
    // End whatever is still parked, so no world socket outlives the test
    await mod.connectionDrain.drain();
    own.closeAllConnections();
    await new Promise<void>(r => (own.listening ? own.close(() => r()) : r()));
    for (const s of mockIS.conns) s.destroy();
    await new Promise<void>(r => fakeIS.close(() => r()));
    jest.restoreAllMocks();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  interface Client {
    ws: WebSocket;
    msgs: Array<Record<string, unknown>>;
    closed: Promise<number>;
    send(msg: Record<string, unknown>): void;
    waitFor(type: string, count?: number): Promise<Record<string, unknown>>;
  }

  async function connect(ip: string, opts: WebSocket.ClientOptions = {}): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { 'x-forwarded-for': ip },
      ...opts,
    });
    clients.push(ws);
    const msgs: Array<Record<string, unknown>> = [];
    ws.on('message', (d: Buffer) => msgs.push(JSON.parse(d.toString()) as Record<string, unknown>));
    const closed = new Promise<number>(r => ws.once('close', (code: number) => r(code)));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const byType = (type: string) => msgs.filter(m => m.type === type);
    return {
      ws,
      msgs,
      closed,
      send: m => ws.send(JSON.stringify(m)),
      waitFor: async (type, count = 1) => {
        try {
          await until(() => byType(type).length >= count);
        } catch {
          throw new Error(`waitFor ${type} x${count}: got ${JSON.stringify(msgs.map(m => m.type))}`);
        }
        return byType(type)[count - 1];
      },
    };
  }

  /** Directory → world login → company select: a WORLD_CONNECTED session and its first token. */
  async function enterWorld(ip: string, username = 'SPO_test3', opts: WebSocket.ClientOptions = {}) {
    const c = await connect(ip, opts);
    c.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username, password: 'test3' });
    await c.waitFor('RESP_CONNECT_SUCCESS');
    c.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l', username, password: 'test3', worldName: 'Planitia' });
    await c.waitFor('RESP_LOGIN_SUCCESS');
    c.send({ type: 'REQ_SELECT_COMPANY', wsRequestId: 's', companyId: 'c1' });
    const tokenEvent = await c.waitFor('EVENT_SESSION_RESUME_TOKEN');
    const session = mockSessions[mockSessions.length - 1];
    const conn = mockIS.conns.length - 1;
    return { c, session, conn, token: tokenEvent.token as string };
  }

  async function closeAndPark(c: Client, s: FakeSessionShape): Promise<void> {
    c.ws.close();
    await c.closed;
    await until(() => logged(s, 'SESSION_PARK'));
  }

  it('(a) a closed WORLD_CONNECTED socket parks: nothing upstream, world socket open; endSession then destroy at the park delay', async () => {
    const { c, session, conn } = await enterWorld('10.0.0.1');
    jest.useFakeTimers(FAKE_OPTS);

    await closeAndPark(c, session);
    await settle();
    expect(mod.getParkedSessionCount()).toBe(1);
    expect(has(conn, 'ClientNotAware')).toBe(false);
    expect(has(conn, 'Logoff')).toBe(false);
    expect(mockIS.closed[conn]).toBe(false);
    expect(session.getSocket('world')?.destroyed).toBe(false);
    expect(logged(session, 'SESSION_END')).toBe(false);

    await jest.advanceTimersByTimeAsync(PARK_MS - 1);
    expect(session.endSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await until(() => session.destroy.mock.calls.length === 1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(session.destroy.mock.invocationCallOrder[0]).toBeGreaterThan(session.endSession.mock.invocationCallOrder[0]);
    expect(has(conn, 'ClientNotAware')).toBe(true);
    expect(has(conn, 'Logoff')).toBe(true);
    await until(() => mockIS.closed[conn]);
    expect(mod.getParkedSessionCount()).toBe(0);
    expect(session.log.info.mock.calls.find((x: unknown[]) => x[0] === 'SESSION_END')?.[1]).toMatchObject({ reason: 'expired' });
  });

  describe('(b) every other close ends the session as today', () => {
    it('DISCONNECTED and DIRECTORY_CONNECTED sessions end on close', async () => {
      const a = await connect('10.0.0.1');
      const b = await connect('10.0.0.2');
      b.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'u', password: 'p' });
      await b.waitFor('RESP_CONNECT_SUCCESS');
      const [sa, sb] = mockSessions;
      a.ws.close();
      b.ws.close();
      await until(() => sa.destroy.mock.calls.length === 1 && sb.destroy.mock.calls.length === 1);
      expect(sa.endSession).toHaveBeenCalledTimes(1);
      expect(sb.endSession).toHaveBeenCalledTimes(1);
      expect(logged(sa, 'SESSION_PARK') || logged(sb, 'SESSION_PARK')).toBe(false);
      expect(mod.getParkedSessionCount()).toBe(0);
    });

    it('REQ_LOGOUT never parks', async () => {
      const { c, session, conn } = await enterWorld('10.0.0.1');
      c.send({ type: 'REQ_LOGOUT', wsRequestId: 'o' });
      await c.waitFor('RESP_LOGOUT');
      await c.closed;
      await until(() => session.destroy.mock.calls.length === 1);
      expect(logged(session, 'SESSION_PARK')).toBe(false);
      expect(has(conn, 'Logoff')).toBe(true);
      expect(mod.getParkedSessionCount()).toBe(0);
    });

    it('a re-login on the same socket drops the token: the next close ends the session', async () => {
      const { c, session } = await enterWorld('10.0.0.1');
      c.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l2', username: 'SPO_test3', password: 'test3', worldName: 'Planitia' });
      await c.waitFor('RESP_LOGIN_SUCCESS', 2);
      c.ws.close();
      await until(() => session.destroy.mock.calls.length === 1);
      expect(logged(session, 'SESSION_PARK')).toBe(false);
    });

    it('shutdown ends attached and parked sessions and parks nothing', async () => {
      const attached = await enterWorld('10.0.0.1', 'SPO_test3');
      const parked = await enterWorld('10.0.0.2', 'Crazz');
      await closeAndPark(parked.c, parked.session);

      await mod.connectionDrain.drain();
      expect(await attached.c.closed).toBe(1012);
      await until(() => attached.session.destroy.mock.calls.length === 1 && parked.session.destroy.mock.calls.length === 1);
      expect(has(attached.conn, 'Logoff')).toBe(true);
      expect(has(parked.conn, 'Logoff')).toBe(true);
      expect(logged(attached.session, 'SESSION_PARK')).toBe(false);
      expect(mod.getParkedSessionCount()).toBe(0);
      expect(parked.session.log.info.mock.calls.find((x: unknown[]) => x[0] === 'SESSION_END')?.[1]).toMatchObject({ reason: 'shutdown' });
    });
  });

  it('(c) a valid resume from another IP re-attaches: snapshot, FIFO in order, new token, old token refused', async () => {
    const { c, session, conn, token } = await enterWorld('10.0.0.1');
    await closeAndPark(c, session);

    // Pushes while parked: four replayable types kept in order, the rest dropped
    session.emit('ws_event', { type: 'EVENT_CHAT_MSG', n: 1 });
    session.emit('ws_event', { type: 'EVENT_TYCOON_UPDATE', n: 2 });
    session.emit('ws_event', { type: 'EVENT_SHOW_NOTIFICATION', n: 3 });
    session.emit('ws_event', { type: 'EVENT_NEW_MAIL', n: 4 });
    session.emit('ws_event', { type: 'EVENT_TYCOON_RETIRED', n: 5 });
    session.emit('worldReconnected');

    const c2 = await connect('10.0.0.2');
    const fresh = mockSessions[mockSessions.length - 1];
    c2.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'r', username: 'spo_TEST3', token });
    const newToken = (await c2.waitFor('EVENT_SESSION_RESUME_TOKEN')).token as string;

    expect(c2.msgs.map(m => m.type)).toEqual([
      'RESP_RESUME_SESSION',
      'EVENT_CHAT_MSG',
      'EVENT_SHOW_NOTIFICATION',
      'EVENT_NEW_MAIL',
      'EVENT_TYCOON_RETIRED',
      'EVENT_SESSION_RESUME_TOKEN',
    ]);
    expect(c2.msgs.slice(1, 5).map(m => m.n)).toEqual([1, 3, 4, 5]);
    expect(c2.msgs[0]).toEqual({
      type: 'RESP_RESUME_SESSION',
      wsRequestId: 'r',
      username: 'SPO_test3',
      tycoonId: '77',
      worldName: 'Planitia',
      worldXSize: null,
      worldYSize: null,
      worldSeason: null,
      company: { id: 'c1', name: 'Acme', ownerRole: 'SPO_test3' },
      accountMoney: null,
      virtualDate: null,
      failureLevel: null,
      playerX: 10,
      playerY: 20,
      chatChannel: expect.any(String),
    });
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken).not.toBe(token);
    expect(mod.getParkedSessionCount()).toBe(0);

    // The new connection's empty session was retired, never logged off
    expect(fresh).not.toBe(session);
    expect(fresh.destroy).toHaveBeenCalledTimes(1);
    expect(fresh.endSession).not.toHaveBeenCalled();

    // A later event reaches the NEW socket
    session.emit('ws_event', { type: 'EVENT_TYCOON_UPDATE', n: 6 });
    expect((await c2.waitFor('EVENT_TYCOON_UPDATE')).n).toBe(6);

    // Nothing went upstream through park and resume
    expect(has(conn, 'ClientNotAware')).toBe(false);
    expect(has(conn, 'Logoff')).toBe(false);
    expect(session.endSession).not.toHaveBeenCalled();

    // The old token is dead
    const c3 = await connect('10.0.0.3');
    c3.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'x', username: 'SPO_test3', token });
    expect(await c3.waitFor('RESP_ERROR')).toEqual({ ...REFUSED, wsRequestId: 'x' });
  });

  describe('(d) refusals answer one code and leave the parked session in place', () => {
    it('unknown token, token for another username, reused token, resume that is not the first message', async () => {
      const { c, session, token } = await enterWorld('10.0.0.1');
      await closeAndPark(c, session);

      const refused = async (msgs: Array<Record<string, unknown>>) => {
        const x = await connect('10.0.0.9');
        for (const m of msgs) x.send(m);
        const err = await x.waitFor('RESP_ERROR', msgs.length);
        expect(err).toEqual({ ...REFUSED, wsRequestId: 'q' });
        expect(mod.getParkedSessionCount()).toBe(1);
        expect(session.endSession).not.toHaveBeenCalled();
      };
      const resume = (username: unknown, tok: unknown) => ({ type: 'REQ_RESUME_SESSION', wsRequestId: 'q', username, token: tok });

      await refused([resume('SPO_test3', 'A'.repeat(43))]); // unknown
      await refused([resume('Crazz', token)]); // another username
      await refused([{ type: 'REQ_NOT_A_TYPE', wsRequestId: 'q' }, resume('SPO_test3', token)]); // not first

      // Reused: resume once, park again, present the consumed token
      const c2 = await connect('10.0.0.2');
      c2.send(resume('SPO_test3', token));
      await c2.waitFor('EVENT_SESSION_RESUME_TOKEN');
      await c2.waitFor('RESP_RESUME_SESSION');
      c2.ws.close();
      await c2.closed;
      await until(() => session.log.info.mock.calls.filter((x: unknown[]) => x[0] === 'SESSION_PARK').length === 2);
      await refused([resume('SPO_test3', token)]);
    });

    it('expired park', async () => {
      const { c, session, token } = await enterWorld('10.0.0.1');
      jest.useFakeTimers(FAKE_OPTS);
      await closeAndPark(c, session);
      await jest.advanceTimersByTimeAsync(PARK_MS);
      await until(() => session.destroy.mock.calls.length === 1);

      const x = await connect('10.0.0.9');
      x.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'q', username: 'SPO_test3', token });
      expect(await x.waitFor('RESP_ERROR')).toEqual({ ...REFUSED, wsRequestId: 'q' });
    });
  });

  describe('(e) a fresh login evicts the parked session before AccountStatus', () => {
    const accountStatusAfter = (conn: number) => indexOf(f => f.conn > conn && /\bAccountStatus\b/.test(f.frame));

    it('Logoff acknowledged, then AccountStatus', async () => {
      const { c, session, conn } = await enterWorld('10.0.0.1');
      await closeAndPark(c, session);

      const c2 = await connect('10.0.0.2');
      c2.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'spo_test3', password: 'test3' });
      await c2.waitFor('RESP_CONNECT_SUCCESS');
      c2.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l', username: 'spo_test3', password: 'test3', worldName: 'Planitia' });
      await c2.waitFor('RESP_LOGIN_SUCCESS');

      const logoff = indexOf(f => f.conn === conn && /^C\s*\d+.*\bLogoff\b/.test(f.frame));
      const ack = indexOf(f => f.conn === conn && f.frame === 'ANSWER Logoff');
      const status = accountStatusAfter(conn);
      expect(logoff).toBeGreaterThanOrEqual(0);
      expect(ack).toBeGreaterThan(logoff);
      expect(status).toBeGreaterThan(ack);
      expect(session.destroy).toHaveBeenCalledTimes(1);
      expect(mod.getParkedSessionCount()).toBe(0);
      expect(session.log.info.mock.calls.find((x: unknown[]) => x[0] === 'SESSION_END')?.[1]).toMatchObject({ reason: 'evicted' });
    });

    it('Logoff unanswered: AccountStatus waits for the 5 s timeout; no park timer fires later', async () => {
      const { c, session, conn } = await enterWorld('10.0.0.1');
      await closeAndPark(c, session);
      mockIS.answerLogoff = false;

      const c2 = await connect('10.0.0.2');
      c2.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'SPO_test3', password: 'test3' });
      await c2.waitFor('RESP_CONNECT_SUCCESS');
      jest.useFakeTimers(FAKE_OPTS);
      c2.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l', username: 'SPO_test3', password: 'test3', worldName: 'Planitia' });
      await until(() => has(conn, 'Logoff'));

      await jest.advanceTimersByTimeAsync(LOGOFF_TIMEOUT_MS - 1);
      await settle();
      expect(accountStatusAfter(conn)).toBe(-1);
      expect(session.destroy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await until(() => accountStatusAfter(conn) !== -1);
      const logoff = indexOf(f => f.conn === conn && /\bLogoff\b/.test(f.frame));
      expect(accountStatusAfter(conn)).toBeGreaterThan(logoff);
      expect(session.destroy).toHaveBeenCalledTimes(1); // the eviction finished before AccountStatus
      await c2.waitFor('RESP_LOGIN_SUCCESS');
      expect(mod.getParkedSessionCount()).toBe(0);

      await jest.advanceTimersByTimeAsync(PARK_MS * 2);
      expect(session.endSession).toHaveBeenCalledTimes(1);
      expect(session.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('(f) slots and the global cap', () => {
    it('a parked session keeps its IP slot; a resume from another IP moves it', async () => {
      const { c, session, token } = await enterWorld('10.0.0.1');
      expect(mod.getWsConnectionCount('10.0.0.1')).toBe(1);
      await closeAndPark(c, session);
      expect(mod.getWsConnectionCount('10.0.0.1')).toBe(1);

      const c2 = await connect('10.0.0.2');
      c2.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'r', username: 'SPO_test3', token });
      await c2.waitFor('EVENT_SESSION_RESUME_TOKEN');
      expect(mod.getWsConnectionCount('10.0.0.1')).toBe(0);
      expect(mod.getWsConnectionCount('10.0.0.2')).toBe(1);
    });

    it('with the cap reached, a closing session is not parked', async () => {
      const first = await enterWorld('10.0.0.1', 'SPO_test3');
      await closeAndPark(first.c, first.session);
      expect(mod.getParkedSessionCount()).toBe(1);

      const second = await enterWorld('10.0.0.1', 'Crazz');
      second.c.ws.close();
      await until(() => second.session.destroy.mock.calls.length === 1);
      expect(logged(second.session, 'SESSION_PARK')).toBe(false);
      expect(has(second.conn, 'Logoff')).toBe(true);
      expect(mod.getParkedSessionCount()).toBe(1);
      expect(mod.getWsConnectionCount('10.0.0.1')).toBe(1); // only the parked slot remains
    });
  });

  it('(g) a heartbeat-terminated socket parks, and the park survives heartbeat ticks until its timer', async () => {
    const { c, session } = await enterWorld('10.0.0.1', 'SPO_test3', { autoPong: false });
    jest.useFakeTimers(FAKE_OPTS);
    const stop = mod.startWsHeartbeat(50);
    try {
      await jest.advanceTimersByTimeAsync(50); // ping
      await settle(20);
      await jest.advanceTimersByTimeAsync(50); // no pong → terminate
      expect(await c.closed).toBe(1006);
      await until(() => logged(session, 'SESSION_PARK'));

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(50);
        await settle(5);
      }
      expect(mod.getParkedSessionCount()).toBe(1);
      expect(session.endSession).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(PARK_MS);
      await until(() => session.destroy.mock.calls.length === 1);
      expect(session.endSession).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('(h) no issued token ever appears in a log line', async () => {
    const { c, session, token } = await enterWorld('10.0.0.1');
    await closeAndPark(c, session);
    const c2 = await connect('10.0.0.2');
    c2.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'r', username: 'SPO_test3', token });
    const second = (await c2.waitFor('EVENT_SESSION_RESUME_TOKEN')).token as string;
    // Refused (reused) and unparseable resume requests
    const c3 = await connect('10.0.0.3');
    c3.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'x', username: 'SPO_test3', token });
    await c3.waitFor('RESP_ERROR');
    const c4 = await connect('10.0.0.4');
    c4.ws.send(`{"type":"REQ_RESUME_SESSION","username":"SPO_test3","token":"${second}"`);
    await c4.waitFor('RESP_ERROR');

    const captured: unknown[][] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      captured.push(...(console[m] as unknown as jest.Mock).mock.calls);
    }
    for (const s of mockSessions) {
      for (const level of ['info', 'warn', 'error', 'debug'] as const) captured.push(...s.log[level].mock.calls);
    }
    expect(captured.length).toBeGreaterThan(10);
    const text = captured.map(args => JSON.stringify(args, (_k, v: unknown) => (v instanceof Error ? v.message : v))).join('\n');
    expect(text).toContain('SESSION_RESUME'); // the capture sees the resume path
    expect(text).toContain('PARSE_ERROR');
    expect(text).not.toContain(token);
    expect(text).not.toContain(second);
  });

  it('(i) a resume while the old socket is still open terminates it, and its close neither parks nor ends', async () => {
    const { c, session, token } = await enterWorld('10.0.0.1');
    const c2 = await connect('10.0.0.2');
    c2.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'r', username: 'SPO_test3', token });
    await c2.waitFor('EVENT_SESSION_RESUME_TOKEN');

    expect(await c.closed).toBe(1006);
    await until(() => mod.getWsConnectionCount('10.0.0.1') === 0);
    await settle();
    expect(logged(session, 'SESSION_PARK')).toBe(false);
    expect(logged(session, 'SESSION_END')).toBe(false);
    expect(session.endSession).not.toHaveBeenCalled();
    expect(mod.getParkedSessionCount()).toBe(0);

    session.emit('ws_event', { type: 'EVENT_CHAT_MSG', n: 9 });
    expect((await c2.waitFor('EVENT_CHAT_MSG')).n).toBe(9);

    // The resumed socket's own close parks the session again
    c2.ws.close();
    await until(() => logged(session, 'SESSION_PARK'));
    expect(mod.getParkedSessionCount()).toBe(1);
  });

  describe('global session cap (#1074)', () => {
    it('a parked session is still counted after its WebSocket closed, and freed when the park timer fires', async () => {
      const { c, session } = await enterWorld('10.0.0.1');
      expect(mod.sessionCap.counters().admitted).toBe(1);
      jest.useFakeTimers(FAKE_OPTS);
      await closeAndPark(c, session);
      await settle();
      expect(mod.sessionCap.counters().admitted).toBe(1);

      await jest.advanceTimersByTimeAsync(PARK_MS);
      await until(() => session.destroy.mock.calls.length === 1);
      expect(mod.sessionCap.counters().admitted).toBe(0);
    });

    it('a REQ_RESUME_SESSION with every slot taken re-attaches', async () => {
      const { c, session, token } = await enterWorld('10.0.0.1');
      await closeAndPark(c, session);
      mod.sessionCap.setMax(1);

      const c2 = await connect('10.0.0.2');
      c2.send({ type: 'REQ_RESUME_SESSION', wsRequestId: 'r', username: 'SPO_test3', token });
      expect(await c2.waitFor('RESP_RESUME_SESSION')).toMatchObject({ wsRequestId: 'r', username: 'SPO_test3' });
      expect(mod.sessionCap.counters()).toEqual({ admitted: 1, max: 1, refusedFull: 0 });
    });

    it("a fresh login does not count the player's own parked session; another player is refused", async () => {
      const { c, session } = await enterWorld('10.0.0.1', 'SPO_test3');
      await closeAndPark(c, session);
      mod.sessionCap.setMax(1);

      const c2 = await connect('10.0.0.2');
      c2.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'SPO_test3', password: 'test3' });
      await c2.waitFor('RESP_CONNECT_SUCCESS');
      c2.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l', username: 'SPO_test3', password: 'test3', worldName: 'Planitia' });
      await c2.waitFor('RESP_LOGIN_SUCCESS');
      await until(() => session.destroy.mock.calls.length === 1);
      expect(mod.sessionCap.counters().admitted).toBe(1);

      const c3 = await connect('10.0.0.3');
      c3.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'Crazz', password: 'test' });
      await c3.waitFor('RESP_CONNECT_SUCCESS');
      c3.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l3', username: 'Crazz', password: 'test', worldName: 'Planitia' });
      expect(await c3.waitFor('RESP_ERROR')).toMatchObject({
        wsRequestId: 'l3',
        errorMessage: 'The server is full. Please try again in a few minutes.',
      });
      expect(await c3.closed).toBe(1013);
      expect(mod.sessionCap.counters()).toEqual({ admitted: 1, max: 1, refusedFull: 1 });
    });

    it('a failed world login keeps no slot', async () => {
      const c = await connect('10.0.0.1');
      c.send({ type: 'REQ_CONNECT_DIRECTORY', wsRequestId: 'd', username: 'SPO_test3', password: 'test3' });
      await c.waitFor('RESP_CONNECT_SUCCESS');
      c.send({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'l', username: 'SPO_test3', password: 'test3', worldName: 'Nowhere' });
      expect(await c.waitFor('RESP_ERROR')).toMatchObject({ wsRequestId: 'l' });
      await settle();
      expect(mod.sessionCap.counters().admitted).toBe(0);
      expect(c.ws.readyState).toBe(WebSocket.OPEN);
    });
  });
});
