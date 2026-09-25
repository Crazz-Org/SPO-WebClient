/**
 * Substrate discipline for L1 scenario tests (issue 918).
 *
 * A scenario test checks the client against a CAPTURED server answer: an
 * `RdoMock` loaded with a `create*Scenario()` factory, answered through
 * `fake.respond(...)`. Stubbing `fake.cacher.*` / `fake.ctx.*` instead tests
 * the author's belief about the server. This sweep fails when a sibling test
 * (a) imports no `create*Scenario` factory, or (b) stubs `fake.cacher.*` /
 * `fake.ctx.*` — unless the line (or the file header) carries
 * `// substrate-exception: <why the capture cannot answer this>`.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const SELF = path.basename(__filename);

/** Tests `scenario-variables.ts` (variable substitution), which no scenario captures. */
const FACTORY_EXEMPT = new Set(['scenario-variables.test.ts']);

/** Ratchet — may only go DOWN; lower it when an exception is removed, never raise it. */
const MAX_SUBSTRATE_EXCEPTIONS = 36;

const EXCEPTION_RE = /\/\/\s*substrate-exception:\s*\S/;
const STUB_SOURCE =
  /\bfake\.(?:cacher|ctx)\.\w+(?:\s+as\s+[^)]*\))?\s*\.(?:mockResolvedValue|mockImplementation|mockReturnValue|mockRejectedValue)(?:Once)?\(/
    .source;
const FACTORY_IMPORT_RE = /import\s+(?:type\s+)?\{[^}]*\bcreate\w*Scenario\b[^}]*\}\s*from/;

interface StubSite {
  startLine: number;
  endLine: number;
  text: string;
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function findStubSites(src: string): StubSite[] {
  const re = new RegExp(STUB_SOURCE, 'g');
  const sites: StubSite[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    sites.push({
      startLine: lineAt(src, m.index),
      endLine: lineAt(src, m.index + m[0].length),
      text: m[0].replace(/\s+/g, ' '),
    });
  }
  return sites;
}

function hasFileException(src: string): boolean {
  for (const line of src.split('\n')) {
    if (line.startsWith('import ')) return false;
    if (EXCEPTION_RE.test(line)) return true;
  }
  return false;
}

function siteHasLineException(lines: string[], site: StubSite): boolean {
  for (let i = site.startLine; i <= site.endLine; i++) {
    if (EXCEPTION_RE.test(lines[i - 1] ?? '')) return true;
  }
  return false;
}

function countExceptions(src: string): number {
  return src.split('\n').filter((l) => EXCEPTION_RE.test(l)).length;
}

const siblings = fs
  .readdirSync(__dirname)
  .filter((f) => /\.test\.tsx?$/.test(f) && f !== SELF)
  .sort();
const sources = new Map(siblings.map((f) => [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]));

describe('substrate discipline — scanner self-check', () => {
  it('detects every stub form', () => {
    expect(findStubSites('fake.cacher.getPropertyList.mockResolvedValue([])')).toHaveLength(1);
    expect(findStubSites('fake.ctx.focusBuilding.mockImplementationOnce(() => x)')).toHaveLength(1);
    expect(findStubSites('fake.cacher.setObject.mockRejectedValueOnce(err)')).toHaveLength(1);
    const cast = "x;\n(fake.ctx.fetchAspPage as jest.MockedFunction<SessionContext['fetchAspPage']>)\n    .mockImplementation(f)";
    const sites = findStubSites(cast);
    expect(sites).toHaveLength(1);
    expect(sites[0].startLine).toBe(2);
    expect(sites[0].endLine).toBe(3);
  });

  it('ignores non-stubs', () => {
    for (const src of [
      'fake.respond(() => "x")',
      'mock.addScenario(s)',
      'mockFetch.mockImplementation(f)',
      'expect(fake.cacher.getPropertyList).toHaveBeenCalled()',
    ]) {
      expect(findStubSites(src)).toEqual([]);
    }
  });

  it('recognises line exceptions only with a reason, on a line the call spans', () => {
    const one = 'fake.cacher.a.mockReturnValue(1); // substrate-exception: no frame';
    expect(siteHasLineException(one.split('\n'), findStubSites(one)[0])).toBe(true);
    const empty = 'fake.cacher.a.mockReturnValue(1); // substrate-exception:';
    expect(siteHasLineException(empty.split('\n'), findStubSites(empty)[0])).toBe(false);
    const multi = '(fake.ctx.a as jest.Mock)\n  .mockReturnValue(1); // substrate-exception: why';
    expect(siteHasLineException(multi.split('\n'), findStubSites(multi)[0])).toBe(true);
    const above = '// substrate-exception: why\nfake.cacher.a.mockReturnValue(1);';
    expect(siteHasLineException(above.split('\n'), findStubSites(above)[0])).toBe(false);
  });

  it('recognises a file exception only before the imports', () => {
    expect(hasFileException("/** h */\n// substrate-exception: why\nimport { a } from 'a';")).toBe(true);
    expect(hasFileException("import { a } from 'a';\n// substrate-exception: why")).toBe(false);
    expect(countExceptions('// substrate-exception: a\nx\n// substrate-exception: b')).toBe(2);
  });

  it('matches factory imports', () => {
    expect(FACTORY_IMPORT_RE.test("import { createFooScenario } from './foo-scenario';")).toBe(true);
    expect(FACTORY_IMPORT_RE.test("import {\n  X,\n  createBarScenario,\n} from './bar';")).toBe(true);
    expect(FACTORY_IMPORT_RE.test("import { makeSessionCtx } from '@/x';")).toBe(false);
  });
});

describe('substrate discipline — sibling scenario tests', () => {
  it('sees the real sibling list, and the factory allowlist is not stale', () => {
    expect(siblings.length).toBeGreaterThan(40);
    for (const name of FACTORY_EXEMPT) {
      const src = sources.get(name);
      expect(src).toBeDefined();
      expect(FACTORY_IMPORT_RE.test(src ?? '')).toBe(false);
    }
  });

  it('(a) every sibling imports a create*Scenario factory', () => {
    const offenders = siblings.filter((f) => {
      const src = sources.get(f) ?? '';
      return !FACTORY_EXEMPT.has(f) && !hasFileException(src) && !FACTORY_IMPORT_RE.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('(b) no fake.cacher.* / fake.ctx.* stub without a substrate-exception', () => {
    let total = 0;
    const offenders: string[] = [];
    for (const f of siblings) {
      const src = sources.get(f) ?? '';
      const sites = findStubSites(src);
      total += sites.length;
      if (hasFileException(src)) continue;
      const lines = src.split('\n');
      for (const site of sites) {
        if (!siteHasLineException(lines, site)) offenders.push(`${f}:${site.startLine}: ${site.text}`);
      }
    }
    expect(total).toBeGreaterThan(0);
    // Serve the answer through `fake.respond` + an `RdoMock` scenario, or mark the line
    // `// substrate-exception: <why the capture cannot answer this>`.
    expect(offenders).toEqual([]);
  });

  it('the substrate-exception count only goes down', () => {
    let n = 0;
    for (const src of sources.values()) n += countExceptions(src);
    expect(n).toBeLessThanOrEqual(MAX_SUBSTRATE_EXCEPTIONS);
  });
});
