#!/usr/bin/env node

/**
 * scripts/check-rdo-citation.js
 *
 * Deterministic implementation of `.claude/agents/citation-verifier.md`'s own "Parameter
 * counting" section (and its kind/accessor determination), so that verifying a `File.pas:Line`
 * citation in `src/shared/rdo-members.ts` against the real Pascal declaration in
 * `~/SPO-Original` no longer requires an LLM read every time.
 *
 * Who calls it today:
 *
 *   - `scripts/check-pr-rules.js` requires it: `checkCitation` -> `verifyEntrySafe` ->
 *     `verifyEntry`, run as the PR-rules step of the required CI check
 *     (`.github/workflows/ci.yml`). When every changed catalogue entry carries a `.pas` citation
 *     that MATCHes, the change takes the zero-LLM fast path (row 4 of `checkCitation`'s
 *     decision table); anything else falls back to the PR-body citation check (rows 2, 3, 5).
 *   - `scripts/rdo-citation-baseline.js`, the one-off baseline generator over the real catalogue.
 *   - Its own CLI (`describe` / `check` / `entry`), for a manual check.
 *
 * See the citation for the RDO catalogue caution: a wrong `kind`/`arity` there does not fail
 * to compile, it can crash or freeze a live production game server.
 *
 * ## Encoding
 *
 * `citation-verifier.md` names four ISO-8859-encoded files in `~/SPO-Original` that defeat a
 * naive UTF-8 read (and defeat plain `grep`, which silently reports "not found"):
 * `KernelCache.pas`, `rc4.pas`, `MediaNameGenerator.pas`, `PublicFacility.pas`. Every `.pas`
 * file is therefore read as a `Buffer` and decoded with Node's `latin1` encoding, which is
 * byte-identical to ISO-8859-1 for this purpose — never assume UTF-8.
 *
 * ## Parameter counting (mirrors citation-verifier.md verbatim)
 *
 *   - Split the parameter list at top-level `;` — each segment is one parameter group sharing
 *     a type.
 *   - Within a group, each comma-separated name before the final `:` is its own parameter
 *     (`a, b: Integer` is TWO parameters).
 *   - Modifiers (`const`, `var`, `out`) are not parameters — they qualify the group and must
 *     not break the split.
 *   - Nesting depth is tracked for `(`, `)`, `[`, `]`, `<`, `>` (generic types) so a `;` or `,`
 *     inside a nested construct is never mistaken for a top-level separator.
 *   - A default value (`= expr`) does not add or remove a parameter.
 *
 * Every scan runs over `maskInert()`'d text, so Pascal comments (`{...}`, `(*...*)`, `//...`)
 * and string literals contribute no brackets, no separators and no names. The doc's algorithm
 * assumes a comment-free parameter list; the real tree does not always provide one.
 *
 * ## Kind determination
 *
 * Read the declaration's own keyword — `function` or `procedure`. An `accessor` in the
 * catalogue corresponds to a Pascal `property` declaration
 * (`property Name: Type read GetX write SetX;`, or a field-backed
 * `property Name: Type read fName write fName;`), not a routine keyword; `access` is derived
 * from whichever of `read`/`write` are present (`read` -> `'get'`, `write` -> `'set'`).
 *
 * ## What this script does NOT do
 *
 * It does not apply citation-verifier.md's Rule 1 / Rule 2 divergence justification — that
 * judgement call (is a mismatch a legitimate, reference-client-demonstrated divergence, or a
 * real defect?) needs human/LLM review and is deliberately out of scope here. This script only
 * ever reports what the Pascal declaration and the catalogue's claim literally say; a
 * `MISMATCH` from this script is not automatically a bug in `rdo-members.ts`.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Bracket pairs the algorithm tracks nesting depth for. */
const OPENERS = new Set(['(', '[', '<']);
const CLOSERS = new Set([')', ']', '>']);

