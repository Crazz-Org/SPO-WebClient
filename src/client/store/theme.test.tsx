/**
 * Tests for the theme reader/writer.
 *
 * A corrupt or hostile value must read as Corporate Empire, never as a crash; the stored
 * choice beats the URL, which beats the gateway default.
 */

import { applyTheme, loadTheme, saveTheme, THEME_KEY, THEMES } from './theme';

const store = new Map<string, string>();

function installStorage(impl?: Partial<Storage>) {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    ...impl,
  };
}

function setUrl(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

function setGatewayTheme(value: unknown) {
  (window as unknown as Record<string, unknown>).__SPO_THEME__ = value;
}

beforeEach(() => {
  store.clear();
  installStorage();
  setUrl('');
  delete (window as unknown as Record<string, unknown>).__SPO_THEME__;
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

describe('loadTheme / saveTheme', () => {
  it('lists exactly the two themes', () => {
    expect(THEMES).toEqual(['empire', 'legacy']);
  });

  it('defaults to empire on a fresh browser', () => {
    expect(loadTheme()).toBe('empire');
  });

  it('round-trips legacy, then empire again', () => {
    saveTheme('legacy');
    expect(loadTheme()).toBe('legacy');
    expect(store.get(THEME_KEY)).toBe('legacy');
    saveTheme('empire');
    expect(loadTheme()).toBe('empire');
    expect(store.get(THEME_KEY)).toBe('empire');
  });

  it('reads any garbage stored value as empire', () => {
    for (const raw of ['garbage', 'LEGACY', ' legacy', 'true', '', 'classic', 'v1']) {
      store.set(THEME_KEY, raw);
      expect(loadTheme()).toBe('empire');
    }
  });

  it('takes ?theme= from the URL when nothing is stored', () => {
    setUrl('?theme=legacy');
    expect(loadTheme()).toBe('legacy');
    setUrl('?theme=empire');
    expect(loadTheme()).toBe('empire');
  });

  it('ignores a ?theme= it does not know', () => {
    setUrl('?theme=neon');
    expect(loadTheme()).toBe('empire');
  });

  it('a stored choice wins over the URL — the desktop shell asks for legacy, the player chose empire', () => {
    setUrl('?theme=legacy');
    store.set(THEME_KEY, 'empire');
    expect(loadTheme()).toBe('empire');
  });

  it('takes the gateway default when neither storage nor the URL says anything', () => {
    setGatewayTheme('legacy');
    expect(loadTheme()).toBe('legacy');
  });

  it('the URL wins over the gateway default, and a garbage gateway value is nothing', () => {
    setGatewayTheme('legacy');
    setUrl('?theme=empire');
    expect(loadTheme()).toBe('empire');
    setUrl('');
    setGatewayTheme('neon');
    expect(loadTheme()).toBe('empire');
    setGatewayTheme(true);
    expect(loadTheme()).toBe('empire');
  });

  it('survives a storage that throws, and a browser with no storage at all', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(loadTheme()).toBe('empire');
    setUrl('?theme=legacy');
    expect(loadTheme()).toBe('legacy'); // the channel default still gets through
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(loadTheme()).toBe('legacy');
    expect(() => saveTheme('legacy')).not.toThrow();
  });

  it('survives a localStorage accessor that throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('SecurityError'); },
    });
    expect(loadTheme()).toBe('empire');
    expect(() => saveTheme('legacy')).not.toThrow();
  });

  it('swallows a storage that refuses to write', () => {
    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => saveTheme('legacy')).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('stamps legacy on <html> and clears it for empire', () => {
    applyTheme('legacy');
    expect(document.documentElement.getAttribute('data-theme')).toBe('legacy');
    applyTheme('empire');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
