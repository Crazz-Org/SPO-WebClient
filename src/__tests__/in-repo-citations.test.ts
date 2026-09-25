/**
 * In-repo line citations — a past-end-of-file check and a count ratchet (issue 921).
 *
 * An in-repo citation is a file name with a code extension followed by a colon and a line
 * number (or a range, or a comma list of numbers). Such a citation rots every time the cited
 * code moves. This test scans two corpora:
 *   - every comment in a tracked (or untracked, not ignored) TS/TSX/JS/CSS file under src/;
 *   - the agent docs: the root CLAUDE.md, each src/<dir>/CLAUDE.md, and each doc/<name>.md
 *     (fenced code blocks blanked first — a fence holds templates, not citations).
 * Delphi (.pas) and ASP (.asp) citations are deliberately excluded: those trees are frozen,
 * so their line numbers cannot rot.
 *
 * It fails when:
 *   (a) a cited file resolves to exactly one tracked file and a cited number is past its end;
 *   (b) the total number of in-repo citations exceeds its recorded baseline — counted
 *       separately for src/ comments and for the agent docs.
 *
 * A bare basename that matches more than one tracked file (client.ts, index.ts) is skipped
 * for check (a) and still counted for check (b). Ambiguity is measured against the tracked list
 * at test time: index.ts is shared by twenty-odd files, while client.ts currently names only
 * src/client/client.ts and so resolves — it becomes ambiguous the day a second one lands.
 *
 * Check (a) cannot catch in-range drift: a citation whose line still exists but now holds other
 * code passes it — 6 of the 8 doc examples in issue 921 were in range. Only the baseline (b)
 * and the symbol rule in CLAUDE.md § Code style address those.
 *
 * The ratchet only goes down. When a change removes citations, lower the baseline constant in
 * the same change; never raise it. A new reference to in-repo code is written by symbol
 * (a function in a file) instead of by line. The past-end allowlist is keyed per fact (citing
 * file plus the exact citation), never per file, and a key that no longer matches fails.
 *
 * Modelled on SPO-Pipeline test/citation-pins.js: the git ls-files resolver with its basename
 * ambiguity, the readLines trailing-newline pop, stripFences, and a CITATION_RE-style regex.
 * One deliberate difference: comments come from the TypeScript parser rather than a
 * blankComments-style regex pass, so trailing comments after code are seen and a comment
 * marker inside a string, template literal or regex literal is never misread as a comment.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';

const REPO_ROOT = path.join(__dirname, '..', '..');

// (b) ratchet: lower these when a change removes citations; NEVER raise them.
const SRC_COMMENT_BASELINE = 263;
const AGENT_DOC_BASELINE = 37;
// (a) exemptions, keyed `${citingFile} :: ${raw}` (per fact, never per file)
const PAST_EOF_ALLOWLIST: Record<string, string> = {
  'CLAUDE.md :: spo_session.ts:4026':
    "the Code style rule's own counterexample — stale on purpose, it shows what not to write",
};

interface Citation {
  raw: string;
  file: string;
  numbers: number[];
  citingFile: string;
  citingLine: number;
}

type Resolution =
  | { kind: 'resolved'; target: string }
  | { kind: 'ambiguous'; hits: string[] }
  | { kind: 'unresolved' };

const CITATION_RE =
  /((?:[A-Za-z0-9_./-]*[A-Za-z0-9_-])\.(?:ts|tsx|js|mjs|cjs|json|md|sh|ya?ml|css|html)):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)*)/g;

let trackedCache: string[] | null = null;
function trackedFiles(): string[] {
  if (trackedCache) return trackedCache;
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const list = [...new Set(out.split('\n').filter(Boolean))].filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
  trackedCache = list;
  return list;
}

function resolveTarget(file: string): Resolution {
  const p = file.replace(/^(?:\.\.?\/)+/, '').replace(/^SPO-WebClient\//, '');
  const hits = trackedFiles().filter((t) => t === p || t.endsWith('/' + p));
  if (hits.length === 1) return { kind: 'resolved', target: hits[0] };
  if (hits.length > 1) return { kind: 'ambiguous', hits };
  return { kind: 'unresolved' };
}

const lineCountCache = new Map<string, number>();
function lineCount(absPath: string): number {
  const cached = lineCountCache.get(absPath);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(absPath, 'utf8');
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  lineCountCache.set(absPath, lines.length);
  return lines.length;
}

function stripFences(md: string): string {
  let inFence = false;
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function commentRanges(source: string, fileName: string): Array<{ pos: number; end: number }> {
  if (/\.css$/.test(fileName)) {
    return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => ({ pos: m.index, end: m.index + m[0].length }));
  }
  const kind = /\.tsx$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.(?:m|c)?js$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
  const seen = new Map<number, { pos: number; end: number }>();
  const at = (p: number): void => {
    for (const r of [...(ts.getLeadingCommentRanges(source, p) ?? []), ...(ts.getTrailingCommentRanges(source, p) ?? [])]) {
      if (!seen.has(r.pos)) seen.set(r.pos, { pos: r.pos, end: r.end });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJSDoc(node)) return; // its text is already a leading comment range of its host node
    at(node.pos);
    at(node.end);
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function citationsIn(fullText: string, segment: string, segmentStart: number, citingFile: string): Citation[] {
  const out: Citation[] = [];
  for (const m of segment.matchAll(CITATION_RE)) {
    const numbers = [Number(m[2])];
    if (m[3]) numbers.push(Number(m[3]));
    if (m[4]) for (const n of m[4].match(/\d+/g) ?? []) numbers.push(Number(n));
    out.push({
      raw: m[0],
      file: m[1],
      numbers,
      citingFile,
      citingLine: lineAt(fullText, segmentStart + m.index),
    });
  }
  return out;
}

function citationsInSource(source: string, fileName: string): Citation[] {
  return commentRanges(source, fileName).flatMap((r) =>
    citationsIn(source, source.slice(r.pos, r.end), r.pos, fileName),
  );
}

function citationsInDoc(md: string, fileName: string): Citation[] {
  const stripped = stripFences(md);
  return citationsIn(stripped, stripped, 0, fileName);
}

interface PastEof {
  citation: Citation;
  target: string;
  lines: number;
}

function pastEof(citations: Citation[]): PastEof[] {
  const out: PastEof[] = [];
  for (const c of citations) {
    const r = resolveTarget(c.file);
    if (r.kind !== 'resolved') continue;
    const lines = lineCount(path.join(REPO_ROOT, r.target));
    if (c.numbers.some((n) => n > lines)) out.push({ citation: c, target: r.target, lines });
  }
  return out;
}

function countCitations(citations: Citation[]): number {
  return citations.length;
}

function describePastEof(list: PastEof[]): string {
  return (
    list
      .map((p) => `${p.citation.citingFile}:${p.citation.citingLine} ${p.citation.raw} -> ${p.target} (${p.lines} lines)`)
      .join('\n') + '\nCite in-repo code by symbol (a function in a file), never by line.'
  );
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function srcCorpus(): Citation[] {
  return trackedFiles()
    .filter((f) => /^src\/.*\.(?:ts|tsx|js|mjs|cjs|css)$/.test(f))
    .flatMap((f) => citationsInSource(readRepo(f), f));
}

function docCorpus(): Citation[] {
  return trackedFiles()
    .filter((f) => f === 'CLAUDE.md' || /^src\/[^/]+\/CLAUDE\.md$/.test(f) || /^doc\/[^/]+\.md$/.test(f))
    .flatMap((f) => citationsInDoc(readRepo(f), f));
}

describe('scanner — fixtures', () => {
  const found = (src: string, name = 'x.ts'): string[] => citationsInSource(src, name).map((c) => c.raw);

  it('finds a citation in every comment position', () => {
    expect(found('// see a.ts:1\nconst x = 1;')).toEqual(['a.ts:1']);
    expect(found('const x = 1; // see b.ts:2\n')).toEqual(['b.ts:2']);
    expect(found('const o = {\n  a: 1, // c.ts:3\n  b: 2,\n};\n')).toEqual(['c.ts:3']);
    expect(found('function f() {\n  g();\n  // d.ts:4\n}\n')).toEqual(['d.ts:4']);
    expect(found('const y = /* e.ts:5 */ 2;\n')).toEqual(['e.ts:5']);
    expect(found('/**\n * f.ts:6\n */\nexport function h() {}\n')).toEqual(['f.ts:6']);
    expect(found('const el = <div>{/* g.tsx:7 */}</div>;\n', 'x.tsx')).toEqual(['g.tsx:7']);
  });

  it('ignores the same shape in strings, templates, regexes and JSX text', () => {
    expect(found("const s = 'a.ts:1';\n")).toEqual([]);
    expect(found('const t = `b.ts:2 ${s} // c.ts:3`;\n')).toEqual([]);
    expect(found('const r = /d.ts:4 \\/\\/ x/;\n')).toEqual([]);
    expect(found('const el = <p>e.ts:5 // f.ts:6</p>;\n', 'x.tsx')).toEqual([]);
  });

  it('never matches .pas or .asp citations', () => {
    expect(found('// Foo.pas:12 and bar.asp:24-27\n')).toEqual([]);
  });

  it('reads ranges and comma tails as one citation with every number', () => {
    const [comma] = citationsInSource('// scripts/finish.sh:188,208,215\n', 'x.ts');
    expect(comma.file).toBe('scripts/finish.sh');
    expect(comma.numbers).toEqual([188, 208, 215]);
    const [range] = citationsInSource('// a.ts:3-9\n', 'x.ts');
    expect(range.numbers).toEqual([3, 9]);
  });

  it('stripFences drops fenced citations and keeps line numbers', () => {
    const md = 'intro\n```\nsee a.ts:1\n```\nafter b.ts:2\n';
    const cs = citationsInDoc(md, 'doc/x.md');
    expect(cs.map((c) => c.raw)).toEqual(['b.ts:2']);
    expect(cs[0].citingLine).toBe(5);
  });

  it('extracts CSS block comments', () => {
    expect(found('.a { color: red; } /* h.ts:8 */\n.b {}\n', 'x.css')).toEqual(['h.ts:8']);
  });

  it('computes the citing line', () => {
    const [c] = citationsInSource('const a = 1;\n\nconst b = 2; // i.ts:9\n', 'x.ts');
    expect(c.citingLine).toBe(3);
    expect(c.citingFile).toBe('x.ts');
  });
});