/**
 * Masks the spans that must not be *scanned* as code — Pascal comments (`{...}`, `(*...*)`,
 * `//...` to end of line) and single-quoted string literals — by replacing their interiors with
 * spaces. Newlines are preserved and the result is the SAME LENGTH as the input, so every
 * offset and line number derived from the masked text is valid against the original.
 *
 * This is not cosmetic. Without it:
 *   - a comment inside a parameter list is counted as parameters —
 *     `function F(a: Integer; // the first, primary arg` + `b: Integer)` parsed as arity **3**
 *     for a 2-parameter routine (measured against `~/SPO-Original`: 147 of 134,810
 *     declarations tree-wide carry a comment inside their parameter list);
 *   - a `>` inside a comment (`{ NULL -> use previous }`) drives the shared bracket depth
 *     negative, so the declaration's terminating top-level `;` is never recognised and the
 *     parsed span runs on into the *next* declaration (real example:
 *     `Utils/Vcl/dsintf.pas:887`);
 *   - a `;` or `,` inside a string default (`s: string = 'a;b'`) splits the parameter list.
 *
 * A wrong arity is exactly the failure this checker exists to prevent, and it fails silently —
 * it produces a confident wrong number, not an error.
 *
 * Memoised in a single slot: it is a pure function of its input, and the hot caller
 * (findDeclarationAtLine) masks the same whole-file text once per citation checked. Bounded by
 * construction — the cache never holds more than the last string masked.
 */
let maskCacheKey = null;
let maskCacheValue = null;

function maskInert(text) {
  if (text === maskCacheKey) return maskCacheValue;
  const masked = maskInertUncached(text);
  maskCacheKey = text;
  maskCacheValue = masked;
  return masked;
}

