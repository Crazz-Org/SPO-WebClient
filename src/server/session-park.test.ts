import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'crypto';
import {
  SessionBinding,
  SessionParkRegistry,
  buildResumeSnapshot,
  readParkMs,
  readMaxParked,
  SESSION_PARK_MS_DEFAULT,
  MAX_PARKED_SESSIONS_DEFAULT,
  PARKED_EVENT_FIFO_MAX,
  RESUME_TOKEN_MAX_LENGTH,
  RESUME_REFUSED_CODE,
  type SessionSink,
} from './session-park';
import { WsMessageType, type WsMessage } from '../shared/types';
import * as ErrorCodes from '../shared/error-codes';

describe('env readers', () => {
  it.each([
    [undefined, SESSION_PARK_MS_DEFAULT],
    ['1500', 1500],
    [' 20 ', 20],
    ['0', SESSION_PARK_MS_DEFAULT],
    ['-5', SESSION_PARK_MS_DEFAULT],
    ['1.5', SESSION_PARK_MS_DEFAULT],
    ['abc', SESSION_PARK_MS_DEFAULT],
    ['99999999999999999999', SESSION_PARK_MS_DEFAULT],
  ])('SPO_SESSION_PARK_MS=%p → %p', (raw, expected) => {
    expect(readParkMs(raw === undefined ? {} : { SPO_SESSION_PARK_MS: raw })).toBe(expected);
  });

  it.each([
    [undefined, MAX_PARKED_SESSIONS_DEFAULT],
    ['0', 0],
    ['7', 7],
    ['-1', MAX_PARKED_SESSIONS_DEFAULT],
    ['x', MAX_PARKED_SESSIONS_DEFAULT],
    ['99999999999999999999', MAX_PARKED_SESSIONS_DEFAULT],
  ])('SPO_MAX_PARKED_SESSIONS=%p → %p', (raw, expected) => {
    expect(readMaxParked(raw === undefined ? {} : { SPO_MAX_PARKED_SESSIONS: raw })).toBe(expected);
  });

  it('defaults to 5 minutes and 100 parked sessions', () => {
    expect(SESSION_PARK_MS_DEFAULT).toBe(300_000);
    expect(MAX_PARKED_SESSIONS_DEFAULT).toBe(100);
    expect(RESUME_REFUSED_CODE).toBe(ErrorCodes.ERROR_AccessDenied);
  });
});

describe('SessionParkRegistry', () => {
  let expired: string[];
  let reg: SessionParkRegistry<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    expired = [];
    reg = new SessionParkRegistry<string>({ parkMs: 1000, maxParked: 2, onExpire: v => expired.push(v) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues a 32-byte base64url token and keeps only its SHA-256', () => {
    const entry = reg.register('Alice', 'a');
    const token = reg.issueToken(entry);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(entry.tokenHash).toEqual(createHash('sha256').update(token).digest());
    expect(JSON.stringify(entry)).not.toContain(token);
    expect(entry.key).toBe('ALICE');
  });

  it('claims once — the token is single-use — and clears the park timer', () => {
    const entry = reg.register('alice', 'a');
    const token = reg.issueToken(entry);
    expect(reg.park(entry, '1.1.1.1')).toBe(true);
    expect(reg.parkedCount()).toBe(1);

    const claim = reg.claim('ALICE', token);
    expect(claim).toEqual({ entry, value: 'a', parkIp: '1.1.1.1' });
    expect(reg.parkedCount()).toBe(0);
    expect(reg.claim('alice', token)).toBeNull();

    jest.advanceTimersByTime(5000);
    expect(expired).toEqual([]);

    // A rotated token works; the old one stays refused
    const next = reg.issueToken(entry);
    expect(reg.claim('alice', token)).toBeNull();
    expect(reg.claim('alice', next)).toEqual({ entry, value: 'a', parkIp: null });
  });

  it.each([
    ['an unknown token', 'alice', 'x'.repeat(43)],
    ['another username', 'bob', null],
    ['a non-string token', 'alice', 42],
    ['a non-string username', 7, null],
    ['an empty token', 'alice', ''],
    ['an overlong token', 'alice', 'y'.repeat(RESUME_TOKEN_MAX_LENGTH + 1)],
  ])('refuses %s and leaves the park untouched', (_label, user, tok) => {
    const entry = reg.register('alice', 'a');
    const token = reg.issueToken(entry);
    reg.park(entry, '1.1.1.1');
    expect(reg.claim(user, tok === null ? token : tok)).toBeNull();
    expect(reg.parkedCount()).toBe(1);
    expect(entry.parked?.ip).toBe('1.1.1.1');
    expect(reg.claim('alice', token)).not.toBeNull();
  });

  it('calls onExpire at exactly parkMs, and not before', () => {
    const entry = reg.register('alice', 'a');
    reg.issueToken(entry);
    reg.park(entry, '1.1.1.1');
    jest.advanceTimersByTime(999);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(expired).toEqual(['a']);
  });

  it('refuses to park without a token, twice, an unknown entry, or over the cap', () => {
    const a = reg.register('a', 'a');
    expect(reg.park(a, 'ip')).toBe(false);
    reg.issueToken(a);
    expect(reg.park(a, 'ip')).toBe(true);
    expect(reg.park(a, 'ip')).toBe(false);

    const b = reg.register('b', 'b');
    reg.issueToken(b);
    expect(reg.park(b, 'ip')).toBe(true);
    const c = reg.register('c', 'c');
    reg.issueToken(c);
    expect(reg.park(c, 'ip')).toBe(false); // cap of 2
    expect(reg.parkedCount()).toBe(2);

    reg.end(b);
    expect(reg.park(b, 'ip')).toBe(false); // ended entries never park again
    expect(reg.park(c, 'ip')).toBe(true);
  });

  it('a cap of 0 disables parking', () => {
    const off = new SessionParkRegistry<string>({ parkMs: 1000, maxParked: 0, onExpire: () => undefined });
    const e = off.register('a', 'a');
    off.issueToken(e);
    expect(off.park(e, 'ip')).toBe(false);
  });

  it('end is idempotent, returns the park IP once, kills the token and the timer', () => {
    const entry = reg.register('alice', 'a');
    const token = reg.issueToken(entry);
    reg.park(entry, '9.9.9.9');
    expect(reg.end(entry)).toBe('9.9.9.9');
    expect(reg.end(entry)).toBeNull();
    expect(reg.claim('alice', token)).toBeNull();
    jest.advanceTimersByTime(5000);
    expect(expired).toEqual([]);

    const attached = reg.register('bob', 'b');
    expect(reg.end(attached)).toBeNull();
  });

  it('parkedFor lists only the parked sessions of that (case-insensitive) username', () => {
    const a1 = reg.register('Alice', 'a1');
    const a2 = reg.register('alice', 'a2');
    const b = reg.register('bob', 'b');
    for (const e of [a1, a2, b]) reg.issueToken(e);
    reg.park(a1, 'ip');
    reg.park(b, 'ip');
    expect(reg.parkedFor('ALICE')).toEqual(['a1']);
    expect(reg.parkedFor('carol')).toEqual([]);
  });
});

