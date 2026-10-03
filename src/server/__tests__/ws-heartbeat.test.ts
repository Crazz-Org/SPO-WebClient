/**
 * The dead-socket heartbeat (policy SEC-W-7) and the quiet camera log, driven with real `ws`
 * clients against the gateway's real WebSocket upgrade wiring (`mountWebSocketGateway`),
 * mounted on this test's own `http.Server` bound to 127.0.0.1:0 — never 8080, and never
 * `startGateway()` (pattern of gateway-drain.test.ts). `StarpeaceSession` is stubbed.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as http from 'http';
import WebSocket from 'ws';

type ServerModule = typeof import('../server');

interface StubSession {
  log: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
  endSession: jest.Mock;
  destroy: jest.Mock;
  updateCameraPosition: jest.Mock;
}

const mockSessions: StubSession[] = [];
let mockPhase: string | null = null;

jest.mock('../spo_session', () => {
  const { EventEmitter } = jest.requireActual<typeof import('events')>('events');
  const { SessionPhase: Phase } = jest.requireActual<typeof import('../../shared/types')>('../../shared/types');
  class MockSession extends EventEmitter {
    log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    startedAt = Date.now();
    languageId = '0';
    getPhase = jest.fn(() => mockPhase ?? Phase.DISCONNECTED);
    setCorrelationId = jest.fn();
    getWorldInfo = jest.fn(() => undefined);
    // Read by the observability session registry when the connection closes.
    getQueueStatus = jest.fn(() => ({
      rdoMetrics: { totalSent: 0, totalTimedOut: 0, totalErrorReplies: 0, totalLateResponses: 0, totalReconnectFailures: 0 },
    }));
    endSession = jest.fn(() => Promise.resolve());
    destroy = jest.fn();
    updateCameraPosition = jest.fn();
    constructor() {
      super();
      mockSessions.push(this as unknown as StubSession);
    }
  }
  return { ...jest.requireActual<object>('../spo_session'), StarpeaceSession: MockSession };
});

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: timed out');
    await new Promise(r => setImmediate(r));
  }
}

const IP = '127.0.0.1';

describe('gateway WebSocket heartbeat and quiet camera', () => {
  let mod: ServerModule;
  let own: http.Server;
  let port: number;
  let clients: WebSocket[];
  const savedSingleUser = process.env.SINGLE_USER_MODE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeEach(async () => {
    delete process.env.SINGLE_USER_MODE;
    delete process.env.TRUST_PROXY;
    mockSessions.length = 0;
    mockPhase = null;
    clients = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    jest.resetModules();
    jest.useFakeTimers();
    mod = require('../server') as ServerModule;
    jest.clearAllTimers(); // kills the module-load 30 s heartbeat and every other load-time timer
    jest.useRealTimers();

    own = http.createServer();
    mod.mountWebSocketGateway(own);
    await new Promise<void>(resolve => {
      own.listen(0, IP, () => {
        const addr = own.address();
        if (addr && typeof addr === 'object') port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
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
    jest.restoreAllMocks();
    if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
    else process.env.SINGLE_USER_MODE = savedSingleUser;
    if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedTrustProxy;
  });

  async function connect(opts: WebSocket.ClientOptions = {}): Promise<{ ws: WebSocket; closed: Promise<void> }> {
    const ws = new WebSocket(`ws://${IP}:${port}`, { origin: `http://${IP}:${port}`, ...opts });
    clients.push(ws);
    const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return { ws, closed };
  }

  const sessionEnded = (s: StubSession) =>
    s.log.info.mock.calls.some((c: unknown[]) => c[0] === 'SESSION_END');

  it('terminates a client that never pongs, and the close handler gives back its IP slot', async () => {
    const before = mod.getWsConnectionCount(IP);
    const stop = mod.startWsHeartbeat(50);
    try {
      const c = await connect({ autoPong: false });
      expect(mod.getWsConnectionCount(IP)).toBe(before + 1);

      await c.closed; // the gateway cut it
      const s = mockSessions[0];
      await until(() => sessionEnded(s) && s.endSession.mock.calls.length === 1);
      await until(() => mod.getWsConnectionCount(IP) === before);
      expect(mod.getWsConnectionCount(IP)).toBe(before);
    } finally {
      stop();
    }
  });

  it('keeps a client that answers pings open across 5+ intervals', async () => {
    const INTERVAL_MS = 50;
    const TICKS = 6; // a terminate needs two ticks without a pong; 6 ticks = 5 pong checks
    // Fake only the interval timers, so the test fires each heartbeat tick itself; ws's own
    // timeouts, setImmediate (until) and the socket I/O stay real.
    jest.useFakeTimers({
      doNotFake: [
        'Date', 'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate',
        'clearImmediate', 'setTimeout', 'clearTimeout', 'requestAnimationFrame',
        'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      ],
    });
    const stop = mod.startWsHeartbeat(INTERVAL_MS);
    try {
      const c = await connect();
      await until(() => mockSessions.length === 1);
      const s = mockSessions[0];
      let pings = 0;
      c.ws.on('ping', () => {
        pings++;
      });
      const loggedProbes = () =>
        s.log.info.mock.calls.filter((call: unknown[]) => call[0] === 'WS>> REQ_NOT_A_TYPE').length;

      for (let i = 1; i <= TICKS; i++) {
        jest.advanceTimersByTime(INTERVAL_MS); // one real tick: ping, or terminate
        await until(() => pings >= i || c.ws.readyState !== WebSocket.OPEN);
        if (c.ws.readyState !== WebSocket.OPEN) break; // terminated: the assertion reports it
        // The client's auto-pong is already queued ahead of this message on the same connection:
        // once the server logs it, the server has processed the pong.
        c.ws.send(JSON.stringify({ type: 'REQ_NOT_A_TYPE', wsRequestId: `hb${i}` }));
        await until(() => loggedProbes() >= i || c.ws.readyState !== WebSocket.OPEN);
      }

      expect(c.ws.readyState).toBe(WebSocket.OPEN);
      expect(s.endSession).not.toHaveBeenCalled();
    } finally {
      stop(); // clearInterval on the fake clock — before restoring real timers
      jest.useRealTimers();
    }
  });

  it('writes no WS>> / WS<< info line for REQ_UPDATE_CAMERA', async () => {
    const { SessionPhase } = jest.requireActual<typeof import('../../shared/types')>('../../shared/types');
    mockPhase = SessionPhase.WORLD_CONNECTED;
    const c = await connect();
    const s = mockSessions[0];

    c.ws.send(JSON.stringify({ type: 'REQ_UPDATE_CAMERA', wsRequestId: 'c1', x: 1, y: 2 }));
    await until(() => s.updateCameraPosition.mock.calls.length > 0);
    await new Promise(r => setTimeout(r, 20));
    const wsLines = s.log.info.mock.calls
      .map((call: unknown[]) => call[0])
      .filter((m: unknown) => typeof m === 'string' && (m.startsWith('WS>>') || m.startsWith('WS<<')));
    expect(wsLines).toEqual([]);

    // Control: the capture sees a non-quiet message.
    c.ws.send(JSON.stringify({ type: 'REQ_NOT_A_TYPE', wsRequestId: 'c2' }));
    await until(() => s.log.info.mock.calls.some((call: unknown[]) => call[0] === 'WS>> REQ_NOT_A_TYPE'));
  });
});
