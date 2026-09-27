/**
 * The bug-report contract — the one shape the capture code, the deposit endpoint and the
 * later `/triage-report` session all agree on.
 *
 * Serves dev/test sessions — the maintainer flags an element and a JSON report lands in a
 * local queue — and, in `player` mode (`SPO_BUG_REPORT=player`), production players. Both profiles (desktop and mobile) are described here from day one
 * on purpose, so the mobile capture never forces a v2 of the schema.
 *
 * Validation is a hand-written type guard — no schema library, no new dependency.
 *
 * ⚠ The deposit filename is built from three values that come off the wire
 * (`createdAtUtc`, `profile`, `anchorKey`). `validateBugReport` is what stops a crafted one
 * from escaping the queue directory: the first must be strict ISO 8601, the second is a
 * closed union, the third is lowercase hex. Nothing downstream re-checks them.
 */

export const BUG_REPORT_SCHEMA_VERSION = 1;

/** Journal entries kept per report. */
export const MAX_JOURNAL_ENTRIES = 400;
/** A serialized `ws-in` / `ws-out` payload above this is cut and flagged `truncated`. */
export const MAX_WS_PAYLOAD_BYTES = 16 * 1024;
/** Cap on every free-form string a human or the DOM can supply. */
export const MAX_TEXT_LENGTH = 2000;
/** Cap on the canvas screenshot data URL. */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 3 * 1024 * 1024;
/** Cap on the whole POST body, enforced by the transport before this module sees it. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Ancestors captured above the flagged element. */
export const MAX_GEOMETRY_ELEMENTS = 8;

/** UTC, millisecond precision, no offset form — the shape that is safe in a filename. */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Lowercase hex, nothing else — no separator can appear in a filename through this. */
const HEX_ONLY = /^[0-9a-f]+$/;

export type BugReportProfile = 'desktop' | 'mobile';
/**
 * `suggestion` is deliberately not a defect kind: "the thing I'm pointing at works, but could be
 * better" — never inferred, always the reporter's own explicit pick (the desktop kind button,
 * the mobile `could-be-better` quick pick). It is what lets a preference reach the board through
 * this channel at all — see `MobileQuickPick`'s own comment and the pipeline-side
 * `triage-bug-report.md`/`review-card.md` for what changes once a maintainer confirms one.
 */
export type BugReportKind = 'wrong-data' | 'broken-action' | 'visual' | 'suggestion';
export type MobileQuickPick =
  | 'too-small' | 'covered' | 'out-of-reach'
  | 'cut-off' | 'no-response' | 'wrong-data'
  /** "This works, but could be better" — see `BugReportKind`'s `suggestion` value. */
  | 'could-be-better';

export type JournalEntry =
  | { t: 'click'; ts: number; target: string; text?: string }
  | { t: 'surface'; ts: number; action: 'push' | 'pop' | 'root' | 'clear'; surface: string }
  | { t: 'ws-out'; ts: number; msgType: string; payload: unknown; truncated?: boolean }
  | { t: 'ws-in'; ts: number; msgType: string; payload: unknown; truncated?: boolean }
  | { t: 'console'; ts: number; level: 'error' | 'warn'; message: string };

export interface DomAnchor {
  kind: 'dom';
  /** React component chain, outermost first: ["GameScreen","PoliticsPanel","TaxRow","button"]. */
  componentChain: string[];
  /** CSS selector chain - always present; the sole anchor when the fiber walk failed. */
  cssChain: string;
  /** element.textContent, trimmed, max 500 chars. */
  text: string;
}

export interface CanvasAnchor {
  kind: 'canvas';
  tileX: number;
  tileY: number;
  buildingId?: number;
  visualClass?: string;
  layer: 'building' | 'road' | 'concrete' | 'terrain';
  /** JPEG data URL (quality 0.7) - canvas reports only. */
  screenshotDataUrl?: string;
}

export type ReportAnchor = DomAnchor | CanvasAnchor;

