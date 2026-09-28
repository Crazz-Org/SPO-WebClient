/**
 * The gateway's per-IP ceilings (SEC-H-4, SEC-W-3, SEC-W-5) and the limiter that enforces
 * them. The pins fail the moment anyone raises a ceiling. Fake timers drive the window; no
 * directory or image fetch happens — the limiter is called directly.
 */
import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';

type RateLimitModule = typeof import('./rate-limit');

const IP = '203.0.113.7';
const AUTH_TYPES = ['REQ_AUTH_CHECK', 'REQ_CONNECT_DIRECTORY', 'REQ_LOGIN_WORLD'] as const;

let rl: RateLimitModule;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  rl = require('./rate-limit') as RateLimitModule;
});

afterAll(() => {
  jest.useRealTimers();
});

describe('ceilings are pinned at the production values', () => {
  it('auth 10, proxy 60, WS 20 per IP, window 60 s', () => {
    expect(rl.RATE_LIMIT_MAX_AUTH).toBe(10);
    expect(rl.RATE_LIMIT_MAX_PROXY).toBe(60);
    expect(rl.WS_MAX_CONNECTIONS_PER_IP).toBe(20);
    expect(rl.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('the auth set is exactly the three credential-bearing message types', () => {
    expect([...rl.AUTH_RATE_LIMITED_TYPES].sort()).toEqual([...AUTH_TYPES].sort());
  });
});

describe('proxy-image limit', () => {
  it('accepts the 60th request, refuses the 61st, accepts again after the window', () => {
    for (let i = 0; i < 60; i++) {
      expect(rl.checkRateLimit(IP, 'proxy', rl.RATE_LIMIT_MAX_PROXY)).toBe(true);
    }
    expect(rl.checkRateLimit(IP, 'proxy', rl.RATE_LIMIT_MAX_PROXY)).toBe(false);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.checkRateLimit(IP, 'proxy', rl.RATE_LIMIT_MAX_PROXY)).toBe(true);
  });

  it('counts each IP separately', () => {
    for (let i = 0; i < 61; i++) rl.checkRateLimit(IP, 'proxy', rl.RATE_LIMIT_MAX_PROXY);
    expect(rl.checkRateLimit(IP, 'proxy', rl.RATE_LIMIT_MAX_PROXY)).toBe(false);
    expect(rl.checkRateLimit('198.51.100.1', 'proxy', rl.RATE_LIMIT_MAX_PROXY)).toBe(true);
  });
});

describe('auth limit — one bucket per message type', () => {
  it.each(AUTH_TYPES)('%s: 10th accepted, 11th refused, accepted again after the window', type => {
    for (let i = 0; i < 10; i++) {
      expect(rl.checkAuthRateLimit(IP, type)).toBe(true);
    }
    expect(rl.checkAuthRateLimit(IP, type)).toBe(false);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.checkAuthRateLimit(IP, type)).toBe(true);
  });

  it('10 full three-message logins from one IP pass; the 11th REQ_AUTH_CHECK is refused', () => {
    for (let login = 0; login < 10; login++) {
      for (const type of AUTH_TYPES) {
        expect(rl.checkAuthRateLimit(IP, type)).toBe(true);
      }
    }
    expect(rl.checkAuthRateLimit(IP, 'REQ_AUTH_CHECK')).toBe(false);
  });

  it('a non-auth message passes uncounted', () => {
    for (let i = 0; i < 11; i++) {
      expect(rl.checkAuthRateLimit(IP, 'REQ_MAP_LOAD')).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      expect(rl.checkAuthRateLimit(IP, 'REQ_AUTH_CHECK')).toBe(true);
    }
    expect(rl.sweepExpiredRateLimits(Date.now() + rl.RATE_LIMIT_WINDOW_MS + 1)).toBe(1);
  });

  it('another IP has its own buckets', () => {
    for (let i = 0; i < 11; i++) rl.checkAuthRateLimit(IP, 'REQ_AUTH_CHECK');
    expect(rl.checkAuthRateLimit(IP, 'REQ_AUTH_CHECK')).toBe(false);
    expect(rl.checkAuthRateLimit('198.51.100.1', 'REQ_AUTH_CHECK')).toBe(true);
  });
});

describe('sweepExpiredRateLimits', () => {
  it('removes nothing before expiry and every entry after the window', () => {
    rl.checkRateLimit('a', 'proxy', 60);
    rl.checkRateLimit('b', 'proxy', 60);
    rl.checkAuthRateLimit('a', 'REQ_LOGIN_WORLD');
    expect(rl.sweepExpiredRateLimits()).toBe(0);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.sweepExpiredRateLimits()).toBe(3);
    expect(rl.sweepExpiredRateLimits()).toBe(0);
  });

  it('evicts expired entries itself once the map reaches 10 000 keys', () => {
    for (let i = 0; i < 10_000; i++) rl.checkRateLimit(`ip-${i}`, 'proxy', 60);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.checkRateLimit('fresh', 'proxy', 60)).toBe(true);
    // The forced eviction already removed the 10 000 expired keys; only 'fresh' remains, unexpired.
    expect(rl.sweepExpiredRateLimits()).toBe(0);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.sweepExpiredRateLimits()).toBe(1);
  });
});

describe('checkResumeRateLimit', () => {
  it('counts REQ_RESUME_SESSION in its own per-IP auth bucket at the auth ceiling', () => {
    for (let i = 0; i < rl.RATE_LIMIT_MAX_AUTH; i++) expect(rl.checkResumeRateLimit(IP)).toBe(true);
    expect(rl.checkResumeRateLimit(IP)).toBe(false);
    // Separate from the three login buckets, and from another IP
    expect(rl.checkAuthRateLimit(IP, 'REQ_LOGIN_WORLD')).toBe(true);
    expect(rl.checkResumeRateLimit('198.51.100.2')).toBe(true);
  });

  it('refills after the window', () => {
    for (let i = 0; i <= rl.RATE_LIMIT_MAX_AUTH; i++) rl.checkResumeRateLimit(IP);
    expect(rl.checkResumeRateLimit(IP)).toBe(false);
    jest.advanceTimersByTime(rl.RATE_LIMIT_WINDOW_MS + 1);
    expect(rl.checkResumeRateLimit(IP)).toBe(true);
  });
});
