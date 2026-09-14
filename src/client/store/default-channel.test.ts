/**
 * Tests for the default-channel reader/writer.
 *
 * A corrupt or hostile value must read as "no default", never as a crash — the safe
 * reading that makes "behaviour is exactly today's" hold by construction.
 */

import { loadDefaultChannel, saveDefaultChannel, DEFAULT_CHANNEL_KEY } from './default-channel';

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

describe('loadDefaultChannel / saveDefaultChannel', () => {
  it('defaults to null with no key stored', () => {
    expect(loadDefaultChannel()).toBeNull();
  });

  it('round-trips a channel name, then clears it', () => {
    saveDefaultChannel('Trade');
    expect(loadDefaultChannel()).toBe('Trade');
    expect(store.get(DEFAULT_CHANNEL_KEY)).toBe('Trade');
    saveDefaultChannel(null);
    expect(loadDefaultChannel()).toBeNull();
    expect(store.has(DEFAULT_CHANNEL_KEY)).toBe(false);
  });

  it('reads an empty string as null', () => {
    store.set(DEFAULT_CHANNEL_KEY, '');
    expect(loadDefaultChannel()).toBeNull();
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(loadDefaultChannel()).toBeNull();
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(loadDefaultChannel()).toBeNull();
  });

  it('swallows a storage that refuses to write or remove', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => saveDefaultChannel('Trade')).not.toThrow();
    installStorage({ removeItem: () => { throw new Error('nope'); } });
    expect(() => saveDefaultChannel(null)).not.toThrow();
  });
});
