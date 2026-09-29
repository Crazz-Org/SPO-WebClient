/**
 * Driven against a real local WebSocket server, not a stub: the point of WsDriver is
 * that it speaks over a socket, and a stubbed socket would test the wrong thing.
 */

import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'net';
import { WsMessageType } from '@/shared/types/message-types';
import { WsDriver, WsDriverError } from './ws-driver';

type Reply = (incoming: Record<string, unknown>, socket: WsSocket) => void;

let server: WebSocketServer;
let url: string;
let onMessage: Reply;

beforeEach(async () => {
  onMessage = () => undefined;
  server = new WebSocketServer({ port: 0 });
  server.on('connection', socket => {
    socket.on('message', raw => {
      onMessage(JSON.parse(raw.toString()) as Record<string, unknown>, socket);
    });
  });
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function send(socket: WsSocket, msg: Record<string, unknown>): void {
  socket.send(JSON.stringify(msg));
}

describe('WsDriver', () => {
  it('connects and reports the socket open', async () => {
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    expect(driver.log).toEqual([]);
    await driver.close();
  });

  it('fails with a usable message when nothing is listening', async () => {
    // A port that was open and is now closed refuses immediately, so the assertion is
    // about the error message rather than about the connect timeout.
    const spare = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => spare.once('listening', () => resolve()));
    const deadPort = (spare.address() as AddressInfo).port;
    await new Promise<void>(resolve => spare.close(() => resolve()));

    await expect(
      WsDriver.connect(`ws://127.0.0.1:${deadPort}`, 'http://localhost:8080'),
    ).rejects.toThrow(/failed to open/);
  });

  it('correlates a response to its request by wsRequestId', async () => {
    onMessage = (incoming, socket) => {
      // A push for an unrelated request must not satisfy this wait.
      send(socket, { type: WsMessageType.RESP_AUTH_SUCCESS, wsRequestId: 'someone-else' });
      send(socket, { type: WsMessageType.RESP_AUTH_SUCCESS, wsRequestId: incoming.wsRequestId });
    };
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    const reply = await driver.request(
      { type: WsMessageType.REQ_AUTH_CHECK, username: 'u', password: 'p' },
      WsMessageType.RESP_AUTH_SUCCESS,
      2_000,
    );
    expect(reply.type).toBe(WsMessageType.RESP_AUTH_SUCCESS);
    await driver.close();
  });

  it('rejects with the gateway error rather than hanging until the timeout', async () => {
    onMessage = (incoming, socket) =>
      send(socket, {
        type: WsMessageType.RESP_ERROR,
        wsRequestId: incoming.wsRequestId,
        errorMessage: 'World login failed: Unknown user',
        code: 42,
      });
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await expect(
      driver.request(
        { type: WsMessageType.REQ_LOGIN_WORLD, username: 'u', password: 'p', worldName: 'planitia' },
        WsMessageType.RESP_LOGIN_SUCCESS,
        2_000,
      ),
    ).rejects.toBeInstanceOf(WsDriverError);
    await driver.close();
  });

  it('carries the gateway error code and the request type on the rejection', async () => {
    onMessage = (incoming, socket) =>
      send(socket, {
        type: WsMessageType.RESP_ERROR,
        wsRequestId: incoming.wsRequestId,
        errorMessage: 'nope',
        code: 7,
      });
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await driver
      .request({ type: WsMessageType.REQ_AUTH_CHECK }, WsMessageType.RESP_AUTH_SUCCESS, 2_000)
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(WsDriverError);
        expect((err as WsDriverError).code).toBe(7);
        expect((err as WsDriverError).forType).toBe(WsMessageType.REQ_AUTH_CHECK);
      });
    await driver.close();
  });

  it('counts every RESP_ERROR as wire health, matched or not', async () => {
    onMessage = (_incoming, socket) =>
      send(socket, { type: WsMessageType.RESP_ERROR, errorMessage: 'unsolicited', code: 1 });
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    driver.send({ type: WsMessageType.REQ_AUTH_CHECK });
    await driver.waitFor(m => m.type === WsMessageType.RESP_ERROR, 2_000).catch(() => undefined);
    expect(driver.errors).toHaveLength(1);
    await driver.close();
  });

  it('times out with the label of what it was waiting for', async () => {
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await expect(
      driver.request({ type: WsMessageType.REQ_AUTH_CHECK }, WsMessageType.RESP_AUTH_SUCCESS, 50),
    ).rejects.toThrow(/RESP_AUTH_SUCCESS \(for REQ_AUTH_CHECK\)/);
    await driver.close();
  });

  it('resolves from an event that arrived before the wait started', async () => {
    onMessage = (_incoming, socket) =>
      send(socket, { type: WsMessageType.EVENT_REFRESH_DATE, date: '1' });
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    driver.send({ type: WsMessageType.REQ_AUTH_CHECK });
    await new Promise(resolve => setTimeout(resolve, 50));
    const event = await driver.waitFor(m => m.type === WsMessageType.EVENT_REFRESH_DATE, 50);
    expect(event.type).toBe(WsMessageType.EVENT_REFRESH_DATE);
    await driver.close();
  });

  describe('start-index wait (#1148)', () => {
    const typing = (isTyping: boolean) => (m: { type: string; isTyping?: unknown }) =>
      m.type === WsMessageType.EVENT_CHAT_USER_TYPING && m.isTyping === isTyping;

    it('counts received frames, and not the ones it cannot parse', async () => {
      onMessage = (_incoming, socket) => {
        socket.send('<html>proxy error</html>');
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: false });
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: true });
      };
      const driver = await WsDriver.connect(url, 'http://localhost:8080');
      expect(driver.receivedCount()).toBe(0);
      driver.send({ type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: false });
      await driver.waitFor(typing(true), 2_000);
      expect(driver.receivedCount()).toBe(2);
      await driver.close();
    });

    it('ignores a buffered match received before the start index', async () => {
      onMessage = (_incoming, socket) =>
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: false });
      const driver = await WsDriver.connect(url, 'http://localhost:8080');
      driver.send({ type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: false });
      await driver.waitFor(typing(false), 2_000);
      const from = driver.receivedCount();
      await expect(driver.waitFor(typing(false), 50, 'the away self-echo', from)).rejects.toThrow(
        /the away self-echo/,
      );
      await driver.close();
    });

    it('resolves on an identical message arriving after the start index', async () => {
      onMessage = (_incoming, socket) =>
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: false });
      const driver = await WsDriver.connect(url, 'http://localhost:8080');
      driver.send({ type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: false });
      await driver.waitFor(typing(false), 2_000);
      const from = driver.receivedCount();
      driver.send({ type: WsMessageType.REQ_CHAT_AWAY });
      const second = driver.waitFor(typing(false), 2_000, 'second echo', from);
      await expect(second).resolves.toMatchObject({ isTyping: false });
      expect(driver.receivedCount()).toBe(2);
      await driver.close();
    });

    it('resolves at once from a buffered match at or after the start index', async () => {
      onMessage = (_incoming, socket) => {
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: true });
        send(socket, { type: WsMessageType.EVENT_CHAT_USER_TYPING, username: 'a', isTyping: false });
      };
      const driver = await WsDriver.connect(url, 'http://localhost:8080');
      driver.send({ type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: true });
      await driver.waitFor(typing(false), 2_000);
      await expect(driver.waitFor(typing(false), 10, 'buffered', 1)).resolves.toMatchObject({
        isTyping: false,
      });
      await expect(driver.waitFor(typing(true), 10, 'too early', 1)).rejects.toThrow(/too early/);
      await driver.close();
    });
  });

  it('logs both directions with the correlation id', async () => {
    onMessage = (incoming, socket) =>
      send(socket, { type: WsMessageType.RESP_AUTH_SUCCESS, wsRequestId: incoming.wsRequestId });
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await driver.request({ type: WsMessageType.REQ_AUTH_CHECK }, WsMessageType.RESP_AUTH_SUCCESS, 2_000);
    expect(driver.log.map(e => e.direction)).toEqual(['sent', 'received']);
    expect(driver.log[0].wsRequestId).toBe(driver.log[1].wsRequestId);
    await driver.close();
  });

  it('collects every message of a type for post-flow assertions', async () => {
    onMessage = (_incoming, socket) => {
      send(socket, { type: WsMessageType.EVENT_CHAT_MSG, text: 'a' });
      send(socket, { type: WsMessageType.EVENT_CHAT_MSG, text: 'b' });
    };
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    driver.send({ type: WsMessageType.REQ_CHAT_GET_USERS });
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(driver.seen(WsMessageType.EVENT_CHAT_MSG)).toHaveLength(2);
    await driver.close();
  });

  it('ignores a frame it cannot parse instead of dying mid-flow', async () => {
    onMessage = (_incoming, socket) => {
      socket.send('<html>proxy error</html>');
      send(socket, { type: WsMessageType.RESP_AUTH_SUCCESS });
    };
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    const reply = await driver.request(
      { type: WsMessageType.REQ_AUTH_CHECK },
      WsMessageType.RESP_AUTH_SUCCESS,
      2_000,
    );
    expect(reply.type).toBe(WsMessageType.RESP_AUTH_SUCCESS);
    await driver.close();
  });

  it('fails a pending wait when the socket closes underneath it', async () => {
    onMessage = (_incoming, socket) => socket.close();
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await expect(
      driver.request({ type: WsMessageType.REQ_AUTH_CHECK }, WsMessageType.RESP_AUTH_SUCCESS, 2_000),
    ).rejects.toThrow(/closed/);
  });

  it('refuses to send once closed', async () => {
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await driver.close();
    expect(() => driver.send({ type: WsMessageType.REQ_AUTH_CHECK })).toThrow(/closed/);
  });

  it('close is safe to call twice', async () => {
    const driver = await WsDriver.connect(url, 'http://localhost:8080');
    await driver.close();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});
