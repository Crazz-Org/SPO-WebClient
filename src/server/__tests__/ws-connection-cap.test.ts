/**
 * The per-IP WebSocket cap (SEC-W-3) and the per-type auth refusal, over a real socket bound to
 * 127.0.0.1:0 — never 8080 — using the exported `httpServer` rather than `startGateway()`,
 * which boots asset-downloading services unacceptable in Jest (pattern of
 * debug-log-rate-limit.test.ts).
 *
 * SINGLE_USER_MODE and TRUST_PROXY are cleared BEFORE the module graph loads: single-user mode
 * skips every per-IP ceiling, and the cap is keyed on the socket address here.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';
import WebSocket from 'ws';

type RateLimitModule = typeof import('../rate-limit');

describe('WebSocket per-IP connection cap', () => {
  let httpServer: http.Server;
  let port: number;
  let rateLimit: RateLimitModule;
  const clients: WebSocket[] = [];
  const savedSingleUser = process.env.SINGLE_USER_MODE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    delete process.env.SINGLE_USER_MODE;
    delete process.env.TRUST_PROXY;
    jest.resetModules();
    jest.useFakeTimers();
    const mod = require('../server') as typeof import('../server');
    rateLimit = require('../rate-limit') as RateLimitModule;
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
    // Close each client and wait for it, then let the server-side close handlers (which log
    // SESSION_END and run endSession) finish before Jest tears the console down.
    await Promise.all(
      clients.map(
        c =>
          new Promise<void>(resolve => {
            if (c.readyState === WebSocket.CLOSED) return resolve();
            c.once('close', () => resolve());
            c.terminate();
          })
      )
    );
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
    else process.env.SINGLE_USER_MODE = savedSingleUser;
    if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedTrustProxy;
    jest.resetModules();
  });

  function connect(): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    clients.push(ws);
    return ws;
  }

  function outcome(ws: WebSocket): Promise<{ open: boolean; status?: number }> {
    return new Promise(resolve => {
      ws.once('open', () => resolve({ open: true }));
      ws.once('unexpected-response', (_req: http.ClientRequest, res: http.IncomingMessage) =>
        resolve({ open: false, status: res.statusCode })
      );
      ws.once('error', () => resolve({ open: false }));
    });
  }

  it('accepts 20 connections from one IP and answers the 21st with 429', async () => {
    const first20 = await Promise.all(Array.from({ length: 20 }, () => outcome(connect())));
    expect(first20.every(r => r.open)).toBe(true);

    const twentyFirst = await outcome(connect());
    expect(twentyFirst).toEqual({ open: false, status: 429 });
  });

  it('refuses an auth message once its per-type bucket is spent, before any dispatch', async () => {
    for (let i = 0; i < 10; i++) {
      expect(rateLimit.checkAuthRateLimit('127.0.0.1', 'REQ_AUTH_CHECK')).toBe(true);
    }
    const ws = clients[0];
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const reply = new Promise<Record<string, unknown>>(resolve => {
      ws.on('message', (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.wsRequestId === 't1') resolve(msg);
      });
    });
    ws.send(JSON.stringify({ type: 'REQ_AUTH_CHECK', wsRequestId: 't1' }));

    const msg = await reply;
    expect(msg.type).toBe('RESP_ERROR');
    expect(msg.errorMessage).toBe('Too many authentication attempts. Please try again later.');
  });
});
