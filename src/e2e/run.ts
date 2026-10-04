/**
 * The L2 live drive — `npm run test:live`, and the live stage of `npm run gate`.
 *
 * Sequential by construction: live runs are single-flight (doc/E2E-POLICY.md §6), so the
 * flows share one lock and never overlap.
 */

import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../shared/error-utils';
import { REPORT_DIR, WORLD_NAME } from './config';
import { CAPABILITIES, checkCapability, type Capability, type CapabilityEvidence } from './capability';
import { FLOWS, flowByName, runFlow, type FlowResult } from './flows';
import { preflight, type PreflightResult } from './preflight';
import { GATE_ONLY, SERVER_QUARANTINE, type QuarantineEntry } from './routing';
import { WorldLock } from './world-lock';

/**
 * Exit codes — matches `EXIT` in scripts/verify-gate.js, and read the same way by
 * `worker.ts`'s `GATE_EXIT_VERDICT`: 0 PASS, 1 FAIL, 2 BLOCKED (refused before driving
 * anything — a dirty world or another live run already in flight — or a flow ended SKIPPED,
 * the second account refused at login), 3 ENVIRONMENT (a
 * preflight abort; does not consume an attempt, doc/E2E-POLICY.md §8).
 */
const EXIT: Readonly<Record<LiveRunResult['status'], number>> = {
  PASS: 0,
  FAIL: 1,
  BLOCKED: 2,
  ENVIRONMENT: 3,
};

/** What a quarantined flow's result carries in a no-`--flows` run (doc/E2E-POLICY.md §7, "Server quarantine"). */
export type QuarantineNote = Pick<QuarantineEntry, 'reason' | 'link' | 'lift'>;

/** A flow's result, with its server quarantine when one applied. Its `status` stays the real one. */
export interface LiveFlowResult extends FlowResult {
  quarantined?: QuarantineNote;
}

export interface LiveRunResult {
  world: string;
  branch: string;
  /**
   * The commit this drive actually checked out, when the caller knows it (the worker
   * does, from the fingerprint it took before invoking this process — see worker.ts's
   * `runJob`). Absent for an ad hoc `npm run test:live:local`, where nobody upstream
   * resolved one; that is unknown, not "not applicable", and must be read that way by
   * anything comparing it to a sha later — see nightly.ts's `NightlyResult.sha` for the
   * field this mirrors and B3.2's classifyNightly for why an absent sha is never folded
   * into a match.
   */
  sha?: string;
  startedAt: string;
  finishedAt: string;
  status: 'PASS' | 'FAIL' | 'ENVIRONMENT' | 'BLOCKED';
  preflight: PreflightResult;
  flows: LiveFlowResult[];
  /** What the server says the test account may do — read-only, gathered before the flows. */
  capabilities: CapabilityEvidence[];
  error?: string;
  /** Set only when `lock.release()` refused — the world is dirty. No quarantine excuses it. */
  releaseError?: string;
}

export interface LiveRunOptions {
  flows: string[];
  branch: string;
  /** See {@link LiveRunResult.sha}. */
  sha?: string;
  lock?: WorldLock;
  /** Capabilities the diff depends on (doc/E2E-POLICY.md §7); the gate judges the evidence. */
  capabilities?: Capability[];
}

