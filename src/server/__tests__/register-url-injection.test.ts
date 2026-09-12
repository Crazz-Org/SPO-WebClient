/**
 * `SPO_REGISTER_URL` must trigger the runtime-config script injection into `index.html`,
 * the same way `SPO_FORCE_WORLD`/`SPO_BUG_REPORT` already do — otherwise the browser gets
 * `window.__SPO_REGISTER_URL__` from `/spo-runtime-config.js` but the page never links that
 * script, and AuthStage never sees the value.
 *
 * Drives the endpoint over a real socket bound to 127.0.0.1:0 using the exported
 * `httpServer` rather than `startGateway()`, which boots asset-downloading services
 * unacceptable in Jest (same approach as debug-log-rate-limit.test.ts).
 *
 * `SPO_REGISTER_URL` must be set BEFORE the module graph loads: `shared/config.ts` reads
 * it at evaluation.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';

describe('GET / — registration URL injection', () => {
  let httpServer: http.Server;
  let port: number;
  const savedRegisterUrl = process.env.SPO_REGISTER_URL;

  beforeAll(() => {
    process.env.SPO_REGISTER_URL = 'https://example.org/signup';
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
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    if (savedRegisterUrl === undefined) delete process.env.SPO_REGISTER_URL;
    else process.env.SPO_REGISTER_URL = savedRegisterUrl;
    jest.resetModules();
  });

  function getIndex(): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/', method: 'GET' },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('links /spo-runtime-config.js into index.html when a registration URL is configured', async () => {
    const { status, body } = await getIndex();
    expect(status).toBe(200);
    expect(body).toContain('<script src="/spo-runtime-config.js"></script>');
  });

  it('serves the registration url through /spo-runtime-config.js', async () => {
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/spo-runtime-config.js', method: 'GET' },
        r => {
          const chunks: Buffer[] = [];
          r.on('data', (chunk: Buffer) => chunks.push(chunk));
          r.on('end', () =>
            resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('window.__SPO_REGISTER_URL__="https://example.org/signup";');
  });
});
