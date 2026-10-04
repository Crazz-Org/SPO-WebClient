#!/usr/bin/env node

/**
 * The pre-push gate — doc/E2E-POLICY.md §3.
 *
 * Runs, in order, stopping at the first failure:
 *
 *   static        typecheck, lint, tests — or, with --skip-static, a proof the bench worker
 *                 verified for itself: a precheck receipt matched to the tree on disk
 *                 (src/e2e/bench/receipt.ts), or CI's own run on this sha
 *                 (src/e2e/bench/ci-proof.ts). --static-from names which, in the artifact.
 *   capabilities  President members in the diff -> the live stage must read, from the
 *                 server, whether the test account holds the capability (§7)
 *   routing       diff -> routed ∪ changed ∪ declared flows: the routing table, the flows
 *                 the diff changed in the flow sources (src/e2e/bench/changed-flows.ts) and
 *                 the flows named by --also-flows; all of them are required, except a
 *                 server-quarantined flow (routing.ts SERVER_QUARANTINE), listed instead
 *   live          pre-flight, lock, capability reads, flows against planitia, restore, release
 *   judge         a capability the server GRANTS must be exercised by a flow (fail closed);
 *                 one it REFUSES is a recorded exception, never a human override
 *   unproven      a required flow that ended UNPROVEN fails; one run only because --flows
 *                 named it is recorded as informational (§7)
 *   artifact      report/e2e/gate-<sha>.json, which the push hook reads
 *
 * Exit codes — the interface, one per outcome (see EXIT below):
 *
 *   0  PASS         1  FAIL         2  BLOCKED        3  ENVIRONMENT (nothing was judged;
 *                                                        the worker attests nothing)
 *
 * Usage:
 *   node scripts/verify-gate.js                    # static-only: the live stage never runs
 *   node scripts/verify-gate.js --live             # worker only: opts into the live stage
 *   node scripts/verify-gate.js --static-only
 *   node scripts/verify-gate.js --skip-static      # worker only: a receipt covers stage 1
 *   node scripts/verify-gate.js --skip-static --static-from=ci   # worker only: CI proved this sha
 *   node scripts/verify-gate.js --also-flows=a,b          # adds flows to the routed set (a union)
 *   node scripts/verify-gate.js --flows=login-spine,politics-write
 *                                                          # replaces the set; refused unless it
 *                                                          # names every required flow
 *   node scripts/verify-gate.js --attempt=2               # worker only: the bench computes
 *                                                          # and passes this — see worker.ts's
 *                                                          # nextGateAttempt (B4.3)
 *   node scripts/verify-gate.js --deposited-sha=<sha>      # worker only: the sha the submitter
 *                                                          # actually asked to gate, when it
 *                                                          # differs from HEAD (a merged-base
 *                                                          # gate — see the artifact's
 *                                                          # `depositedSha`/`gatedSha` fields,
 *                                                          # B4.1, SPO-Pipeline/doc/bench-audit-2026-09-02.md D6)
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join('report', 'e2e');
const argv = process.argv.slice(2);

/**
 * The exit code IS the verdict — one code per outcome, never a single "not zero".
 *
 * The bench worker maps these back one-for-one (`GATE_EXIT_VERDICT` in
 * src/e2e/bench/worker.ts), and two of them — `ENVIRONMENT` above all — must NOT produce an
 * attestation: a run that judged no code cannot be allowed to overwrite a good `PASS` for the
 * same sha, nor publish `bench/gate=failure` on it. Collapsing everything to 1 made that
 * distinction unreachable, because the worker only ever saw the 1.
 *
 * A code this table does not name is read as `FAIL` — including the 1 an uncaught crash
 * exits with, which is the safe direction: it attests, it does not silently pass.
 */
const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, ENVIRONMENT: 3 };

function exitCodeFor(verdict) {
  return EXIT[verdict] ?? EXIT.FAIL;
}

