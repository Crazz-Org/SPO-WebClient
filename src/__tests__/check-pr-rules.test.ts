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
