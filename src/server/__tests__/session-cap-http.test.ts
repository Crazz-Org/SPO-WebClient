/**
 * Global session cap (SEC-W-3, #1074) through the real HTTP server bound to 127.0.0.1:0 — never
 * 8080 — using the exported `httpServer` rather than `startGateway()` (pattern of
 * debug-log-rate-limit.test.ts / observability-http.test.ts). The cap is filled through its test
 * accessor; the phase gate is passed by spying `getPhase`. No socket opens to anything but
 * 127.0.0.1.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as net from 'net';
import WebSocket from 'ws';

type ServerModule = typeof import('../server');
type SessionCapModule = typeof import('../session-cap');

describe('global session cap (real HTTP server)', () => {
  let httpServer: http.Server;
  let port: number;
  let mod: ServerModule;
  let capMod: SessionCapModule;
  const fillers = [new EventEmitter(), new EventEmitter()];
  const clients: WebSocket[] = [];
  const connectHosts: unknown[] = [];
  const savedSingleUser = process.env.SINGLE_USER_MODE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    delete process.env.SINGLE_USER_MODE;
    delete process.env.TRUST_PROXY;
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
    jest.resetModules();
    jest.useFakeTimers();
    mod = require('../server') as ServerModule;
    capMod = require('../session-cap') as SessionCapModule;
    jest.clearAllTimers();
    jest.useRealTimers();

    httpServer = mod.httpServer;
    return new Promise<void>(resolve => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const c of clients) c.terminate();
    for (const f of fillers) f.emit('destroyed');
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
    else process.env.SINGLE_USER_MODE = savedSingleUser;
    if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedTrustProxy;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  /** The host of a `net.Socket#connect` call, whatever form its arguments took. */
  function hostOf(args: unknown[]): unknown {
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    if (first && typeof first === 'object' && 'host' in first) return (first as { host?: unknown }).host;
    return args[1];
  }

  it('refuses REQ_LOGIN_WORLD at the cap: RESP_ERROR "server full", then a 1013 close', async () => {
    const { StarpeaceSession } = require('../spo_session') as typeof import('../spo_session');
    const { SessionPhase } = require('../../shared/types') as typeof import('../../shared/types');
    const ErrorCodes = require('../../shared/error-codes') as typeof import('../../shared/error-codes');

    mod.sessionCap.setMax(2);
    for (const f of fillers) expect(mod.sessionCap.tryAdmit(f as unknown as InstanceType<typeof StarpeaceSession>)).toBe(true);
    jest.spyOn(StarpeaceSession.prototype, 'getPhase').mockReturnValue(SessionPhase.DIRECTORY_CONNECTED);
    const loginWorld = jest.spyOn(StarpeaceSession.prototype, 'loginWorld');
    const realConnect = net.Socket.prototype.connect;
    jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      connectHosts.push(hostOf(args));
      return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    clients.push(ws);
    const events: Array<{ kind: 'message'; data: Record<string, unknown> } | { kind: 'close'; code: number }> = [];
    ws.on('message', (d: Buffer) => events.push({ kind: 'message', data: JSON.parse(d.toString()) as Record<string, unknown> }));
    const closed = new Promise<void>(resolve => ws.once('close', (code: number) => { events.push({ kind: 'close', code }); resolve(); }));
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });

    ws.send(JSON.stringify({ type: 'REQ_LOGIN_WORLD', wsRequestId: 'cap-1', username: 'u', password: 'p', worldName: 'W' }));
    await closed;

    expect(events).toEqual([
      {
        kind: 'message',
        data: {
          type: 'RESP_ERROR',
          wsRequestId: 'cap-1',
          errorMessage: capMod.SERVER_FULL_MESSAGE,
          code: ErrorCodes.ERROR_RequestDenied,
        },
      },
      { kind: 'close', code: capMod.WS_TRY_AGAIN_LATER_CLOSE_CODE },
    ]);
    expect(capMod.WS_TRY_AGAIN_LATER_CLOSE_CODE).toBe(1013);
    expect(loginWorld).not.toHaveBeenCalled();
    expect(connectHosts.length).toBeGreaterThan(0);
    expect(connectHosts.every(h => h === '127.0.0.1')).toBe(true);
    expect(mod.sessionCap.counters()).toEqual({ admitted: 2, max: 2, refusedFull: 1 });
    const warn = console.warn as unknown as jest.Mock;
    const refusedLine = warn.mock.calls.map(c => c.map(String).join(' ')).find(line => line.includes('SESSION_CAP_REFUSED'));
    expect(refusedLine).toBeDefined();
    expect(refusedLine).not.toMatch(/username|password/i);
  });

  it('/api/metrics carries sessions.admitted, sessions.max and sessions.refusedFull', async () => {
    const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/metrics', method: 'GET' }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(reply.status).toBe(200);
    const sessions = (JSON.parse(reply.body) as { sessions: Record<string, unknown> }).sessions;
    expect(sessions).toMatchObject({ admitted: 2, max: 2, refusedFull: 1 });
    expect(Object.keys(sessions).sort()).toEqual(['admitted', 'byPhase', 'max', 'refusedFull', 'total']);
  });
});
