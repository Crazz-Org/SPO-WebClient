/**
 * The gate body the bench worker runs — scripts/verify-gate.js — driven as a black box.
 *
 * The script shells out to `npm`, reads git, and requires the compiled e2e driver from
 * `dist/e2e/`. Each case therefore gets a scratch git repo, a fake `npm` on PATH whose
 * failures are chosen per stage, and two small CommonJS fakes standing in for
 * `dist/e2e/routing.js`, `dist/e2e/run.js` and `dist/e2e/bench/changed-flows.js`, steered
 * through environment variables.
 * Nothing here touches the real bench, ~/.spo-bench or the live servers.
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SECONDARY_ACCOUNT } from './config';

const SCRIPT = path.join(process.cwd(), 'scripts', 'verify-gate.js');

interface GateRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The `report/e2e/gate-<sha>.json` artifact, when the run wrote one. */
  artifact: Record<string, unknown> | null;
  /** Every `npm …` invocation, one per line, in order. */
  npmCalls: string[];
  /** The diff text handed to `presidentMembersInDiff`, when the run got that far. */
  diffSeen: string | null;
  /** The options handed to `runLive`, when the run got that far. */
  liveOptions: Record<string, unknown> | null;
  /** The diff handed to `flowsChangedInWorktree`, when the run got that far. */
  flowDiffSeen: string | null;
}

interface RepoOptions {
  /** Push `main` to a bare remote so `origin/main` exists. */
  withRemote?: boolean;
  /** Extra files written but not committed (untracked). */
  untracked?: Record<string, string>;
}

const FAKE_NPM = `#!/usr/bin/env bash
# Logs its arguments; fails when FAKE_NPM_FAIL names this stage.
stage="$1"; [ "$1" = "run" ] && stage="$2"
echo "$*" >> "$FAKE_NPM_LOG"
if [ "$stage" = "\${FAKE_NPM_FAIL:-}" ]; then echo "fake npm: $stage failed" >&2; exit 1; fi
exit 0
`;

const FAKE_ROUTING = `'use strict';
const fs = require('fs');
const decision = JSON.parse(process.env.FAKE_ROUTING || '{}');
exports.route = files => ({
  changed: files,
  required: [],
  unmapped: [],
  staticOnly: false,
  needsL3: false,
  reasons: [],
  ...decision,
});
exports.SPINE_FLOW = 'login-spine';
exports.SERVER_QUARANTINE = JSON.parse(process.env.FAKE_QUARANTINE || '{}');
exports.presidentMembersInDiff = diff => {
  if (process.env.FAKE_DIFF_OUT) fs.writeFileSync(process.env.FAKE_DIFF_OUT, diff, 'utf8');
  return JSON.parse(process.env.FAKE_PRESIDENT || '[]');
};
`;

const FAKE_CHANGED_FLOWS = `'use strict';
const fs = require('fs');
exports.FLOW_SOURCES = ['src/e2e/flows.ts'];
exports.flowsChangedInWorktree = diff => {
  if (process.env.FAKE_FLOW_DIFF_OUT) fs.writeFileSync(process.env.FAKE_FLOW_DIFF_OUT, diff, 'utf8');
  if (process.env.FAKE_CHANGED_THROW) throw new Error(process.env.FAKE_CHANGED_THROW);
  return JSON.parse(process.env.FAKE_CHANGED || '{"required":[],"notDriven":[],"reasons":[]}');
};
`;

const FAKE_CAPABILITY = `'use strict';
exports.capabilitiesFor = members => (members.length > 0 ? ['president'] : []);
`;

const FAKE_RUN = `'use strict';
const fs = require('fs');
exports.runLive = async options => {
  if (process.env.FAKE_LIVE_OUT) fs.writeFileSync(process.env.FAKE_LIVE_OUT, JSON.stringify(options), 'utf8');
  return JSON.parse(process.env.FAKE_LIVE || '{"status":"PASS"}');
};
exports.formatSummary = result => 'summary: ' + result.status;
`;

function scratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(dir: string, file: string, body: string, message: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', message);
}

/** A bin dir holding the fake `npm`, prepended to PATH for each run. */
let fakeBin: string;
/** The scratch repo every case starts from — built once, cloned per case (git init is slow). */
let template: string;

