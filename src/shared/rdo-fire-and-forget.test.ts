/**
 * Fire-and-forget safety ratchet.
 *
 * `rdoCall(member, …).toFrame()` builds a frame with no QueryId. On a
 * `procedure` that is `"*"` — correct. On a `function` it is `"^"` with no rid:
 * a reply with no destination, and the Delphi server crashes. Typecheck alone
 * cannot stop it — `rdoCall` accepts any `RdoMemberName`, and `toFrame()` must
 * stay unchanged — so this test reads every production `.toFrame()` site from
 * the sources at test time and checks the member it names.
 *
 * The only hand-written thing here is the list of dynamic sites, one reason each.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RDO_MEMBERS } from './rdo-members';
import { rdoCall, isCataloguedRdoProcedure } from './rdo-frame';
import type { RdoProcedureName } from './rdo-frame';

const SRC = path.resolve(__dirname, '..');
const ROOTS = ['server', 'shared'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__']);

type Site =
  | { type: 'literal'; line: number; member: string }
  | { type: 'dynamic'; line: number; expr: string }
  | { type: 'unresolved'; line: number; text: string };

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        out.push(full);
      }
    }
  };
  for (const root of ROOTS) walk(path.join(SRC, root));
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function lineText(source: string, index: number): { text: string; col: number } {
  const start = source.lastIndexOf('\n', index - 1) + 1;
  const endRaw = source.indexOf('\n', index);
  const end = endRaw === -1 ? source.length : endRaw;
  return { text: source.slice(start, end), col: index - start };
}

function isCommentOrTemplate(source: string, index: number): boolean {
  const { text, col } = lineText(source, index);
  const trimmed = text.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return true;
  const ticks = (text.slice(0, col).match(/`/g) ?? []).length;
  return ticks % 2 === 1;
}

/** Every `.toFrame()` occurrence in `source`, classified. */
export function findToFrameSites(source: string): Site[] {
  const sites: Site[] = [];
  const needle = '.toFrame()';
  let at = source.indexOf(needle);
  while (at !== -1) {
    const line = lineOf(source, at);
    const before = source.slice(0, at).trimEnd();
    if (!before.endsWith(')')) {
      if (!isCommentOrTemplate(source, at)) {
        sites.push({ type: 'unresolved', line, text: lineText(source, at).text.trim() });
      }
    } else {
      let depth = 0;
      let i = before.length - 1;
      for (; i >= 0; i--) {
        const ch = before[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      const ident = /([A-Za-z_$][\w$]*)\s*$/.exec(before.slice(0, Math.max(i, 0)))?.[1] ?? '';
      if (ident === 'rdoSet' || ident === 'rdoGet') {
        // not a call — no separator involved
      } else if (ident !== 'rdoCall') {
        sites.push({ type: 'unresolved', line, text: lineText(source, at).text.trim() });
      } else {
        const inner = before.slice(i + 1, before.length - 1);
        let d = 0;
        let end = inner.length;
        for (let j = 0; j < inner.length; j++) {
          const ch = inner[j];
          if (ch === '(' || ch === '[' || ch === '{') d++;
          else if (ch === ')' || ch === ']' || ch === '}') d--;
          else if (ch === ',' && d === 0) {
            end = j;
            break;
          }
        }
        const first = inner.slice(0, end).trim();
        const lit = /^'([^']*)'$/.exec(first);
        sites.push(lit ? { type: 'literal', line, member: lit[1] } : { type: 'dynamic', line, expr: first });
      }
    }
    at = source.indexOf(needle, at + needle.length);
  }
  return sites;
}

/** Dynamic sites allowed to pass a non-literal member, keyed `file|expr`. */
const DYNAMIC_SITES: Record<string, string> = {
  'server/session/mail-handler.ts|method': 'parameter typed RdoProcedureName',
  'server/session/building-property-handler.ts|propertyName':
    'narrowed by assertCallable to RdoProcedureName',
  'server/session/tutorial-handler.ts|member':
    "const union 'RDONextStep' | 'RDOPrevStep' | 'RDOClose', all procedures",
};

