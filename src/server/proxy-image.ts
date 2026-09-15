import * as http from 'http';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as net from 'net';
import * as dns from 'dns';
import { toErrorMessage } from '../shared/error-utils';
import { TIMEOUTS } from '../shared/constants';
import { fetchWithTimeout, FetchTimeoutError } from './fetch-with-timeout';

const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp'];

/**
 * Derive a safe filename from a caller-supplied image URL: strips query/hash via URL parsing,
 * decodes percent-escapes, then enforces path.basename() plus an allow-list of characters and
 * extensions so no traversal or separator sequence survives.
 */
export function sanitizeImageFilename(imageUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(imageUrl).pathname;
  } catch {
    return null;
  }

  // Split on the *real* (still-encoded) slashes first, so a legitimate multi-segment
  // path decodes segment-by-segment while an encoded separator hidden inside a single
  // raw segment (e.g. `a%2fb.png`) is caught below instead of silently splitting it.
  const rawSegments = pathname.split('/');
  const rawLast = rawSegments[rawSegments.length - 1] || '';

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawLast);
  } catch {
    return null;
  }

  if (!decoded || decoded === '.' || decoded === '..') return null;
  if (decoded.includes('..') || decoded.includes('/') || decoded.includes('\\')) return null;
  if (decoded.startsWith('.')) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(decoded)) return null;
  const ext = path.extname(decoded).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) return null;

  return path.basename(decoded);
}

/**
 * Resolve `name` under `root`, returning null if the resolved path would escape it —
 * the containment check CodeQL recognizes ahead of a filesystem write.
 */
function resolveInside(root: string, name: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, name);
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolvedPath;
}

/**
 * Whether `ip` (already known to be a valid IP literal) is a private/link-local/loopback
 * address, IPv4 or IPv6, including IPv4-mapped IPv6.
 */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (ip === '255.255.255.255') return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    if (/^f[cd]/.test(lower)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/**
 * DNS-resolution-based SSRF guard: resolves `hostname` and confirms every returned address is
 * public, rather than trusting a hostname string deny-list.
 */
export async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  const literal = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(literal)) {
    return !isPrivateAddress(literal);
  }
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length) return false;
    return addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

export interface ProxyImageDeps {
  imageFileIndex: Map<string, string>;
  cacheRoot: string;
  webclientCacheDir: string;
  updateServerCacheUrl: string;
  log: { debug(msg: string): void; warn(msg: string): void };
}

/**
 * Generate a placeholder image (1x1 transparent PNG)
 */
export function getPlaceholderImage(): Buffer {
  // 1x1 transparent PNG (base64 encoded) -- RGBA pixel [0, 0, 0, 0], alpha 0
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
  return Buffer.from(base64, 'base64');
}

export function getImageContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.bmp': return 'application/octet-stream';
    default: return 'image/gif';
  }
}

/**
 * Proxy image from remote server to avoid CORS/Referer blocking.
 * Uses in-memory file index for O(1) cache lookup instead of scanning directories.
 */
