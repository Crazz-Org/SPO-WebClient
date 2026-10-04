import * as fs from 'fs';
import * as path from 'path';
import { FLOWS } from '../flows';
import { NIGHTLY_ONLY, SERVER_QUARANTINE } from '../routing';
import { FLOW_SOURCES, changedFlows, flowsChangedInWorktree } from './changed-flows';

/**
 * A small flows.ts: three flows (one built by a factory), two helpers (one calling the
 * other), a JSDoc'd flow, and the FLOWS array. Line numbers are listed next to it so a hunk
 * can name them.
 */
const FLOWS_TS = [
  "import { login } from './session';", //                 1
  "import {", //                                           2
  "  other,", //                                           3
  "} from './x';", //                                      4
  '', //                                                   5
  'function inner(): number {', //                         6
  '  return 1;', //                                        7
  '}', //                                                  8
  '', //                                                   9
  'async function outer(): Promise<number> {', //          10
  '  return inner() + 1;', //                              11
  '}', //                                                  12
  '', //                                                   13
  '/** Alpha reads. */', //                                14
  'const alpha: Flow = {', //                              15
  "  name: 'alpha',", //                                   16
  '  run: async () => { await outer(); },', //             17
  '};', //                                                 18
  '', //                                                   19
  '// Beta writes.', //                                    20
  'const beta: Flow = {', //                               21
  "  name: 'beta',", //                                    22
  '  run: async () => { await login(); await outer(); },', // 23
  '};', //                                                 24
  '', //                                                   25
  "const gamma = factory('gamma', () => 3);", //           26
  '', //                                                   27
  'export const FLOWS: Flow[] = [', //                     28
  '  alpha,', //                                           29
  '  beta,', //                                            30
  '  gamma,', //                                           31
  '];', //                                                 32
  '', //                                                   33
].join('\n');

const SESSION_TS = [
  "import { WsDriver } from './ws-driver';", //            1
  '', //                                                   2
  'export async function login(): Promise<void> {', //     3
  '  await WsDriver.connect();', //                        4
  '}', //                                                  5
  '', //                                                   6
].join('\n');

const NAMES = ['alpha', 'beta', 'gamma'];

function hunk(file: string, ...headers: string[]): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...headers].join(
    '\n',
  );
}

function run(diff: string, nightlyOnly: Record<string, string> = {}, flowsTs = FLOWS_TS) {
  return changedFlows({
    diff,
    sources: { 'src/e2e/flows.ts': flowsTs, 'src/e2e/session.ts': SESSION_TS },
    flowNames: NAMES,
    nightlyOnly,
  });
}

describe('changedFlows — direct changes', () => {
  it('a hunk in one flow body requires that flow only', () => {
    const result = run(hunk('src/e2e/flows.ts', '@@ -22 +22 @@'));
    expect(result).toEqual({
      required: ['beta'],
      notDriven: [],
      reasons: ['flow changed in src/e2e/flows.ts: beta'],
    });
  });

  it('an added flow (its declaration and its FLOWS line) requires the new flow', () => {
    const result = run(hunk('src/e2e/flows.ts', '@@ -25,0 +26 @@', '@@ -30,0 +31 @@'));
    expect(result.required).toEqual(['gamma']);
  });

  it('a new FLOWS line alone requires the flow it adds', () => {
    expect(run(hunk('src/e2e/flows.ts', '@@ -30,0 +31 @@')).required).toEqual(['gamma']);
  });

  it('a renamed flow requires the new name', () => {
    const renamed = FLOWS_TS.replace("name: 'beta'", "name: 'beta-2'");
    const result = changedFlows({
      diff: hunk('src/e2e/flows.ts', '@@ -22 +22 @@'),
      sources: { 'src/e2e/flows.ts': renamed },
      flowNames: ['alpha', 'beta-2', 'gamma'],
      nightlyOnly: {},
    });
    expect(result.required).toEqual(['beta-2']);
  });

  it('a pure deletion inside a flow body requires that flow', () => {
    expect(run(hunk('src/e2e/flows.ts', '@@ -17 +16,0 @@')).required).toEqual(['alpha']);
  });

  it('deleting a whole declaration touches nothing', () => {
    expect(run(hunk('src/e2e/flows.ts', '@@ -19,3 +19,0 @@'))).toEqual({
      required: [],
      notDriven: [],
      reasons: [],
    });
  });

  it('a quarantined flow whose own body changed is listed, never required (#1310)', () => {
    const result = changedFlows({
      diff: hunk('src/e2e/flows.ts', '@@ -16 +16 @@', '@@ -22 +22 @@'),
      sources: { 'src/e2e/flows.ts': FLOWS_TS, 'src/e2e/session.ts': SESSION_TS },
      flowNames: NAMES,
      nightlyOnly: {},
      quarantine: { alpha: { reason: 'server fault' } },
    });
    expect(result.required).toEqual(['beta']);
    expect(result.quarantined).toEqual(['alpha']);
    expect(result.notDriven).toEqual([]);
  });

  it('a quarantined flow reached only through a helper is listed under quarantined, not notDriven (#1310)', () => {
    const result = changedFlows({
      diff: hunk('src/e2e/flows.ts', '@@ -11 +11 @@'),
      sources: { 'src/e2e/flows.ts': FLOWS_TS, 'src/e2e/session.ts': SESSION_TS },
      flowNames: NAMES,
      nightlyOnly: { alpha: 'data-gated' },
      quarantine: { alpha: { reason: 'server fault' } },
    });
    expect(result.required).toEqual(['beta']);
    expect(result.notDriven).toEqual([]);
    expect(result.quarantined).toEqual(['alpha']);
  });

  it('a NIGHTLY_ONLY flow whose own body changed is required', () => {
    expect(run(hunk('src/e2e/flows.ts', '@@ -16 +16 @@'), { alpha: 'data-gated' }).required).toEqual(
      ['alpha'],
    );
  });
});

