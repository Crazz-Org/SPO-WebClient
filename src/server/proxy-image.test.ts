jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('dns', () => ({
  __esModule: true,
  promises: {
    lookup: jest.fn(),
  },
}));

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as dns from 'dns';
import * as zlib from 'zlib';
import type { ServerResponse } from 'http';
import fetch from 'node-fetch';
import {
  proxyImage,
  getImageContentType,
  getPlaceholderImage,
  sanitizeImageFilename,
  proxyImageHosts,
  registerProxyImageHost,
  gameServerCacheName,
  isGameServerCacheName,
  buildImageFileIndexEntries,
  GAME_SERVER_CACHE_PREFIX,
  STORED_PLACEHOLDER_TTL_MS,
  MAX_PROXY_IMAGE_BYTES,
  MAX_FAILED_IMAGE_ENTRIES,
  failedImageFetches,
  recordFailedImageFetch,
  type ProxyImageDeps,
} from './proxy-image';

const mockFetch = fetch as unknown as jest.Mock;
const mockLookup = dns.promises.lookup as unknown as jest.Mock;

function toArrayBuffer(text: string): ArrayBuffer {
  const buf = Buffer.from(text);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

interface FakeRes {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: Buffer | string;
  writeHead: (status: number, headers?: Record<string, string>) => FakeRes;
  end: (chunk?: Buffer | string) => FakeRes;
}

function fakeRes(): ServerResponse & FakeRes {
  const res: FakeRes = {
    writeHead: jest.fn((status: number, headers?: Record<string, string>) => {
      res.statusCode = status;
      res.headers = headers;
      return res;
    }),
    end: jest.fn((chunk?: Buffer | string) => {
      res.body = chunk;
      return res;
    }),
  };
  return res as unknown as ServerResponse & FakeRes;
}

describe('proxy-image', () => {
  let cacheRoot: string;
  let webclientCacheDir: string;
  let deps: ProxyImageDeps;

  beforeEach(() => {
    mockFetch.mockReset();
    failedImageFetches.clear();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-cache-'));
    webclientCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-webclient-'));
    deps = {
      imageFileIndex: new Map(),
      cacheRoot,
      webclientCacheDir,
      updateServerCacheUrl: 'https://update.example.test/cache',
      log: { debug: jest.fn(), warn: jest.fn() },
      allowedHosts: new Set(['example.test']),
    };
  });

  afterEach(() => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(webclientCacheDir, { recursive: true, force: true });
  });

  describe('getImageContentType', () => {
    it('maps known extensions', () => {
      expect(getImageContentType('a.png')).toBe('image/png');
      expect(getImageContentType('a.jpg')).toBe('image/jpeg');
      expect(getImageContentType('a.jpeg')).toBe('image/jpeg');
      expect(getImageContentType('a.gif')).toBe('image/gif');
      expect(getImageContentType('a.bmp')).toBe('application/octet-stream');
      expect(getImageContentType('a.unknown')).toBe('image/gif');
    });
  });

  it('getPlaceholderImage returns a non-empty buffer', () => {
    expect(getPlaceholderImage().length).toBeGreaterThan(0);
  });

  it('getPlaceholderImage decodes to a 1x1 RGBA PNG with alpha 0', () => {
    const buf = getPlaceholderImage();
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(buf.subarray(0, 8)).toEqual(signature);
    expect(buf.readUInt32BE(16)).toBe(1); // width
    expect(buf.readUInt32BE(20)).toBe(1); // height
    expect(buf[24]).toBe(8); // bit depth
    expect(buf[25]).toBe(6); // colour type 6 = RGBA

    let offset = 8;
    let idat: Buffer | null = null;
    while (offset < buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') {
        idat = buf.subarray(offset + 8, offset + 8 + length);
      }
      offset += 12 + length;
    }
    expect(idat).not.toBeNull();
    const raw = zlib.inflateSync(idat as Buffer);
    expect(raw.length).toBe(5); // filter byte + R + G + B + A
    expect(raw[0]).toBe(0); // filter type None
    expect(raw[4]).toBe(0); // alpha
  });

  it('serves a file:// URL inside the cache directory', async () => {
    const filePath = path.join(cacheRoot, 'foo.png');
    fs.writeFileSync(filePath, Buffer.from('hi'));
    const res = fakeRes();
    await proxyImage(`file://${filePath}`, res, deps);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(Buffer.from('hi'));
  });

  it('rejects a file:// URL outside the cache directory (traversal)', async () => {
    const outside = path.join(os.tmpdir(), 'outside.png');
    const res = fakeRes();
    await proxyImage(`file://${outside}`, res, deps);
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when the cached file:// path does not exist', async () => {
    const filePath = path.join(cacheRoot, 'missing.png');
    const res = fakeRes();
    await proxyImage(`file://${filePath}`, res, deps);
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-http scheme', async () => {
    const res = fakeRes();
    await proxyImage('ftp://example.test/a.png', res, deps);
    expect(res.statusCode).toBe(400);
  });

  it('blocks a request to an internal host', async () => {
    const res = fakeRes();
    await proxyImage('http://127.0.0.1/a.png', res, deps);
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for an unparseable URL', async () => {
    const res = fakeRes();
    await proxyImage('http://', res, deps);
    expect(res.statusCode).toBe(400);
  });

  it('serves from the index cache when present', async () => {
    const cachedPath = path.join(cacheRoot, 'cached.png');
    fs.writeFileSync(cachedPath, Buffer.from('cached'));
    deps.imageFileIndex.set('img.png', cachedPath);
    const res = fakeRes();
    await proxyImage('http://example.test/dir/img.png', res, deps);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(Buffer.from('cached'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('downloads from the update server, caches, and updates the index', async () => {
    const existingDir = path.join(cacheRoot, 'Buildings');
    fs.mkdirSync(existingDir, { recursive: true });
    const existingFile = path.join(existingDir, 'placeholder.png');
    fs.writeFileSync(existingFile, Buffer.from('x'));
    deps.imageFileIndex.set('placeholder.png', existingFile);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => toArrayBuffer('downloaded'),
    });

    const res = fakeRes();
    await proxyImage('http://example.test/dir/newimg.png', res, deps);

    expect(res.statusCode).toBe(200);
    expect(deps.imageFileIndex.get('newimg.png')).toBeDefined();
    const target = deps.imageFileIndex.get('newimg.png') as string;
    expect(fs.readFileSync(target)).toEqual(Buffer.from('downloaded'));
  });

  it('falls back to the game server when the update server has nothing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => toArrayBuffer('fromgame'),
    });

    const res = fakeRes();
    await proxyImage('http://example.test/dir/gameimg.png', res, deps);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(Buffer.from('fromgame'));
    expect(deps.imageFileIndex.get(gameServerCacheName('http://example.test/dir/gameimg.png', 'gameimg.png'))).toBeDefined();
  });

  it('returns 504 on a timeout and does not cache a placeholder or touch the index', async () => {
    const timeoutErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(timeoutErr);

    const res = fakeRes();
    await proxyImage('http://example.test/dir/slow.png', res, deps);

    expect(res.statusCode).toBe(504);
    expect(deps.imageFileIndex.get('slow.png')).toBeUndefined();
    const written = await fsp.readdir(webclientCacheDir);
    expect(written).not.toContain('slow.png');
  });

  it('returns a cached placeholder on a non-timeout failure', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));

    const res = fakeRes();
    await proxyImage('http://example.test/dir/broken.png', res, deps);

    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(res.body).toEqual(getPlaceholderImage());
    const brokenKey = gameServerCacheName('http://example.test/dir/broken.png', 'broken.png');
    expect(deps.imageFileIndex.has(brokenKey)).toBe(false);
    expect(await fsp.readdir(webclientCacheDir)).toHaveLength(0);
    expect(failedImageFetches.has(brokenKey)).toBe(true);
  });

  describe('failure memory and size cap', () => {
    function seedMirror(): string {
      const existingDir = path.join(cacheRoot, 'Buildings');
      fs.mkdirSync(existingDir, { recursive: true });
      const existingFile = path.join(existingDir, 'seed.png');
      fs.writeFileSync(existingFile, Buffer.from('x'));
      deps.imageFileIndex.set('seed.png', existingFile);
      return existingDir;
    }
    const maxSizeError = (): Error =>
      Object.assign(new Error('content size over limit'), { type: 'max-size', name: 'FetchError' });

    it('N failed fetches of N distinct URLs create zero files', async () => {
      mockFetch.mockRejectedValue(new Error('404'));
      for (let i = 0; i < 5; i++) {
        const res = fakeRes();
        await proxyImage(`http://example.test/r/n${i}.png`, res, deps);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(getPlaceholderImage());
      }
      expect(await fsp.readdir(webclientCacheDir)).toHaveLength(0);
      expect(deps.imageFileIndex.size).toBe(0);
      expect(failedImageFetches.size).toBe(5);
    });

    it('bounds the failure map and evicts the oldest entry first', () => {
      for (let i = 0; i <= MAX_FAILED_IMAGE_ENTRIES; i++) recordFailedImageFetch('k' + i, i);
      expect(failedImageFetches.size).toBe(MAX_FAILED_IMAGE_ENTRIES);
      expect(failedImageFetches.has('k0')).toBe(false);
      expect(failedImageFetches.has('k1')).toBe(true);
      expect(failedImageFetches.has('k' + MAX_FAILED_IMAGE_ENTRIES)).toBe(true);
      recordFailedImageFetch('k1', 1);
      recordFailedImageFetch('extra', 1);
      expect(failedImageFetches.size).toBe(MAX_FAILED_IMAGE_ENTRIES);
      expect(failedImageFetches.has('k1')).toBe(true);
      expect(failedImageFetches.has('k2')).toBe(false);
    });

    it('does not fetch a failed URL again within the TTL', async () => {
      mockFetch.mockRejectedValueOnce(new Error('404'));
      const url = 'http://example.test/r/again.png';
      await proxyImage(url, fakeRes(), deps);
      const res = fakeRes();
      await proxyImage(url, res, deps);
      expect(res.statusCode).toBe(200);
      expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
      expect(res.body).toEqual(getPlaceholderImage());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetches a failed URL again after the TTL', async () => {
      const url = 'http://example.test/r/later.png';
      const key = gameServerCacheName(url, 'later.png');
      recordFailedImageFetch(key, Date.now() - STORED_PLACEHOLDER_TTL_MS - 1000);
      mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => toArrayBuffer('fresh') });
      const res = fakeRes();
      await proxyImage(url, res, deps);
      expect(res.body).toEqual(Buffer.from('fresh'));
      expect(mockFetch).toHaveBeenCalledWith(url, expect.anything());
      expect(failedImageFetches.has(key)).toBe(false);
    });

    it('passes the size cap to both fetches', async () => {
      seedMirror();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => toArrayBuffer('g') });
      const url = 'http://example.test/r/capped.png';
      await proxyImage(url, fakeRes(), deps);
      const init = expect.objectContaining({ redirect: 'manual', size: MAX_PROXY_IMAGE_BYTES });
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('update.example.test'), init);
      expect(mockFetch).toHaveBeenCalledWith(url, init);
      expect(MAX_PROXY_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    });

    it('answers the placeholder on a max-size rejection from the game server, writing nothing', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.reject(maxSizeError()) });
      const url = 'http://example.test/r/huge.png';
      const res = fakeRes();
      await proxyImage(url, res, deps);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(getPlaceholderImage());
      expect(await fsp.readdir(webclientCacheDir)).toHaveLength(0);
      expect(deps.imageFileIndex.has(gameServerCacheName(url, 'huge.png'))).toBe(false);
    });

    it('answers the placeholder on a max-size rejection from the update server, writing nothing', async () => {
      const dir = seedMirror();
      mockFetch
        .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.reject(maxSizeError()) })
        .mockRejectedValueOnce(new Error('404'));
      const res = fakeRes();
      await proxyImage('http://example.test/r/hugeupd.png', res, deps);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(getPlaceholderImage());
      expect(await fsp.readdir(dir)).toEqual(['seed.png']);
      expect(await fsp.readdir(webclientCacheDir)).toHaveLength(0);
      expect([...deps.imageFileIndex.keys()]).toEqual(['seed.png']);
    });
  });

  describe('game-server cache keys', () => {
    const alphaUrl = 'http://example.test/fivedata/userinfo/planitia/Alpha/largephoto.jpg';
    const betaUrl = 'http://example.test/fivedata/userinfo/planitia/Beta/largephoto.jpg';

    function okFetch(text: string): { ok: true; arrayBuffer: () => Promise<ArrayBuffer> } {
      return { ok: true, arrayBuffer: async () => toArrayBuffer(text) };
    }

    function storePlaceholder(url: string): string {
      const cacheName = gameServerCacheName(url, 'largephoto.jpg');
      const filePath = path.join(webclientCacheDir, cacheName);
      fs.writeFileSync(filePath, getPlaceholderImage());
      deps.imageFileIndex.set(cacheName, filePath);
      return filePath;
    }

    it('derives distinct, versioned names from the full path', () => {
      const alpha = gameServerCacheName(alphaUrl, 'largephoto.jpg');
      const beta = gameServerCacheName(betaUrl, 'largephoto.jpg');
      expect(alpha).not.toBe(beta);
      expect(isGameServerCacheName(alpha)).toBe(true);
      expect(isGameServerCacheName(beta)).toBe(true);
      expect(alpha.endsWith('.jpg')).toBe(true);
      expect(beta.endsWith('.jpg')).toBe(true);
      expect(alpha.startsWith(GAME_SERVER_CACHE_PREFIX)).toBe(true);
      expect(gameServerCacheName(alphaUrl.replace('Alpha', 'ALPHA'), 'largephoto.jpg')).toBe(alpha);
      expect(isGameServerCacheName('largephoto.jpg')).toBe(false);
    });

    it('stores two URLs differing only by directory as two cache files', async () => {
      mockFetch.mockResolvedValueOnce(okFetch('alpha')).mockResolvedValueOnce(okFetch('beta'));

      const resA = fakeRes();
      await proxyImage(alphaUrl, resA, deps);
      const resB = fakeRes();
      await proxyImage(betaUrl, resB, deps);
      expect(resA.body).toEqual(Buffer.from('alpha'));
      expect(resB.body).toEqual(Buffer.from('beta'));

      const files = await fsp.readdir(webclientCacheDir);
      expect(files).toHaveLength(2);
      expect(files).not.toContain('largephoto.jpg');

      const resA2 = fakeRes();
      await proxyImage(alphaUrl, resA2, deps);
      expect(resA2.body).toEqual(Buffer.from('alpha'));
      expect(resA2.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not serve a placeholder written under the legacy basename by an older build', async () => {
      fs.writeFileSync(path.join(webclientCacheDir, 'largephoto.jpg'), getPlaceholderImage());
      deps.imageFileIndex = await buildImageFileIndexEntries(cacheRoot, webclientCacheDir);
      expect(deps.imageFileIndex.has('largephoto.jpg')).toBe(false);

      mockFetch.mockResolvedValueOnce(okFetch('alpha'));
      const res = fakeRes();
      await proxyImage(alphaUrl, res, deps);
      expect(mockFetch).toHaveBeenCalled();
      expect(res.body).toEqual(Buffer.from('alpha'));
    });

    it('serves a fresh stored placeholder without a long-lived cache header', async () => {
      storePlaceholder(alphaUrl);
      const res = fakeRes();
      await proxyImage(alphaUrl, res, deps);
      expect(res.statusCode).toBe(200);
      expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
      expect(res.body).toEqual(getPlaceholderImage());
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('re-fetches the image once a stored placeholder is past its TTL', async () => {
      const filePath = storePlaceholder(alphaUrl);
      const stale = (Date.now() - STORED_PLACEHOLDER_TTL_MS - 60_000) / 1000;
      fs.utimesSync(filePath, stale, stale);

      mockFetch.mockResolvedValueOnce(okFetch('fresh'));
      const res = fakeRes();
      await proxyImage(alphaUrl, res, deps);
      expect(res.body).toEqual(Buffer.from('fresh'));
      expect(mockFetch.mock.calls.some((call: unknown[]) => call[0] === alphaUrl)).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(Buffer.from('fresh'));
    });
  });

  describe('buildImageFileIndexEntries', () => {
    it('keeps basename keys for the update-server mirror so /cache still resolves', async () => {
      const buildingDir = path.join(cacheRoot, 'BuildingImages');
      fs.mkdirSync(buildingDir);
      const realPath = path.join(buildingDir, 'MapPGILoResF64x32x0.gif');
      fs.writeFileSync(realPath, Buffer.from('gif'));
      fs.writeFileSync(path.join(cacheRoot, 'loose.txt'), 'x');
      const gsName = gameServerCacheName('http://example.test/a/b.png', 'b.png');
      fs.writeFileSync(path.join(webclientCacheDir, gsName), 'png');
      fs.writeFileSync(path.join(webclientCacheDir, 'largephoto.jpg'), 'jpg');

      const index = await buildImageFileIndexEntries(cacheRoot, webclientCacheDir);

      // Same lookup as the /cache route in server.ts
      const relativePath = 'BuildingImages/MAPPGILORESF64X32X0.GIF';
      const lastSlash = relativePath.lastIndexOf('/');
      const filename = lastSlash >= 0 ? relativePath.substring(lastSlash + 1) : relativePath;
      expect(index.get(filename.toLowerCase())).toBe(realPath);
      expect(index.get(gsName)).toBe(path.join(webclientCacheDir, gsName));
      expect(index.has('largephoto.jpg')).toBe(false);
      expect(index.has('loose.txt')).toBe(false);
    });

    it('does not index an on-disk placeholder file', async () => {
      const ph = getPlaceholderImage();
      const phName = gameServerCacheName('http://example.test/a/ph.png', 'ph.png');
      const realName = gameServerCacheName('http://example.test/a/real.png', 'real.png');
      const sameLenName = gameServerCacheName('http://example.test/a/same.png', 'same.png');
      fs.writeFileSync(path.join(webclientCacheDir, phName), ph);
      fs.writeFileSync(path.join(webclientCacheDir, realName), 'realimage');
      const sameLen = Buffer.from(ph);
      sameLen[sameLen.length - 1] ^= 0xff;
      fs.writeFileSync(path.join(webclientCacheDir, sameLenName), sameLen);

      const index = await buildImageFileIndexEntries(cacheRoot, webclientCacheDir);
      expect(index.has(phName)).toBe(false);
      expect(index.get(realName)).toBe(path.join(webclientCacheDir, realName));
      expect(index.get(sameLenName)).toBe(path.join(webclientCacheDir, sameLenName));
    });

    it('skips an unreadable game-server entry and keeps indexing the rest', async () => {
      const dirName = gameServerCacheName('http://example.test/a/d.png', 'd.png');
      const realName = gameServerCacheName('http://example.test/a/r.png', 'r.png');
      fs.writeFileSync(path.join(webclientCacheDir, realName), 'img');
      fs.symlinkSync(path.join(webclientCacheDir, 'nowhere'), path.join(webclientCacheDir, dirName));
      const index = await buildImageFileIndexEntries(cacheRoot, webclientCacheDir);
      expect(index.has(dirName)).toBe(false);
      expect(index.has(realName)).toBe(true);
    });

    it('returns an empty map when neither directory exists', async () => {
      const index = await buildImageFileIndexEntries(
        path.join(cacheRoot, 'missing-root'),
        path.join(webclientCacheDir, 'missing-webclient'),
      );
      expect(index.size).toBe(0);
    });
  });

  describe('sanitizeImageFilename', () => {
    it('accepts plain filenames', () => {
      expect(sanitizeImageFilename('http://example.test/dir/roof.gif')).toBe('roof.gif');
      expect(sanitizeImageFilename('http://example.test/dir/Building_2x2.png')).toBe('Building_2x2.png');
    });

    it('rejects encoded traversal sequences', () => {
      expect(sanitizeImageFilename('http://example.test/%2e%2e%2fx.gif')).toBeNull();
      expect(sanitizeImageFilename('http://example.test/..%2f..%2fevil.png')).toBeNull();
    });

    it('rejects names containing separators after decoding', () => {
      expect(sanitizeImageFilename('http://example.test/a%2fb.png')).toBeNull();
      expect(sanitizeImageFilename('http://example.test/a%5cb.png')).toBeNull();
    });

    it('rejects hidden files, disallowed extensions and empty names', () => {
      expect(sanitizeImageFilename('http://example.test/.hidden.png')).toBeNull();
      expect(sanitizeImageFilename('http://example.test/x.exe')).toBeNull();
      expect(sanitizeImageFilename('http://example.test/')).toBeNull();
    });

    it('rejects malformed percent escapes', () => {
      expect(sanitizeImageFilename('http://example.test/%E0%A4%A')).toBeNull();
    });
  });

  it('rejects a path-traversal filename and never writes outside the cache directories', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => toArrayBuffer('evil'),
    });

    const res = fakeRes();
    await proxyImage('http://example.test/%2e%2e%2f%2e%2e%2fetc%2fpasswd', res, deps);

    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(deps.imageFileIndex.size).toBe(0);
    expect(await fsp.readdir(cacheRoot)).toEqual([]);
    expect(await fsp.readdir(webclientCacheDir)).toEqual([]);

    const res2 = fakeRes();
    await proxyImage('http://example.test/..%2f..%2fevil.png', res2, deps);
    expect(res2.statusCode).toBe(200);
    expect(res2.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(deps.imageFileIndex.size).toBe(0);
    expect(await fsp.readdir(cacheRoot)).toEqual([]);
    expect(await fsp.readdir(webclientCacheDir)).toEqual([]);
  });

  it('rejects an unregistered name without resolving it', async () => {
    const res = fakeRes();
    await proxyImage('http://internal.example.test/dir/blocked.png', res, deps);

    expect(res.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
    expect(await fsp.readdir(webclientCacheDir)).toEqual([]);
  });

  describe('host allowlist (SSRF)', () => {
    it.each([
      'http://[::ffff:7f00:1]/a.png',
      'http://[::ffff:127.0.0.1]/a.png',
      'http://[::ffff:a9fe:a9fe]/a.png',
      'http://[0:0:0:0:0:ffff:7f00:1]/a.png',
      'http://[::7f00:1]/a.png',
      'http://[::1]/a.png',
      'http://[::]/a.png',
      'http://0.0.0.0/a.png',
      'http://2130706433/a.png',
      'http://0x7f.1/a.png',
      'http://[fc00::1]/a.png',
      'http://[fe80::1]/a.png',
      'http://localhost./a.png',
    ])('answers 403 for %s without fetching or resolving', async (url) => {
      const res = fakeRes();
      await proxyImage(url, res, deps);
      expect(res.statusCode).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects a public but unregistered host', async () => {
      const res = fakeRes();
      await proxyImage('http://93.184.216.34/a.png', res, deps);
      expect(res.statusCode).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches a registered world IP and returns its body without any DNS lookup', async () => {
      deps.allowedHosts = new Set(['158.69.153.134']);
      mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => toArrayBuffer('worldimg') });
      const url = 'http://158.69.153.134/five/0/visual/x.png';
      const res = fakeRes();
      await proxyImage(url, res, deps);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(Buffer.from('worldimg'));
      expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }));
      expect(mockLookup).toHaveBeenCalledTimes(0);
    });

    it('does not follow a redirect from a registered host and writes nothing to disk', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: { get: () => 'http://169.254.169.254/latest/meta-data/iam.png' },
        arrayBuffer: async () => toArrayBuffer('SECRET'),
      });
      const url = 'http://example.test/dir/redirected.png';
      const res = fakeRes();
      await proxyImage(url, res, deps);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }));
      expect(res.body).toEqual(getPlaceholderImage());
      const files = await fsp.readdir(webclientCacheDir);
      expect(files).toHaveLength(0);
    });

    it('asks the update server not to follow redirects either', async () => {
      const existingDir = path.join(cacheRoot, 'Buildings');
      fs.mkdirSync(existingDir, { recursive: true });
      const existingFile = path.join(existingDir, 'placeholder.png');
      fs.writeFileSync(existingFile, Buffer.from('x'));
      deps.imageFileIndex.set('placeholder.png', existingFile);
      mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => toArrayBuffer('upd') });

      const res = fakeRes();
      await proxyImage('http://example.test/dir/updimg.png', res, deps);
      expect(res.body).toEqual(Buffer.from('upd'));
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('update.example.test'),
        expect.objectContaining({ redirect: 'manual' }),
      );
    });
  });

  describe('registerProxyImageHost', () => {
    const added: string[] = [];
    afterEach(() => {
      for (const host of added.splice(0)) proxyImageHosts.delete(host);
    });

    it('stores the canonical hostname, dropping the port and lower-casing a name', () => {
      registerProxyImageHost('Planitia.Example:8000');
      registerProxyImageHost('158.69.153.134');
      added.push('planitia.example', '158.69.153.134');
      expect(proxyImageHosts.has('planitia.example')).toBe(true);
      expect(proxyImageHosts.has('158.69.153.134')).toBe(true);
    });

    it.each([null, undefined, '', 'a b', 'x/y', 'u@127.0.0.1', '[::1'])('ignores %p', (host) => {
      const before = new Set(proxyImageHosts);
      registerProxyImageHost(host);
      expect(proxyImageHosts).toEqual(before);
    });
  });
});
