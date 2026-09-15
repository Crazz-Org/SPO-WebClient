import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  validateBugReport,
  computeAnchorKey,
  MAX_BODY_BYTES,
  MAX_JOURNAL_ENTRIES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_WS_PAYLOAD_BYTES,
  type DomAnchor,
} from '../../shared/bug-report-schema';
import { reportJournal } from './journal';
import { buildReport, submitReport, BUG_REPORT_ENDPOINT, type ReportDraft } from './report-submit';

const anchor: DomAnchor = {
  kind: 'dom',
  componentChain: ['GameScreen', 'PoliticsPanel', 'button'],
  cssChain: 'section#panel > button.tax',
  text: 'Set tax',
};

const draft: ReportDraft = {
  profile: 'desktop',
  kind: 'wrong-data',
  anchor,
  username: 'SPO_test3',
  world: 'planitia',
  observed: '12 %',
  expected: '15 %',
};

type FetchCall = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };

function mockFetch(response: { ok: boolean; status: number; body: unknown }): FetchCall[] {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = ((url: string, init: FetchCall['init']) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    });
  }) as unknown as typeof fetch;
  return calls;
}

const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

beforeEach(() => {
  reportJournal.disarm();
  reportJournal.reset();
});

afterEach(() => {
  (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  reportJournal.disarm();
  reportJournal.reset();
});

describe('buildReport', () => {
  it('produces a report the gateway validator accepts', () => {
    const result = validateBugReport(buildReport(draft));
    expect(result.ok).toBe(true);
  });

  it('stamps createdAtUtc as strict ISO 8601 UTC — the key into the Survival logs', () => {
    expect(buildReport(draft).createdAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('computes the anchor key from the anchor, not from the caller', () => {
    expect(buildReport(draft).anchorKey).toBe(computeAnchorKey(anchor));
  });

  it('gives every report its own id', () => {
    expect(buildReport(draft).id).not.toBe(buildReport(draft).id);
  });

  it('carries the journal snapshot', () => {
    reportJournal.arm();
    reportJournal.record('ws-out', { type: 'REQ_SET_TAX' });

    expect(buildReport(draft).journal).toEqual([
      expect.objectContaining({ t: 'ws-out', msgType: 'REQ_SET_TAX' }),
    ]);
  });

  it('drops empty optional fields rather than sending them blank', () => {
    const report = buildReport({ ...draft, observed: '', expected: '', freeText: '' });

    expect(report).not.toHaveProperty('observed');
    expect(report).not.toHaveProperty('expected');
    expect(report).not.toHaveProperty('freeText');
    expect(validateBugReport(report).ok).toBe(true);
  });

  it('accepts a canvas anchor and a mobile draft, and still validates', () => {
    const report = buildReport({
      profile: 'mobile',
      kind: 'visual',
      anchor: { kind: 'canvas', tileX: 412, tileY: 88, layer: 'building', visualClass: 'FarmClass' },
      username: 'SPO_test3',
      world: 'planitia',
      quickPicks: ['too-small'],
      freeText: 'trop petit',
    });

    expect(validateBugReport(report).ok).toBe(true);
    expect(report.profile).toBe('mobile');
  });

  it('carries sessionContext through when the caller supplies it', () => {
    const report = buildReport({ ...draft, sessionContext: { gameDate: '2026-08-30T00:00:00.000Z', surface: 'building' } });
    expect(report.sessionContext).toEqual({ gameDate: '2026-08-30T00:00:00.000Z', surface: 'building' });
    expect(validateBugReport(report).ok).toBe(true);
  });

  it('drops sessionContext entirely when the caller supplies none, rather than sending it empty', () => {
    expect(buildReport(draft)).not.toHaveProperty('sessionContext');
  });

  it('leaves an ordinary report untouched, and marks nothing as dropped', () => {
    reportJournal.arm();
    reportJournal.record('ws-out', { type: 'REQ_SET_TAX' });

    const report = buildReport(draft);

    expect(report.journal).toHaveLength(1);
    expect(report).not.toHaveProperty('trimmed');
  });
});

/**
 * #269 — every per-field limit is enforced alone and they do not sum below MAX_BODY_BYTES,
 * so the gateway answered 413 on a report nobody could shrink by hand.
 */
describe('buildReport — the aggregate body budget', () => {
  /** A journal at its documented worst: MAX_JOURNAL_ENTRIES entries of MAX_WS_PAYLOAD_BYTES. */
  function fillJournalToTheBrim(): void {
    // No quote or backslash in the payload: `boundPayload` re-measures escaped output, and a
    // payload full of quotes makes it shrink one character at a time for several seconds.
    const oversized = 'x'.repeat(MAX_WS_PAYLOAD_BYTES + 4096);
    reportJournal.arm();
    for (let i = 0; i < MAX_JOURNAL_ENTRIES; i++) {
      reportJournal.record('ws-out', { type: 'RES_MAP_CHUNK', payload: oversized });
    }
  }

  it('fits a maxed-out journal and a screenshot under the cap, keeping the newest entries', () => {
    fillJournalToTheBrim();
    const naiveJournalBytes = JSON.stringify(reportJournal.snapshot()).length;
    // The premise of the card: the journal alone already exceeds the whole body cap.
    expect(naiveJournalBytes).toBeGreaterThan(MAX_BODY_BYTES);

    const report = buildReport({
      ...draft,
      profile: 'mobile',
      kind: 'visual',
      anchor: {
        kind: 'canvas', tileX: 412, tileY: 88, layer: 'building',
        screenshotDataUrl: `data:image/jpeg;base64,${'A'.repeat(MAX_SCREENSHOT_DATA_URL_LENGTH - 100)}`,
      },
    });

    expect(JSON.stringify(report).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(validateBugReport(report).ok).toBe(true);
    // The screenshot is what the report was filed about — the journal yields first.
    expect(report.anchor).toHaveProperty('screenshotDataUrl');
    expect(report.journal.length).toBeGreaterThan(0);
    expect(report.journal.length).toBeLessThan(MAX_JOURNAL_ENTRIES);
  });

  it('records how much it dropped, so triage never reads a cut journal as a quiet one', () => {
    fillJournalToTheBrim();
    const kept = buildReport(draft);

    expect(kept.trimmed).toEqual({
      journalDropped: MAX_JOURNAL_ENTRIES - kept.journal.length,
      screenshotDropped: false,
    });
    expect(kept.trimmed?.journalDropped).toBeGreaterThan(0);
  });

  it('drops a screenshot too big to keep even with an empty journal', () => {
    const anchor = {
      kind: 'canvas' as const, tileX: 412, tileY: 88, layer: 'building' as const,
      screenshotDataUrl: `data:image/jpeg;base64,${'A'.repeat(MAX_BODY_BYTES)}`,
    };

    const report = buildReport({ ...draft, anchor });

    expect(JSON.stringify(report).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(report.anchor).not.toHaveProperty('screenshotDataUrl');
    expect(report.trimmed).toEqual({ journalDropped: 0, screenshotDropped: true });
    // The draft the caller still holds keeps its screenshot — the trim copied, it did not empty.
    expect(anchor.screenshotDataUrl).toHaveLength(MAX_BODY_BYTES + 23);
  });
});

/**
 * #864 — `fitToBodyCap` measured `JSON.stringify(...).length`, UTF-16 code units, against a
 * byte cap. A multi-byte-heavy report could pass that check while still being over the real
 * byte size sent on the wire, and die on a 413 the client never saw coming.
 */
describe('buildReport — multi-byte content is priced in bytes, not characters', () => {
  /** ~200 journal entries of 16,000 'é' (2 UTF-8 bytes, 1 UTF-16 unit) each — no quote or
   * backslash, so `boundPayload`'s escape correction does not run a slow shrink loop. */
  function fillJournalWithMultiByteEntries(count: number, charsPerEntry: number): void {
    const payload = 'é'.repeat(charsPerEntry);
    reportJournal.arm();
    for (let i = 0; i < count; i++) {
      reportJournal.record('ws-out', { type: 'RES_MAP_CHUNK', payload });
    }
  }

  it('trims a report that fits under the byte cap in UTF-16 length but not in real UTF-8 bytes', () => {
    fillJournalWithMultiByteEntries(200, 16000);
    const snapshot = reportJournal.snapshot();
    const charLength = JSON.stringify(snapshot).length;
    const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    // The premise: passes the old (char) check, fails the real (byte) one — this is what makes
    // the test a regression guard that fails on the pre-fix code.
    expect(charLength).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(byteLength).toBeGreaterThan(MAX_BODY_BYTES);

    const report = buildReport(draft);

    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(report.trimmed?.journalDropped).toBeGreaterThan(0);
    expect(report.journal.length).toBeGreaterThan(0);
    expect(validateBugReport(report).ok).toBe(true);
  });

  it('prices the per-entry trim cost in bytes too, so the running total does not drift', () => {
    // A smaller multi-byte journal: only a handful of entries need dropping to fit.
    fillJournalWithMultiByteEntries(40, 16000);

    const report = buildReport(draft);

    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(report.journal.length).toBeGreaterThan(0);
    expect(validateBugReport(report).ok).toBe(true);
  });
});

describe('submitReport', () => {
  it('POSTs JSON to /api/bug-report, and the body passes the gateway validator', async () => {
    const calls = mockFetch({ ok: true, status: 200, body: { ok: true, file: 'a.json' } });

    const outcome = await submitReport(draft);

    expect(outcome).toEqual({ ok: true, detail: 'a.json' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BUG_REPORT_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(validateBugReport(JSON.parse(calls[0].init.body as string)).ok).toBe(true);
  });

  it('falls back to the report id when the gateway names no file', async () => {
    mockFetch({ ok: true, status: 200, body: { ok: true } });
    const outcome = await submitReport(draft);
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports the gateway reason on a refusal', async () => {
    mockFetch({ ok: false, status: 400, body: { error: 'anchorKey must be lowercase hex' } });
    expect(await submitReport(draft)).toEqual({ ok: false, detail: 'anchorKey must be lowercase hex' });
  });

  it('names the status when the refusal carries no reason', async () => {
    mockFetch({ ok: false, status: 404, body: {} });
    expect(await submitReport(draft)).toEqual({ ok: false, detail: 'HTTP 404' });
  });

  it('survives a response that is not JSON', async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = (() => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    })) as unknown as typeof fetch;

    expect(await submitReport(draft)).toEqual({ ok: false, detail: 'HTTP 500' });
  });

  it('never throws when the network is gone — the caller only shows a toast', async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = (() =>
      Promise.reject(new Error('Failed to fetch'))) as unknown as typeof fetch;

    expect(await submitReport(draft)).toEqual({ ok: false, detail: 'Failed to fetch' });
  });

  it('stringifies a non-Error rejection rather than losing it', async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = (() =>
      Promise.reject('offline')) as unknown as typeof fetch;

    expect(await submitReport(draft)).toEqual({ ok: false, detail: 'offline' });
  });
});

describe('the environment it runs in', () => {
  const globals = globalThis as unknown as { window?: unknown; navigator?: unknown };

  it('reads the viewport and user agent when a browser is there', () => {
    const hadWindow = 'window' in globals;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    globals.window = { innerWidth: 1920, innerHeight: 1080 };
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'jest-agent' }, configurable: true, writable: true,
    });

    try {
      const report = buildReport(draft);
      expect(report.viewport).toEqual({ width: 1920, height: 1080 });
      expect(report.userAgent).toBe('jest-agent');
    } finally {
      // try/finally, not a trailing statement: a failed expectation must not leak a fake
      // window into the next test, which asserts on its absence.
      if (!hadWindow) delete globals.window;
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else delete globals.navigator;
    }
  });

  it('falls back to a zero viewport outside a browser', () => {
    // node env: no window at all — the report is still valid, just uninformative about size.
    expect('window' in globals).toBe(false);
    expect(buildReport(draft).viewport).toEqual({ width: 0, height: 0 });
  });
});
