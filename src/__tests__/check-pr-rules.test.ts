/**
 * scripts/check-pr-rules.js — the two rules the ruleset cannot express, made mechanical.
 *
 * The pure predicates, plus the one way the script used to fail OPEN: an unresolvable diff
 * base. That needs a real git repository, so it gets one — a throwaway in tmp, not the
 * working tree.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface RuleResult {
  ok: boolean;
  detail: string;
}

interface Regression {
  scope: string;
  metric: string;
  from: number | string;
  to: number | string;
}

interface Thresholds {
  [scope: string]: { [metric: string]: number };
}

interface CheckPrRulesModule {
  CITATION_FILES: string[];
  checkCitation(files: string[], body: string): RuleResult;
  thresholdRegressions(base: Thresholds, head: Thresholds): Regression[];
  checkThresholds(base: Thresholds, head: Thresholds): RuleResult;
  ratchetResult(baseState: BaseThresholdState, head: Thresholds): RuleResult;
}

type BaseThresholdState =
  | { state: 'ok'; thresholds: Thresholds }
  | { state: 'absent' }
  | { state: 'unreadable'; reason: string };

const rules: CheckPrRulesModule = require('../../scripts/check-pr-rules.js');

describe('checkCitation', () => {
  it('is silent while the catalogue is untouched, whatever the body says', () => {
    expect(rules.checkCitation(['src/client/App.tsx'], '').ok).toBe(true);
  });

  it('accepts a File.pas:Line citation anywhere in the body', () => {
    expect(
      rules.checkCitation(['src/shared/rdo-members.ts'], 'kind from RDOObjectServer.pas:218').ok,
    ).toBe(true);
    expect(rules.checkCitation(['src/shared/rdo-members.ts'], 'see BasicTaxes.pas:249 out').ok).toBe(true);
  });

  it('rejects a body with no citation, or a filename with no line', () => {
    expect(rules.checkCitation(['src/shared/rdo-members.ts'], 'trust me').ok).toBe(false);
    expect(rules.checkCitation(['src/shared/rdo-members.ts'], 'see RDOObjectServer.pas').ok).toBe(false);
    expect(rules.checkCitation(['src/shared/rdo-members.ts'], '').ok).toBe(false);
  });
});

describe('thresholdRegressions', () => {
  const base: Thresholds = {
    global: { lines: 38, functions: 39, branches: 29, statements: 38 },
    './src/shared/': { lines: 54, functions: 65, branches: 37, statements: 54 },
  };

  it('says nothing when every value holds or rises', () => {
    expect(rules.thresholdRegressions(base, base)).toEqual([]);
    const raised = { ...base, global: { ...base.global, lines: 40 } };
    expect(rules.thresholdRegressions(base, raised)).toEqual([]);
  });

  it('catches a lowered metric and reports both values', () => {
    const lowered = { ...base, global: { ...base.global, branches: 20 } };
    expect(rules.thresholdRegressions(base, lowered)).toEqual([
      { scope: 'global', metric: 'branches', from: 29, to: 20 },
    ]);
  });

  it('catches a deleted metric and a deleted scope — a retreat by omission is still a retreat', () => {
    const droppedMetric = { ...base, global: { lines: 38, functions: 39, statements: 38 } };
    expect(rules.thresholdRegressions(base, droppedMetric)).toEqual([
      { scope: 'global', metric: 'branches', from: 29, to: 'removed' },
    ]);
    expect(rules.thresholdRegressions(base, { global: base.global })).toEqual([
      { scope: './src/shared/', metric: '*', from: 'present', to: 'removed' },
    ]);
  });

  it('lets a new scope in without complaint', () => {
    const added = { ...base, './src/server/': { lines: 60 } };
    expect(rules.thresholdRegressions(base, added)).toEqual([]);
  });

  it('tolerates an empty or absent base rather than inventing a failure', () => {
    expect(rules.thresholdRegressions({}, base)).toEqual([]);
  });
});

describe('checkThresholds', () => {
  it('passes on equal configs and fails on a retreat, quoting the numbers', () => {
    const base: Thresholds = { global: { lines: 38 } };
    expect(rules.checkThresholds(base, base).ok).toBe(true);
    const result = rules.checkThresholds(base, { global: { lines: 30 } });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('global lines: 38 -> 30');
  });
});

describe('ratchetResult — the base states are not interchangeable', () => {
  it('passes when the base genuinely has no jest.config.js', () => {
    const result = rules.ratchetResult({ state: 'absent' }, { global: { lines: 38 } });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('nothing to ratchet against');
  });

  it('FAILS when the base has the file but it could not be read', () => {
    // The whole point: this used to return ok, so any read error silently disarmed the
    // ratchet while printing a line that read like success.
    const result = rules.ratchetResult({ state: 'unreadable', reason: 'boom' }, { global: { lines: 38 } });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('boom');
  });

  it('judges the numbers when the base was read', () => {
    const base: BaseThresholdState = { state: 'ok', thresholds: { global: { lines: 38 } } };
    expect(rules.ratchetResult(base, { global: { lines: 38 } }).ok).toBe(true);
    expect(rules.ratchetResult(base, { global: { lines: 30 } }).ok).toBe(false);
  });
});

describe('the script against a real repository', () => {
  const SCRIPT = path.resolve(__dirname, '../../scripts/check-pr-rules.js');
  let repo: string;

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  /** Run the script in the throwaway repo; returns its exit code and combined output. */
  const run = (env: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
    try {
      const out = execFileSync('node', [SCRIPT], {
        cwd: repo,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, PR_BODY: '', BASE_SHA: '', ...env },
      });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-test-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, 'jest.config.js'), 'module.exports = { coverageThreshold: { global: { lines: 38 } } };\n');
    fs.mkdirSync(path.join(repo, 'src/shared'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-frame.ts'), 'export const emitter = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('branch', 'work');
    git('checkout', '-q', 'work');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('refuses when no diff base can be resolved, instead of passing over an empty set', () => {
    // No origin/main, no BASE_SHA — and `main` exists but the old fallback was the working
    // tree, which is clean here, so every rule would have reported ok over zero files.
    git('branch', '-D', 'main');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain('no diff base could be resolved');
  });

  it('fails the ratchet when jest.config.js on the base cannot be required', () => {
    // The script reads the MERGE-BASE, not main's tip, so the unreadable config has to be
    // there — breaking main after the fork would never be looked at. Fast-forward the branch
    // onto the broken commit, then repair the config on the branch so the HEAD read succeeds
    // and the base read is the only thing that can fail.
    git('checkout', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'jest.config.js'), 'this is not javascript {{{\n');
    git('commit', '-qam', 'break the base config');
    git('checkout', '-q', 'work');
    git('merge', '-q', 'main', '-m', 'take main');
    fs.writeFileSync(path.join(repo, 'jest.config.js'), 'module.exports = { coverageThreshold: { global: { lines: 38 } } };\n');
    git('commit', '-qam', 'repair the config on the branch');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain('could not be read');
  });

  it('passes a clean unrelated change', () => {
    fs.writeFileSync(path.join(repo, 'note.md'), 'x\n');
    git('add', '-A');
    git('commit', '-qm', 'unrelated change');
    const { code } = run();
    expect(code).toBe(0);
  });

  /**
   * The base must be the base BRANCH, not the sha the base happened to be at when the pull
   * request was opened. CI checks out the merge ref — this branch merged into the base's
   * current tip — so against a frozen sha `merge-base` returns that sha itself and the diff
   * carries everything the base gained in the meantime. On 2026-09-12 that failed the RDO
   * citation rule on PR #743, five files none of which is `rdo-members.ts`: main had merged
   * a properly cited catalogue change between the PR's two pushes.
   */
  describe('a base that has moved since the pull request opened', () => {
    /** Reproduce CI's checkout: the branch's own change, then main's, then the merge ref. */
    const openThenMainMoves = (): string => {
      fs.writeFileSync(path.join(repo, 'note.md'), 'the pull request\'s own change\n');
      git('add', '-A');
      git('commit', '-qm', 'the change under review');
      const baseWhenOpened = git('rev-parse', 'main');

      git('checkout', '-q', 'main');
      fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), 'export const CATALOGUE = 1;\n');
      git('add', '-A');
      git('commit', '-qm', 'someone else cites Kernel/Foo.pas:1 and merges');

      git('checkout', '-q', 'work');
      git('merge', '-q', 'main', '-m', 'the merge ref CI actually checks out');
      return baseWhenOpened;
    };

    it('judges only the pull request\'s own files when given the base branch', () => {
      openThenMainMoves();
      // No citation in the body, and the catalogue is untouched BY THIS BRANCH.
      const { code, out } = run({ BASE_SHA: 'main' });
      expect(out).toContain('catalogue untouched');
      expect(code).toBe(0);
    });

    it('blames the branch for the base\'s own files when given the frozen sha', () => {
      const baseWhenOpened = openThenMainMoves();
      const { code, out } = run({ BASE_SHA: baseWhenOpened });
      // The bug, pinned: rdo-members.ts is main's commit, not this branch's.
      expect(out).toContain('rdo-members.ts changed');
      expect(code).toBe(1);
    });
  });
});

