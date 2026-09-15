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
  isPrivateAddress,
  resolvesToPublicAddress,
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
    expect(deps.imageFileIndex.get('gameimg.png')).toBeDefined();
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
    expect(deps.imageFileIndex.get('broken.png')).toBeDefined();
    const target = deps.imageFileIndex.get('broken.png') as string;
    expect(fs.existsSync(target)).toBe(true);
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

  describe('isPrivateAddress', () => {
    it('flags private and loopback IPv4 addresses', () => {
      expect(isPrivateAddress('10.0.0.1')).toBe(true);
      expect(isPrivateAddress('127.0.0.1')).toBe(true);
      expect(isPrivateAddress('192.168.1.1')).toBe(true);
      expect(isPrivateAddress('169.254.1.1')).toBe(true);
      expect(isPrivateAddress('172.16.0.1')).toBe(true);
      expect(isPrivateAddress('255.255.255.255')).toBe(true);
    });

    it('flags private and loopback IPv6 addresses, including mapped v4', () => {
      expect(isPrivateAddress('::1')).toBe(true);
      expect(isPrivateAddress('fe80::1')).toBe(true);
      expect(isPrivateAddress('fc00::1')).toBe(true);
      expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    });

    it('accepts public addresses', () => {
      expect(isPrivateAddress('93.184.216.34')).toBe(false);
      expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    });
  });

  describe('resolvesToPublicAddress', () => {
    it('accepts a public IP literal without a DNS lookup', async () => {
      expect(await resolvesToPublicAddress('93.184.216.34')).toBe(true);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects a private IP literal without a DNS lookup', async () => {
      expect(await resolvesToPublicAddress('127.0.0.1')).toBe(false);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('resolves a hostname and accepts it when every address is public', async () => {
      mockLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
      expect(await resolvesToPublicAddress('example.test')).toBe(true);
    });

    it('rejects a hostname resolving to a private address', async () => {
      mockLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      expect(await resolvesToPublicAddress('evil.test')).toBe(false);
    });

    it('rejects a hostname whose lookup throws or returns nothing', async () => {
      mockLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
      expect(await resolvesToPublicAddress('nowhere.test')).toBe(false);
      mockLookup.mockResolvedValueOnce([]);
      expect(await resolvesToPublicAddress('empty.test')).toBe(false);
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

  it('does not call the fallback fetch when the hostname resolves to a private address', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const res = fakeRes();
    await proxyImage('http://internal.example.test/dir/blocked.png', res, deps);

    expect(mockFetch).not.toHaveBeenCalledWith('http://internal.example.test/dir/blocked.png', {}, expect.anything());
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(deps.imageFileIndex.get('blocked.png')).toBeUndefined();
  });
});
