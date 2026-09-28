/** @jest-environment jsdom */
/**
 * stale-bundle — reload once per entry bundle on a failed chunk load, and the served-bundle
 * check a reconnect runs (issue 1050).
 */

jest.mock('./page-reload', () => ({ reloadPage: jest.fn() }));

import { reloadPage } from './page-reload';
import {
  CHUNK_RELOAD_KEY,
  checkServedBundle,
  installStaleBundleReload,
  pageEntryPath,
} from './stale-bundle';

const reload = reloadPage as jest.Mock;
const OLD = 'assets/app.OLD.js';

function firePreloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  installStaleBundleReload();
});

beforeEach(() => {
  document.head.innerHTML = `<script type="module" src="${OLD}"></script>`;
  sessionStorage.clear();
  reload.mockClear();
  jest.restoreAllMocks();
});

describe('vite:preloadError — reload once per entry bundle', () => {
  it('a first failure with an empty guard reloads once and stores the entry path', () => {
    const event = firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe(OLD);
    expect(event.defaultPrevented).toBe(false);
  });

  it('a failure after the reload into the same bundle does not reload and does not preventDefault', () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, OLD);
    const event = firePreloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a guard holding a different bundle reloads again and moves the guard', () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, 'assets/app.OLDER.js');
    firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe(OLD);
  });

  it('does not reload when storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    firePreloadError();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the page has no entry script tag', () => {
    document.head.innerHTML = '';
    firePreloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });
});

describe('pageEntryPath', () => {
  it('returns the raw dev entry and skips a non-matching module script placed first', () => {
    document.head.innerHTML =
      '<script type="module" src="/other/vendor.js"></script><script type="module" src="app.js"></script>';
    expect(pageEntryPath()).toBe('app.js');
  });

  it('returns null when no module script is the entry', () => {
    document.head.innerHTML = '<script type="module" src="/other/vendor.js"></script>';
    expect(pageEntryPath()).toBeNull();
  });
});

describe('checkServedBundle', () => {
  const g = globalThis as unknown as { fetch?: unknown };
  const original = g.fetch;
  const served = (html: string, ok = true) =>
    jest.fn().mockResolvedValue({ ok, text: async () => html });

  afterEach(() => {
    g.fetch = original;
  });

  it('is true when the served entry differs, fetching exactly "/" with no-store', async () => {
    const fetchMock = served('<script type="module" src="assets/app.NEW.js"></script>');
    g.fetch = fetchMock;
    await expect(checkServedBundle()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/', { cache: 'no-store' });
  });

  it('is false when the served entry is the same', async () => {
    g.fetch = served(`<script type="module" src="${OLD}"></script>`);
    await expect(checkServedBundle()).resolves.toBe(false);
  });

  it('is false when the fetch rejects', async () => {
    g.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(checkServedBundle()).resolves.toBe(false);
  });

  it('is false when the response is not ok', async () => {
    g.fetch = served('<script type="module" src="assets/app.NEW.js"></script>', false);
    await expect(checkServedBundle()).resolves.toBe(false);
  });

  it('is false when the served page has no hashed entry (dev app.js)', async () => {
    g.fetch = served('<script type="module" src="app.js"></script>');
    await expect(checkServedBundle()).resolves.toBe(false);
  });

  it('is false, without fetching, when the page has no entry tag', async () => {
    document.head.innerHTML = '';
    const fetchMock = served('<script type="module" src="assets/app.NEW.js"></script>');
    g.fetch = fetchMock;
    await expect(checkServedBundle()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is false when fetch does not exist', async () => {
    delete g.fetch;
    await expect(checkServedBundle()).resolves.toBe(false);
  });
});