describe('SessionBinding', () => {
  function sink(readyState = 1): SessionSink & { sent: string[] } {
    const sent: string[] = [];
    return { readyState, sent, send: (d: string) => { sent.push(d); }, terminate: () => undefined };
  }
  const ev = (type: WsMessageType, n: number): WsMessage => ({ type, n } as unknown as WsMessage);

  it('sends to an open sink and buffers nothing', () => {
    const s = sink();
    const b = new SessionBinding(s);
    b.deliver(ev(WsMessageType.EVENT_CHAT_MSG, 1));
    expect(s.sent).toEqual([JSON.stringify(ev(WsMessageType.EVENT_CHAT_MSG, 1))]);
    expect(b.takeBuffered()).toEqual([]);
    expect(b.current).toBe(s);
  });

  it('keeps only the four replay types while detached or closing, in order', () => {
    const closing = sink(2);
    const b = new SessionBinding(closing);
    b.deliver(ev(WsMessageType.EVENT_CHAT_MSG, 1));
    b.detach();
    expect(b.current).toBeNull();
    b.deliver(ev(WsMessageType.EVENT_TYCOON_UPDATE, 2));
    b.deliver(ev(WsMessageType.EVENT_SHOW_NOTIFICATION, 3));
    b.deliver(ev(WsMessageType.EVENT_NEW_MAIL, 4));
    b.deliver(ev(WsMessageType.EVENT_TYCOON_RETIRED, 5));
    expect(closing.sent).toEqual([]);
    expect(b.takeBuffered().map(e => (e as unknown as { n: number }).n)).toEqual([1, 3, 4, 5]);
    expect(b.takeBuffered()).toEqual([]);

    const next = sink();
    b.attach(next);
    b.deliver(ev(WsMessageType.EVENT_NEW_MAIL, 6));
    expect(next.sent).toHaveLength(1);
  });

  it('bounds the FIFO at 100, dropping the oldest', () => {
    const b = new SessionBinding<SessionSink>(null);
    for (let i = 0; i < PARKED_EVENT_FIFO_MAX + 5; i++) b.deliver(ev(WsMessageType.EVENT_CHAT_MSG, i));
    const kept = b.takeBuffered().map(e => (e as unknown as { n: number }).n);
    expect(kept).toHaveLength(PARKED_EVENT_FIFO_MAX);
    expect(kept[0]).toBe(5);
    expect(kept[kept.length - 1]).toBe(PARKED_EVENT_FIFO_MAX + 4);
  });
});

describe('buildResumeSnapshot', () => {
  const source = (overrides: Record<string, unknown> = {}) => ({
    tycoonId: '42',
    currentWorldInfo: { name: 'Planitia' },
    currentCompany: { id: 'c1', name: 'Acme', ownerRole: 'Mayor' },
    getWorldXSize: () => 1000,
    getWorldYSize: () => 900,
    getWorldSeason: () => 2,
    getAccountMoney: () => '12345',
    getVirtualDate: () => 7777,
    getFailureLevel: () => 0,
    getPlayerPosition: () => ({ x: 10, y: 20 }),
    getCurrentChannel: () => 'Lobby',
    ...overrides,
  });

  it('carries every field the client rebuilds its screen from', () => {
    expect(buildResumeSnapshot('SPO_test3', source())).toEqual({
      username: 'SPO_test3',
      tycoonId: '42',
      worldName: 'Planitia',
      worldXSize: 1000,
      worldYSize: 900,
      worldSeason: 2,
      company: { id: 'c1', name: 'Acme', ownerRole: 'Mayor' },
      accountMoney: '12345',
      virtualDate: 7777,
      failureLevel: 0,
      playerX: 10,
      playerY: 20,
      chatChannel: 'Lobby',
    });
  });

  it('nulls a missing world and company, and omits an absent ownerRole', () => {
    const snap = buildResumeSnapshot('u', source({ currentWorldInfo: null, currentCompany: null }));
    expect(snap.worldName).toBeNull();
    expect(snap.company).toBeNull();
    const noRole = buildResumeSnapshot('u', source({ currentCompany: { id: 'c', name: 'n' } }));
    expect(noRole.company).toEqual({ id: 'c', name: 'n' });
  });
});
