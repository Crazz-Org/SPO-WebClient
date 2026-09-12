import * as http from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { StarpeaceSession } from './spo_session';
import { config } from '../shared/config';
import { createLogger, getFileTransport, getErrorFileTransport, LogLevel } from '../shared/logger';
import { UPDATE_SERVER } from '../shared/constants';
import { fileToProxyUrl, PROXY_IMAGE_ENDPOINT } from '../shared/proxy-utils';
import * as ErrorCodes from '../shared/error-codes';
import { FacilityDimensionsCache } from './facility-dimensions-cache';
import { SearchMenuService } from './search-menu-service';
import { UpdateService } from './update-service';
import { MapDataService } from './map-data-service';
import { serviceRegistry, setupGracefulShutdown } from './service-registry';
import { CacheWatcher } from './cache-watcher';
import {
  WsMessageType,
  SessionPhase,
  type WsMessage,
  type WorldInfo,
  type WsReqLoginWorld,
  type WsReqSelectCompany,
  type WsReqSwitchCompany,
  type WsRespError,
  type WsRespCapitolCoords,
} from '../shared/types';
import { toErrorMessage } from '../shared/error-utils';
import { wsHandlerRegistry } from './ws-handlers';
import { buildErrorContractReadout, buildPropertyFallbackReadout } from './session/diagnostics-readouts';
import { parseResearchDat, buildInventionIndex, type DatInventionIndex } from '../shared/research-dat-parser';
import { getPublicDir, getCacheDir, getWebclientCacheDir } from './paths';
import { buildRuntimeConfigScript } from './runtime-config';
import { handleBugReportRequest, DEFAULT_QUEUE_DIR } from './bug-report-endpoint';
import { handleReportPullList, handleReportPullFetch, handleReportPullAck } from './report-pull-endpoint';
import { enforceProductionConfig } from './production-config';
import { proxyImage, type ProxyImageDeps } from './proxy-image';
import { fetchWithTimeout } from './fetch-with-timeout';

/**
 * Starpeace Gateway Server
 * ------------------------
 * 1. Serves static UI files (index.html, client.js).
 * 2. Manages WebSocket connections.
 * 3. Maps 1 WebSocket <-> 1 StarpeaceSession.
 */

const logger = createLogger('Gateway');
let PORT = config.server.port;
let HOST = config.server.host;
let SINGLE_USER_MODE = config.server.singleUserMode;

/** Message types allowed at each session phase. null = all allowed. */
const PHASE_ALLOWED_MESSAGES: Record<SessionPhase, ReadonlySet<string> | null> = {
  [SessionPhase.DISCONNECTED]: new Set([
    WsMessageType.REQ_AUTH_CHECK,
    WsMessageType.REQ_CONNECT_DIRECTORY,
  ]),
  [SessionPhase.DIRECTORY_CONNECTED]: new Set([
    WsMessageType.REQ_AUTH_CHECK,
    WsMessageType.REQ_CONNECT_DIRECTORY,
    WsMessageType.REQ_LOGIN_WORLD,
    WsMessageType.REQ_SELECT_COMPANY,
  ]),
  [SessionPhase.WORLD_CONNECTING]: new Set([
    WsMessageType.REQ_SELECT_COMPANY,
    WsMessageType.REQ_SWITCH_COMPANY,
    WsMessageType.REQ_CREATE_COMPANY,
    WsMessageType.REQ_CLUSTER_INFO,
    WsMessageType.REQ_CLUSTER_FACILITIES,
  ]),
  [SessionPhase.WORLD_CONNECTED]: null,
  [SessionPhase.RECONNECTING]: null, // During reconnect, allow all (requests will be buffered/retried)
};

/** Message types suppressed from WS>> / WS<< info logs (too noisy, not useful for debugging). */
const QUIET_WS_TYPES: ReadonlySet<string> = new Set([
  WsMessageType.REQ_MAP_LOAD,
]);

/** Cache sync mode: 'inline' = UpdateService runs in-process (dev/single-user), 'external' = separate container */
const CACHE_SYNC_MODE = process.env.CACHE_SYNC_MODE || 'inline';
if (CACHE_SYNC_MODE !== 'inline' && CACHE_SYNC_MODE !== 'external') {
  throw new Error(`Invalid CACHE_SYNC_MODE="${CACHE_SYNC_MODE}". Must be "inline" or "external".`);
}

const PUBLIC_DIR = getPublicDir();
const CACHE_DIR = getCacheDir();

// Vite manifest: maps source entries to hashed output filenames for cache-busting.
// Loaded once at startup; rebuilt on each `npm run build`.
interface ViteManifestEntry { file: string; css?: string[]; src?: string }
let viteManifest: Record<string, ViteManifestEntry> = {};

function loadViteManifest(): void {
  const manifestPath = path.join(PUBLIC_DIR, '.vite', 'manifest.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    viteManifest = JSON.parse(raw) as Record<string, ViteManifestEntry>;
    logger.info(`Loaded Vite manifest (${Object.keys(viteManifest).length} entries)`);
  } catch {
    logger.warn('Vite manifest not found — falling back to app.js/app.css (run npm run build)');
    viteManifest = {};
  }
}

/** Returns the hashed asset paths from the Vite manifest, or fallbacks. */
function getHashedAssets(): { jsPath: string; cssPaths: string[] } {
  const entry = viteManifest['src/client/main.tsx'];
  if (entry) {
    return {
      jsPath: entry.file,
      cssPaths: entry.css ?? [],
    };
  }
  return { jsPath: 'app.js', cssPaths: ['app.css'] };
}

// Convenience getters for type-safe access to services (registered in startGateway/registerServices)
const facilityDimensionsCache = () => serviceRegistry.get<FacilityDimensionsCache>('facilities');
const mapDataService = () => serviceRegistry.get<MapDataService>('mapData');

// Dynamic image cache directory (for facility images fetched from game server)
const WEBCLIENT_CACHE_DIR = getWebclientCacheDir();
if (!fs.existsSync(WEBCLIENT_CACHE_DIR)) {
  fs.mkdirSync(WEBCLIENT_CACHE_DIR, { recursive: true });
}

// =============================================================================
// Service Registration (called after paths are resolved)
// =============================================================================
// Services capture their cache directory at construction time, so they MUST be
// created from startGateway() once the runtime overrides have been applied.
// Moving this to module level would cause services to capture stale paths.

