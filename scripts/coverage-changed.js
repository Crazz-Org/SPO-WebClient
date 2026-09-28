#!/usr/bin/env node

/**
 * Coverage of the lines this branch touched — the "new/modified lines reach >= 93 %" rule,
 * made mechanical.
 *
 * The ratchet in jest.config.js guards whole directories and moves slowly; this script
 * guards the change itself. It collects every line this branch added or modified in
 * `src/**\/*.ts(x)` (committed since the merge-base, working tree, untracked), runs Jest
 * once with coverage restricted to exactly those files, then measures how many of the
 * changed lines that carry a statement were executed by a test.
 *
 *   npm run coverage:changed             # exit 1 when the aggregate is below the minimum
 *   COVERAGE_CHANGED_MIN=80 node scripts/coverage-changed.js
 *
 * Per-file ratios are printed as information; only the AGGREGATE decides the exit code.
 * The jest.config.js thresholds are deliberately neutralised for this run: they judge
 * whole directories, which a one-file change cannot be held to — and `npm test` does not
 * enforce them either, since it collects no coverage at all.
 *
 * ## One suite pass, not two
 *
 * This script IS the precheck's test pass. `--collectCoverageFrom` restricts what Jest
 * *instruments*, never what it *runs*: the run below has always executed all `find src -name '*.test.ts*' | wc -l` test
 * files, so `gate:precheck` calling `npm test` and then this script ran the whole suite
 * twice for one branch. It now runs once, here, and the changed lines are judged from
 * that same run. The suite therefore runs even when no eligible source file changed —
 * a docs-only branch must still be proven green before it queues for the bench.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_MIN = 93;
const COVERAGE_FILE = path.join('coverage', 'coverage-final.json');

function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
}

/**
 * The commit this branch is judged against — same semantics as verify-gate.js: `origin/main`
 * when the remote ref exists, else a local `main`, else nothing (the working tree is then
 * compared against HEAD alone).
 */
function diffBase(cwd) {
  for (const ref of ['origin/main', 'main']) {
    try {
      return git(['merge-base', 'HEAD', ref], cwd);
    } catch {
      // Try the next ref.
    }
  }
  return null;
}

/**
 * Which files the rule applies to: source under src/, TypeScript, and not a test, a
 * fixture, the mock server, a declaration file or a load-measurement script. A
 * `*.load.ts(x)` is run by hand to measure the server and `npm test` never executes it
 * (jest `testMatch` only collects `*.test.ts(x)` files), so no test can cover its lines.
 * Every other helper under `__tests__/` or `__mocks__/` stays in: `runJest` instruments
 * each changed file explicitly, so a helper the suite executes is measured like any
 * other source.
 */
function isEligible(file) {
  const normalised = file.replace(/\\/g, '/');
  if (!/^src\/.+\.tsx?$/.test(normalised)) return false;
  if (/\.test\.tsx?$/.test(normalised)) return false;
  if (/\.load\.tsx?$/.test(normalised)) return false;
  if (/\.d\.ts$/.test(normalised)) return false;
  if (normalised.startsWith('src/mock-server/')) return false;
  return true;
}

/**
 * Added/modified line numbers per file, read from a unified diff produced with `-U0`.
 * Only the `+` side matters: `@@ -a,b +c,d @@` means d lines starting at c in the new
 * file (d omitted = 1, d = 0 = a pure deletion, nothing to cover).
 */
function parseUnifiedDiff(text) {
  const result = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        current = null; // A deleted file has no new lines.
        continue;
      }
      current = target.replace(/^b\//, '');
      if (!result.has(current)) result.set(current, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const lines = result.get(current);
      for (let n = start; n < start + count; n++) lines.add(n);
    }
  }
  return result;
}

/** Every line of a file, for an untracked file that is entirely new. */
function allLines(file, cwd) {
  let body;
  try {
    body = fs.readFileSync(path.join(cwd, file), 'utf8');
  } catch {
    return new Set(); // Unreadable: nothing to measure.
  }
  const lines = body.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return new Set(lines.map((_, i) => i + 1));
}

/**
 * Everything this branch introduces, line by line: the diff from the merge-base straight
 * to the working tree (one diff, so the line numbers are those of the file as it is now —
 * summing a committed diff and a working-tree diff would disagree on them), plus the
 * untracked files as all-added. Eligible files only, and only those with lines to judge.
 */
function collectChangedLines(cwd) {
  const base = diffBase(cwd);
  const tracked = parseUnifiedDiff(git(['diff', '-U0', base || 'HEAD'], cwd));
  const changed = new Map();
  for (const [file, lines] of tracked) {
    if (isEligible(file) && lines.size > 0) changed.set(file, lines);
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd)
    .split('\n')
    .filter(Boolean);
  for (const file of untracked) {
    if (!isEligible(file)) continue;
    const lines = allLines(file, cwd);
    if (lines.size > 0) changed.set(file, lines);
  }
  return { base, changed };
}

/**
 * Measures the changed lines against an istanbul `coverage-final.json` object. A line
 * counts only when a statement starts on it; it is covered when any such statement ran.
 * A file missing from the report contributes no lines (nothing to execute, or never
 * loaded by a test — the `files` entries say which).
 */
