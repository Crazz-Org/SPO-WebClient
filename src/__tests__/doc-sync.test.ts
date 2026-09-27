/**
 * Doc sync — agent-facing docs checked against the code they describe (issue 958).
 *
 * Each check reads a doc and the code it describes from the tree at test time and asserts they
 * agree. None of them pins wording: a list in a doc is compared with the directory, registry or
 * policy it lists, and a `<file> § <heading>` reference is compared with the headings of that
 * file. Each check is a small pure function returning its offenders; every check has a real test
 * (expects no offender, and a non-empty input set so an empty corpus cannot pass) and a fixture
 * test proving the function reports an offender when one exists.
 *
 * This file itself is excluded from every corpus scan: its fixtures carry fake policy ids and
 * fake section references on purpose.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SCENARIO_NAMES } from '../mock-server/scenarios/scenario-registry';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SELF = 'src/__tests__/doc-sync.test.ts';

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

let trackedCache: string[] | null = null;
function trackedFiles(): string[] {
  if (trackedCache) return trackedCache;
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  trackedCache = [...new Set(out.split('\n').filter(Boolean))].filter(
    (f) => f !== SELF && fs.existsSync(path.join(REPO_ROOT, f))
  );
  return trackedCache;
}

// ---- a. handlers and d. scenarios: every name appears backticked in its doc ----------------

function missingBacktickedNames(names: string[], doc: string): string[] {
  return names.filter((n) => !doc.includes('`' + n + '`'));
}

function sessionHandlerNames(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'src/server/session'))
    .filter((f) => /-handler\.ts$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
}

// ---- b. SEC ids: a policy row, or a moved section whose destination the citing code names ----

const SEC_ID_RE = /SEC-[A-Z]-\d+/g;

function collectSecCitations(files: Map<string, string>): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const [file, text] of files) {
    for (const id of new Set(text.match(SEC_ID_RE) ?? [])) {
      const list = byId.get(id) ?? [];
      list.push(file);
      byId.set(id, list);
    }
  }
  return byId;
}

function policySections(policy: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of policy.split('\n')) {
    if (line.startsWith('## ')) {
      current = { heading: line, body: '' };
      sections.push(current);
    } else if (current) {
      current.body += line + '\n';
    }
  }
  return sections;
}

const MOVED_DEST_RE = /moved to\s+\[[^\]]*\]\(https:\/\/github\.com\/[^/]+\/([^/)#]+)/i;

function secOffenders(citations: Map<string, string[]>, policy: string, readCiting: (f: string) => string): string[] {
  const offenders: string[] = [];
  const sections = policySections(policy);
  for (const [id, citing] of citations) {
    const rowRe = new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm');
    const headingRe = new RegExp(`^#{2,6}\\s+${id}\\b`, 'm');
    if (rowRe.test(policy) || headingRe.test(policy)) continue;
    const letter = id.split('-')[1];
    const section = sections.find((s) => s.heading.includes(`(SEC-${letter})`));
    const moved =
      section !== undefined &&
      /moved to/i.test(section.body) &&
      (section.body.includes(id) || !/^\|\s*SEC-/m.test(section.body));
    if (!section || !moved) {
      offenders.push(`${id}: no row in the policy and no section saying where it moved`);
      continue;
    }
    const dest = MOVED_DEST_RE.exec(section.body);
    if (!dest) {
      offenders.push(`${id}: its section says it moved but names no destination repository`);
      continue;
    }
    for (const f of citing) {
      if (!readCiting(f).includes(dest[1])) {
        offenders.push(`${id}: ${f} cites it but never names ${dest[1]}, where it moved`);
      }
    }
  }
  return offenders;
}

// ---- c. `<file>.md § <heading>` references resolve to a heading of that file ---------------

interface UnwritableRef {
  citing: string;
  file: string;
  tailStartsWith: string;
  reason: string;
}

/** Files named by a `§` reference that belong to another repository, keyed as written. */
const FOREIGN_DOCS: Record<string, string> = {
  'doc/state-machine-spec.md': 'SPO-Pipeline',
  'next-task.md': 'SPO-Pipeline',
};

/** References this pipeline may not fix: every entry's citing file lies under `.claude/`. */
const UNWRITABLE_REFS: UnwritableRef[] = [
  {
    citing: '.claude/agents/change-validator.md',
    file: 'CLAUDE.md',
    tailStartsWith: 'stay on the claimed card',
    reason: 'a bold paragraph lead in § Backlog, not a heading; .claude/ is maintainer-only',
  },
  {
    citing: '.claude/agents/citation-verifier.md',
    file: 'doc/kanban-workflow.md',
    tailStartsWith: 'validation',
    reason: 'a row of the columns table, not a heading; .claude/ is maintainer-only',
  },
];

