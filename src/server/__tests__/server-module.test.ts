/**
 * The gateway module must load.
 *
 * `server.ts` is the one module the rest of the server hangs off, and nothing imported it
 * from a test until now — an import-time crash (a bad path, a service constructed too
 * early, a specifier Node resolves but Jest does not) would have surfaced only when the
 * gateway was started for real. Loading it here is the cheapest guard against that.
 *
 * Timers are faked around the import: the module arms a rate-limit sweep at load time, and
 * a real interval would keep the worker alive after the suite ends.
 */
import { describe, it, expect, afterEach } from '@jest/globals';

describe('server module', () => {
  it('loads, and exposes the gateway entry points', () => {
    jest.useFakeTimers();
    try {
      const mod = require('../server') as typeof import('../server');
      expect(typeof mod.startGateway).toBe('function');
      expect(typeof mod.getInventionIndex).toBe('function');
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

/**
 * The SEC-R-2 fail-fast, exercised through the real entry point rather than the pure
 * checker: what matters is that the refusal happens *before* the gateway touches a port
 * or a cache, so the whole module is loaded fresh with the forbidden environment and
 * `startGateway()` is expected to reject without any of that having run.
 *
 * `LOG_LEVEL` is read when `shared/config.ts` is first evaluated, which is why the module
 * registry is reset around each case instead of the config object being poked.
 */
describe('startGateway — production configuration (SEC-R-2)', () => {
  const KEYS = ['NODE_ENV', 'LOG_LEVEL', 'TRUST_PROXY', 'ENABLE_HSTS'] as const;
  const saved: Record<string, string | undefined> = {};
  for (const key of KEYS) saved[key] = process.env[key];

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetModules();
  });

  it('refuses to start on NODE_ENV=production with LOG_LEVEL=debug', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'debug';

    // The boot readout and the refusal both go to the console — silenced so the suite
    // output stays readable, restored below whatever the expectation does.
    const quiet = ['log', 'info', 'warn', 'error'].map(name =>
      jest.spyOn(console, name as 'log').mockImplementation(() => {})
    );
    try {
      const mod = require('../server') as typeof import('../server');
      await expect(mod.startGateway({ port: 0 })).rejects.toThrow(
        /Refusing to start: production configuration is invalid/
      );
    } finally {
      quiet.forEach(spy => spy.mockRestore());
    }
  });

  it('writes the boot record through the LOG_LEVEL bypass, not through plain info', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'debug';
    delete process.env.TRUST_PROXY;
    delete process.env.ENABLE_HSTS;

    // A recorder in place of the real logger: what matters is WHICH method server.ts
    // reaches for. `warn` and `error` are compliant production levels, so a readout sent
    // through plain `info` would be filtered away exactly where the policy needs it.
    const always = jest.fn();
    const plain = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    jest.doMock('../../shared/logger', () => {
      const actual = jest.requireActual('../../shared/logger') as typeof import('../../shared/logger');
      return { ...actual, createLogger: () => ({ ...plain, always, child: () => ({ ...plain, always }) }) };
    });

    try {
      const mod = require('../server') as typeof import('../server');
      await expect(mod.startGateway({ port: 0 })).rejects.toThrow(/Refusing to start/);

      const { LogLevel } = require('../../shared/logger') as typeof import('../../shared/logger');
      const written = always.mock.calls.map(call => `${call[0]}|${call[1]}`).join('\n');
      expect(written).toContain(`${LogLevel.INFO}|[SEC-R-2] Effective security configuration:`);
      expect(written).toContain(`${LogLevel.WARN}|[SEC-R-2] TRUST_PROXY`);
      expect(written).toContain(`${LogLevel.WARN}|[SEC-R-2] ENABLE_HSTS`);
      expect(written).toContain(`${LogLevel.ERROR}|[SEC-R-2] LOG_LEVEL=debug is forbidden`);
      expect(plain.info).not.toHaveBeenCalled();
    } finally {
      jest.dontMock('../../shared/logger');
    }
  });
});

/**
 * SPO_MAX_SESSIONS (SEC-W-3, #1074): an invalid value stops the gateway before anything binds
 * a port — the same fail-fast as the production configuration above.
 */
describe('startGateway — SPO_MAX_SESSIONS', () => {
  const savedMax = process.env.SPO_MAX_SESSIONS;

  afterEach(() => {
    if (savedMax === undefined) delete process.env.SPO_MAX_SESSIONS;
    else process.env.SPO_MAX_SESSIONS = savedMax;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetModules();
  });

  it('refuses to start on SPO_MAX_SESSIONS=0, naming the variable', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    process.env.SPO_MAX_SESSIONS = '0';
    const quiet = ['log', 'info', 'warn', 'error'].map(name =>
      jest.spyOn(console, name as 'log').mockImplementation(() => {})
    );
    try {
      const mod = require('../server') as typeof import('../server');
      await expect(mod.startGateway({ port: 0 })).rejects.toThrow(/SPO_MAX_SESSIONS/);
    } finally {
      quiet.forEach(spy => spy.mockRestore());
    }
  });
});
