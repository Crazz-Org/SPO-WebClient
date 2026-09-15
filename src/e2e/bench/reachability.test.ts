import * as net from 'net';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  endpointsFromDriveLog,
  gameServerTarget,
  probeDriveEndpoints,
  probeGameServer,
  GAME_SERVER_PROBE_TIMEOUT_MS,
  MAX_LOG_ENDPOINTS,
  type ProbeSocket,
  type SocketFactory,
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

describe('endpointsFromDriveLog', () => {
  it('names every distinct endpoint a connect failure mentions, in first-seen order', () => {
    const log = [
      '[flow] login-spine starting',
      'Error: connect ETIMEDOUT 158.69.153.134:8000',
      'Error: connect ETIMEDOUT 158.69.153.134:8000',
      'Error: connect ECONNREFUSED 10.0.0.2:1111',
    ].join('\n');
    expect(endpointsFromDriveLog(log)).toEqual([
      { host: '158.69.153.134', port: 8000 },
      { host: '10.0.0.2', port: 1111 },
    ]);
  });

  it('finds nothing in a log that records no connect failure', () => {
    expect(endpointsFromDriveLog('[flow] login-spine failed: assertion on rating\n')).toEqual([]);
  });
});

describe('probeDriveEndpoints', () => {
  /** Dials are answered by port: a fake socket that connects, or one that refuses. */
  function factory(open: (port: number) => boolean, dialled: string[]): SocketFactory {
    return (host, port) => {
      dialled.push(`${host}:${port}`);
      const fake = new FakeSocket();
      setImmediate(() => (open(port) ? fake.fireConnect() : fake.fireError(new Error('ETIMEDOUT'))));
      return fake;
    };
  }

  const frontDoor = `${gameServerTarget().host}:${gameServerTarget().port}`;
  const worldOutage = 'Error: connect ETIMEDOUT 158.69.153.134:8000\n'.repeat(3);

  it('stops at the front door when the directory itself does not answer', async () => {
    const dialled: string[] = [];
    const result = await probeDriveEndpoints('drive.log', factory(() => false, dialled), 500, () => worldOutage);
    expect(result).toMatchObject({ ok: false, target: frontDoor });
    expect(dialled).toEqual([frontDoor]);
  });

  it('answers ok: false for the world server the drive named, even though the directory answers', async () => {
    const dialled: string[] = [];
    const result = await probeDriveEndpoints(
      'drive.log',
      factory(port => port === gameServerTarget().port, dialled),
      500,
      () => worldOutage,
    );
    expect(result.ok).toBe(false);
    expect(result.target).toBe('158.69.153.134:8000');
    expect(result.detail).toMatch(/the drive's own log names this endpoint as unreachable/);
    expect(dialled).toEqual([frontDoor, '158.69.153.134:8000']);
  });

  it('answers ok: true when every endpoint the drive failed on answers now — the FAIL is the code', async () => {
    const dialled: string[] = [];
    const result = await probeDriveEndpoints('drive.log', factory(() => true, dialled), 500, () => worldOutage);
    expect(result).toMatchObject({ ok: true, target: `${frontDoor}, 158.69.153.134:8000` });
    expect(result.detail).toMatch(/every endpoint the drive failed to reach answers/);
  });

  it('answers ok: true when the log names no unreachable endpoint at all', async () => {
    const dialled: string[] = [];
    const result = await probeDriveEndpoints(
      'drive.log',
      factory(() => true, dialled),
      500,
      () => '[flow] login-spine failed: wrong rating\n',
    );
    expect(result).toMatchObject({ ok: true, target: frontDoor });
    expect(result.detail).toMatch(/names no unreachable endpoint/);
    expect(dialled).toEqual([frontDoor]);
  });

  it('re-dials at most MAX_LOG_ENDPOINTS of them, however many the log names', async () => {
    const dialled: string[] = [];
    const many = Array.from(
      { length: MAX_LOG_ENDPOINTS + 3 },
      (_unused, i) => `connect ECONNREFUSED 10.0.0.${i}:8000`,
    ).join('\n');
    await probeDriveEndpoints('drive.log', factory(() => true, dialled), 500, () => many);
    expect(dialled).toHaveLength(1 + MAX_LOG_ENDPOINTS);
  });

  it('a drive log it cannot read is not evidence of an outage — ok: true, and it says why', async () => {
    const dialled: string[] = [];
    const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-reach-')), 'never-written.log');
    const result = await probeDriveEndpoints(missing, factory(() => true, dialled));
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/the drive log could not be read/);
    expect(dialled).toEqual([frontDoor]);
  });

  it('reads the log off disk by default — the real reader finds the endpoint', async () => {
    const dialled: string[] = [];
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-reach-')), 'job.log');
    fs.writeFileSync(logFile, worldOutage, 'utf8');
    const result = await probeDriveEndpoints(logFile, factory(port => port !== 8000, dialled), 500);
    expect(result).toMatchObject({ ok: false, target: '158.69.153.134:8000' });
  });
});
