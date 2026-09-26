/**
 * Test hygiene ratchet — counts the shapes of "a test that cannot fail".
 *
 * Scans every `*.test.ts(x)` under `src/` (this file excluded — its fixtures would trip it)
 * plus `src/e2e/flows.ts` (for the `check(…, true` shape) and counts, per shape:
 *  - selfComparison: `expect(E).toBe|toEqual|toStrictEqual(E)` with textually identical `E`
 *    (`.not.` forms are real checks and are not counted);
 *  - literalExpect: `expect(<literal>)`;
 *  - replicaFunction: a local function of >= 8 lines with a comment mentioning
 *    replicat/simulat/mirror/copy of within the 3 lines above it;
 *  - tsNocheck: `@ts-nocheck`;
 *  - checkTrue: `check(<string>, true` (matched across newlines).
 *
 * Each count must stay `<=` the BASELINE below (today's numbers, with their sites). A new
 * occurrence fails with its file and line. The baseline only goes DOWN — same rule as the
 * `jest.config.js` thresholds. A line may opt out with `// hygiene-exception: <reason>` on
 * the hit line or the line above; exceptions are counted and ratcheted too.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');
const SELF = path.join(__dirname, 'test-hygiene.test.ts');
const FLOWS = path.join(SRC, 'e2e', 'flows.ts');

type Shape = 'selfComparison' | 'literalExpect' | 'replicaFunction' | 'tsNocheck' | 'checkTrue';
const SHAPES: Shape[] = ['selfComparison', 'literalExpect', 'replicaFunction', 'tsNocheck', 'checkTrue'];

const BASELINE: Record<Shape | 'exceptions', { max: number; sites: string[] }> = {
  selfComparison: {
    max: 2,
    sites: [
      'src/client/renderer/isometric-terrain-renderer.test.ts:438',
      'src/e2e/bench/fingerprint.test.ts:29',
    ],
  },
  literalExpect: {
    max: 1,
    sites: ['src/client/renderer/isometric-terrain-renderer.test.ts:438'],
  },
  replicaFunction: {
    max: 8,
    sites: [
      'src/client/components/building/__tests__/resolve-rdo-command.test.ts:22',
      'src/server/__tests__/cache-sync-service.test.ts:19',
      'src/server/__tests__/rdo/facility-set-commands.test.ts:21',
      'src/server/__tests__/rdo/facility-set-commands.test.ts:166',
      'src/server/__tests__/rdo/facility-set-commands.test.ts:199',
      'src/server/__tests__/rdo/tycoon-role-cache.test.ts:25',
      'src/server/__tests__/security-hardening.test.ts:59',
      'src/server/__tests__/supply-controls.test.ts:214',
    ],
  },
  tsNocheck: {
    max: 5,
    sites: [
      'src/server/__tests__/rdo/building-operations.test.ts:1',
      'src/server/__tests__/rdo/company-session.test.ts:1',
      'src/server/__tests__/rdo/facility-set-commands.test.ts:1',
      'src/server/__tests__/rdo/login-flow.test.ts:1',
      'src/server/__tests__/rdo/rdo-value-equivalence.test.ts:1',
    ],
  },
  checkTrue: {
    max: 4,
    sites: ['src/e2e/flows.ts:291', 'src/e2e/flows.ts:683', 'src/e2e/flows.ts:729', 'src/e2e/flows.ts:775'],
  },
  exceptions: { max: 0, sites: [] },
};

/** Balanced-paren argument starting right after an opening `(` at `start`; null if unbalanced. */
function parenArg(line: string, start: number): { arg: string; end: number } | null {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { arg: line.slice(start, i).trim(), end: i + 1 };
    }
  }
  return null;
}

function expectCalls(line: string): { arg: string; rest: string }[] {
  const out: { arg: string; rest: string }[] = [];
  const re = /\bexpect\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const r = parenArg(line, m.index + m[0].length);
    if (r) out.push({ arg: r.arg, rest: line.slice(r.end) });
  }
  return out;
}

