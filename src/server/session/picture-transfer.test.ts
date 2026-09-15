import * as net from 'net';
import type { AddressInfo } from 'net';
import {
  sendPictureToCacheServer,
  uploadTycoonPicture,
  readJpegDimensions,
  PICTURE_CHUNK_BYTES,
  PICTURE_TRANSFER_PORT,
} from './picture-transfer';
import type { SessionContext } from './session-context';

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * A synthetic JPEG: FF D8, then FF C0 (SOF0) with length 0x0011, precision
 * 0x08, height/width as big-endian uint16, 3 components, then FF DA + entropy
 * bytes (optionally padded to `padTo` bytes total) + FF D9.
 */
function makeJpeg(width: number, height: number, padTo?: number): Buffer {
  const head = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11, // Lf
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, // Nf
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xda, // SOS
  ]);
  const tail = Buffer.from([0xff, 0xd9]);
  const minSize = head.length + tail.length;
  const padSize = padTo && padTo > minSize ? padTo - minSize : 0;
  const pad = Buffer.alloc(padSize, 0xaa);
  return Buffer.concat([head, pad, tail]);
}

interface ReplyScript {
  sendOnGreeting?: string;
  sendOnComplete?: string;
  delayMs?: number;
  destroyMidStream?: boolean;
}

interface FakePictureServer {
  server: net.Server;
  port: number;
  greeting: () => string | undefined;
  bytesAfterGreeting: () => number;
  connectionCount: () => number;
}