function registerServices(): void {
  if (CACHE_SYNC_MODE === 'inline') {
    // Dev/single-user: UpdateService runs in-process (existing behavior)
    serviceRegistry.register('update', new UpdateService(), {
      progressWeight: 50,
      progressMessage: 'Downloading game assets...',
    });
  }

  serviceRegistry.register('facilities', new FacilityDimensionsCache(), {
    dependsOn: CACHE_SYNC_MODE === 'inline' ? ['update'] : [],
    progressWeight: 10,
    progressMessage: 'Loading building catalog...',
  });

  serviceRegistry.register('mapData', new MapDataService(), {
    dependsOn: CACHE_SYNC_MODE === 'inline' ? ['update'] : [],
    progressWeight: 5,
    progressMessage: 'Indexing map data...',
  });
}

// =============================================================================
// In-memory file index for proxy-image (avoids readdirSync on every request)
// =============================================================================
// Maps lowercase filename → full path on disk
const imageFileIndex = new Map<string, string>();

/**
 * Build in-memory index of all image files in cache directories.
 * Called once at startup and after downloading new files.
 */
async function buildImageFileIndex(): Promise<void> {
  // Build into a temporary map, then swap atomically to avoid serving 404s during rebuild
  const newIndex = new Map<string, string>();
  const CACHE_ROOT = getCacheDir();

  // Index files in update server cache subdirectories
  try {
    const entries = await fsp.readdir(CACHE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(CACHE_ROOT, entry.name);
        const files = await fsp.readdir(dirPath);
        for (const file of files) {
          newIndex.set(file.toLowerCase(), path.join(dirPath, file));
        }
      }
    }
  } catch {
    // Cache root doesn't exist yet
  }

  // Index files in webclient-cache
  try {
    const files = await fsp.readdir(WEBCLIENT_CACHE_DIR);
    for (const file of files) {
      const key = file.toLowerCase();
      if (!newIndex.has(key)) {
        newIndex.set(key, path.join(WEBCLIENT_CACHE_DIR, file));
      }
    }
  } catch {
    // webclient-cache doesn't exist yet
  }

  // Atomic swap: clear and repopulate in one synchronous block
  imageFileIndex.clear();
  for (const [k, v] of newIndex) {
    imageFileIndex.set(k, v);
  }

  logger.info(`Image file index built: ${imageFileIndex.size} files`);
}

// =============================================================================
// In-memory INI cache (road, concrete, car block classes)
// =============================================================================
interface IniFileCache {
  files: Array<{ filename: string; content: string }>;
}

const iniCache: Record<string, IniFileCache> = {};

async function buildIniCache(): Promise<void> {
  const dirs: Record<string, string> = {
    roadBlockClasses: path.join(CACHE_DIR, 'RoadBlockClasses'),
    concreteBlockClasses: path.join(CACHE_DIR, 'ConcreteClasses'),
    carClasses: path.join(CACHE_DIR, 'CarClasses'),
  };

  for (const [key, dirPath] of Object.entries(dirs)) {
    try {
      const allFiles = await fsp.readdir(dirPath);
      const iniFiles = allFiles.filter(f => f.toLowerCase().endsWith('.ini'));
      const iniContents: Array<{ filename: string; content: string }> = [];
      for (const file of iniFiles) {
        const filePath = path.join(dirPath, file);
        const content = await fsp.readFile(filePath, 'utf-8');
        iniContents.push({ filename: file, content });
      }
      iniCache[key] = { files: iniContents };
    } catch {
      iniCache[key] = { files: [] };
    }
  }

  logger.info(`INI cache built: road=${iniCache.roadBlockClasses?.files.length ?? 0}, concrete=${iniCache.concreteBlockClasses?.files.length ?? 0}, car=${iniCache.carClasses?.files.length ?? 0}`);
}

/**
 * Reload all in-memory caches from disk. Called by CacheWatcher when the
 * cache-sync container writes a new sentinel file after completing a sync.
 * Guarded by a mutex to prevent interleaved rebuilds from rapid sentinel changes.
 */
let reloadInProgress = false;
async function reloadCaches(): Promise<void> {
  if (reloadInProgress) {
    logger.info('Cache reload already in progress, skipping');
    return;
  }
  reloadInProgress = true;
  try {
  await Promise.all([buildImageFileIndex(), buildIniCache(), loadInventionIndex()]);

  // Reload FacilityDimensionsCache if it wasn't initialized (first deploy case)
  const facilities = facilityDimensionsCache();
  if (!facilities.isHealthy()) {
    try {
      await facilities.reload();
      logger.info(`Facility cache reloaded: ${facilities.getStats().total} facilities`);
    } catch (err: unknown) {
      logger.warn(`Facility cache reload failed: ${toErrorMessage(err)}`);
    }
  }

  // Invalidate MapDataService extraction cache so next request re-checks disk
  mapDataService().invalidateCache();

  logger.info(`Caches reloaded: images=${imageFileIndex.size}, road=${iniCache['roadBlockClasses']?.files.length ?? 0}, concrete=${iniCache['concreteBlockClasses']?.files.length ?? 0}`);
  } finally {
    reloadInProgress = false;
  }
}

// =============================================================================
// Research Invention Index (parsed from research.0.dat)
// =============================================================================

let inventionIndex: DatInventionIndex | null = null;
let inventionIndexJson: string | null = null;

async function loadInventionIndex(): Promise<void> {
  const datPath = path.join(CACHE_DIR, 'Inventions', 'research.0.dat');
  try {
    await fsp.access(datPath);
  } catch {
    logger.warn('research.0.dat not found — research name resolution disabled');
    return;
  }
  try {
    const buffer = await fsp.readFile(datPath);
    const parsed = parseResearchDat(buffer);
    inventionIndex = buildInventionIndex(parsed);

    // Pre-serialize the JSON response for the API endpoint
    const serializable = {
      inventionCount: parsed.inventionCount,
      categoryTabs: parsed.categoryTabs,
      inventions: parsed.inventions.map(inv => ({
        id: inv.id,
        name: inv.name,
        category: inv.category,
        description: inv.description,
        parent: inv.parent,
        properties: inv.properties,
        requires: inv.requires,
      })),
    };
    inventionIndexJson = JSON.stringify(serializable);
    logger.info(`Research index loaded: ${parsed.inventionCount} inventions, ${parsed.categoryTabs.length} tabs`);
  } catch (err: unknown) {
    logger.error(`Failed to load research.0.dat: ${toErrorMessage(err)}`);
  }
}

