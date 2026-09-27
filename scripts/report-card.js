#!/usr/bin/env node
'use strict';
// npm run report:card -- <report.json>
// npm run report:card -- --check-public <report.json> <candidate.md>
//
// Render mode renders ONE queued bug report (~/.spo-reports/<file>.json) into a raw, unjudged
// markdown card — no reproduction, no category/size/area, no "confirmed" verdict. This is the
// mechanical half of the human-first intake redesign (SPO-Pipeline's orchestrator/report-intake.js).
// The raw render is for the PRIVATE intake repository only (SPO-Pipeline config.reportIntakeRepo,
// card P) and must never be posted publicly: it carries the reporter's username, their typed text
// and the journal. A human reads it and replies "confirm"/"discard", and only THEN does any LLM
// look at it. This script must stay pure judgement-free — the moment it infers anything about
// whether the report is a real defect, the whole point of putting a human in front of the raw
// evidence first is lost.
//
// --check-public mode is the mechanical backstop before a drafted card reaches the PUBLIC board:
// it looks for the report's private material (username as a whole word; any MIN_QUOTE_CHARS
// window of observed/expected/freeText not also in the on-screen anchor.text; any journal
// ws-in/ws-out payload string or console message of MIN_QUOTE_CHARS+ chars) in the candidate,
// case-insensitively with whitespace collapsed. It prints only the category of each hit, never
// the matched text.
//   exit 0 : no hit, stdout empty
//   exit 1 : at least one hit -- stdout lines `leak: username` / `leak: free-text` / `leak: journal`
//   exit 2 : usage error, unreadable file, invalid JSON, or failed validation
//   exit 3 : schema version mismatch -- same found:/expected: stdout as render mode
//
// Schema knowledge lives beside the schema, not in the driving pipeline (SPO-Pipeline's own "one
// rule": it never encodes product-repo knowledge, only relays opaque bytes) -- this script reads
// src/shared/bug-report-schema.ts directly (via esbuild, already a devDependency, so a version
// bump to BUG_REPORT_SCHEMA_VERSION or a field rename is caught here automatically, never a stale
// second copy of the contract).
//
// Render mode:
//   exit 0 : stdout is
//              anchorKey: <hex>
//              profile: desktop|mobile
//              kind: wrong-data|broken-action|visual|suggestion
//              title: <one line>
//              ---
//              <body markdown to EOF>
//   exit 2 : usage error, unreadable file, invalid JSON, or a validation failure OTHER than a
//            version mismatch (stderr names the reason)
//   exit 3 : schema version mismatch -- stdout is
//              found: <value found in the report, or "missing">
//              expected: <BUG_REPORT_SCHEMA_VERSION>

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'src', 'shared', 'bug-report-schema.ts');

// Github's own issue-body cap is 65536 bytes; stay comfortably under it. The journal block is
// the one unbounded part of a report (up to MAX_JOURNAL_ENTRIES=400 entries, each up to
// MAX_WS_PAYLOAD_BYTES=16KB) -- so it is the one thing this script trims, oldest-first, exactly
// the way the capture itself trims to fit MAX_BODY_BYTES (bug-report-schema.ts's own ReportTrim).
const MAX_CARD_BYTES = 60000;

function usageExit(message) {
  if (message) console.error(`report-card: ${message}`);
  console.error('usage: report-card.js <report.json> | --check-public <report.json> <candidate.md>');
  process.exit(2);
}

