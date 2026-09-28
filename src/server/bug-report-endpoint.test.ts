import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jest } from '@jest/globals';
import {
  depositBugReport, handleBugReportRequest, scrubJournal, DEFAULT_QUEUE_DIR,
  MAX_QUEUE_FILES, MAX_QUEUE_BYTES, QUEUE_FULL_ERROR,
} from './bug-report-endpoint';
import { ReportTicketRegistry, MAX_REPORTS_PER_SESSION, REPORT_TICKET_COOKIE, type TicketSession } from './bug-report-tickets';
import {
  BUG_REPORT_SCHEMA_VERSION, MAX_BODY_BYTES, computeAnchorKey, validateBugReport,
  type DomAnchor, type JournalEntry,
} from '../shared/bug-report-schema';
import { SessionPhase } from '../shared/types/protocol-types';

const anchor: DomAnchor = {
  kind: 'dom',
  componentChain: ['GameScreen', 'PoliticsPanel', 'button'],
  cssChain: 'div.panel > button',
  text: 'Set tax',
};

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BUG_REPORT_SCHEMA_VERSION,
    id: '0b6a2b1e-1111-4222-8333-444455556666',
    profile: 'desktop',
    kind: 'wrong-data',
    createdAtUtc: '2026-08-24T09:15:00.123Z',
    username: 'SPO_test3',
    world: 'planitia',
    userAgent: 'Mozilla/5.0',
    viewport: { width: 1920, height: 1080 },
    anchor,
    anchorKey: computeAnchorKey(anchor),
    observed: '12 %',
    expected: '15 %',
    journal: [{ t: 'click', ts: 1, target: 'button.tax' }],
    ...over,
  };
}

/** The identity the gateway recorded at world login. */
const who = { username: 'SPO_test3', world: 'planitia' };

let queueDir: string;
let warn: jest.Mock<(message: string) => void>;

/** The deposit options every happy-path call uses. */
function opts(over: Partial<Parameters<typeof depositBugReport>[1]> = {}): Parameters<typeof depositBugReport>[1] {
  return { enabled: true, queueDir, identity: who, warn, ...over };
}

beforeEach(() => {
  queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-reports-'));
  warn = jest.fn<(message: string) => void>();
});

afterEach(() => {
  fs.rmSync(queueDir, { recursive: true, force: true });
});

describe('DEFAULT_QUEUE_DIR', () => {
  it('sits outside any worktree — npm run finish must not be able to take the queue with it', () => {
    expect(DEFAULT_QUEUE_DIR).toBe(path.join(os.homedir(), '.spo-reports'));
    expect(DEFAULT_QUEUE_DIR).not.toContain('worktrees');
  });
});