/** Get the invention index for name enrichment. */
export function getInventionIndex(): DatInventionIndex | null {
  return inventionIndex;
}

const proxyImageDeps: ProxyImageDeps = {
  imageFileIndex,
  cacheRoot: CACHE_DIR,
  webclientCacheDir: WEBCLIENT_CACHE_DIR,
  updateServerCacheUrl: UPDATE_SERVER.CACHE_URL,
  log: { debug: (msg: string) => logger.debug(msg), warn: (msg: string) => logger.warn(msg) },
};

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/**
 * Extract client IP, respecting X-Forwarded-For when behind a trusted reverse proxy.
 */
function getClientIp(req: { headers: http.IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    const first = typeof xff === 'string' ? xff.split(',')[0].trim() : undefined;
    if (first) return first.replace('::ffff:', '');
  }
  return (req.socket.remoteAddress || '0.0.0.0').replace('::ffff:', '');
}

/**
 * Sanitize a user-supplied URL path segment to prevent path traversal.
 * Returns the decoded value if safe, or null if it contains traversal sequences.
 */
function sanitizePathParam(raw: string): string | null {
  const decoded = decodeURIComponent(raw);
  if (decoded.includes('..') || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }
  return decoded;
}

// Security headers applied to all HTTP responses
function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const cdnOrigin = config.cdn.url ? ` ${config.cdn.url}` : '';
  res.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' ws: wss:${cdnOrigin}; img-src 'self' data: blob:${cdnOrigin}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'`);
  if (process.env.ENABLE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}

// Simple in-memory rate limiter for sensitive endpoints
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
// Ceilings raised to 1000/min on 2026-08-22 (developer decision) for the automated test
// phase: the bench worker serializes real live traffic, and the Delphi servers hold this
// load without trouble. Tighten again before any public deployment.
// Recorded as exception SEC-X-1 in doc/production-security-policy.md §9 — the policy floor
// is auth 10/min and proxy 60/min, and SPO-Deploy's DEPLOY.md ("Before the first public
// deployment") is what raises the question at the right moment. This comment is not.
const RATE_LIMIT_MAX_AUTH = 1000;     // max auth attempts per minute per IP
const RATE_LIMIT_MAX_PROXY = 1000;    // max proxy-image requests per minute per IP
const RATE_LIMIT_MAX_ENTRIES = 10_000; // max entries before forced cleanup

function checkRateLimit(ip: string, category: string, maxRequests: number): boolean {
  const key = `${category}:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    // Prevent unbounded growth: evict expired entries when map is too large
    if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetTime) rateLimitMap.delete(k);
      }
    }
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= maxRequests;
}

// Periodic cleanup of expired rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  }
}, 300_000);

