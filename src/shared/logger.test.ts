/**
 * Tests for the enhanced Logger — child(), setField(), JSON mode.
 */

// Mock config before importing logger
jest.mock('./config', () => ({
  config: {
    logging: {
      level: 'debug',
      colorize: false,
      jsonMode: false,
      filePath: '',
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
    },
  },
}));

// Mock log-transport to avoid file system access
jest.mock('./log-transport', () => ({
  FileTransport: jest.fn(),
}));

import { Logger, LogRingBuffer, createLogger, generateSessionId, closeLogTransports } from './logger';

describe('closeLogTransports', () => {
  it('resolves when neither transport is configured', async () => {
    await expect(closeLogTransports()).resolves.toBeUndefined();
  });

  it('awaits the close() of both transports', async () => {
    const resolvers: Array<() => void> = [];
    const closes: jest.Mock[] = [];
    let closeAll: () => Promise<void> = () => Promise.reject(new Error('logger not loaded'));

    // The module-level mocks above are shared: configure them for one fresh
    // load of the logger, then put them back.
    const { config } = require('./config') as { config: { logging: Record<string, unknown> } };
    const { FileTransport } = require('./log-transport') as { FileTransport: jest.Mock };
    const saved = { ...config.logging };
    config.logging.filePath = '/tmp/a';
    config.logging.errorFilePath = '/tmp/b';
    FileTransport.mockImplementation(() => {
      const close = jest.fn(() => new Promise<void>((resolve) => { resolvers.push(resolve); }));
      closes.push(close);
      return { write: jest.fn(), close };
    });
    try {
      jest.isolateModules(() => {
        closeAll = (require('./logger') as typeof import('./logger')).closeLogTransports;
      });
    } finally {
      delete config.logging.errorFilePath;
      Object.assign(config.logging, saved);
      FileTransport.mockReset();
    }

    let settled = false;
    const done = closeAll().then(() => { settled = true; });

    expect(closes).toHaveLength(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).toHaveBeenCalledTimes(1);

    resolvers[0]();
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    resolvers[1]();
    await done;
    expect(settled).toBe(true);
  });
});

describe('Logger', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('creates a logger with given context', () => {
      const log = createLogger('TestCtx');
      log.info('hello');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[TestCtx]');
      expect(output).toContain('hello');
    });
  });

  describe('child()', () => {
    it('creates a child logger that inherits parent fields', () => {
      const parent = createLogger('Session');
      const child = parent.child({ player: 'Alice' });
      child.info('logged in');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('player=Alice');
      expect(output).toContain('logged in');
    });

    it('merges fields from multiple child() calls', () => {
      const log = createLogger('Session')
        .child({ player: 'Bob' })
        .child({ tycoonId: 'T42' });
      log.info('test');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('player=Bob');
      expect(output).toContain('tycoonId=T42');
    });

    it('does not mutate the parent logger', () => {
      const parent = createLogger('Session');
      parent.child({ player: 'Alice' });
      parent.info('parent log');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).not.toContain('player=');
    });
  });

  describe('setField()', () => {
    it('adds a field that appears in subsequent logs', () => {
      const log = createLogger('Session');
      log.setField('corrId', 'ws-123');
      log.info('request');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('corrId=ws-123');
    });

    it('removes a field when set to null', () => {
      const log = createLogger('Session');
      log.setField('corrId', 'ws-123');
      log.setField('corrId', null);
      log.info('request');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).not.toContain('corrId');
    });
  });

  describe('log levels', () => {
    it('logs debug messages at debug level', () => {
      const log = createLogger('Test');
      log.debug('debug msg');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect((consoleSpy.mock.calls[0][0] as string)).toContain('DEBUG');
    });

    it('logs info messages', () => {
      const log = createLogger('Test');
      log.info('info msg');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect((consoleSpy.mock.calls[0][0] as string)).toContain('INFO');
    });

    it('logs warn messages to console.warn', () => {
      const warnSpy = jest.spyOn(console, 'warn');
      const log = createLogger('Test');
      log.warn('warning');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('logs error messages to console.error', () => {
      const errorSpy = jest.spyOn(console, 'error');
      const log = createLogger('Test');
      log.error('failure');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('metadata', () => {
    it('serializes object metadata as JSON', () => {
      const log = createLogger('Test');
      log.info('msg', { key: 'value' });
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('"key":"value"');
    });

    it('serializes Error metadata with message and stack', () => {
      const log = createLogger('Test');
      const err = new Error('boom');
      log.error('failed', err);
      const output = (console.error as jest.Mock).mock.calls[0][0] as string;
      expect(output).toContain('boom');
    });
  });
});

describe('Logger JSON mode', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Enable JSON mode via config mock
    const { config } = require('./config');
    config.logging.jsonMode = true;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    const { config } = require('./config');
    config.logging.jsonMode = false;
    jest.restoreAllMocks();
  });

  it('outputs valid NDJSON when jsonMode is enabled', () => {
    const log = new Logger('Session', { player: 'Alice' });
    log.info('test message');
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      level: 'INFO',
      ctx: 'Session',
      msg: 'test message',
      player: 'Alice',
    });
    expect(parsed.ts).toBeDefined();
  });

  it('includes metadata in JSON output', () => {
    const log = new Logger('Session');
    log.info('msg', { rid: 42 });
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(parsed.meta).toEqual({ rid: 42 });
  });

  it('serializes Error metadata correctly in JSON', () => {
    const log = new Logger('Session');
    const err = new Error('test error');
    log.error('failed', err);
    const errorSpy = jest.spyOn(console, 'error');
    // Error goes to console.error in JSON mode too
    log.error('failed2', err);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.meta.error).toBe('test error');
    expect(parsed.meta.stack).toBeDefined();
  });
});

