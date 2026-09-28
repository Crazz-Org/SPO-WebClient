import { RESUME_TOKEN_KEY, loadResumeToken, saveResumeToken, clearResumeToken } from './resume-token';

/**
 * The unit project runs under node, which has no sessionStorage: each test installs a tiny one
 * (the ui-store.test.ts pattern) and removes it afterwards.
 */
describe('resume-token (issue 1046)', () => {
  const mem = new Map<string, string>();
  const local = new Map<string, string>();
  const g = globalThis as unknown as { sessionStorage?: unknown; localStorage?: unknown };

  const install = (name: 'sessionStorage' | 'localStorage', store: Map<string, string>) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    });
  };

  beforeEach(() => {
    mem.clear();
    local.clear();
    install('sessionStorage', mem);
    install('localStorage', local);
  });

  afterEach(() => {
    delete g.sessionStorage;
    delete g.localStorage;
  });

  it('round-trips a token through sessionStorage and clears it', () => {
    saveResumeToken({ username: 'u', token: 't1' });
    expect(mem.has(RESUME_TOKEN_KEY)).toBe(true);
    expect(loadResumeToken()).toEqual({ username: 'u', token: 't1' });

    clearResumeToken();
    expect(mem.has(RESUME_TOKEN_KEY)).toBe(false);
    expect(loadResumeToken()).toBeNull();
  });

  it('a second save replaces the first (a rotation)', () => {
    saveResumeToken({ username: 'u', token: 't1' });
    saveResumeToken({ username: 'u', token: 't2' });
    expect(loadResumeToken()).toEqual({ username: 'u', token: 't2' });
  });

  it.each([
    ['bad JSON', '{not json'],
    ['a missing token', JSON.stringify({ username: 'u' })],
    ['an empty token', JSON.stringify({ username: 'u', token: '' })],
    ['an empty username', JSON.stringify({ username: '', token: 't' })],
    ['a non-string field', JSON.stringify({ username: 'u', token: 7 })],
    ['a non-object', JSON.stringify('t')],
    ['null', 'null'],
  ])('%s reads as no token', (_label, raw) => {
    mem.set(RESUME_TOKEN_KEY, raw);
    expect(loadResumeToken()).toBeNull();
  });

  it('a storage whose every call throws breaks nothing', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('denied'); },
        removeItem: () => { throw new Error('denied'); },
      },
    });
    expect(() => saveResumeToken({ username: 'u', token: 't' })).not.toThrow();
    expect(loadResumeToken()).toBeNull();
    expect(() => clearResumeToken()).not.toThrow();
  });

  it('a sessionStorage getter that throws reads as no storage', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => { throw new Error('SecurityError'); },
    });
    expect(loadResumeToken()).toBeNull();
    expect(() => saveResumeToken({ username: 'u', token: 't' })).not.toThrow();
  });

  it('no sessionStorage at all reads as no token', () => {
    delete g.sessionStorage;
    expect(loadResumeToken()).toBeNull();
    expect(() => saveResumeToken({ username: 'u', token: 't' })).not.toThrow();
    expect(() => clearResumeToken()).not.toThrow();
  });

  it('never writes localStorage', () => {
    saveResumeToken({ username: 'u', token: 't1' });
    clearResumeToken();
    saveResumeToken({ username: 'u', token: 't2' });
    expect(local.size).toBe(0);
  });
});
