/**
 * Settings per account (#1067): `loadAccountSettings`, and how `loadPersistedSettings` /
 * `persistSettings` follow the active account. The active key is module state, so every test
 * loads a fresh copy of the bridge and the store.
 */
type Bridge = typeof import('./client-bridge').ClientBridge;
type Store = typeof import('../store/game-store').useGameStore;

const g = globalThis as unknown as { localStorage?: Storage };

function mapStorage(initial: Record<string, string> = {}): { data: Map<string, string>; storage: Storage } {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size; },
  } as Storage;
  return { data, storage };
}

function fresh(storage: Storage | undefined): { bridge: Bridge; store: Store } {
  if (storage) g.localStorage = storage; else delete g.localStorage;
  let bridge!: Bridge;
  let store!: Store;
  jest.isolateModules(() => {
    bridge = (require('./client-bridge') as typeof import('./client-bridge')).ClientBridge;
    store = (require('../store/game-store') as typeof import('../store/game-store')).useGameStore;
  });
  return { bridge, store };
}

afterEach(() => { delete g.localStorage; });

describe('ClientBridge — settings per account', () => {
  it('two accounts do not share settings', () => {
    const bEntry = JSON.stringify({ isSoundEnabled: true, soundVolume: 0.9, languageId: '0' });
    const { data, storage } = mapStorage({
      'spo.settings.ALICE': JSON.stringify({ isSoundEnabled: false, soundVolume: 0.1, languageId: '0' }),
      'spo.settings.BOB': bEntry,
    });
    const { bridge, store } = fresh(storage);

    bridge.loadAccountSettings('alice', '0');
    expect(store.getState().settings.isSoundEnabled).toBe(false);
    store.getState().updateSettings({ soundVolume: 0.3 });
    bridge.persistSettings(store.getState().settings);
    expect(JSON.parse(data.get('spo.settings.ALICE') ?? '{}').soundVolume).toBe(0.3);

    bridge.loadAccountSettings('bob', '0');
    expect(store.getState().settings.isSoundEnabled).toBe(true);
    expect(store.getState().settings.soundVolume).toBe(0.9);
    expect(JSON.parse(data.get('spo.settings.BOB') ?? '{}')).toEqual(
      expect.objectContaining(JSON.parse(bEntry) as object),
    );
  });

  it('carries the browser settings over to an account with no entry', () => {
    const legacy = { isSoundEnabled: false, soundVolume: 0.2, languageId: '2' };
    const { data, storage } = mapStorage({ spo_settings: JSON.stringify(legacy) });
    const { bridge, store } = fresh(storage);
    bridge.loadPersistedSettings(); // the constructor's load

    bridge.loadAccountSettings('crazz', '0');

    expect(store.getState().settings).toEqual(expect.objectContaining({ ...legacy, languageId: '0' }));
    expect(JSON.parse(data.get('spo.settings.CRAZZ') ?? '{}')).toEqual(store.getState().settings);
  });

  it('writes no account entry before an account is loaded', () => {
    const { data, storage } = mapStorage();
    const { bridge, store } = fresh(storage);

    bridge.persistSettings(store.getState().settings);

    expect(data.has('spo_settings')).toBe(true);
    expect([...data.keys()].filter((k) => k.startsWith('spo.settings.'))).toEqual([]);
  });

  it('the game-view load reads the active account, not the browser entry', () => {
    const { data, storage } = mapStorage({
      'spo.settings.CRAZZ': JSON.stringify({ soundVolume: 0.7 }),
    });
    const { bridge, store } = fresh(storage);
    bridge.loadAccountSettings('crazz', '0');
    data.set('spo_settings', JSON.stringify({ soundVolume: 0.05 }));
    store.getState().updateSettings({ soundVolume: 0.4 });

    bridge.loadPersistedSettings();

    expect(store.getState().settings.soundVolume).toBe(0.7);
  });

  it('falls back to the browser entry when the active account has none', () => {
    const { data, storage } = mapStorage();
    const { bridge, store } = fresh(storage);
    bridge.loadAccountSettings('crazz', '0');
    data.delete('spo.settings.CRAZZ');
    data.set('spo_settings', JSON.stringify({ soundVolume: 0.05 }));

    bridge.loadPersistedSettings();

    expect(store.getState().settings.soundVolume).toBe(0.05);
  });

  it("the form's language wins over the account's stored one", () => {
    const { data, storage } = mapStorage({
      'spo.settings.CRAZZ': JSON.stringify({ languageId: '2' }),
    });
    const { bridge, store } = fresh(storage);
    store.getState().updateSettings({ languageId: '0' });

    bridge.loadAccountSettings('crazz', '0');

    expect(store.getState().settings.languageId).toBe('0');
    expect(JSON.parse(data.get('spo.settings.CRAZZ') ?? '{}').languageId).toBe('0');
  });

  it('reads a corrupt or non-object account entry as absent', () => {
    for (const bad of ['{nope', '[1,2]', '42']) {
      const { data, storage } = mapStorage({ 'spo.settings.CRAZZ': bad });
      const { bridge, store } = fresh(storage);
      const before = store.getState().settings.soundVolume;

      expect(() => bridge.loadAccountSettings('crazz', '0')).not.toThrow();
      expect(store.getState().settings.soundVolume).toBe(before);
      expect(store.getState().settings).not.toHaveProperty('0');
      expect(JSON.parse(data.get('spo.settings.CRAZZ') ?? '{}').soundVolume).toBe(before);
    }
  });

  it('survives a storage whose getItem and setItem throw', () => {
    const boom = (): never => { throw new Error('blocked'); };
    const storage = { getItem: boom, setItem: boom } as unknown as Storage;
    const { bridge, store } = fresh(storage);

    expect(() => bridge.loadAccountSettings('crazz', '4')).not.toThrow();
    expect(() => bridge.persistSettings(store.getState().settings)).not.toThrow();
    expect(() => bridge.loadPersistedSettings()).not.toThrow();
    expect(store.getState().settings.languageId).toBe('4');
  });

  it('survives an absent localStorage', () => {
    const { bridge, store } = fresh(undefined);

    expect(() => bridge.loadAccountSettings('crazz', '0')).not.toThrow();
    expect(() => bridge.persistSettings(store.getState().settings)).not.toThrow();
    expect(() => bridge.loadPersistedSettings()).not.toThrow();
  });
});
