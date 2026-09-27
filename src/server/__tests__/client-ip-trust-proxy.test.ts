/**
 * SEC-H-7 through the real HTTP server: with TRUST_PROXY=true the rate-limit bucket is
 * keyed by the RIGHTMOST X-Forwarded-For entry (the one our nginx appended), so a forged
 * leftmost entry cannot buy a fresh bucket. Same harness as debug-log-rate-limit.test.ts:
 * exported `httpServer` on 127.0.0.1:0 — never 8080. LOG_FILE and TRUST_PROXY are read at
 * module load, so both are set before the require.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

describe('client IP behind a trusted proxy — rightmost X-Forwarded-For entry', () => {
  let httpServer: http.Server;
  let port: number;
  const savedLogFile = process.env.LOG_FILE;
  const savedTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    process.env.LOG_FILE = path.join(os.tmpdir(), `spo-client-ip-trust-proxy-${Date.now()}.log`);
    process.env.TRUST_PROXY = 'true';
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
    if (savedLogFile === undefined) delete process.env.LOG_FILE;
    else process.env.LOG_FILE = savedLogFile;
    if (savedTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = savedTrustProxy;
    jest.resetModules();
  });

  function postDebugLog(xff: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ player: 'test', history: [] });
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/debug-log',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Forwarded-For': xff,
          },
        },
        res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  it('a different spoofed leftmost entry does not buy a fresh bucket', async () => {
    expect(await postDebugLog('1.1.1.1, 198.51.100.10')).not.toBe(429);
    expect(await postDebugLog('2.2.2.2, 198.51.100.10')).not.toBe(429);
    expect(await postDebugLog('3.3.3.3, 198.51.100.10')).toBe(429);
  });

  it('different rightmost entries land in separate buckets', async () => {
    expect(await postDebugLog('9.9.9.9, 198.51.100.20')).not.toBe(429);
    expect(await postDebugLog('9.9.9.9, 198.51.100.21')).not.toBe(429);
  });
});