// 1. HTTP Server for Static Files + Image Proxy
const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const safePath = req.url === '/' ? '/index.html' : req.url || '/index.html';

  // Runtime config script — serves CDN URL override as an external JS file (CSP-compliant).
  // Only relevant when CHUNK_CDN_URL is overridden. In Docker, this returns
  // an empty script since config.cdn.url matches the default.
  if (safePath === '/spo-runtime-config.js') {
    const body = buildRuntimeConfigScript({
      cdnUrl: config.cdn.url,
      singleUserMode: SINGLE_USER_MODE,
      forceWorld: config.server.forceWorld,
      bugReport: config.server.bugReportMode,
    });
    res.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    return;
  }

  // Startup status endpoint — always SSE so EventSource clients work
  if (safePath === '/api/startup-status') {
    if (serviceRegistry.isInitialized()) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`event: status\ndata: ${JSON.stringify({ phase: 'ready', progress: 1, message: 'Server ready', services: [] })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    const send = (data: import('./service-registry').StartupProgressEvent) => {
      res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onProgress = (evt: import('./service-registry').StartupProgressEvent) => send(evt);
    const onReady = () => {
      send({ phase: 'ready', progress: 1, message: 'Server ready', services: [] });
      res.end();
      serviceRegistry.off('startup-progress', onProgress);
      serviceRegistry.off('initialized', onReady);
    };
    serviceRegistry.on('startup-progress', onProgress);
    serviceRegistry.on('initialized', onReady);
    req.on('close', () => {
      serviceRegistry.off('startup-progress', onProgress);
      serviceRegistry.off('initialized', onReady);
    });
    return;
  }

  // Map data API endpoint: /api/map-data/:mapname
  if (safePath.startsWith('/api/map-data/')) {
    const mapName = sanitizePathParam(safePath.substring('/api/map-data/'.length).split('?')[0]);

    if (!mapName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing map name' }));
      return;
    }

    try {
      // Extract CAB file if needed (or verify files exist)
      await mapDataService().extractCabFile(mapName);

      // Get map metadata from INI file
      const metadata = await mapDataService().getMapMetadata(mapName);

      // Get BMP file path and create proxy URL
      const bmpPath = mapDataService().getBmpFilePath(mapName);
      const bmpUrl = fileToProxyUrl(bmpPath);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(JSON.stringify({ metadata, bmpUrl }));
    } catch (error: unknown) {
      logger.error(`MapDataService: Error loading map: ${toErrorMessage(error)}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load map data' }));
    }
    return;
  }

  // Terrain info endpoint: /api/terrain-info/:terrainType
  // Returns available seasons and default season for a terrain type
  // Example: /api/terrain-info/Alien%20Swamp
  // P-M3 readout — the census that decides whether the errorCode contract can
  // flip to `reject`. `handleRdoErrorResponse` has been tallying every
  // `A<id> error N;` reply since the observation mode went in, but nothing read
  // the tally back: it accumulated in memory and died with the process, so the
  // list the operator is meant to triage was only ever reachable by grepping
  // `RDO-CONTRACT` out of the logs. Sorted most frequent first.
  if (safePath === '/api/rdo-error-contract') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(buildErrorContractReadout(config.rdo.errorContract), null, 2));
    return;
  }

  // parsePropertyResponse fallback census — measure before changing (P-M3
  // method). `structured: true` entries are the ones that returned another
  // property's text; `false` entries are the bare-value callers the fallback
  // legitimately serves. Triage the first group before touching the fallback.
  if (safePath === '/api/property-fallback') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(buildPropertyFallbackReadout(), null, 2));
    return;
  }

  // Road block classes endpoint — served from in-memory cache
  if (safePath === '/api/road-block-classes') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(JSON.stringify(iniCache.roadBlockClasses));
    return;
  }

  // Concrete block classes endpoint — served from in-memory cache
  if (safePath === '/api/concrete-block-classes') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(JSON.stringify(iniCache.concreteBlockClasses));
    return;
  }

  // Car classes endpoint — served from in-memory cache
  if (safePath === '/api/car-classes') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(JSON.stringify(iniCache.carClasses));
    return;
  }

  if (safePath.startsWith('/api/terrain-info/')) {
    const terrainType = sanitizePathParam(safePath.substring('/api/terrain-info/'.length).split('?')[0]);

    if (!terrainType) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid terrain type' }));
      return;
    }

    // Known terrain types and their available seasons (from game data)
    const terrainSeasons: Record<string, { availableSeasons: number[]; defaultSeason: number }> = {
      'Earth': { availableSeasons: [0, 1, 2, 3], defaultSeason: 2 },
      'Alien Swamp': { availableSeasons: [0, 2], defaultSeason: 2 },
    };

    const terrainInfo = terrainSeasons[terrainType];
    if (!terrainInfo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Terrain type not found' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(JSON.stringify(terrainInfo));
    return;
  }

  // CDN proxy — relays requests to the upstream CDN server-side, bypassing CORS.
  // Used when the client sets cdn.url to '' (e.g., single-user mode).
  // The client falls back to /cdn/* paths when CHUNK_CDN_URL is empty.
  if (safePath.startsWith('/cdn/')) {
    const cdnBaseUrl = config.cdn.url || 'https://spo.zz.works';
    const cdnPath = safePath.substring('/cdn/'.length);

    if (!cdnPath || cdnPath.includes('..') || cdnPath.includes('\\') || cdnPath.includes('\0')) {
      res.writeHead(400);
      res.end('Invalid CDN path');
      return;
    }

    const cdnFullUrl = `${cdnBaseUrl}/${cdnPath}`;

    try {
      const cdnResp = await fetchWithTimeout(cdnFullUrl);
      if (!cdnResp.ok) {
        res.writeHead(cdnResp.status);
        res.end();
        return;
      }
      const contentType = cdnResp.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.from(await cdnResp.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      });
      res.end(buffer);
    } catch (error: unknown) {
      logger.warn(`CDN proxy failed for ${cdnPath}: ${toErrorMessage(error)}`);
      res.writeHead(502);
      res.end('CDN fetch failed');
    }
    return;
  }

  // Research inventions endpoint: /api/research-inventions
  // Returns parsed invention data from research.0.dat for client-side name resolution
  if (safePath === '/api/research-inventions') {
    if (inventionIndexJson) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(inventionIndexJson);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'research.0.dat not loaded' }));
    }
    return;
  }

  // Debug log endpoint: POST /api/debug-log — client submits wire history for server-side logging
  if (safePath === '/api/debug-log' && req.method === 'POST') {
    const transport = getErrorFileTransport() ?? getFileTransport();
    if (!transport) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File logging not enabled (set LOG_ERROR_FILE or LOG_FILE env var)' }));
      return;
    }

    // Rate limit: 2 reports per IP per RATE_LIMIT_WINDOW_MS (60 s) — the window is the shared
    // one declared above, not a per-category 30 s. SEC-H-4 records these same numbers.
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp, 'debug-log', 2)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: `Too many debug reports. Try again in ${RATE_LIMIT_WINDOW_MS / 1000} seconds.` })
      );
      return;
    }

    // Read body (max 512KB)
    const chunks: Buffer[] = [];
    let bodySize = 0;
    const MAX_DEBUG_BODY = 512 * 1024;

    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize <= MAX_DEBUG_BODY) {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (bodySize > MAX_DEBUG_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          player?: string;
          history?: Array<{ dir: string; type: string; ts: number; reqId?: string }>;
        };

        if (!body.player || !Array.isArray(body.history)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing player or history fields' }));
          return;
        }

        // Write each entry as NDJSON with ClientWire context
        const entries = body.history.slice(0, 200); // Cap at 200 entries
        for (const entry of entries) {
          transport.write(JSON.stringify({
            ts: new Date(entry.ts).toISOString(),
            level: 'DEBUG',
            ctx: 'ClientWire',
            msg: `${entry.dir} ${entry.type}`,
            player: body.player,
            meta: { reqId: entry.reqId },
          }));
        }

        logger.info(`Debug report received from ${body.player}: ${entries.length} entries`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, entries: entries.length }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Bug report deposit: POST /api/bug-report — dev-only, 404 unless SPO_BUG_REPORT=true.
  // Everything, transport included, lives in bug-report-endpoint.ts, which tests can import.
  // checkRateLimit's window is fixed at RATE_LIMIT_WINDOW_MS (60 s) — this is 10 per minute.
  if (safePath === '/api/bug-report' && req.method === 'POST') {
    handleBugReportRequest(req, res, {
      enabled: config.server.bugReportMode,
      queueDir: config.server.reportsDir || DEFAULT_QUEUE_DIR,
      allowRequest: () => checkRateLimit(getClientIp(req), 'bug-report', 10),
    });
    return;
  }

  // Bug report PULL: the dev-machine orchestrator's own initiative (SPO-Pipeline's
  // remote-report-pull.js) fetches queued reports over HTTPS instead of production pushing
  // anything. Gated by SPO_REPORT_PULL_TOKEN, deliberately independent of SPO_BUG_REPORT — a
  // report already queued should still drain even with capture switched off. Every route
  // answers 404 (never 401/403) when the token is unset or wrong, same convention as the
  // deposit route. 20/min is generous for a 5-15 min poll cycle while still bounding a
  // misbehaving or malicious caller who somehow has the token.
  if (safePath.startsWith('/api/report-pull/')) {
    const pullDeps = {
      token: config.server.reportPullToken,
      queueDir: config.server.reportsDir || DEFAULT_QUEUE_DIR,
      peerIp: getClientIp(req),
      allowRequest: () => checkRateLimit(getClientIp(req), 'report-pull', 20),
    };
    if (safePath === '/api/report-pull/list' && req.method === 'GET') return handleReportPullList(req, res, pullDeps);
    if (safePath.startsWith('/api/report-pull/fetch') && req.method === 'GET') return handleReportPullFetch(req, res, pullDeps);
    if (safePath === '/api/report-pull/ack' && req.method === 'POST') return handleReportPullAck(req, res, pullDeps);
  }

  // Image proxy endpoint: /proxy-image?url=<encoded_url>
  if (safePath.startsWith(`${PROXY_IMAGE_ENDPOINT}?`)) {
    const urlParams = new URLSearchParams(safePath.split('?')[1]);
    const imageUrl = urlParams.get('url');

    if (!imageUrl) {
      res.writeHead(400);
      res.end('Missing url parameter');
      return;
    }

    // Rate limit proxy-image requests
    const clientIp = getClientIp(req);
    if (!SINGLE_USER_MODE && !checkRateLimit(clientIp, 'proxy', RATE_LIMIT_MAX_PROXY)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too many requests');
      return;
    }

    await proxyImage(imageUrl, res, proxyImageDeps);
    return;
  }

  // Cache endpoint: /cache/{category}/{filename}
  // Serves files from the update server cache (roads, buildings, etc.)
  // Prefers pre-baked PNG (with alpha) over original BMP when available
  if (safePath.startsWith('/cache/')) {
    const relativePath = safePath.substring('/cache/'.length);
    // Use imageFileIndex for case-insensitive lookup (handles mixed-case filenames on Linux)
    const lastSlash = relativePath.lastIndexOf('/');
    const filename = lastSlash >= 0 ? relativePath.substring(lastSlash + 1) : relativePath;
    const indexedPath = imageFileIndex.get(filename.toLowerCase());
    const filePath = indexedPath ?? path.join(CACHE_DIR, relativePath);

    // Security check: ensure path doesn't escape allowed cache directories
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.normalize(CACHE_DIR)) &&
        !normalizedPath.startsWith(path.normalize(WEBCLIENT_CACHE_DIR))) {
      res.writeHead(403);
      res.end('Access Denied');
      return;
    }

    // Determine content type
    const contentTypes: Record<string, string> = {
      '.bmp': 'image/bmp',
      '.gif': 'image/gif',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
    };

    // If requesting a BMP, check if a pre-baked PNG exists (has alpha channel pre-applied)
    const ext = path.extname(filePath).toLowerCase();
    let servePath = filePath;
    if (ext === '.bmp') {
      const pngFilename = filename.replace(/\.bmp$/i, '.png');
      const indexedPng = imageFileIndex.get(pngFilename.toLowerCase());
      if (indexedPng) {
        servePath = indexedPng;
      } else {
        const pngPath = filePath.replace(/\.bmp$/i, '.png');
        try {
          await fsp.access(pngPath);
          servePath = pngPath;
        } catch {
          // PNG doesn't exist, use original BMP path
        }
      }
    }
    const serveExt = path.extname(servePath).toLowerCase();

    try {
      const content = await fsp.readFile(servePath);
      res.writeHead(200, {
        'Content-Type': contentTypes[serveExt] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
      });
      res.end(content);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
    return;
  }

  // Map URL to local file
  let filePath = path.join(PUBLIC_DIR, safePath);

  // Prevent directory traversal — normalize and verify the resolved path stays within PUBLIC_DIR
  const normalizedPublicPath = path.normalize(filePath);
  if (!normalizedPublicPath.startsWith(path.normalize(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  // If requesting the JS bundle
  if (safePath === '/client.js') {
    filePath = path.join(PUBLIC_DIR, 'client.js');
  }

  const ext = path.extname(filePath);
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png'
  };

  try {
    const content: string | Buffer = await fsp.readFile(filePath);

    if (ext === '.html') {
      let html = content.toString('utf-8');

      // Rewrite asset references to content-hashed filenames from Vite manifest
      const { jsPath, cssPaths } = getHashedAssets();
      html = html.replace('src="app.js"', `src="${jsPath}"`);
      html = html.replace('href="app.css"', cssPaths.map(p => `href="${p}"`).join('" />\n    <link rel="stylesheet" '));

      // Inject a runtime config script tag into index.html so the client can use
      // the /cdn/ proxy when CHUNK_CDN_URL is overridden.
      // Uses an external script (CSP-compliant) instead of inline script.
      // In Docker/default mode, config.cdn.url is the default and no injection occurs.
      if (config.cdn.url !== 'https://spo.zz.works' || config.server.forceWorld || config.server.bugReportMode) {
        const injection = `<script src="/spo-runtime-config.js"></script>`;
        html = html.replace('</head>', `${injection}</head>`);
      }

      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache',
      });
      res.end(html, 'utf-8');
    } else {
      // Hashed assets (assets/*) get immutable long-cache; other static files get no-cache
      const isHashedAsset = safePath.startsWith('/assets/');
      const cacheControl = isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';

      res.writeHead(200, {
        'Content-Type': contentTypes[ext] || 'text/plain',
        'Cache-Control': cacheControl,
      });
      res.end(content, 'utf-8');
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.writeHead(404);
      res.end('File not found');
    } else {
      res.writeHead(500);
      res.end('Internal server error');
    }
  }
});

