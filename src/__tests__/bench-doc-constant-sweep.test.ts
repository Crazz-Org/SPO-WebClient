/**
 * B6.4 — a doc-constant sweep on the bench side, additive only.
 *
 * Modelled directly on SPO-Pipeline's test/doc-constant-sweep.test.js (read read-only at
 * /home/crazz/SPO-Pipeline/test/doc-constant-sweep.test.js): a doc STATES a fact, the code OWNS
 * it, and they drift apart silently — reading is sampling, a human re-reader can miss a changed
 * word forever. Every `contains` string below is a LITERAL, typed independently of the code or
 * doc it checks, copied from a real read of both files on 2026-09-03 — never `require()`d and
 * compared to itself, which pins nothing (this is the exact house rule the pipeline's sweep
 * header warns about, and the reason this file reads two INDEPENDENT files per row).
 *
 * B6 exists because a pre-push hook dropped a real check on the strength of a documented promise
 * that had already stopped being true (`bench/gate` was removed from ruleset 21111153's required
 * list 2026-08-29T10:17:40Z, restored 2026-09-03T07:32:42+02:00 — B1.5). The house rule this
 * chantier keeps re-learning: a sweep that reads the SAME file on both sides of a check can never
 * fail. Every row here reads a code file and a DIFFERENT doc file; the second describe block
 * below proves, by measured mutation against scratch fixtures (never the real locked files —
 * see the note there), that flipping either side alone reds the specific row and nothing else.
 *
 * Required-check source of truth: no ruleset export is checked into this repo (GitHub rulesets
 * live server-side; `gh api rulesets/21111153` would make this test non-hermetic and require
 * live auth every run), so this sweep pins the two checked-in artifacts that are AUTHORITATIVE
 * for what those two contexts are named:
 *   - `.github/workflows/ci.yml`'s `verify` job `name:` IS the "typecheck + tests" check
 *     context GitHub reports (a GitHub Actions job name becomes its check-run context).
 *   - `src/e2e/bench/verdict.ts`'s `ghStatusPublisher` default `context` parameter IS the
 *     "bench/gate" commit-status context the worker publishes.
 * The ruleset's bypass list (currently `[]`, verified live via `gh api` for this action's
 * report) has no checked-in source at all, so it is out of this sweep's reach by construction —
 * same posture as the pipeline's citation ratchet, which is existence-only for the same reason.
 *
 * Files this sweep reads but MAY NOT EDIT (B6's own scope note): src/e2e/bench/job.ts,
 * src/e2e/bench/worker.ts (B4.2), doc/bench-worker.md (likely B4.2). Reading is allowed and
 * expected; writing is not — a divergence found in one of these is reported in the action's
 * write-up for a one-minute follow-up fix, never patched here.
 *
 * SPO-Pipeline's file has grown layers beyond the `contains`-based pins this file copied — an
 * existence ratchet, a content-anchor check, exact-line pinning for dated documents — that were
 * DELIBERATELY NOT PORTED here. This repo's citation-verification needs are met by a different
 * mechanism instead: the RDO-specific deterministic parser (`scripts/check-rdo-citation.js`,
 * wired into `scripts/check-pr-rules.js`'s `checkCitation` gate), which verifies a `File.pas:Line`
 * citation against the real Pascal declaration it points at — a different, more safety-critical
 * citation class (one that gates a live game server) than the general doc-constant
 * cross-references this sweep checks. Before porting Pipeline's heavier machinery here, re-derive
 * whether it is actually missing something the parser does not already cover.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

interface Check {
  file: string;
  contains: string;
}
interface Pin {
  name: string;
  checks: Check[];
}

// ---- the pinned facts -----------------------------------------------------------------------
//
// One row per documented-constant claim. A row passes only when EVERY check's literal is found
// in ITS named file, so a mismatch on either side (code changed, or doc changed) fails
// independently of the other, and names exactly which file+literal went missing.
const PINS: Pin[] = [
  {
    name: 'required check "typecheck + tests" is CI\'s job name',
    checks: [
      { file: '.github/workflows/ci.yml', contains: 'name: typecheck + tests' },
      { file: 'CLAUDE.md', contains: '`typecheck + tests` **and** `bench/gate` required' },
      {
        file: 'CONTRIBUTING.md',
        contains: 'required checks: **CI** (`typecheck + tests`, GitHub-hosted) and **`bench/gate`**',
      },
      {
        file: 'doc/bench-worker.md',
        contains: '**`typecheck + tests`** (CI) **and `bench/gate`**,',
      },
    ],
  },
  {
    name: 'required check "bench/gate" is the commit-status context the worker publishes',
    checks: [
      { file: 'src/e2e/bench/verdict.ts', contains: "context: string = 'bench/gate'," },
      { file: 'CONTRIBUTING.md', contains: 'and **`bench/gate`** — the live' },
      { file: 'CLAUDE.md', contains: 'verdict as the `bench/gate` commit status' },
      {
        file: 'doc/bench-worker.md',
        contains: '`verdicts/<sha>.json` + `bench/gate` GitHub commit status',
      },
    ],
  },
  {
    name: 'JobVerdict member "PASS"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'PASS'" },
      { file: 'doc/bench-worker.md', contains: 'Verdicts: `PASS`' },
    ],
  },
  {
    name: 'JobVerdict member "FAIL"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'FAIL'" },
      { file: 'doc/bench-worker.md', contains: '`FAIL` ·' },
    ],
  },
  {
    name: 'JobVerdict member "BLOCKED"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'BLOCKED'" },
      { file: 'doc/bench-worker.md', contains: '`BLOCKED` (the live stage was refused before running' },
    ],
  },
  {
    name: 'JobVerdict member "ENVIRONMENT"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'ENVIRONMENT'" },
      { file: 'doc/bench-worker.md', contains: '`ENVIRONMENT` (does not consume an attempt)' },
    ],
  },
  {
    name: 'JobVerdict member "STALE"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'STALE'" },
      { file: 'doc/bench-worker.md', contains: '`STALE` ·' },
    ],
  },
  {
    name: 'JobVerdict member "DIRTY"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'DIRTY'" },
      { file: 'doc/bench-worker.md', contains: '`DIRTY` (gate on' },
    ],
  },
  {
    name: 'JobVerdict member "ABANDONED"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'ABANDONED'" },
      { file: 'doc/bench-worker.md', contains: '`ABANDONED` ·' },
    ],
  },
  {
    name: 'JobVerdict member "INTERRUPTED"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'INTERRUPTED'" },
      { file: 'doc/bench-worker.md', contains: '`INTERRUPTED` (worker died mid-job' },
    ],
  },
  {
    name: 'JobVerdict member "LEASED"',
    checks: [
      { file: 'src/e2e/bench/job.ts', contains: "| 'LEASED';" },
      { file: 'doc/bench-worker.md', contains: '`LEASED`.' },
    ],
  },
  {
    name: 'DONE_RETENTION_MS default (24h) -- done/ job report purge window',
    checks: [
      { file: 'src/e2e/bench/worker.ts', contains: 'const DONE_RETENTION_MS = 24 * 60 * 60 * 1000;' },
      {
        file: 'doc/bench-worker.md',
        contains: 'done/<jobid>.json + .log        reports; only the .log is purged (24 h)',
      },
      {
        file: 'doc/bench-worker.md',
        contains: 'INTERRUPTED` recovery and the 24 h purge all come for free.',
      },
    ],
  },
  {
    name: 'lease duration: DEFAULT_LEASE_MINUTES (30) and MAX_LEASE_MINUTES (120)',
    checks: [
      { file: 'src/e2e/bench/worker.ts', contains: 'const DEFAULT_LEASE_MINUTES = 30;' },
      { file: 'src/e2e/bench/worker.ts', contains: 'const MAX_LEASE_MINUTES = 120;' },
      {
        file: 'doc/bench-worker.md',
        contains: '(30 min default, 120 max); the worker tears the gateway down then, never later',
      },
    ],
  },
];

/** Pure — the whole mechanism under test. Same function drives the real sweep below AND the
 * mutation-proof harness against scratch fixtures, so proving the harness kills a mutation is
 * proving this exact code path, not a re-implementation of it. */
