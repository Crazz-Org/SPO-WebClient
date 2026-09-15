/**
 * #295: `scripts/nightly-check.sh` used to misdiagnose a missing `jq` binary as invalid JSON
 * in the nightly verdict file — `jq -e . "$NIGHTLY"` fails identically whether `jq` itself is
 * absent from PATH or the file it is pointed at is genuinely malformed, so the old single
 * check could only ever print "unreadable or invalid JSON", which sent whoever read it
 * chasing a corrupt `~/.spo-bench/nightly/latest.json` that was never the problem.
 *
 * The fix adds one `command -v jq` preflight ahead of the parse, so the two causes get two
 * distinct exit-2 messages. This file pins that distinction by actually running the script —
 * with PATH narrowed to a directory that holds `git` but not `jq` — rather than only reading
 * its source, and a contrasting run (real `jq`, deliberately broken JSON) proves the original
 * invalid-JSON branch survived untouched.
 *
 * action B3.2 (SPO-Pipeline): the "an unknown nightly result must stop reading as green" fix.
 * Before this action the script mapped ENVIRONMENT/INTERRUPTED, and a FAIL recorded for a sha
 * `main` had since moved past, to "MAIN: GREEN" — against its own header, which already said an
 * unknown must never be mistaken for green. The `describe` block below runs the real script (no
 * jq/git PATH tricks needed — every case here has both) against every verdict shape the JobVerdict
 * union in `src/e2e/bench/job.ts` can produce, plus the missing-file and sha-mismatch cases, and
 * pins the corrected exit code (0 GREEN / 1 RED / 2 UNKNOWN) and message for each one. See
 * `orchestrator/steps/scripted.js`'s `classifyNightly` (SPO-Pipeline) for the identical table
 * applied on the other side of the repo boundary.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'nightly-check.sh');

function scratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

interface Run {
  status: number | null;
  stdout: string;
}

// Absolute paths resolved once, over the test runner's own (unrestricted) PATH — so they can
// be reused to build a deliberately narrow PATH for the script under test without needing to
// look `bash`/`git` up again inside that narrowed environment.
let bashPath: string;
let gitPath: string;

/** A scratch bin dir holding a `git` symlink only — no `jq` anywhere on it. */
let binWithoutJq: string;

/** A repo with a local bare `origin`, so `git fetch origin main` succeeds with no network. */
let repoWithOrigin: string;

beforeAll(() => {
  bashPath = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  gitPath = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

  binWithoutJq = scratch('nightly-check-bin-');
  fs.symlinkSync(gitPath, path.join(binWithoutJq, 'git'));

  const template = scratch('nightly-check-template-');
  git(template, 'init', '-q', '-b', 'main');
  git(template, 'config', 'user.email', 'test@example.com');
  git(template, 'config', 'user.name', 'test');
  git(template, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(template, 'README.md'), 'seed\n', 'utf8');
  git(template, 'add', '.');
  git(template, 'commit', '-q', '-m', 'init');

  repoWithOrigin = scratch('nightly-check-repo-');
  fs.cpSync(template, repoWithOrigin, { recursive: true });
  const bareOrigin = scratch('nightly-check-origin-');
  git(bareOrigin, 'init', '-q', '--bare', '-b', 'main');
  git(repoWithOrigin, 'remote', 'add', 'origin', bareOrigin);
  git(repoWithOrigin, 'push', '-q', 'origin', 'main');
});

