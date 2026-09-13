/**
 * Tests for the chat-visibility reader/writer.
 *
 * A corrupt or hostile value must read as "chat visible", never as a crash.
 */

import { loadChatVisible, saveChatVisible, CHAT_VISIBLE_KEY } from './chat-visibility';

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

describe('loadChatVisible / saveChatVisible', () => {
  it('defaults to true on a fresh browser', () => {
    expect(loadChatVisible()).toBe(true);
  });

  it('round-trips false, then true again', () => {
    saveChatVisible(false);
    expect(loadChatVisible()).toBe(false);
    expect(store.get(CHAT_VISIBLE_KEY)).toBe('false');
    saveChatVisible(true);
    expect(loadChatVisible()).toBe(true);
  });

  it('reads any garbage stored value as true', () => {
    store.set(CHAT_VISIBLE_KEY, 'garbage');
    expect(loadChatVisible()).toBe(true);
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(loadChatVisible()).toBe(true);
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(loadChatVisible()).toBe(true);
  });

  it('swallows a storage that refuses to write', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => saveChatVisible(false)).not.toThrow();
  });
});
