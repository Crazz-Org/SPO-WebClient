import { describe, it, expect } from '@jest/globals';
import {
  BUG_REPORT_SCHEMA_VERSION,
  MAX_JOURNAL_ENTRIES,
  MAX_TEXT_LENGTH,
  MAX_WS_PAYLOAD_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  computeAnchorKey,
  validateBugReport,
  type BugReport,
  type DomAnchor,
  type CanvasAnchor,
  type JournalEntry,
} from './bug-report-schema';

const domAnchor: DomAnchor = {
  kind: 'dom',
  componentChain: ['GameScreen', 'PoliticsPanel', 'TaxRow', 'button'],
  cssChain: 'div.panel > div.row > button',
  text: 'Set tax',
};

const canvasAnchor: CanvasAnchor = {
  kind: 'canvas',
  tileX: 412,
  tileY: 88,
  buildingId: 90210,
  visualClass: 'FarmClass',
  layer: 'building',
};

const journal: JournalEntry[] = [
  { t: 'click', ts: 1, target: 'button.tax', text: 'Set tax' },
  { t: 'surface', ts: 2, action: 'push', surface: 'PoliticsPanel' },
  { t: 'ws-out', ts: 3, msgType: 'REQ_SET_TAX', payload: { value: 12 } },
  { t: 'ws-in', ts: 4, msgType: 'RES_SET_TAX', payload: null, truncated: true },
  { t: 'console', ts: 5, level: 'error', message: 'boom' },
];

function desktopReport(over: Partial<BugReport> = {}): Record<string, unknown> {
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
    anchor: domAnchor,
    anchorKey: computeAnchorKey(domAnchor),
    observed: '12 %',
    expected: '15 %',
    journal,
    ...over,
  } as Record<string, unknown>;
}

function mobileReport(over: Partial<BugReport> = {}): Record<string, unknown> {
  return {
    version: BUG_REPORT_SCHEMA_VERSION,
    id: '0b6a2b1e-1111-4222-8333-444455556667',
    profile: 'mobile',
    kind: 'visual',
    createdAtUtc: '2026-08-24T09:16:30.000Z',
    username: 'SPO_test3',
    world: 'planitia',
    userAgent: 'Mozilla/5.0 (iPhone)',
    viewport: { width: 390, height: 844 },
    anchor: canvasAnchor,
    anchorKey: computeAnchorKey(canvasAnchor),
    quickPicks: ['too-small', 'covered'],
    freeText: 'Le bouton est sous la barre du bas',
    geometry: {
      elements: [{
        selector: 'button.tax',
        rect: { x: 10, y: 800, width: 40, height: 20 },
        styles: { fontSize: '11px', padding: '2px', overflow: 'visible', position: 'static', zIndex: 'auto', transform: 'none' },
      }],
      occludedBy: 'nav.bottom',
      overflowParent: null,
      viewport: { width: 390, height: 844 },
      orientation: 'portrait',
      devicePixelRatio: 3,
      visualViewportHeight: 844,
      safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
    },
    journal: [],
    ...over,
  } as Record<string, unknown>;
}