async function fakePictureServer(opts: ReplyScript = {}, bindPort = 0): Promise<FakePictureServer> {
  let greeting: string | undefined;
  let bytesAfterGreeting = 0;
  let connectionCount = 0;

  const server = net.createServer((socket) => {
    connectionCount++;
    let greeted = false;
    let sentComplete = false;

    socket.on('data', (chunk: Buffer) => {
      if (!greeted) {
        greeted = true;
        greeting = chunk.toString('latin1');
        const reply = (): void => {
          if (opts.sendOnGreeting !== undefined) socket.write(opts.sendOnGreeting);
        };
        if (opts.delayMs) setTimeout(reply, opts.delayMs);
        else reply();
        return;
      }
      bytesAfterGreeting += chunk.length;
      if (opts.destroyMidStream) {
        socket.destroy();
        return;
      }
      if (!sentComplete && opts.sendOnComplete !== undefined) {
        sentComplete = true;
        socket.write(opts.sendOnComplete);
      }
    });
  });

  const port = bindPort === 0 ? await listen(server) : await new Promise<number>((resolve) => {
    server.listen(bindPort, '127.0.0.1', () => resolve(bindPort));
  });
  return {
    server,
    port,
    greeting: () => greeting,
    bytesAfterGreeting: () => bytesAfterGreeting,
    connectionCount: () => connectionCount,
  };
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Wraps `_write` (the internal implementation `Writable.prototype.write`
 * delegates to), not the public `write` — `net.Socket.connect()` replaces the
 * instance's own `write` with the prototype's before any data flows, so an
 * override of the public method is silently dropped; `_write` survives.
 */
function spySocketFactory(): { factory: () => net.Socket; writes: number[] } {
  const writes: number[] = [];
  const factory = (): net.Socket => {
    const socket = new net.Socket();
    const original = socket._write.bind(socket);
    socket._write = (chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void => {
      writes.push(chunk.length);
      original(chunk, encoding, callback);
    };
    return socket;
  };
  return { factory, writes };
}

const VALID_JPEG = makeJpeg(150, 200);

const openServers: net.Server[] = [];
async function registerServer(fake: FakePictureServer): Promise<FakePictureServer> {
  openServers.push(fake.server);
  return fake;
}

afterEach(async () => {
  await Promise.all(openServers.map(closeServer));
  openServers.length = 0;
});

describe('sendPictureToCacheServer', () => {
  it('sends the exact greeting text with no trailing CRLF', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const jpeg = VALID_JPEG;
    await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'SPO_test3', worldName: 'planitia', jpeg,
    });
    expect(fake.greeting()).toBe(`User=SPO_test3\r\nWorld=planitia\r\nSize=${jpeg.length}`);
  });

  it('sends no byte before SEND arrives', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK', delayMs: 80 }));
    const resultPromise = sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.bytesAfterGreeting()).toBe(0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(fake.bytesAfterGreeting()).toBeGreaterThan(0);
  });

  it('the announced Size= always equals the bytes sent', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const jpeg = VALID_JPEG;
    await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg,
    });
    const sizeMatch = /Size=(\d+)/.exec(fake.greeting() ?? '');
    expect(sizeMatch).not.toBeNull();
    const announced = parseInt(sizeMatch![1], 10);
    expect(announced).toBe(jpeg.length);
    expect(fake.bytesAfterGreeting()).toBe(jpeg.length);
  });

  it('chunks the picture at 1024 bytes', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const jpeg = makeJpeg(150, 200, 2500);
    const { factory, writes } = spySocketFactory();
    await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg, socketFactory: factory,
    });
    // The first write is the greeting; the rest are the chunked picture.
    const chunkWrites = writes.slice(1);
    expect(chunkWrites.length).toBe(3);
    expect(chunkWrites[0]).toBe(PICTURE_CHUNK_BYTES);
    expect(chunkWrites[1]).toBe(PICTURE_CHUNK_BYTES);
    expect(chunkWrites[2]).toBe(jpeg.length % PICTURE_CHUNK_BYTES);
  });

  it('OK produces success with no reason', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('ERROR at the greeting produces GREETING_REFUSED', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'ERROR' }));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('GREETING_REFUSED');
  });

  it('ERROR after the bytes produces SERVER_ERROR, with a message distinct from GREETING_REFUSED', async () => {
    const afterBytes = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'ERROR' }));
    const atGreeting = await registerServer(await fakePictureServer({ sendOnGreeting: 'ERROR' }));

    const serverErrorResult = await sendPictureToCacheServer({
      host: '127.0.0.1', port: afterBytes.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    const greetingRefusedResult = await sendPictureToCacheServer({
      host: '127.0.0.1', port: atGreeting.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });

    expect(serverErrorResult.success).toBe(false);
    expect(serverErrorResult.reason).toBe('SERVER_ERROR');
    expect(serverErrorResult.message).not.toBe(greetingRefusedResult.message);
  });

  it('an unrecognised reply produces UNEXPECTED_REPLY and names the PicShopForm.pas divergence', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'WAT' }));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('UNEXPECTED_REPLY');
    expect(result.message).toContain('PicShopForm.pas:599');
  });

  it('a refused connection produces CONNECT_FAILED', async () => {
    const fake = await fakePictureServer();
    const port = fake.port;
    await closeServer(fake.server);
    // A dial that lands immediately after close can race the loopback stack
    // into completing the handshake before the RST arrives (observed on this
    // host); a short gap makes the port's closed state settle first, so the
    // refusal is a genuine ECONNREFUSED rather than a post-connect reset.
    await new Promise((r) => setTimeout(r, 100));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG, timeoutMs: 2000,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CONNECT_FAILED');
  });

  it('a closed (never-opened) port produces CONNECT_FAILED', async () => {
    const fake = await fakePictureServer();
    const neverOpenedPort = fake.port + 1;
    await closeServer(fake.server);
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: neverOpenedPort, userName: 'u', worldName: 'w', jpeg: VALID_JPEG, timeoutMs: 2000,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('CONNECT_FAILED');
  });

  it('a mid-stream disconnect produces DISCONNECTED, distinct from CONNECT_FAILED', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', destroyMidStream: true }));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('DISCONNECTED');
    expect(result.message).not.toContain('picture-transfer service');
  });

  it('times out when the server never answers', async () => {
    const fake = await registerServer(await fakePictureServer());
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG, timeoutMs: 200,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('TIMEOUT');
  });

  it('succeeds when the reply is split across packets', async () => {
    const server = net.createServer((socket) => {
      let greeted = false;
      socket.on('data', () => {
        if (!greeted) {
          greeted = true;
          socket.write('SE');
          setTimeout(() => socket.write('ND'), 10);
          return;
        }
        socket.write('OK');
      });
    });
    openServers.push(server);
    const port = await listen(server);
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port, userName: 'u', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid user name before connecting', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const result = await sendPictureToCacheServer({
      host: '127.0.0.1', port: fake.port, userName: 'evil\r\nWorld=x', worldName: 'w', jpeg: VALID_JPEG,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('INVALID_IDENTITY');
    expect(fake.connectionCount()).toBe(0);
  });
});

