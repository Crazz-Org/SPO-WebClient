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
 * The baseline (today's sites per shape) lives in `test-hygiene.baseline.json` and must match
 * the scan exactly: a new site or a stale site fails with its file and line. It is rewritten by
 * `npm run hygiene:baseline`, which never raises a count. A line may opt out with
 * `// hygiene-exception: <reason>` on the hit line or the line above; exceptions are ratcheted too.
 * Baseline conflict? Take either side, run `npm run hygiene:baseline`, commit.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');
const SELF = path.join(__dirname, 'test-hygiene.test.ts');
const FLOWS = path.join(SRC, 'e2e', 'flows.ts');

type Shape = 'selfComparison' | 'literalExpect' | 'replicaFunction' | 'tsNocheck' | 'checkTrue';
const SHAPES: Shape[] = ['selfComparison', 'literalExpect', 'replicaFunction', 'tsNocheck', 'checkTrue'];

type Key = Shape | 'exceptions';
const KEYS: Key[] = [...SHAPES, 'exceptions'];
type Baseline = Record<Key, string[]>;
const BASELINE_FILE = path.join(__dirname, 'test-hygiene.baseline.json');
const COMMAND = 'npm run hygiene:baseline';

export function readBaseline(file: string): Baseline {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${file}: not a JSON object`);
  const obj = parsed as Record<string, unknown>;
  const out = {} as Baseline;
  for (const key of KEYS) {
    const v = obj[key];
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
      throw new Error(`${file}: "${key}" must be an array of strings`);
    }
    out[key] = v as string[];
  }
  return out;
}

export function rebaseline(
  committed: Baseline,
  current: Baseline,
): { raised: string[] } | { next: Baseline; changes: string[] } {
  const raised: string[] = [];
  for (const key of KEYS) {
    if (current[key].length > committed[key].length) {
      for (const s of current[key]) if (!committed[key].includes(s)) raised.push(`${key} ${s}`);
    }
  }
  if (raised.length > 0) return { raised };
  const next = {} as Baseline;
  const changes: string[] = [];
  for (const key of KEYS) {
    next[key] = [...current[key]].sort();
    for (const s of committed[key]) if (!current[key].includes(s)) changes.push(`- ${key} ${s}`);
    for (const s of current[key]) if (!committed[key].includes(s)) changes.push(`+ ${key} ${s}`);
  }
  return { next, changes };
}

export function writeBaseline(file: string, current: Baseline): string[] {
  const r = rebaseline(readBaseline(file), current);
  if ('raised' in r) {
    throw new Error('hygiene baseline NOT written — a count would go up. New sites:\n' + r.raised.join('\n'));
  }
  fs.writeFileSync(file, JSON.stringify(r.next, null, 2) + '\n');
  return r.changes;
}

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

const WRITE = process.env.HYGIENE_BASELINE_WRITE === '1';
const list = (sites: string[]): string => sites.map((s) => `  ${s}`).join('\n');

(WRITE ? describe.skip : describe)('test hygiene ratchet', () => {
  const result = scan(realFiles());
  const baseline = readBaseline(BASELINE_FILE);

  for (const key of KEYS) {
    it(`${key}: no new occurrence, no stale site, count <= baseline`, () => {
      const newHits = result[key].filter((s) => !baseline[key].includes(s));
      if (newHits.length > 0) {
        throw new Error(
          `${key}: new site(s):\n${list(newHits)}\nFix the test. If a baseline site only moved, run \`${COMMAND}\`.`,
        );
      }
      const stale = baseline[key].filter((s) => !result[key].includes(s));
      if (stale.length > 0) {
        throw new Error(`${key}: stale baseline site(s):\n${list(stale)}\nRun \`${COMMAND}\` and commit.`);
      }
      expect(result[key].length).toBeLessThanOrEqual(baseline[key].length);
    });
  }
});

(WRITE ? describe : describe.skip)('write the hygiene baseline', () => {
  it('rewrites the baseline from the current scan', () => {
    const changes = writeBaseline(BASELINE_FILE, scan(realFiles()));
    console.log(changes.length > 0 ? changes.join('\n') : 'hygiene baseline unchanged');
  });
});

describe('baseline write mode', () => {
  const empty = (): Baseline => ({
    selfComparison: [],
    literalExpect: [],
    replicaFunction: [],
    tsNocheck: [],
    checkTrue: [],
    exceptions: [],
  });
  const tmpFile = (b: Baseline): string => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-')), 'baseline.json');
    fs.writeFileSync(f, JSON.stringify(b));
    return f;
  };

  it('writes a lower count', () => {
    const f = tmpFile({ ...empty(), tsNocheck: ['a:1', 'b:1'] });
    const changes = writeBaseline(f, { ...empty(), tsNocheck: ['a:1'] });
    expect(readBaseline(f).tsNocheck).toEqual(['a:1']);
    expect(changes).toEqual(['- tsNocheck b:1']);
  });

  it('drops a stale site and shows a moved one', () => {
    const f = tmpFile({ ...empty(), replicaFunction: ['x:10'] });
    const changes = writeBaseline(f, { ...empty(), replicaFunction: ['x:12'] });
    expect(readBaseline(f).replicaFunction).toEqual(['x:12']);
    expect(changes).toEqual(['- replicaFunction x:10', '+ replicaFunction x:12']);
  });

  it('refuses a higher count and writes nothing', () => {
    const f = tmpFile({ ...empty(), selfComparison: ['a:1'] });
    const before = fs.readFileSync(f, 'utf8');
    expect(() => writeBaseline(f, { ...empty(), selfComparison: ['a:1', 'n:5'] })).toThrow(/selfComparison n:5/);
    expect(fs.readFileSync(f, 'utf8')).toBe(before);
  });

  it('writes a sorted file ending with a newline', () => {
    const f = tmpFile({ ...empty(), tsNocheck: ['b:1', 'a:1'] });
    writeBaseline(f, { ...empty(), tsNocheck: ['b:1', 'a:1'] });
    const text = fs.readFileSync(f, 'utf8');
    expect(text).toBe(JSON.stringify({ ...empty(), tsNocheck: ['a:1', 'b:1'] }, null, 2) + '\n');
  });

  it('readBaseline rejects a malformed file', () => {
    const missing = tmpFile(empty());
    const obj = JSON.parse(fs.readFileSync(missing, 'utf8')) as Record<string, unknown>;
    delete obj.checkTrue;
    fs.writeFileSync(missing, JSON.stringify(obj));
    expect(() => readBaseline(missing)).toThrow(/checkTrue/);
    fs.writeFileSync(missing, JSON.stringify({ ...empty(), tsNocheck: [1] }));
    expect(() => readBaseline(missing)).toThrow(/tsNocheck/);
    fs.writeFileSync(missing, 'null');
    expect(() => readBaseline(missing)).toThrow(/not a JSON object/);
  });
});

describe('the scanner reds a new occurrence', () => {
  const fn8 = ['function helper() {', '  a();', '  b();', '  c();', '  d();', '  e();', '  f();', '}'];

  it('detects expect(x).toBe(x) and pushes the count over the baseline', () => {
    const src = ['it("x", () => {', '  const x = 1;', '  expect(x).toBe(x);', '});'].join('\n');
    expect(selfComparison(src)).toEqual([3]);
    const res = scan([...realFiles(), { rel: 'synthetic.test.ts', source: src, flowsOnly: false }]);
    expect(res.selfComparison).toContain('synthetic.test.ts:3');
    expect(res.selfComparison.length).toBeGreaterThan(readBaseline(BASELINE_FILE).selfComparison.length);
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
