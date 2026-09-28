/**
 * observability.ts — the local-only predicate, the cached directory probe, the health and
 * metrics builders, the session registry and the METRICS log timer. No socket here reaches
 * anything but 127.0.0.1.
 */
import { describe, it, expect, jest, afterEach, afterAll } from '@jest/globals';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLocalOnlyRequest,
  DirectoryProbe,
  buildHealth,
  buildMetrics,
  SessionRegistry,
  readGatewayVersion,
  startMetricsLog,
  directoryProbe,
  sessionRegistry,
  PROCESS_STARTED_AT_MS,
  DIRECTORY_PROBE_INTERVAL_MS,
  DIRECTORY_PROBE_TIMEOUT_MS,
  DIRECTORY_STALE_MS,
  METRICS_LOG_INTERVAL_MS,
  type DirectoryProbeState,
  type ObservedSession,
  type ProbeSocket,
  type GatewayMetrics,
} from './observability';
import { handleClientErrorRequest, getClientErrorCounts } from './client-error-endpoint';
import { Logger } from '../shared/logger';
import { SessionPhase } from '../shared/types';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function req(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
  return { headers, socket: { remoteAddress } };
}

describe('isLocalOnlyRequest', () => {
  const loopback = ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'];

  it.each(loopback)('%s without X-Forwarded-For → true', peer => {
    expect(isLocalOnlyRequest(req(peer))).toBe(true);
  });

  const forwarded = ['203.0.113.7', '127.0.0.1', ''];
  it.each(loopback.flatMap(peer => forwarded.map(xff => [peer, xff] as const)))(
    '%s with X-Forwarded-For "%s" → false',
    (peer, xff) => {
      expect(isLocalOnlyRequest(req(peer, { 'x-forwarded-for': xff }))).toBe(false);
    },
  );

  it.each(['172.17.0.1', '10.0.0.5', '203.0.113.7', undefined])('%s → false', peer => {
    expect(isLocalOnlyRequest(req(peer))).toBe(false);
  });

  it('refuses look-alikes of loopback', () => {
    expect(isLocalOnlyRequest(req('127.0.0.1.evil'))).toBe(false);
    expect(isLocalOnlyRequest(req('::ffff:10.0.0.1'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

interface FakeSocket extends ProbeSocket {
  fireTimeout(): void;
  destroyed: jest.Mock;
}

function neverConnectingSocket(): FakeSocket {
  let onTimeout: (() => void) | null = null;
  const destroyed = jest.fn();
  return {
    setTimeout: (_ms: number, cb: () => void) => { onTimeout = cb; },
    once: () => undefined,
    destroy: destroyed,
    destroyed,
    fireTimeout: () => onTimeout?.(),
  };
}

describe('DirectoryProbe', () => {
  it('a successful connect sets lastOkAt and sends the server zero bytes', async () => {
    let received = 0;
    const server = net.createServer();
    const serverSideClosed = new Promise<void>(resolve => {
      server.on('connection', sock => {
        sock.on('data', (d: Buffer) => { received += d.length; });
        sock.on('close', () => resolve());
      });
    });
    const port = await listen(server);
    const probe = new DirectoryProbe({ target: () => ({ host: '127.0.0.1', port }), now: () => 1_000 });

    await probe.probeOnce();
    await serverSideClosed;
    await close(server);

    expect(probe.getState()).toEqual({ lastOkAt: 1_000, lastAttemptAt: 1_000, consecutiveFailures: 0, lastError: null });
    expect(received).toBe(0);
  });

  it('a closed port counts a failure and records the error', async () => {
    const server = net.createServer();
    const port = await listen(server);
    await close(server);
    // Under WSL2 a connect issued right after close() can still be accepted; let the port settle.
    await new Promise(resolve => setTimeout(resolve, 200));
    const probe = new DirectoryProbe({ target: () => ({ host: '127.0.0.1', port }) });

    await probe.probeOnce();

    const state = probe.getState();
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).not.toBeNull();
    expect(state.lastOkAt).toBeNull();
    expect(state.lastAttemptAt).not.toBeNull();
  });

  it('a connect that never completes fails after DIRECTORY_PROBE_TIMEOUT_MS', async () => {
    const fake = neverConnectingSocket();
    let timeoutAsked = 0;
    const probe = new DirectoryProbe({
      target: () => ({ host: '127.0.0.1', port: 1 }),
      createSocket: () => ({
        ...fake,
        setTimeout: (ms: number, cb: () => void) => { timeoutAsked = ms; fake.setTimeout(ms, cb); },
      }),
    });

    const done = probe.probeOnce();
    expect(timeoutAsked).toBe(DIRECTORY_PROBE_TIMEOUT_MS);
    fake.fireTimeout();
    fake.fireTimeout(); // a second settle is ignored
    await done;

    expect(probe.getState().lastError).toBe(`connect timed out after ${DIRECTORY_PROBE_TIMEOUT_MS}ms`);
    expect(probe.getState().consecutiveFailures).toBe(1);
    expect(fake.destroyed).toHaveBeenCalledTimes(1);
  });

  it('a success after failures resets the failure count and error', () => {
    const probe = new DirectoryProbe({ target: () => ({ host: '127.0.0.1', port: 1 }), now: () => 5 });
    probe.recordOutcome(false, 'boom');
    probe.recordOutcome(false, 'boom again');
    expect(probe.getState()).toMatchObject({ consecutiveFailures: 2, lastError: 'boom again' });
    probe.recordOutcome(true, null);
    expect(probe.getState()).toMatchObject({ consecutiveFailures: 0, lastError: null, lastOkAt: 5 });
  });

  it('start() probes at once and every DIRECTORY_PROBE_INTERVAL_MS; stop() ends it', () => {
    jest.useFakeTimers();
    const factory = jest.fn(() => neverConnectingSocket());
    const probe = new DirectoryProbe({ target: () => ({ host: '127.0.0.1', port: 1 }), createSocket: factory });

    probe.start();
    probe.start(); // idempotent
    expect(factory).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(DIRECTORY_PROBE_INTERVAL_MS - 1);
    expect(factory).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(factory).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(DIRECTORY_PROBE_INTERVAL_MS);
    expect(factory).toHaveBeenCalledTimes(3);

    probe.stop();
    probe.stop(); // harmless twice
    jest.advanceTimersByTime(5 * DIRECTORY_PROBE_INTERVAL_MS);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('the interval handle is unref()d', () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const probe = new DirectoryProbe({
      target: () => ({ host: '127.0.0.1', port: 1 }),
      createSocket: () => neverConnectingSocket(),
    });
    probe.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), DIRECTORY_PROBE_INTERVAL_MS);
    expect(unref).toHaveBeenCalledTimes(1);
    probe.stop();
  });

  it('the module singleton targets the configured directory and starts idle', () => {
    expect(directoryProbe.getState()).toEqual({ lastOkAt: null, lastAttemptAt: null, consecutiveFailures: 0, lastError: null });
    expect(sessionRegistry.snapshot().total).toBe(0);
    expect(PROCESS_STARTED_AT_MS).toBeLessThanOrEqual(Date.now());
  });
});

// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;
function state(partial: Partial<DirectoryProbeState>): DirectoryProbeState {
  return { lastOkAt: null, lastAttemptAt: null, consecutiveFailures: 0, lastError: null, ...partial };
}

describe('buildHealth', () => {
  it('never probed → 503, directory unknown', () => {
    const { statusCode, body } = buildHealth(state({}), false, NOW);
    expect(statusCode).toBe(503);
    expect(body).toEqual({ status: 'unavailable', directory: 'unknown', directoryLastOkAgeS: null, gateway: 'starting' });
  });

  it('last success 30 s ago → 200, reachable', () => {
    const { statusCode, body } = buildHealth(state({ lastOkAt: NOW - 30_000, lastAttemptAt: NOW - 30_000 }), true, NOW);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'ok', directory: 'reachable', directoryLastOkAgeS: 30, gateway: 'ready' });
  });

  it('a success exactly DIRECTORY_STALE_MS ago is still reachable', () => {
    expect(buildHealth(state({ lastOkAt: NOW - DIRECTORY_STALE_MS, lastAttemptAt: NOW }), true, NOW).statusCode).toBe(200);
  });

  it('last success DIRECTORY_STALE_MS + 1 ms ago → 503, unreachable', () => {
    const { statusCode, body } = buildHealth(state({ lastOkAt: NOW - DIRECTORY_STALE_MS - 1, lastAttemptAt: NOW }), true, NOW);
    expect(statusCode).toBe(503);
    expect(body.directory).toBe('unreachable');
    expect(body.status).toBe('unavailable');
  });

  it('attempted but never succeeded → 503, unreachable', () => {
    const { statusCode, body } = buildHealth(state({ lastAttemptAt: NOW - 1_000, consecutiveFailures: 1 }), true, NOW);
    expect(statusCode).toBe(503);
    expect(body.directory).toBe('unreachable');
    expect(body.directoryLastOkAgeS).toBeNull();
  });

  it('a gateway still starting does not change the status', () => {
    const { statusCode, body } = buildHealth(state({ lastOkAt: NOW, lastAttemptAt: NOW }), false, NOW);
    expect(statusCode).toBe(200);
    expect(body.gateway).toBe('starting');
  });

  it('the body carries exactly the four keys', () => {
    const { body } = buildHealth(state({ lastOkAt: NOW, lastAttemptAt: NOW }), true, NOW);
    expect(Object.keys(body).sort()).toEqual(['directory', 'directoryLastOkAgeS', 'gateway', 'status']);
  });
});

// ---------------------------------------------------------------------------

function fakeSession(phase: SessionPhase, metrics: Partial<ReturnType<ObservedSession['getQueueStatus']>['rdoMetrics']> = {}): ObservedSession & { metrics: ReturnType<ObservedSession['getQueueStatus']>['rdoMetrics'] } {
  const m = { totalSent: 0, totalTimedOut: 0, totalErrorReplies: 0, totalLateResponses: 0, totalReconnectFailures: 0, ...metrics };
  return {
    metrics: m,
    getPhase: () => phase,
    getQueueStatus: () => ({ rdoMetrics: { ...m } }),
  };
}

describe('SessionRegistry', () => {
  it('byPhase counts sessions per phase and lists all five phases', () => {
    const reg = new SessionRegistry();
    reg.add(fakeSession(SessionPhase.WORLD_CONNECTED));
    reg.add(fakeSession(SessionPhase.WORLD_CONNECTED));
    reg.add(fakeSession(SessionPhase.DIRECTORY_CONNECTED));

    const snap = reg.snapshot();
    expect(snap.total).toBe(3);
    expect(snap.byPhase).toEqual({
      DISCONNECTED: 0,
      DIRECTORY_CONNECTED: 1,
      WORLD_CONNECTING: 0,
      WORLD_CONNECTED: 2,
      RECONNECTING: 0,
    });
  });

  it('a removed session’s counters stay in the total, once', () => {
    const reg = new SessionRegistry();
    const s = fakeSession(SessionPhase.WORLD_CONNECTED, { totalTimedOut: 3 });
    reg.add(s);
    reg.remove(s);
    reg.remove(s); // no double count

    const snap = reg.snapshot();
    expect(snap.total).toBe(0);
    expect(snap.byPhase.WORLD_CONNECTED).toBe(0);
    expect(snap.rdo.timedOut).toBe(3);
  });

  it('removing a session never added is a no-op', () => {
    const reg = new SessionRegistry();
    reg.remove(fakeSession(SessionPhase.DISCONNECTED, { totalSent: 9 }));
    expect(reg.snapshot().rdo.sent).toBe(0);
  });

  it('each counter is retired plus live', () => {
    const reg = new SessionRegistry();
    const gone = fakeSession(SessionPhase.DISCONNECTED, {
      totalSent: 10, totalTimedOut: 1, totalErrorReplies: 2, totalLateResponses: 3, totalReconnectFailures: 4,
    });
    const live = fakeSession(SessionPhase.RECONNECTING, {
      totalSent: 5, totalTimedOut: 1, totalErrorReplies: 1, totalLateResponses: 1, totalReconnectFailures: 1,
    });
    reg.add(gone);
    reg.add(live);
    reg.remove(gone);
    live.metrics.totalSent = 6; // live counters are read at snapshot time

    expect(reg.snapshot().rdo).toEqual({ sent: 16, timedOut: 2, errorReplies: 3, lateResponses: 4, reconnectFailures: 5 });
  });
});

// ---------------------------------------------------------------------------

describe('buildMetrics', () => {
  const sessions = new SessionRegistry().snapshot();
  const base = {
    version: '1.2.3',
    startedAtMs: NOW - 90_500,
    now: NOW,
    memory: { rss: 100, heapUsed: 20, heapTotal: 40 },
    websocketsOpen: 7,
    sessions,
    clientErrors: { accepted: 0, refused: 0, rateLimited: 0 },
  };

  it('has the documented shape', () => {
    const m = buildMetrics({ ...base, directory: state({ lastOkAt: NOW - 10_000, lastAttemptAt: NOW - 2_000, consecutiveFailures: 1, lastError: 'x' }) });
    expect(Object.keys(m).sort()).toEqual(['clientErrors', 'directory', 'memory', 'rdo', 'sessions', 'sockets', 'startedAt', 'uptimeS', 'version']);
    expect(m.clientErrors).toEqual({ accepted: 0, refused: 0, rateLimited: 0 });
    expect(m.version).toBe('1.2.3');
    expect(m.startedAt).toBe(new Date(NOW - 90_500).toISOString());
    expect(m.uptimeS).toBe(90);
    expect(m.memory).toEqual({ rssBytes: 100, heapUsedBytes: 20, heapTotalBytes: 40 });
    expect(m.sockets).toEqual({ websocketsOpen: 7 });
    expect(m.sessions).toEqual({ total: 0, byPhase: sessions.byPhase });
    expect(m.rdo).toEqual({ sent: 0, timedOut: 0, errorReplies: 0, lateResponses: 0, reconnectFailures: 0 });
    expect(m.directory).toEqual({ reachable: true, lastOkAgeS: 10, lastProbeAgeS: 2, consecutiveFailures: 1, lastError: 'x' });
  });

  it('directory.reachable is null when never probed, false when stale', () => {
    expect(buildMetrics({ ...base, directory: state({}) }).directory).toEqual({
      reachable: null, lastOkAgeS: null, lastProbeAgeS: null, consecutiveFailures: 0, lastError: null,
    });
    expect(buildMetrics({ ...base, directory: state({ lastOkAt: NOW - DIRECTORY_STALE_MS - 1, lastAttemptAt: NOW }) }).directory.reachable).toBe(false);
  });

  it('clientErrors carries the /api/client-error counters, and they move after an accepted and a refused report', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const post = (contentType: string, body: string): number => {
        const listeners: { data: Array<(c: Buffer) => void>; end: Array<() => void> } = { data: [], end: [] };
        const req = {
          headers: { 'content-type': contentType },
          on(event: 'data' | 'end', listener: never) {
            (listeners[event] as Array<unknown>).push(listener);
            return req;
          },
        };
        let status = 0;
        const res = { writeHead: (s: number) => { status = s; }, end: () => undefined };
        handleClientErrorRequest(req as never, res, { allowRequest: () => true });
        for (const l of listeners.data) l(Buffer.from(body, 'utf8'));
        for (const l of listeners.end) l();
        return status;
      };
      const metricsNow = (): GatewayMetrics => buildMetrics({ ...base, directory: state({}), clientErrors: getClientErrorCounts() });

      const before = metricsNow().clientErrors;
      expect(Object.keys(before).sort()).toEqual(['accepted', 'rateLimited', 'refused']);

      const valid = JSON.stringify({
        v: 1, build: '1.0.0#1', kind: 'error', message: 'boom', frames: [],
        screen: 'login', surface: null, ua: 'chrome', mobile: false,
      });
      expect(post('application/json', valid)).toBe(204);
      const afterAccept = metricsNow().clientErrors;
      expect(afterAccept).toEqual({ ...before, accepted: before.accepted + 1 });

      expect(post('text/plain', valid)).toBe(415);
      const afterRefuse = metricsNow().clientErrors;
      expect(afterRefuse).toEqual({ ...afterAccept, refused: afterAccept.refused + 1 });

      const input = { accepted: 1, refused: 2, rateLimited: 3 };
      const m = buildMetrics({ ...base, directory: state({}), clientErrors: input });
      expect(m.clientErrors).toEqual(input);
      expect(m.clientErrors).not.toBe(input);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('readGatewayVersion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-obs-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the version field', () => {
    const file = path.join(dir, 'ok.json');
    fs.writeFileSync(file, JSON.stringify({ version: '1.2.3' }));
    expect(readGatewayVersion(file)).toBe('1.2.3');
  });

  it('a missing file, bad JSON, or no usable version → "unknown"', () => {
    expect(readGatewayVersion(path.join(dir, 'missing.json'))).toBe('unknown');
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    expect(readGatewayVersion(bad)).toBe('unknown');
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ version: '' }));
    expect(readGatewayVersion(empty)).toBe('unknown');
    const nul = path.join(dir, 'null.json');
    fs.writeFileSync(nul, 'null');
    expect(readGatewayVersion(nul)).toBe('unknown');
  });

  it('the default path is the repo package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
    expect(readGatewayVersion()).toBe(pkg.version);
  });
});

describe('startMetricsLog', () => {
  it('logs exactly one METRICS line per interval at info, carrying the collected object', () => {
    jest.useFakeTimers();
    const metrics = { version: 'v' } as unknown as GatewayMetrics;
    const collect = jest.fn(() => metrics);
    const log = { info: jest.fn() };

    const handle = startMetricsLog(collect, log);
    jest.advanceTimersByTime(METRICS_LOG_INTERVAL_MS - 1);
    expect(log.info).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('METRICS', metrics);

    handle.stop();
    jest.advanceTimersByTime(5 * METRICS_LOG_INTERVAL_MS);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it('the handle is unref()d', () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    startMetricsLog(() => ({}) as GatewayMetrics, { info: jest.fn() }).stop();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), METRICS_LOG_INTERVAL_MS);
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
