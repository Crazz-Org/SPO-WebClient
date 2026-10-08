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
import { GATE_ONLY, SERVER_QUARANTINE, type ServerQuarantine } from './routing';
import { WorldLock } from './world-lock';

/**
 * Exit codes — matches `EXIT` in scripts/verify-gate.js, and read the same way by
 * `worker.ts`'s `GATE_EXIT_VERDICT`: 0 PASS, 1 FAIL, 2 BLOCKED (refused before driving
 * anything — a dirty world or another live run already in flight — or a flow ended SKIPPED,
 * the second account refused at login — or, with an explicit `--flows`, a flow ended
 * UNTESTABLE), 3 ENVIRONMENT (a
 * preflight abort; does not consume an attempt, doc/E2E-POLICY.md §8).
 */
const EXIT: Readonly<Record<LiveRunResult['status'], number>> = {
  PASS: 0,
  FAIL: 1,
  BLOCKED: 2,
  ENVIRONMENT: 3,
};

/** What the nightly attaches to a SERVER_QUARANTINE flow's result (doc/E2E-POLICY.md §7). */
export type QuarantineMark = Pick<ServerQuarantine, 'reason' | 'link' | 'lift'>;

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
  /** A quarantined flow keeps its real status; the nightly marks it (see {@link main}). */
  flows: Array<FlowResult & { quarantined?: QuarantineMark }>;
  /** What the server says the test account may do — read-only, gathered before the flows. */
  capabilities: CapabilityEvidence[];
  error?: string;
  /** Set when releasing the world lock threw — the world is left dirty, which always FAILs. */
  releaseError?: string;
  /**
   * Set when a SIGTERM stopped the drive (#1328): the flows after the in-flight one are SKIPPED
   * with {@link STOPPED_BY_DEADLINE}. Never reported PASS, nightly or not.
   */
  stopped?: true;
}

/** The `skipped` detail of a flow a SIGTERM kept from starting (#1328). */
export const STOPPED_BY_DEADLINE = 'stopped by deadline';