describe('depositBugReport — the happy path', () => {
  it('writes the report under a name built from its timestamp, profile and anchor key', () => {
    const result = depositBugReport(JSON.stringify(report()), opts());

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.file).toBe(`2026-08-24T09-15-00-123Z_desktop_${computeAnchorKey(anchor)}.json`);
    expect(fs.readdirSync(queueDir)).toEqual([result.body.file]);
  });

  it('parses back to the same report, plus the gateway stamp', () => {
    const before = Date.now();
    const result = depositBugReport(JSON.stringify(report()), opts());
    const written = JSON.parse(fs.readFileSync(path.join(queueDir, result.body.file as string), 'utf8')) as Record<string, unknown>;

    expect(written).toEqual({ ...report(), receivedAtUtc: written.receivedAtUtc });
    expect(Date.parse(written.receivedAtUtc as string)).toBeGreaterThanOrEqual(before);
  });

  it('stamps receivedAtUtc itself, overwriting whatever the client claimed', () => {
    const result = depositBugReport(
      JSON.stringify(report({ receivedAtUtc: '1999-01-01T00:00:00.000Z' })),
      opts(),
    );
    const written = JSON.parse(fs.readFileSync(path.join(queueDir, result.body.file as string), 'utf8')) as Record<string, unknown>;

    expect(written.receivedAtUtc).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('creates a nested queue directory that does not exist yet', () => {
    const nested = path.join(queueDir, 'deep', 'deeper');
    const result = depositBugReport(JSON.stringify(report()), opts({ queueDir: nested }));

    expect(result.status).toBe(200);
    expect(fs.readdirSync(nested)).toHaveLength(1);
  });
});

describe('depositBugReport — the refusals', () => {
  it('answers 404 and writes nothing when the feature is off', () => {
    const result = depositBugReport(JSON.stringify(report()), opts({ enabled: false }));

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Not found' });
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 404 before even looking at the body', () => {
    expect(depositBugReport('not json at all', opts({ enabled: false })).status).toBe(404);
  });

  it('answers 400 on a body that is not JSON', () => {
    const result = depositBugReport('{ broken', opts());

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid JSON body');
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 400 with the validator’s reason, and writes nothing', () => {
    const result = depositBugReport(JSON.stringify(report({ kind: 'slow' })), opts());

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('kind');
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });
});

describe('depositBugReport — path safety', () => {
  it('refuses a createdAtUtc carrying a path separator, and writes nowhere', () => {
    const escape = path.join(queueDir, 'escaped');
    fs.mkdirSync(escape);

    const result = depositBugReport(
      JSON.stringify(report({ createdAtUtc: '../escaped/2026-08-24T09-15-00-123Z' })),
      opts({ queueDir: path.join(queueDir, 'queue') }),
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('createdAtUtc');
    expect(fs.readdirSync(escape)).toEqual([]);
    expect(fs.existsSync(path.join(queueDir, 'queue'))).toBe(false);
  });

  it('refuses an anchorKey carrying a path separator, and writes nowhere', () => {
    const escape = path.join(queueDir, 'escaped');
    fs.mkdirSync(escape);

    const result = depositBugReport(
      JSON.stringify(report({ anchorKey: '../escaped/owned' })),
      opts({ queueDir: path.join(queueDir, 'queue') }),
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('anchorKey');
    expect(fs.readdirSync(escape)).toEqual([]);
    expect(fs.existsSync(path.join(queueDir, 'queue'))).toBe(false);
  });
});

describe('depositBugReport — when the disk refuses', () => {
  it('answers 500 rather than throwing when the queue cannot be written', () => {
    const readOnly = path.join(queueDir, 'readonly');
    fs.mkdirSync(readOnly);
    fs.chmodSync(readOnly, 0o444);

    const result = depositBugReport(JSON.stringify(report()), opts({ queueDir: readOnly }));

    fs.chmodSync(readOnly, 0o755);

    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Could not write the report');
  });
});

/** A body stream that hands over the chunks it was built with, then ends. */
function fakeRequest(chunks: Buffer[], cookie?: string): {
  headers: { cookie?: string };
  on: (event: 'data' | 'end', listener: never) => unknown;
  flush: () => void;
} {
  const listeners: { data: Array<(c: Buffer) => void>; end: Array<() => void> } = { data: [], end: [] };
  return {
    headers: cookie === undefined ? {} : { cookie },
    on(event, listener) {
      listeners[event].push(listener);
      return this;
    },
    flush() {
      for (const chunk of chunks) for (const l of listeners.data) l(chunk);
      for (const l of listeners.end) l();
    },
  };
}

function fakeResponse() {
  const res = {
    status: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    end(body: string) {
      res.body = JSON.parse(body);
      return res;
    },
  };
  return res;
}

/** A session whose phase the test moves by hand. */
function fakeSession(phase: SessionPhase = SessionPhase.WORLD_CONNECTED): TicketSession & { phase: SessionPhase } {
  return { phase, getPhase() { return this.phase; } };
}

/** A registry holding one connection, bound to `session`; logged in unless `loggedIn` is false. */
function registryWith(session: TicketSession, loggedIn = true, identity = who): {
  tickets: ReportTicketRegistry; ticket: string; cookie: string;
} {
  const tickets = new ReportTicketRegistry();
  const cookie = connect(tickets, session);
  const ticket = cookie.slice(REPORT_TICKET_COOKIE.length + 1);
  if (loggedIn) tickets.recordWorldLogin(ticket, identity);
  return { tickets, ticket, cookie };
}

/** Run one upgrade through the registry and return the `Cookie` header the browser would send. */
function connect(tickets: ReportTicketRegistry, session: TicketSession): string {
  let onHeaders: ((headers: string[], req: { headers: Record<string, string>; socket: { encrypted?: boolean } }) => void) | undefined;
  tickets.listenForUpgrades({ on: (_event, cb) => { onHeaders = cb; } }, false);
  const req = { headers: {}, socket: {} };
  const headers: string[] = [];
  onHeaders?.(headers, req);
  const ticket = tickets.bindConnection(req, session) as string;
  return `${REPORT_TICKET_COOKIE}=${ticket}`;
}

interface DriveDeps {
  enabled: boolean;
  queueDir: string;
  allowRequest?: () => boolean;
  tickets?: ReportTicketRegistry;
  /** `null` sends no Cookie header at all. */
  cookie?: string | null;
}

function drive(chunks: Buffer[], deps: DriveDeps) {
  const fallback = deps.tickets === undefined ? registryWith(fakeSession()) : undefined;
  const tickets = deps.tickets ?? (fallback as { tickets: ReportTicketRegistry }).tickets;
  const cookie = deps.cookie === null ? undefined : deps.cookie ?? fallback?.cookie;
  const req = fakeRequest(chunks, cookie);
  const res = fakeResponse();
  handleBugReportRequest(
    req as never,
    res,
    {
      enabled: deps.enabled,
      queueDir: deps.queueDir,
      allowRequest: deps.allowRequest ?? (() => true),
      tickets,
      warn,
    },
  );
  req.flush();
  return res;
}

const body = (over: Record<string, unknown> = {}): Buffer[] => [Buffer.from(JSON.stringify(report(over)), 'utf8')];

function storedFiles(dir: string = queueDir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
}

describe('handleBugReportRequest — the transport', () => {
  it('reassembles a body split across chunks and deposits it', () => {
    const raw = Buffer.from(JSON.stringify(report()), 'utf8');
    const res = drive([raw.subarray(0, 20), raw.subarray(20)], { enabled: true, queueDir });

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(fs.readdirSync(queueDir)).toHaveLength(1);
  });

  it('answers 429 without reading the body when the caller is over its allowance', () => {
    const res = drive([Buffer.from(JSON.stringify(report()))], {
      enabled: true, queueDir, allowRequest: () => false,
    });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too many bug reports. Try again in a minute.' });
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 413 on a body past the 4 MB cap, and buffers none of the excess', () => {
    const res = drive([Buffer.alloc(MAX_BODY_BYTES), Buffer.alloc(1)], { enabled: true, queueDir });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Payload too large' });
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('passes the disabled flag through — the route 404s like the deposit does', () => {
    expect(drive([Buffer.from(JSON.stringify(report()))], opts({ enabled: false })).status).toBe(404);
  });

  it('answers 404 before the IP allowance is even consulted', () => {
    const allowRequest = jest.fn(() => true);
    const res = drive(body(), { enabled: false, queueDir, allowRequest });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(allowRequest).not.toHaveBeenCalled();
  });
});

describe('handleBugReportRequest — only a logged-in session may deposit', () => {
  const refusal = { error: 'Log in to a world to send a report' };

  it('answers 403 with no ticket cookie, and writes nothing', () => {
    const res = drive(body(), { enabled: true, queueDir, cookie: null });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(refusal);
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 403 on a ticket the gateway never issued', () => {
    const { tickets } = registryWith(fakeSession());
    const res = drive(body(), { enabled: true, queueDir, tickets, cookie: `${REPORT_TICKET_COOKIE}=forged` });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(refusal);
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 403 when the ticket’s session has not reached WORLD_CONNECTED', () => {
    const { tickets, cookie } = registryWith(fakeSession(SessionPhase.DIRECTORY_CONNECTED));
    const res = drive(body(), { enabled: true, queueDir, tickets, cookie });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(refusal);
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 403 on a closed connection’s ticket', () => {
    const { tickets, ticket, cookie } = registryWith(fakeSession());
    tickets.revoke(ticket);
    const res = drive(body(), { enabled: true, queueDir, tickets, cookie });

    expect(res.status).toBe(403);
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('answers 403 when the connection closes while the body is still uploading', () => {
    const { tickets, ticket, cookie } = registryWith(fakeSession());
    const req = fakeRequest(body(), cookie);
    const res = fakeResponse();
    handleBugReportRequest(req as never, res, { enabled: true, queueDir, allowRequest: () => true, tickets, warn });
    tickets.revoke(ticket);
    req.flush();

    expect(res.status).toBe(403);
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });

  it('stamps the session’s username and world, whatever the body claimed', () => {
    const res = drive(body({ username: 'Mallory', world: 'elsewhere' }), { enabled: true, queueDir });
    const written = JSON.parse(fs.readFileSync(path.join(queueDir, (res.body as { file: string }).file), 'utf8')) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(written.username).toBe('SPO_test3');
    expect(written.world).toBe('planitia');
  });
});

describe('handleBugReportRequest — the per-session cap', () => {
  it(`accepts ${MAX_REPORTS_PER_SESSION} reports from one session and answers 429 to the next`, () => {
    const { tickets, cookie } = registryWith(fakeSession());
    for (let i = 0; i < MAX_REPORTS_PER_SESSION; i++) {
      const at = `2026-08-24T09:15:0${i}.123Z`;
      expect(drive(body({ createdAtUtc: at }), { enabled: true, queueDir, tickets, cookie }).status).toBe(200);
    }
    const over = drive(body({ createdAtUtc: '2026-08-24T09:16:00.123Z' }), { enabled: true, queueDir, tickets, cookie });

    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: `This session has already sent ${MAX_REPORTS_PER_SESSION} reports` });
    expect(fs.readdirSync(queueDir)).toHaveLength(MAX_REPORTS_PER_SESSION);

    // A new connection is a new session, and starts at zero.
    const fresh = connect(tickets, fakeSession());
    tickets.recordWorldLogin(fresh.slice(REPORT_TICKET_COOKIE.length + 1), who);
    expect(drive(body({ createdAtUtc: '2026-08-24T09:17:00.123Z' }), { enabled: true, queueDir, tickets, cookie: fresh }).status).toBe(200);
  });

  it('does not count a refused deposit against the session', () => {
    const { tickets, cookie } = registryWith(fakeSession());
    for (let i = 0; i < MAX_REPORTS_PER_SESSION; i++) {
      expect(drive(body({ kind: 'slow' }), { enabled: true, queueDir, tickets, cookie }).status).toBe(400);
    }
    expect(drive(body(), { enabled: true, queueDir, tickets, cookie }).status).toBe(200);
  });
});

describe('depositBugReport — the queue cap', () => {
  it(`answers 503 with ${MAX_QUEUE_FILES} files already queued, writes nothing, and warns once`, () => {
    for (let i = 0; i < MAX_QUEUE_FILES; i++) fs.writeFileSync(path.join(queueDir, `queued-${i}.json`), '{}');

    const result = depositBugReport(JSON.stringify(report()), opts());

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: QUEUE_FULL_ERROR });
    expect(storedFiles()).toHaveLength(MAX_QUEUE_FILES);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('queue full');
  });

  it('accepts the deposit that brings the queue to one below the file cap', () => {
    for (let i = 0; i < MAX_QUEUE_FILES - 1; i++) fs.writeFileSync(path.join(queueDir, `queued-${i}.json`), '{}');

    expect(depositBugReport(JSON.stringify(report()), opts()).status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it(`answers 503 once ${MAX_QUEUE_BYTES} bytes are queued`, () => {
    const big = path.join(queueDir, 'big.json');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, MAX_QUEUE_BYTES); // sparse: no 100 MiB buffer

    const result = depositBugReport(JSON.stringify(report()), opts());

    expect(result.status).toBe(503);
    expect(storedFiles()).toEqual(['big.json']);
  });

  it('accepts a deposit one byte under the byte cap', () => {
    const big = path.join(queueDir, 'big.json');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, MAX_QUEUE_BYTES - 1);

    expect(depositBugReport(JSON.stringify(report()), opts()).status).toBe(200);
  });

  it('does not count what sits in pulled/ — that has its own retention', () => {
    const pulled = path.join(queueDir, 'pulled');
    fs.mkdirSync(pulled);
    for (let i = 0; i < MAX_QUEUE_FILES; i++) fs.writeFileSync(path.join(pulled, `old-${i}.json`), '{}');

    expect(depositBugReport(JSON.stringify(report()), opts()).status).toBe(200);
  });

  it('answers 500 and writes nothing when the queue cannot be read', () => {
    fs.chmodSync(queueDir, 0o333);
    const result = depositBugReport(JSON.stringify(report()), opts());
    fs.chmodSync(queueDir, 0o755);

    expect(result.status).toBe(500);
    expect(result.body.error).toContain('Could not read the report queue');
    expect(fs.readdirSync(queueDir)).toEqual([]);
  });
});

describe('depositBugReport — the scrub', () => {
  const journal: JournalEntry[] = [
    { t: 'ws-out', ts: 1, msgType: 'REQ_LOGIN_WORLD', payload: { type: 'REQ_LOGIN_WORLD', username: 'SPO_test3', password: 'hunter2-login' } },
    { t: 'ws-out', ts: 2, msgType: 'REQ_CONNECT_DIRECTORY', payload: '{"type":"REQ_CONNECT_DIRECTORY","password":"hunter2-cut', truncated: true },
    { t: 'ws-out', ts: 3, msgType: 'REQ_CHAT_JOIN_CHANNEL', payload: { type: 'REQ_CHAT_JOIN_CHANNEL', channel: { name: 'ops', Password: 'hunter2-chan' } } },
    { t: 'ws-in', ts: 4, msgType: 'EVENT_CHAT_MSG', payload: { type: 'EVENT_CHAT_MSG', from: 'Other', message: 'secret-chat-line' } },
  ];

  it('stores none of the passwords and none of the chat text', () => {
    const result = depositBugReport(JSON.stringify(report({ journal })), opts());
    const raw = fs.readFileSync(path.join(queueDir, result.body.file as string), 'utf8');
    const stored = JSON.parse(raw) as { journal: Array<Record<string, unknown>> };

    expect(result.status).toBe(200);
    for (const secret of ['hunter2-login', 'hunter2-cut', 'hunter2-chan', 'secret-chat-line']) {
      expect(raw).not.toContain(secret);
    }
    expect(stored.journal[3]).toEqual({ t: 'ws-in', ts: 4, msgType: 'EVENT_CHAT_MSG' });
    expect(validateBugReport(stored).ok).toBe(true);
  });

  it('keeps everything that is not a secret', () => {
    const scrubbed = scrubJournal(journal);

    expect(scrubbed[0]).toEqual({ ...journal[0], payload: { type: 'REQ_LOGIN_WORLD', username: 'SPO_test3', password: '[redacted]' } });
    expect(scrubbed[1]).toEqual({ ...journal[1], payload: '{"type":"REQ_CONNECT_DIRECTORY","password":"[redacted]"' });
    expect(scrubbed[2].t === 'ws-out' && scrubbed[2].payload).toEqual({ type: 'REQ_CHAT_JOIN_CHANNEL', channel: { name: 'ops', Password: '[redacted]' } });
  });

  it('redacts inside arrays, and a closed quoted password in text', () => {
    const scrubbed = scrubJournal([
      { t: 'ws-in', ts: 1, msgType: 'X', payload: [{ password: 'a' }, 7, null, '{"PASSWORD" : "b\\"c", "k":1}'] },
    ]);

    expect(scrubbed[0].t === 'ws-in' && scrubbed[0].payload).toEqual([{ password: '[redacted]' }, 7, null, '{"PASSWORD" : "[redacted]", "k":1}']);
  });

  it('keeps a sent __proto__ key as plain data, never as the copy\'s prototype', () => {
    const payload: unknown = JSON.parse('{"__proto__":{"password":"leak","polluted":true},"k":1}');
    const scrubbed = scrubJournal([{ t: 'ws-in', ts: 1, msgType: 'X', payload }]);
    const out = scrubbed[0].t === 'ws-in' ? scrubbed[0].payload : undefined;

    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"password":"[redacted]","polluted":true},"k":1}');
  });

  it('drops the payload of every chat and mail frame, keeping msgType and ts', () => {
    const types = ['EVENT_CHAT_MSG', 'REQ_CHAT_SEND_MESSAGE', 'RESP_MAIL_MESSAGE', 'REQ_MAIL_COMPOSE', 'REQ_MAIL_SAVE_DRAFT', 'EVENT_NEW_MAIL', 'REQ_GM_CHAT_SEND'];
    const scrubbed = scrubJournal(types.map((msgType, ts): JournalEntry => ({ t: 'ws-out', ts, msgType, payload: { text: 'private' } })));

    expect(JSON.parse(JSON.stringify(scrubbed))).toEqual(types.map((msgType, ts) => ({ t: 'ws-out', ts, msgType })));
  });

  it('never mutates its input, and passes click and console entries through untouched', () => {
    const input: JournalEntry[] = [
      { t: 'click', ts: 1, target: 'button.tax' },
      { t: 'console', ts: 2, level: 'error', message: 'boom' },
      journal[0],
    ];
    const snapshot = JSON.stringify(input);
    const scrubbed = scrubJournal(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(scrubbed[0]).toBe(input[0]);
    expect(scrubbed[1]).toBe(input[1]);
  });
});

describe('depositBugReport — the build version', () => {
  it('keeps the appVersion the player ran', () => {
    const result = depositBugReport(JSON.stringify(report({ appVersion: '1.2.3' })), opts());
    const written = JSON.parse(fs.readFileSync(path.join(queueDir, result.body.file as string), 'utf8')) as Record<string, unknown>;

    expect(written.appVersion).toBe('1.2.3');
  });
});
