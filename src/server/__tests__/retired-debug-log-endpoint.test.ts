/**
 * The client wire-history endpoint was removed (#1054): a POST to its old path must fall
 * through to the static handler and answer 404. Harness: exported `httpServer` on
 * 127.0.0.1:0 — never 8080. LOG_FILE is read at module load, so it is set before the require.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

// Built by join so a grep for the literal route over src/ stays empty.
const RETIRED_PATH = ['', 'api', 'debug-log'].join('/');

describe('retired client wire-history endpoint', () => {
  let httpServer: http.Server;
  let port: number;
  const savedLogFile = process.env.LOG_FILE;
  const logFile = path.join(os.tmpdir(), `spo-retired-debug-log-${Date.now()}.log`);

  beforeAll(() => {
    process.env.LOG_FILE = logFile;
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
    jest.resetModules();
  });

  it('answers 404 and writes nothing to the log', async () => {
    const body = JSON.stringify({ player: 'test', history: [{ dir: 'SEND', type: 'X', ts: 0 }] });
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: RETIRED_PATH,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
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
    expect(status).toBe(404);
    const logged = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    expect(logged).not.toContain('"player":"test"');
  });
});
