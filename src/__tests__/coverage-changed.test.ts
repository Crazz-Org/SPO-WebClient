/**
 * scripts/coverage-changed.js — the changed-line coverage rule, made mechanical.
 *
 * The pure pieces (hunk parsing, eligibility, the measurement against an istanbul report)
 * are tested directly; the git side runs against a throwaway repo, never this one; and the
 * CLI flow runs with an injected stand-in for the Jest run, so no suite is spawned here.
 *
 * Since #131 this script IS the precheck's suite pass, so `main` always calls the run —
 * the old "exits early on a clean branch" case is gone by design, not by accident.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface FileReport {
  file: string;
  changed: number;
  statements: number;
  covered: number;
  ratio: number | null;
  missing: number[];
  instrumented: boolean;
}

interface Report {
  files: FileReport[];
  total: number;
  covered: number;
  ratio: number | null;
}

interface IstanbulEntry {
  path: string;
  statementMap: Record<string, { start: { line: number; column: number }; end: { line: number; column: number } }>;
  s: Record<string, number>;
}

interface JestRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Sink {
  write(chunk: string): boolean;
}

interface MainOptions {
  run?: (files: string[], cwd: string) => JestRun;
  env?: NodeJS.ProcessEnv;
  out?: Sink;
  err?: Sink;
}

interface CoverageChanged {
  DEFAULT_MIN: number;
  diffBase(cwd?: string): string | null;
  isEligible(file: string): boolean;
  parseUnifiedDiff(text: string): Map<string, Set<number>>;
  allLines(file: string, cwd: string): Set<number>;
  collectChangedLines(cwd: string): { base: string | null; changed: Map<string, Set<number>> };
  evaluate(changed: Map<string, Set<number>>, coverage: Record<string, IstanbulEntry>, rootDir: string): Report;
  formatLines(lines: number[]): string;
  formatReport(report: Report, min: number): string;
  resolveMinimum(env: NodeJS.ProcessEnv): number;
  main(options?: MainOptions): number;
  runJest(files: string[], cwd: string): JestRun;
}

const script: CoverageChanged = require(path.join(process.cwd(), 'scripts', 'coverage-changed.js'));

function entry(file: string, lines: Record<number, number>): IstanbulEntry {
  const statementMap: IstanbulEntry['statementMap'] = {};
  const s: IstanbulEntry['s'] = {};
  let id = 0;
  for (const [line, count] of Object.entries(lines)) {
    statementMap[String(id)] = {
      start: { line: Number(line), column: 0 },
      end: { line: Number(line), column: 10 },
    };
    s[String(id)] = count;
    id++;
  }
  return { path: file, statementMap, s };
}

function sink(): Sink & { text: string } {
  const captured = {
    text: '',
    write(chunk: string): boolean {
      captured.text += chunk;
      return true;
    },
  };
  return captured;
}

describe('isEligible', () => {
  it.each([
    'src/shared/rdo-frame.ts',
    'src/client/components/Foo.tsx',
    'src/e2e/flows.ts',
    'src\\server\\session.ts',
    'src/server/__tests__/protocol-validation/protocol-test-harness.ts',
    'src/__tests__/load/session-capacity.ts',
    'src/client/__mocks__/audio.ts',
  ])('accepts %s', file => {
    expect(script.isEligible(file)).toBe(true);
  });

  it.each([
    'src/shared/rdo-frame.test.ts',
    'src/client/components/Foo.test.tsx',
    'src/mock-server/rdo-mock.ts',
    'src/server/__tests__/matchers/rdo-matchers.d.ts',
    'scripts/coverage-changed.js',
    'src/client/style.css',
    'src/__mocks__/css-module.js',
    'src/__tests__/load/session-memory.load.ts',
    'src/client/__tests__/render.load.tsx',
    'src\\__tests__\\load\\session-memory.load.ts',
    'doc/BACKLOG.md',
  ])('rejects %s', file => {
    expect(script.isEligible(file)).toBe(false);
  });
});

describe('parseUnifiedDiff', () => {
  it('reads the + side of every hunk, with the implicit count of 1', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      '+x',
      '+y',
      '+z',
      '@@ -10 +11 @@',
      '+w',
      '@@ -20,3 +22,0 @@',
      '-gone',
      '-gone',
      '-gone',
    ].join('\n');
    const parsed = script.parseUnifiedDiff(diff);
    expect([...parsed.keys()]).toEqual(['src/a.ts']);
    expect([...parsed.get('src/a.ts')!].sort((a, b) => a - b)).toEqual([1, 2, 3, 11]);
  });

  it('separates files and ignores a deleted file', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '--- a/src/b.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
      '--- /dev/null',
      '+++ b/src/c.ts',
      '@@ -0,0 +1,2 @@',
    ].join('\n');
    const parsed = script.parseUnifiedDiff(diff);
    expect([...parsed.keys()]).toEqual(['src/a.ts', 'src/c.ts']);
    expect([...parsed.get('src/c.ts')!]).toEqual([1, 2]);
  });

  it('returns an empty map for an empty diff', () => {
    expect(script.parseUnifiedDiff('').size).toBe(0);
  });
});

describe('evaluate', () => {
  const root = '/repo';

  it('counts only changed lines that start a statement, covered when the statement ran', () => {
    const changed = new Map([['src/a.ts', new Set([1, 2, 3, 4, 5])]]);
    // Line 1 covered, 2 uncovered, 3 has no statement, 4 has two statements (one ran),
    // line 9 changed nothing so it is ignored even though it is uncovered.
    const cov = entry('/repo/src/a.ts', { 1: 3, 2: 0, 9: 0 });
    cov.statementMap['3'] = { start: { line: 4, column: 0 }, end: { line: 4, column: 5 } };
    cov.s['3'] = 0;
    cov.statementMap['4'] = { start: { line: 4, column: 6 }, end: { line: 4, column: 9 } };
    cov.s['4'] = 1;
    const report = script.evaluate(changed, { '/repo/src/a.ts': cov }, root);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({
      file: 'src/a.ts',
      changed: 5,
      statements: 3,
      covered: 2,
      missing: [2],
      instrumented: true,
    });
    expect(report.files[0].ratio).toBeCloseTo(66.67, 1);
    expect(report.total).toBe(3);
    expect(report.covered).toBe(2);
  });

  it('aggregates across files and flags a file absent from the report', () => {
    const changed = new Map([
      ['src/a.ts', new Set([1, 2])],
      ['src/b.ts', new Set([1])],
    ]);
    const report = script.evaluate(changed, { '/repo/src/a.ts': entry('/repo/src/a.ts', { 2: 0, 1: 0 }) }, root);
    expect(report.files[0].missing).toEqual([1, 2]);
    expect(report.files[1]).toMatchObject({ file: 'src/b.ts', statements: 0, ratio: null, instrumented: false });
    expect(report.ratio).toBe(0);
  });

  it('reports a null ratio when no changed line carries a statement', () => {
    const changed = new Map([['src/a.ts', new Set([7])]]);
    const report = script.evaluate(changed, { '/repo/src/a.ts': entry('/repo/src/a.ts', { 1: 1 }) }, root);
    expect(report.ratio).toBeNull();
    expect(report.total).toBe(0);
  });
});

describe('formatLines / formatReport', () => {
  it('compacts consecutive lines into ranges', () => {
    expect(script.formatLines([])).toBe('');
    expect(script.formatLines([3, 4, 5, 9, 11, 12])).toBe('3-5, 9, 11-12');
  });

  it('prints one row per file and the aggregate verdict', () => {
    const report: Report = {
      files: [
        { file: 'src/a.ts', changed: 4, statements: 3, covered: 3, ratio: 100, missing: [], instrumented: true },
        { file: 'src/b.ts', changed: 2, statements: 2, covered: 0, ratio: 0, missing: [1, 2], instrumented: true },
        { file: 'src/c.ts', changed: 1, statements: 0, covered: 0, ratio: null, missing: [], instrumented: false },
      ],
      total: 5,
      covered: 3,
      ratio: 60,
    };
    const text = script.formatReport(report, 93);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('100.0 %');
    expect(text).toContain('1-2');
    expect(text).toContain('(not loaded by any test)');
    expect(text).toContain('3/5 statement lines, 60.0 % (minimum 93 %) -> FAIL');
    expect(script.formatReport({ ...report, ratio: 95 }, 93)).toContain('-> PASS');
    expect(script.formatReport({ files: [], total: 0, covered: 0, ratio: null }, 93)).toContain('n/a (minimum 93 %) -> n/a');
  });
});

describe('resolveMinimum', () => {
  it('defaults to 93 and reads COVERAGE_CHANGED_MIN', () => {
    expect(script.DEFAULT_MIN).toBe(93);
    expect(script.resolveMinimum({})).toBe(93);
    expect(script.resolveMinimum({ COVERAGE_CHANGED_MIN: '' })).toBe(93);
    expect(script.resolveMinimum({ COVERAGE_CHANGED_MIN: '80.5' })).toBe(80.5);
  });

  it('refuses a value that is not a percentage', () => {
    expect(() => script.resolveMinimum({ COVERAGE_CHANGED_MIN: 'lots' })).toThrow(/COVERAGE_CHANGED_MIN/);
    expect(() => script.resolveMinimum({ COVERAGE_CHANGED_MIN: '101' })).toThrow(/COVERAGE_CHANGED_MIN/);
  });
});

/** A throwaway repo: `main` with one source file, then a feature branch on top. */
function scratchRepo(): { dir: string; run: (...args: string[]) => string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-coverage-changed-')));
  const run = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');
  run('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'src', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'shared', 'a.ts'), 'const a = 1;\nconst b = 2;\nexport { a, b };\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n', 'utf8');
  run('add', '.');
  run('commit', '-q', '-m', 'base');
  run('checkout', '-q', '-b', 'feature/x');
  return { dir, run };
}

describe('collectChangedLines on a scratch repo', () => {
  it('merges committed, working-tree and untracked changes, eligible files only', () => {
    const { dir, run } = scratchRepo();
    // Committed: a.ts line 2 modified; a new test file; a doc change.
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'a.ts'), 'const a = 1;\nconst b = 3;\nexport { a, b };\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'a.test.ts'), 'test\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\nworld\n', 'utf8');
    run('add', '.');
    run('commit', '-q', '-m', 'change');
    // Working tree: a.ts gains two lines at the top, which shifts the committed change to line 4.
    fs.writeFileSync(
      path.join(dir, 'src', 'shared', 'a.ts'),
      'import x from "y";\n\nconst a = 1;\nconst b = 3;\nexport { a, b };\n',
      'utf8'
    );
    // Untracked: a whole new module, and a mock-server file that must be ignored.
    fs.mkdirSync(path.join(dir, 'src', 'mock-server'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'mock-server', 'f.ts'), 'x\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'new.ts'), 'one\ntwo\nthree', 'utf8');

    const { base, changed } = script.collectChangedLines(dir);
    expect(base).toBe(run('rev-parse', 'main'));
    expect([...changed.keys()].sort()).toEqual(['src/shared/a.ts', 'src/shared/new.ts']);
    expect([...changed.get('src/shared/a.ts')!].sort((x, y) => x - y)).toEqual([1, 2, 4]);
    expect([...changed.get('src/shared/new.ts')!]).toEqual([1, 2, 3]);
  });

  it('falls back to HEAD when there is no main ref, and reports nothing when clean', () => {
    const { dir, run } = scratchRepo();
    run('branch', '-D', 'main');
    expect(script.diffBase(dir)).toBeNull();
    expect(script.collectChangedLines(dir)).toEqual({ base: null, changed: new Map() });
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'a.ts'), 'const a = 1;\nconst b = 2;\nexport { a, b };\n// t\n', 'utf8');
    expect([...script.collectChangedLines(dir).changed.get('src/shared/a.ts')!]).toEqual([4]);
  });

  it('treats an unreadable untracked path as having no lines', () => {
    const { dir } = scratchRepo();
    expect(script.allLines('src/shared/missing.ts', dir).size).toBe(0);
  });
});

