/**
 * Diff -> the live flows it changed (doc/E2E-POLICY.md §4, "Changed and declared flows").
 *
 * The routing table sends a diff under src/e2e/ to no flow, so a card that adds or edits a
 * flow used to reach its gate with nothing to drive. This module reads the diff of the seven
 * flow sources and names the flows it touched: a hunk inside a `FLOWS` entry requires that
 * flow; a hunk inside a shared helper requires every flow that reaches the helper, directly
 * or through another helper. scripts/verify-gate.js adds the result to `routing.required`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FLOWS } from '../flows';
import { NIGHTLY_ONLY, SERVER_QUARANTINE } from '../routing';

/** The repo-relative files a live flow is written in, or reaches a helper through. */
export const FLOW_SOURCES = [
  'src/e2e/flows.ts',
  'src/e2e/fixtures.ts',
  'src/e2e/research.ts',
  'src/e2e/probe.ts',
  'src/e2e/session.ts',
  'src/e2e/ws-driver.ts',
  'src/e2e/live-log.ts',
];

/** What a diff of the flow sources requires the gate to drive. */
export interface ChangedFlows {
  /** Flows the diff requires, in FLOWS order. */
  required: string[];
  /** NIGHTLY_ONLY flows reached only through a changed helper. Listed, not driven. */
  notDriven: string[];
  /**
   * SERVER_QUARANTINE flows the diff changed or reached, in FLOWS order. Listed, never required —
   * not even on a direct change to the flow's own body. Present only when non-empty.
   */
  quarantined?: string[];
  reasons: string[];
}

/** Input of {@link changedFlows}. */
export interface ChangedFlowsInput {
  /** `git diff -U0` text over FLOW_SOURCES. */
  diff: string;
  /** Repo-relative path -> current file text ('' when absent). */
  sources: Record<string, string>;
  /** `FLOWS.map(f => f.name)`, in the order of the FLOWS array. */
  flowNames: string[];
  nightlyOnly: Record<string, string>;
  /** SERVER_QUARANTINE: flows no gate requires while a live-server fault blocks them. */
  quarantine?: Record<string, unknown>;
}

export interface Declaration {
  file: string;
  name: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
  text: string;
}

interface Touches {
  /** New-side line numbers a hunk added or changed. */
  lines: number[];
  /** A pure deletion sits between line `c` and `c + 1`. */
  deletionsAfter: number[];
}

const FLOWS_FILE = 'src/e2e/flows.ts';
const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const BOUNDARY = /^import\b|^export\s*[{*]/;
const TRIVIA = /^\s*$|^\s*(\/\/|\/\*|\*)/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const BINDING = /^\s*([A-Za-z_$][\w$]*),?\s*$/;

function touchedLines(diff: string): Map<string, Touches> {
  const touches = new Map<string, Touches>();
  let current: Touches | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      const file = target.startsWith('b/') ? target.slice(2) : null;
      if (file && FLOW_SOURCES.includes(file)) {
        current = touches.get(file) ?? { lines: [], deletionsAfter: [] };
        touches.set(file, current);
      } else {
        current = null;
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (!hunk || !current) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) current.deletionsAfter.push(start);
    for (let n = start; n < start + count; n++) current.lines.push(n);
  }
  return touches;
}

export function declarationsOf(file: string, source: string): Declaration[] {
  const lines = source.split('\n');
  const spans: Array<{ name: string; start: number; end: number }> = [];
  let open: { name: string; start: number } | null = null;
  const close = (endExclusive: number): void => {
    if (!open) return;
    let end = endExclusive - 1;
    while (end > open.start && TRIVIA.test(lines[end - 1])) end--;
    spans.push({ ...open, end });
    open = null;
  };
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const start = DECLARATION.exec(line);
    if (start) {
      close(lineNo);
      open = { name: start[1], start: lineNo };
    } else if (BOUNDARY.test(line)) {
      close(lineNo);
    }
  });
  close(lines.length + 1);
  return spans.map(span => ({
    file,
    ...span,
    text: lines.slice(span.start - 1, span.end).join('\n'),
  }));
}

function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The names of `seeds` plus every declaration whose text references one, to a fixpoint. */
function reach(declarations: Declaration[], seeds: string[]): Set<string> {
  const names = new Set<string>(seeds);
  let grew = names.size > 0;
  while (grew) {
    grew = false;
    const reference = new RegExp(`(?<![\\w$])(?:${[...names].map(escapeRegExp).join('|')})(?![\\w$])`);
    for (const decl of declarations) {
      if (names.has(decl.name) || !reference.test(decl.text)) continue;
      names.add(decl.name);
      grew = true;
    }
  }
  return names;
}

