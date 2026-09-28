import * as http from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { StarpeaceSession } from './spo_session';
import { config } from '../shared/config';
import { createLogger, getFileTransport, getErrorFileTransport, LogLevel, closeLogTransports } from '../shared/logger';
import { UPDATE_SERVER } from '../shared/constants';
import { fileToProxyUrl, PROXY_IMAGE_ENDPOINT } from '../shared/proxy-utils';
import * as ErrorCodes from '../shared/error-codes';
import { FacilityDimensionsCache } from './facility-dimensions-cache';
import { SearchMenuService } from './search-menu-service';
import { buildContentSecurityPolicy } from './security-headers';
import { UpdateService } from './update-service';
import { MapDataService } from './map-data-service';
import { serviceRegistry, setupGracefulShutdown } from './service-registry';
import { ConnectionDrain, createSessionTeardown, createShutdownSequence } from './gateway-shutdown';
import { startHeartbeat, WS_HEARTBEAT_INTERVAL_MS } from './ws-hygiene';
import { CacheWatcher } from './cache-watcher';
import { pushCapitolCoords } from './capitol-coords';
import { resolveClientIp } from './client-ip';
import {
  WsMessageType,
  SessionPhase,
  type WsMessage,
  type WorldInfo,
  type WsReqLoginWorld,
  type WsReqSelectCompany,
  type WsReqSwitchCompany,
  type WsReqResumeSession,
  type WsRespError,
  type WsRespResumeSession,
  type WsEventSessionResumeToken,
} from '../shared/types';
import type { WsHandlerContext } from './ws-handlers/types';
import {
  SessionBinding,
  SessionParkRegistry,
  readParkMs,
  readMaxParked,
  buildResumeSnapshot,
  RESUME_REFUSED_CODE,
  RESUME_REFUSED_MESSAGE,
  type ResumeEntry,
} from './session-park';
import { toErrorMessage } from '../shared/error-utils';
import { wsHandlerRegistry } from './ws-handlers';
import { buildErrorContractReadout, buildPropertyFallbackReadout } from './session/diagnostics-readouts';
import {
  isLocalOnlyRequest,
  buildHealth,
  buildMetrics,
  directoryProbe,
  sessionRegistry,
  readGatewayVersion,
  startMetricsLog,
  PROCESS_STARTED_AT_MS,
  type GatewayMetrics,
} from './observability';
import { parseResearchDat, buildInventionIndex, type DatInventionIndex } from '../shared/research-dat-parser';
import { getPublicDir, getCacheDir, getWebclientCacheDir } from './paths';
import { buildRuntimeConfigScript } from './runtime-config';
import { handleBugReportRequest, DEFAULT_QUEUE_DIR } from './bug-report-endpoint';
import { ReportTicketRegistry } from './bug-report-tickets';
import { handleClientErrorRequest, getClientErrorCounts, CLIENT_ERROR_MAX_PER_IP } from './client-error-endpoint';
import { handleReportPullList, handleReportPullFetch, handleReportPullAck } from './report-pull-endpoint';
import { enforceProductionConfig } from './production-config';
import {
  proxyImage, buildImageFileIndexEntries, proxyImageHosts, type ProxyImageDeps,
  sweepWebclientCache, startWebclientCacheSweeper, WEBCLIENT_CACHE_SWEEP_INTERVAL_MS,
} from './proxy-image';
import { fetchWithTimeout } from './fetch-with-timeout';
import {
  WsMessageGuard,
  WS_MESSAGE_RATE_PER_SECOND,
  WS_MESSAGE_BURST,
  WS_MAX_QUEUED_MESSAGES,
  WS_GUARD_CLOSE_CODE,
  WS_RATE_EXCEEDED_REASON,
  WS_QUEUE_EXCEEDED_REASON,
} from './ws-message-guard';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_AUTH,
  RATE_LIMIT_MAX_PROXY,
  WS_MAX_CONNECTIONS_PER_IP,
  checkRateLimit,
  checkAuthRateLimit,
  checkResumeRateLimit,
  sweepExpiredRateLimits,
} from './rate-limit';

