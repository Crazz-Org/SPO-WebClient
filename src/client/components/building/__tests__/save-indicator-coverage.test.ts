/**
 * Every `onSetBuildingProperty(` call under `src/client/components/` must render a
 * `SaveIndicator` bound to that write's pending key (`setBuildingPropertyImpl` names it
 * `${propertyName}` or `${propertyName}:${JSON.stringify(params)}`). Read from source, so a
 * new write without feedback turns this red. Non-literal member names are listed, with a
 * reason, in EXEMPTIONS.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENTS = path.resolve(__dirname, '..', '..');

interface Site { file: string; line: number; arg: string }
interface Exemption { file: string; arg: string; reason: string }

export const EXEMPTIONS: Exemption[] = [
  {
    file: 'building/PropertyGroup.tsx',
    arg: 'resolved.command',
    reason: 'The member is resolved at run time from rdoCommands; its indicator is keyed by '
      + 'computePendingKey(def.rdoName, rdoCommands) inside SliderInput / TextInput / '
      + 'PropertyTables / ProductsGroup, so the name cannot be read from source.',
  },
  {
    file: 'building/PropertyGroup.tsx',
    arg: 'rdoName',
    reason: 'The WarehouseWares callback forwards whatever member the child names, so the '
      + 'member is not written literally at the call.',
  },
];

const CALL_RE = /onSetBuildingProperty\(\s*[^,]+,\s*[^,]+,\s*([^,]+?)\s*,/g;

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...listSources(full));
    } else if (entry.name.endsWith('.tsx') && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function collectSites(file: string, source: string): Site[] {
  const sites: Site[] = [];
  for (const m of source.matchAll(CALL_RE)) {
    const line = source.slice(0, m.index).split('\n').length;
    sites.push({ file, line, arg: m[1].trim() });
  }
  return sites;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function binds(source: string, prop: string): boolean {
  const key = new RegExp(`(?:propertyKey|pendingKey)\\s*=\\s*\\{?\\s*[\`'"]${escapeRe(prop)}(?=[:\`'"])`);
  return source.includes('<SaveIndicator') && key.test(source);
}

/** The call-site file plus every same-directory file it imports via `from './X'`. */
function relatedSources(absFile: string, source: string): string[] {
  const sources = [source];
  for (const m of source.matchAll(/from '\.\/([\w-]+)'/g)) {
    const candidate = path.join(path.dirname(absFile), `${m[1]}.tsx`);
    if (fs.existsSync(candidate)) sources.push(fs.readFileSync(candidate, 'utf8'));
  }
  return sources;
}

export function unboundLiteralSites(sites: Site[], sourcesFor: (s: Site) => string[]): string[] {
  const unbound: string[] = [];
  for (const site of sites) {
    const lit = /^'(\w+)'$/.exec(site.arg);
    if (!lit) continue;
    if (!sourcesFor(site).some((src) => binds(src, lit[1]))) {
      unbound.push(`${site.file}:${site.line} ${lit[1]}`);
    }
  }
  return unbound;
}

const all: Site[] = [];
const sourceByFile = new Map<string, { abs: string; text: string }>();
for (const abs of listSources(COMPONENTS)) {
  const rel = path.relative(COMPONENTS, abs).split(path.sep).join('/');
  const text = fs.readFileSync(abs, 'utf8');
  sourceByFile.set(rel, { abs, text });
  all.push(...collectSites(rel, text));
}

describe('every building-property write renders a bound SaveIndicator', () => {
  it('finds the call sites (a broken matcher cannot pass by finding nothing)', () => {
    expect(all.length).toBeGreaterThanOrEqual(16);
  });

  it('every literal write has an indicator bound to its key', () => {
    const unbound = unboundLiteralSites(all, (site) => {
      const entry = sourceByFile.get(site.file);
      return entry ? relatedSources(entry.abs, entry.text) : [];
    });
    expect(unbound).toEqual([]);
  });

  it('every non-literal write is a reasoned exemption', () => {
    const unexempt = all
      .filter((s) => !/^'\w+'$/.test(s.arg))
      .filter((s) => !EXEMPTIONS.some((e) => e.file === s.file && e.arg === s.arg))
      .map((s) => `${s.file}:${s.line} ${s.arg}`);
    expect(unexempt).toEqual([]);
    for (const e of EXEMPTIONS) expect(e.reason.trim().length).toBeGreaterThan(0);
  });

  it('no exemption is stale', () => {
    const stale = EXEMPTIONS.filter((e) => !all.some((s) => s.file === e.file && s.arg === e.arg));
    expect(stale).toEqual([]);
  });

  it('the matcher reports a literal write with no indicator', () => {
    const src = "client.onSetBuildingProperty(x, y, 'RDOSetFoo', '1', { a });\n<SaveIndicator propertyKey=\"Other\" />";
    const sites = collectSites('fake.tsx', src);
    expect(unboundLiteralSites(sites, () => [src])).toEqual(['fake.tsx:1 RDOSetFoo']);
    const bound = src + '\n<SaveIndicator propertyKey={`RDOSetFoo:${x}`} />';
    expect(unboundLiteralSites(sites, () => [bound])).toEqual([]);
  });
});