describe('main', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('runs the suite even when no eligible file changed — a docs branch is still proven green', () => {
    const { dir } = scratchRepo();
    process.chdir(dir);
    const out = sink();
    const run = jest.fn().mockReturnValue({ status: 0, stdout: '', stderr: '' });
    expect(script.main({ run, out, err: sink(), env: {} })).toBe(0);
    // Called with no file: the suite runs, coverage is simply not collected.
    expect(run).toHaveBeenCalledWith([], dir);
    expect(out.text).toContain('nothing to measure');
    expect(out.text).toContain('suite green');
  });

  it('exits 1 when the suite fails on a branch with nothing to measure', () => {
    const { dir } = scratchRepo();
    process.chdir(dir);
    const err = sink();
    const run = jest.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'red' });
    expect(script.main({ run, out: sink(), err, env: {} })).toBe(1);
    expect(err.text).toContain('the suite is not green');
  });

  it('exits 1 when the Jest run itself fails', () => {
    const { dir } = scratchRepo();
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'new.ts'), 'x\n', 'utf8');
    process.chdir(dir);
    const err = sink();
    const run = jest.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'boom' });
    expect(script.main({ run, out: sink(), err, env: {} })).toBe(1);
    expect(run).toHaveBeenCalledWith(['src/shared/new.ts'], dir);
    expect(err.text).toContain('boom');
    expect(err.text).toContain('the suite is not green');
  });

  it('judges the aggregate against the minimum from the coverage file the run produced', () => {
    const { dir } = scratchRepo();
    fs.writeFileSync(path.join(dir, 'src', 'shared', 'new.ts'), 'one\ntwo\nthree\nfour\n', 'utf8');
    process.chdir(dir);
    const abs = path.join(dir, 'src', 'shared', 'new.ts');
    const run = (): JestRun => {
      fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'coverage', 'coverage-final.json'),
        JSON.stringify({ [abs]: entry(abs, { 1: 1, 2: 1, 3: 1, 4: 0 }) }),
        'utf8'
      );
      return { status: 0, stdout: '', stderr: '' };
    };
    const out = sink();
    expect(script.main({ run, out, err: sink(), env: {} })).toBe(1); // 75 % < 93 %
    expect(out.text).toContain('3/4 statement lines, 75.0 % (minimum 93 %) -> FAIL');
    expect(script.main({ run, out: sink(), err: sink(), env: { COVERAGE_CHANGED_MIN: '75' } })).toBe(0);
  });
});

describe('CLI entry', () => {
  const SCRIPT = path.join(process.cwd(), 'scripts', 'coverage-changed.js');

  function cli(dir: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
      return { code: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const failure = err as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
  }

  it('exits 1 with the reason when the minimum is not a percentage', () => {
    const { dir } = scratchRepo();
    const result = cli(dir, { COVERAGE_CHANGED_MIN: 'lots' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('coverage-changed: COVERAGE_CHANGED_MIN');
  });
});

describe('runJest', () => {
  it('spawns jest from the repo root and reports its exit status', () => {
    // A scratch directory holds no tests: jest exits non-zero, which is what we read back.
    const { dir } = scratchRepo();
    const result = script.runJest(['src/shared/a.ts'], dir);
    expect(typeof result.status).toBe('number');
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/No tests found|jest/i);
  });

  it('runs the suite with no coverage at all when nothing changed', () => {
    // `--collectCoverageFrom` restricts instrumentation, never execution — with no file
    // to instrument the run is a plain suite pass, which is what the precheck needs.
    const { dir } = scratchRepo();
    const result = script.runJest([], dir);
    expect(typeof result.status).toBe('number');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/collectCoverageFrom/);
  });
});
