import { describe, it, expect } from '@jest/globals';
import { resolveClientIp } from './client-ip';

const SOCKET = '::ffff:10.0.0.9';

describe('resolveClientIp', () => {
  it('ignores X-Forwarded-For when trustProxy is off', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '1.2.3.4' }, SOCKET, false)).toBe('10.0.0.9');
  });

  it('returns the single entry of an honest nginx header', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '203.0.113.7' }, SOCKET, true)).toBe('203.0.113.7');
  });

  it('ignores a spoofed leftmost entry', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, SOCKET, true)).toBe('203.0.113.7');
  });

  it('ignores several spoofed entries', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' }, SOCKET, true)).toBe(
      '203.0.113.7',
    );
  });

  it('resolves headers sharing a rightmost entry to the same IP', () => {
    const a = resolveClientIp({ 'x-forwarded-for': '5.5.5.5, 203.0.113.7' }, SOCKET, true);
    const b = resolveClientIp({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, SOCKET, true);
    expect(a).toBe(b);
  });

  it('strips ::ffff: from the rightmost entry', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '1.2.3.4, ::ffff:203.0.113.7' }, SOCKET, true)).toBe('203.0.113.7');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['ending in an empty entry', '1.2.3.4, '],
  ])('falls back to the socket address when the header is %s', (_label, xff) => {
    const headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
    expect(resolveClientIp(headers, SOCKET, true)).toBe('10.0.0.9');
  });

  it('returns 0.0.0.0 with no usable header and no socket address', () => {
    expect(resolveClientIp({}, undefined, true)).toBe('0.0.0.0');
  });
});