export function selfComparison(source: string): number[] {
  const hits: number[] = [];
  source.split('\n').forEach((line, i) => {
    for (const { arg, rest } of expectCalls(line)) {
      const mm = /^\s*\.(?:toBe|toEqual|toStrictEqual)\(/.exec(rest);
      if (!mm) continue;
      const r = parenArg(rest, mm[0].length);
      if (r && r.arg === arg) {
        hits.push(i + 1);
        break;
      }
    }
  });
  return hits;
}

const LITERAL = /^(?:-?\d+(?:\.\d+)?|true|false|null|undefined|'[^']*'|"[^"]*"|`[^`$]*`)$/;

export function literalExpect(source: string): number[] {
  const hits: number[] = [];
  source.split('\n').forEach((line, i) => {
    if (expectCalls(line).some((c) => LITERAL.test(c.arg))) hits.push(i + 1);
  });
  return hits;
}

const LOCAL_FN =
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*[<(]|^\s*(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;
const REPLICA_COMMENT = /(\/\/|\/\*|^\s*\*).*(replicat|simulat|mirror|copy of)/i;

export function replicaFunction(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!LOCAL_FN.test(line)) return;
    const above = lines.slice(Math.max(0, i - 3), i);
    if (!above.some((l) => REPLICA_COMMENT.test(l))) return;
    let depth = 0;
    let seen = false;
    let endLine = i;
    for (let j = i; j < lines.length; j++) {
      for (const c of lines[j]) {
        if (c === '{') {
          depth++;
          seen = true;
        } else if (c === '}') depth--;
      }
      endLine = j;
      if (seen && depth <= 0) break;
      // A brace-less expression arrow ends at its own statement end, never at an enclosing `}`.
      if (!seen && (depth < 0 || lines[j].trim().endsWith(';'))) break;
    }
    if (endLine - i + 1 >= 8) hits.push(i + 1);
  });
  return hits;
}

export function tsNocheck(source: string): number[] {
  const hits: number[] = [];
  source.split('\n').forEach((line, i) => {
    if (line.includes('@ts-nocheck')) hits.push(i + 1);
  });
  return hits;
}

export function checkTrue(source: string): number[] {
  const re = /\bcheck\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*,\s*true\b/g;
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) hits.push(source.slice(0, m.index).split('\n').length);
  return hits;
}

const DETECTORS: Record<Shape, (s: string) => number[]> = {
  selfComparison,
  literalExpect,
  replicaFunction,
  tsNocheck,
  checkTrue,
};

const EXCEPTION = /\/\/\s*hygiene-exception:\s*\S/;

export function isExcepted(source: string, line: number): boolean {
  const lines = source.split('\n');
  return EXCEPTION.test(lines[line - 1] ?? '') || EXCEPTION.test(lines[line - 2] ?? '');
}

interface FileSource {
  rel: string;
  source: string;
  flowsOnly: boolean;
}

export function scan(files: FileSource[]): Record<Shape | 'exceptions', string[]> {
  const out: Record<Shape | 'exceptions', string[]> = {
    selfComparison: [],
    literalExpect: [],
    replicaFunction: [],
    tsNocheck: [],
    checkTrue: [],
    exceptions: [],
  };
  for (const f of files) {
    for (const shape of SHAPES) {
      if (f.flowsOnly && shape !== 'checkTrue') continue;
      for (const line of DETECTORS[shape](f.source)) {
        const site = `${f.rel}:${line}`;
        if (isExcepted(f.source, line)) out.exceptions.push(`${shape} ${site}`);
        else out[shape].push(site);
      }
    }
  }
  return out;
}

function walk(dir: string, acc: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.test\.tsx?$/.test(e.name) && p !== SELF) acc.push(p);
  }
  return acc;
}

const rel = (f: string): string => path.relative(REPO_ROOT, f).split(path.sep).join('/');

function realFiles(): FileSource[] {
  const files: FileSource[] = walk(SRC, []).map((f) => ({
    rel: rel(f),
    source: fs.readFileSync(f, 'utf8'),
    flowsOnly: false,
  }));
  files.push({ rel: rel(FLOWS), source: fs.readFileSync(FLOWS, 'utf8'), flowsOnly: true });
  return files;
}