// 2. WebSocket Server
// Per-IP WebSocket connection tracking for rate limiting
const wsConnectionsPerIp = new Map<string, number>();
// 1000 since 2026-08-22 (developer decision, test phase — see the rate-limit note above).
// Exception SEC-X-1; the SEC-W-3 floor is 5 per IP. Restore it before any public deployment.
const WS_MAX_CONNECTIONS_PER_IP = 1000;
const WS_MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB max message size (policy SEC-W-2)

const wss = new WebSocketServer({
  server,
  maxPayload: WS_MAX_PAYLOAD_BYTES,
  verifyClient: (info, callback) => {
    // Validate Origin header to prevent Cross-Site WebSocket Hijacking
    const origin = info.origin || info.req.headers.origin || '';
    const host = info.req.headers.host || '';

    // Allow same-origin connections and localhost development
    const allowedOrigins = [
      `http://${host}`,
      `https://${host}`,
      'http://localhost:8080',
      'http://127.0.0.1:8080',
    ];

    if (!SINGLE_USER_MODE && !origin) {
      logger.warn('[Gateway] WebSocket connection rejected: missing origin header');
      callback(false, 403, 'Forbidden: missing origin');
      return;
    }

    if (origin && !allowedOrigins.includes(origin)) {
      logger.warn(`[Gateway] WebSocket connection rejected: invalid origin "${origin}"`);
      callback(false, 403, 'Forbidden: invalid origin');
      return;
    }

    // Per-IP connection limit (skipped in single-user mode)
    const ip = getClientIp(info.req);
    const currentCount = wsConnectionsPerIp.get(ip) || 0;
    if (!SINGLE_USER_MODE && currentCount >= WS_MAX_CONNECTIONS_PER_IP) {
      logger.warn(`[Gateway] WebSocket connection rejected: too many connections from ${ip}`);
      callback(false, 429, 'Too many connections');
      return;
    }

    wsConnectionsPerIp.set(ip, currentCount + 1);
    callback(true);
  },
});

