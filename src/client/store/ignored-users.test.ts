/**
 * Tests for the ignored-users reader/writer.
 *
 * A corrupt or hostile value must read as "nobody ignored", never as a crash.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ignoredKey, readIgnored, writeIgnored, IGNORED_KEY_PREFIX } from './ignored-users';

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

describe('ignoredKey', () => {
  it('is one key per world and player', () => {
    expect(ignoredKey('planitia', 'SPO_test3')).toBe(`${IGNORED_KEY_PREFIX}planitia.SPO_test3`);
  });

  it('two different (world, player) pairs never share a key', () => {
    expect(ignoredKey('planitia', 'Alice')).not.toBe(ignoredKey('planitia', 'Bob'));
    expect(ignoredKey('planitia', 'Alice')).not.toBe(ignoredKey('Shamba', 'Alice'));
  });
});

describe('readIgnored / writeIgnored', () => {
  it('returns [] when the key is absent', () => {
    expect(readIgnored(ignoredKey('planitia', 'Alice'))).toEqual([]);
  });

  it('round-trips a list of names', () => {
    const key = ignoredKey('planitia', 'Alice');
    writeIgnored(key, ['Bob', 'Carol']);
    expect(readIgnored(key)).toEqual(['Bob', 'Carol']);
  });

  it('reads garbage JSON shapes as []', () => {
    const key = ignoredKey('planitia', 'Alice');
    store.set(key, '{}');
    expect(readIgnored(key)).toEqual([]);
    store.set(key, 'not json');
    expect(readIgnored(key)).toEqual([]);
    store.set(key, '[1,2]');
    expect(readIgnored(key)).toEqual([]);
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(readIgnored(ignoredKey('planitia', 'Alice'))).toEqual([]);
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(readIgnored(ignoredKey('planitia', 'Alice'))).toEqual([]);
  });

  it('swallows a storage that refuses to write', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => writeIgnored(ignoredKey('planitia', 'Alice'), ['Bob'])).not.toThrow();
  });
});
