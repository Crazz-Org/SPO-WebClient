import * as http from 'http';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
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

/** Hosts the gateway learned from the directory / interface servers — the only hosts the game-server fetch may reach. */
export const proxyImageHosts = new Set<string>();

/** Register a host a trusted server named (world IP, DAAddr). Stored in the canonical `new URL().hostname` form. */
export function registerProxyImageHost(host: string | null | undefined): void {
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return;
  try {
    const canonical = new URL(`http://${host}`).hostname;
    if (canonical) proxyImageHosts.add(canonical);
  } catch {
    // not a host — ignore
  }
}

export interface ProxyImageDeps {
  imageFileIndex: Map<string, string>;
  cacheRoot: string;
  webclientCacheDir: string;
  updateServerCacheUrl: string;
  log: { debug(msg: string): void; warn(msg: string): void };
  /** Canonical hostnames the game-server fallback may fetch (see `proxyImageHosts`). */
  allowedHosts: ReadonlySet<string>;
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

/** Version tag on every game-server cache file name; files without it are never indexed. */
export const GAME_SERVER_CACHE_PREFIX = 'gs1-';

/**
 * How long a stored failure placeholder is trusted before the image is fetched again.
 */
export const STORED_PLACEHOLDER_TTL_MS = 60 * 60 * 1000;

/** Largest image body read from an upstream server (node-fetch `size`); larger ends in the placeholder. */
export const MAX_PROXY_IMAGE_BYTES = 2 * 1024 * 1024;

/** Most failed image fetches remembered in memory; the oldest is evicted first. */
export const MAX_FAILED_IMAGE_ENTRIES = 10_000;

/** Failed image fetches by cache name -> time of failure (ms). Memory only, never on disk. */
export const failedImageFetches = new Map<string, number>();

/** Remember a failed fetch, moving a repeat to the newest position and evicting the oldest past the bound. */
export function recordFailedImageFetch(key: string, now: number = Date.now()): void {
  failedImageFetches.delete(key);
  failedImageFetches.set(key, now);
  while (failedImageFetches.size > MAX_FAILED_IMAGE_ENTRIES) {
    const oldest = failedImageFetches.keys().next().value;
    if (oldest === undefined) break;
    failedImageFetches.delete(oldest);
  }
}

const GAME_SERVER_CACHE_NAME_RE = new RegExp(
  `^${GAME_SERVER_CACHE_PREFIX}[0-9a-f]{40}\\.(${ALLOWED_IMAGE_EXTENSIONS.map((e) => e.slice(1)).join('|')})$`,
);

/**
 * Cache file name for an image fetched from the game server, derived from the URL's full
 * (lower-cased) path so two images sharing a basename in different directories get two files.
 * Only called after `sanitizeImageFilename` succeeded for the same URL.
 */
export function gameServerCacheName(imageUrl: string, filename: string): string {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  const hash = createHash('sha256').update(pathname).digest('hex').slice(0, 40);
  return GAME_SERVER_CACHE_PREFIX + hash + path.extname(filename).toLowerCase();
}

/** Whether `name` has the current game-server cache file name shape. */
export function isGameServerCacheName(name: string): boolean {
  return GAME_SERVER_CACHE_NAME_RE.test(name);
}

/**
 * Build the image file index: update-server mirror files keyed by lowercase basename,
 * game-server files in `webclientCacheDir` keyed by their versioned cache name.
 */
export async function buildImageFileIndexEntries(
  cacheRoot: string,
  webclientCacheDir: string,
): Promise<Map<string, string>> {
  const newIndex = new Map<string, string>();

  // Index files in update server cache subdirectories
  try {
    const entries = await fsp.readdir(cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(cacheRoot, entry.name);
        const files = await fsp.readdir(dirPath);
        for (const file of files) {
          newIndex.set(file.toLowerCase(), path.join(dirPath, file));
        }
      }
    }
  } catch {
    // Cache root doesn't exist yet
  }

