/**
 * The round trip — doc/E2E-POLICY.md §5.
 *
 *   read original -> record the pending restore -> write test value
 *                 -> poll the read-back until it shows the value (up to the spec's bound)
 *                 -> assert the model-server log line (marker + match)
 *                 -> restore original (always, even after a throw)
 *                 -> poll the read-back until it shows the original
 *                 -> clear the pending restore
 *
 * A crash is a failure, but silence is not a pass. `OB-28` is a write reported confirmed
 * when it was discarded, so "the response said success" proves nothing on its own. The log
 * line proves receipt only — most handlers log before their owner check, so a refused write
 * prints its line too. The read-back proves the change: one that never shows the written
 * value within its bound FAILs, even with the line present. A log line that cannot be found or
 * read while the read-back confirms the value is UNTESTABLE — not observable, never a failure
 * (maintainer decision 2026-10-05, doc/E2E-POLICY.md §5).
 */

import { randomUUID } from 'crypto';
import { toErrorMessage } from '../shared/error-utils';
import { TIMEOUTS } from './config';
import { LOG_MARKERS, awaitMarker, openLogWindow, type LogWindow } from './live-log';
import { readSectionGroups, setBuildingProperty, propertyValue, type LiveSession } from './session';
import type { PendingRestore, WorldLock } from './world-lock';
import { sleep as defaultSleep } from './sleep';

export interface ProbeSpec {
  /** Human label for the report. */
  what: string;
  /** RDO member the write goes through — selects the log marker. */
  member: keyof typeof LOG_MARKERS | string;
  x: number;
  y: number;
  visualClass: string;
  /** Where the current value is read from. */
  groupId: string;
  readProperty: string;
  /** What the gateway is asked to write. */
  writeProperty: string;
  additionalParams?: Record<string, string>;
  /** Test value derived from the original, so the probe never hardcodes world state. */
  testValue: (original: string) => string;
  /**
   * Restore to this value, never to a value re-read now. When set, the round trip's original
   * is this fixed string; the read-back polls still read the live value.
   */
  original?: string;
  /** Extra condition on the proving log line — its identifying fields (town, id, value). */
  logMatch?: (line: string, written: string) => boolean;
}

export type ReadBackVerdict = 'CONFIRMED' | 'UNCONFIRMED';

export interface ProbeResult {
  what: string;
  member: string;
  /** `UNTESTABLE`: the read-back confirmed, but the log line could not be found or read. */
  status: 'PASS' | 'FAIL' | 'UNTESTABLE';
  original: string;
  written: string;
  /** The proving line from FIVEMODELSERVER's Survival log, or null if it never appeared. */
  logLine: string | null;
  readBack: ReadBackVerdict;
  /** Whether the restore's own read-back reached the original. */
  restoreReadBack?: ReadBackVerdict;
  restored: boolean;
  note?: string;
}

/** The channel that proves the change. Required on every round trip. */
export interface ReadBackProof {
  /** The channel, e.g. "townTaxes.Tax0Percent via the gateway's section read". */
  source: string;
  /** Why that channel is authoritative. */
  why: string;
  read: () => Promise<string | undefined>;
  /** How long the poll may wait for the value before the round trip FAILs. */
  boundMs: number;
  /** Gap between polls; defaults to `TIMEOUTS.readBackPoll`. */
  pollMs?: number;
  /** A documented server quantisation, applied to both sides of the comparison. */
  normalise?: (value: string) => string;
  /**
   * A documented server rounding that equality cannot express (e.g. a `ceil` on the read side).
   * When set it replaces the equality (and `normalise`) in both polls; `expected` is the value
   * written, or the original on the restore poll.
   */
  matches?: (last: string, expected: string) => boolean;
}

/** The log line proving receipt: it must contain `marker` and satisfy `match` when given. */
export interface RoundTripLogProof {
  marker: string;
  match?: (line: string, written: string) => boolean;
}

export interface RoundTripSpec {
  /** The target — town or facility, and the id / row / rating. */
  what: string;
  member: string;
  read: () => Promise<string | undefined>;
  write: (value: string) => Promise<void>;
  /** Defaults to `write(original)`. */
  restore?: (original: string) => Promise<void>;
  testValue: (original: string) => string;
  /** `readBack` is required by the type; `log` is required when the member has a marker. */
  proof: { readBack: ReadBackProof; log?: RoundTripLogProof };
  /** Building fields folded into the pending restore, so the dirty report reads as before. */
  restoreRecord?: Pick<PendingRestore, 'x' | 'y' | 'propertyName' | 'additionalParams'>;
}