function notRun(name: string): FlowResult {
  return {
    name,
    status: 'SKIPPED',
    skipped: STOPPED_BY_DEADLINE,
    assertions: [],
    untestable: [],
    probes: [],
    messagesSent: 0,
    messagesReceived: 0,
    wireErrors: 0,
  };
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

  // A deadline kill sends SIGTERM, then SIGKILL after a grace (#1328). The first SIGTERM only
  // asks the drive to stop: the in-flight flow finishes — its restore included — no new flow
  // starts, and the lock is released as on a normal end. A second SIGTERM is not swallowed:
  // the handler steps aside and re-raises it, so the process ends as it would with no handler.
  let stopRequested = false;
  const onSigterm = (): void => {
    if (stopRequested) {
      process.removeListener('SIGTERM', onSigterm);
      process.kill(process.pid, 'SIGTERM');
      return;
    }
    stopRequested = true;
    process.stderr.write(`stop requested — finishing ${inProgress}\n`);
  };
  process.on('SIGTERM', onSigterm);

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
        if (stopRequested) {
          results.push(notRun(name));
          continue;
        }
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
      // A stopped drive is never a PASS, even when the stop landed during its last flow.
      status: failed ? 'FAIL' : skippedFlows.length > 0 || stopRequested ? 'BLOCKED' : 'PASS',
      preflight: checks,
      flows: results,
      capabilities,
      error: releaseError ?? skipError ?? (stopRequested ? 'stopped by SIGTERM before the drive settled' : undefined),
      ...(releaseError !== undefined ? { releaseError } : {}),
      ...(stopRequested ? { stopped: true as const } : {}),
    };
  } finally {
    process.removeListener('beforeExit', onDrain);
    process.removeListener('SIGTERM', onSigterm);
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
  if (named !== undefined && named.length === 0) {
    throw new Error('--flows= names no flow — name at least one (e.g. --flows=login-spine), or omit --flows for the nightly set');
  }
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
  // The nightly (no --flows) records a skip and does not fail on it: a run BLOCKED only by
  // SKIPPED flows is reported PASS, the skips listed. An explicit --flows — a card's proof —
  // stays BLOCKED: a card cannot prove a flow that did not run. The lock-refusal BLOCK carries
  // no flows, and a skip beside a failure is already FAIL, so this test is exact.
  //
  // The nightly also absorbs a SERVER_QUARANTINE flow's FAIL (doc/E2E-POLICY.md §7): each such
  // flow keeps its real status and is marked, and a run whose only FAILs are quarantined flows
  // is PASS. A dirty world (releaseError) or any other FAIL still FAILs. An explicit --flows
  // drives and judges a quarantined flow like any other.
  //
  // An explicit --flows is a card proving its own flows: a named flow that ended UNTESTABLE
  // observed nothing and proved nothing, so that run is BLOCKED (exit 2), the flow named (#1184).
  // The nightly keeps the #1320 rule — UNTESTABLE is listed and never changes the verdict.
  // runLive and the gate (verify-gate.js calls runLive, not main) are untouched.
  const nightly = named === undefined;
  const flowResults = nightly
    ? result.flows.map(flow => {
        const entry = SERVER_QUARANTINE[flow.name];
        return entry ? { ...flow, quarantined: { reason: entry.reason, link: entry.link, lift: entry.lift } } : flow;
      })
    : result.flows;
  const fails = flowResults.filter(f => f.status === 'FAIL');
  // A run a SIGTERM stopped short (#1328) is never absorbed: the flows it did not reach are not a pass.
  const absorbed =
    nightly &&
    result.stopped === undefined &&
    result.status === 'FAIL' &&
    result.releaseError === undefined &&
    fails.length > 0 &&
    fails.every(f => f.name in SERVER_QUARANTINE);
  const reported: LiveRunResult =
    absorbed ||
    (nightly && result.stopped === undefined && result.status === 'BLOCKED' && result.flows.some(f => f.status === 'SKIPPED'))
      ? { ...result, flows: flowResults, status: 'PASS' }
      : { ...result, flows: flowResults };
  const untestable = nightly ? [] : reported.flows.filter(f => f.status === 'UNTESTABLE');
  const judged: LiveRunResult =
    untestable.length > 0 && (reported.status === 'PASS' || reported.status === 'BLOCKED')
      ? {
          ...reported,
          status: 'BLOCKED',
          error: [
            reported.error,
            `untestable — a flow named by --flows that observed nothing is not a proof: ${untestable
              .map(f => `${f.name} (${f.untestable.join('; ')})`)
              .join('; ')}`,
          ]
            .filter(Boolean)
            .join(' | '),
        }
      : reported;
  const file = path.join(REPORT_DIR, `live-${judged.startedAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(judged, null, 2)}\n`, 'utf8');

  const notDriven = skipped.map(n => `  gate-only, not driven: ${n} — ${GATE_ONLY[n]}`);
  out.write(`${[formatSummary(judged, SERVER_QUARANTINE), ...notDriven].join('\n')}\nArtifact: ${file}\n`);
  return EXIT[judged.status];
}

/**
 * The run's summary. With a quarantine table, a `Server quarantine (N):` block lists every entry
 * and the flow's real outcome in this run — printed on every run, passing or not.
 */
export function formatSummary(result: LiveRunResult, quarantine: Record<string, ServerQuarantine> = {}): string {
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
    // Every reason, flow and probe alike (report() folds an UNTESTABLE probe's note in): the job
    // log is this output, so the reason lands in the run log on every run.
    for (const reason of flow.untestable) lines.push(`          ? untestable: ${reason}`);
    for (const probe of flow.probes) {
      lines.push(
        `          probe ${probe.status}: ${probe.what} — log=${probe.logLine ? 'yes' : 'NO'}, ` +
          `readBack=${probe.readBack}, restored=${probe.restored}`,
      );
    }
  }
  const entries = Object.entries(quarantine);
  if (entries.length > 0) {
    lines.push(`Server quarantine (${entries.length}):`);
    for (const [flow, entry] of entries) {
      const ran = result.flows.find(f => f.name === flow);
      lines.push(
        `  ${flow} — ${entry.reason} | link: ${entry.link} | lift: ${entry.lift} | added: ${entry.added} | ` +
          `this run: ${ran ? ran.status : 'not run'}`,
      );
    }
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