describe('resolver and check (a) — fixtures', () => {
  it('reports a basename shared by several tracked files as ambiguous', () => {
    const r = resolveTarget('index.ts');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.hits.length).toBeGreaterThan(1);
  });

  it('resolves a unique basename and a relative path', () => {
    expect(resolveTarget('spo_session.ts')).toEqual({ kind: 'resolved', target: 'src/server/spo_session.ts' });
    expect(resolveTarget('../src/e2e/bench/worker.ts')).toEqual({ kind: 'resolved', target: 'src/e2e/bench/worker.ts' });
    expect(resolveTarget('no-such-file-xyz.ts')).toEqual({ kind: 'unresolved' });
  });

  it('flags a resolvable citation past the end, not one in range', () => {
    const cs = citationsInSource("// spo_session.ts:999999\n// spo_session.ts:1\n", 'x.ts');
    const flagged = pastEof(cs);
    expect(flagged.map((p) => p.citation.raw)).toEqual(['spo_session.ts:999999']);
    expect(describePastEof(flagged)).toContain('src/server/spo_session.ts');
  });

  it('skips an ambiguous basename for (a) but still counts it for (b)', () => {
    const cs = citationsInSource('// index.ts:999999\n', 'x.ts');
    expect(pastEof(cs)).toEqual([]);
    expect(countCitations(cs)).toBe(1);
  });
});

