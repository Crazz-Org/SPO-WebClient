/**
 * Tests for the fog-of-war seen-set.
 *
 * A tile in a block never loaded is unseen; marking a block flips every tile in it, and only
 * it; the set persists and reloads for the same world+player, and never for another.
 */

import { ExploredBlocks, exploredKey, blockKey, EXPLORED_KEY_PREFIX, BLOCK_SIZE } from './explored-blocks';

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

describe('exploredKey', () => {
  it('is one key per world and player, with a placeholder before login', () => {
    expect(exploredKey('planitia', 'SPO_test3')).toBe(`${EXPLORED_KEY_PREFIX}planitia.SPO_test3`);
    expect(exploredKey('', '')).toBe(`${EXPLORED_KEY_PREFIX}world.player`);
  });
});

describe('blockKey', () => {
  it('aligns to the 64-tile grid', () => {
    expect(blockKey(0, 0)).toBe('0,0');
    expect(blockKey(63, 63)).toBe('0,0');
    expect(blockKey(64, 64)).toBe('64,64');
    expect(blockKey(127, 70)).toBe(`64,${BLOCK_SIZE}`);
  });
});

describe('ExploredBlocks', () => {
  it('reports every tile as unseen on an empty set', () => {
    const blocks = new ExploredBlocks('k');
    expect(blocks.has(0, 0)).toBe(false);
    expect(blocks.has(70, 70)).toBe(false);
    expect(blocks.size).toBe(0);
  });

  it('marks the whole block on one mark, and only that block', () => {
    const blocks = new ExploredBlocks('k');
    expect(blocks.mark(70, 70)).toBe(true);
    expect(blocks.mark(70, 70)).toBe(false);
    expect(blocks.has(64, 64)).toBe(true);
    expect(blocks.has(127, 127)).toBe(true);
    expect(blocks.has(128, 64)).toBe(false);
    expect(blocks.size).toBe(1);
  });

  it('persists on mark and round-trips through load for the same world+player', () => {
    const blocks = ExploredBlocks.load('planitia', 'SPO_test3');
    blocks.mark(70, 70);
    const reloaded = ExploredBlocks.load('planitia', 'SPO_test3');
    expect(reloaded.has(70, 70)).toBe(true);
    expect(reloaded.size).toBe(1);
  });

  it('keys by world and player — a different pair loads an empty set', () => {
    const blocks = ExploredBlocks.load('planitia', 'SPO_test3');
    blocks.mark(70, 70);
    expect(ExploredBlocks.load('otherworld', 'SPO_test3').has(70, 70)).toBe(false);
    expect(ExploredBlocks.load('planitia', 'Crazz').has(70, 70)).toBe(false);
  });

  it('loads an empty set for a missing key, garbage JSON, a non-array, and non-"x,y" entries', () => {
    expect(ExploredBlocks.load('w', 'p').size).toBe(0);
    store.set(exploredKey('w', 'p'), 'not json');
    expect(ExploredBlocks.load('w', 'p').size).toBe(0);
    store.set(exploredKey('w', 'p'), JSON.stringify({ a: 1 }));
    expect(ExploredBlocks.load('w', 'p').size).toBe(0);
    store.set(exploredKey('w', 'p'), JSON.stringify(['0,0', 'nope', 42, null, '64,64']));
    const loaded = ExploredBlocks.load('w', 'p');
    expect(loaded.size).toBe(2);
    expect(loaded.has(0, 0)).toBe(true);
    expect(loaded.has(64, 64)).toBe(true);
  });

  it('survives a storage that throws, on both load and mark', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(ExploredBlocks.load('w', 'p').size).toBe(0);
    installStorage({ setItem: () => { throw new Error('nope'); } });
    const blocks = ExploredBlocks.load('w', 'p');
    expect(() => blocks.mark(0, 0)).not.toThrow();
    expect(blocks.has(0, 0)).toBe(true);
  });
});