beforeAll(() => {
  fakeBin = scratch('spo-gate-bin-');
  fs.writeFileSync(path.join(fakeBin, 'npm'), FAKE_NPM, { mode: 0o755 });

  template = scratch('spo-gate-template-');
  git(template, 'init', '-q', '-b', 'main');
  git(template, 'config', 'user.email', 'test@example.com');
  git(template, 'config', 'user.name', 'test');
  git(template, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(template, '.gitignore'), 'dist/\nreport/\n', 'utf8');
  commitFile(template, 'README.md', 'seed\n', 'init');
  git(template, 'checkout', '-q', '-b', 'feature/x');
  commitFile(template, 'src/server/thing.ts', 'export const thing = 1;\n', 'feat: thing');
  fs.mkdirSync(path.join(template, 'dist', 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(template, 'dist', 'e2e', 'routing.js'), FAKE_ROUTING, 'utf8');
  fs.writeFileSync(path.join(template, 'dist', 'e2e', 'run.js'), FAKE_RUN, 'utf8');
  fs.writeFileSync(path.join(template, 'dist', 'e2e', 'capability.js'), FAKE_CAPABILITY, 'utf8');
  fs.mkdirSync(path.join(template, 'dist', 'e2e', 'bench'), { recursive: true });
  fs.writeFileSync(
    path.join(template, 'dist', 'e2e', 'bench', 'changed-flows.js'),
    FAKE_CHANGED_FLOWS,
    'utf8',
  );
});

/**
 * A scratch repo on `feature/x`, one commit ahead of `main`, with the two fake driver
 * modules already in `dist/e2e/`. The `dist/` directory is git-ignored so the fakes never
 * show up as changed files.
 */
function scratchRepo(options: RepoOptions = {}): string {
  const dir = scratch('spo-gate-repo-');
  // Git makes the copy: copying a live `.git` tree file by file is fragile.
  git(dir, 'clone', '-q', '-b', 'feature/x', template, '.');
  git(dir, 'branch', '-q', 'main', 'origin/main');
  // The clone's origin points at the template; origin/main must exist only with `withRemote`.
  git(dir, 'remote', 'remove', 'origin');
  // A clone does not carry the template's config.
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  // The fakes are git-ignored, so the clone lacks them — copy `dist/` alone (no `.git`).
  fs.cpSync(path.join(template, 'dist'), path.join(dir, 'dist'), { recursive: true });

  if (options.withRemote) {
    // `main` has not moved since the fork, so pushing it now yields the same origin/main
    // a push before the fork would have.
    const bare = scratch('spo-gate-origin-');
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', 'origin', 'main');
  }

  for (const [file, body] of Object.entries(options.untracked ?? {})) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body, 'utf8');
  }
  return dir;
}

function runGate(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): GateRun {
  const work = scratch('spo-gate-out-');
  const npmLog = path.join(work, 'npm.log');
  const diffOut = path.join(work, 'diff.txt');
  const liveOut = path.join(work, 'live.json');
  const flowDiffOut = path.join(work, 'flow-diff.txt');
  const result = spawnSync('node', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_NPM_LOG: npmLog,
      FAKE_DIFF_OUT: diffOut,
      FAKE_LIVE_OUT: liveOut,
      FAKE_FLOW_DIFF_OUT: flowDiffOut,
      ...env,
    },
  });
  const head = git(dir, 'rev-parse', 'HEAD');
  const artifactFile = path.join(dir, 'report', 'e2e', `gate-${head}.json`);
  const readJson = (file: string): Record<string, unknown> | null =>
    fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
      : null;
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    artifact: readJson(artifactFile),
    npmCalls: fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim().split('\n') : [],
    diffSeen: fs.existsSync(diffOut) ? fs.readFileSync(diffOut, 'utf8') : null,
    liveOptions: readJson(liveOut),
    flowDiffSeen: fs.existsSync(flowDiffOut) ? fs.readFileSync(flowDiffOut, 'utf8') : null,
  };
}