export async function proxyImage(imageUrl: string, res: http.ServerResponse, deps: ProxyImageDeps): Promise<void> {
  const { imageFileIndex, cacheRoot, webclientCacheDir, updateServerCacheUrl, log } = deps;

  // Handle file:// URLs — serve local files only from within the cache directory
  if (imageUrl.startsWith('file://')) {
    const filePath = path.normalize(decodeURIComponent(imageUrl.replace('file://', '')));
    const normalizedCache = path.normalize(cacheRoot);
    if (!filePath.startsWith(normalizedCache)) {
      res.writeHead(403);
      res.end('Access denied: file outside cache directory');
      return;
    }
    try {
      const content = await fsp.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': getImageContentType(filePath),
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('File not found');
    }
    return;
  }

  // Security: reject non-HTTP schemes (SSRF prevention)
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    res.writeHead(400);
    res.end('Only http:// and https:// URLs are allowed');
    return;
  }

  // Security: block requests to private/internal IP ranges
  try {
    const urlObj = new URL(imageUrl);
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]' ||
        hostname === '0.0.0.0' ||
        hostname === '255.255.255.255' ||
        hostname.startsWith('0.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^fe80[:%]/i.test(hostname) ||
        /^\[fe80[:%]/i.test(hostname) ||
        /^fc/i.test(hostname) || /^\[fc/i.test(hostname) ||
        /^fd/i.test(hostname) || /^\[fd/i.test(hostname)) {
      res.writeHead(403);
      res.end('Access to internal addresses is not allowed');
      return;
    }
  } catch {
    res.writeHead(400);
    res.end('Invalid URL');
    return;
  }

  // Extract and sanitize filename from URL — no safe name means no cache write is possible
  const filename = sanitizeImageFilename(imageUrl);
  if (!filename) {
    const placeholder = getPlaceholderImage();
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(placeholder);
    return;
  }

  try {
    // O(1) lookup in pre-built file index (replaces readdirSync scans)
    const cachedPath = imageFileIndex.get(filename.toLowerCase());
    if (cachedPath) {
      const content = await fsp.readFile(cachedPath);
      res.writeHead(200, {
        'Content-Type': getImageContentType(cachedPath),
        'Cache-Control': 'public, max-age=31536000'
      });
      res.end(content);
      return;
    }

    // Not in index — try downloading from update server
    const imageDirs: string[] = [];
    for (const [, filePath] of imageFileIndex) {
      const dir = path.basename(path.dirname(filePath));
      if (!imageDirs.includes(dir) && path.dirname(path.dirname(filePath)) === cacheRoot) {
        imageDirs.push(dir);
      }
    }

    let downloaded = false;
    for (const dir of imageDirs) {
      try {
        const updateUrl = `${updateServerCacheUrl}/${dir}/${filename}`;
        const response = await fetchWithTimeout(updateUrl, {}, TIMEOUTS.IMAGE_DOWNLOAD);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Cache in proper directory structure (async)
          const targetDir = path.join(cacheRoot, dir);
          await fsp.mkdir(targetDir, { recursive: true });
          const targetPath = resolveInside(targetDir, filename);
          if (targetPath) {
            await fsp.writeFile(targetPath, buffer);
            imageFileIndex.set(filename.toLowerCase(), targetPath);
          }

          res.writeHead(200, {
            'Content-Type': getImageContentType(filename),
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end(buffer);
          downloaded = true;
          log.debug(`Downloaded from update server: ${dir}/${filename}`);
          break;
        }
      } catch {
        // Continue to next directory
      }
    }

    if (downloaded) return;

    // Not on update server, try game server (fallback) — guard against SSRF via DNS resolution
    const fallbackHostname = new URL(imageUrl).hostname;
    if (!(await resolvesToPublicAddress(fallbackHostname))) {
      const placeholder = getPlaceholderImage();
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(placeholder);
      return;
    }

    const response = await fetchWithTimeout(imageUrl, {}, TIMEOUTS.IMAGE_DOWNLOAD);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Cache in webclient-cache (async)
    const webclientImagePath = resolveInside(webclientCacheDir, filename);
    if (webclientImagePath) {
      await fsp.writeFile(webclientImagePath, buffer);
      imageFileIndex.set(filename.toLowerCase(), webclientImagePath);
    }
    log.debug(`Downloaded from game server: ${filename}`);

    res.writeHead(200, {
      'Content-Type': getImageContentType(filename),
      'Cache-Control': 'public, max-age=31536000'
    });
    res.end(buffer);
  } catch (error: unknown) {
    if (error instanceof FetchTimeoutError) {
      log.warn(`Image upstream timed out for ${filename}: ${error.message}`);
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Upstream image server timed out');
      return;
    }

    log.warn(`Failed to fetch image ${filename}: ${toErrorMessage(error)}`);

    // Cache the placeholder to avoid repeated failed downloads
    const placeholder = getPlaceholderImage();
    const webclientImagePath = resolveInside(webclientCacheDir, filename);
    if (webclientImagePath) {
      await fsp.writeFile(webclientImagePath, placeholder).catch(() => {});
      imageFileIndex.set(filename.toLowerCase(), webclientImagePath);
    }

    // Return placeholder image instead of 404
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(placeholder);
  }
}
