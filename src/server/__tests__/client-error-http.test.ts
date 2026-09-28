/**
 * POST /api/client-error through the real HTTP server bound to 127.0.0.1:0 — never 8080 — using
 * the exported `httpServer` rather than `startGateway()` (harness of observability-http.test.ts).
 * Proves the route wiring in server.ts: the method gate, and the per-IP bucket (20/min).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';

interface Reply {
  status: number;
  body: string;
}

const VALID = JSON.stringify({
  v: 1,
  build: '1.0.0#1',
  kind: 'error',
  message: 'boom',
  frames: [],
  screen: 'login',
  surface: null,
  ua: 'chrome',
  mobile: false,
});

describe('POST /api/client-error (real HTTP server)', () => {
  let httpServer: http.Server;
  let port: number;
  const savedSingleUser = process.env.SINGLE_USER_MODE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    delete process.env.SINGLE_USER_MODE;
    delete process.env.TRUST_PROXY;
    jest.resetModules();
    jest.useFakeTimers();
    const mod = require('../server') as typeof import('../server');
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

  function request(urlPath: string, method: string, body?: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  it('a valid POST with Content-Type application/json → 204, empty body', async () => {
    const reply = await request('/api/client-error', 'POST', VALID);
    expect(reply.status).toBe(204);
    expect(reply.body).toBe('');
  });

  it('GET /api/client-error → 404 (only POST is routed)', async () => {
    const reply = await request('/api/client-error', 'GET');
    expect(reply.status).toBe(404);
  });

  it('the 21st valid POST from one peer in a window → 429 from the per-IP bucket', async () => {
    // One already accepted above; 19 more fill the 20/min bucket.
    for (let i = 0; i < 19; i++) {
      expect((await request('/api/client-error', 'POST', VALID)).status).toBe(204);
    }
    const reply = await request('/api/client-error', 'POST', VALID);
    expect(reply.status).toBe(429);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Too many error reports. Try again in a minute.' });
  });

  it('/api/metrics carries clientErrors reflecting the outcomes above', async () => {
    const reply = await request('/api/metrics', 'GET');
    expect(reply.status).toBe(200);
    const m = JSON.parse(reply.body) as { clientErrors: { accepted: number; refused: number; rateLimited: number } };
    expect(Object.keys(m.clientErrors).sort()).toEqual(['accepted', 'rateLimited', 'refused']);
    expect(m.clientErrors.accepted).toBeGreaterThanOrEqual(20);
    expect(m.clientErrors.rateLimited).toBeGreaterThanOrEqual(1);
  });
});