describe('stage 1 — static', () => {
  it.each([
    ['typecheck', 'typecheck', ['run typecheck']],
    ['lint', 'lint', ['run typecheck', 'run lint']],
    ['test', 'test', ['run typecheck', 'run lint', 'test']],
  ])('exits 1 and stops at the first failing stage (%s)', (stage, key, expectedCalls) => {
    const run = runGate(scratchRepo(), [], { FAKE_NPM_FAIL: stage });
    expect(run.code).toBe(1);
    expect(run.npmCalls).toEqual(expectedCalls);
    expect(run.stderr).toMatch(/Gate FAIL — static stage failed/);
    expect(run.artifact).toMatchObject({ verdict: 'FAIL', branch: 'feature/x', attempt: 1 });
    expect(run.artifact?.static).toMatchObject({ [key]: 'FAIL' });
    expect(run.artifact?.live).toBeNull();
  });

  it('exits 1 when the e2e driver does not build, with buildE2e FAIL in the artifact', () => {
    const run = runGate(scratchRepo(), [], { FAKE_NPM_FAIL: 'build:e2e' });
    expect(run.code).toBe(1);
    expect(run.npmCalls).toEqual(['run typecheck', 'run lint', 'test', 'run build:e2e']);
    expect(run.stderr).toMatch(/could not build the e2e driver/);
    expect(run.artifact?.static).toEqual({
      typecheck: 'PASS',
      lint: 'PASS',
      test: 'PASS',
      buildE2e: 'FAIL',
    });
  });

  it('--skip-static runs none of the three, and marks the artifact RECEIPT', () => {
    // The worker passes this ONLY after matching a precheck receipt to the tree it
    // fingerprinted itself (src/e2e/bench/receipt.ts). Nothing else is skipped: the e2e
    // driver is still built here, from this tree.
    const run = runGate(scratchRepo(), ['--skip-static']);
    expect(run.code).toBe(0);
    expect(run.npmCalls).toEqual(['run build:e2e']);
    expect(run.stdout).toMatch(/static: from the precheck receipt/);
    expect(run.artifact?.static).toEqual({
      typecheck: 'RECEIPT',
      lint: 'RECEIPT',
      test: 'RECEIPT',
      buildE2e: 'PASS',
    });
  });

  it('--skip-static still fails on the build it does not skip', () => {
    const run = runGate(scratchRepo(), ['--skip-static'], { FAKE_NPM_FAIL: 'build:e2e' });
    expect(run.code).toBe(1);
    expect(run.npmCalls).toEqual(['run build:e2e']);
    expect(run.stderr).toMatch(/could not build the e2e driver/);
  });

  it('without the flag the three stages run, as they always have', () => {
    const run = runGate(scratchRepo(), []);
    expect(run.npmCalls.slice(0, 3)).toEqual(['run typecheck', 'run lint', 'test']);
  });

  it('records --attempt in the artifact', () => {
    const run = runGate(scratchRepo(), ['--attempt=2'], { FAKE_NPM_FAIL: 'lint' });
    expect(run.artifact?.attempt).toBe(2);
  });

  // B4.1 — D6: the artifact used to name only the sha it checked out (`head`), leaving no
  // way to tell, from the artifact alone, what the submitter actually asked to gate when
  // the worker had merged origin/main onto it first. --deposited-sha is how the worker
  // (worker.ts's runJob) supplies that fact; this proves the SHIPPED script records both,
  // under distinct names, whenever they differ.
  it('records --deposited-sha separately from the checked-out HEAD it names the artifact after', () => {
    const dir = scratchRepo();
    const head = git(dir, 'rev-parse', 'HEAD');
    const deposited = 'f'.repeat(40);

    const run = runGate(dir, [`--deposited-sha=${deposited}`], { FAKE_NPM_FAIL: 'lint' });

    // The artifact is still filed under HEAD — the filename convention is unchanged.
    expect(run.artifact?.head).toBe(head);
    // `gatedSha` spells out, under the verdict's own name for the same fact, exactly what
    // got checked out — always present, even though here it is just `head` again.
    expect(run.artifact?.gatedSha).toBe(head);
    // `depositedSha` carries what the flag said, not what got checked out — the two are
    // deliberately different in this test, the way they are for a real merged-base gate.
    expect(run.artifact?.depositedSha).toBe(deposited);
    expect(run.artifact?.depositedSha).not.toBe(run.artifact?.head);
  });

  it('defaults depositedSha to HEAD when no --deposited-sha is given — the common, non-merged case', () => {
    const dir = scratchRepo();
    const head = git(dir, 'rev-parse', 'HEAD');

    const run = runGate(dir, [], { FAKE_NPM_FAIL: 'lint' });

    expect(run.artifact?.depositedSha).toBe(head);
    expect(run.artifact?.gatedSha).toBe(head);
  });
});

describe('stage 2 — the diff handed to the exclusion scan', () => {
  it('renders untracked files into the diff as synthetic all-added hunks', () => {
    const dir = scratchRepo({
      untracked: { 'src/new/module.ts': 'first line\nRDOSitMinister call\n' },
    });
    const run = runGate(dir, [], { FAKE_ROUTING: JSON.stringify({ staticOnly: true }) });
    expect(run.code).toBe(0);
    expect(run.diffSeen).toContain('+++ b/src/new/module.ts');
    expect(run.diffSeen).toContain('+first line\n+RDOSitMinister call');
    // The committed change is in the same text, in git's own shape.
    expect(run.diffSeen).toContain('+++ b/src/server/thing.ts');
    expect(run.diffSeen).toContain('+export const thing = 1;');
  });
});

