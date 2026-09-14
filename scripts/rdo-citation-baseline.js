#!/usr/bin/env node

/**
 * scripts/rdo-citation-baseline.js
 *
 * One-off generator: runs scripts/check-rdo-citation.js's deterministic parser over every
 * real `.pas`-cited entry currently in src/shared/rdo-members.ts and writes the result to
 * scripts/rdo-citation-baseline.json. Never edits rdo-members.ts itself — a live RDO catalogue
 * entry is high-stakes, and any apparent mismatch this baseline records needs proper
 * human/citation-verifier review, not a silent "fix" here (Rule 1/Rule 2 divergences from
 * citation-verifier.md are legitimate and are NOT bugs).
 *
 * Scope: an entry is "real .pas-cited" only when its OWN trailing `//` comment (the one on
 * the entry's line) contains a `File.pas:Line` citation. Many entries cite only a TypeScript
 * reference-client call site instead (Rule 2 in citation-verifier.md: the reference client's
 * own demonstrated emission wins) — those are out of scope and are not in this baseline.
 * Citations appearing only in prose comments elsewhere in the file (the docblock, or a
 * multi-line explanatory comment above an entry) are likewise out of scope: they justify a
 * divergence, they are not the entry's own citation.
 *
 * Usage:
 *   node scripts/rdo-citation-baseline.js            # (re)write scripts/rdo-citation-baseline.json
 *   node scripts/rdo-citation-baseline.js --check     # exit 1 if the checked-in file is stale
 */

'use strict';

const fs = require('fs');
const path = require('path');
const checker = require('./check-rdo-citation.js');

const RDO_MEMBERS_PATH = path.join(__dirname, '..', 'src', 'shared', 'rdo-members.ts');
const BASELINE_PATH = path.join(__dirname, 'rdo-citation-baseline.json');

/** Matches one catalogue entry line, e.g. `Name: { kind: 'function', arity: 2 }, // comment`. */
const ENTRY_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*kind:\s*'(function|procedure|accessor)'\s*,\s*(?:arity:\s*(\d+)|access:\s*\[([^\]]*)\])\s*\},\s*(?:\/\/\s*(.*))?$/;

/** A `File.pas:Line` reference inside a trailing comment (paths may contain spaces). */
const PAS_CITE_RE = /([A-Za-z0-9_.][A-Za-z0-9_./ -]*\.pas):(\d+)/g;

/**
 * Extracts every in-scope (own trailing-comment `.pas:Line`) catalogue entry from
 * rdo-members.ts's source text.
 */
function extractPasCitedEntries(source) {
  const entries = [];
  for (const line of source.split('\n')) {
    const m = ENTRY_RE.exec(line);
    if (!m) continue;
    const [, name, kind, arityStr, accessStr, comment] = m;
    if (!comment) continue;

    const citations = [...comment.matchAll(PAS_CITE_RE)].map(([, file, lineStr]) => ({
      file: file.trim(),
      line: Number(lineStr),
    }));
    if (citations.length === 0) continue; // TS-only citation, or none — out of scope

    const entry = { name, kind, citations };
    if (kind === 'accessor') {
      entry.access = accessStr
        .split(',')
        .map(s => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
    } else {
      entry.arity = Number(arityStr);
    }
    entries.push(entry);
  }
  return entries;
}

function buildBaseline() {
  const source = fs.readFileSync(RDO_MEMBERS_PATH, 'utf8');
  const entries = extractPasCitedEntries(source);

  const root = checker.resolveReferenceRoot();
  if (!checker.referenceRootExists(root)) {
    throw new Error(`~/SPO-Original not found at ${root} — cannot build the baseline without it.`);
  }

  const rows = entries.map(entry => {
    const result = checker.verifyEntry(entry, root);
    return {
      name: entry.name,
      catalogue:
        entry.kind === 'accessor'
          ? { kind: entry.kind, access: entry.access }
          : { kind: entry.kind, arity: entry.arity },
      citations: entry.citations.map(c => `${c.file}:${c.line}`),
      verdict: result.overallVerdict,
      match: result.ok,
      perCitation: result.perCitation.map(c => ({
        citation: `${c.file}:${c.line}`,
        verdict: c.verdict,
        parsed: c.found
          ? c.found.kind === 'accessor'
            ? { kind: c.found.kind, access: c.found.access }
            : { kind: c.found.kind, arity: c.found.arity, params: c.found.paramNames }
          : null,
        detail: c.detail || null,
      })),
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedFrom: 'src/shared/rdo-members.ts',
    referenceCommit: 'b28df48a611b0c3783fb1abfb4114cf4eaefd790',
    entryCount: rows.length,
    matchCount: rows.filter(r => r.match).length,
    nonMatchCount: rows.filter(r => !r.match).length,
    entries: rows,
  };
}

function main(argv) {
  const baseline = buildBaseline();
  const json = JSON.stringify(baseline, null, 2) + '\n';

  if (argv.includes('--check')) {
    const onDisk = fs.existsSync(BASELINE_PATH) ? fs.readFileSync(BASELINE_PATH, 'utf8') : null;
    if (onDisk !== json) {
      console.error(`${BASELINE_PATH} is stale — re-run \`node scripts/rdo-citation-baseline.js\` and commit the result.`);
      return 1;
    }
    console.log('rdo-citation-baseline.json is up to date.');
    return 0;
  }

  fs.writeFileSync(BASELINE_PATH, json);
  console.log(`Wrote ${BASELINE_PATH}: ${baseline.entryCount} entries, ${baseline.matchCount} MATCH, ${baseline.nonMatchCount} non-MATCH.`);
  if (baseline.nonMatchCount > 0) {
    console.log('Non-MATCH entries (NOT edited in rdo-members.ts — needs human/citation-verifier review):');
    for (const row of baseline.entries.filter(r => !r.match)) {
      console.log(`  ${row.name}: ${row.verdict}`);
    }
  }
  return 0;
}

module.exports = { extractPasCitedEntries, buildBaseline };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
