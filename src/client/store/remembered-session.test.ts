/**
 * Tests for the remembered-session reader/writer.
 *
 * A corrupt or hostile value must read as "nothing remembered", never as a crash — the
 * sign-in screen falls back to typing it out by hand either way.
 */

import {
  loadRememberedSession,
  saveRememberedSession,
  clearRememberedSession,
  REMEMBERED_SESSION_KEY,
  type RememberedSession,
} from './remembered-session';

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

const RECORD: RememberedSession = {
  username: 'SPO_test3',
  zonePath: 'Root/Areas/Asia/Worlds',
  worldName: 'Shamba',
  companyId: '28',
  companyName: 'Yellow Inc.',
  ownerRole: 'SPO_test3',
};

describe('saveRememberedSession / loadRememberedSession', () => {
  it('round-trips a record through localStorage', () => {
    saveRememberedSession(RECORD);
    expect(loadRememberedSession()).toEqual(RECORD);
  });

  it('round-trips a record with no ownerRole', () => {
    const { ownerRole: _drop, ...withoutRole } = RECORD;
    saveRememberedSession(withoutRole);
    expect(loadRememberedSession()).toEqual(withoutRole);
  });

  it('answers null on a fresh browser', () => {
    expect(loadRememberedSession()).toBeNull();
  });

  it('answers null for garbage JSON, a non-object, and a missing field', () => {
    store.set(REMEMBERED_SESSION_KEY, 'not json');
    expect(loadRememberedSession()).toBeNull();

    store.set(REMEMBERED_SESSION_KEY, JSON.stringify('a string'));
    expect(loadRememberedSession()).toBeNull();

    store.set(REMEMBERED_SESSION_KEY, JSON.stringify({ username: 'x' }));
    expect(loadRememberedSession()).toBeNull();

    store.set(REMEMBERED_SESSION_KEY, JSON.stringify({ ...RECORD, ownerRole: 5 }));
    expect(loadRememberedSession()).toBeNull();
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(loadRememberedSession()).toBeNull();
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(loadRememberedSession()).toBeNull();
  });

  it('swallows a storage that refuses to write', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => saveRememberedSession(RECORD)).not.toThrow();
  });
});

describe('clearRememberedSession', () => {
  it('drops the key, and swallows a storage that refuses', () => {
    saveRememberedSession(RECORD);
    clearRememberedSession();
    expect(loadRememberedSession()).toBeNull();

    installStorage({ removeItem: () => { throw new Error('nope'); } });
    expect(() => clearRememberedSession()).not.toThrow();
  });
});