describe('stage 3 — routing', () => {
  it('exits 1 when a changed path has no routing rule, naming the path', () => {
    const run = runGate(scratchRepo(), [], {
      FAKE_ROUTING: JSON.stringify({ unmapped: ['src/server/thing.ts'] }),
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/no routing rule covers:\n {2}src\/server\/thing\.ts/);
    expect(run.stderr).toMatch(/fails closed/);
    expect(run.artifact).toMatchObject({
      verdict: 'FAIL',
      routing: { unmapped: ['src/server/thing.ts'], changed: ['src/server/thing.ts'] },
    });
    expect(run.liveOptions).toBeNull();
  });

  it('passes static-only when routing says nothing is observable over the wire', () => {
    const run = runGate(scratchRepo(), [], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true, reasons: ['docs only'] }),
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/Gate PASS \(static only\)/);
    expect(run.artifact).toMatchObject({
      verdict: 'PASS',
      live: { skipped: true },
      routing: { reasons: ['docs only'], required: [] },
    });
    expect(run.liveOptions).toBeNull();
  });

  it('passes static-only when no flow is required, even without the staticOnly flag', () => {
    const run = runGate(scratchRepo(), [], { FAKE_ROUTING: JSON.stringify({ required: [] }) });
    expect(run.code).toBe(0);
    expect(run.artifact).toMatchObject({ verdict: 'PASS', live: { skipped: true } });
  });

  it('DECISION: --static-only over a routing decision that wants a live drive BLOCKS, it does not PASS', () => {
    // --static-only is documented (doc/E2E-POLICY.md §12) for doc/tooling diffs — which
    // route no flows, so this branch never fires for that use. It is passthrough, not in
    // cli.ts's KNOWN_FLAGS, so any session can attach it to `npm run gate --`; leaving it
    // as an unmarked PASS over a diff that DOES route flows would recreate, on purpose,
    // the exact shape (a flag makes the gate green without driving what was routed) this
    // action exists to make impossible. BLOCKED costs the documented use case nothing —
    // it only ever applies where flows.length is already 0 — and closes the loophole.
    const run = runGate(scratchRepo(), ['--live', '--static-only'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
    });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({
      verdict: 'BLOCKED',
      // Pinned to the "a flag was passed" wording specifically, not just any mention of
      // the flow name — the router-decided cause below says something different for the
      // same flow, and a collapsed ternary must not satisfy both.
      live: {
        skipped: true,
        why: expect.stringMatching(
          /^--static-only was requested over a diff that routes flows; not driven: login-spine$/,
        ),
      },
    });
    expect(run.liveOptions).toBeNull();
  });

  it('DECISION: the router deciding static-only over an explicit --flows override BLOCKS, and says the router decided it — not that a flag was passed', () => {
    // Third cause of the same BLOCKED branch: decision.staticOnly is the router's own
    // verdict (it routed nothing), reached here despite --live because --flows overrides
    // decision.required with a flow the router never named. Nobody typed --static-only.
    // A why that says "was requested" here would send a maintainer looking for a flag
    // that does not exist on the command line.
    const run = runGate(scratchRepo(), ['--live', '--flows=login-spine'], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true, required: [] }),
    });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({
      verdict: 'BLOCKED',
      live: {
        skipped: true,
        why: expect.stringMatching(
          /^the router decided static-only over a diff that routes flows; not driven: login-spine$/,
        ),
      },
    });
    expect(run.artifact?.live?.why).not.toMatch(/was requested/);
    expect(run.stdout).toMatch(/not driven: login-spine/);
    expect(run.liveOptions).toBeNull();
  });

  it('warns about the L3 browser smoke when routing flags pixels', () => {
    const run = runGate(scratchRepo(), [], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true, needsL3: true }),
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/Run the L3 browser smoke/);
    expect(run.artifact?.routing).toMatchObject({ needsL3: true });
  });
});