  // Index game-server files in webclient-cache (legacy basename files are skipped)
  try {
    const files = await fsp.readdir(webclientCacheDir);
    for (const file of files) {
      const key = file.toLowerCase();
      if (isGameServerCacheName(key) && !newIndex.has(key)) {
        const fullPath = path.join(webclientCacheDir, file);
        try {
          // A failure placeholder left on disk by an older build is not an image: skip it
          // One open handle for both the size check and the read, so they see the same file
          const placeholder = getPlaceholderImage();
          const handle = await fsp.open(fullPath, 'r');
          let isPlaceholder: boolean;
          try {
            const { size } = await handle.stat();
            isPlaceholder = size === placeholder.length && (await handle.readFile()).equals(placeholder);
          } finally {
            await handle.close();
          }
          if (isPlaceholder) {
            continue;
          }
          newIndex.set(key, fullPath);
        } catch {
          // Unreadable file: skip it, keep indexing the rest
        }
      }
    }
  } catch {
    // webclient-cache doesn't exist yet
  }

  return newIndex;
}

/**
 * Proxy image from remote server to avoid CORS/Referer blocking.
 * Uses in-memory file index for O(1) cache lookup instead of scanning directories.
 */
export async function proxyImage(imageUrl: string, res: http.ServerResponse, deps: ProxyImageDeps): Promise<void> {
  const { imageFileIndex, cacheRoot, webclientCacheDir, updateServerCacheUrl, log, allowedHosts } = deps;

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

  // Security: only hosts a trusted server named (world IP, DAAddr) — compared on the canonical
  // hostname the URL parser produces, so no alternate spelling of an internal address can match
  let hostname: string;
  try {
    hostname = new URL(imageUrl).hostname;
  } catch {
    res.writeHead(400);
    res.end('Invalid URL');
    return;
  }
  if (!allowedHosts.has(hostname)) {
    res.writeHead(403);
    res.end('Image host is not allowed');
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

  const cacheName = gameServerCacheName(imageUrl, filename);

  try {
    // O(1) lookup in pre-built file index: update-server mirror by basename first,
    // then the game-server cache by its path-derived name
    const basenameKey = filename.toLowerCase();
    const cacheKey = imageFileIndex.has(basenameKey) ? basenameKey : cacheName;
    const cachedPath = imageFileIndex.get(cacheKey);
    if (cachedPath) {
      const content = await fsp.readFile(cachedPath);
      if (!content.equals(getPlaceholderImage())) {
        res.writeHead(200, {
          'Content-Type': getImageContentType(cachedPath),
          'Cache-Control': 'public, max-age=31536000'
        });
        res.end(content);
        return;
      }
      // A stored failure placeholder: never cached by the browser, and re-fetched once stale
      const { mtimeMs } = await fsp.stat(cachedPath);
      if (Date.now() - mtimeMs < STORED_PLACEHOLDER_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(content);
        return;
      }
      imageFileIndex.delete(cacheKey);
    }

    // A recent failure remembered in memory: answer the placeholder without fetching again
    const failedAt = failedImageFetches.get(cacheName);
    if (failedAt !== undefined) {
      if (Date.now() - failedAt < STORED_PLACEHOLDER_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(getPlaceholderImage());
        return;
      }
      failedImageFetches.delete(cacheName);
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
        const response = await fetchWithTimeout(updateUrl, { redirect: 'manual', size: MAX_PROXY_IMAGE_BYTES }, TIMEOUTS.IMAGE_DOWNLOAD);
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

    // Not on update server, try game server (fallback). The host is allowlisted above and a
    // redirect is not followed: a 3xx is !ok and ends in the placeholder path below.
    const response = await fetchWithTimeout(imageUrl, { redirect: 'manual', size: MAX_PROXY_IMAGE_BYTES }, TIMEOUTS.IMAGE_DOWNLOAD);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Cache in webclient-cache (async)
    const webclientImagePath = resolveInside(webclientCacheDir, cacheName);
    if (webclientImagePath) {
      await fsp.writeFile(webclientImagePath, buffer);
      imageFileIndex.set(cacheName, webclientImagePath);
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

    // Remember the failure in memory only (bounded) to avoid repeated failed downloads
    recordFailedImageFetch(cacheName);
    const placeholder = getPlaceholderImage();

    // Return placeholder image instead of 404
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(placeholder);
  }
}