export async function runLive(options: LiveRunOptions): Promise<LiveRunResult> {
  const lock = options.lock ?? new WorldLock();
  const startedAt = new Date().toISOString();
  const base = { world: WORLD_NAME, branch: options.branch, sha: options.sha, startedAt };

  // A dirty-world or single-flight refusal is a BLOCK, not a test failure: nothing ran.
  try {
    lock.acquire(options.branch);
  } catch (err: unknown) {
    return {
      ...base,
      finishedAt: new Date().toISOString(),
      status: 'BLOCKED',
      preflight: { ok: false, checks: [], environmentAbort: false },
      flows: [],
      capabilities: [],
      error: toErrorMessage(err),
    };
  }

  // Every sleep of the drive is a ref'd timer (#1181), but if the event loop still drains
  // before the run settles, Node would exit 0 half-way — a silent false PASS. Fail loudly.
  let inProgress = 'preflight';
  const onDrain = (): void => {
    process.stderr.write(
      `L2 live drive: the event loop drained before the run settled — Node was about to exit mid-drive (in progress: ${inProgress}). ` +
        `A drive that stopped half-way is not a PASS: exiting ${EXIT.FAIL}.\n`,
    );
    try {
      lock.release(`live drive drained mid-run (${inProgress})`);
    } catch {
      // release() already marked the world dirty (pending restores) — nothing more to do here.
    }
    process.exit(EXIT.FAIL);
  };
  process.on('beforeExit', onDrain);

  try {
    const checks = await preflight();
    if (!checks.ok) {
      lock.release();
      return {
        ...base,
        finishedAt: new Date().toISOString(),
        status: 'ENVIRONMENT',
        preflight: checks,
        flows: [],
        capabilities: [],
        error: checks.checks.filter(c => !c.ok).map(c => `${c.what}: ${c.detail}`).join('; '),
      };
    }

    const results: FlowResult[] = [];
    const capabilities: CapabilityEvidence[] = [];
    let releaseError: string | undefined;

    try {
      // Capability reads come first: they mutate nothing, and the gate needs the answer
      // whether or not a flow then runs.
      for (const capability of options.capabilities ?? []) {
        inProgress = `capability ${capability}`;
        capabilities.push(await checkCapability(capability));
      }
      for (const name of options.flows) {
        inProgress = `flow ${name}`;
        results.push(await runFlow(flowByName(name), { lock, survivalLogUrl: checks.survivalLogUrl }));
      }
    } finally {
      try {
        lock.release();
      } catch (err: unknown) {
        // A dirty world is worse than a failed flow — surface it as the headline.
        releaseError = toErrorMessage(err);
      }
    }

    const failed = releaseError !== undefined || results.some(r => r.status === 'FAIL');
    // A flow that did not run is not a pass: a skip BLOCKS, and verify-gate.js maps that to a
    // BLOCKED gate (doc/E2E-POLICY.md §7).
    const skippedFlows = results.filter(r => r.status === 'SKIPPED');
    const skipError = skippedFlows.length
      ? `skipped — a flow that did not run is not a pass: ${skippedFlows.map(f => `${f.name} (${f.skipped ?? ''})`).join('; ')}`
      : undefined;
    return {
      ...base,
      finishedAt: new Date().toISOString(),
      status: failed ? 'FAIL' : skippedFlows.length > 0 ? 'BLOCKED' : 'PASS',
      preflight: checks,
      flows: results,
      capabilities,
      error: releaseError ?? skipError,
      ...(releaseError !== undefined ? { releaseError } : {}),
    };
  } finally {
    process.removeListener('beforeExit', onDrain);
  }
}

/** `npm run test:live -- --flows=a,b --branch=fix/x --sha=<40-hex> --capabilities=president` */
export async function main(
  argv: string[] = process.argv.slice(2),
  runner: (options: LiveRunOptions) => Promise<LiveRunResult> = runLive,
  out: NodeJS.WritableStream = process.stdout,
): Promise<number> {
  const flagged = (name: string): string | undefined =>
    argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const named = flagged('flows')?.split(',').filter(Boolean);
  // The nightly calls with no --flows (`args: []` in bench/nightly.ts): every flow but the
  // gate-only ones, whose action posts a message every online player sees. An explicit list
  // (the gate, `test:live --flows=`) runs exactly what it names, gate-only flows included.
  const gateOnly = new Set(Object.keys(GATE_ONLY));
  const skipped = named ? [] : FLOWS.map(f => f.name).filter(n => gateOnly.has(n));
  const flows = named ?? FLOWS.map(f => f.name).filter(n => !gateOnly.has(n));
  const branch = flagged('branch') ?? 'local';
  const sha = flagged('sha');
  const capabilities = (flagged('capabilities')?.split(',').filter(Boolean) ?? []).map(name => {
    if (!(name in CAPABILITIES)) {
      throw new Error(`Unknown capability "${name}". Known: ${Object.keys(CAPABILITIES).join(', ')}`);
    }
    return name as Capability;
  });

  const result = await runner({ flows, branch, sha, capabilities });
  // The nightly (no --flows) downgrades two outcomes to PASS, and an explicit --flows — a
  // card's proof, or a human checking a lift condition — downgrades neither:
  //  - a run BLOCKED only by SKIPPED flows: the skips are listed. A card cannot prove a flow
  //    that did not run. The lock-refusal BLOCK carries no flows, and a skip beside a failure
  //    is already FAIL, so this test is exact.
  //  - a run whose only FAILs are SERVER_QUARANTINE flows (doc/E2E-POLICY.md §7): each keeps
  //    its real status and gains a `quarantined` note. A dirty world (releaseError) still
  //    FAILs, whatever flow left it dirty — the quarantine never excuses a safety rail.
  const nightly = named === undefined;
  const fails = result.flows.filter(f => f.status === 'FAIL');
  const quarantineOnly =
    nightly &&
    result.status === 'FAIL' &&
    result.releaseError === undefined &&
    fails.length > 0 &&
    fails.every(f => f.name in SERVER_QUARANTINE);
  const skipOnly = nightly && result.status === 'BLOCKED' && result.flows.some(f => f.status === 'SKIPPED');
  const reported: LiveRunResult = {
    ...result,
    flows: nightly
      ? result.flows.map(f => {
          const entry = SERVER_QUARANTINE[f.name];
          return f.name in SERVER_QUARANTINE
            ? { ...f, quarantined: { reason: entry.reason, link: entry.link, lift: entry.lift } }
            : f;
        })
      : result.flows,
    status: quarantineOnly || skipOnly ? 'PASS' : result.status,
  };
  const file = path.join(REPORT_DIR, `live-${reported.startedAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(reported, null, 2)}\n`, 'utf8');

  const notDriven = skipped.map(n => `  gate-only, not driven: ${n} — ${GATE_ONLY[n]}`);
  out.write(`${[formatSummary(reported), ...notDriven].join('\n')}\nArtifact: ${file}\n`);
  return EXIT[reported.status];
}

