/**
 * `SPO_THEME` must reach the browser the way `SPO_REGISTER_URL` does: the runtime-config
 * script linked into `index.html`, and `window.__SPO_THEME__` assigned by it. And the other
 * channel default, `?theme=` on the page URL, must not break the page: `/?theme=legacy` is
 * `index.html` exactly as `/` is — the static-file fallback used to take the whole
 * `req.url` as a file name and answered "File not found".
 *
 * Same harness as register-url-injection.test.ts: the exported `httpServer` on 127.0.0.1:0,
 * never `startGateway()`. `SPO_THEME` is read by `shared/config.ts` at evaluation, so it is
 * set before the module graph loads.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';

describe('GET / — default theme injection and ?theme= on the page URL', () => {
  let httpServer: http.Server;
  let port: number;
  const savedTheme = process.env.SPO_THEME;

  beforeAll(() => {
    process.env.SPO_THEME = 'legacy';
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
    if (savedTheme === undefined) delete process.env.SPO_THEME;
    else process.env.SPO_THEME = savedTheme;
    jest.resetModules();
  });

  function get(path: string): Promise<{ status: number; type: string; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('links /spo-runtime-config.js into index.html when a default theme is configured', async () => {
    const { status, body } = await get('/');
    expect(status).toBe(200);
    expect(body).toContain('<script src="/spo-runtime-config.js"></script>');
  });

  it('serves the default theme through /spo-runtime-config.js', async () => {
    const { status, body } = await get('/spo-runtime-config.js');
    expect(status).toBe(200);
    expect(body).toContain('window.__SPO_THEME__="legacy";');
  });

  it('answers /?theme=legacy with index.html — the query string is no part of the file name', async () => {
    const plain = await get('/');
    const themed = await get('/?theme=legacy');
    expect(themed.status).toBe(200);
    expect(themed.type).toContain('text/html');
    expect(themed.body).toContain('id="react-root"');
    expect(themed.body).toBe(plain.body);
  });

  it('keeps a query string off any static file name, not only the root', async () => {
    const { status, type } = await get('/index.html?theme=empire');
    expect(status).toBe(200);
    expect(type).toContain('text/html');
  });
});