// Compiles bug-report-schema.ts to an in-memory CJS module and requires it from a temp file --
// the same "no second copy of the contract" reasoning driving this whole script. esbuild is
// already a devDependency (package.json's build:terrain-test uses it the same way).
function loadSchemaModule() {
  const esbuild = require('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [SCHEMA_PATH],
    bundle: false,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  // mkdtempSync (not a predictable path.join(os.tmpdir(), ...) name) -- the random suffix and
  // exclusive directory creation are what make this safe against a symlink/race attack on a
  // shared temp directory; a guessable filename there is not.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-card-schema-'));
  const tmpFile = path.join(tmpDir, 'schema.cjs');
  fs.writeFileSync(tmpFile, code);
  try {
    return require(tmpFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Backslash must be escaped BEFORE the pipe -- escaping `|` alone on a value that already
// contains a literal backslash (e.g. a Windows-style path in a componentChain entry) would
// produce an ambiguous sequence a markdown table reader cannot unescape correctly.
function escapeForTable(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return '_(no anchor)_';
  if (anchor.kind === 'dom') {
    const lines = [
      `- **kind:** dom`,
      `- **component chain:** ${(anchor.componentChain || []).join(' > ') || '_(empty)_'}`,
      `- **css chain:** \`${anchor.cssChain || ''}\``,
      `- **text:** ${anchor.text ? `"${anchor.text}"` : '_(empty)_'}`,
    ];
    return lines.join('\n');
  }
  if (anchor.kind === 'canvas') {
    const lines = [
      `- **kind:** canvas`,
      `- **tile:** (${anchor.tileX}, ${anchor.tileY})`,
      `- **layer:** ${anchor.layer}`,
      anchor.buildingId !== undefined ? `- **buildingId:** ${anchor.buildingId}` : null,
      anchor.visualClass !== undefined ? `- **visualClass:** ${anchor.visualClass}` : null,
      anchor.screenshotDataUrl ? `- **screenshot:** captured (data URL, not embedded here)` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }
  return `_(unrecognized anchor kind "${anchor.kind}")_`;
}

function renderGeometry(geometry) {
  if (!geometry) return null;
  const lines = ['### Geometry (raw numbers, no threshold applied)', ''];
  lines.push(`- **viewport:** ${geometry.viewport?.width} x ${geometry.viewport?.height}`);
  lines.push(`- **orientation:** ${geometry.orientation}`);
  lines.push(`- **devicePixelRatio:** ${geometry.devicePixelRatio}`);
  lines.push(
    `- **visualViewportHeight:** ${geometry.visualViewportHeight === null ? 'null (no visualViewport — unknown, not "closed")' : geometry.visualViewportHeight}`
  );
  if (geometry.safeAreaInsets) {
    const s = geometry.safeAreaInsets;
    lines.push(`- **safeAreaInsets:** top ${s.top} right ${s.right} bottom ${s.bottom} left ${s.left}`);
  }
  const flaggedChain = geometry.elements && geometry.elements[0] && geometry.elements[0].componentChain;
  if (flaggedChain && flaggedChain.length > 0) {
    lines.push(`- **flagged element's component chain:** ${flaggedChain.join(' > ')}`);
  }
  lines.push(`- **occludedBy:** ${geometry.occludedBy || '_(none)_'}`);
  if (geometry.overflowParent) {
    const o = geometry.overflowParent;
    lines.push(`- **overflowParent (px past the nearest scroll/clip parent):** top ${o.top} right ${o.right} bottom ${o.bottom} left ${o.left}`);
  } else {
    lines.push(`- **overflowParent:** null`);
  }
  lines.push('', '| selector | x | y | width | height |', '|---|---|---|---|---|');
  for (const el of geometry.elements || []) {
    lines.push(
      `| \`${escapeForTable(el.selector)}\` | ${el.rect.x} | ${el.rect.y} | ${el.rect.width} | ${el.rect.height} |`
    );
  }
  return lines.join('\n');
}

function renderJournal(journal, byteBudget) {
  const full = JSON.stringify(journal, null, 2);
  if (Buffer.byteLength(full, 'utf8') <= byteBudget) {
    return { text: full, droppedCount: 0 };
  }
  // Drop from the oldest end (index 0) until it fits, mirroring the capture's own trim
  // direction (bug-report-schema.ts's ReportTrim: "journal entries dropped from the oldest
  // end").
  let entries = journal.slice();
  let dropped = 0;
  while (entries.length > 0) {
    const text = JSON.stringify(entries, null, 2);
    if (Buffer.byteLength(text, 'utf8') <= byteBudget) {
      return { text, droppedCount: dropped };
    }
    entries = entries.slice(1);
    dropped++;
  }
  return { text: '[]', droppedCount: dropped };
}

function truncateForTitle(text, max) {
  const t = (text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function buildTitle(report) {
  const anchorLabel =
    report.anchor && report.anchor.kind === 'dom'
      ? report.anchor.text || (report.anchor.componentChain || []).join(' > ')
      : report.anchor && report.anchor.kind === 'canvas'
      ? `tile (${report.anchor.tileX},${report.anchor.tileY})`
      : 'unknown anchor';
  // `suggestion` reports get their own prefix -- "[report]" reads as a defect on the board, and
  // this is explicitly the reporter saying it is not one. See BugReportKind's own comment.
  const tag = report.kind === 'suggestion' ? '[suggestion]' : '[report]';
  return `${tag} ${report.profile} · ${truncateForTitle(anchorLabel, 80)}`;
}

function buildBody(report, journalByteBudget) {
  const lines = [];

  lines.push('| field | value |', '|---|---|');
  lines.push(`| profile | ${report.profile} |`);
  lines.push(`| kind | ${report.kind} |`);
  lines.push(`| createdAtUtc | ${report.createdAtUtc} |`);
  if (report.receivedAtUtc) lines.push(`| receivedAtUtc | ${report.receivedAtUtc} |`);
  lines.push(`| username | ${escapeForTable(report.username)} |`);
  lines.push(`| world | ${escapeForTable(report.world)} |`);
  lines.push(`| viewport | ${report.viewport.width} x ${report.viewport.height} |`);
  if (report.sessionContext) {
    const ctx = report.sessionContext;
    lines.push(`| in-game date | ${ctx.gameDate || '_(unknown — not yet loaded at flag-time)_'} |`);
    lines.push(`| surface | ${ctx.surface || '_(none — no surface open)_'} |`);
  }
  lines.push('');

  lines.push('### Anchor', '', renderAnchor(report.anchor), '');

  if (report.profile === 'desktop') {
    lines.push('### Observed', '', `> ${(report.observed || '_(empty)_').split('\n').join('\n> ')}`, '');
    lines.push('### Expected', '', `> ${(report.expected || '_(empty)_').split('\n').join('\n> ')}`, '');
  } else {
    lines.push('### Quick picks', '');
    if (report.quickPicks && report.quickPicks.length > 0) {
      for (const p of report.quickPicks) lines.push(`- ${p}`);
    } else {
      lines.push('_(none selected)_');
    }
    lines.push('', '### Free text', '', report.freeText ? `> ${report.freeText.split('\n').join('\n> ')}` : '_(none)_', '');
  }

  const geometryMd = renderGeometry(report.geometry);
  if (geometryMd) lines.push(geometryMd, '');

  if (report.trimmed) {
    lines.push(
      '### ⚠ This report was trimmed on capture',
      '',
      `- journal entries dropped: ${report.trimmed.journalDropped}`,
      `- screenshot dropped: ${report.trimmed.screenshotDropped}`,
      ''
    );
  }

  const { text: journalText, droppedCount } = renderJournal(report.journal || [], journalByteBudget);
  lines.push(
    `<details><summary>journal (${(report.journal || []).length} entries captured${
      droppedCount > 0 ? `, ${droppedCount} oldest dropped here to fit the issue body` : ''
    })</summary>`,
    '',
    '```json',
    journalText,
    '```',
    '</details>',
    ''
  );

  lines.push(`<!-- anchorKey: ${report.anchorKey} -->`, '');
  lines.push(`Source: /triage-report queue (raw intake), ${new Date().toISOString().slice(0, 10)}`);

  return lines.join('\n');
}

function loadValidatedReport(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    usageExit(`cannot read ${file}: ${err.message}`);
    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    usageExit(`${file} is not valid JSON`);
    return undefined;
  }

  const schema = loadSchemaModule();

  const foundVersion = parsed && typeof parsed === 'object' ? parsed.version : undefined;
  if (foundVersion !== schema.BUG_REPORT_SCHEMA_VERSION) {
    console.log(`found: ${foundVersion === undefined ? 'missing' : foundVersion}`);
    console.log(`expected: ${schema.BUG_REPORT_SCHEMA_VERSION}`);
    process.exit(3);
  }

  const validated = schema.validateBugReport(parsed);
  if (!validated.ok) {
    usageExit(`${file} failed validation: ${validated.error}`);
    return undefined;
  }
  return validated.report;
}

// Shortest quote treated as a leak. Shorter strings collide with ordinary prose too often to be
// a useful signal; the drafting prompt, not this check, guards below it.
const MIN_QUOTE_CHARS = 24;

function normalize(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

function findLeaks(report, candidateText) {
  const candidate = normalize(candidateText);
  const leaks = [];

  const u = normalize(report.username || '').trim();
  if (u) {
    const re = new RegExp('(^|[^\\p{L}\\p{N}_])' + escapeRegExp(u) + '($|[^\\p{L}\\p{N}_])', 'u');
    if (re.test(candidate)) leaks.push('username');
  }

  const windows = new Set();
  for (let i = 0; i + MIN_QUOTE_CHARS <= candidate.length; i++) {
    windows.add(candidate.slice(i, i + MIN_QUOTE_CHARS));
  }
  const anchorNorm =
    report.anchor && report.anchor.kind === 'dom' && report.anchor.text ? normalize(report.anchor.text) : '';
  let freeTextHit = false;
  for (const field of [report.observed, report.expected, report.freeText]) {
    if (typeof field !== 'string' || freeTextHit) continue;
    const text = normalize(field);
    for (let i = 0; i + MIN_QUOTE_CHARS <= text.length; i++) {
      const w = text.slice(i, i + MIN_QUOTE_CHARS);
      if (anchorNorm.includes(w)) continue;
      if (windows.has(w)) {
        freeTextHit = true;
        break;
      }
    }
  }
  if (freeTextHit) leaks.push('free-text');

  const journalStrings = [];
  for (const entry of report.journal || []) {
    if (entry.t === 'ws-in' || entry.t === 'ws-out') collectStrings(entry.payload, journalStrings);
    else if (entry.t === 'console') collectStrings(entry.message, journalStrings);
  }
  const journalHit = journalStrings.some((s) => {
    const n = normalize(s);
    return n.length >= MIN_QUOTE_CHARS && candidate.includes(n);
  });
  if (journalHit) leaks.push('journal');

  return leaks;
}

function checkPublic(reportFile, candidateFile) {
  if (!reportFile || !candidateFile) usageExit('--check-public needs <report.json> <candidate.md>');
  const report = loadValidatedReport(reportFile);
  let candidate;
  try {
    candidate = fs.readFileSync(candidateFile, 'utf8');
  } catch (err) {
    usageExit(`cannot read ${candidateFile}: ${err.code || 'read error'}`);
    return;
  }
  const leaks = findLeaks(report, candidate);
  for (const l of leaks) process.stdout.write(`leak: ${l}\n`);
  process.exit(leaks.length > 0 ? 1 : 0);
}

function main() {
  if (process.argv[2] === '--check-public') {
    checkPublic(process.argv[3], process.argv[4]);
    return;
  }
  const file = process.argv[2];
  if (!file) usageExit();

  const report = loadValidatedReport(file);
  const title = buildTitle(report);

  // Budget the journal against everything else already rendered, so the whole card stays under
  // MAX_CARD_BYTES even with a full-size journal.
  const headerAndFooterEstimate = 2000; // generous fixed allowance for the non-journal sections
  const journalByteBudget = Math.max(500, MAX_CARD_BYTES - headerAndFooterEstimate);
  const body = buildBody(report, journalByteBudget);

  process.stdout.write(`anchorKey: ${report.anchorKey}\n`);
  process.stdout.write(`profile: ${report.profile}\n`);
  process.stdout.write(`kind: ${report.kind}\n`);
  process.stdout.write(`title: ${title}\n`);
  process.stdout.write('---\n');
  process.stdout.write(body);
  process.stdout.write('\n');
}

main();