/**
 * checkCitation's parser-backed gate (the wiring of scripts/check-rdo-citation.js into this
 * script's existing RDO-catalogue rule). Fully hermetic: a scratch `.pas` file under a scratch
 * `SPO_ORIGINAL_DIR` plays the reference tree, so these tests do not depend on `~/SPO-Original`
 * being present (unlike rdo-reference-manifest.test.ts / check-rdo-citation.test.ts, which read
 * the real one and skip when it's absent — this suite has no need to, since the parser only
 * cares that the cited file+line exists and says what the entry claims, not that it is *the*
 * real game server tree).
 *
 * `Stale` is planted in the BASE commit and never touched again: it cites a real declaration
 * (`Kernel/TestUnit.pas:5`, `DoThing`, genuinely arity 2) but CLAIMS arity 1 — a citation that
 * would MISMATCH if the parser ever looked at it. It exists purely to prove the diff-scoping:
 * every test below adds or changes some OTHER entry, and none of them may ever mention `Stale`
 * in their output, or the gate is verifying the whole file instead of just what changed.
 */
describe('checkCitation — the parser-backed gate (Part A wiring)', () => {
  const SCRIPT = path.resolve(__dirname, '../../scripts/check-pr-rules.js');
  let repo: string;
  let referenceRoot: string;

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  const run = (env: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
    try {
      const out = execFileSync('node', [SCRIPT], {
        cwd: repo,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, PR_BODY: '', BASE_SHA: '', SPO_ORIGINAL_DIR: referenceRoot, ...env },
      });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  const BASE_CATALOGUE = [
    'export const RDO_MEMBERS = {',
    "  AccountStatus:             { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:369",
    "  Stale:                     { kind: 'function',  arity: 1 },                // Kernel/TestUnit.pas:5",
    '} as const;',
    '',
  ].join('\n');

  const withEntry = (entryLine: string): string =>
    [
      'export const RDO_MEMBERS = {',
      "  AccountStatus:             { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:369",
      `  ${entryLine}`,
      "  Stale:                     { kind: 'function',  arity: 1 },                // Kernel/TestUnit.pas:5",
      '} as const;',
      '',
    ].join('\n');

  // A correct citation: DoThing (Kernel/TestUnit.pas:5) is a real 2-arg function.
  const GOOD_ONE =
    "GoodOne:                   { kind: 'function',  arity: 2 },                // Kernel/TestUnit.pas:5";
  // A wrong citation: same real declaration, arity claimed as 99.
  const BAD_ARITY =
    "BadArity:                  { kind: 'function',  arity: 99 },               // Kernel/TestUnit.pas:5";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-parser-test-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 'test');
    fs.writeFileSync(
      path.join(repo, 'jest.config.js'),
      'module.exports = { coverageThreshold: { global: { lines: 38 } } };\n',
    );
    fs.mkdirSync(path.join(repo, 'src/shared'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), BASE_CATALOGUE);
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'work');

    referenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-reference-root-'));
    fs.mkdirSync(path.join(referenceRoot, 'Kernel'), { recursive: true });
    fs.writeFileSync(
      path.join(referenceRoot, 'Kernel/TestUnit.pas'),
      [
        'unit TestUnit;',
        '',
        'interface',
        '',
        'function DoThing(a, b: Integer): Boolean;',
        'procedure DoOther(x: Integer);',
        '',
        'implementation',
        '',
        'end.',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(referenceRoot, { recursive: true, force: true });
  });

  it('a correctly cited new entry passes with zero LLM tokens -- the fast path', () => {
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), withEntry(GOOD_ONE));
    git('add', '-A');
    git('commit', '-qm', 'add GoodOne');
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('all parser-verified MATCH');
    expect(out).toContain('citation-verifier not required');
    expect(out).not.toContain('Stale');
  });

  it('a wrong-arity citation fails when the PR body cites nothing, naming the entry and verdict', () => {
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), withEntry(BAD_ARITY));
    git('add', '-A');
    git('commit', '-qm', 'add BadArity');
    const { code, out } = run({ PR_BODY: '' });
    expect(code).toBe(1);
    expect(out).toContain('BadArity');
    expect(out).toContain('MISMATCH(arity)');
  });

  it('the same wrong citation passes when the PR body cites something -- fallback posture preserved -- but still names the flagged entry', () => {
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), withEntry(BAD_ARITY));
    git('add', '-A');
    git('commit', '-qm', 'add BadArity');
    const { code, out } = run({ PR_BODY: 'see SomeOther.pas:1 for context' });
    expect(code).toBe(0);
    expect(out).toContain('BadArity');
    expect(out).toContain('MISMATCH(arity)');
  });

  it('an unchanged entry that would fail the parser is never flagged -- proves the diff-scoping, not just the verification', () => {
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), withEntry(GOOD_ONE));
    git('add', '-A');
    git('commit', '-qm', 'add GoodOne');
    const { code, out } = run();
    // The fast path only reports a count, not names — so this asserts against the count staying
    // at 1 (only GoodOne, the entry this test actually touched) and 'Stale' never appearing,
    // which it would if the gate re-verified the whole file instead of just the diff.
    expect(code).toBe(0);
    expect(out).toContain('1 entry changed, all parser-verified MATCH');
    expect(out).not.toContain('Stale');
  });

  it('rdo-members.ts untouched entirely -- unchanged behavior', () => {
    fs.writeFileSync(path.join(repo, 'note.md'), 'unrelated\n');
    git('add', '-A');
    git('commit', '-qm', 'unrelated change');
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('catalogue untouched');
  });

  /**
   * The fast path's hardest failure mode, found by probing rather than by reading: a changed
   * entry written in a shape ENTRY_LINE_RE cannot read used to be dropped as "not an entry",
   * and one SIBLING entry's clean MATCH then carried the whole file through with nothing asked
   * of the PR body — a gate strictly WEAKER than the pre-parser one, which at least demanded a
   * citation somewhere. Every shape below passed with exit 0 and an empty body before the fix.
   *
   * The wrong entry is `arity: 99` against `DoThing`, a real 2-parameter function, in all four.
   */
  describe('a changed entry the grammar cannot read never rides a sibling entry\'s MATCH', () => {
    const unreadable: Array<[string, string[]]> = [
      ['spread over several lines', ['  BadMultiline: {', "    kind: 'function',", '    arity: 99,', '  }, // Kernel/TestUnit.pas:5']],
      ['missing its trailing comma', ["  BadNoComma:                { kind: 'function',  arity: 99 }                 // Kernel/TestUnit.pas:5"]],
      ['double-quoted', ['  BadQuotes:                 { kind: "function",  arity: 99 },               // Kernel/TestUnit.pas:5']],
      ['carrying an extra field', ["  BadExtra:                  { kind: 'function', arity: 99, note: 'x' },     // Kernel/TestUnit.pas:5"]],
    ];

    it.each(unreadable)('%s -- fails, and names the line it could not read', (_shape, lines) => {
      fs.writeFileSync(
        path.join(repo, 'src/shared/rdo-members.ts'),
        [
          'export const RDO_MEMBERS = {',
          "  AccountStatus:             { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:369",
          `  ${GOOD_ONE}`,
          ...lines,
          "  Stale:                     { kind: 'function',  arity: 1 },                // Kernel/TestUnit.pas:5",
          '} as const;',
          '',
        ].join('\n'),
      );
      git('add', '-A');
      git('commit', '-qm', 'a good entry and an unreadable one');
      // No citation anywhere in the body: the ONLY thing that could pass this is the fast path.
      const { code, out } = run({ PR_BODY: 'no citation of any kind in this body' });
      expect(code).toBe(1);
      expect(out).not.toContain('all parser-verified MATCH');
      expect(out).toContain('the entry parser cannot read');
      expect(out).not.toContain('Stale'); // still scoped to the diff, not the whole file
    });

    it('an unreadable line is surfaced even when the PR body does carry a citation', () => {
      fs.writeFileSync(
        path.join(repo, 'src/shared/rdo-members.ts'),
        [
          'export const RDO_MEMBERS = {',
          `  ${GOOD_ONE}`,
          "  BadNoComma:                { kind: 'function',  arity: 99 }                 // Kernel/TestUnit.pas:5",
          '} as const;',
          '',
        ].join('\n'),
      );
      git('add', '-A');
      git('commit', '-qm', 'a good entry and an unreadable one');
      const { code, out } = run({ PR_BODY: 'cites Something.pas:1 elsewhere' });
      expect(code).toBe(0); // the legacy fallback's posture, unchanged
      expect(out).toContain('BadNoComma'); // but the human is told what went unverified
      expect(out).toContain('NOT parser-verified');
    });

    it('a comment or a blank line inside the literal is NOT mistaken for an unreadable entry', () => {
      // The discrimination that keeps the fast path usable: in-literal `//` comments are
      // ordinary in the real catalogue (three blocks of them), and must not force a fallback.
      fs.writeFileSync(
        path.join(repo, 'src/shared/rdo-members.ts'),
        [
          'export const RDO_MEMBERS = {',
          '  // A newly written explanatory comment, with a blank line under it.',
          '',
          `  ${GOOD_ONE}`,
          "  Stale:                     { kind: 'function',  arity: 1 },                // Kernel/TestUnit.pas:5",
          '} as const;',
          '',
        ].join('\n'),
      );
      git('add', '-A');
      git('commit', '-qm', 'add GoodOne with a comment above it');
      const { code, out } = run({ PR_BODY: '' });
      expect(code).toBe(0);
      expect(out).toContain('all parser-verified MATCH');
    });
  });

  it('falls back to the PR-body check with a clear note when the reference tree is unavailable -- never a silent pass', () => {
    fs.writeFileSync(path.join(repo, 'src/shared/rdo-members.ts'), withEntry(GOOD_ONE));
    git('add', '-A');
    git('commit', '-qm', 'add GoodOne');
    const missingRoot = path.join(os.tmpdir(), 'definitely-does-not-exist-xyz-12345');

    const failing = run({ SPO_ORIGINAL_DIR: missingRoot, PR_BODY: '' });
    expect(failing.code).toBe(1);
    expect(failing.out).toContain('parser verification skipped');
    expect(failing.out).toContain('not available');

    const passing = run({ SPO_ORIGINAL_DIR: missingRoot, PR_BODY: 'cites Foo.pas:1 for context' });
    expect(passing.code).toBe(0);
    expect(passing.out).toContain('parser verification skipped');
  });
});

