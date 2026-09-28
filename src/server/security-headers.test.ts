import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildContentSecurityPolicy } from './security-headers';

const CDN = 'https://spo.zz.works';
const TAIL =
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function directive(policy: string, name: string): string[] {
  const entry = policy.split('; ').find((d) => d.startsWith(`${name} `));
  if (!entry) throw new Error(`no ${name}`);
  return entry.split(' ').slice(1);
}

describe('buildContentSecurityPolicy', () => {
  it('pins the policy for a normal host with the default CDN', () => {
    expect(buildContentSecurityPolicy('spo.example.com', CDN)).toBe(
      `default-src 'self'; connect-src 'self' ws://spo.example.com wss://spo.example.com https://spo.zz.works; img-src 'self' data: blob: https://spo.zz.works; ${TAIL}`,
    );
  });

  it('pins the policy for localhost:8081 with no CDN', () => {
    expect(buildContentSecurityPolicy('localhost:8081', '')).toBe(
      `default-src 'self'; connect-src 'self' ws://localhost:8081 wss://localhost:8081; img-src 'self' data: blob:; ${TAIL}`,
    );
  });

  const missing = `default-src 'self'; connect-src 'self' https://spo.zz.works; img-src 'self' data: blob: https://spo.zz.works; ${TAIL}`;

  it('pins the policy for a missing Host', () => {
    expect(buildContentSecurityPolicy(undefined, CDN)).toBe(missing);
  });

  it.each(['evil.example; script-src *', '[::1]:8080', ''])('drops ws origins for unsafe Host %p', (host) => {
    const policy = buildContentSecurityPolicy(host, CDN);
    expect(policy).not.toMatch(/wss?:\/\//);
    expect(policy).toBe(missing);
    expect(policy.split('; ')).toHaveLength(buildContentSecurityPolicy('spo.example.com', CDN).split('; ').length);
  });

  it('every client WebSocket is built from the page host', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          files.push(p);
        }
      }
    };
    walk(path.join(__dirname, '..', 'client'));
    const count = (s: string, needle: string): number => s.split(needle).length - 1;
    let total = 0;
    let viaUrl = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const n = count(src, 'new WebSocket(');
      const m = count(src, 'new WebSocket(url)');
      total += n;
      viaUrl += m;
      if (m > 0) {
        expect(count(src, 'const url = `${protocol}//${window.location.host}/ws`;')).toBe(m);
        expect(count(src, "const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';")).toBe(m);
      }
    }
    expect(total).toBeGreaterThanOrEqual(1);
    expect(viaUrl).toBe(total);
  });

  it.each([
    ['localhost:8080', 'ws:'],
    ['localhost:8080', 'wss:'],
    ['spo.example.com', 'ws:'],
    ['spo.example.com', 'wss:'],
  ])('allows the client socket for host %s over %s', (host, protocol) => {
    const url = `${protocol}//${host}/ws`;
    expect(directive(buildContentSecurityPolicy(host, CDN), 'connect-src')).toContain(new URL(url).origin);
  });

  it('allows a configured CDN in connect-src and img-src', () => {
    const policy = buildContentSecurityPolicy('spo.example.com', 'https://cdn.example.net');
    expect(directive(policy, 'connect-src')).toContain('https://cdn.example.net');
    expect(directive(policy, 'img-src')).toContain('https://cdn.example.net');
  });
});
