/**
 * The deposit half of the in-app bug reporter, open to logged-in players when `SPO_BUG_REPORT`
 * is `true` or `player`: a POSTed report becomes a file in a local queue that a later
 * `/triage-report` session turns into kanban cards. Four guards stand in front of the write:
 * the connection's ticket (`bug-report-tickets.ts`), a per-session cap, a total queue cap,
 * and a scrub of passwords and other players' messages from the journal.
 *
 * The logic lives here rather than inline in `server.ts` because that module binds sockets
 * at import time, so no test can load it. `src/server/__tests__/cache-endpoint.test.ts`
 * works around that by re-implementing the route under test; this module exists so the
 * behaviour is tested for real instead of mirrored.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateBugReport, MAX_BODY_BYTES, type BugReport, type JournalEntry } from '../shared/bug-report-schema';
import { toErrorMessage } from '../shared/error-utils';
import { WsMessageType } from '../shared/types';
import { readTicketCookie, type ReportTicketRegistry, type ReporterIdentity } from './bug-report-tickets';

/**
 * Deliberately outside the worktree: `npm run finish` retires worktrees, and a queue that
 * lived inside one would disappear with the branch that produced the reports.
 */
export const DEFAULT_QUEUE_DIR = path.join(os.homedir(), '.spo-reports');

/** Maintainer decision 2026-09-27: at most 100 reports waiting to be pulled... */
export const MAX_QUEUE_FILES = 100;
/** ...and at most 100 MiB of them. */
export const MAX_QUEUE_BYTES = 100 * 1024 * 1024;
export const QUEUE_FULL_ERROR = 'The report queue is full — try again later';
export const REDACTED = '[redacted]';

/** Frames that carry another player's words, or the player's own mail: only the fact survives. */
export const PRIVATE_MESSAGE_TYPES: ReadonlySet<string> = new Set<string>([
  WsMessageType.EVENT_CHAT_MSG,
  WsMessageType.REQ_CHAT_SEND_MESSAGE,
  WsMessageType.RESP_MAIL_MESSAGE,
  WsMessageType.REQ_MAIL_COMPOSE,
  WsMessageType.REQ_MAIL_SAVE_DRAFT,
  WsMessageType.EVENT_NEW_MAIL,
  WsMessageType.REQ_GM_CHAT_SEND,
]);

/** A `"password":"…"` pair inside text — the closing quote may have been cut off. */
const PASSWORD_IN_TEXT = /("password"\s*:\s*")(?:[^"\\]|\\.)*"?/gi;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replace every `password` value (any case, any depth, or inside a cut string) with REDACTED. */
function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(PASSWORD_IN_TEXT, `$1${REDACTED}"`);
  if (Array.isArray(value)) return value.map(redact);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = key.toLowerCase() === 'password' ? REDACTED : redact(inner);
    }
    return out;
  }
  return value;
}

/**
 * The journal as it may be stored: no password, no chat or mail text. Pure — the input is
 * never mutated. Applied in every mode: the queue should never hold either, whoever reads it.
 */
export function scrubJournal(journal: JournalEntry[]): JournalEntry[] {
  return journal.map((entry): JournalEntry => {
    if (entry.t !== 'ws-in' && entry.t !== 'ws-out') return entry;
    if (PRIVATE_MESSAGE_TYPES.has(entry.msgType)) {
      return { t: entry.t, ts: entry.ts, msgType: entry.msgType, payload: undefined };
    }
    return { ...entry, payload: redact(entry.payload) };
  });
}

/** Count and size of the top-level files waiting to be pulled; subdirectories never count. */
function measureQueue(queueDir: string): { files: number; bytes: number } {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(queueDir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { files: 0, bytes: 0 };
    throw err;
  }
  let files = 0;
  let bytes = 0;
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    files += 1;
    bytes += fs.statSync(path.join(queueDir, dirent.name)).size;
  }
  return { files, bytes };
}

export interface DepositResult {
  status: 200 | 400 | 404 | 500 | 503;
  body: { ok?: true; file?: string; error?: string };
}

/** `2026-08-24T09:15:00.123Z` -> `2026-08-24T09-15-00-123Z`, safe as a filename component. */
function fileStamp(createdAtUtc: string): string {
  return createdAtUtc.replace(/[:.]/g, '-');
}

/**
 * Queue cap -> parse -> validate -> scrub -> stamp identity and `receivedAtUtc` -> write one
 * file. Pure of req/res.
 *
 * `enabled: false` answers 404 rather than 403: in a normal deployment the endpoint does
 * not exist, and nothing about the response should suggest it might.
 */
