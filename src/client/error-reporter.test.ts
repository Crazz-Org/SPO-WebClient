import { describe, it, expect, jest, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('./version', () => ({ APP_VERSION: '1.2.3', BUILD_DATE: 't', BUILD_TIME: 't', BUILD_NUMBER: '42' }));

import {
  installErrorReporter,
  reportClientError,
  CLIENT_ERROR_URL,
  MAX_REPORTS_PER_PAGE,
  type ErrorReporterOptions,
} from './error-reporter';
import { useGameStore } from './store/game-store';
import { useUiStore } from './store/ui-store';
import {
  validateClientErrorReport,
  MAX_MESSAGE_CHARS,
  MAX_FRAMES,
  MAX_FRAME_CHARS,
} from '../server/client-error-endpoint';

const ORIGIN = 'https://spo.example.test';
const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

type FetchMock = jest.Mock<(url: string, init: RequestInit) => Promise<unknown>>;

let dispose: (() => void) | null = null;
let fetchMock: FetchMock;
let target: EventTarget;

function setup(overrides: ErrorReporterOptions = {}): void {
  target = new EventTarget();
  fetchMock = jest.fn((_url: string, _init: RequestInit) => Promise.resolve({ ok: true }));
  dispose = installErrorReporter({ target, fetch: fetchMock, origin: ORIGIN, userAgent: CHROME_DESKTOP, ...overrides });
}

function rawBodies(): string[] {
  return fetchMock.mock.calls.map(c => String(c[1].body));
}

function bodies(): Record<string, unknown>[] {
  return rawBodies().map(b => {
    const parsed = JSON.parse(b) as Record<string, unknown>;
    // Contract: every payload this file builds passes the gateway's validator.
    expect(validateClientErrorReport(parsed).ok).toBe(true);
    return parsed;
  });
}

function errorEvent(message: string, error?: unknown): Event {
  return Object.assign(new Event('error'), { message, error });
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

afterEach(() => {
  dispose?.();
  dispose = null;
  useGameStore.setState({
    username: '',
    activeUsername: '',
    ownerRole: '',
    tycoonId: '',
    worldName: '',
    companyName: '',
    status: 'disconnected',
  });
  useUiStore.setState({ stack: [] });
  jest.restoreAllMocks();
});

describe('error-reporter — kinds', () => {
  it('sends each kind once, as a keepalive JSON POST, without preventing the preload event', () => {
    setup();
    target.dispatchEvent(errorEvent('boom', new Error('boom')));
    target.dispatchEvent(rejectionEvent(new Error('nope')));
    const preload = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
      payload: new Error('Failed to fetch dynamically imported module'),
    });
    target.dispatchEvent(preload);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(CLIENT_ERROR_URL);
      expect(url).toBe('/api/client-error');
      expect(init.method).toBe('POST');
      expect(init.keepalive).toBe(true);
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    }
    expect(bodies().map(b => b.kind)).toEqual(['error', 'rejection', 'chunk']);
    expect(preload.defaultPrevented).toBe(false);
  });

  it('sends the browser text for an error event carrying no Error object', () => {
    setup();
    target.dispatchEvent(errorEvent('Uncaught oops'));
    expect(bodies()[0].message).toBe('Uncaught oops');
  });

  it('a non-Error rejection sends no text of its own', () => {
    setup();
    target.dispatchEvent(rejectionEvent('Tycoon ZZ_OTHER not found'));
    expect(bodies()[0].message).toBe('non-Error rejection (string)');
    expect(rawBodies()[0]).not.toContain('ZZ_OTHER');
  });

  it('a non-Error chunk payload sends a fixed text', () => {
    setup();
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(bodies()[0].message).toBe('non-Error chunk (undefined)');
  });

  it('drops "Script error." and ResizeObserver noise', () => {
    setup();
    target.dispatchEvent(errorEvent('Script error.'));
    target.dispatchEvent(errorEvent('ResizeObserver loop completed with undelivered notifications.'));
    target.dispatchEvent(errorEvent('Uncaught', new Error('ResizeObserver loop limit exceeded')));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('error-reporter — scrubbing and payload', () => {
  it('no identity leaves the browser', () => {
    setup();
    useGameStore.setState({
      username: 'ZZ_Alice',
      activeUsername: 'ZZ_AliceRole',
      ownerRole: 'ZZ_AliceRole',
      tycoonId: '987654',
      worldName: 'ZZ_Planitia',
      companyName: 'ZZ Acme Corp',
    });
    const err = new Error('ZZ Acme Corp of ZZ_Alice (987654) failed in ZZ_Planitia: "ZZ_photo.jpg"');
    err.stack = `Error: x\n    at ZZ_AliceRole (${ORIGIN}/assets/ZZ_Planitia.js:1:2)`;
    reportClientError('error', err);

    const raw = rawBodies()[0];
    for (const secret of ['ZZ_Alice', '987654', 'ZZ_Planitia', 'ZZ Acme Corp', 'ZZ_photo.jpg']) {
      expect(raw).not.toContain(secret);
    }
    const body = bodies()[0];
    const message = body.message as string;
    for (const placeholder of ['<company>', '<user>', '<tycoon>', '<world>']) {
      expect(message).toContain(placeholder);
    }
    expect(body.frames).toEqual(['at <user> (/assets/<world>.js:1:2)']);
  });

  it('blanks single-quoted and curly-quoted segments', () => {
    setup();
    reportClientError('error', new Error("file 'a.png' and “b.png” failed"));
    expect(bodies()[0].message).toBe('file "…" and "…" failed');
  });

  it('ignores identity values shorter than 3 characters', () => {
    setup();
    useGameStore.setState({ username: 'ab' });
    reportClientError('error', new Error('ab cd'));
    expect(bodies()[0].message).toBe('ab cd');
  });

  it('has exactly the contract keys', () => {
    setup();
    reportClientError('boundary', new Error('keys'));
    const body = bodies()[0];
    expect(Object.keys(body).sort()).toEqual(
      ['build', 'frames', 'kind', 'message', 'mobile', 'screen', 'surface', 'ua', 'v'],
    );
    expect(body.v).toBe(1);
    expect(body.build).toBe('1.2.3#42');
    expect(body.kind).toBe('boundary');
  });

  it('replaces an empty message with a placeholder the endpoint accepts', () => {
    setup();
    const err = new Error('');
    err.stack = '';
    reportClientError('error', err);
    const body = bodies()[0];
    expect(body.message).toBe('(no message)');
    expect(body.frames).toEqual([]);
  });

  function longStackError(frameLine: (i: number) => string): Error {
    const err = new Error('x'.repeat(1000));
    const lines = ['Error: ' + 'x'.repeat(1000)];
    for (let i = 0; i < 20; i++) lines.push(frameLine(i));
    err.stack = lines.join('\n');
    return err;
  }

  function expectCapped(body: Record<string, unknown>): void {
    expect(validateClientErrorReport(body).ok).toBe(true);
    expect((body.message as string).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    const frames = body.frames as string[];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(MAX_FRAMES);
    for (const f of frames) {
      expect(f.length).toBeLessThanOrEqual(MAX_FRAME_CHARS);
      expect(f).not.toContain(ORIGIN);
      expect(f).not.toContain('?');
    }
  }

  it('caps a long Chrome stack', () => {
    setup();
    reportClientError('error', longStackError(i =>
      i === 0
        ? `    at ${'f'.repeat(300)} (${ORIGIN}/assets/app.abc.js?v=1:10:5)`
        : `    at fn${i} (${ORIGIN}/assets/app.abc.js?v=1:10:5)`));
    const body = bodies()[0];
    expectCapped(body);
    expect((body.frames as string[])[1]).toBe('at fn1 (/assets/app.abc.js:10:5)');
  });

  it('caps a long Firefox stack', () => {
    setup();
    reportClientError('error', longStackError(i =>
      i === 0
        ? `${'f'.repeat(300)}@${ORIGIN}/assets/app.abc.js?v=1:10:5`
        : `fn${i}@${ORIGIN}/assets/app.abc.js?v=1:10:5`));
    const body = bodies()[0];
    expectCapped(body);
    expect((body.frames as string[])[1]).toBe('fn1@/assets/app.abc.js:10:5');
  });
});

describe('error-reporter — de-duplication and cap', () => {
  it('the same error twice is sent once', () => {
    setup();
    const err = new Error('same');
    reportClientError('error', err);
    reportClientError('error', err);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('seven different errors send five reports', () => {
    setup();
    for (let i = 0; i < 7; i++) reportClientError('error', new Error(`e${i}`));
    expect(MAX_REPORTS_PER_PAGE).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('error-reporter — failures are silent', () => {
  it('a rejected fetch neither throws nor logs', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({ fetch: () => Promise.reject(new Error('offline')) });
    expect(() => target.dispatchEvent(errorEvent('x', new Error('x')))).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  it('a fetch that throws synchronously neither throws nor logs', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({ fetch: () => { throw new Error('sync'); } });
    expect(() => target.dispatchEvent(errorEvent('x', new Error('x')))).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing when no fetch exists', () => {
    const saved = globalThis.fetch;
    delete (globalThis as { fetch?: unknown }).fetch;
    try {
      const t = new EventTarget();
      dispose = installErrorReporter({ target: t });
      expect(() => t.dispatchEvent(errorEvent('x', new Error('x')))).not.toThrow();
    } finally {
      globalThis.fetch = saved;
    }
  });

  it('swallows a failure while building the report', () => {
    setup();
    jest.spyOn(useUiStore, 'getState').mockImplementation(() => { throw new Error('store'); });
    expect(() => reportClientError('error', new Error('x'))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('error-reporter — context', () => {
  it.each([
    ['connected', 'game'],
    ['reconnecting', 'game'],
    ['disconnected', 'login'],
    ['connecting', 'login'],
  ] as const)('status %s → screen %s', (status, screen) => {
    setup();
    useGameStore.setState({ status });
    reportClientError('error', new Error('ctx'));
    expect(bodies()[0].screen).toBe(screen);
  });

  it('surface is the top of the stack, or null', () => {
    setup();
    reportClientError('error', new Error('a'));
    useUiStore.setState({ stack: [{ kind: 'mail' }, { kind: 'building' }] });
    reportClientError('error', new Error('b'));
    expect(bodies().map(b => b.surface)).toEqual([null, 'building']);
  });

  it.each([
    [CHROME_DESKTOP, 'chrome', false],
    [EDGE, 'edge', false],
    [FIREFOX, 'firefox', false],
    [IPHONE_SAFARI, 'safari', true],
    [ANDROID_CHROME, 'chrome', true],
    ['curl/8.0', 'other', false],
  ] as const)('user agent %s → %s, mobile %s', (userAgent, ua, mobile) => {
    setup({ userAgent });
    reportClientError('error', new Error('ua'));
    const body = bodies()[0];
    expect(body.ua).toBe(ua);
    expect(body.mobile).toBe(mobile);
  });
});

describe('error-reporter — install', () => {
  it('is idempotent', () => {
    setup();
    const again = installErrorReporter({ target, fetch: fetchMock });
    expect(again).toBe(dispose);
    target.dispatchEvent(errorEvent('once', new Error('once')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('installs without a window in node, and the disposer works', () => {
    expect(() => { dispose = installErrorReporter(); }).not.toThrow();
    expect(() => dispose?.()).not.toThrow();
    dispose = null;
  });

  it('main.tsx installs the reporter before building the client and the React root', () => {
    const source = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');
    const install = source.indexOf('installErrorReporter()');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(source.indexOf('new StarpeaceClient('));
    expect(install).toBeLessThan(source.indexOf('createRoot('));
  });
});