/**
 * Pure unit coverage of the diff-hunk parsing itself (parseAddedLineNumbers) and the citation
 * extraction (extractPasCitations) — the two primitives findChangedCatalogueEntries composes.
 * No git repository needed: these operate on plain strings.
 */
describe('parseAddedLineNumbers — unified diff hunk-header parsing', () => {
  const rules: { parseAddedLineNumbers(diffText: string): Set<number> } = require('../../scripts/check-pr-rules.js');

  it('a pure insertion (single new line) is reported at its new-file line number', () => {
    const diff = ['@@ -2,0 +3 @@ export const RDO_MEMBERS = {', '+  NewOne: {},'].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([3]));
  });

  it('a straight one-line replace reports only the new line, not the old one', () => {
    const diff = ['@@ -3 +3 @@', '-  Old: { arity: 1 },', '+  New: { arity: 2 },'].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([3]));
  });

  it('a pure deletion contributes no added line number at all', () => {
    const diff = ['@@ -3 +2,0 @@'].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set());
  });

  it('multiple hunks each track their own new-file counter independently', () => {
    const diff = [
      '@@ -2,0 +3 @@',
      '+  A: {},',
      '@@ -10,2 +11,3 @@',
      '-  B: {},',
      '-  C: {},',
      '+  B2: {},',
      '+  C2: {},',
      '+  D: {},',
    ].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([3, 11, 12, 13]));
  });

  it('a multi-line added block gets consecutive new-file line numbers', () => {
    const diff = ['@@ -5,0 +6,3 @@', '+  A: {},', '+  B: {},', '+  C: {},'].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([6, 7, 8]));
  });

  it('an added line whose own text starts with ++ still claims its line number', () => {
    // It renders as `+++…`, which a prefix-based `---`/`+++` skip swallowed — dropping the
    // line AND leaving every line after it in the hunk numbered one too low, which moves the
    // entry the gate believes changed. Header lines are handled by the `diff --git` reset
    // below, not by sniffing content.
    // The added source line is `++i;`, so the DIFF line is `+` + `++i;` = `+++i;` — three
    // pluses, indistinguishable by prefix from a `+++ b/file` header.
    const diff = ['@@ -5,0 +6,2 @@', '+++i;', '+  A: {},'].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([6, 7]));
  });

  it('a multi-file diff does not count the next file\'s ---/+++ headers as added lines', () => {
    const diff = [
      'diff --git a/one.ts b/one.ts',
      'index 1111111..2222222 100644',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -2,0 +3 @@',
      '+  A: {},',
      'diff --git a/two.ts b/two.ts',
      'index 3333333..4444444 100644',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -9,0 +10 @@',
      '+  B: {},',
    ].join('\n');
    expect(rules.parseAddedLineNumbers(diff)).toEqual(new Set([3, 10]));
  });
});

