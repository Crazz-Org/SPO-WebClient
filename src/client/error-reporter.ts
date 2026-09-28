/**
 * Browser error reporter — sends uncaught errors, unhandled rejections, error-boundary
 * catches and failed lazy chunks to the gateway's anonymous `POST /api/client-error`
 * (contract in `shared/client-error-schema.ts`).
 *
 * - **No identity leaves the browser.** The player's name, role, tycoon id, world and company
 *   (read from `useGameStore`) are replaced with placeholders, and every quoted segment is
 *   blanked, in the message and in every stack frame. A non-Error rejection sends a fixed text,
 *   never the value's own text (it can be a server reply naming anyone).
 * - **At most `MAX_REPORTS_PER_PAGE` distinct reports per page load**, then silence until reload.
 * - **`keepalive`** lets the request finish when the tab reloads right after a
 *   `vite:preloadError` (the reload belongs to `stale-bundle.ts`; this listener only reports).
 * - **No `navigator.sendBeacon`**: it cannot set `Content-Type: application/json`, which the
 *   endpoint requires so other sites cannot post through a player's browser.
 * - The reporter never throws, never logs and never reports its own failure.
 */

import { useGameStore } from './store/game-store';
import { useUiStore } from './store/ui-store';
import { APP_VERSION, BUILD_NUMBER } from './version';
import {
  MAX_MESSAGE_CHARS,
  MAX_FRAMES,
  MAX_FRAME_CHARS,
  type ClientErrorKind,
  type ClientErrorReport,
  type ClientErrorUa,
} from '../shared/client-error-schema';

export const CLIENT_ERROR_URL = '/api/client-error';
export const MAX_REPORTS_PER_PAGE = 5;

export interface ErrorReporterOptions {
  /** Default: `window`. */
  target?: EventTarget;
  /** Default: `globalThis.fetch`, resolved at send time. */
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
  /** Default: `location.origin`. */
  origin?: string;
  /** Default: `navigator.userAgent`. */
  userAgent?: string;
}

let installed: (() => void) | null = null;
let options: ErrorReporterOptions = {};
const sentKeys = new Set<string>();
let sentCount = 0;

const FRAME_PATTERN = /:\d+:\d+\)?$/;
const QUERY_PATTERN = /\?[^:)\s]*/g;

function scrub(text: string): string {
  const s = useGameStore.getState();
  const identities: Array<[unknown, string]> = [
    [s.username, '<user>'],
    [s.activeUsername, '<user>'],
    [s.ownerRole, '<user>'],
    [s.tycoonId, '<tycoon>'],
    [s.worldName, '<world>'],
    [s.companyName, '<company>'],
  ];
  const pairs = identities
    .filter((p): p is [string, string] => typeof p[0] === 'string' && p[0].length >= 3)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [value, placeholder] of pairs) {
    out = out.split(value).join(placeholder);
  }
  return out
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, '"…"')
    .replace(/“[^”]*”/g, '"…"');
}

function uaFamily(ua: string): ClientErrorUa {
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox/')) return 'firefox';
  if (ua.includes('Chrome/') || ua.includes('CriOS/')) return 'chrome';
  if (ua.includes('Safari/')) return 'safari';
  return 'other';
}

function framesOf(stack: string): string[] {
  const origin = options.origin ?? globalThis.location?.origin ?? '';
  return stack
    .split('\n')
    .map(line => line.trim())
    .filter(line => FRAME_PATTERN.test(line))
    .slice(0, MAX_FRAMES)
    .map(line => {
      let frame = origin ? line.split(origin).join('') : line;
      frame = frame.replace(QUERY_PATTERN, '');
      return scrub(frame).trim().slice(0, MAX_FRAME_CHARS);
    });
}

function send(kind: ClientErrorKind, rawMessage: string, stack: string): void {
  try {
    const message = scrub(rawMessage).slice(0, MAX_MESSAGE_CHARS) || '(no message)';
    const frames = framesOf(stack);

    const status = useGameStore.getState().status;
    const screen = status === 'connected' || status === 'reconnecting' ? 'game' : 'login';
    const surfaces = useUiStore.getState().stack;
    const top = surfaces[surfaces.length - 1];
    const surface = top ? top.kind : null;
    const uaString = options.userAgent ?? globalThis.navigator?.userAgent ?? '';

    const report: ClientErrorReport = {
      v: 1,
      build: `${APP_VERSION}#${BUILD_NUMBER}`,
      kind,
      message,
      frames,
      screen,
      surface,
      ua: uaFamily(uaString),
      mobile: /Mobi|Android/.test(uaString),
    };

    const key = kind + '|' + message + '|' + (frames[0] ?? '');
    if (sentKeys.has(key) || sentCount >= MAX_REPORTS_PER_PAGE) return;
    sentKeys.add(key);
    sentCount++;

    const doFetch = options.fetch ?? globalThis.fetch;
    if (typeof doFetch !== 'function') return;
    const result = doFetch(CLIENT_ERROR_URL, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    Promise.resolve(result).catch(() => undefined);
  } catch {
    // Swallowed: the reporter never throws and never reports its own failure.
  }
}

/** Build and send one report. Never throws. */
export function reportClientError(kind: ClientErrorKind, error: unknown): void {
  if (error instanceof Error) {
    send(kind, error.message, error.stack ?? '');
  } else {
    send(kind, `non-Error ${kind} (${typeof error})`, '');
  }
}

function isNoise(text: string): boolean {
  return text === 'Script error.' || text.startsWith('ResizeObserver loop');
}

/**
 * Listen for `error`, `unhandledrejection` and `vite:preloadError` on `window` (or the given
 * target). Idempotent: a second call adds nothing and returns the same disposer.
 */
export function installErrorReporter(opts: ErrorReporterOptions = {}): () => void {
  if (installed) return installed;
  options = opts;
  const target = opts.target ?? (typeof window !== 'undefined' ? window : undefined);

  const onError = (event: Event): void => {
    const ev = event as unknown as { message?: unknown; error?: unknown };
    const browserText = String(ev.message ?? '');
    if (isNoise(browserText)) return;
    if (ev.error instanceof Error) {
      if (isNoise(ev.error.message)) return;
      reportClientError('error', ev.error);
    } else {
      send('error', browserText, '');
    }
  };
  const onRejection = (event: Event): void => {
    reportClientError('rejection', (event as unknown as { reason?: unknown }).reason);
  };
  const onPreloadError = (event: Event): void => {
    reportClientError('chunk', (event as unknown as { payload?: unknown }).payload);
  };

  target?.addEventListener('error', onError);
  target?.addEventListener('unhandledrejection', onRejection);
  target?.addEventListener('vite:preloadError', onPreloadError);

  const dispose = (): void => {
    target?.removeEventListener('error', onError);
    target?.removeEventListener('unhandledrejection', onRejection);
    target?.removeEventListener('vite:preloadError', onPreloadError);
    installed = null;
    options = {};
    sentKeys.clear();
    sentCount = 0;
  };
  installed = dispose;
  return dispose;
}
