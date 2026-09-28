/**
 * `POST /api/client-error` — an error thrown in a player's browser becomes one `CLIENT_ERROR`
 * line in the gateway log.
 *
 * The route lives here rather than inline in `server.ts` because that module binds sockets at
 * import time, so no test can load it (same reason as `bug-report-endpoint.ts`).
 *
 * **Anonymous by design.** A report must be accepted before login too: errors on the startup
 * and login screens are exactly the ones a player cannot describe. So there is no session and
 * no identity field. What keeps the route safe is a closed field list
 * (`shared/client-error-schema.ts`), small caps, a per-IP limit (wired by `server.ts`) and a
 * gateway-wide cap kept here. The client IP is used for the limit and never written.
 */

import { createHash } from 'node:crypto';
import type * as http from 'http';
import { createLogger } from '../shared/logger';
import { validateClientErrorReport } from '../shared/client-error-schema';

export {
  validateClientErrorReport,
  MAX_MESSAGE_CHARS,
  MAX_FRAMES,
  MAX_FRAME_CHARS,
  type ClientErrorReport,
} from '../shared/client-error-schema';

/** Cap on the whole POST body; bytes past it are dropped and the answer is 413. */
export const MAX_CLIENT_ERROR_BODY_BYTES = 8192;
/** Per-IP allowance, per `checkRateLimit`'s 60 s window. */
export const CLIENT_ERROR_MAX_PER_IP = 20;
/** Accepted reports per window across all callers. */
export const CLIENT_ERROR_MAX_PER_MINUTE = 60;
export const CLIENT_ERROR_WINDOW_MS = 60_000;

/** Just enough of `http.IncomingMessage` to check the content type and stream a body. */
export interface ClientErrorRequest {
  headers: http.IncomingHttpHeaders;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/** Just enough of `http.ServerResponse` to answer. */
export interface ClientErrorResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body?: string): unknown;
}

export interface ClientErrorRequestDeps {
  /** `false` means the caller's IP is over its allowance; the answer is 429. */
  allowRequest: () => boolean;
}

export interface ClientErrorCounts {
  accepted: number;
  /** 415, 413 and 400 answers. */
  refused: number;
  /** Both 429s — per-IP and gateway-wide. */
  rateLimited: number;
}

const log = createLogger('ClientError');

const counts: ClientErrorCounts = { accepted: 0, refused: 0, rateLimited: 0 };

let windowStart = 0;
let windowAccepted = 0;
let capWarned = false;

/** Cumulative outcomes since process start (a copy). */
export function getClientErrorCounts(): ClientErrorCounts {
  return { ...counts };
}

/** First 12 hex chars of sha1(kind, message, frames) — groups identical errors. */
export function clientErrorSignature(kind: string, message: string, frames: readonly string[]): string {
  return createHash('sha1')
    .update(`${kind}\n${message}\n${frames.join('\n')}`)
    .digest('hex')
    .slice(0, 12);
}

function rollWindow(now: number): void {
  if (now - windowStart >= CLIENT_ERROR_WINDOW_MS) {
    windowStart = now;
    windowAccepted = 0;
    capWarned = false;
  }
}

/** True when the gateway-wide cap is reached; warns once per window. */
function capReached(): boolean {
  rollWindow(Date.now());
  if (windowAccepted < CLIENT_ERROR_MAX_PER_MINUTE) return false;
  if (!capWarned) {
    capWarned = true;
    log.warn('CLIENT_ERROR_CAP_REACHED', { limit: CLIENT_ERROR_MAX_PER_MINUTE });
  }
  return true;
}

const PER_IP_MESSAGE = 'Too many error reports. Try again in a minute.';
const CAP_MESSAGE = 'Error reporting is paused for a minute.';

/** The whole `POST /api/client-error` route. The first refusal answers. */
export function handleClientErrorRequest(
  req: ClientErrorRequest,
  res: ClientErrorResponse,
  deps: ClientErrorRequestDeps,
): void {
  const answer = (status: number, error: string): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  };
  const refuse = (status: number, error: string): void => {
    counts.refused++;
    answer(status, error);
  };
  const limit = (error: string): void => {
    counts.rateLimited++;
    answer(429, error);
  };

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    refuse(415, 'Content-Type must be application/json');
    return;
  }
  if (!deps.allowRequest()) {
    limit(PER_IP_MESSAGE);
    return;
  }
  if (capReached()) {
    limit(CAP_MESSAGE);
    return;
  }

  const chunks: Buffer[] = [];
  let bodySize = 0;
  req.on('data', (chunk: Buffer) => {
    bodySize += chunk.length;
    // Past the cap the bytes are dropped rather than buffered — the answer is already decided.
    if (bodySize <= MAX_CLIENT_ERROR_BODY_BYTES) chunks.push(chunk);
  });
  req.on('end', () => {
    if (bodySize > MAX_CLIENT_ERROR_BODY_BYTES) {
      refuse(413, 'Payload too large');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      refuse(400, 'Invalid JSON body');
      return;
    }
    const validation = validateClientErrorReport(parsed);
    if (!validation.ok) {
      refuse(400, validation.error);
      return;
    }
    // Several requests can pass the first check before any is counted; re-check to stay exact.
    if (capReached()) {
      limit(CAP_MESSAGE);
      return;
    }

    windowAccepted++;
    counts.accepted++;
    const { kind, build, message, frames, screen, surface, ua, mobile } = validation.report;
    log.warn('CLIENT_ERROR', {
      sig: clientErrorSignature(kind, message, frames),
      kind,
      build,
      message,
      frames,
      screen,
      surface,
      ua,
      mobile,
    });
    res.writeHead(204);
    res.end();
  });
}
