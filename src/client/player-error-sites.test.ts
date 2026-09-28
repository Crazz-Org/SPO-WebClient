/**
 * A failure shown to the player goes through `playerErrorMessage` / `playerErrorReason`
 * (`player-error.ts`), never through the error's raw text. Read from source over every
 * non-test `.ts` / `.tsx` file under `src/client/`, so a new raw display turns this red:
 *
 * - (a) a `toErrorMessage(` call that is not an argument of `ClientBridge.log(…)` or
 *   `console.<level>(…)` — assigning it to a variable that later reaches the screen is caught
 *   here too;
 * - (b) the inline form `instanceof Error ? <name>.message`.
 *
 * Files that may keep a form are listed, with a reason, in EXEMPTIONS.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT = path.resolve(__dirname);
const HELPER = 'player-error.ts';

type Rule = 'a' | 'b';
interface Violation { file: string; line: number; rule: Rule; text: string }
interface Exemption { file: string; rule: Rule | 'all'; reason: string }

export const EXEMPTIONS: Exemption[] = [
  {
    file: 'components/empire/PortraitUploader.tsx',
    rule: 'b',
    reason: 'The errors it shows are the client\'s own sentences for the player, thrown by '
      + 'components/empire/portrait-crop.ts, not a transport or server error.',
  },
  {
    file: 'report/report-submit.ts',
    rule: 'b',
    reason: 'The dev-only bug reporter\'s delivery detail, shown to the person filing a report, '
      + 'not to a player during play.',
  },
];

const TO_ERROR_RE = /\btoErrorMessage\(/g;
const INSTANCEOF_RE = /instanceof\s+Error\s*\?\s*[\w$]+\.message/g;
const ALLOWED_CALLEE_RE = /^(ClientBridge\.log|console\.(log|info|warn|error|debug))$/;

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== '__mocks__') out.push(...listSources(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** The callee of the call whose argument list encloses `index`, or null when there is none. */
function enclosingCallee(source: string, index: number): string | null {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        const m = /([\w$.]+)\s*$/.exec(source.slice(0, i));
        return m ? m[1] : null;
      }
      depth--;
    }
  }
  return null;
}

export function findViolations(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const m of source.matchAll(TO_ERROR_RE)) {
    const callee = enclosingCallee(source, m.index);
    if (callee === null || !ALLOWED_CALLEE_RE.test(callee)) {
      const line = lineOf(source, m.index);
      out.push({ file, line, rule: 'a', text: source.split('\n')[line - 1].trim() });
    }
  }
  for (const m of source.matchAll(INSTANCEOF_RE)) {
    const line = lineOf(source, m.index);
    out.push({ file, line, rule: 'b', text: source.split('\n')[line - 1].trim() });
  }
  return out;
}

function isExempt(v: Violation, e: Exemption): boolean {
  return e.file === v.file && (e.rule === 'all' || e.rule === v.rule);
}

function scanTree(): { violations: Violation[]; toErrorCalls: number } {
  const violations: Violation[] = [];
  let toErrorCalls = 0;
  for (const full of listSources(CLIENT)) {
    const file = path.relative(CLIENT, full).split(path.sep).join('/');
    if (file === HELPER) continue;
    const source = fs.readFileSync(full, 'utf8');
    toErrorCalls += [...source.matchAll(TO_ERROR_RE)].length;
    violations.push(...findViolations(file, source));
  }
  return { violations, toErrorCalls };
}

describe('player error sites', () => {
  const { violations, toErrorCalls } = scanTree();

  it('scans the real tree (a broken scan cannot pass by finding nothing)', () => {
    expect(toErrorCalls).toBeGreaterThanOrEqual(30);
  });

  it('shows no raw error text to the player outside the listed exemptions', () => {
    const list = violations
      .filter((v) => !EXEMPTIONS.some((e) => isExempt(v, e)))
      .map((v) => `${v.file}:${v.line} (${v.rule}) ${v.text}`);
    expect(list).toEqual([]);
  });

  it('gives every exemption a reason, and none is stale', () => {
    for (const e of EXEMPTIONS) {
      expect(e.reason.length).toBeGreaterThan(0);
      expect(violations.some((v) => isExempt(v, e))).toBe(true);
    }
  });

  it('flags each offending form on a synthetic snippet', () => {
    const toast = findViolations('x.ts', "ctx.showNotification(`Failed: ${toErrorMessage(err)}`, 'error');");
    expect(toast.map((v) => v.rule)).toEqual(['a']);

    const assigned = findViolations('x.ts', 'const msg = toErrorMessage(err);');
    expect(assigned.map((v) => v.rule)).toEqual(['a']);

    const inline = findViolations('x.ts', "setError(err instanceof Error ? err.message : 'x');");
    expect(inline.map((v) => v.rule)).toEqual(['b']);
    expect(inline[0].line).toBe(1);
  });

  it('accepts the raw text inside a log call', () => {
    const snippet = [
      "ClientBridge.log('Error', `x: ${toErrorMessage(err)}`);",
      "console.warn('x', toErrorMessage(err));",
      "console.error(`y: ${label} ${toErrorMessage(err)}`);",
    ].join('\n');
    expect(findViolations('x.ts', snippet)).toEqual([]);
  });
});