describe('stage 4 — live', () => {
  const needsLive = JSON.stringify({ required: ['login-spine', 'politics-read'] });

  it('drives the routed flows and exits 0 on a live PASS, with the artifact filled', () => {
    const live = { status: 'PASS', flows: [{ name: 'login-spine', status: 'PASS' }] };
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify(live),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toEqual({
      flows: ['login-spine', 'politics-read'],
      branch: 'feature/x',
      capabilities: [],
    });
    expect(run.stdout).toMatch(/live drive on planitia: login-spine, politics-read/);
    expect(run.stdout).toMatch(/summary: PASS/);
    expect(run.stdout).toMatch(/Gate PASS\. Artifact:/);
    expect(run.artifact).toMatchObject({ verdict: 'PASS', live });
  });

  it('exits 1 on a live FAIL', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify({ status: 'FAIL' }),
    });
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/Gate FAIL\. Artifact:/);
    expect(run.artifact).toMatchObject({ verdict: 'FAIL', live: { status: 'FAIL' } });
  });

  it('exits 2 on a live BLOCKED and records the verdict as BLOCKED', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify({ status: 'BLOCKED' }),
    });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({ verdict: 'BLOCKED' });
  });

  it('never passes a live result BLOCKED by a skipped flow', () => {
    const live = {
      status: 'BLOCKED',
      error: `skipped — a flow that did not run is not a pass: permission-negative (${SECONDARY_ACCOUNT.username} refused)`,
      flows: [
        { name: 'login-spine', status: 'PASS' },
        { name: 'permission-negative', status: 'SKIPPED', skipped: `${SECONDARY_ACCOUNT.username} refused` },
      ],
    };
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify(live),
    });
    expect(run.code).not.toBe(0);
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({ verdict: 'BLOCKED', live });
  });

  it('exits 3 on an ENVIRONMENT abort, keeps the verdict, and says it is not an attempt', () => {
    // The exit code is what the bench worker reads. Collapsed to 1 it arrived there as
    // FAIL, and the worker then attested a sha whose code was never judged.
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify({ status: 'ENVIRONMENT' }),
    });
    expect(run.code).toBe(3);
    expect(run.stdout).toMatch(/ENVIRONMENT abort, not a failed attempt/);
    expect(run.stdout).toMatch(/Exiting 3, so the bench worker attests nothing/);
    expect(run.artifact).toMatchObject({ verdict: 'ENVIRONMENT' });
  });

  it('does not judge capability evidence an ENVIRONMENT abort never gathered', () => {
    // An aborted run answers "undetermined" for every capability it never got to read.
    // Judging that answer would put the ENVIRONMENT straight back into FAIL through the
    // side door, and with it the attestation the abort must not produce.
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: needsLive,
      FAKE_LIVE: JSON.stringify({
        status: 'ENVIRONMENT',
        capabilities: [{ account: 'SPO_test3', capability: 'president', determined: false }],
      }),
    });
    expect(run.code).toBe(3);
    expect(run.artifact).toMatchObject({ verdict: 'ENVIRONMENT' });
    expect(run.stdout).not.toMatch(/did not answer whether/);
  });

  it('lets --flows= override the routed set only when it still covers the required set', () => {
    // #1183 changed this contract: --flows= replaced the routed set and nothing checked it
    // still named the required flows, so a gate could attest PASS having driven none of them.
    const refused = runGate(scratchRepo(), ['--live', '--flows=mail-roundtrip,building-details'], {
      FAKE_ROUTING: needsLive,
    });
    expect(refused.code).toBe(2);
    expect(refused.liveOptions).toBeNull();
    expect(refused.artifact).toMatchObject({
      verdict: 'BLOCKED',
      live: {
        skipped: true,
        why: '--flows= leaves out required flow(s): login-spine, politics-read',
      },
    });
    expect(refused.stdout).toMatch(/Gate BLOCKED — --flows= replaces the routed set/);

    const covered = runGate(
      scratchRepo(),
      ['--live', '--flows=login-spine,politics-read,mail-roundtrip'],
      { FAKE_ROUTING: needsLive },
    );
    expect(covered.code).toBe(0);
    expect(covered.liveOptions).toMatchObject({
      flows: ['login-spine', 'politics-read', 'mail-roundtrip'],
    });
  });

  it('exits 1 when the live driver crashes', () => {
    const run = runGate(scratchRepo(), ['--live'], { FAKE_ROUTING: needsLive, FAKE_LIVE: '{not json' });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/Gate crashed:/);
  });

  it('without --live, routed flows never reach runLive and the gate BLOCKS rather than passing static-only', () => {
    // This is the class B3.1 exists to close: routing required flows, the live stage did
    // not run, and the gate must not exit 0. Before this change it did — see the
    // 2026-08-29 incident test below for the exact conditions that shipped 11 PRs behind
    // a silent PASS.
    const run = runGate(scratchRepo(), [], { FAKE_ROUTING: needsLive });
    expect(run.code).toBe(2);
    expect(run.liveOptions).toBeNull();
    expect(run.stdout).toMatch(/Gate BLOCKED — routing requires flows that were not driven/);
    expect(run.stdout).toMatch(/not a verdict on the change/);
    // The undriven flow names must be legible on stdout — the surface a human reads
    // first — not only inside the artifact file.
    expect(run.stdout).toMatch(/not driven: login-spine, politics-read/);
    expect(run.artifact).toMatchObject({
      verdict: 'BLOCKED',
      // Pinned to the "--live was never supplied" wording — the only cause this run
      // exercises (no --static-only flag, no router staticOnly decision).
      live: {
        skipped: true,
        why: expect.stringMatching(
          /^--live was never supplied; routed flows: login-spine, politics-read$/,
        ),
      },
    });
    // The flows the router named are legible in the artifact, not just implied.
    expect(run.artifact?.live).toMatchObject({
      why: expect.stringContaining('login-spine, politics-read'),
    });
  });

  it('INCIDENT (2026-08-29): live routed login-spine + building-details, the worker did not pass --live — the gate refuses, it does not PASS', () => {
    // Reproduces the exact shape of e180bfb6: verify-gate.js gained a --live-gated live
    // stage and src/e2e/bench/worker.ts was updated to pass it in the same commit, but the
    // worker ran from a separately installed binary and verify-gate.js ran from the gated
    // commit's own tree — so from the moment that commit reached main, the new script ran
    // under the old worker, which never passed --live. The gate recorded
    // `verdict: PASS` next to `live: {skipped: true, why: "live stage requires --live
    // (worker-only); routed flows: login-spine, building-details, ..."}` seventeen times.
    // Name this test after the incident so nobody deletes it as "just another BLOCKED case".
    const run = runGate(scratchRepo(), [], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine', 'building-details'] }),
    });
    expect(run.code).toBe(2);
    expect(run.artifact?.verdict).not.toBe('PASS');
    expect(run.artifact).toMatchObject({ verdict: 'BLOCKED' });
    expect(run.artifact?.live).toMatchObject({
      skipped: true,
      why: expect.stringContaining('login-spine, building-details'),
    });
    // The names a maintainer reads first are on stdout, not buried in the artifact file.
    expect(run.stdout).toMatch(/not driven: login-spine, building-details/);
    expect(run.liveOptions).toBeNull();
  });

  it('without --live, a capability question blocks rather than reaching runLive', () => {
    const run = runGate(scratchRepo(), [], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true }),
      FAKE_PRESIDENT: JSON.stringify(['RDOSitMayor']),
    });
    expect(run.code).toBe(2);
    expect(run.liveOptions).toBeNull();
    expect(run.stdout).toMatch(/Gate BLOCKED — capability question needs the live stage/);
    expect(run.artifact).toMatchObject({ verdict: 'BLOCKED' });
  });

  it('--live with a capability question restores the live stage', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true }),
      FAKE_PRESIDENT: JSON.stringify(['RDOSitMayor']),
      FAKE_LIVE: JSON.stringify({ status: 'PASS', capabilities: [] }),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toEqual({ flows: [], branch: 'feature/x', capabilities: ['president'] });
  });
});

