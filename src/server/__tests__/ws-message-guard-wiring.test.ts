/**
 * The per-socket message guard (SEC-W-6) wired into `ws.on('message')`, over a real socket bound
 * to 127.0.0.1:0 — never 8080 — using the exported `httpServer` (pattern of
 * ws-connection-cap.test.ts).
 *
 * SINGLE_USER_MODE is set BEFORE the module graph loads: the guard must hold in the bench's
 * mode, and single-user mode skips the per-IP auth limiter these floods would otherwise trip.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';
import WebSocket from 'ws';
import type { WsHandler } from '../ws-handlers/types';
import { WsMessageType } from '../../shared/types';

type ServerModule = typeof import('../server');
type LoggerModule = typeof import('../../shared/logger');
type HandlersModule = typeof import('../ws-handlers');

const savedSingleUser = process.env.SINGLE_USER_MODE;

function loadServer(): ServerModule {
  jest.useFakeTimers();
  const mod = require('../server') as ServerModule;
  jest.clearAllTimers();
  jest.useRealTimers();
  return mod;
}

function listen(server: http.Server): Promise<number> {
  return new Promise<number>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(addr && typeof addr === 'object' ? addr.port : 0);
    });
  });
}

async function shutdown(server: http.Server, clients: WebSocket[]): Promise<void> {
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
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

function restoreEnv(): void {
  if (savedSingleUser === undefined) delete process.env.SINGLE_USER_MODE;
  else process.env.SINGLE_USER_MODE = savedSingleUser;
}

function openSocket(port: number, clients: WebSocket[]): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
  clients.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise(resolve => {
    ws.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('message guard wiring — rate (real constants)', () => {
  let httpServer: http.Server;
  let port: number;
  let warnSpy: jest.SpyInstance;
  const clients: WebSocket[] = [];

  beforeAll(async () => {
    process.env.SINGLE_USER_MODE = 'true';
    jest.resetModules();
    httpServer = loadServer().httpServer;
    const loggerMod = require('../../shared/logger') as LoggerModule;
    warnSpy = jest.spyOn(loggerMod.Logger.prototype, 'warn').mockImplementation(() => undefined);
    port = await listen(httpServer);
  });

  afterAll(async () => {
    await shutdown(httpServer, clients);
    warnSpy.mockRestore();
    restoreEnv();
    jest.resetModules();
  });

  const phaseGateCalls = () =>
    warnSpy.mock.calls.filter(c => String(c[0]).includes('rejected: not allowed in phase')).length;
  const guardCalls = () =>
    warnSpy.mock.calls.filter(c => String(c[0]).includes('closed by message guard'));

  it('closes a 60-message flood with 1008 before the 60th is handled, and runs nothing after', async () => {
    warnSpy.mockClear();
    const ws = await openSocket(port, clients);
    const done = closed(ws);
    for (let i = 0; i < 60; i++) {
      ws.send(JSON.stringify({ type: 'REQ_MAP_LOAD', wsRequestId: `f${i}` }));
    }
    const { code, reason } = await done;
    expect(code).toBe(1008);
    expect(reason).toBe('Message rate exceeded');

    const handledAtClose = phaseGateCalls();
    expect(handledAtClose).toBeLessThanOrEqual(50);
    await wait(200);
    expect(phaseGateCalls()).toBe(handledAtClose);

    const guard = guardCalls();
    expect(guard).toHaveLength(1);
    expect(guard[0][1]).toEqual(
      expect.objectContaining({ ip: '127.0.0.1', reason: 'Message rate exceeded', player: 'unknown' })
    );
  });

  it('charges a duplicate-"type" message (fast-lane type first) a token like any other', async () => {
    warnSpy.mockClear();
    const ws = await openSocket(port, clients);
    const done = closed(ws);
    for (let i = 0; i < 60; i++) {
      ws.send('{"type":"REQ_UPDATE_CAMERA","type":"REQ_MAP_LOAD"}');
    }
    const { code, reason } = await done;
    expect(code).toBe(1008);
    expect(reason).toBe('Message rate exceeded');
    expect(guardCalls()).toHaveLength(1);
  });

  it('leaves a socket that stays within the burst open and answered', async () => {
    const ws = await openSocket(port, clients);
    const replies: string[] = [];
    ws.on('message', (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { wsRequestId?: string };
      if (msg.wsRequestId?.startsWith('ok')) replies.push(msg.wsRequestId);
    });
    for (let i = 0; i < 10; i++) {
      ws.send(JSON.stringify({ type: 'REQ_MAP_LOAD', wsRequestId: `ok${i}` }));
    }
    await wait(200);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(replies).toHaveLength(10);
  });
});

describe('message guard wiring — queue depth', () => {
  let httpServer: http.Server;
  let port: number;
  let handlerRuns = 0;
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const firstEntered = new Promise<void>(resolve => { entered = resolve; });
  const clients: WebSocket[] = [];

  beforeAll(async () => {
    process.env.SINGLE_USER_MODE = 'true';
    jest.resetModules();
    // Lift the burst so the rate bucket cannot trip first; the queue cap keeps its real 100.
    jest.doMock('../ws-message-guard', () => ({
      ...jest.requireActual<typeof import('../ws-message-guard')>('../ws-message-guard'),
      WS_MESSAGE_BURST: 1000,
    }));
    httpServer = loadServer().httpServer;
    const handlers = require('../ws-handlers') as HandlersModule;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const hanging: WsHandler = async () => {
      handlerRuns += 1;
      entered();
      await gate;
    };
    jest.spyOn(handlers.wsHandlerRegistry, WsMessageType.REQ_AUTH_CHECK).mockImplementation(hanging);
    port = await listen(httpServer);
  });

  afterAll(async () => {
    release();
    await shutdown(httpServer, clients);
    jest.dontMock('../ws-message-guard');
    jest.restoreAllMocks();
    restoreEnv();
    jest.resetModules();
  });

  it('closes with 1008 on the 101st queued message, and nothing queued behind it ever runs', async () => {
    const ws = await openSocket(port, clients);
    const done = closed(ws);

    // Message 1 runs and hangs in its handler: it still holds one place in the queue.
    ws.send(JSON.stringify({ type: 'REQ_AUTH_CHECK', wsRequestId: 'q0' }));
    await firstEntered;

    // Messages 2..100 fill the queue; the 101st overflows it.
    for (let i = 1; i <= 100; i++) {
      ws.send(JSON.stringify({ type: 'REQ_AUTH_CHECK', wsRequestId: `q${i}` }));
    }
    const { code, reason } = await done;
    expect(code).toBe(1008);
    expect(reason).toBe('Too many queued messages');

    release();
    await wait(200);
    expect(handlerRuns).toBe(1);
  });
});
