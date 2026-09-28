/**
 * The bug-report ticket: what ties a `POST /api/bug-report` to a live, logged-in session.
 *
 * On every WebSocket upgrade the gateway mints a random ticket and hands it to the browser as
 * an `HttpOnly; SameSite=Strict; Path=/api/bug-report` cookie. The browser sends it back on its
 * own with the same-origin report upload, and the deposit route looks it up here: the ticket
 * names the connection's session, the identity the world accepted at login, and how many
 * reports that session has already sent.
 *
 * It lives outside `server.ts` because nothing can import that module, so no test could reach it.
 */

import { randomBytes } from 'crypto';
import { SessionPhase } from '../shared/types/protocol-types';

export const REPORT_TICKET_COOKIE = 'spo_report_ticket';
/** Maintainer decision 2026-09-27: five reports per session. */
export const MAX_REPORTS_PER_SESSION = 5;
export const LOGIN_REQUIRED_ERROR = 'Log in to a world to send a report';

/** Just enough of a session for the ticket check. */
export interface TicketSession {
  getPhase(): SessionPhase;
}

/** Who reported, as the gateway knows it — never as the browser claims it. */
export interface ReporterIdentity {
  username: string;
  world: string;
}

export type TicketCheck =
  | { ok: true; ticket: string; identity: ReporterIdentity }
  | { ok: false; status: 403 | 429; error: string };

/** Just enough of the upgrade request: its headers and whether its socket is TLS. */
export interface UpgradeRequest {
  headers: { [key: string]: string | string[] | undefined };
  socket: { encrypted?: boolean };
}

/** The `Set-Cookie` header line pushed into the upgrade response. */
export function buildTicketCookie(ticket: string, secure: boolean): string {
  const base = `Set-Cookie: ${REPORT_TICKET_COOKIE}=${ticket}; HttpOnly; SameSite=Strict; Path=/api/bug-report`;
  return secure ? `${base}; Secure` : base;
}

/** The ticket carried by a `Cookie` header, or `undefined` when there is none. */
export function readTicketCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const prefix = `${REPORT_TICKET_COOKIE}=`;
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value || undefined;
    }
  }
  return undefined;
}

/** TLS on the socket itself, or — only behind a trusted proxy — an `https` forwarded proto. */
export function isSecureUpgrade(req: UpgradeRequest, trustProxy: boolean): boolean {
  if (req.socket.encrypted === true) return true;
  if (!trustProxy) return false;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto !== 'string') return false;
  const last = proto.split(',').pop() ?? '';
  return last.trim().toLowerCase() === 'https';
}

interface TicketEntry {
  session: TicketSession;
  identity: ReporterIdentity | null;
  deposits: number;
}

export class ReportTicketRegistry {
  /** Upgrade request -> minted ticket; weak, so an upgrade that never completes leaks nothing. */
  private readonly pending = new WeakMap<object, string>();
  private readonly entries = new Map<string, TicketEntry>();

  /** Mint a ticket on every upgrade response the WebSocket server writes. */
  listenForUpgrades(
    server: { on(event: 'headers', cb: (headers: string[], req: UpgradeRequest) => void): unknown },
    trustProxy: boolean,
  ): void {
    server.on('headers', (headers, req) => {
      const ticket = randomBytes(32).toString('base64url');
      headers.push(buildTicketCookie(ticket, isSecureUpgrade(req, trustProxy)));
      this.pending.set(req, ticket);
    });
  }

  /** Tie the ticket minted for this upgrade to its session; `null` if none was minted. */
  bindConnection(req: object, session: TicketSession): string | null {
    const ticket = this.pending.get(req);
    if (ticket === undefined) return null;
    this.pending.delete(req);
    this.entries.set(ticket, { session, identity: null, deposits: 0 });
    return ticket;
  }

  /** Record who the world accepted on this connection. */
  recordWorldLogin(ticket: string | null, identity: ReporterIdentity): void {
    if (ticket === null) return;
    const entry = this.entries.get(ticket);
    if (entry) entry.identity = { ...identity };
  }

  /** Forget a closed connection's ticket. */
  revoke(ticket: string | null): void {
    if (ticket !== null) this.entries.delete(ticket);
  }

  check(ticket: string | undefined): TicketCheck {
    const entry = ticket === undefined ? undefined : this.entries.get(ticket);
    if (ticket === undefined || !entry || entry.identity === null
      || entry.session.getPhase() !== SessionPhase.WORLD_CONNECTED) {
      return { ok: false, status: 403, error: LOGIN_REQUIRED_ERROR };
    }
    if (entry.deposits >= MAX_REPORTS_PER_SESSION) {
      return { ok: false, status: 429, error: `This session has already sent ${MAX_REPORTS_PER_SESSION} reports` };
    }
    return { ok: true, ticket, identity: { ...entry.identity } };
  }

  recordDeposit(ticket: string): void {
    const entry = this.entries.get(ticket);
    if (entry) entry.deposits += 1;
  }
}
