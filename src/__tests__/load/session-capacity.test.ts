/**
 * Keeps the session-memory measurement honest: the cap formula, the compose-limit
 * reader, the forced-GC guard, and the committed `session-capacity.json` (the output
 * of `npm run load:sessions`) against both the formula and the real container limit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from '@jest/globals';
import {
  recommendSessionCap,
  readComposeMemoryLimit,
  requireGc,
  SESSION_MEMORY_RESERVE,
} from './session-capacity';

const KIB = 1024;
const MIB = 1024 * KIB;
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMPOSE_TEXT = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');

describe('recommendSessionCap', () => {
  const base = { containerLimitBytes: 512 * MIB, baselineRssBytes: 128 * MIB };

  it('512 MiB, 128 MiB baseline, 1 MiB per session → 250 (256 rounded down to 10s)', () => {
    expect(recommendSessionCap({ ...base, perSessionBytes: MIB })).toBe(250);
  });

  it('rounds a 300 KiB session down to a multiple of 10 (873 → 870)', () => {
    const cap = recommendSessionCap({ ...base, perSessionBytes: 300 * KIB });
    expect(cap).toBe(870);
    expect(cap % 10).toBe(0);
  });

  it('throws when the baseline eats 75 % of the limit or more', () => {
    expect(() =>
      recommendSessionCap({ containerLimitBytes: 512 * MIB, baselineRssBytes: 384 * MIB, perSessionBytes: KIB }),
    ).toThrow(/no session budget/);
    expect(() =>
      recommendSessionCap({ containerLimitBytes: 512 * MIB, baselineRssBytes: 500 * MIB, perSessionBytes: KIB }),
    ).toThrow(/no session budget/);
  });

  it('throws when the result is below 10', () => {
    expect(() => recommendSessionCap({ ...base, perSessionBytes: 30 * MIB })).toThrow(/below 10/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('throws on perSessionBytes %p', (perSessionBytes) => {
    expect(() => recommendSessionCap({ ...base, perSessionBytes })).toThrow(/perSessionBytes/);
  });
});

describe('readComposeMemoryLimit', () => {
  it('reads the spo-webclient limit from the real docker-compose.yml: 512M → 536870912', () => {
    const limit = readComposeMemoryLimit(COMPOSE_TEXT);
    expect(limit).toBe(536_870_912);
    expect(limit).not.toBe(268_435_456); // spo-cache-sync's 256M
  });

  it('reads spo-webclient, not a service declared before it', () => {
    const yaml = [
      'services:',
      '  spo-cache-sync:',
      '    deploy:',
      '      resources:',
      '        limits:',
      '          memory: 256M',
      '  spo-webclient:',
      '    deploy:',
      '      resources:',
      '        limits:',
      '          memory: 1G',
      '        reservations:',
      '          memory: 128M',
      'volumes:',
      '  x:',
    ].join('\n');
    expect(readComposeMemoryLimit(yaml)).toBe(1_073_741_824);
  });

  it('does not read a limit from the next service when spo-webclient has none', () => {
    const yaml = [
      'services:',
      '  spo-webclient:',
      '    image: x',
      '  spo-cache-sync:',
      '    deploy:',
      '      resources:',
      '        limits:',
      '          memory: 256M',
    ].join('\n');
    expect(() => readComposeMemoryLimit(yaml)).toThrow(/no "limits:"/);
  });

  it('throws when spo-webclient is missing', () => {
    expect(() => readComposeMemoryLimit('services:\n  other:\n    image: x\n')).toThrow(/not found/);
  });

  it('throws when limits has no memory line', () => {
    const yaml = 'services:\n  spo-webclient:\n    deploy:\n      resources:\n        limits:\n          cpus: "1.0"\n';
    expect(() => readComposeMemoryLimit(yaml)).toThrow(/no "memory:"/);
  });

  it('throws on an unknown unit', () => {
    const yaml = 'services:\n  spo-webclient:\n    deploy:\n      resources:\n        limits:\n          memory: 5T\n';
    expect(() => readComposeMemoryLimit(yaml)).toThrow(/unknown memory unit/);
  });
});

describe('requireGc', () => {
  it('returns the exposed gc function', () => {
    const fn = (): void => undefined;
    expect(requireGc({ gc: fn })).toBe(fn);
  });

  it('throws a message naming the script when gc is undefined', () => {
    expect(() => requireGc({})).toThrow(/npm run load:sessions/);
  });
});

describe('committed session-capacity.json', () => {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-capacity.json'), 'utf8'));
  const rec = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;

  const num = (key: string): number => {
    const v = rec[key];
    if (typeof v !== 'number') throw new Error(`${key} is not a number: ${String(v)}`);
    return v;
  };
  const str = (key: string): string => {
    const v = rec[key];
    if (typeof v !== 'string') throw new Error(`${key} is not a string: ${String(v)}`);
    return v;
  };

  it('has every field, typed', () => {
    for (const key of [
      'sessions',
      'perSessionHeapBytes',
      'perSessionRssBytes',
      'perSessionBytes',
      'baselineRssBytes',
      'containerLimitBytes',
      'recommendedCap',
    ]) {
      expect(Number.isInteger(num(key))).toBe(true);
    }
    expect(Number.isFinite(num('reserve'))).toBe(true);
    expect(str('measuredAt').length).toBeGreaterThan(0);
    expect(str('node').length).toBeGreaterThan(0);
    expect(['assumed', 'measured']).toContain(str('baselineSource'));
    expect(num('perSessionBytes')).toBeGreaterThan(0);
  });

  it('measured at least 50 sessions', () => {
    expect(num('sessions')).toBeGreaterThanOrEqual(50);
  });

  it('is self-consistent: perSessionBytes, reserve and recommendedCap follow from its own inputs', () => {
    expect(num('perSessionBytes')).toBe(Math.max(num('perSessionHeapBytes'), num('perSessionRssBytes')));
    expect(num('reserve')).toBe(SESSION_MEMORY_RESERVE);
    expect(num('recommendedCap')).toBe(
      recommendSessionCap({
        containerLimitBytes: num('containerLimitBytes'),
        baselineRssBytes: num('baselineRssBytes'),
        perSessionBytes: num('perSessionBytes'),
      }),
    );
  });

  it('was measured against the current docker-compose.yml limit', () => {
    expect(num('containerLimitBytes')).toBe(readComposeMemoryLimit(COMPOSE_TEXT));
  });

  it('measuredAt is an ISO date and node is v22 or later', () => {
    const measuredAt = str('measuredAt');
    expect(Number.isNaN(Date.parse(measuredAt))).toBe(false);
    expect(new Date(measuredAt).toISOString()).toBe(measuredAt);
    const major = /^v(\d+)\./.exec(str('node'));
    expect(major).not.toBeNull();
    expect(Number(major?.[1])).toBeGreaterThanOrEqual(22);
  });
});
