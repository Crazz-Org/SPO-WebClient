/**
 * Configuration centralisée pour SPO v2
 *
 * Utilise les variables d'environnement avec des valeurs par défaut.
 * Permet de configurer facilement dev/prod et mock_srv.
 *
 * Browser-safe: Vérifie l'existence de process avant de l'utiliser.
 */

// Ambient declaration for Node.js process (browser-safe: guarded by typeof check)
declare const process: { env: Record<string, string | undefined> } | undefined;

// Helper pour accéder à process.env de manière sécurisée (browser-safe)
const getEnv = (key: string): string | undefined => {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
};

export const config = {
  /**
   * Configuration du serveur WebSocket
   */
  server: {
    port: Number(getEnv('PORT')) || 8080,
    host: getEnv('HOST') || '0.0.0.0',
    singleUserMode: getEnv('SINGLE_USER_MODE') === 'true',
    /** Force all players into a specific world (format: "zoneId/worldName", e.g. "free/planitia"). Temporary test-phase override. */
    forceWorld: (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SPO_FORCE_WORLD__ !== undefined)
      ? (window as unknown as Record<string, unknown>).__SPO_FORCE_WORLD__ as string
      : getEnv('SPO_FORCE_WORLD') ?? undefined,
    /** Dev-only: enables the in-app bug-report capture and the /api/bug-report deposit endpoint. */
    bugReportMode: (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SPO_BUG_REPORT__ !== undefined)
      ? (window as unknown as Record<string, unknown>).__SPO_BUG_REPORT__ === true
      : getEnv('SPO_BUG_REPORT') === 'true',
    /** Where deposited bug reports land — configurable so a container without a bind-mounted
     * home directory can still point it at a durable, mounted path. Server-side only: never
     * read from `window`, unlike bugReportMode/forceWorld above. */
    /** Where "Create an account" on the sign-in screen sends a new player. Empty (the default)
     * renders no action at all — the legacy client's hardcoded SEGA sign-up page is gone
     * (LogonHandlerViewer.pas:937). Server-side read; the browser gets it through
     * /spo-runtime-config.js as `window.__SPO_REGISTER_URL__`, read by AuthStage per render. */
    registerUrl: getEnv('SPO_REGISTER_URL') || '',
    reportsDir: getEnv('SPO_REPORTS_DIR') || undefined,
    /** Bearer token gating GET/POST /api/report-pull/* (see report-pull-endpoint.ts). Unset or
     * under 32 chars disables the whole surface — every route answers 404. Server-side only,
     * and deliberately never exposed via /spo-runtime-config.js's window globals. */
    reportPullToken: getEnv('SPO_REPORT_PULL_TOKEN') || null,
  },

  /**
   * Configuration du protocole RDO
   */
  rdo: {
    // Host du serveur Directory (utiliser 'localhost' pour mock_srv et www.starpeaceonline.com pour la production.)
    directoryHost: getEnv('RDO_DIR_HOST') || 'www.starpeaceonline.com',

    // Ports standards du protocole
    ports: {
      directory: 1111,
    },

    /**
     * Send the two independent viewport reads (ObjectsInArea + SegmentsInArea)
     * concurrently over the world connection pool instead of sequentially.
     * Same wire frames, same count — only the overlap in time changes; each
     * request still goes through sendRdoRequest() (ServerBusy buffering,
     * timeouts, retry). Saves one ~100ms RTT per map refresh.
     * Opt-in while under live validation: RDO_PARALLEL_AREA_READS=true
     */
    parallelAreaReads: getEnv('RDO_PARALLEL_AREA_READS') === 'true',

    /**
     * Populate the world connection pool.
     *
     * The pool was dead code: `initialize()` was called nowhere, and the only
     * other path that adds a connection sits behind a `size > 0` guard, so it
     * could never hold one (audit O-M1). Everything went down the primary
     * socket — including `parallelAreaReads`, which pipelined onto a single
     * wire. The documented session-lifecycle design described a behaviour the
     * code did not have.
     *
     * The chicken-and-egg is fixed and O-L1 (answering a server request on the
     * connection that asked) is fixed with it, so populating is now correct.
     * The socket factory the test harness needed exists (`PoolSocketFactory`),
     * and `world-pool.validation.test.ts` exercises a populated pool, so the
     * path is no longer untested.
     *
     * OFF by default — decided 2026-08-16 on conformity grounds, after checking
     * what the reference client actually does. See the CONFORMITY note below;
     * the machinery is correct and tested, it is the *policy* that is off.
     *
     * TWO ordering rules make it safe when enabled, both proven by that suite:
     * - the pool is populated only AFTER the session is bound to the primary
     *   socket (`populateWorldPool()`, called past RegisterEventsById), because
     *   `get RDOCnntId` is answered with the id of the CARRYING connection
     *   (RDOQueryServer.pas:269-274) and that id binds the server-side
     *   TClientView's push channel and teardown trigger
     *   (InterfaceServer.pas:1919-1923);
     * - `CONNECTION_BOUND_MEMBERS` keeps that read on the primary socket even if
     *   the ordering is ever broken again.
     *
     * CONFORMITY — why it is off. The reference client has NO connection
     * concurrency to the Interface Server at all. Established 2026-08-16 by
     * exhaustive sweep of `Voyager/`, not by sampling:
     *
     * - All 11 `.Server :=` assignments under Voyager/ were enumerated. Exactly
     *   two target the IS (`ServerCnxHandler.pas:1034` and `:2737`) and both
     *   assign the SAME single field `fISCnx`; the second calls
     *   `fISProxy.Logoff()` first, so it is the reconnect path, not a second
     *   connection. The fields are singular — `fISCnx : IRDOConnectionInit`,
     *   `fWSISCnx : TWinSockRDOConnection` (`:184-185`). No array, no collection.
     *   The others go to Directory, Data Access/Model, Cache and Mail.
     * - Voyager does not multiplex on that one connection either. Its only
     *   concurrency knob, `WaitForAnswer`, just selects the timeout handed to
     *   `MarshalMethodCall`: `fTimeOut` when a reply is needed, `0` when it is
     *   not (`Rdo/Client/RDOObjectProxy.pas:441-443`, and `:459-461` for `set`).
     *   Calls serialise behind `TRDOObjectProxy.Lock` / `fDispLock`.
     * - Delphi's TRDOConnectionPool is the IS's pool of connections to the DATA
     *   ACCESS server (`InterfaceServer.pas:333, 2634, 2816`), never instantiated
     *   anywhere under Voyager/, and it allocates by OWNERSHIP — one connection
     *   bound to a ClientView for its lifetime (`InterfaceServer.pas:3230-3234`,
     *   observed live in the 2026-08-16 server logs), refcounted, not
     *   round-robin per request (`RDOConnectionPool.pas:78-120`).
     *
     * So a world pool is our own shape, with no precedent in the client we are
     * wire-compatible with, and it would put up to 6 connections per user on a
     * shared server. No known fact contradicts Voyager here, so Voyager wins.
     *
     * It also buys little: `parallelAreaReads` is the only caller that overlaps
     * requests, and it is opt-in too.
     *
     * RDO_WORLD_POOL=true to enable — everything behind it is tested and safe.
     */
    worldPool: getEnv('RDO_WORLD_POOL') === 'true',

    /**
     * What `sendRdoRequest()` does when the server answers `A<id> error N;`.
     *
     * Today the promise RESOLVES and `packet.errorCode` is read by nobody:
     * of the 93 call sites, none inspects it (audit P-M3). A refused mutation
     * is therefore indistinguishable from an applied one — M-B and M-E are two
     * instances of that, not two separate bugs.
     *
     * - `observe`: resolve as before, but emit one `RDO-CONTRACT` log line per
     *   error response. Changes no behaviour; the log IS the census.
     * - `reject-except-stale` (**default since 2026-08-16**): reject, except for
     *   `errIllegalObject` (2). See below.
     * - `reject`: reject on every non-recoverable code. The end state.
     *
     * INVARIANT, independent of the mode: the contract NEVER rejects a code that
     * `classifyRdoError` marks RECOVERABLE (8, 10, 11, 13, 14, 17). Those belong
     * to `executeWithRetry`, and rejecting one short-circuits its retry — the
     * promise settles before `result.errorCode` is ever inspected. Enforced in
     * `handleRdoErrorResponse`, pinned by test.
     *
     * Why `errIllegalObject` (2) is exempt at first: it is the only rejectable
     * code that occurs in NORMAL play — a stale ClientViewId after a session
     * expires, a building id demolished between read and write, a cacherId gone
     * after reconnect. Code that copes with it today would start throwing. The
     * other rejected codes (1, 3, 4, 5, 6, 7, 9, 12, 15, 16) are programming
     * errors that are currently swallowed, which is exactly what the flip is for.
     *
     * Set RDO_ERROR_CONTRACT=reject to include 2, or =observe to go back to
     * measuring.
     */
    errorContract: ((): 'observe' | 'reject-except-stale' | 'reject' => {
      const raw = getEnv('RDO_ERROR_CONTRACT');
      if (raw === 'observe' || raw === 'reject') return raw;
      return 'reject-except-stale';
    })(),
  },

  /**
   * Static asset CDN — official Cloudflare R2 CDN for terrain/object assets.
   * Override with CHUNK_CDN_URL env var if needed (e.g., local dev without CDN: set to '').
   */
  cdn: {
    url: (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SPO_CDN_URL__ !== undefined)
      ? (window as unknown as Record<string, unknown>).__SPO_CDN_URL__ as string
      : getEnv('CHUNK_CDN_URL') ?? 'https://spo.zz.works',
  },

  /**
   * Logging
   */
  logging: {
    // Niveaux: 'debug' | 'info' | 'warn' | 'error'
    // `info` is the floor the security policy sets (SEC-L-2): session identifiers appear in
    // debug lines, so a deployment that forgets to set LOG_LEVEL must not leak them. Ask for
    // `debug` explicitly when developing — and `NODE_ENV=production` refuses that combination
    // at startup (src/server/production-config.ts).
    level: getEnv('LOG_LEVEL') || 'info',
    colorize: getEnv('NODE_ENV') !== 'production',
    /** NDJSON structured output (LOG_JSON=true) */
    jsonMode: getEnv('LOG_JSON') === 'true',
    /** File path for NDJSON log output (e.g. 'logs/gateway.ndjson') */
    filePath: getEnv('LOG_FILE') || '',
    /** Max log file size in bytes before rotation (default 10MB) */
    maxFileSize: Number(getEnv('LOG_MAX_SIZE')) || 10 * 1024 * 1024,
    /** Max number of rotated log files to keep (default 5) */
    maxFiles: Number(getEnv('LOG_MAX_FILES')) || 5,
    /** Separate file for ERROR-level entries (e.g. 'logs/errors.ndjson') */
    errorFilePath: getEnv('LOG_ERROR_FILE') || '',
    /** Ring buffer size for error context (recent entries attached to errors) */
    ringBufferSize: Number(getEnv('LOG_RING_BUFFER_SIZE')) || 20,
  },
};

/**
 * Type-safe access to config
 */
export type Config = typeof config;