describe('generateSessionId', () => {
  it('returns a string matching s-<base36>-<uuid-hex> format', () => {
    const sid = generateSessionId();
    expect(sid).toMatch(/^s-[a-z0-9]+-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe('LogRingBuffer', () => {
  it('stores entries up to maxSize', () => {
    const buf = new LogRingBuffer(3);
    buf.push({ msg: 'a' });
    buf.push({ msg: 'b' });
    buf.push({ msg: 'c' });
    expect(buf.size).toBe(3);
  });

  it('evicts oldest entry when full', () => {
    const buf = new LogRingBuffer(2);
    buf.push({ msg: 'a' });
    buf.push({ msg: 'b' });
    buf.push({ msg: 'c' });
    const entries = buf.drain();
    expect(entries).toEqual([{ msg: 'b' }, { msg: 'c' }]);
  });

  it('drain() returns entries and clears buffer', () => {
    const buf = new LogRingBuffer(5);
    buf.push({ msg: 'x' });
    buf.push({ msg: 'y' });
    expect(buf.drain()).toHaveLength(2);
    expect(buf.drain()).toHaveLength(0);
  });
});

describe('Logger ring buffer', () => {
  let consoleSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches recentContext on error when ring buffer is enabled (JSON mode)', () => {
    const { config } = require('./config');
    config.logging.jsonMode = true;

    const log = createLogger('Session').withRingBuffer(10);
    log.info('step 1');
    log.info('step 2');
    log.debug('step 3');
    log.error('something broke');

    const errorOutput = errorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(errorOutput);
    expect(parsed.recentContext).toBeDefined();
    expect(parsed.recentContext).toHaveLength(3);
    expect(parsed.recentContext[0].msg).toBe('step 1');
    expect(parsed.recentContext[2].msg).toBe('step 3');

    config.logging.jsonMode = false;
  });

  it('drains buffer on error so next error gets fresh context', () => {
    const { config } = require('./config');
    config.logging.jsonMode = true;

    const log = createLogger('Session').withRingBuffer(10);
    log.info('before first error');
    log.error('error 1');

    log.info('after first error');
    log.error('error 2');

    const error1 = JSON.parse(errorSpy.mock.calls[0][0] as string);
    const error2 = JSON.parse(errorSpy.mock.calls[1][0] as string);

    expect(error1.recentContext).toHaveLength(1);
    expect(error1.recentContext[0].msg).toBe('before first error');

    expect(error2.recentContext).toHaveLength(1);
    expect(error2.recentContext[0].msg).toBe('after first error');

    config.logging.jsonMode = false;
  });

  it('child loggers share the same ring buffer', () => {
    const { config } = require('./config');
    config.logging.jsonMode = true;

    const parent = createLogger('Session').withRingBuffer(10);
    const child = parent.child({ player: 'Alice' });

    parent.info('parent log');
    child.info('child log');
    child.error('child error');

    const errorOutput = errorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(errorOutput);
    expect(parsed.recentContext).toHaveLength(2);
    expect(parsed.recentContext[0].msg).toBe('parent log');
    expect(parsed.recentContext[1].msg).toBe('child log');

    config.logging.jsonMode = false;
  });

  it('does not attach recentContext when no ring buffer', () => {
    const { config } = require('./config');
    config.logging.jsonMode = true;

    const log = createLogger('Gateway'); // no withRingBuffer
    log.info('some info');
    log.error('gateway error');

    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.recentContext).toBeUndefined();

    config.logging.jsonMode = false;
  });
});
