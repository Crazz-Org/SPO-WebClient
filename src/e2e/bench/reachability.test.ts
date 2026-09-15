import * as net from 'net';
import type { AddressInfo } from 'net';
import {
  gameServerTarget,
  probeGameServer,
  GAME_SERVER_PROBE_TIMEOUT_MS,
  type ProbeSocket,
} from './reachability';

function listen(server: net.Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** A fake ProbeSocket whose listeners the test fires directly — no real network I/O. */
class FakeSocket implements ProbeSocket {
  destroyCalls = 0;
  private connectListener: (() => void) | undefined;
  private errorListener: ((err: Error) => void) | undefined;
  private timeoutCallback: (() => void) | undefined;

  setTimeout(_ms: number, callback: () => void): void {
    this.timeoutCallback = callback;
  }
  once(event: 'connect' | 'error', listener: (err: Error) => void): void {
    if (event === 'connect') this.connectListener = listener as () => void;
    else this.errorListener = listener;
  }
  destroy(): void {
    this.destroyCalls++;
  }
  fireConnect(): void {
    this.connectListener?.();
  }
  fireError(err: Error): void {
    this.errorListener?.(err);
  }
  fireTimeout(): void {
    this.timeoutCallback?.();
  }
}

describe('probeGameServer', () => {
  it('resolves ok: true when the socket connects, naming host:port as target', async () => {
    const fake = new FakeSocket();
    const promise = probeGameServer({ host: 'example.test', port: 1111 }, 5_000, () => fake);
    fake.fireConnect();
    const result = await promise;
    expect(result).toEqual({ ok: true, target: 'example.test:1111', detail: 'connected' });
    expect(fake.destroyCalls).toBe(1);
  });

  it('resolves ok: false with the error message carried into detail', async () => {
    const fake = new FakeSocket();
    const promise = probeGameServer({ host: 'example.test', port: 1111 }, 5_000, () => fake);
    fake.fireError(new Error('ECONNREFUSED'));
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.target).toBe('example.test:1111');
    expect(result.detail).toBe('ECONNREFUSED');
    expect(fake.destroyCalls).toBe(1);
  });

  it('resolves ok: false on a timeout, naming the elapsed budget', async () => {
    const fake = new FakeSocket();
    const promise = probeGameServer({ host: 'example.test', port: 1111 }, 5_000, () => fake);
    fake.fireTimeout();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/timed out after 5000ms/);
    expect(fake.destroyCalls).toBe(1);
  });

  it('destroys the socket exactly once even if multiple events fire', async () => {
    const fake = new FakeSocket();
    const promise = probeGameServer({ host: 'example.test', port: 1111 }, 5_000, () => fake);
    fake.fireConnect();
    fake.fireError(new Error('too late'));
    fake.fireTimeout();
    await promise;
    expect(fake.destroyCalls).toBe(1);
  });

  it('gameServerTarget reads the directory host and the standard port 1111', () => {
    const previous = process.env.RDO_DIR_HOST;
    delete process.env.RDO_DIR_HOST;
    try {
      expect(gameServerTarget()).toEqual({ host: 'www.starpeaceonline.com', port: 1111 });
    } finally {
      if (previous === undefined) delete process.env.RDO_DIR_HOST;
      else process.env.RDO_DIR_HOST = previous;
    }
  });

  it('default timeout constant is 10 seconds', () => {
    expect(GAME_SERVER_PROBE_TIMEOUT_MS).toBe(10_000);
  });

  it('the real socket factory: ok: true against a listening localhost server', async () => {
    const server = net.createServer();
    const port = await listen(server);
    try {
      const result = await probeGameServer({ host: '127.0.0.1', port }, 2_000);
      expect(result.ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it('the real socket factory: ok: false once that same port is closed', async () => {
    const server = net.createServer();
    const port = await listen(server);
    await new Promise<void>(resolve => server.close(() => resolve()));
    // A dial that lands immediately after close can race the loopback stack into completing
    // the handshake before the RST arrives; a short gap lets the closed state settle first —
    // same reasoning as src/server/session/picture-transfer.test.ts:241-245.
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = await probeGameServer({ host: '127.0.0.1', port }, 2_000);
    expect(result.ok).toBe(false);
  });
});