function offendersFor(pins: Pin[], resolve: (relFile: string) => string): string[] {
  const offenders: string[] = [];
  for (const pin of pins) {
    for (const { file, contains } of pin.checks) {
      if (!resolve(file).includes(contains)) {
        offenders.push(`${pin.name} -- ${file} no longer contains:\n      ${contains}`);
      }
    }
  }
  return offenders;
}

function readReal(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('bench-side doc-constant sweep', () => {
  test('PINS keeps at least a dozen rows, naming exactly the facts it ships with', () => {
    // Guards against the sweep quietly losing rows the same way a shrunk PINS array would stay
    // green forever and mean nothing (SPO-Pipeline's doc-constant-sweep.test.js, FINDING 5).
    expect(PINS.length).toBeGreaterThanOrEqual(12);
    expect(PINS.map((p) => p.name).sort()).toEqual(
      [
        'DONE_RETENTION_MS default (24h) -- done/ job report purge window',
        'JobVerdict member "ABANDONED"',
        'JobVerdict member "BLOCKED"',
        'JobVerdict member "DIRTY"',
        'JobVerdict member "ENVIRONMENT"',
        'JobVerdict member "FAIL"',
        'JobVerdict member "INTERRUPTED"',
        'JobVerdict member "LEASED"',
        'JobVerdict member "PASS"',
        'JobVerdict member "STALE"',
        'lease duration: DEFAULT_LEASE_MINUTES (30) and MAX_LEASE_MINUTES (120)',
        'required check "bench/gate" is the commit-status context the worker publishes',
        'required check "typecheck + tests" is CI\'s job name',
      ].sort()
    );
  });

  test('every pinned bench-side constant matches a literal in both the code and the doc that states it', () => {
    const cache = new Map<string, string>();
    const resolve = (rel: string) => {
      if (!cache.has(rel)) cache.set(rel, readReal(rel));
      return cache.get(rel) as string;
    };
    const offenders = offendersFor(PINS, resolve);
    expect(offenders).toEqual([]);
  });

  test('JobVerdict in job.ts has exactly the 9 members this sweep pins -- no more, no fewer', () => {
    // A tenth member added to the union (or one removed) with no doc update would pass the
    // `includes` checks above vacuously silent about the new/missing member — this counts the
    // union's OWN members independently, from the literal source text, the same way the
    // pipeline's PINS.length floor guards against silent shrinkage of the sweep itself.
    const jobTs = readReal('src/e2e/bench/job.ts');
    const unionBlock = jobTs.slice(jobTs.indexOf('export type JobVerdict ='), jobTs.indexOf('export interface JobRequest'));
    const members = [...unionBlock.matchAll(/\|\s*'([A-Z]+)'/g)].map((m) => m[1]);
    expect(members.sort()).toEqual(
      ['ABANDONED', 'BLOCKED', 'DIRTY', 'ENVIRONMENT', 'FAIL', 'INTERRUPTED', 'LEASED', 'PASS', 'STALE'].sort()
    );
  });
});

describe('mutation proof -- every check row actually reds on its own, measured against scratch fixtures', () => {
  // Never touches the real repo files (several are locked to other B6 agents: job.ts, worker.ts
  // and doc/bench-worker.md all belong to B4.2 right now). Instead this builds a throwaway
  // directory under os.tmpdir() -- never the real REPO_ROOT -- populates each referenced relative
  // path with a file whose content is exactly the union of every `contains` literal that names
  // it (so the baseline is provably green through the SAME `offendersFor` function the real
  // sweep above uses), then corrupts one literal at a time and re-runs `offendersFor` against
  // that same PINS array pointed at the scratch root. A kill is: exactly the checks that pin
  // this file+literal go red, and only those -- proving the mechanism (not a paraphrase of it)
  // actually detects a one-sided edit, which is the whole reason this file reads two independent
  // files per row instead of one.
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-doc-sweep-mutation-'));
    const byFile = new Map<string, string[]>();
    for (const pin of PINS) {
      for (const { file, contains } of pin.checks) {
        if (!byFile.has(file)) byFile.set(file, []);
        const list = byFile.get(file) as string[];
        if (!list.includes(contains)) list.push(contains);
      }
    }
    for (const [file, literals] of byFile) {
      const full = path.join(scratchRoot, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, literals.join('\n===LITERAL-BOUNDARY===\n') + '\n');
    }
  });

  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  function resolveScratch(rel: string): string {
    return fs.readFileSync(path.join(scratchRoot, rel), 'utf8');
  }

  test('baseline scratch fixtures are green (sanity: the harness itself is not miswired)', () => {
    expect(offendersFor(PINS, resolveScratch)).toEqual([]);
  });

  // One measured kill per (pin, check) pair -- every literal this file pins, corrupted alone.
  const allChecks: { pinName: string; file: string; contains: string }[] = PINS.flatMap((pin) =>
    pin.checks.map((c) => ({ pinName: pin.name, file: c.file, contains: c.contains }))
  );

  test.each(allChecks)('mutating $file alone reds "$pinName" ($contains)', ({ file, contains }) => {
    const full = path.join(scratchRoot, file);
    const before = fs.readFileSync(full, 'utf8');
    expect(before).toContain(contains); // sanity: the baseline really carries this literal

    // Corrupt exactly this literal's occurrence, leaving every other literal in the same file
    // (other checks may share a file) untouched -- proves the kill is localized, not a
    // sledgehammer that reds the whole file's checks at once.
    const mutated = before.replace(contains, contains.slice(0, -1) + '\u0000MUTATED');
    expect(mutated).not.toEqual(before);
    fs.writeFileSync(full, mutated);

    const offenders = offendersFor(PINS, resolveScratch);
    const expectedKillCount = PINS.reduce(
      (n, pin) => n + pin.checks.filter((c) => c.file === file && c.contains === contains).length,
      0
    );
    expect(expectedKillCount).toBeGreaterThan(0);
    expect(offenders.length).toBe(expectedKillCount);
    expect(offenders.every((o) => o.includes(file))).toBe(true);

    // Restore so the next case in this file starts from the true baseline again.
    fs.writeFileSync(full, before);
    expect(offendersFor(PINS, resolveScratch)).toEqual([]);
  });
});
