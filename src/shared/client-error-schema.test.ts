import { describe, it, expect } from '@jest/globals';
import {
  validateClientErrorReport,
  MAX_MESSAGE_CHARS,
  MAX_FRAMES,
  MAX_FRAME_CHARS,
} from './client-error-schema';

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    build: '1.4.2#317',
    kind: 'error',
    message: 'TypeError: x is undefined',
    frames: ['main.abc.js:1:2345'],
    screen: 'game',
    surface: 'BuildingInspector',
    ua: 'firefox',
    mobile: false,
    ...over,
  };
}

function without(key: string): Record<string, unknown> {
  const r = report();
  delete r[key];
  return r;
}

describe('validateClientErrorReport', () => {
  it('accepts a valid report and returns exactly the nine keys, frames copied', () => {
    const input = report();
    const result = validateClientErrorReport(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.report).sort()).toEqual(
      ['build', 'frames', 'kind', 'message', 'mobile', 'screen', 'surface', 'ua', 'v'],
    );
    expect(result.report).toEqual(input);
    expect(result.report.frames).not.toBe(input.frames);
  });

  it('accepts surface null and an empty frames array, and the caps exactly', () => {
    expect(validateClientErrorReport(report({ surface: null, frames: [] })).ok).toBe(true);
    expect(validateClientErrorReport(report({
      message: 'm'.repeat(MAX_MESSAGE_CHARS),
      frames: Array.from({ length: MAX_FRAMES }, () => 'f'.repeat(MAX_FRAME_CHARS)),
      build: 'b'.repeat(64),
      surface: 'S'.repeat(32),
    })).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [report()]],
    ['a string', 'report'],
  ])('refuses %s', (_label, value) => {
    expect(validateClientErrorReport(value)).toEqual({ ok: false, error: 'report must be a JSON object' });
  });

  it.each([
    ['extra username', report({ username: 'x' })],
    ['extra world', report({ world: 'planitia' })],
    ['extra tycoon', report({ tycoon: 'x' })],
    ['__proto__ from JSON', JSON.parse(`{"__proto__":{"a":1},${JSON.stringify(report()).slice(1)}`) as unknown],
    ['missing build', without('build')],
    ['missing mobile', without('mobile')],
    ['v 2', report({ v: 2 })],
    ['empty build', report({ build: '' })],
    ['65-char build', report({ build: 'b'.repeat(65) })],
    ['build with space', report({ build: '1.0 beta' })],
    ['kind other', report({ kind: 'other' })],
    ['empty message', report({ message: '' })],
    ['301-char message', report({ message: 'm'.repeat(MAX_MESSAGE_CHARS + 1) })],
    ['message not a string', report({ message: 42 })],
    ['frames not an array', report({ frames: 'a' })],
    ['6 frames', report({ frames: Array.from({ length: MAX_FRAMES + 1 }, () => 'f') })],
    ['201-char frame', report({ frames: ['f'.repeat(MAX_FRAME_CHARS + 1)] })],
    ['non-string frame', report({ frames: [1] })],
    ['screen lobby', report({ screen: 'lobby' })],
    ['surface "a b"', report({ surface: 'a b' })],
    ['surface number', report({ surface: 3 })],
    ['33-letter surface', report({ surface: 'S'.repeat(33) })],
    ['ua opera', report({ ua: 'opera' })],
    ['mobile "yes"', report({ mobile: 'yes' })],
  ])('refuses %s', (_label, value) => {
    expect(validateClientErrorReport(value).ok).toBe(false);
  });

  it('names the missing field without echoing data', () => {
    expect(validateClientErrorReport(without('build'))).toEqual({ ok: false, error: 'build is required' });
  });

  it('never echoes a submitted value in the refusal reason', () => {
    for (const bad of [
      report({ username: 'ZZ_SECRET_NAME' }),
      report({ kind: 'ZZ_SECRET_NAME' }),
      report({ ua: 'ZZ_SECRET_NAME' }),
      report({ surface: 'ZZ SECRET NAME' }),
    ]) {
      const result = validateClientErrorReport(bad);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).not.toContain('ZZ_SECRET_NAME');
      expect(result.error).not.toContain('ZZ SECRET NAME');
    }
  });
});
