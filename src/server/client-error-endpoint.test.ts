import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';
import {
  handleClientErrorRequest,
  getClientErrorCounts,
  clientErrorSignature,
  validateClientErrorReport,
  MAX_CLIENT_ERROR_BODY_BYTES,
  CLIENT_ERROR_MAX_PER_IP,
  CLIENT_ERROR_MAX_PER_MINUTE,
  CLIENT_ERROR_WINDOW_MS,
  MAX_MESSAGE_CHARS,
  MAX_FRAMES,
  MAX_FRAME_CHARS,
  type ClientErrorCounts,
} from './client-error-endpoint';
import { Logger } from '../shared/logger';

const REMOTE = '203.0.113.9';

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    build: '1.4.2#317',
    kind: 'error',
    message: 'TypeError: x is undefined',
    frames: ['main.abc.js:1:2345', 'main.abc.js:1:999'],
    screen: 'login',
    surface: null,
    ua: 'chrome',
    mobile: false,
    ...over,
  };
}

function without(key: string): Record<string, unknown> {
  const r = report();
  delete r[key];
  return r;
}

interface FakeRes {
  status: number;
  headers: Record<string, string> | undefined;
  raw: string | undefined;
}

function drive(
  body: string | Buffer,
  opts: { contentType?: string; allow?: boolean } = {},
): FakeRes {
  const listeners: { data: Array<(c: Buffer) => void>; end: Array<() => void> } = { data: [], end: [] };
  const req = {
    headers: { 'content-type': opts.contentType ?? 'application/json' },
    socket: { remoteAddress: REMOTE },
    on(event: 'data' | 'end', listener: never) {
      (listeners[event] as unknown[]).push(listener);
      return req;
    },
  };
  const out: FakeRes = { status: 0, headers: undefined, raw: undefined };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      out.headers = headers;
    },
    end(b?: string) {
      out.raw = b;
    },
  };
  handleClientErrorRequest(req, res, { allowRequest: () => opts.allow ?? true });
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  for (const l of listeners.data) l(buf);
  for (const l of listeners.end) l();
  return out;
}

const post = (r: Record<string, unknown> = report(), opts: { contentType?: string; allow?: boolean } = {}): FakeRes =>
  drive(JSON.stringify(r), opts);

let warn: jest.SpiedFunction<Logger['warn']>;
let clock = 1_000_000_000_000;