function evaluate(changed, coverage, rootDir) {
  const byRelativePath = new Map();
  for (const [absolute, entry] of Object.entries(coverage)) {
    byRelativePath.set(path.relative(rootDir, absolute).replace(/\\/g, '/'), entry);
  }
  const files = [];
  let total = 0;
  let covered = 0;
  for (const [file, lines] of changed) {
    const entry = byRelativePath.get(file);
    const hit = new Map(); // line -> covered?
    if (entry) {
      for (const [id, statement] of Object.entries(entry.statementMap)) {
        const line = statement.start.line;
        if (!lines.has(line)) continue;
        hit.set(line, Boolean(hit.get(line)) || entry.s[id] > 0);
      }
    }
    const missing = [...hit.entries()]
      .filter(([, ok]) => !ok)
      .map(([line]) => line)
      .sort((a, b) => a - b);
    const fileTotal = hit.size;
    const fileCovered = fileTotal - missing.length;
    total += fileTotal;
    covered += fileCovered;
    files.push({
      file,
      changed: lines.size,
      statements: fileTotal,
      covered: fileCovered,
      ratio: fileTotal === 0 ? null : (100 * fileCovered) / fileTotal,
      missing,
      instrumented: Boolean(entry),
    });
  }
  return { files, total, covered, ratio: total === 0 ? null : (100 * covered) / total };
}

function formatRatio(ratio) {
  return ratio === null ? '   n/a' : `${ratio.toFixed(1).padStart(5)} %`;
}

/** Compact ranges: [3,4,5,9] -> "3-5, 9". */
function formatLines(lines) {
  const parts = [];
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    parts.push(i === j ? String(lines[i]) : `${lines[i]}-${lines[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function formatReport(report, min) {
  const width = Math.max(4, ...report.files.map(f => f.file.length));
  const out = [];
  out.push(`${'file'.padEnd(width)}  changed  stmts  covered   ratio  uncovered lines`);
  for (const f of report.files) {
    const note = f.instrumented ? formatLines(f.missing) : '(not loaded by any test)';
    out.push(
      `${f.file.padEnd(width)}  ${String(f.changed).padStart(7)}  ${String(f.statements).padStart(5)}  ` +
        `${String(f.covered).padStart(7)}  ${formatRatio(f.ratio)}  ${note}`
    );
  }
  const verdict = report.ratio === null ? 'n/a' : report.ratio >= min ? 'PASS' : 'FAIL';
  out.push('');
  out.push(
    `changed-line coverage: ${report.covered}/${report.total} statement lines, ` +
      `${formatRatio(report.ratio).trim()} (minimum ${min} %) -> ${verdict}`
  );
  return out.join('\n');
}

/** The minimum ratio, from COVERAGE_CHANGED_MIN when set. */
function resolveMinimum(env) {
  const raw = env.COVERAGE_CHANGED_MIN;
  if (raw === undefined || raw === '') return DEFAULT_MIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`COVERAGE_CHANGED_MIN must be a number between 0 and 100, got "${raw}"`);
  }
  return value;
}

/**
 * The one Jest run: the whole suite, with coverage instrumentation restricted to the
 * changed files and the directory thresholds neutralised.
 *
 * With no changed file there is nothing to instrument, so coverage is left off entirely —
 * the run is then a plain `npm test`, which is still what the precheck needs from it.
 * Output is captured rather than streamed, and shown only when the run fails; `--silent`
 * mutes the tests' own console noise, never Jest's failure report.
 */
function runJest(files, cwd) {
  const jestBin = require.resolve('jest/bin/jest');
  const coverage =
    files.length === 0
      ? []
      : [
          '--coverage',
          '--coverageReporters=json',
          '--coverageThreshold={}',
          ...files.map(file => `--collectCoverageFrom=${file}`),
        ];
  const args = [jestBin, '--silent', ...coverage];
  const run = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI || 'true' },
  });
  return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '' };
}

/** `run` is injectable so the CLI flow can be exercised without a real Jest run. */
function main({ run = runJest, env = process.env, out = process.stdout, err = process.stderr } = {}) {
  const cwd = git(['rev-parse', '--show-toplevel']);
  const min = resolveMinimum(env);
  const { base, changed } = collectChangedLines(cwd);
  out.write(`=== coverage of changed lines (base ${base ? base.slice(0, 12) : 'HEAD (no main ref)'})\n`);
  const files = [...changed.keys()];
  out.write(
    files.length === 0
      ? 'no eligible source file changed — running the suite, nothing to measure.\n'
      : `running the suite once, with coverage on ${files.length} changed file(s)...\n`,
  );
  const jest = run(files, cwd);
  if (jest.status !== 0) {
    err.write(jest.stderr.split('\n').slice(-60).join('\n'));
    err.write(`\njest exited with ${jest.status}; the suite is not green.\n`);
    return 1;
  }
  if (files.length === 0) {
    out.write('suite green; no changed line to judge.\n');
    return 0;
  }
  const coverage = JSON.parse(fs.readFileSync(path.join(cwd, COVERAGE_FILE), 'utf8'));
  const report = evaluate(changed, coverage, cwd);
  out.write(`${formatReport(report, min)}\n`);
  if (report.ratio !== null && report.ratio < min) return 1;
  return 0;
}

module.exports = {
  DEFAULT_MIN,
  diffBase,
  isEligible,
  parseUnifiedDiff,
  allLines,
  collectChangedLines,
  evaluate,
  formatLines,
  formatReport,
  resolveMinimum,
  runJest,
  main,
};

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`coverage-changed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