describe('extractPasCitations — pulling File.pas:Line citations out of a trailing comment', () => {
  const rules: { extractPasCitations(comment: string): { file: string; line: number }[] } = require('../../scripts/check-pr-rules.js');

  it('a single .pas citation with a directory prefix', () => {
    expect(rules.extractPasCitations('StdBlocks/Banks.pas:39')).toEqual([{ file: 'StdBlocks/Banks.pas', line: 39 }]);
  });

  it('a directory name containing a space is captured whole', () => {
    expect(rules.extractPasCitations('Interface Server/InterfaceServer.pas:441; src/server/x.ts')).toEqual([
      { file: 'Interface Server/InterfaceServer.pas', line: 441 },
    ]);
  });

  it('two comma-separated .pas citations both come back', () => {
    expect(rules.extractPasCitations('Kernel/TownPolitics.pas:45, Kernel/WorldPolitics.pas:260')).toEqual([
      { file: 'Kernel/TownPolitics.pas', line: 45 },
      { file: 'Kernel/WorldPolitics.pas', line: 260 },
    ]);
  });

  it('a TS-only reference comment (no .pas at all) yields nothing', () => {
    expect(rules.extractPasCitations('src/server/session/mail-handler.ts:131,224')).toEqual([]);
  });

  it('an empty comment yields nothing', () => {
    expect(rules.extractPasCitations('')).toEqual([]);
  });

  it('decoration around an otherwise whole-segment citation is stripped, not fatal', () => {
    expect(rules.extractPasCitations('`Kernel/Foo.pas:40`')).toEqual([{ file: 'Kernel/Foo.pas', line: 40 }]);
    expect(rules.extractPasCitations('Kernel/Foo.pas:40.')).toEqual([{ file: 'Kernel/Foo.pas', line: 40 }]);
    expect(rules.extractPasCitations('(Kernel/Foo.pas:40)')).toEqual([{ file: 'Kernel/Foo.pas', line: 40 }]);
  });

  it('a .pas reference buried in prose is deliberately NOT read as the entry\'s citation', () => {
    // The safe direction, and the one the gate's own message states: such an entry is reported
    // as uncited and routed to review. Reading an incidental mention as the citation would let
    // it authorise the zero-LLM fast path by happening to agree with the claim.
    expect(rules.extractPasCitations('declared at Kernel/Foo.pas:40 in the server')).toEqual([]);
  });
});
