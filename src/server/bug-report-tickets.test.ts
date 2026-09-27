import { describe, it, expect } from '@jest/globals';
import { EventEmitter } from 'events';
import {
  ReportTicketRegistry, buildTicketCookie, readTicketCookie, isSecureUpgrade,
  REPORT_TICKET_COOKIE, MAX_REPORTS_PER_SESSION, LOGIN_REQUIRED_ERROR,
  type TicketSession, type UpgradeRequest,
} from './bug-report-tickets';
import { SessionPhase } from '../shared/types/protocol-types';

const who = { username: 'SPO_test3', world: 'planitia' };

function session(phase: SessionPhase = SessionPhase.WORLD_CONNECTED): TicketSession & { phase: SessionPhase } {
  return { phase, getPhase() { return this.phase; } };
}

function upgrade(over: Partial<UpgradeRequest> = {}): UpgradeRequest {
  return { headers: {}, socket: {}, ...over };
}

/** A registry listening on a fake WebSocket server, and a way to run one upgrade through it. */
function setup(trustProxy = false) {
  const server = new EventEmitter();
  const tickets = new ReportTicketRegistry();
  tickets.listenForUpgrades(server, trustProxy);
  const open = (req: UpgradeRequest = upgrade(), s: TicketSession = session()) => {
    const headers: string[] = [];
    server.emit('headers', headers, req);
    const ticket = tickets.bindConnection(req, s);
    return { headers, ticket: ticket as string };
  };
  return { tickets, open };
}

describe('buildTicketCookie', () => {
  it('is HttpOnly, SameSite=Strict and scoped to the deposit route', () => {
    expect(buildTicketCookie('abc', false))
      .toBe(`Set-Cookie: ${REPORT_TICKET_COOKIE}=abc; HttpOnly; SameSite=Strict; Path=/api/bug-report`);
  });

  it('adds Secure behind TLS', () => {
    expect(buildTicketCookie('abc', true)).toMatch(/; Path=\/api\/bug-report; Secure$/);
  });
});

describe('readTicketCookie', () => {
  it('finds nothing in an absent or empty header', () => {
    expect(readTicketCookie(undefined)).toBeUndefined();
    expect(readTicketCookie('')).toBeUndefined();
  });

  it('finds nothing among other cookies, or in an empty value', () => {
    expect(readTicketCookie('theme=dark; lang=fr')).toBeUndefined();
    expect(readTicketCookie(`${REPORT_TICKET_COOKIE}=`)).toBeUndefined();
  });

  it('picks the ticket out of several pairs', () => {
    expect(readTicketCookie(`theme=dark;  ${REPORT_TICKET_COOKIE}=t1 ; lang=fr`)).toBe('t1');
  });
});

describe('isSecureUpgrade', () => {
  it('is true on an encrypted socket', () => {
    expect(isSecureUpgrade(upgrade({ socket: { encrypted: true } }), false)).toBe(true);
  });

  it('believes a forwarded https only behind a trusted proxy', () => {
    const req = upgrade({ headers: { 'x-forwarded-proto': 'http, HTTPS ' } });
    expect(isSecureUpgrade(req, true)).toBe(true);
    expect(isSecureUpgrade(req, false)).toBe(false);
  });

  it('is false on plain http, or with no forwarded proto', () => {
    expect(isSecureUpgrade(upgrade({ headers: { 'x-forwarded-proto': 'http' } }), true)).toBe(false);
    expect(isSecureUpgrade(upgrade(), true)).toBe(false);
  });
});

describe('ReportTicketRegistry — minting', () => {
  it('pushes exactly one Set-Cookie per upgrade, and binds that ticket to the connection', () => {
    const { open } = setup();
    const { headers, ticket } = open();

    expect(headers).toHaveLength(1);
    expect(headers[0]).toBe(buildTicketCookie(ticket, false));
  });

  it('marks the cookie Secure when the upgrade is', () => {
    const { open } = setup(true);
    const { headers } = open(upgrade({ headers: { 'x-forwarded-proto': 'https' } }));

    expect(headers[0]).toMatch(/; Secure$/);
  });

  it('mints distinct 43-character base64url tickets', () => {
    const { open } = setup();
    const a = open().ticket;
    const b = open().ticket;

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('binds nothing for an upgrade it never saw, or twice for the same one', () => {
    const { tickets, open } = setup();
    expect(tickets.bindConnection(upgrade(), session())).toBeNull();

    const req = upgrade();
    open(req);
    expect(tickets.bindConnection(req, session())).toBeNull();
  });
});

describe('ReportTicketRegistry — check', () => {
  it('refuses a missing or unknown ticket', () => {
    const { tickets } = setup();
    expect(tickets.check(undefined)).toEqual({ ok: false, status: 403, error: LOGIN_REQUIRED_ERROR });
    expect(tickets.check('nope')).toEqual({ ok: false, status: 403, error: LOGIN_REQUIRED_ERROR });
  });

  it('refuses a WORLD_CONNECTED session whose world login it never recorded', () => {
    const { tickets, open } = setup();
    const { ticket } = open();

    expect(tickets.check(ticket)).toEqual({ ok: false, status: 403, error: LOGIN_REQUIRED_ERROR });
  });

  it('refuses a recorded login whose session has since left WORLD_CONNECTED', () => {
    const { tickets, open } = setup();
    const s = session();
    const { ticket } = open(upgrade(), s);
    tickets.recordWorldLogin(ticket, who);
    s.phase = SessionPhase.RECONNECTING;

    expect(tickets.check(ticket).ok).toBe(false);
  });

  it('accepts a logged-in session and names who logged in', () => {
    const { tickets, open } = setup();
    const { ticket } = open();
    tickets.recordWorldLogin(ticket, who);

    expect(tickets.check(ticket)).toEqual({ ok: true, ticket, identity: who });
  });

  it(`answers 429 after ${MAX_REPORTS_PER_SESSION} recorded deposits`, () => {
    const { tickets, open } = setup();
    const { ticket } = open();
    tickets.recordWorldLogin(ticket, who);
    for (let i = 0; i < MAX_REPORTS_PER_SESSION - 1; i++) tickets.recordDeposit(ticket);
    expect(tickets.check(ticket).ok).toBe(true);

    tickets.recordDeposit(ticket);
    expect(tickets.check(ticket)).toEqual({
      ok: false, status: 429, error: `This session has already sent ${MAX_REPORTS_PER_SESSION} reports`,
    });
  });

  it('refuses a revoked ticket', () => {
    const { tickets, open } = setup();
    const { ticket } = open();
    tickets.recordWorldLogin(ticket, who);
    tickets.revoke(ticket);

    expect(tickets.check(ticket).ok).toBe(false);
  });

  it('treats null and unknown tickets as no-ops everywhere', () => {
    const { tickets } = setup();
    expect(() => {
      tickets.recordWorldLogin(null, who);
      tickets.recordWorldLogin('nope', who);
      tickets.revoke(null);
      tickets.revoke('nope');
      tickets.recordDeposit('nope');
    }).not.toThrow();
    expect(tickets.check('nope').ok).toBe(false);
  });
});