// GM Chat: track all connected WebSocket clients and their usernames
const connectedClients = new Map<WebSocket, string>(); // ws → username
const GM_USERNAMES = new Set((process.env.SPO_GM_USERS || '').split(',').map(s => s.trim()).filter(Boolean));

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const clientIp = getClientIp(req);
  logger.info('Client connected', { ip: clientIp });

  // Create a dedicated Starpeace Session for this connection
  const spSession = new StarpeaceSession();
  spSession.log.info('SESSION_START', { ip: clientIp });

  // Search Menu Service (will be initialized after login)
  let searchMenuService: SearchMenuService | null = null;
  let loginCredentials: { username: string; worldName: string; worldInfo: WorldInfo | undefined; companyId: string } | null = null;

  // -- Forward Events: Gateway -> Browser --
  spSession.on('ws_event', (payload: WsMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  });

  // -- World socket reconnection notifications --
  spSession.on('worldReconnected', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: WsMessageType.EVENT_WORLD_RECONNECTED }));
    }
  });
  spSession.on('worldDisconnected', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: WsMessageType.EVENT_WORLD_DISCONNECTED }));
    }
  });

  // -- Handle Requests: Browser -> Gateway --
  // Two-lane queue: stateless messages (camera updates) execute immediately,
  // everything else is serialized through an RDO queue to prevent concurrent
  // Delphi temp-object access (see: building switch race condition).
  const FAST_LANE: ReadonlySet<string> = new Set([
    WsMessageType.REQ_UPDATE_CAMERA,
  ]);
  let rdoQueue: Promise<void> = Promise.resolve();

  /** Process a single WS message. Must be serialized for RDO-touching messages. */
  async function processMessage(data: string): Promise<void> {
    try {
      const msg: WsMessage = JSON.parse(data.toString());

      // Capture login credentials for SearchMenuService
      if (msg.type === WsMessageType.REQ_LOGIN_WORLD) {
        const loginMsg = msg as WsReqLoginWorld;
        const worldInfo = spSession.getWorldInfo(loginMsg.worldName);
        loginCredentials = {
          username: loginMsg.username,
          worldName: loginMsg.worldName,
          worldInfo: worldInfo,
          companyId: '' // Will be set after company selection
        };
        // Track for GM chat broadcast
        connectedClients.set(ws, loginMsg.username);
      }

      // Capture company selection
      if (msg.type === WsMessageType.REQ_SELECT_COMPANY) {
        const companyMsg = msg as WsReqSelectCompany;
        if (loginCredentials) {
          loginCredentials.companyId = companyMsg.companyId;
        }
      } else if (msg.type === WsMessageType.REQ_SWITCH_COMPANY) {
        const switchMsg = msg as WsReqSwitchCompany;
        if (loginCredentials) {
          loginCredentials.companyId = switchMsg.company.id;
        }
      }

      // Correlation ID: trace this WS request through all RDO calls
      const corrId = `ws-${Date.now()}-${msg.wsRequestId || 'noid'}`;
      spSession.setCorrelationId(corrId);
      const isQuietMsg = QUIET_WS_TYPES.has(msg.type);
      if (!isQuietMsg) spSession.log.info(`WS>> ${msg.type}`, { wsRequestId: msg.wsRequestId });

      await handleClientMessage(ws, spSession, searchMenuService, msg, clientIp);
      spSession.setCorrelationId(null);

      // Initialize SearchMenuService after successful login response
      const isCompanySelection = msg.type === WsMessageType.REQ_SELECT_COMPANY || msg.type === WsMessageType.REQ_SWITCH_COMPANY;
      if (isCompanySelection && !searchMenuService && loginCredentials && loginCredentials.worldInfo) {
        setTimeout(() => {
          if (loginCredentials && loginCredentials.worldInfo && spSession) {
            const daAddr = spSession.getDAAddr();
            const daPort = spSession.getDAPort();

            if (daAddr && daPort) {
              searchMenuService = new SearchMenuService(
                loginCredentials.worldInfo.ip,
                loginCredentials.worldInfo.port || 80,
                loginCredentials.worldName,
                loginCredentials.username,
                loginCredentials.companyId, // Using companyId as companyName for now
                daAddr, // Use real DAAddr from session
                daPort, // the InterfaceServer's DALockPort, as Voyager sends it
                spSession.languageId
              );
              logger.info(`SearchMenuService initialized with DAAddr: ${daAddr}:${daPort}`);

              // Fetch Capitol coordinates from DirectoryMain.asp and push to client
              searchMenuService.getHomePage().then(categories => {
                const capitol = categories.find(c => c.label === 'Capitol' && c.enabled && c.x != null && c.y != null);
                const coords = capitol ? { x: capitol.x!, y: capitol.y! } : null;
                spSession.setCapitolCoords(coords);
                const resp: WsRespCapitolCoords = {
                  type: WsMessageType.RESP_CAPITOL_COORDS,
                  x: coords?.x ?? 0,
                  y: coords?.y ?? 0,
                  hasCapitol: coords !== null,
                };
                ws.send(JSON.stringify(resp));
                logger.debug(`Capitol coords: ${coords ? `${coords.x},${coords.y}` : 'none'}`);
              }).catch((err: unknown) => {
                logger.error(`Failed to fetch Capitol coords: ${toErrorMessage(err)}`);
              });
            } else {
              logger.error('Failed to initialize SearchMenuService: DAAddr or DAPort not available');
            }
          }
        }, 500);
      }
    } catch (err: unknown) {
      spSession.log.error('WS<< PARSE_ERROR', { error: toErrorMessage(err) });
      spSession.setCorrelationId(null);
      const errorResp: WsRespError = {
        type: WsMessageType.RESP_ERROR,
        errorMessage: 'Invalid Message Format',
        code: ErrorCodes.ERROR_InvalidParameter
      };
      ws.send(JSON.stringify(errorResp));
    }
  }

  ws.on('message', (data: string) => {
    // Peek at message type to decide lane (lightweight JSON key extraction)
    let msgType: string | undefined;
    try {
      const typeMatch = data.toString().match(/"type"\s*:\s*"([^"]+)"/);
      msgType = typeMatch?.[1];
    } catch { /* fall through to RDO lane */ }

    if (msgType && FAST_LANE.has(msgType)) {
      // Fast lane: execute immediately, no serialization needed
      processMessage(data).catch((err: unknown) => {
        spSession.log.error('Fast-lane message error', { error: toErrorMessage(err) });
      });
    } else {
      // RDO lane: serialize to prevent concurrent Delphi temp-object access
      rdoQueue = rdoQueue.then(() => processMessage(data)).catch((err: unknown) => {
        spSession.log.error('RDO queue message error', { error: toErrorMessage(err) });
      });
    }
  });

  ws.on('close', async () => {
    const durationMs = Date.now() - spSession.startedAt;
    spSession.log.info('SESSION_END', {
      ip: clientIp,
      player: connectedClients.get(ws) ?? 'unknown',
      durationMs: String(durationMs),
      phase: String(spSession.getPhase()),
    });
    connectedClients.delete(ws);

    // Decrement per-IP connection count
    const count = wsConnectionsPerIp.get(clientIp) || 0;
    if (count <= 1) {
      wsConnectionsPerIp.delete(clientIp);
    } else {
      wsConnectionsPerIp.set(clientIp, count - 1);
    }
    // Send Logoff before cleanup to gracefully close game server session
    // Note: endSession() schedules socket closure 2 seconds after Logoff
    try {
      await spSession.endSession();
    } catch (err: unknown) {
      logger.error(`Error sending Logoff on close: ${toErrorMessage(err)}`);
    }
    spSession.destroy();
  });
});