export interface RoundTripClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Longest original shown in the pending restore's `what` — a base64 portrait is not. */
const SHOWN_ORIGINAL_MAX = 64;

/**
 * Run one round trip. Always attempts the restore, including after a failed proof or a
 * throw — a failing round trip must not be the reason the world is left dirty. The restore
 * read-back is polled even when the restore write throws: only a read-back that confirms the
 * original clears the pending restore (a server that refused both writes left the world
 * unchanged), and the probe still FAILs.
 */
export async function runRoundTrip(
  spec: RoundTripSpec,
  lock: WorldLock,
  logWindowFactory: (url: string) => Promise<LogWindow>,
  logUrl: string,
  clock: RoundTripClock = {},
): Promise<ProbeResult> {
  const known = LOG_MARKERS[spec.member];
  const log = spec.proof.log;
  if (known && !log) {
    throw new Error(
      `${spec.member} has a model-server log marker but the spec has no log part — a round ` +
        `trip cannot pick read-back alone to dodge the log line.`,
    );
  }
  if (known && log && log.marker !== known) {
    throw new Error(
      `${spec.member}'s log marker is "${known}" (LOG_MARKERS) but the spec asks for ` +
        `"${log.marker}" — the proof must use the cited marker.`,
    );
  }

  const original = await spec.read();
  if (original === undefined) {
    throw new Error(
      `Cannot read the original value of ${spec.what} — nothing to restore to, so the probe ` +
        `refuses to write.`,
    );
  }

  const written = spec.testValue(original);
  // A log that cannot be opened is a reason the line is unobservable, not a failed write.
  let logFault: string | null = null;
  let window: LogWindow | null = null;
  if (log) {
    try {
      window = await logWindowFactory(logUrl);
    } catch (err: unknown) {
      logFault = `the log window could not be opened: ${toErrorMessage(err)}`;
    }
  }

  const key = `${spec.member}:${randomUUID()}`;
  const shown =
    original.length > SHOWN_ORIGINAL_MAX ? `${original.slice(0, SHOWN_ORIGINAL_MAX)}…` : original;
  lock.addPendingRestore({
    key,
    what: `${spec.what} — put back "${shown}"`,
    originalValue: original,
    ...spec.restoreRecord,
  });

  const readBack = spec.proof.readBack;
  let logLine: string | null = null;
  let poll: PollOutcome = { verdict: 'UNCONFIRMED', last: undefined };
  let thrown: unknown = null;

  try {
    await spec.write(written);
    // Read-back first: the log window is by byte offset, so the line is still there after
    // the poll, and the poll is what decides the change.
    poll = await pollReadBack(readBack, written, clock);
    if (log && window) {
      const matches = (line: string): boolean =>
        line.includes(log.marker) && (log.match?.(line, written) ?? true);
      try {
        const line = await awaitMarker(window, { marker: log.marker, match: matches }, TIMEOUTS.logSettle);
        // Re-checked here so the rule holds whatever awaitMarker returned.
        logLine = line !== null && matches(line) ? line : null;
      } catch (err: unknown) {
        logFault = `the log could not be read: ${toErrorMessage(err)}`;
      }
    }
  } catch (err: unknown) {
    thrown = err;
  }

  // The restore runs whatever happened above.
  let restoreWriteFailed = false;
  let restorePoll: PollOutcome;
  try {
    await (spec.restore ?? spec.write)(original);
  } catch {
    restoreWriteFailed = true;
  }
  // Polled even after a throwing restore write: the read-back, not the write, says whether
  // the world still holds the original.
  try {
    restorePoll = await pollReadBack(readBack, original, clock);
  } catch {
    restorePoll = { verdict: 'UNCONFIRMED', last: undefined };
  }
  const restored = restorePoll.verdict === 'CONFIRMED';
  const restoreReadBack = restorePoll.verdict;
  if (restored) lock.clearPendingRestore(key);

  if (thrown !== null) {
    return { ...probeFailure(spec, thrown), original, written, restored, restoreReadBack };
  }

  const failures: string[] = [];
  if (poll.verdict === 'UNCONFIRMED') {
    failures.push(
      `read-back never showed "${written}" within ${readBack.boundMs} ms (last ` +
        `"${poll.last ?? '(absent)'}", ${readBack.source}) — the write did not change the value`,
    );
  }
  // The line proves receipt only; with a confirmed read-back its absence is unobservable, not
  // wrong. With an unconfirmed read-back nothing agrees, so it stays a failure.
  let untestable: string | null = null;
  if (log && !logLine) {
    const missing = `no model-server log line "${log.marker}" in ${logUrl}${logFault ? ` (${logFault})` : ''}`;
    if (poll.verdict === 'CONFIRMED') {
      untestable = `${missing} — the read-back confirmed "${written}" (${readBack.source})`;
    } else {
      failures.push(`${missing} — the write never reached the object`);
    }
  }
  if (restoreWriteFailed && restored) {
    failures.push('restore write failed, but the read-back shows the original — the world is unchanged');
  } else if (restoreWriteFailed) {
    failures.push('restore failed — the world is left dirty');
  } else if (!restored) {
    failures.push(
      `restore not confirmed: read-back still shows "${restorePoll.last ?? '(absent)'}" — ` +
        `the world is left dirty`,
    );
  }

  const result: ProbeResult = {
    what: spec.what,
    member: spec.member,
    status: failures.length > 0 ? 'FAIL' : untestable !== null ? 'UNTESTABLE' : 'PASS',
    original,
    written,
    logLine,
    readBack: poll.verdict,
    restoreReadBack,
    restored,
  };
  if (failures.length > 0) result.note = failures.join('; ');
  else if (untestable !== null) result.note = untestable;
  return result;
}

