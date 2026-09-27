import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

type Config = typeof import('./config').config;

const g = globalThis as unknown as Record<string, unknown>;

function load(): Config {
  let c!: Config;
  jest.isolateModules(() => {
    c = (require('./config') as typeof import('./config')).config;
  });
  return c;
}

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('config.server bug-report flags', () => {
  const saved = { report: process.env.SPO_BUG_REPORT, support: process.env.SPO_SUPPORT_URL };

  beforeEach(() => {
    delete process.env.SPO_BUG_REPORT;
    delete g.window;
  });

  afterEach(() => {
    setEnv('SPO_BUG_REPORT', saved.report);
    setEnv('SPO_SUPPORT_URL', saved.support);
    delete g.window;
  });

  it.each<[string | undefined, boolean, boolean]>([
    ['true', true, false],
    ['player', true, true],
    [undefined, false, false],
    ['', false, false],
    ['false', false, false],
    ['1', false, false],
    ['PLAYER', false, false],
    ['yes', false, false],
  ])('env SPO_BUG_REPORT=%p -> mode %p, player %p', (value, mode, player) => {
    setEnv('SPO_BUG_REPORT', value);
    const c = load();
    expect(c.server.bugReportMode).toBe(mode);
    expect(c.server.bugReportPlayerMode).toBe(player);
  });

  it.each<[unknown, boolean, boolean]>([
    [true, true, false],
    ['player', true, true],
    [false, false, false],
    ['true', false, false],
    [1, false, false],
    [null, false, false],
    ['x', false, false],
  ])('window.__SPO_BUG_REPORT__=%p -> mode %p, player %p', (value, mode, player) => {
    g.window = { __SPO_BUG_REPORT__: value };
    const c = load();
    expect(c.server.bugReportMode).toBe(mode);
    expect(c.server.bugReportPlayerMode).toBe(player);
  });

  it('window wins over the env when defined', () => {
    process.env.SPO_BUG_REPORT = 'player';
    g.window = { __SPO_BUG_REPORT__: false };
    let c = load();
    expect(c.server.bugReportMode).toBe(false);
    expect(c.server.bugReportPlayerMode).toBe(false);

    delete process.env.SPO_BUG_REPORT;
    g.window = { __SPO_BUG_REPORT__: 'player' };
    c = load();
    expect(c.server.bugReportMode).toBe(true);
    expect(c.server.bugReportPlayerMode).toBe(true);
  });

  it('has no supportUrl, even with SPO_SUPPORT_URL set', () => {
    process.env.SPO_SUPPORT_URL = 'https://example.org/support';
    expect('supportUrl' in load().server).toBe(false);
  });
});