export interface ElementGeometry {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: {
    fontSize: string; padding: string; overflow: string;
    position: string; zIndex: string; transform: string;
  };
  /** The flagged element only (never an ancestor) — same fiber-walk `dom-anchor.ts` already
   * uses for desktop, so mobile triage can locate the owning component the same way. */
  componentChain?: string[];
}

/**
 * A cheap fingerprint of what the player was doing, read synchronously from the stores at
 * flag-time — a second correlation axis into the server log, independent of clock skew between
 * `createdAtUtc` and the log's own timestamps.
 */
export interface SessionContext {
  /** The in-game date (ISO), or null if the client had not received one yet. */
  gameDate: string | null;
  /** The top of the UI surface stack at flag-time — same value the journal's own `surface`
   * events use, so it reads consistently against the journal. */
  surface: string | null;
}

export interface GeometryCapture {
  /** The flagged element first, then each ancestor up to body (max 8). */
  elements: ElementGeometry[];
  /** CSS chain of the node covering the element's own centre, or null. */
  occludedBy: string | null;
  /** Pixels by which the element escapes its nearest scroll/clip parent, per edge. */
  overflowParent: { top: number; right: number; bottom: number; left: number } | null;
  viewport: { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  devicePixelRatio: number;
  /** window.visualViewport.height - smaller than viewport.height means keyboard open. */
  visualViewportHeight: number | null;
  safeAreaInsets: { top: number; right: number; bottom: number; left: number };
}

/**
 * What the aggregate body budget had to throw away.
 *
 * Present only on a report that was actually cut, so its absence means "nothing was lost".
 * Without it a triage session cannot tell a quiet 60 seconds from a journal that was
 * amputated to fit the transport (#269).
 */
export interface ReportTrim {
  /** Journal entries dropped from the oldest end. */
  journalDropped: number;
  /** Whether the canvas screenshot had to go as well. */
  screenshotDropped: boolean;
}

export interface BugReport {
  version: typeof BUG_REPORT_SCHEMA_VERSION;
  id: string;                       // crypto.randomUUID()
  profile: BugReportProfile;
  kind: BugReportKind;
  /** UTC, millisecond precision, ISO 8601 - the key into FIVEMODELSERVER/Survival logs. */
  createdAtUtc: string;
  /** Stamped by the gateway on deposit, never by the client. */
  receivedAtUtc?: string;
  username: string;
  world: string;
  userAgent: string;
  /** The client build the report came from (package version). Optional — absent on reports
   *  from builds that predate it, so no schema-version bump. */
  appVersion?: string;
  viewport: { width: number; height: number };
  anchor: ReportAnchor;
  /** Stable dedup key: djb2 hex of componentChain+text (dom) or tile+layer (canvas). */
  anchorKey: string;
  observed?: string;                // desktop: pre-filled from textContent
  expected?: string;                // desktop: typed by the human
  quickPicks?: MobileQuickPick[];   // mobile
  /** Optional on both profiles. May be French; triage translates. */
  freeText?: string;
  geometry?: GeometryCapture;       // mobile only
  /** Both profiles — read synchronously from the stores at flag-time. */
  sessionContext?: SessionContext;
  /** Last ~60 s, oldest first. */
  journal: JournalEntry[];
  /** Set by the capture only when the report had to be cut to fit `MAX_BODY_BYTES`. */
  trimmed?: ReportTrim;
}

const PROFILES: readonly string[] = ['desktop', 'mobile'];
const KINDS: readonly string[] = ['wrong-data', 'broken-action', 'visual', 'suggestion'];
const QUICK_PICKS: readonly string[] = [
  'too-small', 'covered', 'out-of-reach', 'cut-off', 'no-response', 'wrong-data', 'could-be-better',
];
const CANVAS_LAYERS: readonly string[] = ['building', 'road', 'concrete', 'terrain'];
const SURFACE_ACTIONS: readonly string[] = ['push', 'pop', 'root', 'clear'];
const CONSOLE_LEVELS: readonly string[] = ['error', 'warn'];

/**
 * djb2, as unsigned 32-bit, rendered lowercase hex.
 *
 * The hex rendering is not cosmetic: it is what makes the key safe to concatenate into a
 * filename, and `validateBugReport` re-checks that shape on the way in.
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/** The dedup key two reports of the same problem share. */
export function computeAnchorKey(anchor: ReportAnchor): string {
  return anchor.kind === 'dom'
    ? djb2Hex(`dom|${anchor.componentChain.join('>')}|${anchor.text}`)
    : djb2Hex(`canvas|${anchor.tileX},${anchor.tileY}|${anchor.layer}`);
}

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function checkAnchor(anchor: unknown): string | null {
  if (!isRec(anchor)) return 'anchor must be an object';
  if (anchor.kind === 'dom') {
    if (!isStringArray(anchor.componentChain)) return 'anchor.componentChain must be an array of strings';
    if (!isBoundedString(anchor.cssChain, MAX_TEXT_LENGTH)) return 'anchor.cssChain must be a string of at most 2000 chars';
    if (!isBoundedString(anchor.text, MAX_TEXT_LENGTH)) return 'anchor.text must be a string of at most 2000 chars';
    return null;
  }
  if (anchor.kind === 'canvas') {
    if (!isFiniteNumber(anchor.tileX) || !isFiniteNumber(anchor.tileY)) return 'anchor.tileX/tileY must be finite numbers';
    if (!CANVAS_LAYERS.includes(anchor.layer as string)) return 'anchor.layer is not a known layer';
    if (anchor.buildingId !== undefined && !isFiniteNumber(anchor.buildingId)) return 'anchor.buildingId must be a number';
    if (anchor.visualClass !== undefined && !isBoundedString(anchor.visualClass, MAX_TEXT_LENGTH)) return 'anchor.visualClass must be a bounded string';
    if (anchor.screenshotDataUrl !== undefined && !isBoundedString(anchor.screenshotDataUrl, MAX_SCREENSHOT_DATA_URL_LENGTH)) {
      return 'anchor.screenshotDataUrl must be a string of at most 3 MB';
    }
    return null;
  }
  return 'anchor.kind must be "dom" or "canvas"';
}

function checkJournalEntry(entry: unknown, index: number): string | null {
  if (!isRec(entry)) return `journal[${index}] must be an object`;
  if (!isFiniteNumber(entry.ts)) return `journal[${index}].ts must be a finite number`;
  switch (entry.t) {
    case 'click':
      if (!isBoundedString(entry.target, MAX_TEXT_LENGTH)) return `journal[${index}].target must be a bounded string`;
      if (entry.text !== undefined && !isBoundedString(entry.text, MAX_TEXT_LENGTH)) return `journal[${index}].text must be a bounded string`;
      return null;
    case 'surface':
      if (!SURFACE_ACTIONS.includes(entry.action as string)) return `journal[${index}].action is not a known surface action`;
      if (!isBoundedString(entry.surface, MAX_TEXT_LENGTH)) return `journal[${index}].surface must be a bounded string`;
      return null;
    case 'ws-in':
    case 'ws-out':
      if (!isBoundedString(entry.msgType, MAX_TEXT_LENGTH)) return `journal[${index}].msgType must be a bounded string`;
      if (JSON.stringify(entry.payload ?? null).length > MAX_WS_PAYLOAD_BYTES) {
        return `journal[${index}].payload exceeds 16 KB — the capture must cut it and set truncated`;
      }
      return null;
    case 'console':
      if (!CONSOLE_LEVELS.includes(entry.level as string)) return `journal[${index}].level must be "error" or "warn"`;
      if (!isBoundedString(entry.message, MAX_TEXT_LENGTH)) return `journal[${index}].message must be a bounded string`;
      return null;
    default:
      return `journal[${index}].t is not a known entry kind`;
  }
}

function checkOptionalText(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  return isBoundedString(value, MAX_TEXT_LENGTH) ? null : `${field} must be a string of at most 2000 chars`;
}

/**
 * The single gate between the wire and the queue directory.
 *
 * Returns the report unchanged on success — it does not clamp or repair, because a report
 * that broke a documented limit is a capture bug worth seeing, not something to paper over.
 */
export function validateBugReport(
  value: unknown,
): { ok: true; report: BugReport } | { ok: false; error: string } {
  if (!isRec(value)) return { ok: false, error: 'report must be an object' };

  if (value.version !== BUG_REPORT_SCHEMA_VERSION) {
    return { ok: false, error: `version must be ${BUG_REPORT_SCHEMA_VERSION}` };
  }
  if (!isBoundedString(value.id, MAX_TEXT_LENGTH) || value.id.length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (!PROFILES.includes(value.profile as string)) {
    return { ok: false, error: 'profile must be "desktop" or "mobile"' };
  }
  if (!KINDS.includes(value.kind as string)) {
    return { ok: false, error: 'kind is not a known bug-report kind' };
  }
  // Filename component #1 — anything but strict ISO 8601 could carry a path separator.
  if (typeof value.createdAtUtc !== 'string' || !ISO_UTC_MS.test(value.createdAtUtc)) {
    return { ok: false, error: 'createdAtUtc must be strict ISO 8601 UTC (YYYY-MM-DDTHH:mm:ss.sssZ)' };
  }
  // Filename component #3 — lowercase hex only, for the same reason.
  if (typeof value.anchorKey !== 'string' || !HEX_ONLY.test(value.anchorKey)) {
    return { ok: false, error: 'anchorKey must be lowercase hex' };
  }
  for (const field of ['username', 'world', 'userAgent'] as const) {
    if (!isBoundedString(value[field], MAX_TEXT_LENGTH)) {
      return { ok: false, error: `${field} must be a string of at most 2000 chars` };
    }
  }
  if (!isRec(value.viewport) || !isFiniteNumber(value.viewport.width) || !isFiniteNumber(value.viewport.height)) {
    return { ok: false, error: 'viewport must carry finite width and height' };
  }

  const anchorError = checkAnchor(value.anchor);
  if (anchorError) return { ok: false, error: anchorError };

  for (const field of ['observed', 'expected', 'freeText', 'appVersion'] as const) {
    const error = checkOptionalText(value[field], field);
    if (error) return { ok: false, error };
  }

  if (value.quickPicks !== undefined) {
    if (!Array.isArray(value.quickPicks) || !value.quickPicks.every(q => QUICK_PICKS.includes(q as string))) {
      return { ok: false, error: 'quickPicks must be an array of known quick picks' };
    }
  }
  if (value.geometry !== undefined && !isRec(value.geometry)) {
    return { ok: false, error: 'geometry must be an object' };
  }
  if (value.sessionContext !== undefined) {
    const ctx = value.sessionContext;
    if (!isRec(ctx)) return { ok: false, error: 'sessionContext must be an object' };
    if (ctx.gameDate !== null && !isBoundedString(ctx.gameDate, MAX_TEXT_LENGTH)) {
      return { ok: false, error: 'sessionContext.gameDate must be a string or null' };
    }
    if (ctx.surface !== null && !isBoundedString(ctx.surface, MAX_TEXT_LENGTH)) {
      return { ok: false, error: 'sessionContext.surface must be a string or null' };
    }
  }

  if (!Array.isArray(value.journal)) return { ok: false, error: 'journal must be an array' };
  if (value.journal.length > MAX_JOURNAL_ENTRIES) {
    return { ok: false, error: `journal must hold at most ${MAX_JOURNAL_ENTRIES} entries` };
  }
  for (let i = 0; i < value.journal.length; i++) {
    const entryError = checkJournalEntry(value.journal[i], i);
    if (entryError) return { ok: false, error: entryError };
  }

  if (value.trimmed !== undefined) {
    const trimmed = value.trimmed;
    if (!isRec(trimmed) || !isFiniteNumber(trimmed.journalDropped) || trimmed.journalDropped < 0) {
      return { ok: false, error: 'trimmed.journalDropped must be a count' };
    }
    if (typeof trimmed.screenshotDropped !== 'boolean') {
      return { ok: false, error: 'trimmed.screenshotDropped must be a boolean' };
    }
  }

  return { ok: true, report: value as unknown as BugReport };
}
