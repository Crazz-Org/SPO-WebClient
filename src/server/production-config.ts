/**
 * Startup validation of the production configuration — policy SEC-R-2.
 *
 * The security policy states requirements about how the gateway must be *run*
 * (`doc/production-security-policy.md`), but until now nothing read them back: a
 * production start with no `.env`, or with a line commented out, was accepted in
 * silence. `LOG_LEVEL=debug` in particular leaks session identifiers into the logs
 * (SEC-L-2), so that combination is refused outright rather than warned about.
 *
 * Three things happen here, all of them at boot and only once:
 *
 * 1. **Fail fast** on a forbidden combination — `NODE_ENV=production` together with
 *    `LOG_LEVEL=debug`. The gateway refuses to start.
 * 2. **Warn** when a production-only safety net is left unset (`TRUST_PROXY`,
 *    `ENABLE_HSTS`) — those are choices, not mistakes, so they do not block a start.
 * 3. **Report** the effective security configuration, so the running values are in
 *    the log rather than inferred from whichever `.env` someone believes is loaded.
 *
 * The two checks are pure functions over an environment map: no `process.env` read
 * happens in this module, which is what makes both paths testable without touching
 * the real process.
 */

/** The knobs the readout names — read from the running server, not from the environment. */
export interface SecurityRuntimeValues {
  /** `X-Forwarded-For` is honoured only when this is on (SEC-H-7). */
  trustProxy: boolean;
  /** `Strict-Transport-Security` is emitted only when this is on (SEC-T-3, in SPO-Deploy's policy — transport moved there). */
  hstsEnabled: boolean;
  /** Rate-limit window, in milliseconds. */
  rateLimitWindowMs: number;
  /** Auth attempts allowed per window per IP. */
  rateLimitMaxAuth: number;
  /** Proxy-image requests allowed per window per IP. */
  rateLimitMaxProxy: number;
  /** Concurrent WebSocket connections allowed per IP (SEC-W-3). */
  wsMaxConnectionsPerIp: number;
  /** WebSocket frame ceiling, in bytes (SEC-W-2). */
  wsMaxPayloadBytes: number;
  /** Relaxes the checks that only make sense for a shared deployment. */
  singleUserMode: boolean;
}

/** What the startup check concluded. `errors` non-empty means the gateway must not start. */
export interface ProductionConfigVerdict {
  /** True when `NODE_ENV=production` — the only mode the rules apply in. */
  production: boolean;
  /** Forbidden combinations. Any entry here is fatal. */
  errors: string[];
  /** Settings left unset that a production deployment normally wants. */
  warnings: string[];
}

/** A minimal view of `process.env` — everything here works off a plain map. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Judge the environment the gateway was started with.
 *
 * `effectiveLogLevel` is the level the logger actually resolved (`config.logging.level`),
 * not the raw variable: a deployment that never sets `LOG_LEVEL` inherits the `info`
 * default and is compliant, so only an explicit `debug` is a violation.
 */
export function checkProductionConfig(env: EnvLike, effectiveLogLevel: string): ProductionConfigVerdict {
  const production = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!production) {
    return { production, errors, warnings };
  }

  if (effectiveLogLevel.toLowerCase() === 'debug') {
    errors.push(
      'LOG_LEVEL=debug is forbidden in production — session identifiers leak at debug level ' +
        '(policy SEC-L-2). Set LOG_LEVEL to info, warn or error.'
    );
  }

  if (env.TRUST_PROXY !== 'true') {
    warnings.push(
      'TRUST_PROXY is not set to true — behind a reverse proxy every client resolves to the ' +
        'proxy address, so per-IP rate limiting protects nobody (policy SEC-H-7).'
    );
  }

  if (env.ENABLE_HSTS !== 'true') {
    warnings.push(
      'ENABLE_HSTS is not set to true — no Strict-Transport-Security header is emitted. ' +
        'Set it when serving over HTTPS (SPO-Deploy policy SEC-T-3).'
    );
  }

  return { production, errors, warnings };
}

/**
 * The one-line-per-setting readout written at boot.
 * Returns lines rather than printing them so the caller owns the log level.
 */
export function buildSecurityReadout(values: SecurityRuntimeValues, env: EnvLike): string[] {
  const onOff = (flag: boolean): string => (flag ? 'on' : 'off');
  return [
    `[SEC-R-2] Effective security configuration:`,
    `  NODE_ENV            = ${env.NODE_ENV ?? '(unset)'}`,
    `  security headers    = on (nosniff, DENY, Referrer-Policy, Permissions-Policy, COOP, CSP)`,
    `  HSTS                = ${onOff(values.hstsEnabled)}`,
    `  trust proxy         = ${onOff(values.trustProxy)}`,
    `  single-user mode    = ${onOff(values.singleUserMode)}`,
    `  rate limit (auth)   = ${values.rateLimitMaxAuth} per ${values.rateLimitWindowMs} ms per IP`,
    `  rate limit (proxy)  = ${values.rateLimitMaxProxy} per ${values.rateLimitWindowMs} ms per IP`,
    `  WS connections/IP   = ${values.wsMaxConnectionsPerIp}`,
    `  WS max frame        = ${values.wsMaxPayloadBytes} bytes`,
  ];
}

/** The logger surface this module needs — narrow enough that a test can pass a recorder. */
export interface StartupLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Run the check, write the readout, and throw when the configuration is forbidden.
 *
 * Throwing is the fail-fast: `startGateway()` propagates it, `main()` logs it and exits 1,
 * so a production start on a leaking log level never reaches the listen call.
 */
export function enforceProductionConfig(
  env: EnvLike,
  effectiveLogLevel: string,
  values: SecurityRuntimeValues,
  logger: StartupLogger
): void {
  const verdict = checkProductionConfig(env, effectiveLogLevel);

  for (const line of buildSecurityReadout(values, env)) {
    logger.info(line);
  }
  for (const warning of verdict.warnings) {
    logger.warn(`[SEC-R-2] ${warning}`);
  }

  if (verdict.errors.length > 0) {
    for (const error of verdict.errors) {
      logger.error(`[SEC-R-2] ${error}`);
    }
    throw new Error(`Refusing to start: production configuration is invalid — ${verdict.errors.join(' ')}`);
  }
}
