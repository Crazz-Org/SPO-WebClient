/**
 * Assembling a `BugReport` and depositing it.
 *
 * Deliberately thin. The one thing worth saying about it is `createdAtUtc`: UTC to the
 * millisecond is the key that lets a triage session grep
 * `FIVEMODELSERVER/Survival <date>.log` at http://158.69.153.134/logs/ and prove whether the
 * frame reached the object server-side. Without it triage can only guess.
 *
 * What this module does NOT do is correlate element → store → message. That is expensive and
 * brittle here; the triage session does it better by reading `src/client/handlers/` and
 * `src/client/store/` against the verbatim journal.
 */

import {
  BUG_REPORT_SCHEMA_VERSION,
  computeAnchorKey,
  MAX_BODY_BYTES,
  type BugReport,
  type BugReportKind,
  type BugReportProfile,
  type GeometryCapture,
  type MobileQuickPick,
  type ReportAnchor,
  type SessionContext,
} from '../../shared/bug-report-schema';
import { reportJournal } from './journal';

export const BUG_REPORT_ENDPOINT = '/api/bug-report';

export interface ReportDraft {
  profile: BugReportProfile;
  kind: BugReportKind;
  anchor: ReportAnchor;
  username: string;
  world: string;
  observed?: string;
  expected?: string;
  quickPicks?: MobileQuickPick[];
  freeText?: string;
  geometry?: GeometryCapture;
  sessionContext?: SessionContext;
}

/** Drop the keys the schema would rather not see at all than see empty. */
function withoutEmpty<T extends Record<string, unknown>>(value: T): T {
  const out = {} as Record<string, unknown>;
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined && v !== '') out[key] = v;
  }
  return out as T;
}

/**
 * Room kept for the `trimmed` marker, which the trim itself adds to the report.
 *
 * `,"trimmed":{"journalDropped":400,"screenshotDropped":true}` is 58 characters at its
 * longest; trimming to a slightly lower target is what stops the marker from pushing a
 * just-fitting report back over the cap.
 */
const TRIM_MARKER_BYTES = 64;

/**
 * UTF-8 byte length — what `MAX_BODY_BYTES`, nginx's `client_max_body_size` and the gateway's
 * own `Buffer`-counting check all actually measure. `String.length` counts UTF-16 code units and
 * undercounts any accented, CJK or emoji character by 2–4×; `freeText` is documented as possibly
 * French, so this is the ordinary case, not the exotic one (#864).
 */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Bring a report under the transport's body cap, and record what that cost.
 *
 * Every per-field limit is enforced on its own and they do not sum below `MAX_BODY_BYTES`:
 * `MAX_JOURNAL_ENTRIES` × `MAX_WS_PAYLOAD_BYTES` is 6.4 MB before the 3 MB screenshot is
 * counted at all. Over the cap the gateway answers 413 and the report is lost — and since the
 * journal fills by itself, no gesture a human could make would avoid it (#269).
 *
 * Oldest journal entries go first and the screenshot only if emptying the journal was not
 * enough, so a canvas report keeps the picture it was filed about. Sizes are measured once per
 * entry, in UTF-8 bytes — matching `MAX_BODY_BYTES` and the gateway's own byte count — rather
 * than by re-serializing the whole report after each drop: this runs on the main thread of the
 * browser of the person already looking at a bug.
 */
function fitToBodyCap(report: BugReport): BugReport {
  let size = utf8Bytes(JSON.stringify(report));
  if (size <= MAX_BODY_BYTES) return report;

  const target = MAX_BODY_BYTES - TRIM_MARKER_BYTES;
  let journalDropped = 0;
  while (size > target && report.journal.length > 0) {
    // An entry costs its own serialization, plus the comma before the next one when there is
    // one. Counting the comma only while it exists keeps the running total exact.
    const entry = utf8Bytes(JSON.stringify(report.journal[0]));
    size -= report.journal.length > 1 ? entry + 1 : entry;
    report.journal.shift();
    journalDropped++;
  }

  const anchor = report.anchor;
  const screenshotDropped = size > target
    && anchor.kind === 'canvas'
    && anchor.screenshotDataUrl !== undefined;
  if (screenshotDropped && anchor.kind === 'canvas') {
    // Rebuilt rather than deleted through: `anchor` is still the caller's own draft object,
    // and building a report must not empty the draft it was built from.
    const { screenshotDataUrl: _dropped, ...kept } = anchor;
    report.anchor = kept;
  }

  report.trimmed = { journalDropped, screenshotDropped };
  return report;
}

/** A complete report, ready to POST. Split out so tests can assert on it without a fetch. */
export function buildReport(draft: ReportDraft): BugReport {
  const viewport = typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

  const report = withoutEmpty({
    version: BUG_REPORT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    profile: draft.profile,
    kind: draft.kind,
    createdAtUtc: new Date().toISOString(),
    username: draft.username,
    world: draft.world,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    viewport,
    anchor: draft.anchor,
    anchorKey: computeAnchorKey(draft.anchor),
    observed: draft.observed,
    expected: draft.expected,
    quickPicks: draft.quickPicks,
    freeText: draft.freeText,
    geometry: draft.geometry,
    sessionContext: draft.sessionContext,
    journal: reportJournal.snapshot(),
  }) as BugReport;

  return fitToBodyCap(report);
}

export interface SubmitOutcome {
  ok: boolean;
  /** The queue filename on success, the gateway's reason on failure. */
  detail: string;
}

/** POST the report. Never throws — the caller surfaces the outcome as a toast. */
export async function submitReport(draft: ReportDraft): Promise<SubmitOutcome> {
  const report = buildReport(draft);
  try {
    const response = await fetch(BUG_REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    const body = (await response.json().catch(() => ({}))) as { file?: string; error?: string };
    return response.ok
      ? { ok: true, detail: body.file ?? report.id }
      : { ok: false, detail: body.error ?? `HTTP ${response.status}` };
  } catch (err: unknown) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