/** `$SPO_BENCH_DIR/nightly/latest.json` populated with the given raw content. */
function benchDirWith(content: string): string {
  const dir = scratch('nightly-check-bench-');
  fs.mkdirSync(path.join(dir, 'nightly'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nightly', 'latest.json'), content, 'utf8');
  return dir;
}

function runScript(benchDir: string, pathOverride: string): Run {
  const result = spawnSync(bashPath, [SCRIPT], {
    cwd: repoWithOrigin,
    encoding: 'utf8',
    env: {
      SPO_BENCH_DIR: benchDir,
      PATH: pathOverride,
      HOME: repoWithOrigin,
    },
  });
  return { status: result.status, stdout: result.stdout };
}

describe('scripts/nightly-check.sh — jq preflight (#295)', () => {
  it('exits 2 with a "jq not installed" message when jq is missing from PATH, not "invalid JSON"', () => {
    const benchDir = benchDirWith('{"verdict":"PASS","sha":"deadbeef","finishedAt":"now"}');

    const { status, stdout } = runScript(benchDir, binWithoutJq);

    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN jq not installed (apt install jq)');
    expect(stdout).not.toContain('invalid JSON');
  });

  it('still reports "invalid JSON", not "jq not installed", when jq is present but the file is broken', () => {
    const benchDir = benchDirWith('{not valid json');

    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');

    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN unreadable or invalid JSON in');
    expect(stdout).not.toContain('jq not installed');
  });

  it('the jq-installed check runs before the JSON parse in the script source', () => {
    const script = fs.readFileSync(SCRIPT, 'utf8');
    const jqInstalledCheck = script.indexOf('command -v jq');
    const jqParseCheck = script.indexOf('jq -e .');
    expect(jqInstalledCheck).toBeGreaterThan(-1);
    expect(jqParseCheck).toBeGreaterThan(jqInstalledCheck);
  });
});

describe('scripts/nightly-check.sh — unknown must stop reading as green (action B3.2)', () => {
  let mainSha: string;

  beforeAll(() => {
    mainSha = git(repoWithOrigin, 'rev-parse', 'HEAD');
  });

  const STALE_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  it('no nightly file at all -> UNKNOWN, exit 2 (was GREEN)', () => {
    const benchDir = scratch('nightly-check-bench-'); // nightly/latest.json deliberately absent
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN');
    expect(stdout).toContain('no nightly on file');
  });

  it('PASS at the exact origin/main sha -> GREEN, exit 0 (the only green case)', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'PASS', sha: mainSha, finishedAt: 'now' }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(0);
    expect(stdout).toContain('MAIN: GREEN');
  });

  it('PASS recorded for a DIFFERENT sha than origin/main -> UNKNOWN, exit 2 (not green — a stale proof proves nothing about the current tip)', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'PASS', sha: STALE_SHA, finishedAt: 'now' }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN');
    expect(stdout).not.toContain('MAIN: GREEN');
  });

  it('FAIL at the exact origin/main sha -> RED, exit 1 (unchanged)', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'FAIL', sha: mainSha, detail: 'boom' }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(1);
    expect(stdout).toContain('MAIN: RED');
  });

  it('FAIL recorded for a DIFFERENT sha than origin/main -> UNKNOWN, exit 2 (was GREEN — "main moved past it" is an assumption, not proof)', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'FAIL', sha: STALE_SHA, detail: 'boom' }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN');
    expect(stdout).not.toContain('MAIN: GREEN');
  });

  // The exact defect the audit measured: `scripts/nightly-check.sh:70-73` mapped
  // ENVIRONMENT|INTERRUPTED to "MAIN: GREEN". INTERRUPTED is written by worker.ts's
  // recoverInterrupted specifically so a worker death does not read as a clean run.
  for (const verdict of ['ENVIRONMENT', 'INTERRUPTED', 'BLOCKED', 'DIRTY', 'ABANDONED', 'STALE', 'LEASED']) {
    it(`${verdict} at the exact origin/main sha -> UNKNOWN, exit 2, never "MAIN: GREEN" (proves nothing about main by design)`, () => {
      const benchDir = benchDirWith(JSON.stringify({ verdict, sha: mainSha }));
      const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
      expect(status).toBe(2);
      expect(stdout).toContain('MAIN: UNKNOWN');
      expect(stdout).not.toContain('MAIN: GREEN');
    });
  }

  it('an unrecognised verdict string -> UNKNOWN, exit 2 (unchanged)', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'SOMETHING_NEW', sha: mainSha }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('unrecognised verdict');
  });

  it('missing verdict field -> UNKNOWN, exit 2 (unchanged)', () => {
    const benchDir = benchDirWith(JSON.stringify({ sha: mainSha }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('missing verdict field');
  });

  // ---- the trigger (#801) ----------------------------------------------------------------
  // A nightly may now be `manual` — a maintainer asked for it. The classification is
  // deliberately unchanged by that: the line says which it was, and nothing more.

  it('names the trigger and the requester on a manual GREEN', () => {
    const benchDir = benchDirWith(
      JSON.stringify({
        verdict: 'PASS',
        sha: mainSha,
        finishedAt: 'now',
        trigger: 'manual',
        requestedBy: { user: 'maintainer', reason: 'the fetch timed out' },
      }),
    );
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(0);
    expect(stdout).toContain('MAIN: GREEN');
    expect(stdout).toContain('trigger=manual by=maintainer');
  });

  it('names the trigger and the requester on a manual RED', () => {
    const benchDir = benchDirWith(
      JSON.stringify({
        verdict: 'FAIL',
        sha: mainSha,
        detail: 'boom',
        trigger: 'manual',
        requestedBy: { user: 'maintainer' },
      }),
    );
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(1);
    expect(stdout).toContain('MAIN: RED');
    expect(stdout).toContain('trigger=manual by=maintainer');
  });

  it('reads a record with no trigger as scheduled, and names no requester — every pre-#801 file', () => {
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'PASS', sha: mainSha, finishedAt: 'now' }));
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(0);
    expect(stdout).toContain('trigger=scheduled');
    expect(stdout).not.toContain('by=');
  });

  it('names no requester on a manual record that somehow carries none', () => {
    const benchDir = benchDirWith(
      JSON.stringify({ verdict: 'FAIL', sha: mainSha, detail: 'boom', trigger: 'manual' }),
    );
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(1);
    expect(stdout).toContain('trigger=manual');
    expect(stdout).not.toContain('by=');
  });

  it('a manual record does NOT change the classification of a non-attesting verdict', () => {
    // It could not reach this file in practice — a manual ENVIRONMENT leaves latest.json
    // untouched — but if one ever did, the answer must still be UNKNOWN, not green.
    const benchDir = benchDirWith(
      JSON.stringify({ verdict: 'ENVIRONMENT', sha: mainSha, trigger: 'manual' }),
    );
    const { status, stdout } = runScript(benchDir, process.env.PATH ?? '');
    expect(status).toBe(2);
    expect(stdout).toContain('MAIN: UNKNOWN');
    expect(stdout).not.toContain('MAIN: GREEN');
  });

  // ---- mutation-proof -------------------------------------------------------------------------
  // Runs the OLD (pre-B3.2) case arm directly, spliced into a scratch copy of the script, to
  // prove the tests above actually pin something rather than being decorative. Never mutates the
  // real script under test — copies it to a tmp file, edits the copy, runs bash on the copy.

  function scriptWithCaseArmReplaced(oldArm: string, newArm: string): string {
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).toContain(oldArm); // fails loudly if the source has since moved, rather than silently mutating nothing
    const mutated = script.replace(oldArm, newArm);
    const file = path.join(scratch('nightly-check-mutant-'), 'nightly-check.sh');
    fs.writeFileSync(file, mutated, { mode: 0o755 });
    return file;
  }

  function runMutant(scriptPath: string, benchDir: string): Run {
    const result = spawnSync(bashPath, [scriptPath], {
      cwd: repoWithOrigin,
      encoding: 'utf8',
      env: { SPO_BENCH_DIR: benchDir, PATH: process.env.PATH ?? '', HOME: repoWithOrigin },
    });
    return { status: result.status, stdout: result.stdout };
  }

  it('mutation: reverting ENVIRONMENT|INTERRUPTED to the old GREEN arm flips the INTERRUPTED test above', () => {
    const mutant = scriptWithCaseArmReplaced(
      `  ENVIRONMENT|INTERRUPTED|BLOCKED|DIRTY|ABANDONED|STALE|LEASED)\n    echo "MAIN: UNKNOWN ($VERDICT — the run proved nothing about main)"\n    exit 2\n    ;;`,
      `  ENVIRONMENT|INTERRUPTED|BLOCKED|DIRTY|ABANDONED|STALE|LEASED)\n    echo "MAIN: GREEN ($VERDICT — mutated)"\n    exit 0\n    ;;`
    );
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'INTERRUPTED', sha: mainSha }));
    const { status, stdout } = runMutant(mutant, benchDir);
    expect(status).toBe(0);
    expect(stdout).toContain('MAIN: GREEN');
    // ...which is exactly what the real (unmutated) script must never do — the fixed test above
    // already asserts the opposite (UNKNOWN, exit 2) against the real SCRIPT.
  });

  it('mutation: dropping the FAIL sha check flips the "FAIL at a different sha" test above', () => {
    const mutant = scriptWithCaseArmReplaced(
      `  FAIL)\n    if [ -n "$SHA" ] && [ "$SHA" = "$ORIGIN_MAIN" ]; then\n      echo "MAIN: RED sha=$SHA detail=$DETAIL logFile=$LOGFILE trigger=$TRIGGER$BY"\n      exit 1\n    else\n      # A FAIL recorded for a DIFFERENT sha than origin/main's current tip proves nothing about\n      # THIS tip — main may or may not still be broken. Assuming "moved past it, so it's fixed"\n      # (the old behaviour) is exactly the unknown-reads-as-green bug this action fixes.\n      echo "MAIN: UNKNOWN FAIL recorded for \${SHA:-"(no sha)"}, not origin/main's current tip ($ORIGIN_MAIN) — unproven either way"\n      exit 2\n    fi\n    ;;`,
      `  FAIL)\n    echo "MAIN: RED sha=$SHA detail=$DETAIL logFile=$LOGFILE (mutated: no sha check)"\n    exit 1\n    ;;`
    );
    const benchDir = benchDirWith(JSON.stringify({ verdict: 'FAIL', sha: STALE_SHA, detail: 'boom' }));
    const { status, stdout } = runMutant(mutant, benchDir);
    expect(status).toBe(1);
    expect(stdout).toContain('MAIN: RED');
    // The fixed test above ("FAIL recorded for a DIFFERENT sha ... -> UNKNOWN") asserts exit 2
    // against the real, unmutated SCRIPT for this exact input — this mutant proves that assertion
    // is load-bearing, not decorative.
  });
});
