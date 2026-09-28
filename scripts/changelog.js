#!/usr/bin/env node

/**
 * changelog.js — the version is DERIVED, never bumped in git.
 *
 * Nothing commits to main (ruleset, empty bypass), so the release workflow computes the
 * next version from the last `v*` tag and the conventional-commit subjects since it:
 *
 *   base   = last `v*` tag reachable from HEAD, `v` and any `-prerelease` suffix stripped
 *   bump   = any `feat` commit  -> minor + 1, patch 0
 *            anything else      -> patch + 1
 *            no commit at all   -> skip (nothing to release)
 *   major stays 1. No prerelease suffix, ever again.
 *
 * Usage:
 *   node scripts/changelog.js --next            print the next version; with GITHUB_OUTPUT
 *                                               set, also append `version=` and `skip=`
 *   node scripts/changelog.js --notes <file>    write the release notes for the pending
 *                                               commits (Added / Fixed / Changed / Documentation)
 *   node scripts/changelog.js --preview         print the pending notes to stdout
 *
 * Only the workflow (.github/workflows/release.yml) runs --next/--notes for
 * real; locally, --preview is the one to reach for (`npm run release:preview`).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- Pure logic -------------------------------------------------------------

/**
 * Parse a conventional commit subject into { prefix, breaking, description }.
 * Returns null for subjects that don't match.
 */
function parseCommit(message) {
  const match = message.match(/^(\w+)(?:\(.+?\))?(!?):\s*(.+)$/);
  if (!match) return null;
  return { prefix: match[1], breaking: match[2] === '!', description: match[3] };
}

// Mapping from commit prefix to changelog category
const CATEGORY_MAP = {
  feat: 'Added',
  fix: 'Fixed',
  refactor: 'Changed',
  perf: 'Changed',
};

// Prefixes included in the dev changelog but not player-facing
const DEV_ONLY_PREFIXES = new Set(['docs']);

const SECTION_ORDER = ['Added', 'Fixed', 'Changed', 'Documentation'];

/** Group commit subjects by changelog section; unparseable or dropped prefixes vanish. */
function categorize(subjects) {
  const categories = {};
  for (const subject of subjects) {
    const parsed = parseCommit(subject);
    if (!parsed) continue;
    const section = CATEGORY_MAP[parsed.prefix];
    if (!section && !DEV_ONLY_PREFIXES.has(parsed.prefix)) continue;
    const cat = section || 'Documentation';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(parsed);
  }
  return categories;
}

/** `v1.3.2-beta` -> `1.3.2`; null when the tag is not a version tag. */
function baseFromTag(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(tag || '');
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * The bump rule. Returns { version, skip }: skip is true when there is nothing to release.
 * A `feat` (scoped or not, breaking or not) bumps the minor; anything else the patch.
 */
function nextVersion(base, subjects) {
  const parts = baseFromTag(base);
  if (!parts) throw new Error(`not a version: ${base}`);
  const [major, minor, patch] = parts.split('.').map(Number);
  if (subjects.length === 0) return { version: parts, skip: true };
  const hasFeat = subjects.some((s) => {
    const parsed = parseCommit(s);
    return parsed !== null && parsed.prefix === 'feat';
  });
  const version = hasFeat ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  return { version, skip: false };
}

/** The section body: `### Added` … one line per commit, empty sections omitted. */
function renderSections(categories) {
  const lines = [];
  for (const section of SECTION_ORDER) {
    const items = categories[section];
    if (!items || items.length === 0) continue;
    lines.push(`### ${section}`);
    for (const item of items) {
      lines.push(`- ${item.description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function generateMarkdownSection(version, date, categories) {
  return [`## [${version}] - ${date}`, '', renderSections(categories)].join('\n');
}

// --- Git ------------------------------------------------------------------------

/**
 * Run git with an argument ARRAY — no shell. The release workflow runs on windows-latest,
 * where a shell string like `--match 'v*'` hands git the literal quotes (cmd/pwsh do not
 * strip single quotes the way sh does), so no tag ever matched and the first automatic
 * release died with "no v* tag reachable". execFileSync is quote-free on every OS.
 */
function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function lastTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*');
  } catch {
    return null;
  }
}

function subjectsBetween(from, to) {
  const range = from ? `${from}..${to}` : to;
  const log = git('log', range, '--no-merges', '--format=%s');
  return log ? log.split('\n') : [];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** The release the workflow is about to make: base tag, subjects, next version. */
function pending() {
  const tag = lastTag();
  if (!tag) throw new Error('no v* tag reachable from HEAD — nothing to derive a version from');
  const subjects = subjectsBetween(tag, 'HEAD');
  const next = nextVersion(tag, subjects);
  return { tag, subjects, ...next };
}

// --- CLI ---------------------------------------------------------------------------

function cmdNext() {
  const { tag, version, skip } = pending();
  if (!skip) {
    // A tag that already exists must be ours: at another commit it would mean two
    // releases claiming one version — stop before building anything.
    let at;
    try {
      at = git('rev-parse', '--verify', '-q', `refs/tags/v${version}^{commit}`);
    } catch {
      at = null;
    }
    const head = git('rev-parse', 'HEAD');
    if (at && at !== head) {
      throw new Error(`tag v${version} already exists at ${at.slice(0, 8)}, not at HEAD ${head.slice(0, 8)}`);
    }
  }
  console.log(skip ? `${version} (no commits since ${tag} — skip)` : version);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nskip=${skip}\n`);
  }
}

function cmdNotes(file) {
  if (!file) throw new Error('--notes needs a file path');
  const { tag, subjects } = pending();
  const body = renderSections(categorize(subjects));
  const text = body ? body : `No player-facing change since ${tag}.\n`;
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf-8');
  console.log(`wrote ${file}`);
}

function cmdPreview() {
  const { subjects, version } = pending();
  process.stdout.write(generateMarkdownSection(version, today(), categorize(subjects)));
}

function main(argv) {
  const [flag, arg] = argv;
  switch (flag) {
    case '--next':
      return cmdNext();
    case '--notes':
      return cmdNotes(arg);
    case '--preview':
      return cmdPreview();
    default:
      console.error('Usage: node scripts/changelog.js --next | --notes <file> | --preview');
      process.exit(2);
  }
}

module.exports = {
  parseCommit,
  categorize,
  baseFromTag,
  nextVersion,
  renderSections,
  generateMarkdownSection,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