function clientErrorCalls(): unknown[][] {
  return warn.mock.calls.filter(c => c[0] === 'CLIENT_ERROR');
}
function capCalls(): unknown[][] {
  return warn.mock.calls.filter(c => c[0] === 'CLIENT_ERROR_CAP_REACHED');
}
function delta(before: ClientErrorCounts): ClientErrorCounts {
  const now = getClientErrorCounts();
  return {
    accepted: now.accepted - before.accepted,
    refused: now.refused - before.refused,
    rateLimited: now.rateLimited - before.rateLimited,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  // Every test starts in a fresh gateway-wide window.
  clock += 2 * CLIENT_ERROR_WINDOW_MS;
  jest.setSystemTime(clock);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

afterAll(() => {
  jest.useRealTimers();
});

describe('pinned constants', () => {
  it('matches the card', () => {
    expect(MAX_CLIENT_ERROR_BODY_BYTES).toBe(8192);
    expect(CLIENT_ERROR_MAX_PER_IP).toBe(20);
    expect(CLIENT_ERROR_MAX_PER_MINUTE).toBe(60);
    expect(MAX_MESSAGE_CHARS).toBe(300);
    expect(MAX_FRAMES).toBe(5);
    expect(MAX_FRAME_CHARS).toBe(200);
    expect(typeof validateClientErrorReport).toBe('function');
  });
});

describe('handleClientErrorRequest — accept', () => {
  it('answers 204 with no body and logs exactly one CLIENT_ERROR warn with the closed meta', () => {
    const before = getClientErrorCounts();
    const res = post();
    expect(res.status).toBe(204);
    expect(res.raw).toBeUndefined();

    const calls = clientErrorCalls();
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = calls[0][1] as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(
      ['build', 'frames', 'kind', 'message', 'mobile', 'screen', 'sig', 'surface', 'ua'],
    );
    expect(meta.sig).toMatch(/^[0-9a-f]{12}$/);
    expect(meta).toMatchObject({
      kind: 'error', build: '1.4.2#317', message: 'TypeError: x is undefined',
      frames: ['main.abc.js:1:2345', 'main.abc.js:1:999'], screen: 'login', surface: null, ua: 'chrome', mobile: false,
    });
    expect(delta(before)).toEqual({ accepted: 1, refused: 0, rateLimited: 0 });
  });

  it('holds no IP: no meta value equals the request remoteAddress', () => {
    post();
    const meta = clientErrorCalls()[0][1] as Record<string, unknown>;
    for (const value of Object.values(meta)) {
      expect(value).not.toBe(REMOTE);
      expect(JSON.stringify(value)).not.toContain(REMOTE);
    }
  });

  it('gives the same sig for the same kind/message/frames and a different one otherwise', () => {
    post(report({ screen: 'login', ua: 'chrome' }));
    post(report({ screen: 'game', ua: 'firefox', surface: 'Mail' }));
    post(report({ message: 'something else' }));
    const sigs = clientErrorCalls().map(c => (c[1] as { sig: string }).sig);
    expect(sigs[0]).toBe(sigs[1]);
    expect(sigs[2]).not.toBe(sigs[0]);
    expect(sigs[0]).toBe(clientErrorSignature('error', 'TypeError: x is undefined', ['main.abc.js:1:2345', 'main.abc.js:1:999']));
  });

  it('accepts a content type with a charset parameter', () => {
    expect(post(report(), { contentType: 'application/json; charset=utf-8' }).status).toBe(204);
  });
});

describe('handleClientErrorRequest — refusals write no CLIENT_ERROR line', () => {
  it('Content-Type text/plain → 415', () => {
    const before = getClientErrorCounts();
    const res = post(report(), { contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(clientErrorCalls()).toHaveLength(0);
    expect(delta(before)).toEqual({ accepted: 0, refused: 1, rateLimited: 0 });
  });

  it('allowRequest false → 429 (per-IP)', () => {
    const before = getClientErrorCounts();
    const res = post(report(), { allow: false });
    expect(res.status).toBe(429);
    expect(JSON.parse(res.raw as string)).toEqual({ error: 'Too many error reports. Try again in a minute.' });
    expect(clientErrorCalls()).toHaveLength(0);
    expect(delta(before)).toEqual({ accepted: 0, refused: 0, rateLimited: 1 });
  });

  it('a body of 8193 bytes → 413', () => {
    const before = getClientErrorCounts();
    const res = drive(Buffer.alloc(MAX_CLIENT_ERROR_BODY_BYTES + 1, 0x20));
    expect(res.status).toBe(413);
    expect(clientErrorCalls()).toHaveLength(0);
    expect(delta(before)).toEqual({ accepted: 0, refused: 1, rateLimited: 0 });
  });

  it('invalid JSON → 400', () => {
    const before = getClientErrorCounts();
    const res = drive('{not json');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.raw as string)).toEqual({ error: 'Invalid JSON body' });
    expect(clientErrorCalls()).toHaveLength(0);
    expect(delta(before)).toEqual({ accepted: 0, refused: 1, rateLimited: 0 });
  });

  it.each([
    ['an extra username key', report({ username: 'SPO_test3' })],
    ['an extra world key', report({ world: 'planitia' })],
    ['a missing build', without('build')],
    ['kind "other"', report({ kind: 'other' })],
    ['a 301-char message', report({ message: 'm'.repeat(301) })],
    ['6 frames', report({ frames: ['a', 'b', 'c', 'd', 'e', 'f'] })],
    ['a 201-char frame', report({ frames: ['f'.repeat(201)] })],
    ['surface "a b"', report({ surface: 'a b' })],
    ['ua "opera"', report({ ua: 'opera' })],
    ['mobile "yes"', report({ mobile: 'yes' })],
  ])('%s → 400', (_label, body) => {
    const before = getClientErrorCounts();
    const res = post(body);
    expect(res.status).toBe(400);
    expect(typeof (JSON.parse(res.raw as string) as { error: unknown }).error).toBe('string');
    expect(clientErrorCalls()).toHaveLength(0);
    expect(delta(before)).toEqual({ accepted: 0, refused: 1, rateLimited: 0 });
  });

  it('a 400 body never contains the submitted value', () => {
    const res = post(report({ username: 'ZZ_SECRET_NAME' }));
    expect(res.status).toBe(400);
    expect(res.raw).not.toContain('ZZ_SECRET_NAME');
  });
});

describe('handleClientErrorRequest — gateway-wide cap', () => {
  it('refuses the 61st report in a window, warns once, and accepts again after the window', () => {
    const before = getClientErrorCounts();
    for (let i = 0; i < CLIENT_ERROR_MAX_PER_MINUTE; i++) {
      expect(post().status).toBe(204);
    }
    const res = post();
    expect(res.status).toBe(429);
    expect(JSON.parse(res.raw as string)).toEqual({ error: 'Error reporting is paused for a minute.' });
    for (let i = 0; i < 10; i++) expect(post().status).toBe(429);

    expect(capCalls()).toHaveLength(1);
    expect(capCalls()[0][1]).toEqual({ limit: CLIENT_ERROR_MAX_PER_MINUTE });
    expect(clientErrorCalls()).toHaveLength(CLIENT_ERROR_MAX_PER_MINUTE);
    expect(delta(before)).toEqual({ accepted: 60, refused: 0, rateLimited: 11 });

    jest.advanceTimersByTime(CLIENT_ERROR_WINDOW_MS);
    expect(post().status).toBe(204);
    expect(clientErrorCalls()).toHaveLength(CLIENT_ERROR_MAX_PER_MINUTE + 1);
  });

  it('re-checks the cap at accept time, for requests that passed the first check together', () => {
    for (let i = 0; i < CLIENT_ERROR_MAX_PER_MINUTE - 1; i++) post();

    // Two requests pass the up-front check before either body has ended.
    const pending: Array<{ end: () => void; res: FakeRes }> = [];
    for (let i = 0; i < 2; i++) {
      const listeners: { data: Array<(c: Buffer) => void>; end: Array<() => void> } = { data: [], end: [] };
      const req = {
        headers: { 'content-type': 'application/json' },
        on(event: 'data' | 'end', listener: never) {
          (listeners[event] as unknown[]).push(listener);
          return req;
        },
      };
      const out: FakeRes = { status: 0, headers: undefined, raw: undefined };
      handleClientErrorRequest(req, {
        writeHead: (s: number) => { out.status = s; },
        end: (b?: string) => { out.raw = b; },
      }, { allowRequest: () => true });
      pending.push({
        res: out,
        end: () => {
          for (const l of listeners.data) l(Buffer.from(JSON.stringify(report())));
          for (const l of listeners.end) l();
        },
      });
    }
    pending[0].end();
    pending[1].end();
    expect(pending[0].res.status).toBe(204);
    expect(pending[1].res.status).toBe(429);
    expect(clientErrorCalls()).toHaveLength(CLIENT_ERROR_MAX_PER_MINUTE);
  });
});
