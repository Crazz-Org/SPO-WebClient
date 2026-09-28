/**
 * The shutdown drain, driven with real `ws` clients against the gateway's real WebSocket upgrade
 * wiring (`mountWebSocketGateway`), mounted on this test's own `http.Server` bound to
 * 127.0.0.1:0 — never 8080, and never `startGateway()`, which boots asset-downloading services
 * (pattern of ws-connection-cap.test.ts). `StarpeaceSession` is stubbed.
 *
 * One `it` per point of the card's Done-when 2 (a)–(h).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as http from 'http';
import WebSocket from 'ws';

type ServerModule = typeof import('../server');
type ShutdownModule = typeof import('../gateway-shutdown');

interface StubSession {
  log: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
  setCorrelationId: jest.Mock;
  endSession: jest.Mock;
  destroy: jest.Mock;
}

const mockSessions: StubSession[] = [];
let mockEndSessionImpl: () => Promise<void> = () => Promise.resolve();

jest.mock('../spo_session', () => {
  const { EventEmitter } = jest.requireActual<typeof import('events')>('events');
  const { SessionPhase: Phase } = jest.requireActual<typeof import('../../shared/types')>('../../shared/types');
  class MockSession extends EventEmitter {
    log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    startedAt = Date.now();
    languageId = '0';
    getPhase = jest.fn(() => Phase.DISCONNECTED);
    setCorrelationId = jest.fn();
    getWorldInfo = jest.fn(() => undefined);
    // Read by the observability session registry when the connection closes.
    getQueueStatus = jest.fn(() => ({
      rdoMetrics: { totalSent: 0, totalTimedOut: 0, totalErrorReplies: 0, totalLateResponses: 0, totalReconnectFailures: 0 },
    }));
    endSession = jest.fn(() => mockEndSessionImpl());
    destroy = jest.fn();
    constructor() {
      super();
      mockSessions.push(this as unknown as StubSession);
    }
  }
  return { ...jest.requireActual<object>('../spo_session'), StarpeaceSession: MockSession };
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: timed out');
    await new Promise(r => setImmediate(r));
  }
}

const EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;

describe('gateway shutdown drain', () => {
  let mod: ServerModule;
  let shutdown: ShutdownModule;
  let own: http.Server;
  let port: number;
  let clients: WebSocket[];
  let listenersBefore: Map<string, Function[]>;
  const savedSingleUser = process.env.SINGLE_USER_MODE;

  beforeEach(async () => {
    delete process.env.SINGLE_USER_MODE;
    mockSessions.length = 0;
    mockEndSessionImpl = () => Promise.resolve();
    clients = [];
    listenersBefore = new Map(EVENTS.map(ev => [ev, [...process.listeners(ev as NodeJS.Signals)]]));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    jest.resetModules();
    jest.useFakeTimers();
    mod = require('../server') as ServerModule;
    shutdown = require('../gateway-shutdown') as ShutdownModule;
    jest.clearAllTimers();
    jest.useRealTimers();

    own = http.createServer();
    mod.mountWebSocketGateway(own);
    await new Promise<void>(resolve => {
      own.listen(0, '127.0.0.1', () => {
        const addr = own.address();
        if (addr && typeof addr === 'object') port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await Promise.all(
      clients.map(
        c =>
          new Promise<void>(resolve => {
            if (c.readyState === WebSocket.CLOSED) return resolve();
            c.once('close', () => resolve());
            c.terminate();
          }),
      ),
    );
    await new Promise(r => setTimeout(r, 20));
    own.closeAllConnections();
    await new Promise<void>(resolve => {
      if (!own.listening) return resolve();
      own.close(() => resolve());
    });
    for (const ev of EVENTS) {
      for (const l of process.listeners(ev as NodeJS.Signals)) {
        if (!listenersBefore.get(ev)!.includes(l)) process.removeListener(ev, l);
      }
    }
    jest.restoreAllMocks();
    if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
    else process.env.SINGLE_USER_MODE = savedSingleUser;
  });

  interface Conn {
    ws: WebSocket;
    closed: Promise<{ code: number; reason: string }>;
  }

  async function connect(): Promise<Conn> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    clients.push(ws);
    const closed = new Promise<{ code: number; reason: string }>(resolve => {
      ws.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return { ws, closed };
  }

  function sequence(overrides: Partial<import('../gateway-shutdown').ShutdownSequenceDeps> = {}) {
    const deps = {
      server: own,
      drain: mod.connectionDrain,
      registry: { shutdown: jest.fn(() => Promise.resolve()) },
      closeLogTransports: jest.fn(() => Promise.resolve()),
      exit: jest.fn(),
      log: { info: jest.fn(), error: jest.fn() },
      ...overrides,
    };
    return { deps, run: shutdown.createShutdownSequence(deps) };
  }

  const sessionEnded = (s: StubSession) =>
    s.log.info.mock.calls.some((c: unknown[]) => c[0] === 'SESSION_END');

  it('(a) closes the listener before the first endSession()', async () => {
    await connect();
    const listeningAtEndSession: boolean[] = [];
    mockEndSessionImpl = () => {
      listeningAtEndSession.push(own.listening);
      return Promise.resolve();
    };
    const { run } = sequence();
    expect(own.listening).toBe(true);
    await run('SIGTERM');
    expect(listeningAtEndSession).toEqual([false]);
  });

  it('(b) sends close 1012 "Server restarting" to every client before exit', async () => {
    const a = await connect();
    const b = await connect();
    const events: string[] = [];
    const allClosed = Promise.all([a, b].map(c => c.closed.then(r => { events.push(`close:${r.code}:${r.reason}`); })));
    mockEndSessionImpl = () => allClosed.then(() => undefined);
    const exit = jest.fn((_code: number) => { events.push('exit'); });
    const { run } = sequence({ exit });
    await run('SIGTERM');
    expect(events).toEqual(['close:1012:Server restarting', 'close:1012:Server restarting', 'exit']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('(c) runs endSession() once per session while the close reply races it, and destroy() only after it settles', async () => {
    const c = await connect();
    const gate = deferred();
    mockEndSessionImpl = () => gate.promise;
    const { run } = sequence();
    const done = run('SIGTERM');
    const s = mockSessions[0];

    expect((await c.closed).code).toBe(1012);
    await until(() => sessionEnded(s)); // the server-side ws.on('close') handler ran
    await new Promise(r => setTimeout(r, 10));
    expect(s.endSession).toHaveBeenCalledTimes(1);
    expect(s.destroy).not.toHaveBeenCalled();

    gate.resolve();
    await done;
    await new Promise(r => setImmediate(r));
    expect(s.endSession).toHaveBeenCalledTimes(1);
    expect(s.destroy).toHaveBeenCalledTimes(1);
    expect(s.destroy.mock.invocationCallOrder[0]).toBeGreaterThan(s.endSession.mock.invocationCallOrder[0]);
  });

  it('(d) logs sessions off concurrently: two 3 s logoffs finish in 3 s, not 6 s', async () => {
    await connect();
    await connect();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockEndSessionImpl = () => new Promise<void>(r => setTimeout(r, 3000));
    const { deps, run } = sequence();
    void run('SIGTERM');
    await jest.advanceTimersByTimeAsync(2999);
    expect(mockSessions.every(s => s.endSession.mock.calls.length === 1)).toBe(true);
    expect(deps.exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('(e) an endSession() that never settles does not hold the process past the deadline', async () => {
    expect(shutdown.SHUTDOWN_DEADLINE_MS).toBeLessThan(10_000);
    await connect();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockEndSessionImpl = () => new Promise<void>(() => undefined);
    const { deps, run } = sequence();
    void run('SIGTERM');
    await jest.advanceTimersByTimeAsync(shutdown.SHUTDOWN_DEADLINE_MS - 1);
    expect(deps.exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.registry.shutdown).not.toHaveBeenCalled();
  });

  it('(f) a message received after the drain starts reaches no handler', async () => {
    const c = await connect();
    const s = mockSessions[0];
    const msg = JSON.stringify({ type: 'REQ_UNKNOWN_PROBE', wsRequestId: 'p' });

    // Control: before the drain, a message is dispatched
    c.ws.send(msg);
    await until(() => s.setCorrelationId.mock.calls.length > 0);
    const dispatched = s.setCorrelationId.mock.calls.length;

    // Same tick: send, then start the drain — the flag is set before the frame arrives
    c.ws.send(msg);
    const { run } = sequence();
    await run('SIGTERM');
    await c.closed;
    await until(() => sessionEnded(s));
    await new Promise(r => setTimeout(r, 20));
    expect(s.setCorrelationId.mock.calls.length).toBe(dispatched);
  });

  describe('(g) the process handlers enter the same sequence', () => {
    const added = (ev: string): ((...args: unknown[]) => void) =>
      process.listeners(ev as NodeJS.Signals).find(l => !listenersBefore.get(ev)!.includes(l)) as (...args: unknown[]) => void;

    it.each(['uncaughtException', 'SIGTERM'])('%s → 1012, endSession(), exit(0)', async ev => {
      const c = await connect();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      mod.installGatewayShutdown(own);
      added(ev)(new Error('boom'));
      expect((await c.closed).code).toBe(1012);
      await until(() => exitSpy.mock.calls.length > 0);
      expect(mockSessions[0].endSession).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('(h) closeLogTransports()', () => {
    it('is awaited after registry.shutdown() and before exit', async () => {
      await connect();
      const logs = deferred();
      const closeLogTransports = jest.fn(() => logs.promise);
      const { deps, run } = sequence({ closeLogTransports });
      const done = run('SIGTERM');
      await until(() => closeLogTransports.mock.calls.length > 0);
      expect(closeLogTransports.mock.invocationCallOrder[0]).toBeGreaterThan(
        (deps.registry.shutdown as jest.Mock).mock.invocationCallOrder[0],
      );
      await new Promise(r => setTimeout(r, 10));
      expect(deps.exit).not.toHaveBeenCalled();
      logs.resolve();
      await done;
      expect(deps.exit).toHaveBeenCalledWith(0);
    });

    it('one that never settles still exits at the deadline', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const closeLogTransports = jest.fn(() => new Promise<void>(() => undefined));
      const { deps, run } = sequence({ closeLogTransports });
      void run('SIGTERM');
      await jest.advanceTimersByTimeAsync(shutdown.SHUTDOWN_DEADLINE_MS - 1);
      expect(closeLogTransports).toHaveBeenCalled();
      expect(deps.exit).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
  });
});
