import { describe, it, expect } from '@jest/globals';
import { buildRuntimeConfigScript } from './runtime-config';

describe('buildRuntimeConfigScript', () => {
  it('always assigns the CDN url, and nothing else by default', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: 'https://spo.zz.works' }))
      .toBe('window.__SPO_CDN_URL__="https://spo.zz.works";');
  });

  it('emits an empty CDN url as an empty string — that is what routes the client through /cdn/', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '' })).toBe('window.__SPO_CDN_URL__="";');
  });

  it('announces single-user mode when it is on', () => {
    const body = buildRuntimeConfigScript({ cdnUrl: '', singleUserMode: true });
    expect(body.split('\n')).toEqual([
      'window.__SPO_CDN_URL__="";',
      'window.__SPO_SINGLE_USER__=true;',
    ]);
  });

  it('says nothing about single-user mode when it is off', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', singleUserMode: false }))
      .not.toContain('__SPO_SINGLE_USER__');
  });

  it('carries a forced world, JSON-quoted', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', forceWorld: 'planitia' }))
      .toContain('window.__SPO_FORCE_WORLD__="planitia";');
  });

  it('treats an empty forced world as no forced world — an unset variable is not a world', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', forceWorld: '' }))
      .not.toContain('__SPO_FORCE_WORLD__');
  });

  it('emits both overrides together, in a fixed order', () => {
    const body = buildRuntimeConfigScript({
      cdnUrl: '',
      singleUserMode: true,
      forceWorld: 'planitia',
    });
    expect(body.split('\n')).toEqual([
      'window.__SPO_CDN_URL__="";',
      'window.__SPO_SINGLE_USER__=true;',
      'window.__SPO_FORCE_WORLD__="planitia";',
    ]);
  });

  it('announces bug-report mode when it is on', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', bugReport: true }))
      .toContain('window.__SPO_BUG_REPORT__=true;');
  });

  it('says nothing about bug-report mode when it is off', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', bugReport: false }))
      .not.toContain('__SPO_BUG_REPORT__');
    expect(buildRuntimeConfigScript({ cdnUrl: '' })).not.toContain('__SPO_BUG_REPORT__');
  });

  it('carries the registration url, JSON-quoted', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', registerUrl: 'https://example.org/signup' }))
      .toContain('window.__SPO_REGISTER_URL__="https://example.org/signup";');
  });

  it('treats an empty registration url as none — the default is no action, not the legacy SEGA page', () => {
    expect(buildRuntimeConfigScript({ cdnUrl: '', registerUrl: '' }))
      .not.toContain('__SPO_REGISTER_URL__');
    expect(buildRuntimeConfigScript({ cdnUrl: '' })).not.toContain('__SPO_REGISTER_URL__');
  });

  it('emits every override together, in a fixed order', () => {
    const body = buildRuntimeConfigScript({
      cdnUrl: '',
      singleUserMode: true,
      forceWorld: 'planitia',
      bugReport: true,
      registerUrl: 'https://example.org/signup',
    });
    expect(body.split('\n')).toEqual([
      'window.__SPO_CDN_URL__="";',
      'window.__SPO_SINGLE_USER__=true;',
      'window.__SPO_FORCE_WORLD__="planitia";',
      'window.__SPO_BUG_REPORT__=true;',
      'window.__SPO_REGISTER_URL__="https://example.org/signup";',
    ]);
  });

  it('escapes a value that would otherwise break out of the script', () => {
    const body = buildRuntimeConfigScript({ cdnUrl: 'https://x/</script>' });
    expect(body).toBe('window.__SPO_CDN_URL__="https://x/</script>";');
    expect(() => JSON.parse(body.slice('window.__SPO_CDN_URL__='.length, -1))).not.toThrow();
  });
});