/**
 * Message Router — dispatches to handler modules in ws-handlers/
 */
async function handleClientMessage(ws: WebSocket, session: StarpeaceSession, searchMenuService: SearchMenuService | null, msg: WsMessage, clientIp: string) {
  // Rate limit authentication attempts
  const authTypes: string[] = [WsMessageType.REQ_AUTH_CHECK, WsMessageType.REQ_CONNECT_DIRECTORY, WsMessageType.REQ_LOGIN_WORLD];
  if (authTypes.includes(msg.type)) {
    if (!SINGLE_USER_MODE && !checkRateLimit(clientIp, 'auth', RATE_LIMIT_MAX_AUTH)) {
      const errorResp: WsRespError = {
        type: WsMessageType.RESP_ERROR,
        wsRequestId: msg.wsRequestId,
        errorMessage: 'Too many authentication attempts. Please try again later.',
        code: ErrorCodes.ERROR_Unknown
      };
      ws.send(JSON.stringify(errorResp));
      return;
    }
  }

  // Phase-based message gate: reject messages not allowed for current session phase
  const phase = session.getPhase();
  const allowed = PHASE_ALLOWED_MESSAGES[phase];
  if (allowed !== null && msg.type !== WsMessageType.REQ_LOGOUT && !allowed.has(msg.type)) {
    logger.warn(`[Gateway] Message ${msg.type} rejected: not allowed in phase ${phase}`);
    const errorResp: WsRespError = {
      type: WsMessageType.RESP_ERROR,
      wsRequestId: msg.wsRequestId,
      errorMessage: `Operation not allowed in current session state`,
      code: ErrorCodes.ERROR_AccessDenied
    };
    ws.send(JSON.stringify(errorResp));
    return;
  }

  const handler = wsHandlerRegistry[msg.type as WsMessageType];
  if (!handler) {
    logger.warn(`Unknown message type: ${msg.type}`);
    const errorResp: WsRespError = {
      type: WsMessageType.RESP_ERROR,
      wsRequestId: msg.wsRequestId,
      errorMessage: 'Unknown message type',
      code: ErrorCodes.ERROR_InvalidParameter
    };
    ws.send(JSON.stringify(errorResp));
    return;
  }

  try {
    await handler(
      { ws, session, searchMenuService, facilityDimensionsCache, inventionIndex, connectedClients, gmUsernames: GM_USERNAMES },
      msg,
    );
    if (!QUIET_WS_TYPES.has(msg.type)) session.log.info(`WS<< ${msg.type} OK`, { wsRequestId: msg.wsRequestId });
  } catch (err: unknown) {
    session.log.error(`WS<< ${msg.type} FAIL`, { wsRequestId: msg.wsRequestId, error: toErrorMessage(err) });
    const errorResp: WsRespError = {
      type: WsMessageType.RESP_ERROR,
      wsRequestId: msg.wsRequestId,
      errorMessage: 'Internal server error',
      code: ErrorCodes.ERROR_Unknown
    };
    ws.send(JSON.stringify(errorResp));
  }
}

// =============================================================================
// Gateway startup — exportable for embedding and for the test harness
// =============================================================================

/** The module-level HTTP server — exported so tests can bind it on an ephemeral port. */
export { server as httpServer };

export interface GatewayOptions {
  host?: string;
  port?: number;
  singleUserMode?: boolean;
  onListening?: (port: number) => void;
}

export interface GatewayInstance {
  server: http.Server;
  port: number;
  shutdown: () => Promise<void>;
}

