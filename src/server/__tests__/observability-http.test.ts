/**
 * /api/health, /api/metrics and the local-only guard on the two census readouts, through the
 * real HTTP server bound to 127.0.0.1:0 — never 8080 — using the exported `httpServer` rather
 * than `startGateway()` (pattern of client-ip-trust-proxy.test.ts / ws-connection-cap.test.ts).
 * `startGateway()` is never called, so the directory probe never dials anything: the test sets
 * the probe state itself. Every socket here goes to 127.0.0.1.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';
import WebSocket from 'ws';

type ObservabilityModule = typeof import('../observability');

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('gateway observability endpoints (real HTTP server)', () => {
  let httpServer: http.Server;
  let port: number;
  let obs: ObservabilityModule;
  const savedSingleUser = process.env.SINGLE_USER_MODE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    delete process.env.SINGLE_USER_MODE;
    delete process.env.TRUST_PROXY;
    jest.resetModules();
    jest.useFakeTimers();
    const mod = require('../server') as typeof import('../server');
    obs = require('../observability') as ObservabilityModule;
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
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
    else process.env.SINGLE_USER_MODE = savedSingleUser;
    if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedTrustProxy;
    jest.resetModules();
  });

  function request(urlPath: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: urlPath, method: options.method ?? 'GET', headers: options.headers ?? {} },
        res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  async function metrics(): Promise<import('../observability').GatewayMetrics> {
    const reply = await request('/api/metrics');
    expect(reply.status).toBe(200);
    return JSON.parse(reply.body) as import('../observability').GatewayMetrics;
  }

  async function waitFor(check: (m: import('../observability').GatewayMetrics) => boolean): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (check(await metrics())) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('condition never held');
  }

  describe('local-only readouts', () => {
    it.each(['/api/metrics', '/api/rdo-error-contract', '/api/property-fallback'])(
      '%s from 127.0.0.1 without X-Forwarded-For → 200 JSON',
      async route => {
        const reply = await request(route);
        expect(reply.status).toBe(200);
        expect(reply.headers['content-type']).toBe('application/json');
        expect(reply.headers['cache-control']).toBe('no-store');
        expect(() => JSON.parse(reply.body)).not.toThrow();
      },
    );

    it.each(['/api/metrics', '/api/rdo-error-contract', '/api/property-fallback'])(
      '%s with X-Forwarded-For → 403, no detail',
      async route => {
        const reply = await request(route, { headers: { 'X-Forwarded-For': '203.0.113.7' } });
        expect(reply.status).toBe(403);
        expect(reply.body).toBe('Forbidden');
      },
    );

    it('/api/metrics carries the documented top-level keys', async () => {
      const m = await metrics();
      expect(Object.keys(m).sort()).toEqual(['clientErrors', 'directory', 'memory', 'rdo', 'sessions', 'sockets', 'startedAt', 'uptimeS', 'version']);
      expect(m.version).toBe(obs.readGatewayVersion());
      expect(Object.keys(m.sessions.byPhase).sort()).toEqual(
        ['DIRECTORY_CONNECTED', 'DISCONNECTED', 'RECONNECTING', 'WORLD_CONNECTED', 'WORLD_CONNECTING'],
      );
    });
  });

  describe('/api/health', () => {
    it('never probed → 503 unavailable/unknown, no-store', async () => {
      const reply = await request('/api/health');
      expect(reply.status).toBe(503);
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(reply.body)).toEqual({
        status: 'unavailable',
        directory: 'unknown',
        directoryLastOkAgeS: null,
        gateway: 'starting',
      });
    });

    it('HEAD answers the same status with an empty body', async () => {
      const reply = await request('/api/health', { method: 'HEAD' });
      expect(reply.status).toBe(503);
      expect(reply.body).toBe('');
    });

    it('after a successful probe → 200 reachable, and it stays public behind a proxy', async () => {
      obs.directoryProbe.recordOutcome(true, null);

      const reply = await request('/api/health');
      expect(reply.status).toBe(200);
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(reply.body)).toEqual({
        status: 'ok',
        directory: 'reachable',
        directoryLastOkAgeS: 0,
        gateway: 'starting',
      });

      const head = await request('/api/health', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.body).toBe('');

      const proxied = await request('/api/health', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
      expect(proxied.status).toBe(200);
    });
  });

  it('a WebSocket session is counted while open and leaves the registry on close', async () => {
    const before = await metrics();
    expect(before.sessions.total).toBe(0);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await waitFor(m => m.sessions.total === 1 && m.sockets.websocketsOpen === 1);
    const open = await metrics();
    expect(open.sessions.byPhase.DISCONNECTED).toBe(1);

    await new Promise<void>(resolve => {
      ws.once('close', () => resolve());
      ws.close();
    });
    await waitFor(m => m.sessions.total === 0 && m.sockets.websocketsOpen === 0);
  });
});
