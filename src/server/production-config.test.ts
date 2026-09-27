import {
  checkProductionConfig,
  buildSecurityReadout,
  enforceProductionConfig,
  type EnvLike,
  type SecurityRuntimeValues,
  type StartupLogger,
} from './production-config';

const RUNTIME: SecurityRuntimeValues = {
  trustProxy: true,
  hstsEnabled: true,
  rateLimitWindowMs: 60_000,
  rateLimitMaxAuth: 1000,
  rateLimitMaxProxy: 1000,
  wsMaxConnectionsPerIp: 1000,
  wsMaxPayloadBytes: 64 * 1024,
  singleUserMode: false,
};

/** A production environment with every safety net set — the compliant baseline. */
const PROD_ENV: EnvLike = {
  NODE_ENV: 'production',
  TRUST_PROXY: 'true',
  ENABLE_HSTS: 'true',
};

function recorder(): StartupLogger & { info: jest.Mock; warn: jest.Mock; error: jest.Mock } {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('checkProductionConfig', () => {
  it('says nothing outside production, even on a forbidden log level', () => {
    const verdict = checkProductionConfig({ NODE_ENV: 'development' }, 'debug');
    expect(verdict).toEqual({ production: false, errors: [], warnings: [] });
  });

  it('treats an absent NODE_ENV as not production', () => {
    const verdict = checkProductionConfig({}, 'debug');
    expect(verdict.production).toBe(false);
    expect(verdict.errors).toHaveLength(0);
    expect(verdict.warnings).toHaveLength(0);
  });

  it('accepts a fully configured production environment', () => {
    const verdict = checkProductionConfig(PROD_ENV, 'info');
    expect(verdict).toEqual({ production: true, errors: [], warnings: [] });
  });

  it('rejects LOG_LEVEL=debug in production', () => {
    const verdict = checkProductionConfig(PROD_ENV, 'debug');
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toContain('LOG_LEVEL=debug is forbidden in production');
    expect(verdict.errors[0]).toContain('SEC-L-2');
  });

  it('rejects a debug level whatever its casing', () => {
    expect(checkProductionConfig(PROD_ENV, 'DEBUG').errors).toHaveLength(1);
  });

  it.each(['info', 'warn', 'error'])('accepts LOG_LEVEL=%s in production', level => {
    expect(checkProductionConfig(PROD_ENV, level).errors).toHaveLength(0);
  });

  it('warns when TRUST_PROXY is unset, without blocking the start', () => {
    const verdict = checkProductionConfig({ NODE_ENV: 'production', ENABLE_HSTS: 'true' }, 'info');
    expect(verdict.errors).toHaveLength(0);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('TRUST_PROXY');
  });

  it('warns when ENABLE_HSTS is unset, without blocking the start', () => {
    const verdict = checkProductionConfig({ NODE_ENV: 'production', TRUST_PROXY: 'true' }, 'info');
    expect(verdict.errors).toHaveLength(0);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('ENABLE_HSTS');
  });

  it('warns on a value that is not exactly "true"', () => {
    const verdict = checkProductionConfig(
      { NODE_ENV: 'production', TRUST_PROXY: 'yes', ENABLE_HSTS: '1' },
      'info'
    );
    expect(verdict.warnings).toHaveLength(2);
  });
});

describe('buildSecurityReadout', () => {
  it('names every knob the policy asks for', () => {
    const lines = buildSecurityReadout(RUNTIME, PROD_ENV).join('\n');
    expect(lines).toContain('NODE_ENV            = production');
    expect(lines).toContain('security headers    = on');
    expect(lines).toContain('HSTS                = on');
    expect(lines).toContain('trust proxy         = on');
    expect(lines).toContain('single-user mode    = off');
    expect(lines).toContain('rate limit (auth)   = 1000 per 60000 ms per IP');
    expect(lines).toContain('rate limit (proxy)  = 1000 per 60000 ms per IP');
    expect(lines).toContain('WS connections/IP   = 1000');
    expect(lines).toContain('WS max frame        = 65536 bytes');
  });

  it('reports the off state and an absent NODE_ENV', () => {
    const lines = buildSecurityReadout(
      { ...RUNTIME, trustProxy: false, hstsEnabled: false, singleUserMode: true },
      {}
    ).join('\n');
    expect(lines).toContain('NODE_ENV            = (unset)');
    expect(lines).toContain('HSTS                = off');
    expect(lines).toContain('trust proxy         = off');
    expect(lines).toContain('single-user mode    = on');
  });
});

describe('enforceProductionConfig', () => {
  it('logs the readout and returns when the configuration is valid', () => {
    const log = recorder();
    expect(() => enforceProductionConfig(PROD_ENV, 'info', RUNTIME, log)).not.toThrow();
    expect(log.info.mock.calls[0][0]).toContain('[SEC-R-2] Effective security configuration:');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('throws on a forbidden combination, after logging the reason', () => {
    const log = recorder();
    expect(() => enforceProductionConfig(PROD_ENV, 'debug', RUNTIME, log)).toThrow(
      /Refusing to start: production configuration is invalid/
    );
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain('LOG_LEVEL=debug is forbidden');
  });

  it('emits the readout even on the failing path, so the log shows what was refused', () => {
    const log = recorder();
    expect(() => enforceProductionConfig(PROD_ENV, 'debug', RUNTIME, log)).toThrow();
    expect(log.info).toHaveBeenCalled();
  });

  it('warns but starts when only the optional settings are missing', () => {
    const log = recorder();
    expect(() => enforceProductionConfig({ NODE_ENV: 'production' }, 'info', RUNTIME, log)).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0][0]).toContain('[SEC-R-2]');
  });

  it('still reports the configuration outside production', () => {
    const log = recorder();
    enforceProductionConfig({ NODE_ENV: 'development' }, 'debug', RUNTIME, log);
    expect(log.info).toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('single-user mode in production (SEC-W-1)', () => {
  it('refuses a production start in single-user mode, naming the policy row', () => {
    const verdict = checkProductionConfig(PROD_ENV, 'info', true);
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toContain('SINGLE_USER_MODE');
    expect(verdict.errors[0]).toContain('SEC-W-1');
  });

  it('accepts single-user mode outside production', () => {
    expect(checkProductionConfig({ NODE_ENV: 'development' }, 'info', true).errors).toHaveLength(0);
  });

  it('accepts a production start without single-user mode', () => {
    expect(checkProductionConfig(PROD_ENV, 'info', false).errors).toHaveLength(0);
  });

  it('reads the running value: enforceProductionConfig refuses singleUserMode=true', () => {
    const log = recorder();
    expect(() =>
      enforceProductionConfig(PROD_ENV, 'info', { ...RUNTIME, singleUserMode: true }, log)
    ).toThrow(/Refusing to start/);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain('SINGLE_USER_MODE');
    expect(log.error.mock.calls[0][0]).toContain('SEC-W-1');
  });
});