export async function startGateway(options?: GatewayOptions): Promise<GatewayInstance> {
  // Apply runtime overrides (takes precedence over env vars / config defaults)
  if (options?.host !== undefined) HOST = options.host;
  if (options?.port !== undefined) PORT = options.port;
  if (options?.singleUserMode !== undefined) SINGLE_USER_MODE = options.singleUserMode;

  // Validate the production configuration and report it BEFORE anything binds a port
  // (policy SEC-R-2). A forbidden combination throws, main() logs it and exits 1.
  enforceProductionConfig(
    process.env,
    config.logging.level,
    {
      trustProxy: TRUST_PROXY,
      hstsEnabled: process.env.ENABLE_HSTS === 'true',
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      rateLimitMaxAuth: RATE_LIMIT_MAX_AUTH,
      rateLimitMaxProxy: RATE_LIMIT_MAX_PROXY,
      wsMaxConnectionsPerIp: WS_MAX_CONNECTIONS_PER_IP,
      wsMaxPayloadBytes: WS_MAX_PAYLOAD_BYTES,
      singleUserMode: SINGLE_USER_MODE,
    },
    // The SEC-R-2 record bypasses LOG_LEVEL: `warn` and `error` are compliant production
    // levels, and a readout the policy says MUST appear cannot be one the verbosity hides.
    {
      info: (message: string) => logger.always(LogLevel.INFO, message),
      warn: (message: string) => logger.always(LogLevel.WARN, message),
      error: (message: string) => logger.always(LogLevel.ERROR, message),
    }
  );

  // Load Vite manifest for content-hashed asset resolution
  loadViteManifest();

  // Register services AFTER paths are resolved — services capture cache dir at construction
  registerServices();

  // Start HTTP server FIRST so /api/startup-status SSE is reachable during cache building
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${PORT} is already in use. Set PORT env var or use port 0 for auto-assign.`));
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(PORT, HOST, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        PORT = addr.port; // capture actual port (important when port=0)
      }
      logger.info(`HTTP server listening on ${HOST}:${PORT} (initializing...)`);
      options?.onListening?.(PORT);
      resolve();
    });
  });

  // Build in-memory caches with granular progress reporting via SSE
  const cacheSteps: import('./service-registry').CacheStepEntry[] = [
    { name: 'inventionIndex', label: 'Parsing research data', status: 'pending' },
    { name: 'imageIndex', label: 'Indexing image files', status: 'pending' },
    { name: 'iniCache', label: 'Loading configuration', status: 'pending' },
  ];

  const emitCacheProgress = (message: string) => {
    const pendingServices = serviceRegistry.getServiceNames().map(name => ({
      name,
      status: 'pending' as const,
      progress: 0,
    }));
    serviceRegistry.emit('startup-progress', {
      phase: 'initializing',
      progress: 0,
      message,
      services: pendingServices,
      cacheSteps: [...cacheSteps],
    } satisfies import('./service-registry').StartupProgressEvent);
  };

  logger.info('Building caches...');
  emitCacheProgress('Building file indexes...');

  await Promise.all([
    (async () => {
      cacheSteps[0].status = 'running';
      emitCacheProgress('Parsing research data...');
      await loadInventionIndex();
      cacheSteps[0].status = 'complete';
      emitCacheProgress('Research data ready');
    })(),
    (async () => {
      cacheSteps[1].status = 'running';
      emitCacheProgress('Indexing image files...');
      await buildImageFileIndex();
      cacheSteps[1].status = 'complete';
      emitCacheProgress('Image index ready');
    })(),
    (async () => {
      cacheSteps[2].status = 'running';
      emitCacheProgress('Loading configuration...');
      await buildIniCache();
      cacheSteps[2].status = 'complete';
      emitCacheProgress('Configuration ready');
    })(),
  ]);

  // Initialize services — facilities/mapData run in parallel (same depth)
  logger.info('Initializing services...');
  await serviceRegistry.initialize();

  if (CACHE_SYNC_MODE === 'inline') {
    // Rebuild caches now that UpdateService has downloaded files
    await buildIniCache();
    await buildImageFileIndex();
    logger.info(`Caches rebuilt after service init: road=${iniCache['roadBlockClasses']?.files.length ?? 0}, concrete=${iniCache['concreteBlockClasses']?.files.length ?? 0}, car=${iniCache['carClasses']?.files.length ?? 0}, images=${imageFileIndex.size}`);

    // Log service-specific statistics
    const updateStats = serviceRegistry.get<UpdateService>('update').getStats();
    logger.info(`Update service: ${updateStats.downloaded} downloaded, ${updateStats.extracted} CAB extracted, ${updateStats.skipped} skipped, ${updateStats.failed} failed`);
  } else {
    // External mode: watch for sentinel file from cache-sync container
    const sentinelPath = path.join(CACHE_DIR, '.cache-sync-status.json');
    const cacheWatcher = new CacheWatcher(sentinelPath);
    cacheWatcher.on('cache-updated', async () => {
      logger.info('Cache updated by sync service, reloading indexes...');
      await reloadCaches();
    });
    cacheWatcher.start();
    logger.info(`Cache watcher started (mode=external, sentinel=${sentinelPath})`);
  }

  const facilityStats = facilityDimensionsCache().getStats();
  if (facilityStats.total > 0) {
    logger.info(`Facility cache: ${facilityStats.total} facilities loaded`);
  } else {
    logger.warn('Facility cache: 0 facilities (cache sync pending)');
  }

  logger.info(`Server ready at http://${HOST}:${PORT}`);

  // Build shutdown function (does NOT call process.exit)
  const shutdown = async (): Promise<void> => {
    logger.info('[Gateway] Shutting down...');

    // Close all active WebSocket connections before stopping the HTTP server
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(1001, 'Server shutting down');
      }
    }
    logger.info(`[Gateway] Closed ${wss.clients.size} WebSocket client(s)`);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force close after 2s if server.close() hangs
      setTimeout(() => {
        if ((server as { closeAllConnections?: () => void }).closeAllConnections) {
          (server as { closeAllConnections: () => void }).closeAllConnections();
        }
        resolve();
      }, 2000);
    });

    // Shut down services with a 10s overall timeout
    await Promise.race([
      serviceRegistry.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
    logger.info('[Gateway] Shutdown complete');
  };

  return { server, port: PORT, shutdown };
}

// =============================================================================
// Standalone entry point — when run directly (not imported by a test)
// =============================================================================

function setupStandaloneErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('[Gateway] Uncaught exception:', error);
  });
  process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
    logger.error('[Gateway] Unhandled promise rejection:', reason);
  });
}

async function main(): Promise<void> {
  setupStandaloneErrorHandlers();
  try {
    const gateway = await startGateway();
    setupGracefulShutdown(serviceRegistry, gateway.server);
  } catch (error: unknown) {
    logger.error(`Failed to start server: ${toErrorMessage(error)}`);
    process.exit(1);
  }
}

// Auto-start only when run directly (not when imported as a module)
const isDirectRun = typeof require !== 'undefined' && require.main === module;
if (isDirectRun) {
  main();
}