describe('findToFrameSites (scanner self-test)', () => {
  it('resolves a literal procedure site', () => {
    expect(findToFrameSites("x(rdoCall('KeepAlive', id).toFrame());")).toEqual([
      { type: 'literal', line: 1, member: 'KeepAlive' },
    ]);
  });
  it('reports a literal function site by name', () => {
    expect(findToFrameSites("rdoCall('GetUserList', id).toFrame()")).toEqual([
      { type: 'literal', line: 1, member: 'GetUserList' },
    ]);
  });
  it('reports a non-literal member as dynamic', () => {
    expect(findToFrameSites('rdoCall(name, id).toFrame()')).toEqual([
      { type: 'dynamic', line: 1, expr: 'name' },
    ]);
  });
  it('ignores rdoSet and rdoGet', () => {
    expect(findToFrameSites("rdoSet('Name', id, v).toFrame(); rdoGet('W', id).toFrame()")).toEqual([]);
  });
  it('resolves a multi-line call with nested parens', () => {
    const src = "w(\n  rdoCall(\n    'RDOVote',\n    id,\n    RdoValue.string(f(a, b)),\n  ).toFrame());";
    expect(findToFrameSites(src)).toEqual([{ type: 'literal', line: 6, member: 'RDOVote' }]);
  });
  it('skips comment and template mentions', () => {
    expect(findToFrameSites(' * uses `.toFrame()` here\n// x.toFrame()\nconst s = `a.toFrame()`;')).toEqual([]);
  });
  it('flags a variable receiver and an unknown builder as unresolved', () => {
    const sites = findToFrameSites('frame.toFrame();\nbuild(x).toFrame();');
    expect(sites.map((s) => s.type)).toEqual(['unresolved', 'unresolved']);
  });
});

describe('production .toFrame() sites', () => {
  const files = productionFiles();
  const all = files.flatMap((f) =>
    findToFrameSites(fs.readFileSync(f, 'utf8')).map((s) => ({
      ...s,
      file: path.relative(SRC, f).split(path.sep).join('/'),
    }))
  );
  const members = RDO_MEMBERS as Record<string, { kind: string }>;

  it('never scans mock-server or test files', () => {
    expect(files.filter((f) => f.includes('mock-server') || /\.test\.tsx?$/.test(f))).toEqual([]);
  });

  it('every literal rdoCall(...).toFrame() names a procedure', () => {
    const offenders = all
      .filter((s): s is Extract<typeof s, { type: 'literal' }> => s.type === 'literal')
      .filter((s) => members[s.member]?.kind !== 'procedure')
      .map((s) => `${s.file}:${s.line} ${s.member} ${members[s.member]?.kind ?? 'uncatalogued'}`);
    expect(offenders).toEqual([]);
  });

  it('every non-literal member is one of the named dynamic sites', () => {
    const found = all
      .filter((s): s is Extract<typeof s, { type: 'dynamic' }> => s.type === 'dynamic')
      .map((s) => `${s.file}|${s.expr}`);
    expect(found.filter((k) => !(k in DYNAMIC_SITES))).toEqual([]);
    expect(Object.keys(DYNAMIC_SITES).filter((k) => !found.includes(k))).toEqual([]);
  });

  it('has no unresolved .toFrame() site', () => {
    expect(all.filter((s) => s.type === 'unresolved')).toEqual([]);
  });

  it('finds enough rdoCall sites to have teeth', () => {
    expect(all.filter((s) => s.type === 'literal' || s.type === 'dynamic').length).toBeGreaterThanOrEqual(25);
  });
});

describe('RdoProcedureName / isCataloguedRdoProcedure', () => {
  it('accepts only catalogued procedures', () => {
    expect(isCataloguedRdoProcedure('KeepAlive')).toBe(true);
    expect(isCataloguedRdoProcedure('Logon')).toBe(false);
    expect(isCataloguedRdoProcedure('WorldName')).toBe(false);
    expect(isCataloguedRdoProcedure('Nope')).toBe(false);
  });

  it('rejects a function member at compile time', () => {
    const ok: RdoProcedureName = 'KeepAlive';
    // @ts-expect-error — Logon is a function
    const bad: RdoProcedureName = 'Logon';
    expect([ok, bad]).toEqual(['KeepAlive', 'Logon']);
  });

  it('leaves toFrame() output unchanged', () => {
    expect(rdoCall('KeepAlive', 5).toFrame()).toBe('C sel 5 call KeepAlive "*";');
  });
});