interface PollOutcome {
  verdict: ReadBackVerdict;
  last: string | undefined;
}

/** Read at least once, then every `pollMs` until the value matches or the bound runs out. */
async function pollReadBack(
  proof: ReadBackProof,
  expected: string,
  clock: RoundTripClock,
): Promise<PollOutcome> {
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? defaultSleep;
  const normalise = proof.normalise ?? ((v: string) => v);
  const target = normalise(expected);
  const deadline = now() + proof.boundMs;
  for (;;) {
    const last = await proof.read();
    const confirmed =
      last !== undefined && (proof.matches ? proof.matches(last, expected) : normalise(last) === target);
    if (confirmed) return { verdict: 'CONFIRMED', last };
    if (now() >= deadline) return { verdict: 'UNCONFIRMED', last };
    await sleep(proof.pollMs ?? TIMEOUTS.readBackPoll);
  }
}

/**
 * Run one building-property probe — a thin adapter over `runRoundTrip`, reading through the
 * gateway's section read and writing through `setBuildingProperty`.
 */
export async function runProbe(
  session: LiveSession,
  spec: ProbeSpec,
  lock: WorldLock,
  logWindowFactory: (url: string) => Promise<LogWindow>,
  survivalLogUrl: string,
  options: RoundTripClock & { readBackBoundMs?: number } = {},
): Promise<ProbeResult> {
  const marker = LOG_MARKERS[spec.member];
  if (!marker) {
    throw new Error(
      `No model-server log marker known for ${spec.member}. A mutation with no marker ` +
        `cannot be proven — add one to LOG_MARKERS with its Pascal citation, or do not probe it.`,
    );
  }

  const read = async (): Promise<string | undefined> =>
    propertyValue(
      await readSectionGroups(session, spec.x, spec.y, spec.groupId, spec.visualClass),
      spec.groupId,
      spec.readProperty,
    );
  const write = async (value: string): Promise<void> => {
    await setBuildingProperty(session, spec.x, spec.y, spec.writeProperty, value, spec.additionalParams);
  };

  const fixedOriginal = spec.original;
  return runRoundTrip(
    {
      what: spec.what,
      member: spec.member,
      read: fixedOriginal !== undefined ? async () => fixedOriginal : read,
      write,
      testValue: spec.testValue,
      proof: {
        log: { marker, match: spec.logMatch },
        readBack: {
          source: `${spec.groupId}.${spec.readProperty} at (${spec.x},${spec.y}) via the gateway's section read`,
          why:
            "the facility's object-cache entry refreshes within its two-minute TTL " +
            '(Kernel/Population.pas:1192, OB-29); the poll waits the lag out',
          read,
          boundMs: options.readBackBoundMs ?? TIMEOUTS.readBack,
        },
      },
      restoreRecord: {
        x: spec.x,
        y: spec.y,
        propertyName: spec.writeProperty,
        additionalParams: spec.additionalParams,
      },
    },
    lock,
    logWindowFactory,
    survivalLogUrl,
    options,
  );
}

/** Wrap an unexpected throw into a reportable failure without losing the reason. */
export function probeFailure(spec: { what: string; member: string }, err: unknown): ProbeResult {
  return {
    what: spec.what,
    member: spec.member,
    status: 'FAIL',
    original: '',
    written: '',
    logLine: null,
    readBack: 'UNCONFIRMED',
    restored: false,
    note: toErrorMessage(err),
  };
}

export { openLogWindow };