/**
 * Map a `-U0` diff of the flow sources to the flows it changed.
 *
 * Throws when the `FLOWS` array and `flowNames` disagree in length: the gate must fail
 * closed rather than pair a hunk with the wrong flow.
 */
export function changedFlows(input: ChangedFlowsInput): ChangedFlows {
  const { diff, sources, flowNames, nightlyOnly, quarantine = {} } = input;
  const declarations = FLOW_SOURCES.flatMap(file => declarationsOf(file, sources[file] ?? ''));

  // Pair each FLOWS binding, in order, with the loaded flow's name.
  const flowsDecl = declarations.find(d => d.file === FLOWS_FILE && d.name === 'FLOWS');
  const bindingLines = new Map<number, string>();
  if (flowsDecl) {
    flowsDecl.text.split('\n').forEach((line, index) => {
      if (index === 0) return;
      const match = BINDING.exec(line);
      if (match) bindingLines.set(flowsDecl.start + index, match[1]);
    });
  }
  if (bindingLines.size !== flowNames.length) {
    throw new Error(
      `the FLOWS array in ${FLOWS_FILE} lists ${bindingLines.size} binding(s) but ${flowNames.length} flow(s) were loaded — cannot pair a hunk with its flow`,
    );
  }
  const bindingToFlow = new Map<string, string>();
  [...bindingLines.values()].forEach((binding, i) => bindingToFlow.set(binding, flowNames[i]));

  const touches = touchedLines(diff);
  const touched = new Set<Declaration>();
  const direct = new Set<string>();
  for (const [file, touch] of touches) {
    for (const decl of declarations.filter(d => d.file === file)) {
      const hit =
        touch.lines.some(n => n >= decl.start && n <= decl.end) ||
        touch.deletionsAfter.some(c => c >= decl.start && c + 1 <= decl.end);
      if (hit) touched.add(decl);
    }
    if (file === FLOWS_FILE) {
      for (const n of touch.lines) {
        const binding = bindingLines.get(n);
        if (binding) direct.add(bindingToFlow.get(binding) as string);
      }
    }
  }

  const reasons: string[] = [];
  const seeds: Declaration[] = [];
  for (const decl of touched) {
    if (decl.file === FLOWS_FILE && decl.name === 'FLOWS') continue;
    const flow = decl.file === FLOWS_FILE ? bindingToFlow.get(decl.name) : undefined;
    if (flow) direct.add(flow);
    else seeds.push(decl);
  }

  // Every declaration reaching a changed helper, directly or through another one.
  const reached = reach(declarations, seeds.map(d => d.name));
  const related = new Set<string>();
  for (const [binding, flow] of bindingToFlow) {
    if (reached.has(binding) && !direct.has(flow)) related.add(flow);
  }

  for (const flow of flowNames) {
    if (direct.has(flow)) reasons.push(`flow changed in ${FLOWS_FILE}: ${flow}`);
  }
  for (const seed of seeds) {
    const fromSeed = reach(declarations, [seed.name]);
    const count = [...bindingToFlow].filter(
      ([binding, flow]) => fromSeed.has(binding) && related.has(flow),
    ).length;
    reasons.push(`helper changed in ${seed.file}: ${seed.name} — drives ${count} related flow(s)`);
  }

  const quarantined = flowNames.filter(flow => flow in quarantine && (direct.has(flow) || related.has(flow)));
  return {
    required: flowNames.filter(
      flow => !(flow in quarantine) && (direct.has(flow) || (related.has(flow) && !(flow in nightlyOnly))),
    ),
    notDriven: flowNames.filter(flow => !(flow in quarantine) && related.has(flow) && flow in nightlyOnly),
    ...(quarantined.length > 0 ? { quarantined } : {}),
    reasons,
  };
}

/**
 * {@link changedFlows} over the flow sources as they stand on disk under `cwd`, paired with
 * the loaded `FLOWS`, the `NIGHTLY_ONLY` table and the `SERVER_QUARANTINE` table.
 */
export function flowsChangedInWorktree(diff: string, cwd: string = process.cwd()): ChangedFlows {
  const sources: Record<string, string> = {};
  for (const file of FLOW_SOURCES) {
    try {
      sources[file] = fs.readFileSync(path.join(cwd, file), 'utf8');
    } catch {
      sources[file] = '';
    }
  }
  return changedFlows({
    diff,
    sources,
    flowNames: FLOWS.map(flow => flow.name),
    nightlyOnly: NIGHTLY_ONLY,
    quarantine: SERVER_QUARANTINE,
  });
}