const SECTION_REF_RE = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.md)[`\]]*(?:\([^)\s]*\))?\s*§\s*(?=[A-Za-z`*_])/g;
const SECTION_REF_EXT = /\.(md|ts|tsx|js|mjs|cjs|sh|ya?ml|json)$/;

function normalise(s: string): string {
  return s.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function headingsOf(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const h = m[1].replace(/[`*]/g, '').replace(/^\d+(\.\d+)*\.?\s+/, '');
    out.push(normalise(h.split(/\s+—\s+|\s+\(|:\s/)[0]));
  }
  return out;
}

function resolveDoc(ref: string, citing: string, mdFiles: string[]): string | null {
  for (const c of [ref, path.posix.join(path.posix.dirname(citing), ref)]) {
    const n = path.posix.normalize(c);
    if (mdFiles.includes(n)) return n;
  }
  const hits = mdFiles.filter((f) => path.posix.basename(f) === path.posix.basename(ref));
  return hits.length === 1 ? hits[0] : null;
}

function sectionRefOffenders(
  files: Map<string, string>,
  foreign: Record<string, string>,
  unwritable: UnwritableRef[]
): { offenders: string[]; count: number } {
  const offenders: string[] = [];
  const mdFiles = [...files.keys()].filter((f) => f.endsWith('.md'));
  const usedForeign = new Set<string>();
  const usedUnwritable = new Set<UnwritableRef>();
  let count = 0;
  for (const [citing, text] of files) {
    if (!SECTION_REF_EXT.test(citing)) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(SECTION_REF_RE)) {
        count++;
        const next = (lines[i + 1] ?? '').replace(/^\s*(#|\/\/|\*|--)?\s*/, '');
        const tail = normalise(line.slice((m.index ?? 0) + m[0].length) + ' ' + next);
        const target = resolveDoc(m[1], citing, mdFiles);
        if (!target) {
          if (m[1] in foreign) usedForeign.add(m[1]);
          else offenders.push(`${citing}: ${m[1]} resolves to no file in the tree`);
          continue;
        }
        const ok = headingsOf(files.get(target) ?? '').some(
          (h) => tail.startsWith(h) && !/[a-z0-9]/.test(tail.charAt(h.length))
        );
        if (ok) continue;
        const allowed = unwritable.find(
          (u) => u.citing === citing && u.file === target && tail.startsWith(u.tailStartsWith)
        );
        if (allowed) usedUnwritable.add(allowed);
        else offenders.push(`${citing}: "${m[1]} § ${tail.slice(0, 40)}" names no heading of ${target}`);
      }
    });
  }
  for (const key of Object.keys(foreign)) {
    if (!usedForeign.has(key)) offenders.push(`FOREIGN_DOCS entry ${key} is stale: no unresolved reference uses it`);
  }
  for (const u of unwritable) {
    if (!usedUnwritable.has(u)) offenders.push(`UNWRITABLE_REFS entry ${u.citing} -> ${u.file} is stale`);
  }
  return { offenders, count };
}

// ---- e. agents: no line pairs Rdo/Server with "declaration" (read-only) --------------------

function agentDeclarationOffenders(agents: Map<string, string>): string[] {
  const offenders: string[] = [];
  for (const [name, text] of agents) {
    text.split('\n').forEach((line, i) => {
      if (!line.includes('Rdo/Server')) return;
      const stripped = line.replace(/\bno\s+(?:\w+\s+)?declarations?\b/gi, '');
      if (/declaration/i.test(stripped)) offenders.push(`${name} line ${i + 1}: ${line.trim()}`);
    });
  }
  return offenders;
}

// ---- tests ---------------------------------------------------------------------------------

describe('doc sync — session handlers listed in src/server/CLAUDE.md', () => {
  test('every session/*-handler.ts basename appears in the doc', () => {
    const names = sessionHandlerNames();
    expect(names.length).toBeGreaterThan(0);
    expect(missingBacktickedNames(names, read('src/server/CLAUDE.md'))).toEqual([]);
  });

  test('a handler missing from the doc is reported', () => {
    expect(missingBacktickedNames(['a-handler', 'b-handler'], 'handlers: `a-handler`.')).toEqual(['b-handler']);
  });
});

describe('doc sync — mock scenarios listed in src/mock-server/CLAUDE.md', () => {
  test('every registered scenario appears in the doc', () => {
    expect(SCENARIO_NAMES.length).toBeGreaterThan(0);
    expect(missingBacktickedNames([...SCENARIO_NAMES], read('src/mock-server/CLAUDE.md'))).toEqual([]);
  });
});

describe('doc sync — SEC ids cited under src/ against the security policy', () => {
  const POLICY = 'doc/production-security-policy.md';

  test('every SEC id has a policy row, or a moved section whose destination the citing code names', () => {
    const files = new Map<string, string>();
    for (const f of trackedFiles()) {
      if (f.startsWith('src/') && /\.(ts|tsx|js|mjs|cjs|css|html|md|json)$/.test(f)) files.set(f, read(f));
    }
    const citations = collectSecCitations(files);
    expect(citations.size).toBeGreaterThan(0);
    expect(secOffenders(citations, read(POLICY), (f) => files.get(f) ?? '')).toEqual([]);
  });

  test('a missing id, a moved id with no destination, and a citing file not naming it are reported', () => {
    const policy = [
      '## 1. Transport (SEC-T)',
      'Moved to [Elsewhere](https://github.com/Org/Elsewhere/blob/main/p.md).',
      '## 2. Other (SEC-O)',
      '| SEC-O-1 | row |',
      'SEC-O-9 moved to somewhere unnamed.',
      '### SEC-X-1 — an exception',
    ].join('\n');
    const files = new Map<string, string>([
      ['a.ts', 'SEC-T-3 SEC-O-1 SEC-X-1'],
      ['b.ts', 'SEC-T-3 lives in Elsewhere now; SEC-O-9; SEC-Q-1'],
    ]);
    const offenders = secOffenders(collectSecCitations(files), policy, (f) => files.get(f) ?? '');
    expect(offenders).toEqual([
      'SEC-T-3: a.ts cites it but never names Elsewhere, where it moved',
      'SEC-O-9: its section says it moved but names no destination repository',
      'SEC-Q-1: no row in the policy and no section saying where it moved',
    ]);
  });
});

describe('doc sync — `<file> § <heading>` references', () => {
  test('every reference resolves to a heading of the file it names', () => {
    const files = new Map<string, string>();
    for (const f of trackedFiles()) {
      if (SECTION_REF_EXT.test(f)) files.set(f, read(f));
    }
    const { offenders, count } = sectionRefOffenders(files, FOREIGN_DOCS, UNWRITABLE_REFS);
    expect(count).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test('the unwritable allowlist only ever holds references in .claude/', () => {
    expect(UNWRITABLE_REFS.filter((u) => !u.citing.startsWith('.claude/'))).toEqual([]);
  });

  test('a broken heading, an unknown file and stale allowlist entries are reported', () => {
    const files = new Map<string, string>([
      ['doc/a.md', '# Title\n## The areas — a partition\n```\n## Fenced\n```\n'],
      ['x.ts', '// doc/a.md § The areas holds it; a.md § Fenced does not; gone.md § Nothing'],
      ['y.sh', '# see doc/a.md § The\n# areas, split across lines'],
    ]);
    const stale: UnwritableRef = { citing: '.claude/z.md', file: 'doc/a.md', tailStartsWith: 'z', reason: 'r' };
    const { offenders, count } = sectionRefOffenders(files, { 'far.md': 'Other' }, [stale]);
    expect(count).toBe(4);
    expect(offenders).toEqual([
      'x.ts: "a.md § fenced does not; gone.md § nothing" names no heading of doc/a.md',
      'x.ts: gone.md resolves to no file in the tree',
      'FOREIGN_DOCS entry far.md is stale: no unresolved reference uses it',
      'UNWRITABLE_REFS entry .claude/z.md -> doc/a.md is stale',
    ]);
  });

  test('a foreign file and an allowlisted unwritable reference are accepted', () => {
    const files = new Map<string, string>([
      ['doc/a.md', '## Real\n'],
      ['.claude/z.md', 'far.md § Anything, and doc/a.md § Missing heading'],
    ]);
    const entry: UnwritableRef = { citing: '.claude/z.md', file: 'doc/a.md', tailStartsWith: 'missing', reason: 'r' };
    expect(sectionRefOffenders(files, { 'far.md': 'Other' }, [entry]).offenders).toEqual([]);
  });
});

describe('doc sync — agents never cite Rdo/Server as a declaration source (read-only)', () => {
  test('no .claude/agents/*.md line pairs Rdo/Server with "declaration"', () => {
    const dir = path.join(REPO_ROOT, '.claude/agents');
    const agents = new Map<string, string>();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      agents.set(f, fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    expect(agents.size).toBeGreaterThan(0);
    expect(agentDeclarationOffenders(agents)).toEqual([]);
  });

  test('the old wording is reported and the negated form is not', () => {
    const agents = new Map<string, string>([
      ['old.md', 'Read the declaration in the Rdo/Server/ directory.'],
      ['new.md', '`Rdo/Server/` is the transport: it holds no member declaration.'],
    ]);
    expect(agentDeclarationOffenders(agents)).toEqual(['old.md line 1: Read the declaration in the Rdo/Server/ directory.']);
  });
});
