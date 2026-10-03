/**
 * Tests for the UI-version reader/writer.
 *
 * A corrupt or hostile value must read as the classic interface, never as a crash.
 */

import { loadUiVersion, saveUiVersion, UI_VERSION_KEY } from './ui-version';

const store = new Map<string, string>();

function installStorage(impl?: Partial<Storage>) {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    ...impl,
  };
}

beforeEach(() => {
  store.clear();
  installStorage();
});
afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

describe('loadUiVersion / saveUiVersion', () => {
  it('defaults to v1 on a fresh browser', () => {
    expect(loadUiVersion()).toBe('v1');
  });

  it('round-trips v2, then v1 again', () => {
    saveUiVersion('v2');
    expect(loadUiVersion()).toBe('v2');
    expect(store.get(UI_VERSION_KEY)).toBe('v2');
    saveUiVersion('v1');
    expect(loadUiVersion()).toBe('v1');
    expect(store.get(UI_VERSION_KEY)).toBe('v1');
  });

  it('reads any garbage stored value as v1', () => {
    for (const raw of ['garbage', 'V2', ' v2', 'true', '']) {
      store.set(UI_VERSION_KEY, raw);
      expect(loadUiVersion()).toBe('v1');
    }
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(loadUiVersion()).toBe('v1');
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(loadUiVersion()).toBe('v1');
    expect(() => saveUiVersion('v2')).not.toThrow();
  });

  it('survives a localStorage accessor that throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('SecurityError'); },
    });
    expect(loadUiVersion()).toBe('v1');
    expect(() => saveUiVersion('v2')).not.toThrow();
  });

  it('swallows a storage that refuses to write', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => saveUiVersion('v2')).not.toThrow();
  });
});