function flag(name) {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * The commit this branch is judged against. `origin/main` when the remote ref exists — a
 * LOCAL `main` that lags makes the gate judge every commit merged since, not the branch
 * (seen 2026-08-21: a one-file docs change routed as three PRs' worth of source). The bench
 * worker fetches `origin main` before each job, so the remote ref is fresh there; a
 * checkout without the remote falls back to `main`, and a repo with neither to HEAD.
 */
function diffBase() {
  for (const ref of ['origin/main', 'main']) {
    try {
      return git(['merge-base', 'HEAD', ref]);
    } catch {
      // Try the next ref.
    }
  }
  return null;
}

/** Everything this branch changed against its merge-base, plus the working tree. */
function changedFiles() {
  const base = diffBase();
  const args = base ? ['diff', '--name-only', base, 'HEAD'] : ['diff', '--name-only', 'HEAD'];
  const committed = git(args).split('\n').filter(Boolean);
  // `-uall` matters: without it an untracked DIRECTORY collapses to a single `dir/` entry,
  // so a new file inside it would never be routed to a flow.
  // Not through git(): its trim() would eat the leading space of a ` M path` line and
  // hand the router `ath` — the first-listed unstaged modification lost its first letter.
  const working = execFileSync('git', ['status', '--porcelain', '-uall'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())
    .filter(Boolean);
  return Array.from(new Set([...committed, ...working]));
}

/**
 * The paths this branch removed. The router needs them apart: a path that no longer exists
 * and that no rule covers is not an unmapped area the gate must fail closed on.
 */
function deletedFiles() {
  const base = diffBase();
  const args = base
    ? ['diff', '--name-only', '--diff-filter=D', base, 'HEAD']
    : ['diff', '--name-only', '--diff-filter=D', 'HEAD'];
  return git(args).split('\n').filter(Boolean);
}

/**
 * A zero-context diff of `paths`, from the diff base to the WORKING TREE — committed and
 * uncommitted changes together, so its new-side line numbers match the files on disk, which
 * is what the changed-flow mapping reads them against.
 */
function flowSourceDiff(paths) {
  return execFileSync(
    'git',
    ['diff', '-U0', '--no-color', '--no-ext-diff', diffBase() || 'HEAD', '--', ...paths],
    { encoding: 'utf8' },
  );
}

/**
 * A unified diff of everything this branch introduces, including untracked files.
 *
 * `git diff` never shows an untracked file, so a brand-new module calling a President-only
 * member would slip past the exclusion scan. Untracked files are therefore rendered as
 * synthetic all-added hunks, in the same `+++ b/<path>` shape the scanner parses.
 */
function diffText() {
  const base = diffBase();
  const committed = base ? git(['diff', base, 'HEAD']) : '';
  const working = git(['diff', 'HEAD']);

  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map(file => {
      let body = '';
      try {
        body = fs.readFileSync(file, 'utf8');
      } catch {
        return ''; // Binary or unreadable: nothing to scan for a member name.
      }
      const added = body.split('\n').map(line => `+${line}`).join('\n');
      return `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n${added}`;
    })
    .join('\n');

  return [committed, working, untracked].filter(Boolean).join('\n');
}

function captureStage(label, command) {
  const BENCH_DIR = process.env.SPO_BENCH_DIR || `${process.env.HOME}/.spo-bench`;
  const LOG_DIR = `${BENCH_DIR}/logs`;

  fs.mkdirSync(LOG_DIR, { recursive: true });

  // ISO timestamp: YYYYMMDDTHHMMSS
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const STAMP = `${year}${month}${day}T${hours}${minutes}${seconds}`;

  const LOG = path.join(LOG_DIR, `gate-${label}-${STAMP}.log`);

  // Use shell redirection to capture output reliably (like run-verdict.sh)
  const redirectCommand = `${command} > "${LOG}" 2>&1`;

  try {
    execSync(redirectCommand, { shell: true, stdio: 'inherit' });
    // On success, read and return
    const output = fs.readFileSync(LOG, 'utf8');
    process.stdout.write(`\n=== ${label} PASS\n`);
    return { stage: label, status: 'PASS' };
  } catch (err) {
    // On failure, tail the log to bounded output
    const tail = execSync(`tail -n 40 "${LOG}"`, { encoding: 'utf8' }).trim();
    process.stdout.write(`\n=== ${label} FAIL\n`);
    if (tail) process.stdout.write(tail + '\n');
    process.stdout.write(`LOG=${LOG}\n`);

    return { stage: label, status: 'FAIL', detail: err.message };
  }
}

function runStage(label, command) {
  // Static stages get output capping to avoid injecting unbounded text
  if (['typecheck', 'lint', 'unit + component tests'].includes(label)) {
    return captureStage(label, command);
  }

  // build:e2e streams output (it's diagnostic, runs after static checks pass)
  process.stdout.write(`\n=== ${label}\n`);
  try {
    execSync(command, { stdio: 'inherit' });
    return { stage: label, status: 'PASS' };
  } catch (err) {
    return { stage: label, status: 'FAIL', detail: err.message };
  }
}

function write(artifact) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, `gate-${artifact.head}.json`);
  fs.writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return file;
}

async function main() {
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const files = changedFiles();

  // The sha this run actually checked out and is about to test — this file's own filename
  // basis (`gate-<head>.json`). Named `gatedSha` too, by the same name the verdict uses for
  // it, so a reader never has to remember that this file calls it `head`.
  const gatedSha = head;
  // The sha the submitter actually asked to gate — equal to `head`/`gatedSha` unless the
  // worker merged `origin/main` onto it first (a merge-queue / merged-base gate; see
  // `worker.ts`'s `prepareRef`), in which case HEAD is now a merge commit nobody pushed and
  // this is the only place that still names what was. Passed by the worker via
  // `--deposited-sha`; a session invoking this directly has nothing to differ from HEAD, so
  // it defaults to `head`. Recording both explicitly closes D6
  // (SPO-Pipeline/doc/bench-audit-2026-09-02.md): the verdict keys on the deposited sha, this artifact
  // keys on the gated one, and until now neither file said which sha the OTHER one meant.
  const depositedSha = flag('deposited-sha') || head;

  const artifact = {
    head,
    depositedSha,
    gatedSha,
    branch,
    verdict: 'FAIL',
    createdAt: new Date().toISOString(),
    // Supplied by the worker for a `ref` job — see `nextGateAttempt` in worker.ts (B4.3):
    // it counts how many times THIS depositedSha has been sent through this script,
    // so a re-gate of the identical target is never silently `attempt: 1` again. Defaults
    // to 1 for a direct, worker-less invocation (nothing to count against).
    attempt: Number(flag('attempt') || 1),
    static: {},
    routing: {},
    live: null,
    exclusions: { presidentMembersTouched: [], capability: [] },
    // Outside `exclusions` on purpose: a required UNPROVEN flow is a failure, not an
    // exclusion — doc/E2E-POLICY.md §7 (Unproven flows).
    unproven: [],
  };

  // --- Stage 1: static -------------------------------------------------------
  // `--skip-static` is passed by the bench worker, and only when it has matched a precheck
  // receipt against the fingerprint IT took of the worktree on disk (src/e2e/bench/receipt.ts).
  // The three commands below are byte-for-byte what `gate:precheck` already ran on that
  // exact tree; replaying them costs ~113 s of the one resource every session queues for.
  // Nothing else is skipped, and the artifact says plainly where the proof came from.
  const staticSteps = [
    ['typecheck', 'typecheck', 'npm run typecheck'],
    ['lint', 'lint', 'npm run lint'],
    ['test', 'unit + component tests', 'npm test'],
  ];
  if (flag('skip-static') === 'true') {
    // WHO proved it is part of the evidence, not a detail. Two different authorities
    // recorded as one word would break the promise this artifact makes above — so the
    // marker names the witness: a precheck receipt (a session, re-keyed by the worker) or
    // CI (GitHub, on this exact sha, required green before the merge). See
    // src/e2e/bench/ci-proof.ts.
    const from = flag('static-from') === 'ci' ? 'CI' : 'RECEIPT';
    process.stdout.write(
      from === 'CI'
        ? '\n=== static: from CI, which ran it on this exact commit\n'
        : '\n=== static: from the precheck receipt (the worker matched it to this tree)\n',
    );
    for (const [key] of staticSteps) artifact.static[key] = from;
  } else {
    for (const [key, label, command] of staticSteps) {
      const result = runStage(label, command);
      artifact.static[key] = result.status;
      if (result.status === 'FAIL') {
        const file = write(artifact);
        fail(`static stage failed: ${label}`, file);
        return 1;
      }
    }
  }

  // The e2e sources must be compiled before anything below can load them.
  const build = runStage('build:e2e', 'npm run build:e2e');
  artifact.static.buildE2e = build.status;
  if (build.status === 'FAIL') {
    fail('could not build the e2e driver', write(artifact));
    return 1;
  }

  const routing = require(path.resolve('dist/e2e/routing.js'));
  const { route, presidentMembersInDiff, SPINE_FLOW } = routing;
  // A flow a known live-server fault blocks is never required by a gate (doc/E2E-POLICY.md §7,
  // "Server quarantine"); an explicit --flows= that names one still drives it.
  const SERVER_QUARANTINE = routing.SERVER_QUARANTINE || {};
  const isQuarantined = name => Object.prototype.hasOwnProperty.call(SERVER_QUARANTINE, name);
  const { FLOW_SOURCES, flowsChangedInWorktree } = require(
    path.resolve('dist/e2e/bench/changed-flows.js'),
  );
  const { capabilitiesFor } = require(path.resolve('dist/e2e/capability.js'));

  // --- Stage 2: capabilities -------------------------------------------------
  // A member the test account may not be authorised to call is not a reason to stop;
  // it is a question for the server. The live stage reads the answer (§7).
  const president = presidentMembersInDiff(diffText());
  artifact.exclusions.presidentMembersTouched = president;
  const capabilities = capabilitiesFor(president);

  // --- Stage 3: routing ------------------------------------------------------
  const decision = route(files, deletedFiles());
  artifact.routing = {
    changed: decision.changed,
    required: decision.required,
    unmapped: decision.unmapped,
    needsL3: decision.needsL3,
    reasons: decision.reasons,
  };

  if (decision.unmapped.length > 0) {
    artifact.verdict = 'FAIL';
    const file = write(artifact);
    fail(
      `no routing rule covers:\n  ${decision.unmapped.join('\n  ')}\n` +
        `Add a rule to src/e2e/routing.ts — the gate fails closed rather than passing silently.`,
      file,
    );
    return 1;
  }

  // Routed ∪ changed ∪ declared (doc/E2E-POLICY.md §4, "Changed and declared flows"). The
  // routing table sends src/e2e/ to no flow, so without this a card that edits a flow never
  // drives it. A diff the mapping cannot read fails closed: never a hunk paired with the
  // wrong flow, never a silent "nothing changed".
  let changed;
  try {
    changed = flowsChangedInWorktree(flowSourceDiff(FLOW_SOURCES));
  } catch (err) {
    artifact.verdict = 'FAIL';
    const file = write(artifact);
    fail(`could not map the diff to changed flows: ${err && err.message ? err.message : String(err)}`, file);
    return 1;
  }
  const alsoFlows = flag('also-flows');
  const declaredAll = !alsoFlows || alsoFlows === 'true' ? [] : alsoFlows.split(',').filter(Boolean);
  const declaredQuarantined = declaredAll.filter(isQuarantined);
  const declared = declaredAll.filter(name => !isQuarantined(name));
  const extra = [...changed.required, ...declared];
  const required =
    extra.length > 0
      ? Array.from(new Set([SPINE_FLOW, ...decision.required, ...extra]))
      : decision.required;
  artifact.routing.required = required;
  artifact.routing.changedFlows = changed.required;
  artifact.routing.changedFlowsNotDriven = changed.notDriven;
  artifact.routing.declared = declared;
  artifact.routing.quarantined = Array.from(new Set([...(changed.quarantined || []), ...declaredQuarantined]));
  artifact.routing.reasons = [
    ...decision.reasons,
    ...changed.reasons,
    ...(declared.length > 0 ? [`declared by --also-flows: ${declared.join(', ')}`] : []),
    ...declaredQuarantined.map(
      name => `server quarantine: ${name} — declared by --also-flows, not required: ${SERVER_QUARANTINE[name].reason}`,
    ),
  ];

  const liveRequested = flag('live') === 'true';
  // A diff that changes a flow, or declares one, is never static-only: its flows are required.
  const staticOnly =
    !liveRequested ||
    flag('static-only') === 'true' ||
    (decision.staticOnly && extra.length === 0);
  const requested = flag('flows');
  const requestedList = requested ? requested.split(',').filter(Boolean) : [];
  const flows = requested ? requestedList : required;

  // --flows= replaces the set, so it must still name every required flow: otherwise a gate
  // could attest PASS having driven only the spine.
  const missing = requested ? required.filter(f => !requestedList.includes(f)) : [];
  if (missing.length > 0) {
    artifact.verdict = 'BLOCKED';
    artifact.live = {
      skipped: true,
      why: `--flows= leaves out required flow(s): ${missing.join(', ')}`,
    };
    const file = write(artifact);
    process.stdout.write(
      `\nGate BLOCKED — --flows= replaces the routed set but leaves out required flow(s): ` +
        `${missing.join(', ')}; name them too, or add flows with --also-flows=\nArtifact: ${file}\n`,
    );
    return EXIT.BLOCKED;
  }

  // A capability question cannot be answered statically, and without --live the live stage
  // cannot run at all — so it is a BLOCKED question for the worker, never a silent pass.
  if (!liveRequested && capabilities.length > 0) {
    artifact.verdict = 'BLOCKED';
    artifact.live = {
      skipped: true,
      why:
        'a President capability question needs the live stage, which requires --live ' +
        '(worker-only): npm run gate',
    };
    const file = write(artifact);
    process.stdout.write(
      `\nGate BLOCKED — capability question needs the live stage: npm run gate\nArtifact: ${file}\n`,
    );
    return EXIT.BLOCKED;
  }

  // Nothing routed, changed or declared: the common case (doc/E2E-POLICY.md §4 — 186 of 215 skips in the
  // corpus), and the only shape that may legitimately PASS without a live drive.
  if (flows.length === 0 && capabilities.length === 0) {
    artifact.verdict = 'PASS';
    artifact.live = { skipped: true, why: 'nothing in this diff is observable over the wire' };
    const file = write(artifact);
    process.stdout.write(`\nGate PASS (static only). Artifact: ${file}\n`);
    if (decision.needsL3) warnL3();
    return 0;
  }

  // Routing named flows this diff must be driven through, and the live stage will not run
  // to drive them — for lack of --live (2026-08-29: a worker/script deploy skew meant the
  // flag never arrived) or because --static-only was asked for over a routed diff (it is
  // documented for doc/tooling diffs, which never route flows in the first place — see
  // ROUTES in src/e2e/routing.ts — so this branch only fires when it is used to override a
  // routing decision that wanted a live drive). Either way: the router said "drive these
  // flows", nothing drove them, and PASS is not an available answer to that. BLOCKED is —
  // the vocabulary already exists, and it is already a failure everywhere downstream.
  if (staticOnly && capabilities.length === 0) {
    artifact.verdict = 'BLOCKED';
    artifact.live = {
      skipped: true,
      why: !liveRequested
        ? `--live was never supplied; routed flows: ${flows.join(', ')}`
        : flag('static-only') === 'true'
          ? `--static-only was requested over a diff that routes flows; not driven: ${flows.join(', ')}`
          : `the router decided static-only over a diff that routes flows; not driven: ${flows.join(', ')}`,
    };
    const file = write(artifact);
    process.stdout.write(
      `\nGate BLOCKED — routing requires flows that were not driven: ${flows.join(', ')}\n` +
        'This is not a verdict on the change: the flows could not be driven, none failed.\n' +
        `Artifact: ${file}\n`,
    );
    return EXIT.BLOCKED;
  }

  // --- Stage 4: live ---------------------------------------------------------
  process.stdout.write(`\n=== live drive on planitia: ${flows.join(', ')}\n`);
  const { runLive, formatSummary } = require(path.resolve('dist/e2e/run.js'));
  const live = await runLive({ flows: staticOnly ? [] : flows, branch, capabilities });
  artifact.live = live;
  process.stdout.write(`${formatSummary(live, SERVER_QUARANTINE)}\n`);

  // The live status is CARRIED, not collapsed. An ENVIRONMENT abort used to arrive here and
  // leave as `FAIL`, and every reader downstream — the exit code, the worker's verdict, the
  // attestation, the `bench/gate` status — then spoke about the code on the strength of a run
  // that never judged it. Each outcome keeps its own name from here to the exit code (EXIT).
  artifact.verdict =
    live.status === 'PASS'
      ? 'PASS'
      : live.status === 'BLOCKED'
        ? 'BLOCKED'
        : live.status === 'ENVIRONMENT'
          ? 'ENVIRONMENT'
          : 'FAIL';

  // --- Stage 5: judge the capability evidence --------------------------------
  // An ENVIRONMENT abort learned nothing — including nothing about the capabilities. Judging
  // evidence that was never read would turn "the servers were not in a state to answer" back
  // into a verdict on the change, which is exactly the collapse the line above just undid.
  const capabilityEvidence = live.status === 'ENVIRONMENT' ? [] : live.capabilities || [];
  for (const evidence of capabilityEvidence) {
    if (!evidence.determined) {
      artifact.verdict = 'FAIL';
      process.stdout.write(
        `\nGate FAIL — the server did not answer whether ${evidence.account} holds the ` +
          `'${evidence.capability}' capability (${evidence.error || 'no answer'}); a capability ` +
          'must be read, never assumed.\n',
      );
    } else if (evidence.granted) {
      // The account CAN do it — so the change must be exercised, and nothing is routed to do so.
      artifact.verdict = 'FAIL';
      process.stdout.write(
        `\nGate FAIL — ${evidence.account} holds the '${evidence.capability}' capability, so ` +
          `${evidence.members.join(', ')} can be driven live: add a flow that exercises the ` +
          'changed member (src/e2e/flows.ts) and route it (src/e2e/routing.ts). Silence is not a pass.\n',
      );
    } else {
      artifact.exclusions.capability.push({
        capability: evidence.capability,
        members: president.filter(m => evidence.members.includes(m)),
        account: evidence.account,
        checks: evidence.checks,
        checkedAt: evidence.checkedAt,
      });
      process.stdout.write(
        [
          '',
          '=== CAPABILITY EXCEPTION =================================================',
          `${evidence.account} does not hold the '${evidence.capability}' capability on the server:`,
          ...evidence.checks.map(c => `  ${c.what} = ${c.value}`),
          `The touched member(s) ${president.join(', ')} therefore cannot be driven by this bench.`,
          'Recorded in the artifact and the PR; this is a property of the account, not a verdict',
          'on the change. The catalogue (kind + arity) remains the guard for these frames.',
          '==========================================================================',
          '',
        ].join('\n'),
      );
    }
  }

  // --- Stage 6: unproven flows (doc/E2E-POLICY.md §7, "Unproven flows") -----
  // A flow that ran, failed nothing, but found no data to exercise is not a PASS for the
  // change: when routing required it, the change was never seen working. An ENVIRONMENT or
  // BLOCKED run carries no flows, so this list stays empty and its exit code is unchanged.
  const requiredFlows = artifact.routing.required || [];
  for (const flow of live.flows || []) {
    if (flow.status !== 'UNPROVEN') continue;
    artifact.unproven.push({
      flow: flow.name,
      required: requiredFlows.includes(flow.name),
      reasons: flow.unproven || [],
    });
  }
  const unprovenRequired = artifact.unproven.filter(entry => entry.required);
  const unprovenInformational = artifact.unproven.filter(entry => !entry.required);
  if (unprovenRequired.length > 0) {
    artifact.verdict = 'FAIL';
    process.stdout.write(
      [
        '',
        '=== UNPROVEN REQUIRED FLOW ===============================================',
        ...unprovenRequired.flatMap(entry => [entry.flow, ...entry.reasons.map(r => `  ? ${r}`)]),
        'A required flow that ends UNPROVEN fails the gate: the world held no data to exercise',
        'it on, so the change was never seen working. The remedy is the flow\'s seed step, never',
        'an override — doc/E2E-POLICY.md §7 (Unproven flows).',
        '==========================================================================',
        '',
      ].join('\n'),
    );
  }
  if (unprovenInformational.length > 0) {
    process.stdout.write(
      [
        '',
        '=== unproven flow(s), informational — not required by routing ============',
        ...unprovenInformational.flatMap(entry => [
          entry.flow,
          ...entry.reasons.map(r => `  ? ${r}`),
        ]),
        'Run only because --flows named them; recorded in the artifact, no verdict changed.',
        '',
      ].join('\n'),
    );
  }

  const file = write(artifact);

  if (decision.needsL3) warnL3();
  process.stdout.write(`\nGate ${artifact.verdict}. Artifact: ${file}\n`);

  if (live.status === 'ENVIRONMENT') {
    process.stdout.write(
      '\nThis was an ENVIRONMENT abort, not a failed attempt: the servers were not in a\n' +
        'state where the change could be judged. Do not count it against the three tries\n' +
        '(doc/E2E-POLICY.md §8). Exiting 3, so the bench worker attests nothing for this sha.\n',
    );
  }
  return exitCodeFor(artifact.verdict);
}

function warnL3() {
  process.stdout.write(
    '\nNOTE: this diff touches rendering, layout or mobile — a WebSocket drive cannot see a\n' +
      'pixel. Run the L3 browser smoke (`/e2e`) before merging.\n',
  );
}

function fail(message, file) {
  process.stderr.write(`\nGate FAIL — ${message}\nArtifact: ${file}\n`);
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`Gate crashed: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