export function depositBugReport(
  rawBody: string,
  opts: { enabled: boolean; queueDir: string; identity: ReporterIdentity; warn: (message: string) => void },
): DepositResult {
  if (!opts.enabled) {
    return { status: 404, body: { error: 'Not found' } };
  }

  let queue: { files: number; bytes: number };
  try {
    queue = measureQueue(opts.queueDir);
  } catch (err: unknown) {
    // Fails closed: a queue that cannot be measured cannot be proven under its cap.
    return { status: 500, body: { error: `Could not read the report queue: ${toErrorMessage(err)}` } };
  }
  if (queue.files >= MAX_QUEUE_FILES || queue.bytes >= MAX_QUEUE_BYTES) {
    opts.warn(`[bug-report] queue full: ${queue.files} files, ${queue.bytes} bytes in ${opts.queueDir}`);
    return { status: 503, body: { error: QUEUE_FULL_ERROR } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON body' } };
  }

  const validation = validateBugReport(parsed);
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }

  // Identity and receivedAtUtc are the gateway's: whatever the browser sent is replaced by the
  // world login the ticket recorded and by the gateway's own clock.
  const report: BugReport = {
    ...validation.report,
    journal: scrubJournal(validation.report.journal),
    username: opts.identity.username,
    world: opts.identity.world,
    receivedAtUtc: new Date().toISOString(),
  };
  const file = `${fileStamp(report.createdAtUtc)}_${report.profile}_${report.anchorKey}.json`;

  try {
    fs.mkdirSync(opts.queueDir, { recursive: true });
    fs.writeFileSync(path.join(opts.queueDir, file), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (err: unknown) {
    return { status: 500, body: { error: `Could not write the report: ${toErrorMessage(err)}` } };
  }

  return { status: 200, body: { ok: true, file } };
}

/** Just enough of `http.IncomingMessage` to stream a body — so a test can pass a fake. */
export interface BugReportRequest {
  headers: { cookie?: string | undefined };
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** Just enough of `http.ServerResponse` to answer with JSON. */
export interface BugReportResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

export interface BugReportRequestDeps {
  enabled: boolean;
  queueDir: string;
  /** `false` means the caller is over its allowance; the answer is 429. */
  allowRequest: () => boolean;
  /** Who may deposit, and how many reports they have left. */
  tickets: Pick<ReportTicketRegistry, 'check' | 'recordDeposit'>;
  warn: (message: string) => void;
}

/**
 * The whole `POST /api/bug-report` route.
 *
 * It lives here rather than in `server.ts` for one reason: nothing can import `server.ts`,
 * so every line written there is untested by construction. The route body is transport —
 * accumulate, cap, answer — and `depositBugReport` above holds the decisions.
 */
export function handleBugReportRequest(
  req: BugReportRequest,
  res: BugReportResponse,
  deps: BugReportRequestDeps,
): void {
  const answer = (result: DepositResult | { status: number; body: unknown }): void => {
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  };

  if (!deps.enabled) {
    answer({ status: 404, body: { error: 'Not found' } });
    return;
  }

  if (!deps.allowRequest()) {
    answer({ status: 429, body: { error: 'Too many bug reports. Try again in a minute.' } });
    return;
  }

  const gate = deps.tickets.check(readTicketCookie(req.headers.cookie));
  if (!gate.ok) {
    answer({ status: gate.status, body: { error: gate.error } });
    return;
  }

  const chunks: Buffer[] = [];
  let bodySize = 0;
  req.on('data', (chunk: Buffer) => {
    bodySize += chunk.length;
    // Past the cap the bytes are dropped rather than buffered — the answer is already decided.
    if (bodySize <= MAX_BODY_BYTES) chunks.push(chunk);
  });
  req.on('end', () => {
    if (bodySize > MAX_BODY_BYTES) {
      answer({ status: 413, body: { error: 'Payload too large' } });
      return;
    }
    // Checked again right before the write: the connection may have closed mid-upload, and
    // parallel uploads must not overshoot the per-session cap.
    const again = deps.tickets.check(gate.ticket);
    if (!again.ok) {
      answer({ status: again.status, body: { error: again.error } });
      return;
    }
    const result = depositBugReport(Buffer.concat(chunks).toString('utf8'), {
      enabled: true,
      queueDir: deps.queueDir,
      identity: again.identity,
      warn: deps.warn,
    });
    if (result.status === 200) deps.tickets.recordDeposit(again.ticket);
    answer(result);
  });
}