describe('the diff base', () => {
  /**
   * `main` advanced by one commit after being pushed, then the feature branch forked from
   * it: against `origin/main` the branch shows two files, against a lagging local `main`
   * only one.
   */
  function repoWithDivergedMain(withRemote: boolean): string {
    const dir = scratchRepo({ withRemote });
    git(dir, 'checkout', '-q', 'main');
    commitFile(dir, 'src/server/later.ts', 'export const later = 2;\n', 'feat: later');
    git(dir, 'checkout', '-q', 'feature/x');
    git(dir, 'rebase', '-q', 'main');
    return dir;
  }

  it('judges the branch against origin/main when the remote ref exists', () => {
    const run = runGate(repoWithDivergedMain(true), [], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true }),
    });
    expect(run.code).toBe(0);
    expect(run.artifact?.routing).toMatchObject({
      changed: expect.arrayContaining(['src/server/later.ts', 'src/server/thing.ts']),
    });
    expect((run.artifact?.routing as { changed: string[] }).changed).toHaveLength(2);
    expect(run.diffSeen).toContain('+++ b/src/server/later.ts');
  });

  it('falls back to the local main when there is no origin/main', () => {
    const run = runGate(repoWithDivergedMain(false), [], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true }),
    });
    expect(run.code).toBe(0);
    expect(run.artifact?.routing).toMatchObject({ changed: ['src/server/thing.ts'] });
    expect(run.diffSeen).not.toContain('later.ts');
  });

  it('includes working-tree modifications in the changed files and the diff', () => {
    const dir = scratchRepo();
    fs.appendFileSync(path.join(dir, 'README.md'), 'edited\n', 'utf8');
    const run = runGate(dir, [], { FAKE_ROUTING: JSON.stringify({ staticOnly: true }) });
    expect(run.code).toBe(0);
    expect(run.artifact?.routing).toMatchObject({
      changed: expect.arrayContaining(['README.md', 'src/server/thing.ts']),
    });
    expect(run.diffSeen).toContain('+edited');
  });
});

describe('stage 5 — capability judgement (doc/E2E-POLICY.md §7)', () => {
  const president = JSON.stringify(['RDOSitMayor']);
  const evidence = (granted: boolean, determined = true) =>
    JSON.stringify({
      status: 'PASS',
      flows: [],
      capabilities: [
        {
          capability: 'president',
          account: 'SPO_test3',
          members: ['RDOSitMayor', 'RDOSitMinister'],
          determined,
          granted,
          checks: [{ what: 'canGovern on the Capitol (server grantAccess)', value: String(granted) }],
          checkedAt: 'now',
          ...(determined ? {} : { error: 'socket closed' }),
        },
      ],
    });

  it('runs the live stage for a capability even when routing is static-only', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ staticOnly: true }),
      FAKE_PRESIDENT: president,
      FAKE_LIVE: evidence(false),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toEqual({ flows: [], branch: 'feature/x', capabilities: ['president'] });
  });

  it('records a refused capability as an exception and passes', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_PRESIDENT: president,
      FAKE_LIVE: evidence(false),
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/CAPABILITY EXCEPTION/);
    expect(run.stdout).toMatch(/does not hold the 'president' capability/);
    expect(run.artifact).toMatchObject({
      verdict: 'PASS',
      exclusions: {
        presidentMembersTouched: ['RDOSitMayor'],
        capability: [{ capability: 'president', members: ['RDOSitMayor'], account: 'SPO_test3' }],
      },
    });
  });

  it('fails closed when the server GRANTS the capability and no flow drives the member', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_PRESIDENT: president,
      FAKE_LIVE: evidence(true),
    });
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/holds the 'president' capability/);
    expect(run.stdout).toMatch(/add a flow that exercises the changed member/);
    expect(run.artifact).toMatchObject({ verdict: 'FAIL', exclusions: { capability: [] } });
  });

  it('fails when the capability could not be determined — read, never assumed', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_PRESIDENT: president,
      FAKE_LIVE: evidence(false, false),
    });
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/did not answer whether SPO_test3 holds the 'president' capability/);
    expect(run.artifact).toMatchObject({ verdict: 'FAIL' });
  });
});