export function formatSummary(
  result: LiveRunResult,
  quarantine: Record<string, QuarantineEntry> = SERVER_QUARANTINE,
): string {
  const shaSuffix = result.sha ? ` (${result.sha.slice(0, 8)})` : '';
  const lines = [`L2 live drive on ${result.world} — ${result.status}${shaSuffix}`];
  if (result.error) lines.push(`  ! ${result.error}`);
  for (const check of result.preflight.checks.filter(c => !c.ok)) {
    lines.push(`  pre-flight FAIL  ${check.what}: ${check.detail ?? ''}`);
  }
  for (const cap of result.capabilities) {
    const verdict = !cap.determined ? 'UNDETERMINED' : cap.granted ? 'GRANTED' : 'NOT GRANTED';
    lines.push(`  capability ${cap.capability}: ${verdict} for ${cap.account}${cap.error ? ` — ${cap.error}` : ''}`);
    for (const check of cap.checks) lines.push(`          ${check.what} = ${check.value}`);
  }
  for (const flow of result.flows) {
    lines.push(
      flow.status === 'SKIPPED'
        ? `  SKIP  ${flow.name} — ${flow.skipped ?? ''}`
        : `  ${flow.status.padEnd(4)}  ${flow.name}${flow.error ? ` — ${flow.error}` : ''}`,
    );
    if (flow.seed) {
      const { ok, what, detail } = flow.seed;
      lines.push(`          seed ${ok ? 'ok' : 'FAIL'}: ${what}${detail ? ` (${detail})` : ''}`);
    }
    for (const c of flow.cleanup ?? []) {
      lines.push(`          cleanup ${c.ok ? 'ok' : 'FAIL'}: ${c.what}${c.detail ? ` (${c.detail})` : ''}`);
    }
    for (const assertion of flow.assertions.filter(a => !a.ok)) {
      lines.push(`          x ${assertion.what}${assertion.detail ? ` (${assertion.detail})` : ''}`);
    }
    for (const reason of flow.unproven) lines.push(`          ? unproven: ${reason}`);
    for (const probe of flow.probes) {
      lines.push(
        `          probe ${probe.status}: ${probe.what} — log=${probe.logLine ? 'yes' : 'NO'}, ` +
          `readBack=${probe.readBack}, restored=${probe.restored}`,
      );
    }
  }
  // Printed on every run, gate or nightly, so the list stays visible when nothing fails.
  const entries = Object.entries(quarantine);
  lines.push(`  Server quarantine (${entries.length}):${entries.length === 0 ? ' none' : ''}`);
  for (const [flow, entry] of entries) {
    const ran = result.flows.find(f => f.name === flow);
    lines.push(
      `    ${flow} — ${entry.reason}`,
      `          link: ${entry.link}`,
      `          lift when: ${entry.lift}`,
      `          added: ${entry.added}`,
      `          this run: ${ran ? ran.status : 'not driven'}`,
    );
  }
  return lines.join('\n');
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${toErrorMessage(err)}\n`);
      process.exit(1);
    });
}
