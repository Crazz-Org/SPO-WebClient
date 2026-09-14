#!/usr/bin/env node

/**
 * Two rules CLAUDE.md states as binding that the GitHub ruleset cannot express on its own —
 * made mechanical, so they hold without a human keeping watch.
 *
 *   1. Coverage ratchet      — "thresholds only go UP" is a numeric comparison between
 *                              jest.config.js on the base and on this branch.
 *   2. RDO catalogue         — adding to the catalogue needs the server declaration cited
 *                              as `File.pas:Line`; the PR body must carry at least one.
 *
 * Runs as a step of the `typecheck + tests` job, which is a required status check — so it
 * blocks a merge without any ruleset change. Skipped outside a pull request, where there
 * is no body to read.
 *
 *   PR_BODY=… BASE_SHA=… node scripts/check-pr-rules.js
 *
 * Exit 0 when every rule holds, 1 on the first-class failure of any of them.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const checkRdoCitation = require('./check-rdo-citation.js');

/** Touching the catalogue means citing the declaration that fixes a member's kind and arity. */
const CITATION_FILES = ['src/shared/rdo-members.ts'];
const CITATION_PATTERN = /\b[\w.-]+\.pas:\d+/i;

const THRESHOLD_METRICS = ['lines', 'functions', 'branches', 'statements'];

function normalise(file) {
  return String(file).replace(/\\/g, '/').trim();
}

/**
 * One catalogue entry line, e.g.
 *   `  Name:  { kind: 'function',  arity: 2 },  // src/server/…ts:123`
 *   `  Name:  { kind: 'accessor', access: ['get', 'set'] },  // StdBlocks/Banks.pas:40`
 * Captures: 1 name, 2 kind, 3 arity (function/procedure), 4 access list contents (accessor),
 * 5 the trailing `//` comment (everything after it, untrimmed — trim in the caller).
 */
const ENTRY_LINE_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*kind:\s*'(function|procedure|accessor)',\s*(?:arity:\s*(\d+)|access:\s*\[([^\]]*)\])\s*\},\s*(?:\/\/\s*(.*))?$/;

/**
 * One `File.pas:Line` citation as it appears verbatim in a catalogue entry's trailing comment —
 * unlike CITATION_PATTERN (which only needs to detect that SOME citation-shaped text exists
 * anywhere in free-form PR body prose, and deliberately does not capture a directory prefix),
 * this needs the FULL relative path exactly as check-rdo-citation.js's resolvePasPath expects
 * it (e.g. `Interface Server/InterfaceServer.pas`, directory and embedded space included).
 */
const PAS_CITATION_RE = /^([A-Za-z0-9_][A-Za-z0-9_./ -]*\.pas):(\d+)$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

/**
 * Parses a `git diff --unified=0` hunk stream into the set of line numbers, in the NEW
 * (HEAD-side) file, that were added or changed by this PR.
 *
 * With `--unified=0` a hunk carries no context lines — only `+`/`-` lines — so the new-file
 * line number is simply a counter that starts at the hunk header's `+start` and advances on
 * every `+` line (a `-` line consumes no new-file line number; it does not exist there). This
 * holds regardless of how git orders `-`/`+` lines within one hunk (a straight replace can be
 * emitted either way), because only `+` lines ever claim a new-file line number.
 */
function parseAddedLineNumbers(diffText) {
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const added = new Set();
  let newLineCounter = null;
  for (const line of diffText.split('\n')) {
    // A new file's section closes the previous one's hunks. Resetting here — rather than
    // skipping `---`/`+++` lines wherever they appear — is what makes the `+` test below
    // safe: once a hunk is open, a line starting with `+` is CONTENT, and an added source
    // line whose own text begins with `++` renders as `+++…`. Skipping those by their
    // prefix dropped a real added line AND left every line after it in the hunk numbered
    // one too low, which silently moves the entry the gate believes changed.
    if (line.startsWith('diff --git ')) {
      newLineCounter = null;
      continue;
    }
    const hunkMatch = hunkRe.exec(line);
    if (hunkMatch) {
      newLineCounter = Number(hunkMatch[1]);
      continue;
    }
    if (newLineCounter === null) continue; // between files: `index`, `---`, `+++`, mode lines
    if (line.startsWith('+')) {
      added.add(newLineCounter);
      newLineCounter += 1;
    }
    // A `-` line claims no new-file line number; nothing to advance. A `\ No newline…` marker
    // likewise claims none.
  }
  return added;
}