/**
 * Starpeace Gateway Server
 * ------------------------
 * 1. Serves static UI files (index.html, client.js).
 * 2. Manages WebSocket connections.
 * 3. Binds each StarpeaceSession to its *current* WebSocket. A WORLD_CONNECTED session whose
 *    WebSocket closes is parked with none, and a new WebSocket can re-attach it with a token
 *    (see doc/architecture-overview.md § Session parking).
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
    WsMessageType.REQ_RESUME_SESSION,
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
  WsMessageType.REQ_UPDATE_CAMERA,
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
// Maps key → full path on disk: update-server files by lowercase basename,
// game-server files by their `gs1-<hash>` name
const imageFileIndex = new Map<string, string>();
let webclientCacheSweeper: { stop(): void } | null = null;

/**
 * Build in-memory index of all image files in cache directories.
 * Called once at startup and after downloading new files.
 */
async function buildImageFileIndex(): Promise<void> {
  // Build into a temporary map, then swap atomically to avoid serving 404s during rebuild
  const newIndex = await buildImageFileIndexEntries(getCacheDir(), WEBCLIENT_CACHE_DIR);

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
  allowedHosts: proxyImageHosts,
};

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/**
 * Extract client IP; behind the trusted reverse proxy, the rightmost X-Forwarded-For entry.
 */