describe('changedFlows — helpers', () => {
  it('a helper used by two of three flows requires both, not the third', () => {
    const result = run(hunk('src/e2e/flows.ts', '@@ -11 +11 @@'));
    expect(result.required).toEqual(['alpha', 'beta']);
    expect(result.reasons).toEqual(['helper changed in src/e2e/flows.ts: outer — drives 2 related flow(s)']);
  });

  it('a transitive helper requires the flows using its caller', () => {
    expect(run(hunk('src/e2e/flows.ts', '@@ -7 +7 @@')).required).toEqual(['alpha', 'beta']);
  });

  it('a helper whose name holds a `$` is matched literally', () => {
    const dollar = FLOWS_TS.replace(/\bouter\b/g, 'out$er');
    expect(run(hunk('src/e2e/flows.ts', '@@ -11 +11 @@'), {}, dollar).required).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('a helper in another flow source requires the flows that reference it', () => {
    const result = run(hunk('src/e2e/session.ts', '@@ -4 +4 @@'));
    expect(result.required).toEqual(['beta']);
    expect(result.reasons).toEqual([
      'helper changed in src/e2e/session.ts: login — drives 1 related flow(s)',
    ]);
  });

  it('a NIGHTLY_ONLY flow reached only through a helper is listed, not required', () => {
    const result = run(hunk('src/e2e/flows.ts', '@@ -11 +11 @@'), { alpha: 'data-gated' });
    expect(result.required).toEqual(['beta']);
    expect(result.notDriven).toEqual(['alpha']);
  });

  it('a flow changed directly and through a helper is reported once, as direct', () => {
    const result = run(hunk('src/e2e/flows.ts', '@@ -11 +11 @@', '@@ -16 +16 @@'));
    expect(result.required).toEqual(['alpha', 'beta']);
    expect(result.reasons).toEqual([
      'flow changed in src/e2e/flows.ts: alpha',
      'helper changed in src/e2e/flows.ts: outer — drives 1 related flow(s)',
    ]);
  });
});

describe('changedFlows — what changes nothing', () => {
  it.each([
    ['a JSDoc line above a flow', '@@ -14 +14 @@'],
    ['a line comment above a flow', '@@ -20 +20 @@'],
    ['an import line', '@@ -1 +1 @@'],
    ['a multi-line import body', '@@ -3 +3 @@'],
  ])('%s', (_label, header) => {
    expect(run(hunk('src/e2e/flows.ts', header))).toEqual({ required: [], notDriven: [], reasons: [] });
  });

  it('ignores a file outside the flow sources, and a deleted file', () => {
    const diff = [
      hunk('src/e2e/routing.ts', '@@ -22 +22 @@'),
      'diff --git a/src/e2e/flows.ts b/src/e2e/flows.ts',
      '--- a/src/e2e/flows.ts',
      '+++ /dev/null',
      '@@ -1,33 +0,0 @@',
    ].join('\n');
    expect(run(diff).required).toEqual([]);
  });

  it('throws when the FLOWS bindings and the loaded flows disagree in count', () => {
    expect(() =>
      changedFlows({
        diff: '',
        sources: { 'src/e2e/flows.ts': FLOWS_TS },
        flowNames: ['alpha', 'beta'],
        nightlyOnly: {},
      }),
    ).toThrow(/lists 3 binding\(s\) but 2 flow\(s\) were loaded/);
  });

  it('throws when there is no FLOWS array at all', () => {
    expect(() =>
      changedFlows({ diff: '', sources: {}, flowNames: ['alpha'], nightlyOnly: {} }),
    ).toThrow(/lists 0 binding\(s\) but 1 flow\(s\)/);
  });
});

describe('flowsChangedInWorktree — the real tree', () => {
  const root = process.cwd();
  const flowsTs = fs.readFileSync(path.join(root, 'src/e2e/flows.ts'), 'utf8').split('\n');
  const bindings = (() => {
    const start = flowsTs.indexOf('export const FLOWS: Flow[] = [');
    const end = flowsTs.indexOf('];', start);
    return flowsTs.slice(start + 1, end).map(l => l.trim().replace(/,$/, ''));
  })();

  it('pairs every FLOWS entry with its own flow', () => {
    expect(bindings).toHaveLength(FLOWS.length);
    bindings.forEach((binding, i) => {
      const line = flowsTs.findIndex(l => new RegExp(`^const ${binding}\\b`).test(l)) + 1;
      const diff = hunk('src/e2e/flows.ts', `@@ -${line} +${line} @@`);
      const result = flowsChangedInWorktree(diff, root);
      // A SERVER_QUARANTINE flow is never required, even on a direct change (#1310).
      if (FLOWS[i].name in SERVER_QUARANTINE) {
        expect(result.required).toEqual([]);
        expect(result.quarantined).toEqual([FLOWS[i].name]);
      } else {
        expect(result.required).toEqual([FLOWS[i].name]);
      }
    });
  });

  it("a hunk inside portraitRoundTrip's own body lists portrait-roundtrip as quarantined, never required (#1310)", () => {
    const line = flowsTs.findIndex(l => l.startsWith('const portraitRoundTrip')) + 1 + 2;
    const result = flowsChangedInWorktree(hunk('src/e2e/flows.ts', `@@ -${line} +${line} @@`), root);
    expect(result.required).not.toContain('portrait-roundtrip');
    expect(result.quarantined).toContain('portrait-roundtrip');
  });

  it('a change to session.ts login drives the related flows, never a NIGHTLY_ONLY one', () => {
    const session = fs.readFileSync(path.join(root, 'src/e2e/session.ts'), 'utf8').split('\n');
    const line = session.findIndex(l => l.startsWith('export async function login(')) + 2;
    const result = flowsChangedInWorktree(hunk('src/e2e/session.ts', `@@ -${line} +${line} @@`));
    expect(result.required).toEqual(expect.arrayContaining(['login-spine', 'politics-read']));
    for (const flow of result.required) expect(NIGHTLY_ONLY).not.toHaveProperty(flow);
    expect(result.notDriven.length).toBeGreaterThan(0);
    for (const flow of result.notDriven) expect(NIGHTLY_ONLY).toHaveProperty(flow);
  });

  it('a change to session.ts readBuildingDetails lists newspaper-board-read as quarantined, never requires it (#1307, #1310)', () => {
    const session = fs.readFileSync(path.join(root, 'src/e2e/session.ts'), 'utf8').split('\n');
    const line = session.findIndex(l => l.startsWith('export async function readBuildingDetails(')) + 2;
    const result = flowsChangedInWorktree(hunk('src/e2e/session.ts', `@@ -${line} +${line} @@`), root);
    expect(result.required).not.toContain('newspaper-board-read');
    expect(result.quarantined).toContain('newspaper-board-read');
    expect(result.notDriven).not.toContain('newspaper-board-read');
  });

  it('a change to a research.ts helper drives research-roundtrip and lists fixtures-ensure (#1233)', () => {
    const research = fs.readFileSync(path.join(root, 'src/e2e/research.ts'), 'utf8').split('\n');
    const line = research.findIndex(l => l.startsWith('export function researchCost(')) + 2;
    const result = flowsChangedInWorktree(hunk('src/e2e/research.ts', `@@ -${line} +${line} @@`), root);
    expect(result.required).toContain('research-roundtrip');
    expect(result.notDriven).toContain('fixtures-ensure');
  });

  it('reads a missing flow source as empty', () => {
    expect(FLOW_SOURCES).toContain('src/e2e/flows.ts');
    expect(() => flowsChangedInWorktree('', '/nonexistent-dir')).toThrow(/lists 0 binding\(s\)/);
  });
});