describe('validatePicture / uploadTycoonPicture — rejected before a byte reaches the socket', () => {
  function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      currentWorldInfo: { name: 'planitia', url: '', ip: '127.0.0.1', port: 0 },
      cachedUsername: 'SPO_test3',
      log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), setField: jest.fn() },
      ...overrides,
    } as unknown as SessionContext;
  }

  it.each([
    ['not a JPEG', Buffer.from('hello').toString('base64'), 'NOT_A_JPEG'],
    ['160x200 (wrong width)', makeJpeg(160, 200).toString('base64'), 'WRONG_DIMENSIONS'],
    ['150x210 (wrong height)', makeJpeg(150, 210).toString('base64'), 'WRONG_DIMENSIONS'],
    ['over the byte ceiling', makeJpeg(150, 200, 40000).toString('base64'), 'TOO_LARGE'],
    ['empty buffer', Buffer.alloc(0).toString('base64'), 'NOT_A_JPEG'],
    ['non-base64 garbage that decodes empty', '', 'NOT_A_JPEG'],
  ])('%s is rejected with %s and never opens a connection', async (_label, pictureBase64, expectedReason) => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const ctx = makeCtx({ currentWorldInfo: { name: 'planitia', url: '', ip: '127.0.0.1', port: fake.port } });
    const result = await uploadTycoonPicture(ctx, pictureBase64);
    expect(result.success).toBe(false);
    expect(result.reason).toBe(expectedReason);
    expect(fake.connectionCount()).toBe(0);
  });

  it('rejects a greeting-injecting user name before connecting', async () => {
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }));
    const ctx = makeCtx({
      currentWorldInfo: { name: 'planitia', url: '', ip: '127.0.0.1', port: fake.port },
      cachedUsername: 'evil\r\nWorld=x',
    });
    const result = await uploadTycoonPicture(ctx, VALID_JPEG.toString('base64'));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('INVALID_IDENTITY');
    expect(fake.connectionCount()).toBe(0);
  });

  it('returns NO_SESSION when currentWorldInfo is missing', async () => {
    const ctx = makeCtx({ currentWorldInfo: null });
    const result = await uploadTycoonPicture(ctx, VALID_JPEG.toString('base64'));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NO_SESSION');
  });

  it('returns NO_SESSION when cachedUsername is missing', async () => {
    const ctx = makeCtx({ cachedUsername: null });
    const result = await uploadTycoonPicture(ctx, VALID_JPEG.toString('base64'));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('NO_SESSION');
  });

  it('reaches the listener when the session is fully populated', async () => {
    // uploadTycoonPicture always dials the fixed picture-transfer port
    // (PicShopForm.pas:11) — the fake listener binds there too, since nothing
    // in SendPictureParams lets a production call redirect it.
    const fake = await registerServer(await fakePictureServer({ sendOnGreeting: 'SEND', sendOnComplete: 'OK' }, PICTURE_TRANSFER_PORT));
    const ctx = makeCtx({ currentWorldInfo: { name: 'planitia', url: '', ip: '127.0.0.1', port: 0 } });
    const result = await uploadTycoonPicture(ctx, VALID_JPEG.toString('base64'));
    expect(result.success).toBe(true);
    expect(fake.connectionCount()).toBe(1);
  });
});

describe('readJpegDimensions', () => {
  it('reads width and height from a valid frame', () => {
    expect(readJpegDimensions(VALID_JPEG)).toEqual({ width: 150, height: 200 });
  });

  it('returns null for a buffer that ends mid-segment', () => {
    const truncated = VALID_JPEG.subarray(0, 6);
    expect(readJpegDimensions(truncated)).toBeNull();
  });

  it('returns null when the only marker present is DHT', () => {
    const dhtOnly = Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x03, 0x00, 0xff, 0xd9]);
    expect(readJpegDimensions(dhtOnly)).toBeNull();
  });
});