/** Every `File.pas:Line` citation in one catalogue entry's trailing comment (0, 1 or many). */
function extractPasCitations(comment) {
  if (!comment) return [];
  return comment
    .split(/[;,]/)
    .map(s => s.trim())
    // Strip the decoration a citation is commonly written with — wrapping backticks,
    // parentheses or quotes, a sentence-ending period — so `` `Kernel/Foo.pas:40` `` and
    // `Kernel/Foo.pas:40.` are read as the citations they plainly are. Nothing here can eat
    // into a real citation: PAS_CITATION_RE requires the segment to END in `:<digits>`.
    //
    // The match stays anchored to the WHOLE segment on purpose. A `.pas:N` buried in prose
    // (`// declared at Kernel/Foo.pas:40 in the server`) is deliberately NOT taken as this
    // entry's citation: an incidental mention must never be able to authorise the zero-LLM
    // fast path by happening to agree. Such an entry is reported as uncited and routed to
    // review — the safe direction, and the one the flagged-entry message names explicitly.
    .map(s => s.replace(/^[`("'[]+/, '').replace(/[`)"'\].]+$/, '').trim())
    .map(s => PAS_CITATION_RE.exec(s))
    .filter(Boolean)
    .map(m => ({ file: m[1], line: Number(m[2]) }));
}

/**
 * The 1-based line range strictly INSIDE the `RDO_MEMBERS` object literal (both braces
 * excluded), or null when the file carries no such literal (a stub, or a renamed catalogue).
 * Used to tell "a changed line that is not an entry" from "a changed line that IS an entry,
 * written in a shape ENTRY_LINE_RE cannot read" — see findChangedCatalogueEntries.
 */
function catalogueBodyRange(headLines) {
  const openIdx = headLines.findIndex(l => /\bRDO_MEMBERS\b[^=]*=\s*\{\s*$/.test(l));
  if (openIdx === -1) return null;
  for (let i = openIdx + 1; i < headLines.length; i++) {
    if (/^\}/.test(headLines[i])) return { first: openIdx + 2, last: i };
  }
  return null;
}

/**
 * Finds which specific `RDO_MEMBERS` catalogue entries this PR added or changed, by intersecting
 * the diff's changed NEW-file line numbers against the HEAD file's own entry-shaped lines — not
 * by diffing the object-literal structure semantically (each entry is one line in the real file,
 * so a line-number intersection is exact and far simpler than reparsing the TS literal).
 *
 * An entry whose line did not change — even if the file around it did, shifting its line number
 * — never appears here: `git diff` only ever reports lines whose CONTENT changed, never lines
 * that merely moved, so an untouched entry is never mistaken for a changed one.
 *
 * Returns `{ entries, unrecognised }`. `unrecognised` is the part that keeps the fast path
 * honest: a changed line INSIDE the catalogue literal that is neither blank nor a whole-line
 * `//` comment and that ENTRY_LINE_RE does not match is an entry this parser cannot read, not
 * an absence of one. Both must be reported, because "all the entries I recognised MATCH" is
 * only a safe verdict when there was nothing in the diff I failed to recognise.
 */
function findChangedCatalogueEntries(base, touchedFiles) {
  const entries = [];
  const unrecognised = [];
  for (const file of touchedFiles) {
    let diffText;
    try {
      diffText = git(['diff', '--unified=0', '--no-renames', `${base}...HEAD`, '--', file]);
    } catch (err) {
      throw new Error(`git diff of ${file} failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    if (!diffText) continue;
    const addedLines = parseAddedLineNumbers(diffText);
    if (addedLines.size === 0) continue;

    let headContent;
    try {
      headContent = git(['show', `HEAD:${file}`]);
    } catch {
      continue; // file no longer exists at HEAD (e.g. deleted by this PR) — nothing to check here
    }
    const headLines = headContent.split('\n');
    const body = catalogueBodyRange(headLines);

    for (const lineNo of Array.from(addedLines).sort((a, b) => a - b)) {
      const text = headLines[lineNo - 1];
      if (text === undefined) continue;
      const m = ENTRY_LINE_RE.exec(text);
      if (!m) {
        // Outside the catalogue literal — the header doc comment, the `RdoMemberSpec` type,
        // the helpers below it — a line this grammar does not match is genuinely not an
        // entry, and means nothing here.
        //
        // Inside it, only a blank line or a whole-line `//` comment is innocent. Anything
        // else is an entry written in a shape ENTRY_LINE_RE cannot read — spread over
        // several lines, missing its trailing comma, double-quoted, carrying an extra field
        // — and treating it as "not an entry" is exactly how a WRONG citation passes in
        // silence: the entry is dropped, and one OTHER entry's clean MATCH then satisfies
        // the zero-LLM fast path with nothing required of the PR body. Measured on the real
        // catalogue: 157 entries match, 0 non-comment non-blank lines do not, so this never
        // fires on the file as it stands.
        if (body && lineNo >= body.first && lineNo <= body.last) {
          const trimmed = text.trim();
          if (trimmed !== '' && !trimmed.startsWith('//')) {
            unrecognised.push({ file, line: lineNo, text: trimmed });
          }
        }
        continue;
      }
      const [, name, kind, arityStr, accessStr, rawComment] = m;
      entries.push({
        name,
        kind,
        arity: arityStr !== undefined ? Number(arityStr) : undefined,
        access:
          accessStr !== undefined
            ? accessStr
                .split(',')
                .map(s => s.trim().replace(/^'/, '').replace(/'$/, ''))
                .filter(Boolean)
            : undefined,
        citations: extractPasCitations((rawComment || '').trim()),
        file,
        line: lineNo,
      });
    }
  }
  return { entries, unrecognised };
}

/**
 * Runs check-rdo-citation.js's verifyEntry(), converting a thrown error (e.g. the cited `.pas`
 * file itself does not exist under the reference root — verifyEntry/readPasFile do not guard
 * that) into a verdict instead of letting it crash the gate.
 */
function verifyEntrySafe(entry) {
  try {
    return checkRdoCitation.verifyEntry(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: entry.name,
      overallVerdict: 'PARSER_ERROR',
      ok: false,
      perCitation: entry.citations.map(c => ({ ...c, verdict: 'PARSER_ERROR', ok: false, detail: message })),
    };
  }
}

/** One flagged entry's one-line explanation for the CI/PR-body-facing detail message. */
function describeFlagged(entry) {
  if (entry.citations.length === 0) {
    return `${entry.name} (${entry.file}:${entry.line}): no .pas citation -- unverifiable by the parser (may be a legitimate TS-reference-only entry; needs human/citation-verifier review)`;
  }
  const badCitations = (entry.perCitation || [])
    .filter(c => !c.ok)
    .map(c => `${c.file}:${c.line} -> ${c.verdict}${c.detail ? ' (' + c.detail + ')' : ''}`)
    .join('; ');
  return `${entry.name} (${entry.file}:${entry.line}): ${entry.verdict}${badCitations ? ' -- ' + badCitations : ''}`;
}

/** Classifies one changed entry: citations present + parser-verified, or flagged for review. */
function classifyEntry(entry) {
  if (entry.citations.length === 0) {
    return { ...entry, verdict: 'UNVERIFIABLE(no .pas citation)', ok: null };
  }
  const result = verifyEntrySafe(entry);
  return { ...entry, verdict: result.overallVerdict, ok: result.ok, perCitation: result.perCitation };
}

/**
 * The pre-parser behaviour: today's PR-body-citation-pattern check, plus a note explaining WHY
 * the parser itself could not be used — printed on both the pass and the fail branch, so
 * "can't verify" is never a silent pass (item 6 of the wiring spec).
 */
function legacyCitationCheck(touched, body, skipReason) {
  if (CITATION_PATTERN.test(body ?? '')) {
    return {
      ok: true,
      detail: `catalogue changed, declaration cited in the PR body (parser verification skipped: ${skipReason})`,
    };
  }
  return {
    ok: false,
    detail:
      `${touched.join(', ')} changed, but the PR body cites no server declaration ` +
      `(parser verification skipped: ${skipReason}).\n` +
      `    A member's kind and arity come from the declaring unit in ../SPO-Original\n` +
      `    (Kernel/, DServer/, or the Voyager unit) — read it with\n` +
      `    delphi-archaeologist and cite it as \`File.pas:Line\` in the PR body.`,
  };
}

/**
 * The RDO citation gate. `base` is optional (a direct/unit-test call may omit it, in which case
 * the parser has no diff to work from and this behaves exactly as the pre-parser gate did); when
 * `checkCitation` is reached from `main()`, `base` is always the resolved diff base, so the fast
 * path below is live in CI.
 *
 * Decision table:
 *   1. rdo-members.ts untouched                              -> ok, "catalogue untouched"
 *   2. touched, but no base / diff unparseable / 0 entries    -> legacy PR-body check (+ note)
 *   3. touched, entries found, but ~/SPO-Original unavailable -> legacy PR-body check (+ note)
 *   4. every changed entry has a `.pas` citation and MATCHes,
 *      AND every changed line inside the catalogue literal
 *      was recognised as an entry                            -> ok, zero-LLM-token fast path
 *   5. otherwise (a MISMATCH/CITATION_NOT_FOUND/PARSER_ERROR,
 *      an entry with no `.pas` citation at all, or a changed
 *      line the entry grammar could not read)                -> legacy PR-body check, but the
 *                                                                 detail always names which
 *                                                                 entries the parser flagged and
 *                                                                 why (pass or fail)
 *
 * Row 4's second clause is load-bearing and was added after a probe passed a wrong citation in
 * silence: with only "every entry I FOUND matches", a changed entry whose line shape the grammar
 * missed was dropped, and a sibling entry's clean MATCH then carried the whole file through with
 * nothing asked of the PR body — weaker than the pre-parser gate, which at least demanded a
 * citation somewhere. The fast path must be earned by the whole diff, not by the readable part.
 */
function checkCitation(files, body, base) {
  const touched = files.map(normalise).filter(f => CITATION_FILES.includes(f));
  if (touched.length === 0) return { ok: true, detail: 'catalogue untouched' };

  let entries = null;
  let unrecognised = [];
  let diffFailureNote = null;
  if (base) {
    try {
      ({ entries, unrecognised } = findChangedCatalogueEntries(base, touched));
    } catch (err) {
      entries = null;
      unrecognised = [];
      diffFailureNote = err instanceof Error ? err.message : String(err);
    }
  }

  const describeUnrecognised = u =>
    `${u.file}:${u.line}: \`${u.text}\` -- a changed line inside the catalogue that the entry ` +
    `parser cannot read (entry spread over several lines? missing trailing comma? different ` +
    `quoting?) -- NOT parser-verified`;

  if (entries === null || entries.length === 0) {
    const reason =
      diffFailureNote ||
      (unrecognised.length > 0
        ? `${unrecognised.length} changed line(s) inside the catalogue literal are not in a shape ` +
          `the entry parser reads: ${unrecognised.map(u => `${u.file}:${u.line}`).join(', ')}`
        : base
          ? 'no catalogue entries could be identified in the diff'
          : 'no diff base available to the citation parser');
    return legacyCitationCheck(touched, body, reason);
  }

  if (!checkRdoCitation.referenceRootExists()) {
    return legacyCitationCheck(
      touched,
      body,
      `~/SPO-Original (or $SPO_ORIGINAL_DIR) is not available -- cannot parser-verify the ` +
        `${entries.length} changed ${entries.length === 1 ? 'entry' : 'entries'} (${entries.map(e => e.name).join(', ')})`,
    );
  }

  const classified = entries.map(classifyEntry);
  // An unread line is not a passed line: the fast path needs every changed entry to MATCH *and*
  // nothing in the diff to have gone unrecognised.
  const clean = classified.every(e => e.ok === true) && unrecognised.length === 0;

  if (clean) {
    return {
      ok: true,
      detail: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} changed, all parser-verified MATCH -- citation-verifier not required`,
    };
  }

  const flagged = [
    ...classified.filter(e => e.ok !== true).map(describeFlagged),
    ...unrecognised.map(describeUnrecognised),
  ];

  if (CITATION_PATTERN.test(body ?? '')) {
    return {
      ok: true,
      detail:
        `catalogue changed, declaration cited in the PR body -- parser flagged ${flagged.length} ` +
        `${flagged.length === 1 ? 'entry' : 'entries'} for citation-verifier review:\n` +
        flagged.map(f => `      - ${f}`).join('\n'),
    };
  }
  return {
    ok: false,
    detail:
      `${touched.join(', ')} changed; the following ${flagged.length === 1 ? 'entry needs' : 'entries need'} ` +
      `citation-verifier review and the PR body cites no server declaration either:\n` +
      flagged.map(f => `      - ${f}`).join('\n') +
      `\n    A member's kind and arity come from the declaring unit in ../SPO-Original\n` +
      `    (Kernel/, DServer/, or the Voyager unit) — read it with\n` +
      `    delphi-archaeologist and cite it as \`File.pas:Line\` in the PR body.`,
  };
}

/**
 * Every scope/metric the base declares must still exist and must not be lower. New scopes
 * and new metrics are free; only a retreat is a failure.
 */
function thresholdRegressions(base, head) {
  const out = [];
  for (const [scope, metrics] of Object.entries(base ?? {})) {
    const headMetrics = (head ?? {})[scope];
    if (!headMetrics) {
      out.push({ scope, metric: '*', from: 'present', to: 'removed' });
      continue;
    }
    for (const metric of THRESHOLD_METRICS) {
      if (typeof metrics[metric] !== 'number') continue;
      const after = headMetrics[metric];
      if (typeof after !== 'number') {
        out.push({ scope, metric, from: metrics[metric], to: 'removed' });
      } else if (after < metrics[metric]) {
        out.push({ scope, metric, from: metrics[metric], to: after });
      }
    }
  }
  return out;
}

function checkThresholds(base, head) {
  const regressions = thresholdRegressions(base, head);
  if (regressions.length === 0) return { ok: true, detail: 'no threshold lowered' };
  return {
    ok: false,
    detail:
      'jest.config.js thresholds only go UP:\n' +
      regressions
        .map(r => `      ${r.scope} ${r.metric}: ${r.from} -> ${r.to}`)
        .join('\n'),
  };
}

/**
 * The merge-base with the pull request's base, else origin/main — same semantics as
 * coverage-changed.js.
 *
 * `BASE_SHA` must name the base BRANCH (`origin/main`), not a commit frozen when the pull
 * request was opened: CI checks out the merge ref, so a stale sha makes `merge-base` return
 * that sha itself and every file the base gained since is reported as this branch's. See the
 * comment on the step in .github/workflows/ci.yml. A sha still works for a local run, where
 * the caller picks it deliberately.
 */
function diffBase(baseSha) {
  for (const ref of [baseSha, 'origin/main', 'main'].filter(Boolean)) {
    try {
      return git(['merge-base', 'HEAD', ref]);
    } catch {
      // Try the next ref.
    }
  }
  return null;
}

/**
 * `--no-renames` is load-bearing. Git detects renames by default and `--name-only` then
 * prints only the DESTINATION, so moving `src/shared/rdo-frame.ts` to another path reported
 * as one unprotected new file and unlocked the wire emitter with no label. Without rename
 * detection the same change is a delete of the old path plus an add of the new one, so both
 * sides are judged — which is what `PROTECTED_FILES` and `PROTECTED_PREFIXES` need.
 */
function changedFiles(base) {
  return git(['diff', '--name-only', '--no-renames', `${base}...HEAD`])
    .split('\n')
    .map(normalise)
    .filter(Boolean);
}

/**
 * jest.config.js as of a commit. It is plain CommonJS with no imports and no side effects,
 * so requiring a copy of it is safe and is the only way to read the values the way Jest
 * itself would — a regex over the text would miss a restructured object.
 *
 * The two failure modes are not the same and must not collapse into one. The base genuinely
 * not having the file is fine — there is nothing to ratchet against. Having it and being
 * unable to read it is a failure: passing the ratchet on a base nobody read is how a lowered
 * threshold would slip through unnoticed.
 *
 * Returns `{ state: 'ok', thresholds }` | `{ state: 'absent' }` | `{ state: 'unreadable', reason }`.
 */
function thresholdsAt(ref) {
  try {
    git(['cat-file', '-e', `${ref}:jest.config.js`]);
  } catch {
    return { state: 'absent' };
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-rules-')), 'jest.config.js');
  try {
    fs.writeFileSync(file, git(['show', `${ref}:jest.config.js`]));
    return { state: 'ok', thresholds: require(file).coverageThreshold ?? {} };
  } catch (err) {
    return { state: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

/**
 * The ratchet verdict for a base state — pure, so the fail-closed behaviour is testable
 * without a git repository.
 */
function ratchetResult(baseState, headThresholds) {
  if (baseState.state === 'absent') {
    return { ok: true, detail: 'the base has no jest.config.js — nothing to ratchet against' };
  }
  if (baseState.state === 'unreadable') {
    return {
      ok: false,
      detail:
        `jest.config.js exists on the base but could not be read: ${baseState.reason}\n` +
        `    The ratchet is not judged on an unread base — fix the read, do not skip the rule.`,
    };
  }
  return checkThresholds(baseState.thresholds, headThresholds);
}

function main() {
  const base = diffBase(process.env.BASE_SHA);
  if (!base) {
    // Fail CLOSED. This used to fall back to `git diff HEAD` — the WORKING TREE, empty in a
    // clean CI checkout — so both rules reported ok over zero files and the run printed
    // `0 changed file(s) against HEAD`, which reads like normal output. A shallow checkout, a
    // force-pushed base or a dropped `fetch-depth: 0` silently disarmed every rule.
    console.error('PR rules — FAIL: no diff base could be resolved.');
    console.error('    Tried BASE_SHA, origin/main and main; none produced a merge-base with HEAD.');
    console.error('    Without a base there is no changed-file set, and both rules would');
    console.error('    pass over nothing. In CI this usually means the checkout lost its history');
    console.error('    (.github/workflows/ci.yml sets `fetch-depth: 0` for exactly this reason).');
    return 1;
  }
  const files = changedFiles(base);
  const body = process.env.PR_BODY ?? '';

  const results = [
    ['RDO citation', checkCitation(files, body, base)],
  ];

  let headThresholds;
  try {
    headThresholds = require(path.resolve('jest.config.js')).coverageThreshold ?? {};
  } catch (err) {
    console.error(`PR rules — FAIL: jest.config.js on this branch could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  results.push(['coverage ratchet', ratchetResult(thresholdsAt(base), headThresholds)]);

  console.log(`PR rules — ${files.length} changed file(s) against ${base.slice(0, 8)}`);
  let failed = 0;
  for (const [name, result] of results) {
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${name}: ${result.detail}`);
    if (!result.ok) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

module.exports = {
  CITATION_FILES,
  checkCitation,
  thresholdRegressions,
  checkThresholds,
  ratchetResult,
  // Exposed for direct unit testing of the diff-scoping machinery (Part A of the citation-
  // verifier wiring); not part of the CLI's own surface.
  parseAddedLineNumbers,
  extractPasCitations,
  findChangedCatalogueEntries,
};

if (require.main === module) {
  process.exit(main());
}