describe('stage 6 — unproven flows (doc/E2E-POLICY.md §7)', () => {
  const noAlert = 'no "Zoning Alert!" in the inbox — the flow\'s data — seed failed: timeout';
  const noIssue = 'the newest issue opens with stories — 0 issues';
  const liveWith = (flows: Array<{ name: string; status: string; unproven: string[] }>) =>
    JSON.stringify({ status: 'PASS', flows });

  it('fails the gate when a REQUIRED flow ends UNPROVEN', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine', 'zoning-alert-read'] }),
      FAKE_LIVE: liveWith([
        { name: 'login-spine', status: 'PASS', unproven: [] },
        { name: 'zoning-alert-read', status: 'UNPROVEN', unproven: [noAlert] },
      ]),
    });
    expect(run.code).toBe(1);
    expect(run.artifact?.verdict).toBe('FAIL');
    expect(run.artifact?.unproven).toEqual([
      { flow: 'zoning-alert-read', required: true, reasons: [noAlert] },
    ]);
    expect(run.stdout).toMatch(/UNPROVEN REQUIRED FLOW/);
    expect(run.stdout).toContain('zoning-alert-read');
    expect(run.stdout).toContain(`  ? ${noAlert}`);
    expect(run.stdout).toMatch(/§7/);
    expect(run.stdout).toMatch(/Gate FAIL\. Artifact:/);
  });

  it('records an UNPROVEN flow run only because --flows named it as informational, and passes', () => {
    const run = runGate(scratchRepo(), ['--live', '--flows=login-spine,newspaper-read'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_LIVE: liveWith([
        { name: 'login-spine', status: 'PASS', unproven: [] },
        { name: 'newspaper-read', status: 'UNPROVEN', unproven: [noIssue] },
      ]),
    });
    expect(run.code).toBe(0);
    expect(run.artifact?.verdict).toBe('PASS');
    expect(run.artifact?.unproven).toEqual([
      { flow: 'newspaper-read', required: false, reasons: [noIssue] },
    ]);
    expect(run.stdout).toMatch(/informational/);
    expect(run.stdout).toContain(`  ? ${noIssue}`);
    expect(run.stdout).not.toMatch(/UNPROVEN REQUIRED FLOW/);
  });

  it('leaves unproven empty when every flow passes', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_LIVE: liveWith([{ name: 'login-spine', status: 'PASS', unproven: [] }]),
    });
    expect(run.code).toBe(0);
    expect(run.artifact?.verdict).toBe('PASS');
    expect(run.artifact?.unproven).toEqual([]);
    expect(run.stdout).not.toMatch(/informational/);
  });

  it('leaves unproven empty and still exits 3 on an ENVIRONMENT abort', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['zoning-alert-read'] }),
      FAKE_LIVE: JSON.stringify({ status: 'ENVIRONMENT' }),
    });
    expect(run.code).toBe(3);
    expect(run.artifact?.verdict).toBe('ENVIRONMENT');
    expect(run.artifact?.unproven).toEqual([]);
  });

  it('still fails on a required UNPROVEN next to a refused capability, and records the exception', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: JSON.stringify({ required: ['zoning-alert-read'] }),
      FAKE_PRESIDENT: JSON.stringify(['RDOSitMayor']),
      FAKE_LIVE: JSON.stringify({
        status: 'PASS',
        flows: [{ name: 'zoning-alert-read', status: 'UNPROVEN', unproven: [noAlert] }],
        capabilities: [
          {
            capability: 'president',
            account: 'SPO_test3',
            members: ['RDOSitMayor', 'RDOSitMinister'],
            determined: true,
            granted: false,
            checks: [{ what: 'canGovern on the Capitol (server grantAccess)', value: 'false' }],
            checkedAt: 'now',
          },
        ],
      }),
    });
    expect(run.code).toBe(1);
    expect(run.artifact?.verdict).toBe('FAIL');
    expect(run.stdout).toMatch(/CAPABILITY EXCEPTION/);
    expect((run.artifact?.exclusions as { capability: unknown[] }).capability).toHaveLength(1);
    expect(run.artifact?.unproven).toEqual([
      { flow: 'zoning-alert-read', required: true, reasons: [noAlert] },
    ]);
  });
});