describe('corpus', () => {
  let src: Citation[] = [];
  let docs: Citation[] = [];

  beforeAll(() => {
    src = srcCorpus();
    docs = docCorpus();
  }, 120_000);

  it('(a) no src/ comment citation points past the end of its file', () => {
    const bad = pastEof(src);
    if (bad.length) throw new Error('Past-EOF citations in src/ comments:\n' + describePastEof(bad));
  }, 60_000);

  it('(a) no agent-doc citation points past the end of its file', () => {
    const bad = pastEof(docs).filter((p) => !(`${p.citation.citingFile} :: ${p.citation.raw}` in PAST_EOF_ALLOWLIST));
    if (bad.length) throw new Error('Past-EOF citations in agent docs:\n' + describePastEof(bad));
  }, 60_000);

  it('every past-EOF allowlist key still matches a real doc citation', () => {
    const keys = new Set(docs.map((c) => `${c.citingFile} :: ${c.raw}`));
    expect(Object.keys(PAST_EOF_ALLOWLIST).filter((k) => !keys.has(k))).toEqual([]);
  }, 60_000);

  it('(b) src/ comment citations do not exceed the baseline', () => {
    const n = countCitations(src);
    if (n > SRC_COMMENT_BASELINE) {
      throw new Error(
        `${n} in-repo line citations in src/ comments, baseline ${SRC_COMMENT_BASELINE}. ` +
          'Cite in-repo code by symbol instead; the baseline only goes down.',
      );
    }
  }, 60_000);

  it('(b) agent-doc citations do not exceed the baseline', () => {
    const n = countCitations(docs);
    if (n > AGENT_DOC_BASELINE) {
      throw new Error(
        `${n} in-repo line citations in agent docs, baseline ${AGENT_DOC_BASELINE}. ` +
          'Cite in-repo code by symbol instead; the baseline only goes down.',
      );
    }
  }, 60_000);

});