describe('test hygiene ratchet', () => {
  const result = scan(realFiles());

  for (const key of [...SHAPES, 'exceptions'] as const) {
    it(`${key}: no new occurrence, count <= baseline`, () => {
      const newHits = result[key].filter((s) => !BASELINE[key].sites.includes(s));
      expect(newHits).toEqual([]);
      expect(result[key].length).toBeLessThanOrEqual(BASELINE[key].max);
    });
  }
});

describe('the scanner reds a new occurrence', () => {
  const fn8 = ['function helper() {', '  a();', '  b();', '  c();', '  d();', '  e();', '  f();', '}'];

  it('detects expect(x).toBe(x) and pushes the count over the baseline', () => {
    const src = ['it("x", () => {', '  const x = 1;', '  expect(x).toBe(x);', '});'].join('\n');
    expect(selfComparison(src)).toEqual([3]);
    const res = scan([...realFiles(), { rel: 'synthetic.test.ts', source: src, flowsOnly: false }]);
    expect(res.selfComparison).toContain('synthetic.test.ts:3');
    expect(res.selfComparison.length).toBeGreaterThan(BASELINE.selfComparison.max);
  });

  it('detects toEqual / toStrictEqual and ignores .not and differing args', () => {
    expect(selfComparison('expect(f(a)).toEqual(f(a));\nexpect(y).toStrictEqual( y );')).toEqual([1, 2]);
    expect(selfComparison('expect(x).not.toBe(x);')).toEqual([]);
    expect(selfComparison('expect(x).toBe(y);')).toEqual([]);
    expect(selfComparison('expect(x.toBe(x);')).toEqual([]);
    expect(selfComparison('expect(x).toBe(x;')).toEqual([]);
  });

  it('detects expect(<literal>)', () => {
    expect(literalExpect("expect(42).toBe(1);\nexpect('s');\nexpect(v).toBe(1);")).toEqual([1, 2]);
  });

  it('detects a long replica function under a mirror comment only', () => {
    expect(replicaFunction(['// mirrors foo', ...fn8].join('\n'))).toEqual([2]);
    expect(replicaFunction(['// mirrors foo', ...fn8.slice(0, 6), '}'].join('\n'))).toEqual([]);
    expect(replicaFunction(['// copy of foo', '', '', '', ...fn8].join('\n'))).toEqual([]);
    expect(replicaFunction(fn8.join('\n'))).toEqual([]);
    const oneLiner = ['  // simulation', '  const h = (s: string) => s.trim();', ...fn8.slice(1)].join('\n');
    expect(replicaFunction(oneLiner)).toEqual([]);
    const arrow = ['/* simulates bar */', 'const g = (a: number) => {', ...fn8.slice(1)].join('\n');
    expect(replicaFunction(arrow)).toEqual([2]);
  });

  it('detects @ts-nocheck', () => {
    expect(tsNocheck('// @ts-nocheck\nconst a = 1;')).toEqual([1]);
  });

  it('detects check(<string>, true across newlines, not a real boolean', () => {
    expect(checkTrue("a;\nassertions.check(\n  'x',\n  true);")).toEqual([2]);
    expect(checkTrue("check('x', ok);")).toEqual([]);
  });

  it('counts a hygiene-exception with a reason, on the line or the line above', () => {
    const same = 'expect(x).toBe(x); // hygiene-exception: determinism probe';
    const above = '// hygiene-exception: reason\nexpect(x).toBe(x);';
    const empty = 'expect(x).toBe(x); // hygiene-exception:';
    const res = scan([
      { rel: 'a.ts', source: same, flowsOnly: false },
      { rel: 'b.ts', source: above, flowsOnly: false },
      { rel: 'c.ts', source: empty, flowsOnly: false },
      { rel: 'f.ts', source: 'expect(x).toBe(x);\ncheck("y", true)', flowsOnly: true },
    ]);
    expect(res.exceptions).toEqual(['selfComparison a.ts:1', 'selfComparison b.ts:2']);
    expect(res.selfComparison).toEqual(['c.ts:1']);
    expect(res.checkTrue).toEqual(['f.ts:2']);
  });
});