function rejects(value: unknown, fragment: string): void {
  const result = validateBugReport(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain(fragment);
}

describe('computeAnchorKey', () => {
  it('is stable across calls', () => {
    expect(computeAnchorKey(domAnchor)).toBe(computeAnchorKey({ ...domAnchor }));
    expect(computeAnchorKey(canvasAnchor)).toBe(computeAnchorKey({ ...canvasAnchor }));
  });

  it('distinguishes two different anchors', () => {
    expect(computeAnchorKey(domAnchor)).not.toBe(computeAnchorKey(canvasAnchor));
    expect(computeAnchorKey(domAnchor)).not.toBe(computeAnchorKey({ ...domAnchor, text: 'Set wage' }));
    expect(computeAnchorKey(canvasAnchor)).not.toBe(computeAnchorKey({ ...canvasAnchor, tileX: 413 }));
  });

  it('ignores the fields that do not identify the problem', () => {
    // Two reports on the same tile and layer are the same bug, whatever the screenshot holds.
    expect(computeAnchorKey({ ...canvasAnchor, screenshotDataUrl: 'data:image/jpeg;base64,AAA' }))
      .toBe(computeAnchorKey(canvasAnchor));
  });

  it('emits lowercase hex only — the shape the filename depends on', () => {
    for (const anchor of [domAnchor, canvasAnchor]) {
      expect(computeAnchorKey(anchor)).toMatch(/^[0-9a-f]+$/);
    }
  });
});

describe('validateBugReport — the shapes it accepts', () => {
  it('accepts a complete desktop report', () => {
    const result = validateBugReport(desktopReport());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.profile).toBe('desktop');
  });

  it('accepts a complete mobile report', () => {
    const result = validateBugReport(mobileReport());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.quickPicks).toEqual(['too-small', 'covered']);
  });

  it('accepts a dom anchor whose fiber walk failed, leaving only the CSS chain', () => {
    const anchor = { ...domAnchor, componentChain: [] };
    expect(validateBugReport(desktopReport({ anchor, anchorKey: computeAnchorKey(anchor) })).ok).toBe(true);
  });

  it('accepts the trim marker a report cut to fit the body cap carries', () => {
    const trimmed = { journalDropped: 340, screenshotDropped: true };
    const result = validateBugReport(desktopReport({ trimmed }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.trimmed).toEqual(trimmed);
  });

  it('accepts a sessionContext with both fields present, or both null', () => {
    const withValues = { gameDate: '2026-08-30T00:00:00.000Z', surface: 'building' };
    const result = validateBugReport(desktopReport({ sessionContext: withValues }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.sessionContext).toEqual(withValues);

    const withNulls = { gameDate: null, surface: null };
    expect(validateBugReport(desktopReport({ sessionContext: withNulls })).ok).toBe(true);
  });

  it('accepts a geometry element carrying a componentChain (mobile flagged element)', () => {
    const base = mobileReport() as { geometry: { elements: Array<Record<string, unknown>> } };
    const geometry = {
      ...base.geometry,
      elements: [{ ...base.geometry.elements[0], componentChain: ['GameScreen', 'QuickStats'] }],
    };
    expect(validateBugReport(mobileReport({ geometry: geometry as never })).ok).toBe(true);
  });

  it('accepts kind "suggestion" and quickPick "could-be-better" -- not a defect, never inferred', () => {
    expect(validateBugReport(desktopReport({ kind: 'suggestion' })).ok).toBe(true);
    expect(validateBugReport(mobileReport({ quickPicks: ['could-be-better'] })).ok).toBe(true);
  });
});

describe('validateBugReport — the shapes it refuses', () => {
  it('refuses anything that is not an object', () => {
    rejects('a report', 'must be an object');
    rejects(null, 'must be an object');
    rejects([desktopReport()], 'must be an object');
  });

  it('refuses a wrong version — a v2 report is not silently read as v1', () => {
    rejects(desktopReport({ version: 2 as never }), 'version must be 1');
  });

  it('refuses a missing or unknown profile', () => {
    rejects(desktopReport({ profile: undefined }), 'profile');
    rejects(desktopReport({ profile: 'tablet' as never }), 'profile');
  });

  it('refuses an unknown kind', () => {
    rejects(desktopReport({ kind: 'slow' as never }), 'kind');
  });

  it('refuses an empty or missing id', () => {
    rejects(desktopReport({ id: '' }), 'id');
    rejects(desktopReport({ id: undefined }), 'id');
  });

  it('refuses a missing createdAtUtc', () => {
    rejects(desktopReport({ createdAtUtc: undefined }), 'createdAtUtc');
  });

  it('refuses a malformed anchor', () => {
    rejects(desktopReport({ anchor: undefined }), 'anchor must be an object');
    rejects(desktopReport({ anchor: { kind: 'audio' } as never }), 'anchor.kind');
    rejects(desktopReport({ anchor: { ...domAnchor, componentChain: [1, 2] } as never }), 'componentChain');
    rejects(desktopReport({ anchor: { ...domAnchor, cssChain: undefined } as never }), 'cssChain');
    rejects(desktopReport({ anchor: { ...domAnchor, text: undefined } as never }), 'anchor.text');
    rejects(mobileReport({ anchor: { ...canvasAnchor, tileX: Number.NaN } as never }), 'tileX');
    rejects(mobileReport({ anchor: { ...canvasAnchor, layer: 'sky' } as never }), 'anchor.layer');
    rejects(mobileReport({ anchor: { ...canvasAnchor, buildingId: 'x' } as never }), 'buildingId');
    rejects(mobileReport({ anchor: { ...canvasAnchor, visualClass: 'x'.repeat(MAX_TEXT_LENGTH + 1) } as never }), 'visualClass');
  });

  it('refuses missing identity or viewport fields', () => {
    rejects(desktopReport({ username: undefined }), 'username');
    rejects(desktopReport({ world: undefined }), 'world');
    rejects(desktopReport({ userAgent: undefined }), 'userAgent');
    rejects(desktopReport({ viewport: undefined }), 'viewport');
    rejects(desktopReport({ viewport: { width: 10 } as never }), 'viewport');
  });

  it('refuses quickPicks that are not the offered ones', () => {
    rejects(mobileReport({ quickPicks: ['too-slow'] as never }), 'quickPicks');
    rejects(mobileReport({ quickPicks: 'too-small' as never }), 'quickPicks');
  });

  it('refuses a geometry block that is not an object', () => {
    rejects(mobileReport({ geometry: 'wide' as never }), 'geometry');
  });

  it('refuses a malformed sessionContext', () => {
    rejects(desktopReport({ sessionContext: 'today' as never }), 'sessionContext must be an object');
    rejects(desktopReport({ sessionContext: { gameDate: 42, surface: null } as never }), 'sessionContext.gameDate');
    rejects(desktopReport({ sessionContext: { gameDate: null, surface: 7 } as never }), 'sessionContext.surface');
  });

  it('refuses a trim marker that does not say what was dropped', () => {
    rejects(desktopReport({ trimmed: 'some' as never }), 'journalDropped');
    rejects(desktopReport({ trimmed: { screenshotDropped: false } as never }), 'journalDropped');
    rejects(desktopReport({ trimmed: { journalDropped: -1, screenshotDropped: false } }), 'journalDropped');
    rejects(desktopReport({ trimmed: { journalDropped: 3 } as never }), 'screenshotDropped');
  });
});

describe('validateBugReport — the limits it re-enforces', () => {
  it('refuses a journal longer than the documented cap', () => {
    const entry: JournalEntry = { t: 'console', ts: 1, level: 'warn', message: 'x' };
    expect(validateBugReport(desktopReport({ journal: Array(MAX_JOURNAL_ENTRIES).fill(entry) })).ok).toBe(true);
    rejects(desktopReport({ journal: Array(MAX_JOURNAL_ENTRIES + 1).fill(entry) }), 'at most 400 entries');
  });

  it('refuses a journal that is not an array, or holds a foreign entry', () => {
    rejects(desktopReport({ journal: undefined }), 'journal must be an array');
    rejects(desktopReport({ journal: ['click'] as never }), 'journal[0] must be an object');
    rejects(desktopReport({ journal: [{ t: 'click', ts: 'now', target: 'b' }] as never }), 'journal[0].ts');
    rejects(desktopReport({ journal: [{ t: 'scroll', ts: 1 }] as never }), 'journal[0].t');
    rejects(desktopReport({ journal: [{ t: 'click', ts: 1, target: 1 }] as never }), 'journal[0].target');
    rejects(desktopReport({ journal: [{ t: 'click', ts: 1, target: 'b', text: 1 }] as never }), 'journal[0].text');
    rejects(desktopReport({ journal: [{ t: 'surface', ts: 1, action: 'swap', surface: 's' }] as never }), 'journal[0].action');
    rejects(desktopReport({ journal: [{ t: 'surface', ts: 1, action: 'push', surface: 1 }] as never }), 'journal[0].surface');
    rejects(desktopReport({ journal: [{ t: 'ws-in', ts: 1, msgType: 1, payload: {} }] as never }), 'journal[0].msgType');
    rejects(desktopReport({ journal: [{ t: 'console', ts: 1, level: 'info', message: 'x' }] as never }), 'journal[0].level');
    rejects(desktopReport({ journal: [{ t: 'console', ts: 1, level: 'warn', message: 1 }] as never }), 'journal[0].message');
  });

  it('refuses a ws payload the capture failed to cut', () => {
    const big = { blob: 'x'.repeat(MAX_WS_PAYLOAD_BYTES) };
    rejects(desktopReport({ journal: [{ t: 'ws-out', ts: 1, msgType: 'REQ', payload: big }] }), 'exceeds 16 KB');
    expect(validateBugReport(desktopReport({
      journal: [{ t: 'ws-out', ts: 1, msgType: 'REQ', payload: undefined, truncated: true }],
    })).ok).toBe(true);
  });

  it('refuses free-form text beyond the cap', () => {
    const tooLong = 'x'.repeat(MAX_TEXT_LENGTH + 1);
    rejects(desktopReport({ observed: tooLong }), 'observed');
    rejects(desktopReport({ expected: tooLong }), 'expected');
    rejects(desktopReport({ freeText: tooLong }), 'freeText');
    rejects(desktopReport({ username: tooLong }), 'username');
    rejects(desktopReport({ anchor: { ...domAnchor, text: tooLong } }), 'anchor.text');
  });

  it('refuses a screenshot beyond 3 MB', () => {
    const anchor = { ...canvasAnchor, screenshotDataUrl: 'x'.repeat(MAX_SCREENSHOT_DATA_URL_LENGTH + 1) };
    rejects(mobileReport({ anchor }), 'screenshotDataUrl');
  });
});

describe('validateBugReport — path safety', () => {
  // createdAtUtc, profile and anchorKey are concatenated into the deposit filename.
  // profile is a closed union; these two are the ones a crafted report could aim through.
  it('refuses a createdAtUtc carrying a path separator or traversal', () => {
    rejects(desktopReport({ createdAtUtc: '../../etc/passwd' }), 'createdAtUtc');
    rejects(desktopReport({ createdAtUtc: '2026-08-24T09:15:00.123Z/../..' }), 'createdAtUtc');
    rejects(desktopReport({ createdAtUtc: '2026-08-24T09:15:00Z' }), 'createdAtUtc');
    rejects(desktopReport({ createdAtUtc: '2026-08-24T09:15:00.123+02:00' }), 'createdAtUtc');
  });

  it('refuses an anchorKey that is not lowercase hex', () => {
    rejects(desktopReport({ anchorKey: '../../../root/.ssh/authorized_keys' }), 'anchorKey');
    rejects(desktopReport({ anchorKey: 'a/b' }), 'anchorKey');
    rejects(desktopReport({ anchorKey: 'ABCD' }), 'anchorKey');
    rejects(desktopReport({ anchorKey: '' }), 'anchorKey');
    rejects(desktopReport({ anchorKey: undefined }), 'anchorKey');
  });
});

describe('validateBugReport — appVersion', () => {
  it('keeps a string appVersion', () => {
    const result = validateBugReport(desktopReport({ appVersion: '1.2.3' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.appVersion).toBe('1.2.3');
  });

  it('still accepts a report without appVersion', () => {
    const report = desktopReport();
    expect('appVersion' in report).toBe(false);
    expect(validateBugReport(report).ok).toBe(true);
  });

  it('rejects a non-string or over-long appVersion, accepts exactly the cap', () => {
    rejects({ ...desktopReport(), appVersion: 123 }, 'appVersion');
    rejects(desktopReport({ appVersion: 'x'.repeat(MAX_TEXT_LENGTH + 1) }), 'appVersion');
    expect(validateBugReport(desktopReport({ appVersion: 'x'.repeat(MAX_TEXT_LENGTH) })).ok).toBe(true);
  });
});