function getClientIp(req: { headers: http.IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  return resolveClientIp(req.headers, req.socket.remoteAddress, TRUST_PROXY);
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
function setSecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(req.headers.host, config.cdn.url));
  if (process.env.ENABLE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}

// The per-IP ceilings and the limiter live in rate-limit.ts; sweep expired entries every 5 minutes.
setInterval(() => sweepExpiredRateLimits(), 300_000);

const GATEWAY_VERSION = readGatewayVersion();

/** The /api/metrics object — also the payload of the periodic METRICS log line. */
function collectMetrics(): GatewayMetrics {
  return buildMetrics({
    version: GATEWAY_VERSION,
    startedAtMs: PROCESS_STARTED_AT_MS,
    now: Date.now(),
    memory: process.memoryUsage(),
    websocketsOpen: wss.clients.size,
    sessions: sessionRegistry.snapshot(),
    directory: directoryProbe.getState(),
    clientErrors: getClientErrorCounts(),
  });
}

/** Answers 403 to anything but a direct loopback request; true when it refused. */
function refuseNonLocal(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (isLocalOnlyRequest(req)) return false;
  res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('Forbidden');
  return true;
}

// 1. HTTP Server for Static Files + Image Proxy
const server = http.createServer(async (req, res) => {
  setSecurityHeaders(req, res);
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
      bugReportPlayerMode: config.server.bugReportPlayerMode,
      registerUrl: config.server.registerUrl,
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

  // Public health check — served from the cached directory probe; never dials Delphi.
  // The gateway's start state is in the body only, it never sets the status.
  if (safePath === '/api/health') {
    const { statusCode, body } = buildHealth(directoryProbe.getState(), serviceRegistry.isInitialized(), Date.now());
    res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return;
  }

  // Runtime metrics — local-only (loopback peer and no X-Forwarded-For).
  if (safePath === '/api/metrics') {
    if (refuseNonLocal(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(collectMetrics()));
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
    if (refuseNonLocal(req, res)) return;
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
    if (refuseNonLocal(req, res)) return;
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

  // Bug report deposit: POST /api/bug-report — 404 unless SPO_BUG_REPORT is true or player;
  // 403 without a logged-in session's ticket.
  // Everything, transport included, lives in bug-report-endpoint.ts, which tests can import.
  // checkRateLimit's window is fixed at RATE_LIMIT_WINDOW_MS (60 s) — this is 10 per minute.
  if (safePath === '/api/bug-report' && req.method === 'POST') {
    handleBugReportRequest(req, res, {
      enabled: config.server.bugReportMode,
      queueDir: config.server.reportsDir || DEFAULT_QUEUE_DIR,
      allowRequest: () => checkRateLimit(getClientIp(req), 'bug-report', 10),
      tickets: reportTickets,
      warn: (message) => logger.warn(message),
    });
    return;
  }

  // Browser error report: POST /api/client-error — anonymous by design (no session, no identity
  // field; a closed field list and two rate limits keep it safe). Everything lives in
  // client-error-endpoint.ts, which tests can import. 20/min per IP (checkRateLimit's 60 s window)
  // plus a 60/min gateway-wide cap inside the module.
  if (safePath === '/api/client-error' && req.method === 'POST') {
    handleClientErrorRequest(req, res, {
      allowRequest: () => checkRateLimit(getClientIp(req), 'client-error', CLIENT_ERROR_MAX_PER_IP),
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
      // the /cdn/ proxy when CHUNK_CDN_URL is overridden, or a registration URL is configured.
      // Uses an external script (CSP-compliant) instead of inline script.
      // In Docker/default mode, config.cdn.url is the default and no injection occurs.
      if (config.cdn.url !== 'https://spo.zz.works' || config.server.forceWorld || config.server.bugReportMode || config.server.registerUrl) {
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
const WS_MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB max message size (policy SEC-W-2)

const wss = new WebSocketServer({
  noServer: true,
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

/**
 * Mount the gateway's WebSocket upgrade wiring on an http.Server — the module server at load, a
 * test's own server in the harness. Same code `ws` installs itself for its `server` option;
 * `verifyClient` still runs inside `handleUpgrade`.
 */
export function mountWebSocketGateway(target: http.Server): void {
  target.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
mountWebSocketGateway(server);

// Bug-report tickets: one cookie per WebSocket upgrade ties a report deposit to its session.
const reportTickets = new ReportTicketRegistry();
if (config.server.bugReportMode) reportTickets.listenForUpgrades(wss, TRUST_PROXY);

let stopWsHeartbeat: () => void = () => undefined;
/**
 * Start the dead-socket heartbeat on this gateway's sockets (policy SEC-W-7), stopping any
 * running one first. The interval parameter is the test seam; production uses the default.
 */
export function startWsHeartbeat(intervalMs: number = WS_HEARTBEAT_INTERVAL_MS): () => void {
  stopWsHeartbeat();
  stopWsHeartbeat = startHeartbeat(wss, intervalMs);
  return stopWsHeartbeat;
}
startWsHeartbeat();

/** Read-only view of the per-IP WebSocket count (SEC-W-3) — for tests. */
export function getWsConnectionCount(ip: string): number {
  return wsConnectionsPerIp.get(ip) ?? 0;
}

// GM Chat: track all connected WebSocket clients and their usernames
const connectedClients = new Map<WebSocket, string>(); // ws → username
/** Every live connection's teardown — drained by the shutdown sequence. */
export const connectionDrain = new ConnectionDrain();
const GM_USERNAMES = new Set((process.env.SPO_GM_USERS || '').split(',').map(s => s.trim()).filter(Boolean));

/** Give back one per-IP WebSocket slot (SEC-W-3). */
function releaseWsSlot(ip: string): void {
  const count = wsConnectionsPerIp.get(ip) || 0;
  if (count <= 1) {
    wsConnectionsPerIp.delete(ip);
  } else {
    wsConnectionsPerIp.set(ip, count - 1);
  }
}

interface LoginCredentials {
  username: string;
  worldName: string;
  worldInfo: WorldInfo | undefined;
  companyId: string;
}

/**
 * Everything that belongs to one gateway session rather than to one WebSocket — the unit a
 * resume moves from a dead connection to a new one (doc/architecture-overview.md § Session parking).
 */
interface GatewaySessionHandle {
  session: StarpeaceSession;
  /** endSession() then destroy(), memoized — shared by close, drain, expiry and eviction. */
  teardown: () => Promise<void>;
  /** The session's current WebSocket (none while parked) and its replay FIFO. */
  binding: SessionBinding<WebSocket>;
  searchMenuService: SearchMenuService | null;
  loginCredentials: LoginCredentials | null;
  /** Resume registry entry — set once the world is entered. */
  entry: ResumeEntry | null;
  /** The WebSocket the shutdown drain tracks this session under. */
  trackedWs: WebSocket;
  ending: Promise<void> | null;
}

/** Every token-holding session, attached or parked. */
const parkRegistry = new SessionParkRegistry<GatewaySessionHandle>({
  parkMs: readParkMs(process.env),
  maxParked: readMaxParked(process.env),
  onExpire: h => void endParkedSession(h, 'expired'),
});

/**
 * End a parked session for good: its park expired, a fresh login of the same user evicts it,
 * or the gateway shuts down. Same teardown as a closing session — `ClientNotAware`, `Logoff`,
 * then `destroy()`. Runs once however many callers await it.
 */
function endParkedSession(h: GatewaySessionHandle, reason: 'expired' | 'evicted' | 'shutdown'): Promise<void> {
  if (!h.ending) {
    h.ending = (async () => {
      const ip = h.entry ? parkRegistry.end(h.entry) : null;
      h.entry = null;
      if (ip !== null) releaseWsSlot(ip);
      h.session.log.info('SESSION_END', {
        reason,
        player: h.loginCredentials?.username ?? 'unknown',
        durationMs: String(Date.now() - h.session.startedAt),
        phase: String(h.session.getPhase()),
      });
      await h.teardown();
      sessionRegistry.remove(h.session);
      connectionDrain.untrack(h.trackedWs);
    })();
  }
  return h.ending;
}

/** End every parked session of this username and wait for each Logoff (acknowledged or timed out). */
async function evictParkedSessions(username: string): Promise<void> {
  await Promise.all(parkRegistry.parkedFor(username).map(h => endParkedSession(h, 'evicted')));
}

/** How many sessions are parked right now — for tests. */
export function getParkedSessionCount(): number {
  return parkRegistry.parkedCount();
}

/** A new session for a new WebSocket, its events routed through a movable binding. */
function createSessionHandle(ws: WebSocket, clientIp: string): GatewaySessionHandle {
  const session = new StarpeaceSession();
  session.log.info('SESSION_START', { ip: clientIp });
  sessionRegistry.add(session);

  // One teardown per session, shared by the close handler, the shutdown drain and the park
  const teardown = createSessionTeardown(session, (err) =>
    logger.error(`Error sending Logoff on close: ${toErrorMessage(err)}`),
  );
  connectionDrain.track(ws, teardown);

  const binding = new SessionBinding<WebSocket>(ws);
  // -- Forward Events: Gateway -> Browser (the session's current WebSocket) --
  session.on('ws_event', (payload: WsMessage) => binding.deliver(payload));
  // -- World socket reconnection notifications --
  session.on('worldReconnected', () => binding.deliver({ type: WsMessageType.EVENT_WORLD_RECONNECTED }));
  session.on('worldDisconnected', () => binding.deliver({ type: WsMessageType.EVENT_WORLD_DISCONNECTED }));

  return {
    session,
    teardown,
    binding,
    searchMenuService: null,
    loginCredentials: null,
    entry: null,
    trackedWs: ws,
    ending: null,
  };
}

function sendIfOpen(ws: WebSocket, payload: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const clientIp = getClientIp(req);
  logger.info('Client connected', { ip: clientIp });

  // A dedicated Starpeace Session for this connection — replaced by a parked one on resume
  const freshHandle = createSessionHandle(ws, clientIp);
  let handle = freshHandle;
  const reportTicket = reportTickets.bindConnection(req, freshHandle.session);
  // A REQ_LOGOUT was received: this connection's close never parks
  let logoutRequested = false;
  // Messages processed so far: a resume is only valid as the first one
  let processedCount = 0;

  // -- Handle Requests: Browser -> Gateway --
  // Two-lane queue: stateless messages (camera updates) execute immediately,
  // everything else is serialized through an RDO queue to prevent concurrent
  // Delphi temp-object access (see: building switch race condition).
  const FAST_LANE: ReadonlySet<string> = new Set([
    WsMessageType.REQ_UPDATE_CAMERA,
  ]);
  let rdoQueue: Promise<void> = Promise.resolve();

  // Per-socket message guard (SEC-W-6): rate bucket + RDO-queue depth, in every mode.
  const messageGuard = new WsMessageGuard({
    ratePerSecond: WS_MESSAGE_RATE_PER_SECOND,
    burst: WS_MESSAGE_BURST,
    maxQueued: WS_MAX_QUEUED_MESSAGES,
  });
  let closedByGuard = false;
  function closeByGuard(reason: string): void {
    closedByGuard = true;
    logger.warn(`[Gateway] WebSocket closed by message guard: ${reason}`, {
      ip: clientIp,
      reason,
      player: connectedClients.get(ws) ?? 'unknown',
    });
    ws.close(WS_GUARD_CLOSE_CODE, reason);
  }

  /** Process a single WS message. Must be serialized for RDO-touching messages. */
  async function processMessage(data: string): Promise<void> {
    // Guard close: nothing already queued (or in the close handshake) reaches a handler
    if (closedByGuard) return;
    processedCount++;
    const h = handle;
    try {
      const msg: WsMessage = JSON.parse(data.toString());

      // Capture login credentials for SearchMenuService
      if (msg.type === WsMessageType.REQ_LOGIN_WORLD) {
        // A new identity gets a new token once its world is entered
        if (h.entry) {
          parkRegistry.end(h.entry);
          h.entry = null;
        }
        const loginMsg = msg as WsReqLoginWorld;
        const worldInfo = h.session.getWorldInfo(loginMsg.worldName);
        h.loginCredentials = {
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
        if (h.loginCredentials) {
          h.loginCredentials.companyId = companyMsg.companyId;
        }
      } else if (msg.type === WsMessageType.REQ_SWITCH_COMPANY) {
        const switchMsg = msg as WsReqSwitchCompany;
        if (h.loginCredentials) {
          h.loginCredentials.companyId = switchMsg.company.id;
        }
      }

      // Correlation ID: trace this WS request through all RDO calls
      const corrId = `ws-${Date.now()}-${msg.wsRequestId || 'noid'}`;
      h.session.setCorrelationId(corrId);
      const isQuietMsg = QUIET_WS_TYPES.has(msg.type);
      if (!isQuietMsg) h.session.log.info(`WS>> ${msg.type}`, { wsRequestId: msg.wsRequestId });

      await handleClientMessage(ws, h.session, h.searchMenuService, msg, clientIp, {
        resumeSession,
        evictParkedSession: evictParkedSessions,
        onWorldLogin: (username, worldName) => reportTickets.recordWorldLogin(reportTicket, { username, world: worldName }),
      });
      h.session.setCorrelationId(null);

      const isCompanySelection = msg.type === WsMessageType.REQ_SELECT_COMPANY || msg.type === WsMessageType.REQ_SWITCH_COMPANY;

      // World entered: issue a resume token (session-park.ts), rotated on every company change
      if (isCompanySelection && h.loginCredentials && h.session.getPhase() === SessionPhase.WORLD_CONNECTED) {
        h.entry ??= parkRegistry.register(h.loginCredentials.username, h);
        const tokenEvent: WsEventSessionResumeToken = {
          type: WsMessageType.EVENT_SESSION_RESUME_TOKEN,
          token: parkRegistry.issueToken(h.entry),
        };
        sendIfOpen(ws, tokenEvent);
      }

      // Initialize SearchMenuService after successful login response
      if (isCompanySelection && !h.searchMenuService && h.loginCredentials && h.loginCredentials.worldInfo) {
        setTimeout(() => {
          const creds = h.loginCredentials;
          if (creds && creds.worldInfo) {
            const daAddr = h.session.getDAAddr();
            const daPort = h.session.getDAPort();

            if (daAddr && daPort) {
              const searchMenuService = new SearchMenuService(
                creds.worldInfo.ip,
                creds.worldInfo.port || 80,
                creds.worldName,
                creds.username,
                creds.companyId, // Using companyId as companyName for now
                daAddr, // Use real DAAddr from session
                daPort, // the InterfaceServer's DALockPort, as Voyager sends it
                h.session.languageId
              );
              h.searchMenuService = searchMenuService;
              logger.info(`SearchMenuService initialized with DAAddr: ${daAddr}:${daPort}`);

              // Fetch Capitol coordinates from DirectoryMain.asp and push to client.
              // Answers even on a rejection — see capitol-coords.ts.
              void pushCapitolCoords(searchMenuService, ws, h.session);
            } else {
              logger.error('Failed to initialize SearchMenuService: DAAddr or DAPort not available');
            }
          }
        }, 500);
      }
    } catch (err: unknown) {
      // A JSON.parse message can quote the input — never for a request that carries a token
      const error = data.toString().includes(WsMessageType.REQ_RESUME_SESSION)
        ? 'unparseable resume request'
        : toErrorMessage(err);
      h.session.log.error('WS<< PARSE_ERROR', { error });
      h.session.setCorrelationId(null);
      const errorResp: WsRespError = {
        type: WsMessageType.RESP_ERROR,
        errorMessage: 'Invalid Message Format',
        code: ErrorCodes.ERROR_InvalidParameter
      };
      ws.send(JSON.stringify(errorResp));
    }
  }

  /**
   * Re-attach a parked session to this WebSocket (REQ_RESUME_SESSION, first message only).
   * Every refusal answers the same and leaves the parked session untouched.
   */
  async function resumeSession(req: WsReqResumeSession): Promise<void> {
    const refuse = (): void => {
      const errorResp: WsRespError = {
        type: WsMessageType.RESP_ERROR,
        wsRequestId: req.wsRequestId,
        errorMessage: RESUME_REFUSED_MESSAGE,
        code: RESUME_REFUSED_CODE,
      };
      sendIfOpen(ws, errorResp);
    };
    if (processedCount !== 1 || handle !== freshHandle || handle.session.getPhase() !== SessionPhase.DISCONNECTED) {
      refuse();
      return;
    }
    const claimed = parkRegistry.claim(req.username, req.token);
    if (!claimed) {
      logger.warn('[Gateway] Session resume refused', { ip: clientIp });
      refuse();
      return;
    }
    const target = claimed.value;

    // Retire this connection's empty session
    sessionRegistry.remove(freshHandle.session);
    freshHandle.session.destroy();
    connectionDrain.untrack(ws);

    // Bind the parked session to this WebSocket; a still-open previous one is half-open
    const previous = target.binding.current;
    target.binding.attach(ws);
    handle = target;
    connectionDrain.untrack(target.trackedWs);
    target.trackedWs = ws;
    connectionDrain.track(ws, target.teardown);
    // The parked slot moves to this socket's IP: this socket already holds the one verifyClient gave it
    if (claimed.parkIp !== null) releaseWsSlot(claimed.parkIp);
    if (previous && previous !== ws && previous.readyState !== WebSocket.CLOSED) previous.terminate();

    const username = target.loginCredentials?.username ?? req.username;
    connectedClients.set(ws, username);
    target.session.log.info('SESSION_RESUME', { ip: clientIp, player: username });

    const response: WsRespResumeSession = {
      type: WsMessageType.RESP_RESUME_SESSION,
      wsRequestId: req.wsRequestId,
      ...buildResumeSnapshot(username, target.session),
    };
    sendIfOpen(ws, response);
    for (const event of target.binding.takeBuffered()) sendIfOpen(ws, event);
    if (target.entry) {
      const tokenEvent: WsEventSessionResumeToken = {
        type: WsMessageType.EVENT_SESSION_RESUME_TOKEN,
        token: parkRegistry.issueToken(target.entry),
      };
      sendIfOpen(ws, tokenEvent);
    }
  }

  ws.on('message', (data: string) => {
    // Message guard first, before the lane is chosen: every message costs a token (SEC-W-6)
    if (closedByGuard) return;
    if (!messageGuard.takeToken()) {
      closeByGuard(WS_RATE_EXCEEDED_REASON);
      return;
    }

    // Shutdown drain started: no message reaches a handler any more
    if (connectionDrain.isDraining()) return;

    // Peek at message type to decide lane (lightweight JSON key extraction)
    let msgType: string | undefined;
    try {
      const typeMatch = data.toString().match(/"type"\s*:\s*"([^"]+)"/);
      msgType = typeMatch?.[1];
    } catch { /* fall through to RDO lane */ }
    if (msgType === WsMessageType.REQ_LOGOUT) logoutRequested = true;

    if (msgType && FAST_LANE.has(msgType)) {
      // Fast lane: execute immediately, no serialization needed
      processMessage(data).catch((err: unknown) => {
        handle.session.log.error('Fast-lane message error', { error: toErrorMessage(err) });
      });
    } else {
      // RDO lane: serialize to prevent concurrent Delphi temp-object access
      if (!messageGuard.enqueue()) {
        closeByGuard(WS_QUEUE_EXCEEDED_REASON);
        return;
      }
      rdoQueue = rdoQueue.then(async () => {
        try {
          await processMessage(data);
        } finally {
          messageGuard.settle();
        }
      }).catch((err: unknown) => {
        handle.session.log.error('RDO queue message error', { error: toErrorMessage(err) });
      });
    }
  });

  ws.on('close', async () => {
    const h = handle;
    const player = connectedClients.get(ws) ?? 'unknown';
    connectedClients.delete(ws);
    reportTickets.revoke(reportTicket);

    // A resume moved the session to another WebSocket: this one only gives back its slot
    if (h.binding.current !== ws) {
      releaseWsSlot(clientIp);
      connectionDrain.untrack(ws);
      return;
    }
    h.binding.detach();

    // Park a WORLD_CONNECTED session instead of ending it — unless logout, shutdown or the cap.
    // Nothing is sent upstream: to the world it stays a connected, idle player. The IP slot is kept.
    if (
      !connectionDrain.isDraining() &&
      !logoutRequested &&
      h.session.getPhase() === SessionPhase.WORLD_CONNECTED &&
      h.entry !== null &&
      parkRegistry.park(h.entry, clientIp)
    ) {
      connectionDrain.track(ws, () => endParkedSession(h, 'shutdown'));
      h.session.log.info('SESSION_PARK', { ip: clientIp, player, parkMs: String(parkRegistry.parkMs) });
      return;
    }

    const durationMs = Date.now() - h.session.startedAt;
    h.session.log.info('SESSION_END', {
      ip: clientIp,
      player,
      durationMs: String(durationMs),
      phase: String(h.session.getPhase()),
    });
    releaseWsSlot(clientIp);
    if (h.entry) {
      parkRegistry.end(h.entry);
      h.entry = null;
    }
    // Send Logoff before cleanup to gracefully close the game server session.
    // endSession() ends the world socket itself once Logoff is acknowledged or times out (5 s);
    // destroy() runs only after it settles. The teardown is shared with the shutdown drain,
    // so it runs once however many callers await it.
    await h.teardown();
    sessionRegistry.remove(h.session);
    connectionDrain.untrack(ws);
  });
});

/**
 * Message Router — dispatches to handler modules in ws-handlers/
 */
async function handleClientMessage(
  ws: WebSocket,
  session: StarpeaceSession,
  searchMenuService: SearchMenuService | null,
  msg: WsMessage,
  clientIp: string,
  extras: Pick<WsHandlerContext, 'resumeSession' | 'evictParkedSession' | 'onWorldLogin'> = {},
) {
  // Rate limit authentication attempts — one per-IP bucket per auth-bearing message type,
  // and one for the resume token, which is a credential too
  const authLimited =
    !checkAuthRateLimit(clientIp, msg.type) ||
    (msg.type === WsMessageType.REQ_RESUME_SESSION && !checkResumeRateLimit(clientIp));
  if (!SINGLE_USER_MODE && authLimited) {
    const errorResp: WsRespError = {
      type: WsMessageType.RESP_ERROR,
      wsRequestId: msg.wsRequestId,
      errorMessage: 'Too many authentication attempts. Please try again later.',
      code: ErrorCodes.ERROR_Unknown
    };
    ws.send(JSON.stringify(errorResp));
    return;
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
      { ws, session, searchMenuService, facilityDimensionsCache, inventionIndex, connectedClients, gmUsernames: GM_USERNAMES, ...extras },
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

  // Directory reachability probe and the METRICS log line — both unref()'d timers.
  directoryProbe.start();
  startMetricsLog(collectMetrics, createLogger('Metrics'));

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

  webclientCacheSweeper?.stop();
  webclientCacheSweeper = startWebclientCacheSweeper(async () => {
    const r = await sweepWebclientCache(WEBCLIENT_CACHE_DIR, imageFileIndex);
    logger.info(`Image cache sweep: deleted ${r.deletedFiles} files (${r.deletedBytes} bytes), ${r.remainingFiles} files (${r.remainingBytes} bytes) remain`);
  }, WEBCLIENT_CACHE_SWEEP_INTERVAL_MS, (err: unknown) => logger.warn(`Image cache sweep failed: ${toErrorMessage(err)}`));

  logger.info(`Server ready at http://${HOST}:${PORT}`);

  return { server, port: PORT };
}

/**
 * Wire the one shutdown sequence: SIGTERM, the first SIGINT and `uncaughtException` all run it.
 */
export function installGatewayShutdown(target: http.Server): void {
  setupGracefulShutdown(
    createShutdownSequence({
      server: target,
      stopHeartbeat: () => stopWsHeartbeat(),
      drain: connectionDrain,
      registry: { shutdown: () => { webclientCacheSweeper?.stop(); return serviceRegistry.shutdown(); } },
      closeLogTransports,
      exit: (code) => process.exit(code),
      log: logger,
    }),
    target,
  );
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
    installGatewayShutdown(gateway.server);
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