function maskInertUncached(text) {
  // Code units, not code points: every index below is compared against text.length, and
  // readPasFile always hands us latin1 text anyway.
  const out = text.split('');
  const n = text.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const ch = text[i];
    if (ch === '{') {
      const end = text.indexOf('}', i + 1);
      const stop = end === -1 ? n : end + 1; // unterminated comment runs to EOF, as Pascal reads it
      blank(i, stop);
      i = stop;
    } else if (ch === '(' && text[i + 1] === '*') {
      const end = text.indexOf('*)', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i + 2);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
    } else if (ch === "'") {
      // Pascal escapes a quote inside a literal by doubling it ('it''s').
      let k = i + 1;
      while (k < n) {
        if (text[k] === "'") {
          if (text[k + 1] === "'") k += 2;
          else break;
        } else if (text[k] === '\n') {
          break; // unterminated literal — don't swallow the rest of the file
        } else k++;
      }
      blank(i + 1, k); // keep the quotes themselves, blank the interior
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * `~/SPO-Original` by default, overridable with `SPO_ORIGINAL_DIR` (used by tests so they do
 * not depend on the real user's home directory layout).
 */
function resolveReferenceRoot() {
  return process.env.SPO_ORIGINAL_DIR || path.join(os.homedir(), 'SPO-Original');
}

/** True when the reference tree is present on disk — guards every caller that needs it. */
function referenceRootExists(root = resolveReferenceRoot()) {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves a citation's file reference against the reference root (relative paths, as they
 * appear in `rdo-members.ts` comments, e.g. `"StdBlocks/Banks.pas"`) or accepts an absolute
 * path directly.
 */
function resolvePasPath(file, root = resolveReferenceRoot()) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

/** Reads a `.pas` file as a Buffer and decodes it as ISO-8859-1 (`latin1`), never UTF-8. */
function readPasFile(file, root = resolveReferenceRoot()) {
  const resolved = resolvePasPath(file, root);
  const buf = fs.readFileSync(resolved);
  return buf.toString('latin1');
}

/**
 * Splits `str` on every top-level occurrence of `sepChar` — one not inside `()`, `[]`, or
 * `<>`. Nesting depth is shared across all three bracket kinds, matching the doc's algorithm.
 */
function splitTopLevel(str, sepChar) {
  // Scan (and accumulate) the masked text: a comment or string interior must contribute
  // neither a bracket, nor a separator, nor a parameter name.
  const scan = maskInert(str);
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (OPENERS.has(ch)) depth++;
    // Clamped at 0: `<`/`>` are Delphi-5 comparison operators as often as generic brackets, and
    // a stray closer must never drive depth negative — that silently disables every subsequent
    // top-level split (see maskInert's note on dsintf.pas:887).
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1);
    if (ch === sepChar && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Index of the first top-level occurrence of `ch` in `str`, or -1. */
function findTopLevelChar(str, ch) {
  const scan = maskInert(str);
  let depth = 0;
  for (let i = 0; i < scan.length; i++) {
    const c = scan[i];
    if (OPENERS.has(c)) depth++;
    else if (CLOSERS.has(c)) depth = Math.max(0, depth - 1);
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

/**
 * Finds the index of the bracket matching the opener at `openIdx` (same bracket kind only —
 * `(`/`)`, `[`/`]`, or `<`/`>`), or -1 if unbalanced.
 */
function findMatchingClose(str, openIdx) {
  const pairs = { '(': ')', '[': ']', '<': '>' };
  const openCh = str[openIdx];
  const closeCh = pairs[openCh];
  if (!closeCh) return -1;
  // Masked: a `)` inside `// compressor (NULL if any will do)` must not close the real list.
  const scan = maskInert(str);
  let depth = 0;
  for (let i = openIdx; i < scan.length; i++) {
    if (scan[i] === openCh) depth++;
    else if (scan[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Counts the parameters in a Delphi parameter list (the text between the outer parens, not
 * including them) per citation-verifier.md's algorithm. Returns `{ count, names }`.
 *
 * `''` (a routine with no parameter list at all) counts as 0.
 */
function countParams(paramListStr) {
  const trimmed = paramListStr.trim();
  if (trimmed === '') return { count: 0, names: [] };

  const groups = splitTopLevel(trimmed, ';');
  const names = [];
  for (const rawGroup of groups) {
    let group = rawGroup.trim();
    if (!group) continue;
    // Modifiers qualify the group; they are not parameters and must not break the split.
    group = group.replace(/^(const|var|out)\s+/i, '');
    const colonIdx = findTopLevelChar(group, ':');
    const namesPart = colonIdx === -1 ? group : group.slice(0, colonIdx);
    const groupNames = splitTopLevel(namesPart, ',')
      .map(s => s.trim())
      .filter(Boolean);
    names.push(...groupNames);
  }
  return { count: names.length, names };
}

/**
 * Parses one already-isolated declaration's text (from its leading keyword through its
 * terminating top-level `;`, inclusive) into `{ kind, name, arity?, access?, paramNames? }`.
 */
function parseDeclarationText(rawDeclText) {
  // Every decision below is taken on the masked text, so a comment can neither supply a
  // keyword, a name, a bracket, nor a `read`/`write` clause.
  const declText = maskInert(rawDeclText);
  const fnMatch = /^\s*(function|procedure)\s+([A-Za-z_][A-Za-z0-9_]*)\s*/i.exec(declText);
  if (fnMatch) {
    const kind = fnMatch[1].toLowerCase();
    const name = fnMatch[2];
    const rest = declText.slice(fnMatch[0].length);
    let arity = 0;
    let paramNames = [];
    if (rest.trimStart().startsWith('(')) {
      const openIdx = rest.indexOf('(');
      const closeIdx = findMatchingClose(rest, openIdx);
      if (closeIdx === -1) return null; // unbalanced — malformed declaration
      const paramList = rest.slice(openIdx + 1, closeIdx);
      const counted = countParams(paramList);
      arity = counted.count;
      paramNames = counted.names;
    }
    return { kind, name, arity, paramNames };
  }

  // A property may carry an indexed-property bracket (`property Modifiers [index: Integer]
  // : T read ... ;`) before its `: Type`; that bracket is skipped by simply scanning the
  // whole remainder for `read`/`write`, which never appear inside the index clause.
  const propMatch = /^\s*property\s+([A-Za-z_][A-Za-z0-9_]*)\s*/i.exec(declText);
  if (propMatch) {
    const name = propMatch[1];
    const remainder = declText.slice(propMatch[0].length);
    const access = [];
    if (/\bread\b/i.test(remainder)) access.push('get');
    if (/\bwrite\b/i.test(remainder)) access.push('set');
    return { kind: 'accessor', name, access };
  }

  return null;
}

/**
 * Locates the declaration at (or spanning) `lineNumber` (1-based) in `text`. Returns
 * `{ kind, name, arity?, access?, paramNames?, startLine, endLine, raw }`, or `null` when no
 * declaration's span covers that line — a false citation, or a line that is not a declaration
 * at all (`CITATION_NOT_FOUND`).
 */
function findDeclarationAtLine(text, lineNumber) {
  const lines = text.split('\n');
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) return null;

  // maskInert preserves length and newlines, so masked offsets and line indexes are valid
  // against `text`. Scanning the masked copy keeps a commented-out declaration
  // (`// function Foo(a, b: Integer);`) from being picked up as the enclosing declaration.
  const masked = maskInert(text);
  const maskedLines = masked.split('\n');

  const keywordRe = /^\s*(function|procedure|property)\b/i;
  let startLineIdx = null; // 0-based
  for (let i = lineNumber - 1; i >= 0; i--) {
    if (keywordRe.test(maskedLines[i])) {
      startLineIdx = i;
      break;
    }
  }
  if (startLineIdx === null) return null;

  const startOffset = lines.slice(0, startLineIdx).join('\n').length + (startLineIdx > 0 ? 1 : 0);
  const rest = text.slice(startOffset);
  const maskedRest = masked.slice(startOffset);

  // First top-level ';' terminates the declaration.
  let depth = 0;
  let endOffsetInRest = -1;
  for (let i = 0; i < maskedRest.length; i++) {
    const ch = maskedRest[i];
    if (OPENERS.has(ch)) depth++;
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      endOffsetInRest = i;
      break;
    }
  }
  if (endOffsetInRest === -1) return null;

  const declText = rest.slice(0, endOffsetInRest + 1);
  const endLineIdx = startLineIdx + declText.split('\n').length - 1;

  const startLine = startLineIdx + 1;
  const endLine = endLineIdx + 1;
  if (lineNumber < startLine || lineNumber > endLine) return null; // cited line isn't covered

  const parsed = parseDeclarationText(declText);
  if (!parsed) return null;

  return { ...parsed, startLine, endLine, raw: declText.trim() };
}

/** Reads and locates the declaration for one `{ file, line }` citation. */
function describeCitation(file, line, root = resolveReferenceRoot()) {
  const text = readPasFile(file, root);
  const found = findDeclarationAtLine(text, line);
  if (!found) return { found: false };
  return { found: true, declaration: found };
}

/**
 * Compares a found declaration against a catalogue's claim.
 * `claim` is `{ name?: string, kind: 'function'|'procedure', arity: number }` or
 * `{ name?: string, kind: 'accessor', access: ('get'|'set')[] }`.
 *
 * Verdicts: `MATCH(kind, arity)` / `MISMATCH(name)` / `MISMATCH(kind)` / `MISMATCH(arity)` /
 * `CITATION_NOT_FOUND` per the CLI contract, plus `MISMATCH(access)` — the accessor-shaped
 * sibling of `MISMATCH(arity)` that citation-verifier.md's own arity algorithm has no
 * routine-shaped equivalent for, needed because an `accessor` catalogue entry is compared on
 * `access` (`get`/`set`), not on a parameter count.
 *
 * `MISMATCH(name)` exists because kind+arity alone cannot tell "the right declaration" from "a
 * different declaration that happens to share a kind and an arity" — a citation pointing at the
 * WRONG Pascal routine, with a coincidentally matching shape, used to read as a clean MATCH.
 * Compared case-insensitively (Object Pascal identifiers are case-insensitive), and only when
 * `claim.name` is actually supplied — the standalone `check`/`describe` CLI modes have no name
 * argument and must keep working name-less; `verifyEntry`, the shape check-pr-rules.js's CI gate
 * actually calls, always supplies it.
 */
function compareClaim(found, claim) {
  if (!found) return { verdict: 'CITATION_NOT_FOUND', ok: false };

  if (claim.name && found.name && found.name.toLowerCase() !== claim.name.toLowerCase()) {
    return {
      verdict: 'MISMATCH(name)',
      ok: false,
      found,
      detail: `declaration at this line is \`${found.name}\`, not \`${claim.name}\` -- this citation does not point at ${claim.name}'s own declaration`,
    };
  }

  if (found.kind !== claim.kind) {
    return {
      verdict: 'MISMATCH(kind)',
      ok: false,
      found,
      detail: `declaration is \`${found.kind}\`, catalogue claims \`${claim.kind}\``,
    };
  }

  if (found.kind === 'accessor') {
    const foundAccess = [...found.access].sort();
    const claimAccess = [...(claim.access || [])].sort();
    const same =
      foundAccess.length === claimAccess.length && foundAccess.every((a, i) => a === claimAccess[i]);
    if (!same) {
      return {
        verdict: 'MISMATCH(access)',
        ok: false,
        found,
        detail: `declaration exposes [${found.access.join(', ')}], catalogue claims [${(claim.access || []).join(', ')}]`,
      };
    }
    return { verdict: `MATCH(accessor, [${found.access.join(', ')}])`, ok: true, found };
  }

  if (found.arity !== claim.arity) {
    return {
      verdict: 'MISMATCH(arity)',
      ok: false,
      found,
      detail: `declaration has ${found.arity} parameter(s) (${found.paramNames.join(', ')}), catalogue claims ${claim.arity}`,
    };
  }

  return { verdict: `MATCH(${found.kind}, ${found.arity})`, ok: true, found };
}

/** Verifies one `{ file, line }` citation against a claim. */
function verifyCitation(file, line, claim, root = resolveReferenceRoot()) {
  const { found, declaration } = describeCitation(file, line, root);
  return compareClaim(found ? declaration : null, claim);
}

/**
 * Verifies a catalogue entry — one or more citations — against a single claimed
 * `kind`/`arity`/`access`. This is the shape a (future, separate PR) CI wiring calls: an
 * entry's NAME, its claimed kind/arity (or access), and the citation(s) it cites.
 *
 * Overall verdict is `MATCH` only when every citation individually matches; otherwise it is
 * the first non-matching citation's verdict, and every citation's individual result is
 * reported so nothing is hidden behind an aggregate.
 */
function verifyEntry(entry, root = resolveReferenceRoot()) {
  const claim =
    entry.kind === 'accessor'
      ? { name: entry.name, kind: 'accessor', access: entry.access || [] }
      : { name: entry.name, kind: entry.kind, arity: entry.arity };

  const perCitation = (entry.citations || []).map(({ file, line }) => {
    const { found, declaration } = describeCitation(file, line, root);
    const result = compareClaim(found ? declaration : null, claim);
    return { file, line, ...result };
  });

  // An entry with no citation at all is not a pass: check-pr-rules.js exists precisely because
  // an uncited catalogue entry is a defect. Report it as its own verdict rather than throwing
  // (the previous `.find(...).verdict` threw a TypeError on an empty list) or, worse, returning
  // a MATCH that a CI caller would read as "verified".
  if (perCitation.length === 0) {
    return { name: entry.name, overallVerdict: 'NO_CITATION', ok: false, perCitation };
  }

  const allOk = perCitation.every(r => r.ok);
  const overallVerdict = allOk ? perCitation[0].verdict : perCitation.find(r => !r.ok).verdict;

  return { name: entry.name, overallVerdict, ok: allOk, perCitation };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseAccessArg(str) {
  return str
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function printCitationResult(result) {
  console.log(result.verdict);
  if (result.found) {
    const f = result.found;
    if (f.kind === 'accessor') {
      console.log(`  parsed: kind=accessor access=[${f.access.join(', ')}] (lines ${f.startLine}-${f.endLine})`);
    } else {
      console.log(`  parsed: kind=${f.kind} arity=${f.arity} params=[${f.paramNames.join(', ')}] (lines ${f.startLine}-${f.endLine})`);
    }
  }
  if (result.detail) console.log(`  ${result.detail}`);
}

function main(argv) {
  const [mode, ...rest] = argv;

  if (mode === 'describe') {
    const [file, lineStr] = rest;
    if (!file || !lineStr) {
      console.error('Usage: check-rdo-citation.js describe <file> <line>');
      return 1;
    }
    const { found, declaration } = describeCitation(file, Number(lineStr));
    if (!found) {
      console.log('CITATION_NOT_FOUND');
      return 1;
    }
    console.log(JSON.stringify(declaration, null, 2));
    return 0;
  }

  if (mode === 'check') {
    const [file, lineStr, kind, arityOrAccess] = rest;
    if (!file || !lineStr || !kind || arityOrAccess === undefined) {
      console.error('Usage: check-rdo-citation.js check <file> <line> <function|procedure|accessor> <arity|access-list>');
      return 1;
    }
    const claim =
      kind === 'accessor'
        ? { kind: 'accessor', access: parseAccessArg(arityOrAccess) }
        : { kind, arity: Number(arityOrAccess) };
    const { found, declaration } = describeCitation(file, Number(lineStr));
    const result = compareClaim(found ? declaration : null, claim);
    printCitationResult(result);
    return result.ok ? 0 : 1;
  }

  if (mode === 'entry') {
    const [json] = rest;
    if (!json) {
      console.error('Usage: check-rdo-citation.js entry \'{"name":"X","kind":"function","arity":2,"citations":[{"file":"...","line":1}]}\'');
      return 1;
    }
    const entry = JSON.parse(json);
    const result = verifyEntry(entry);
    console.log(`${result.name}: ${result.ok ? 'MATCH' : result.overallVerdict}`);
    for (const c of result.perCitation) {
      console.log(`  ${c.file}:${c.line} -> ${c.verdict}${c.detail ? ' — ' + c.detail : ''}`);
    }
    return result.ok ? 0 : 1;
  }

  console.error('Usage: check-rdo-citation.js <describe|check|entry> ...');
  return 1;
}

module.exports = {
  resolveReferenceRoot,
  referenceRootExists,
  resolvePasPath,
  readPasFile,
  maskInert,
  splitTopLevel,
  findTopLevelChar,
  findMatchingClose,
  countParams,
  parseDeclarationText,
  findDeclarationAtLine,
  describeCitation,
  compareClaim,
  verifyCitation,
  verifyEntry,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