describe('stage 3 — changed and declared flows (#1183)', () => {
  const flowOnly = JSON.stringify({ staticOnly: true, required: [] });
  const changedPolitics = JSON.stringify({
    required: ['politics-read'],
    notDriven: [],
    reasons: ['flow changed in src/e2e/flows.ts: politics-read'],
  });

  it('a flow-only diff is not static-only: it drives the spine and the changed flow', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: flowOnly,
      FAKE_CHANGED: changedPolitics,
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toMatchObject({ flows: ['login-spine', 'politics-read'] });
    expect(run.artifact?.routing).toMatchObject({
      required: ['login-spine', 'politics-read'],
      changedFlows: ['politics-read'],
      changedFlowsNotDriven: [],
      declared: [],
      reasons: ['flow changed in src/e2e/flows.ts: politics-read'],
    });
    expect(run.stdout).not.toMatch(/static only/);
  });

  it('a flow-only diff without --live BLOCKS, never PASS', () => {
    const run = runGate(scratchRepo(), [], { FAKE_ROUTING: flowOnly, FAKE_CHANGED: changedPolitics });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({
      verdict: 'BLOCKED',
      live: { why: '--live was never supplied; routed flows: login-spine, politics-read' },
    });
    expect(run.liveOptions).toBeNull();
  });

  it('a flow-only diff under --static-only BLOCKS', () => {
    const run = runGate(scratchRepo(), ['--live', '--static-only'], {
      FAKE_ROUTING: flowOnly,
      FAKE_CHANGED: changedPolitics,
    });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({ verdict: 'BLOCKED' });
    expect(run.liveOptions).toBeNull();
  });

  it('--also-flows= unions with the routed set and records what was declared', () => {
    const run = runGate(scratchRepo(), ['--live', '--also-flows=mail-roundtrip'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine', 'politics-read'] }),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toMatchObject({
      flows: ['login-spine', 'politics-read', 'mail-roundtrip'],
    });
    expect(run.artifact?.routing).toMatchObject({
      required: ['login-spine', 'politics-read', 'mail-roundtrip'],
      declared: ['mail-roundtrip'],
      reasons: ['declared by --also-flows: mail-roundtrip'],
    });
  });

  it('--also-flows= over a static routing decision drives the spine and the declared flow', () => {
    const run = runGate(scratchRepo(), ['--live', '--also-flows=politics-read'], {
      FAKE_ROUTING: flowOnly,
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toMatchObject({ flows: ['login-spine', 'politics-read'] });
  });

  it('--also-flows= naming a quarantined flow does not require it, and records it as quarantined (#1310)', () => {
    const run = runGate(scratchRepo(), ['--live', '--also-flows=portrait-roundtrip'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine', 'politics-read'] }),
      FAKE_QUARANTINE: JSON.stringify({ 'portrait-roundtrip': { reason: 'the picture server refuses' } }),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toMatchObject({ flows: ['login-spine', 'politics-read'] });
    expect((run.artifact?.routing as { required: string[] }).required).not.toContain('portrait-roundtrip');
    expect(run.artifact?.routing).toMatchObject({
      required: ['login-spine', 'politics-read'],
      declared: [],
      quarantined: ['portrait-roundtrip'],
      reasons: ['server quarantine, not required: portrait-roundtrip — the picture server refuses'],
    });
  });

  it('records a quarantined flow the diff changed, once, beside a declared one (#1310)', () => {
    const run = runGate(scratchRepo(), ['--live', '--also-flows=portrait-roundtrip'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine', 'politics-read'] }),
      FAKE_CHANGED: JSON.stringify({ required: [], notDriven: [], quarantined: ['portrait-roundtrip'], reasons: [] }),
      FAKE_QUARANTINE: JSON.stringify({ 'portrait-roundtrip': { reason: 'refused' } }),
    });
    expect(run.code).toBe(0);
    expect(run.artifact?.routing).toMatchObject({ quarantined: ['portrait-roundtrip'] });
  });

  it('--flows= naming a quarantined flow still drives it (#1310)', () => {
    const run = runGate(scratchRepo(), ['--live', '--flows=login-spine,portrait-roundtrip'], {
      FAKE_ROUTING: JSON.stringify({ required: ['login-spine'] }),
      FAKE_QUARANTINE: JSON.stringify({ 'portrait-roundtrip': { reason: 'refused' } }),
    });
    expect(run.code).toBe(0);
    expect(run.liveOptions).toMatchObject({ flows: ['login-spine', 'portrait-roundtrip'] });
  });

  it('a bare --also-flows declares nothing', () => {
    const run = runGate(scratchRepo(), ['--live', '--also-flows'], { FAKE_ROUTING: flowOnly });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/Gate PASS \(static only\)/);
    expect(run.artifact?.routing).toMatchObject({ declared: [], required: [] });
  });

  it('--flows= that leaves out a changed flow is refused', () => {
    const run = runGate(scratchRepo(), ['--live', '--flows=login-spine'], {
      FAKE_ROUTING: flowOnly,
      FAKE_CHANGED: changedPolitics,
    });
    expect(run.code).toBe(2);
    expect(run.artifact).toMatchObject({
      verdict: 'BLOCKED',
      live: { why: '--flows= leaves out required flow(s): politics-read' },
    });
    expect(run.liveOptions).toBeNull();
  });

  it('a changed flow that ends UNPROVEN fails the gate — it is required', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: flowOnly,
      FAKE_CHANGED: JSON.stringify({ required: ['zoning-alert-read'], notDriven: [], reasons: [] }),
      FAKE_LIVE: JSON.stringify({
        status: 'PASS',
        flows: [
          { name: 'login-spine', status: 'PASS', unproven: [] },
          { name: 'zoning-alert-read', status: 'UNPROVEN', unproven: ['no alert'] },
        ],
      }),
    });
    expect(run.code).toBe(1);
    expect(run.artifact?.unproven).toEqual([
      { flow: 'zoning-alert-read', required: true, reasons: ['no alert'] },
    ]);
  });

  it('fails closed when the diff cannot be mapped to changed flows', () => {
    const run = runGate(scratchRepo(), ['--live'], {
      FAKE_ROUTING: flowOnly,
      FAKE_CHANGED_THROW: 'FLOWS lists 60 binding(s) but 61 flow(s) were loaded',
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/could not map the diff to changed flows: FLOWS lists 60/);
    expect(run.artifact).toMatchObject({ verdict: 'FAIL' });
    expect(run.liveOptions).toBeNull();
  });

  it('hands the helper a -U0 diff restricted to the flow sources', () => {
    const dir = scratchRepo();
    commitFile(dir, 'src/e2e/flows.ts', 'export const x = 1;\n', 'feat: a flow');
    const run = runGate(dir, [], { FAKE_ROUTING: flowOnly });
    expect(run.code).toBe(0);
    expect(run.flowDiffSeen).toContain('+++ b/src/e2e/flows.ts');
    expect(run.flowDiffSeen).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m);
    expect(run.flowDiffSeen).not.toContain('src/server/thing.ts');
  });
});
