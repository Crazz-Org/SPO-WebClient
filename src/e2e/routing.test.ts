import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ROUTES,
  SPINE_FLOW,
  NIGHTLY_ONLY,
  GATE_ONLY,
  FALLBACK_ONLY,
  route,
  presidentMembersInDiff,
  isCallSite,
  launderedTests,
  type RouteRule,
} from './routing';
import { PRESIDENT_MEMBERS } from './config';
import { FLOWS } from './flows';

describe('route', () => {
  it('appends the login spine whenever anything observable changed', () => {
    const decision = route(['src/client/components/building/SaveIndicator.tsx']);
    expect(decision.required[0]).toBe(SPINE_FLOW);
    expect(decision.required).toContain('building-details');
  });

  // #1134: politics-handler.ts now has its own rule (the flows that drive it); the wire-level
  // rule keeps the frames and RDO members.
  it('routes the governance handler to its own flows', () => {
    const decision = route(['src/server/session/politics-handler.ts']);
    expect(decision.required).toEqual([
      'login-spine', 'politics-read', 'politics-write', 'town-min-wage', 'publicity-roundtrip',
    ]);
    expect(decision.staticOnly).toBe(false);
  });

  // #1145: the politics files also own the flows that drive their minimum-wage and publicity paths.
  it.each([
    'src/server/session/politics-handler.ts',
    'src/server/ws-handlers/politics-handlers.ts',
    'src/client/components/politics/JobsTab.tsx',
  ])('routes %s to town-min-wage and publicity-roundtrip', file => {
    const required = route([file]).required;
    expect(required).toContain('town-min-wage');
    expect(required).toContain('publicity-roundtrip');
  });

  it("routes template-groups.ts to town-min-wage (TOWN_JOBS_GROUP's min-wage mapping)", () => {
    expect(route(['src/shared/building-details/template-groups.ts']).required).toEqual([
      SPINE_FLOW, 'building-details', 'town-min-wage',
      // #1152: the store and industry owner setters the panels send.
      'inspector-reads', 'store-price-salaries', 'industry-output-price', 'facility-open-close', 'industry-auto-buy',
      // #1153: the trade role and level (trade-settings.ts).
      'trade-settings',
    ]);
  });

  it('routes a wire-level change to the governance and inspector flows', () => {
    expect(route(['src/shared/rdo-frame.ts']).required).toEqual([
      SPINE_FLOW, 'politics-read', 'politics-write', 'building-details',
    ]);
  });

  it('routes login-handler.ts through the people-search flow, plus the wire-level flows', () => {
    const decision = route(['src/server/session/login-handler.ts']);
    expect(decision.required).toEqual(expect.arrayContaining([
      SPINE_FLOW, 'people-search', 'politics-read', 'politics-write', 'building-details',
    ]));
  });

  it('routes the search WS handler through the people-search flow', () => {
    const decision = route(['src/server/ws-handlers/search-handlers.ts']);
    expect(decision.required).toEqual(expect.arrayContaining([
      SPINE_FLOW, 'people-search', 'building-details', 'politics-read',
    ]));
  });

  it.each([
    'src/server/server.ts',
    'src/server/spo_session.ts',
    'src/server/ws-handlers/auth-handlers.ts',
  ])('routes %s — a session-lifecycle file — to session-resume, plus the ws-handlers flows', file => {
    const d = route([file]);
    expect(d.required).toEqual([SPINE_FLOW, 'building-details', 'politics-read', 'session-resume', 'company-switch']);
  });

  // #1134: building-handlers.ts left this list — it now has its own rule.
  it.each([
    'src/server/ws-handlers/chat-handlers.ts',
  ])('still routes %s through the ws-handlers rule, without session-resume', file => {
    expect(route([file]).required).toEqual([SPINE_FLOW, 'building-details', 'politics-read']);
  });

  it('routes mail-handler.ts to mail-roundtrip, zoning-alert-read, mail-drafts, mail-send-from-draft and mail-reply, not to the governance flows', () => {
    const d = route(['src/server/session/mail-handler.ts']);
    expect(d.required).toEqual([
      SPINE_FLOW, 'mail-roundtrip', 'zoning-alert-read', 'mail-drafts', 'mail-send-from-draft', 'mail-reply',
    ]);
  });

  it.each([
    'src/client/components/mail/MailPanel.tsx',
    'src/server/mail-list-parser.ts',
  ])('routes the mail path %s to the drafts, send-from-draft and reply flows', file => {
    expect(route([file]).required).toEqual(
      expect.arrayContaining(['mail-drafts', 'mail-send-from-draft', 'mail-reply']),
    );
  });

  it('routes the local.asp translator to the one flow that reads a link through it', () => {
    const d = route(['src/shared/local-asp-url.ts']);
    expect(d.required).toEqual([SPINE_FLOW, 'zoning-alert-read']);
  });

  it('routes a Favorites change to its own flows, not to the governance ones', () => {
    const d = route(['src/server/session/favorites-handler.ts']);
    expect(d.required).toEqual(['login-spine', 'favorites-roundtrip', 'favorites-folders']);
  });

  it('routes the Empire panel the same way — it is the surface of that tree', () => {
    const d = route(['src/client/components/empire/FacilityList.tsx']);
    expect(d.required).toContain('favorites-roundtrip');
    expect(d.required).toContain('favorites-folders');
  });

  it('routes the shared tree helper to both favourites flows', () => {
    const d = route(['src/shared/favorites-tree.ts']);
    expect(d.required).toEqual(['login-spine', 'favorites-roundtrip', 'favorites-folders']);
  });

  it('routes politics UI to the permission-negative flow, not only the happy path', () => {
    const decision = route(['src/client/components/politics/TaxesTab.tsx']);
    expect(decision.required).toContain('permission-negative');
  });

  it('flags renderer and stylesheet changes as needing the browser layer', () => {
    const decision = route(['src/client/renderer/iso-renderer.ts']);
    expect(decision.needsL3).toBe(true);
    expect(decision.staticOnly).toBe(false);
  });

  it('treats a css module as a pixel change even under components/', () => {
    const decision = route(['src/client/components/politics/PoliticsPanel.module.css']);
    expect(decision.needsL3).toBe(true);
  });

  it('marks a docs-only diff static-only', () => {
    const decision = route(['doc/E2E-POLICY.md', 'README.md']);
    expect(decision.staticOnly).toBe(true);
    expect(decision.required).toEqual([]);
  });

  it('does not require a live drive for the L1 substrate or for test files', () => {
    const decision = route(['src/mock-server/rdo-mock.ts', 'src/client/foo.test.tsx']);
    expect(decision.staticOnly).toBe(true);
  });

  it('does not require a live drive for a test baseline fixture', () => {
    const decision = route(['src/__tests__/test-hygiene.baseline.json']);
    expect(decision.unmapped).toEqual([]);
    expect(decision.staticOnly).toBe(true);
  });

  it('does not require a live drive for test helpers and data under src/__tests__/ subdirectories', () => {
    const decision = route([
      'src/__tests__/load/session-capacity.ts',
      'src/__tests__/load/session-memory.load.ts',
      'src/__tests__/load/session-capacity.json',
    ]);
    expect(decision.unmapped).toEqual([]);
    expect(decision.staticOnly).toBe(true);
    expect(decision.required).toEqual([]);
  });

  it('treats repo-root config and generated output as static-only', () => {
    const decision = route(['.gitignore', '.editorconfig', 'tsconfig.json', 'report/x.html', 'coverage/lcov.info']);
    expect(decision.unmapped).toEqual([]);
    expect(decision.staticOnly).toBe(true);
  });

  it('treats the container image as static-only', () => {
    // The bench builds the worktree and runs dist/server/server.js — it never builds the
    // image, so no live flow can observe it. Before this rule the gate failed closed on it
    // (#215).
    const decision = route(['Dockerfile', 'Dockerfile.cache-sync', '.dockerignore']);
    expect(decision.unmapped).toEqual([]);
    expect(decision.staticOnly).toBe(true);
    expect(decision.required).toEqual([]);
  });

  it('routes a dependency change to the spine and the inspector — the shipped code moved', () => {
    expect(route(['package-lock.json']).required).toEqual([SPINE_FLOW, 'building-details']);
    expect(route(['package.json']).staticOnly).toBe(false);
  });

  it('routes the vite config like a dependency change, plus a browser look', () => {
    // It ends in .ts, so the repo-root config rule (.json/.js/.yml) never covered it and the
    // gate failed closed on it — the hole #172 hit.
    const decision = route(['vite.config.ts']);
    expect(decision.unmapped).toEqual([]);
    expect(decision.required).toEqual([SPINE_FLOW, 'building-details']);
    expect(decision.needsL3).toBe(true);
    expect(decision.staticOnly).toBe(false);
  });

  it('still treats the other repo-root configs as tooling', () => {
    // The new rule is anchored on that one filename; nothing else changed meaning.
    const decision = route(['tsconfig.json', 'jest.config.js', 'eslint.config.js']);
    expect(decision.staticOnly).toBe(true);
    expect(decision.needsL3).toBe(false);
  });

  it('does not fail closed on a removed path no rule covers — nothing is left there to drive', () => {
    const removed = ['some-removed-tree/thing.js', 'some-removed-tree/icons/app.ico'];
    const decision = route(removed, removed);
    expect(decision.unmapped).toEqual([]);
    expect(decision.staticOnly).toBe(true);
  });

  it('still fails closed on a removed path when the branch did not remove it', () => {
    expect(route(['some-removed-tree/thing.js']).unmapped).toEqual(['some-removed-tree/thing.js']);
  });

  it('routes a removed file a rule does cover — a deleted handler still changes behaviour', () => {
    const gone = ['src/server/session/favorites-handler.ts'];
    expect(route(gone, gone).required).toEqual([SPINE_FLOW, 'favorites-roundtrip', 'favorites-folders']);
  });

  it('fails closed on a path no rule covers', () => {
    const decision = route(['src/brand-new-area/thing.ts']);
    expect(decision.unmapped).toEqual(['src/brand-new-area/thing.ts']);
  });

  it('deduplicates flows required by several changed files', () => {
    const decision = route([
      'src/client/components/politics/TaxesTab.tsx',
      'src/client/components/politics/JobsTab.tsx',
    ]);
    const counts = decision.required.filter(f => f === 'politics-read');
    expect(counts).toHaveLength(1);
  });

  // #1134: the governance handler's reason is now its own rule's `why`.
  it('reports why the live drive was required', () => {
    expect(route(['src/server/session/politics-handler.ts']).reasons.join(' ')).toMatch(/governance handlers/);
    expect(route(['src/shared/rdo-frame.ts']).reasons.join(' ')).toMatch(/wire-level/);
  });

  it('has a rule for every flow name it references', () => {
    const named = new Set(ROUTES.flatMap(r => r.flows));
    expect(named.size).toBeGreaterThan(0);
    for (const flow of named) expect(typeof flow).toBe('string');
  });
});

describe('presidentMembersInDiff', () => {
  const diff = (file: string, ...lines: string[]) =>
    [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...lines].join('\n');

  it('blocks on a President member added to a real call site', () => {
    expect(presidentMembersInDiff(diff('src/server/session/politics-handler.ts', "+  rdoCall('RDOSitMinister', id);"))).toEqual(
      ['RDOSitMinister'],
    );
  });

  it('finds every President member the catalogue lists', () => {
    const lines = PRESIDENT_MEMBERS.map(m => `+ ${m}(x)`);
    expect(presidentMembersInDiff(diff('src/server/session/x.ts', ...lines))).toEqual([
      ...PRESIDENT_MEMBERS,
    ]);
  });

  it('does not fire on a generated report that lists them', () => {
    expect(presidentMembersInDiff(diff('report/rdo-surface-coverage.html', '+ <td>RDOSitMayor</td>'))).toEqual([]);
  });

  it('does not fire on the policy document that names them', () => {
    expect(presidentMembersInDiff(diff('doc/E2E-POLICY.md', '+ `RDOSitMayor` · `RDOBanMinister`'))).toEqual([]);
  });

  it('does not fire on the catalogue that declares them', () => {
    expect(presidentMembersInDiff(diff('src/e2e/config.ts', "+  'RDOSetTownTaxes',"))).toEqual([]);
  });

  it('does not fire on a test that pins them', () => {
    expect(presidentMembersInDiff(diff('src/server/x.test.ts', "+ expect(m).toBe('RDOSitMayor');"))).toEqual([]);
  });

  it('ignores a removed call — a deletion cannot introduce a bad frame', () => {
    expect(presidentMembersInDiff(diff('src/server/session/x.ts', "-  rdoCall('RDOSitMayor', id);"))).toEqual([]);
  });

  it('ignores an unchanged context line that merely mentions one', () => {
    expect(presidentMembersInDiff(diff('src/server/session/x.ts', "   // see RDOSitMayor above"))).toEqual([]);
  });

  it('does not fire on a substring of a longer identifier', () => {
    expect(presidentMembersInDiff(diff('src/server/session/x.ts', '+ RDOSitMinisterExtended();'))).toEqual([]);
  });

  it('returns nothing for an unrelated diff', () => {
    expect(presidentMembersInDiff(diff('src/server/session/x.ts', '+ const x = 1;'))).toEqual([]);
  });

  it('scans each file against its own rule, not the first one seen', () => {
    const text = [
      diff('doc/E2E-POLICY.md', '+ RDOSitMayor'),
      diff('src/server/session/x.ts', '+ RDOBanMinister(id);'),
    ].join('\n');
    expect(presidentMembersInDiff(text)).toEqual(['RDOBanMinister']);
  });
});

describe('isCallSite', () => {
  it.each([
    ['src/server/session/politics-handler.ts', true],
    ['src/client/components/politics/TaxesTab.tsx', true],
    ['src/server/x.test.ts', false],
    ['src/client/x.test.tsx', false],
    ['src/e2e/config.ts', false],
    ['doc/E2E-POLICY.md', false],
    ['report/rdo-surface-coverage.html', false],
    ['scripts/verify-gate.js', false],
  ])('%s -> %s', (file, expected) => {
    expect(isCallSite(file)).toBe(expected);
  });
});

describe('launderedTests', () => {
  it('catches an attempt that edits the test that was failing', () => {
    expect(launderedTests(['src/a.test.ts', 'src/a.ts'], ['src/a.test.ts'])).toEqual(['src/a.test.ts']);
  });

  it('ignores a leading ./ difference between the two lists', () => {
    expect(launderedTests(['./src/a.test.ts'], ['src/a.test.ts'])).toEqual(['src/a.test.ts']);
  });

  it('is empty when the fix touched only source', () => {
    expect(launderedTests(['src/a.ts'], ['src/a.test.ts'])).toEqual([]);
  });
});

describe('the town paper', () => {
  // The paper is not on the RDO wire at all — it is scraped off the ASP pages —
  // so the governance flows would prove nothing about a change to it.
  // newspaper-read stays nightly-only (#1009): the bench cannot create a kept issue,
  // so it could only end UNPROVEN. The columns board read is required instead.
  const paperPaths = [
    'src/server/session/newspaper-handler.ts',
    'src/client/components/modals/NewspaperModal.tsx',
    'src/client/store/newspaper-store.ts',
  ];

  it.each(paperPaths)('routes %s to the spine and the board read, and it is observable live', file => {
    const d = route([file]);
    expect(d.required).toEqual([SPINE_FLOW, 'newspaper-board-read']);
    expect(d.staticOnly).toBe(false);
  });

  it.each(paperPaths)('does not route %s to the governance or inspector flows', file => {
    const { required } = route([file]);
    for (const flow of ['politics-read', 'politics-write', 'building-details']) {
      expect(required).not.toContain(flow);
    }
  });

  it('routes the newspaper WS handler to the board read, not to the ws-handlers rule', () => {
    expect(route(['src/server/ws-handlers/newspaper-handlers.ts']).required)
      .toEqual([SPINE_FLOW, 'newspaper-board-read']);
  });

  it('leaves no rule with a spine-alone option', () => {
    expect(ROUTES.some(r => 'spine' + 'Only' in r)).toBe(false);
  });

  it('keeps newspaper-read in the catalogue — it still runs and reports', () => {
    expect(FLOWS.map(f => f.name)).toContain('newspaper-read');
  });
});

describe('route — nearest town hall (#592)', () => {
  it('routes the map surface and the shared metric to the one flow that drives it', () => {
    expect(route(['src/client/components/map/MapSurface.tsx']).required)
      .toEqual([SPINE_FLOW, 'nearest-town-hall']);
    expect(route(['src/shared/nearest-town.ts']).required)
      .toEqual([SPINE_FLOW, 'nearest-town-hall']);
  });

  it('does not swallow the rest of the map folder', () => {
    expect(route(['src/client/components/map/MapContextMenu.tsx']).required)
      .toEqual([SPINE_FLOW, 'building-details']);
  });
});

describe('route — the directory tree (#526)', () => {
  // #1140: the directory rule now also requires search-menu-read, which reads the same pages.
  it('routes the parser and the service to the two flows that read the tree', () => {
    const d = route(['src/server/search-menu-service.ts', 'src/server/search-menu-parser.ts']);
    expect(d.required).toEqual([SPINE_FLOW, 'directory-browse', 'search-menu-read']);
  });

  it('routes the directory page, its ref helper and the search store the same way', () => {
    const d = route([
      'src/client/components/search/DirectoryPage.tsx',
      'src/client/components/search/directory-refs.ts',
      'src/client/store/search-store.ts',
    ]);
    expect(d.required).toEqual([SPINE_FLOW, 'directory-browse', 'search-menu-read']);
  });

  it.each([
    'src/server/ws-handlers/search-handlers.ts',
    'src/server/search-menu-service.ts',
    'src/server/session/login-handler.ts',
  ])('%s requires search-menu-read', (file) => {
    expect(route([file]).required).toContain('search-menu-read');
  });

  it.each([
    'SearchPanel.tsx', 'MediaPage.tsx', 'TycoonFullProfileView.tsx', 'TycoonProfileView.tsx',
    'DirectoryPage.tsx', 'directory-refs.ts', 'home-tiles.ts', 'index.ts',
  ])('routes the search screen file %s to both search flows, with a browser look', (name) => {
    const d = route([`src/client/components/search/${name}`]);
    expect(d.required).toEqual([SPINE_FLOW, 'directory-browse', 'search-menu-read']);
    expect(d.needsL3).toBe(true);
  });

  it.each(['src/client/store/search-store.ts', 'src/server/search-menu-parser.ts'])(
    '%s needs no browser look', (file) => {
      expect(route([file]).needsL3).toBe(false);
    },
  );

  it('leaves the search WS handler routing as it was', () => {
    const d = route(['src/server/ws-handlers/search-handlers.ts']);
    expect(d.required).toEqual(expect.arrayContaining([
      SPINE_FLOW, 'people-search', 'building-details', 'politics-read',
    ]));
    expect(d.required).not.toContain('directory-browse');
  });
});

// ---- #1134: reachability, gate-only flows, dead rules, the handler ratchet ----------------

const ROOT = path.resolve(__dirname, '../..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean);
const flowNames = FLOWS.map(f => f.name);
const GENERATED_OUTPUT_SOURCE = '^report\\/|^coverage\\/|^dist\\/|^logs\\/';

/** The rule `route()` picks — first match wins. */
function firstRule(routes: RouteRule[], p: string): RouteRule | undefined {
  return routes.find(r => r.test.test(p));
}

/** Every flow some path's first matching rule requires. */
function reached(routes: RouteRule[], paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) for (const f of firstRule(routes, p)?.flows ?? []) out.add(f);
  return out;
}

function unreachable(routes: RouteRule[], paths: string[], names: string[], exempt: Record<string, string>): string[] {
  const hit = reached(routes, paths);
  return names.filter(n => n !== SPINE_FLOW && !hit.has(n) && !(n in exempt));
}

/** Split a regex source on `|` at depth 0 (outside groups and classes). */
function topLevelAlternatives(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      current += c + (source[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** Directory-anchored alternatives (`^src\/…\/`) that match no path. */
function deadAlternatives(routes: RouteRule[], paths: string[]): string[] {
  const dead: string[] = [];
  for (const rule of routes) {
    if (rule.test.source === GENERATED_OUTPUT_SOURCE) continue;
    for (const alt of topLevelAlternatives(rule.test.source)) {
      if (!/^\^.*\\\/$/.test(alt)) continue;
      const re = new RegExp(alt);
      if (!paths.some(p => re.test(p))) dead.push(alt);
    }
  }
  return dead;
}

const CITATION = /[\w-]+\.pas:\d+(-\d+)?|[\w-]+\.asp:\d+(-\d+)?|#\d+/;
function uncited(set: Record<string, string>): string[] {
  return Object.keys(set).filter(k => !CITATION.test(set[k]));
}

function handlerFiles(): string[] {
  const list = (dir: string, re: RegExp) =>
    fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).map(f => `${dir}/${f}`);
  return [...list('src/server/session', /-handler\.ts$/), ...list('src/server/ws-handlers', /-handlers\.ts$/)];
}

function ratchetViolations(routes: RouteRule[], handlers: string[], fallbackOnly: Record<string, string>): string[] {
  const out: string[] = [];
  for (const h of handlers) {
    const rule = firstRule(routes, h);
    if ((!rule || rule.fallback) && !(h in fallbackOnly)) out.push(`unrouted: ${h}`);
  }
  for (const key of Object.keys(fallbackOnly)) {
    if (!handlers.includes(key)) out.push(`not a handler: ${key}`);
    else if (!firstRule(routes, key)?.fallback) out.push(`has its own rule: ${key}`);
  }
  return out;
}

describe('routing invariants (#1134)', () => {
  it('reaches every flow from some tracked path, or records it as nightly-only', () => {
    expect(unreachable(ROUTES, tracked, flowNames, NIGHTLY_ONLY)).toEqual([]);
  });

  it('agrees with route() on what a path reaches', () => {
    for (const p of ['src/server/session/politics-handler.ts', 'src/client/components/map/MapSurface.tsx']) {
      expect(route([p]).required.slice(1)).toEqual(firstRule(ROUTES, p)?.flows);
    }
  });

  it('keeps NIGHTLY_ONLY honest: real flows no path reaches', () => {
    const hit = reached(ROUTES, tracked);
    for (const key of Object.keys(NIGHTLY_ONLY)) {
      expect(flowNames).toContain(key);
      expect(hit.has(key)).toBe(false);
    }
  });

  it('keeps GATE_ONLY honest: real flows, reached by some gate, never nightly-only', () => {
    const hit = reached(ROUTES, tracked);
    for (const key of Object.keys(GATE_ONLY)) {
      expect(flowNames).toContain(key);
      expect(hit.has(key)).toBe(true);
      expect(key in NIGHTLY_ONLY).toBe(false);
    }
    expect(Object.keys(GATE_ONLY)).toContain('politics-write');
  });

  // #1145: the vote is data-gated — never required, never nightly-excluded by GATE_ONLY.
  it('keeps vote-roundtrip nightly-only with a cited reason, and GATE_ONLY at politics-write, policy-roundtrip and bank-borrow-payoff alone', () => {
    expect(NIGHTLY_ONLY['vote-roundtrip']).toMatch(/Kernel\/TownPolitics\.pas:690/);
    expect(uncited({ 'vote-roundtrip': NIGHTLY_ONLY['vote-roundtrip'] })).toEqual([]);
    expect(ROUTES.some(r => r.flows.includes('vote-roundtrip'))).toBe(false);
    expect(Object.keys(GATE_ONLY)).toEqual(['politics-write', 'policy-roundtrip', 'bank-borrow-payoff']);
  });

  // #1149: the fixture builder is the one permanent mutation — nightly only, no gate requires it.
  it('keeps fixtures-ensure nightly-only with its card cited, never gate-only, named by no route', () => {
    expect(NIGHTLY_ONLY['fixtures-ensure']).toMatch(/#1149/);
    expect(uncited({ 'fixtures-ensure': NIGHTLY_ONLY['fixtures-ensure'] })).toEqual([]);
    expect('fixtures-ensure' in GATE_ONLY).toBe(false);
    expect(ROUTES.some(r => r.flows.includes('fixtures-ensure'))).toBe(false);
    expect(flowNames).toContain('fixtures-ensure');
  });

  it('cites a reason for every exemption', () => {
    expect(uncited(NIGHTLY_ONLY)).toEqual([]);
    expect(uncited(GATE_ONLY)).toEqual([]);
    for (const value of Object.values(FALLBACK_ONLY)) expect(value).toMatch(/^(awaiting card #\d+|excluded: \S)/);
  });

  it('has no dead directory-anchored alternative in any rule', () => {
    expect(deadAlternatives(ROUTES, tracked)).toEqual([]);
  });

  it('routes every handler file by a dedicated rule, or lists it in FALLBACK_ONLY', () => {
    const handlers = handlerFiles();
    expect(handlers).toContain('src/server/session/chat-handler.ts');
    expect(handlers.some(h => h.endsWith('.test.ts'))).toBe(false);
    expect(ratchetViolations(ROUTES, handlers, FALLBACK_ONLY)).toEqual([]);
    expect(ROUTES.filter(r => r.fallback)).toHaveLength(3);
  });

  describe('each invariant fails when its set is broken', () => {
    it('catches a rule shadowed by an earlier one, though a rule still names its flow', () => {
      const shadowed = [ROUTES[ROUTES.length - 1], ...ROUTES];
      expect(shadowed.some(r => r.flows.includes('nearest-town-hall'))).toBe(true);
      expect(unreachable(shadowed, tracked, flowNames, NIGHTLY_ONLY)).toContain('nearest-town-hall');
    });

    it('catches an unlisted, unreached flow', () => {
      expect(unreachable(ROUTES, tracked, [...flowNames, 'brand-new-flow'], NIGHTLY_ONLY)).toEqual(['brand-new-flow']);
    });

    it('catches a dead directory alternative, and exempts the generated-output rule', () => {
      const dead: RouteRule = { test: /^src\/client\/no-such-dir\/|^src\/client\//, flows: [], why: 'x' };
      expect(deadAlternatives([dead], tracked)).toEqual(['^src\\/client\\/no-such-dir\\/']);
      const generated = ROUTES.filter(r => r.test.source === GENERATED_OUTPUT_SOURCE);
      expect(generated).toHaveLength(1);
      expect(deadAlternatives(generated, [])).toEqual([]);
    });

    it('splits only on top-level alternation', () => {
      expect(topLevelAlternatives('^a\\/(b|c)\\/|[|]x|\\|y')).toEqual(['^a\\/(b|c)\\/', '[|]x', '\\|y']);
    });

    it('catches an unlisted handler file', () => {
      const handlers = [...handlerFiles(), 'src/server/session/brand-new-handler.ts'];
      expect(ratchetViolations(ROUTES, handlers, FALLBACK_ONLY)).toEqual([
        'unrouted: src/server/session/brand-new-handler.ts',
      ]);
    });

    it('catches a handler rule placed after a fallback', () => {
      const own = ROUTES.find(r => r.test.test('src/server/session/politics-handler.ts') && !r.fallback) as RouteRule;
      const moved = [...ROUTES.filter(r => r !== own), own];
      expect(ratchetViolations(moved, handlerFiles(), FALLBACK_ONLY)).toContain(
        'unrouted: src/server/session/politics-handler.ts',
      );
    });

    it('catches a stale FALLBACK_ONLY key and one that is no handler', () => {
      const stale = { ...FALLBACK_ONLY, 'src/server/session/politics-handler.ts': 'awaiting card #1' };
      expect(ratchetViolations(ROUTES, handlerFiles(), stale)).toEqual([
        'has its own rule: src/server/session/politics-handler.ts',
      ]);
      const ghost = { ...FALLBACK_ONLY, 'src/server/session/gone-handler.ts': 'awaiting card #1' };
      expect(ratchetViolations(ROUTES, handlerFiles(), ghost)).toEqual(['not a handler: src/server/session/gone-handler.ts']);
    });

    it('catches a reason with no citation', () => {
      expect(uncited({ x: 'noisy' })).toEqual(['x']);
      expect(uncited({ x: 'see #12' })).toEqual([]);
      expect(uncited({ x: 'News.pas:986' })).toEqual([]);
      expect(uncited({ x: 'tycoonratings.asp:24-25' })).toEqual([]);
    });
  });
});

describe('route — L3 on the component folders (#1134)', () => {
  it.each([
    'src/client/components/mobile/BottomNav.tsx',
    'src/client/components/hud/CommandBar.tsx',
    'src/client/components/sheet/Sheet.tsx',
    'src/client/components/modals/BuildMenu.tsx',
    'src/client/components/map/MapContextMenu.tsx',
  ])('flags %s as needing the browser layer', file => {
    expect(route([file]).needsL3).toBe(true);
  });

  it('keeps the map surface on its flow, now with a browser look', () => {
    const d = route(['src/client/components/map/MapSurface.tsx']);
    expect(d.required).toEqual([SPINE_FLOW, 'nearest-town-hall']);
    expect(d.needsL3).toBe(true);
  });

  it('does not flag the server or shared halves of a split rule', () => {
    expect(route(['src/shared/nearest-town.ts']).needsL3).toBe(false);
    expect(route(['src/server/ws-handlers/newspaper-handlers.ts']).needsL3).toBe(false);
  });

  it('flags the paper modal, on the board read', () => {
    const d = route(['src/client/components/modals/NewspaperModal.tsx']);
    expect(d.required).toEqual([SPINE_FLOW, 'newspaper-board-read']);
    expect(d.needsL3).toBe(true);
  });
});

describe('route — handler rules seeded by #1134', () => {
  it('routes the misc WS handlers to the favourites flows', () => {
    const d = route(['src/server/ws-handlers/misc-handlers.ts']);
    expect(d.required).toContain('favorites-roundtrip');
    expect(d.required).toContain('favorites-folders');
  });

  it('routes the building WS handlers to the flows that send their messages', () => {
    expect(route(['src/server/ws-handlers/building-handlers.ts']).required).toEqual([
      // #1152: inspector-reads sends GATE_CONNECTIONS / SERVICE_FIGURES / WORKER_COUNTS / REFRESH_PROPERTIES.
      SPINE_FLOW, 'building-details', 'politics-write', 'permission-negative', 'nearest-town-hall',
      'build-menu-read', 'place-rename-demolish', 'inspector-reads',
    ]);
  });

  it.each(['src/server/session/building-details-handler.ts', 'src/server/session/building-property-handler.ts'])(
    'routes %s to the inspector, the write and the permission flows',
    file => {
      expect(route([file]).required).toEqual([
        SPINE_FLOW, 'building-details', 'politics-write', 'permission-negative', 'town-min-wage',
        // #1152: the inspector reads and the owner setters on SPO_test3's fixtures.
        'inspector-reads', 'store-price-salaries', 'industry-output-price', 'facility-open-close', 'industry-auto-buy',
        // #1153: the trade role and level on the warehouse and industry fixtures.
        'trade-settings',
      ]);
    },
  );

  it('routes the politics WS handlers like the session one', () => {
    expect(route(['src/server/ws-handlers/politics-handlers.ts']).required).toEqual([
      SPINE_FLOW, 'politics-read', 'politics-write', 'town-min-wage', 'publicity-roundtrip',
    ]);
  });

  it('routes the mail WS handlers to the mail flows', () => {
    expect(route(['src/server/ws-handlers/mail-handlers.ts']).required).toEqual([
      SPINE_FLOW, 'mail-roundtrip', 'zoning-alert-read', 'mail-drafts', 'mail-send-from-draft', 'mail-reply',
    ]);
  });

  it('still routes a FALLBACK_ONLY handler, through the fallback', () => {
    expect(route(['src/server/session/chat-handler.ts']).required).toEqual([
      SPINE_FLOW, 'politics-read', 'politics-write', 'building-details',
    ]);
    expect('src/server/session/chat-handler.ts' in FALLBACK_ONLY).toBe(true);
  });

  it('keeps cross-cutting session helpers on the fallback, by design', () => {
    expect(route(['src/server/session/push-dispatcher.ts']).required).toEqual([
      SPINE_FLOW, 'politics-read', 'politics-write', 'building-details',
    ]);
  });
});

describe('route — world readers (#1139)', () => {
  it.each([
    'src/server/ws-handlers/map-handlers.ts',
    'src/server/session/context-status-handler.ts',
    'src/server/session/world-events-handler.ts',
    'src/server/session/zone-surface-handler.ts',
  ])('%s requires world-readers and building-details, and is no longer fallback-only', file => {
    const required = route([file]).required;
    expect(required).toEqual(expect.arrayContaining(['world-readers', 'building-details']));
    expect(file in FALLBACK_ONLY).toBe(false);
  });

  it('misc-handlers gains world-readers', () => {
    expect(route(['src/server/ws-handlers/misc-handlers.ts']).required)
      .toEqual(expect.arrayContaining(['world-readers', 'favorites-roundtrip', 'favorites-folders']));
  });

  it.each(['ContextStatusStrip', 'WorldEventTicker', 'OverlayMenu'])('hud/%s routes to world-readers with a browser look', name => {
    const d = route([`src/client/components/hud/${name}.tsx`]);
    expect(d.required).toEqual([SPINE_FLOW, 'world-readers']);
    expect(d.needsL3).toBe(true);
  });

  it('other hud files keep the building-details rule', () => {
    const d = route(['src/client/components/hud/CommandBar.tsx']);
    expect(d.required).toEqual([SPINE_FLOW, 'building-details']);
    expect(d.needsL3).toBe(true);
  });

  it.each(['context-status', 'world-event', 'map'])('client handlers/%s-handler routes to world-readers', name => {
    const d = route([`src/client/handlers/${name}-handler.ts`]);
    expect(d.required).toEqual([SPINE_FLOW, 'world-readers']);
    expect(d.needsL3).toBe(false);
  });
});

describe('route — session & company (#1142)', () => {
  it('misc-handlers requires cluster-info-read beside the favorites flows', () => {
    expect(route(['src/server/ws-handlers/misc-handlers.ts']).required)
      .toEqual(expect.arrayContaining(['cluster-info-read', 'favorites-roundtrip', 'favorites-folders']));
  });

  it('login-handler requires company-switch', () => {
    expect(route(['src/server/session/login-handler.ts']).required).toContain('company-switch');
  });

  it('CompanyStage routes to company-switch, no browser look', () => {
    const d = route(['src/client/components/login/CompanyStage.tsx']);
    expect(d.required).toEqual([SPINE_FLOW, 'company-switch']);
    expect(d.needsL3).toBe(false);
  });

  it('CompanyCreationModal routes to cluster-info-read with a browser look', () => {
    const d = route(['src/client/components/modals/CompanyCreationModal.tsx']);
    expect(d.required).toEqual([SPINE_FLOW, 'cluster-info-read']);
    expect(d.needsL3).toBe(true);
  });

  it('the client auth handler routes to both flows', () => {
    const d = route(['src/client/handlers/auth-handler.ts']);
    expect(d.required).toEqual([SPINE_FLOW, 'company-switch', 'cluster-info-read']);
    expect(d.needsL3).toBe(false);
  });

  it('neither flow is nightly-only', () => {
    expect(NIGHTLY_ONLY).not.toHaveProperty('company-switch');
    expect(NIGHTLY_ONLY).not.toHaveProperty('cluster-info-read');
  });
});

describe('route — profile & finance reads (#1141)', () => {
  it.each([
    'src/server/ws-handlers/profile-handlers.ts',
    'src/server/session/profile-finance-handler.ts',
    'src/server/session/auto-connection-handler.ts',
    'src/client/store/profile-store.ts',
    'src/server/session/picture-transfer.ts',
  ])('%s requires profile-read and the profile write flows', file => {
    expect(route([file]).required).toEqual([
      SPINE_FLOW, 'profile-read', 'policy-roundtrip', 'autoconnection-roundtrip',
      'bank-borrow-payoff', 'bank-send-return', 'portrait-roundtrip',
    ]);
    expect(file in FALLBACK_ONLY).toBe(false);
  });

  it('profile-finance-handler.ts requires both bank flows and picture-transfer.ts the portrait flow (#1147)', () => {
    const bank = route(['src/server/session/profile-finance-handler.ts']).required;
    expect(bank).toContain('bank-borrow-payoff');
    expect(bank).toContain('bank-send-return');
    expect(route(['src/server/session/picture-transfer.ts']).required).toContain('portrait-roundtrip');
  });

  it('keeps bank-borrow-payoff gate-only with its cited broadcast, and the other two nightly (#1147)', () => {
    expect(GATE_ONLY['bank-borrow-payoff']).toMatch(/Kernel\/Kernel\.pas:8849-8859/);
    expect(uncited({ 'bank-borrow-payoff': GATE_ONLY['bank-borrow-payoff'] })).toEqual([]);
    expect('bank-send-return' in GATE_ONLY).toBe(false);
    expect('portrait-roundtrip' in GATE_ONLY).toBe(false);
  });

  it('auto-connection-handler.ts requires both write flows; only policy-roundtrip is gate-only (#1146)', () => {
    const required = route(['src/server/session/auto-connection-handler.ts']).required;
    expect(required).toContain('policy-roundtrip');
    expect(required).toContain('autoconnection-roundtrip');
    expect(GATE_ONLY['policy-roundtrip']).toMatch(/Kernel\/Kernel\.pas:11790-11800/);
    expect('autoconnection-roundtrip' in GATE_ONLY).toBe(false);
  });

  it('routes an Empire panel file to the favorites flows and profile-read', () => {
    expect(route(['src/client/components/empire/ProfilePanel.tsx']).required).toEqual([
      SPINE_FLOW, 'favorites-roundtrip', 'favorites-folders', 'profile-read',
    ]);
  });

  it('keeps an Empire panel stylesheet L3-only', () => {
    const d = route(['src/client/components/empire/ProfilePanel.module.css']);
    expect(d.required).toEqual([SPINE_FLOW]);
    expect(d.needsL3).toBe(true);
  });
});

describe('route — roads & zones (#1151)', () => {
  it.each([
    'src/server/ws-handlers/road-handlers.ts',
    'src/server/session/road-handler.ts',
  ])('%s requires road-roundtrip and is no longer fallback-only', file => {
    const d = route([file]);
    expect(d.required).toContain('road-roundtrip');
    expect(d.required).not.toContain('politics-write');
    expect(file in FALLBACK_ONLY).toBe(false);
  });

  it.each([
    'src/server/session/zone-surface-handler.ts',
    'src/server/ws-handlers/map-handlers.ts',
  ])('%s requires zone-roundtrip and still world-readers', file => {
    const { required } = route([file]);
    expect(required).toContain('zone-roundtrip');
    expect(required).toContain('world-readers');
  });

  it('misc-handlers.ts (the REQ_DEFINE_ZONE sender) requires zone-roundtrip', () => {
    expect(route(['src/server/ws-handlers/misc-handlers.ts']).required).toContain('zone-roundtrip');
  });

  it('src/shared/road-circuits.ts is connection reachability, not road-roundtrip', () => {
    expect(route(['src/shared/road-circuits.ts']).required).not.toContain('road-roundtrip');
  });

  it('neither flow is nightly-only or gate-only', () => {
    for (const name of ['road-roundtrip', 'zone-roundtrip']) {
      expect(NIGHTLY_ONLY).not.toHaveProperty(name);
      expect(GATE_ONLY).not.toHaveProperty(name);
    }
  });
});

describe('route — inspector flows (#1152)', () => {
  const ROUTED = ['inspector-reads', 'store-price-salaries', 'industry-output-price', 'facility-open-close', 'industry-auto-buy'];
  const ALL = [...ROUTED, 'industry-supply-limits'];

  it.each([
    'src/server/session/building-property-handler.ts',
    'src/server/session/building-details-handler.ts',
    'src/client/components/building/SuppliesGroup.tsx',
    'src/shared/building-details/template-groups.ts',
  ])('%s requires the five routed inspector flows', file => {
    const { required } = route([file]);
    for (const flow of ROUTED) expect(required).toContain(flow);
    expect(required).not.toContain('industry-supply-limits');
  });

  it('building-handlers.ts requires inspector-reads, the one flow sending its four inspector reads', () => {
    const { required } = route(['src/server/ws-handlers/building-handlers.ts']);
    expect(required).toContain('inspector-reads');
    expect(required).not.toContain('store-price-salaries');
  });

  it('keeps industry-supply-limits nightly-only with a cited reason, named by no rule', () => {
    expect(NIGHTLY_ONLY['industry-supply-limits']).toMatch(/Kernel\/Kernel\.pas:7169-7171/);
    expect(uncited({ 'industry-supply-limits': NIGHTLY_ONLY['industry-supply-limits'] })).toEqual([]);
    expect(ROUTES.some(r => r.flows.includes('industry-supply-limits'))).toBe(false);
  });

  it('none of the six is gate-only, and only industry-supply-limits is nightly-only', () => {
    for (const flow of ALL) expect(GATE_ONLY).not.toHaveProperty(flow);
    for (const flow of ROUTED) expect(NIGHTLY_ONLY).not.toHaveProperty(flow);
  });
});

describe('route — inspector connections & trade (#1153)', () => {
  const NIGHTLY = [
    'supplier-hire-fire', 'client-hire-remove', 'connect-on-map', 'company-input-demand', 'warehouse-wares',
    'quick-trade-roundtrip',
  ];
  const ROUTED = ['trade-settings', 'supplier-search-read'];

  it.each([
    'src/server/session/building-property-handler.ts',
    'src/server/session/building-details-handler.ts',
    'src/client/components/building/PropertyGroup.tsx',
    'src/shared/building-details/template-groups.ts',
  ])('%s requires trade-settings', file => {
    expect(route([file]).required).toContain('trade-settings');
  });

  it('misc-handlers.ts (the REQ_SEARCH_CONNECTIONS / REQ_CONNECTION_REACHABILITY sender) requires supplier-search-read', () => {
    const { required } = route(['src/server/ws-handlers/misc-handlers.ts']);
    expect(required).toContain('supplier-search-read');
    expect(required).not.toContain('trade-settings');
  });

  it.each(NIGHTLY)('keeps %s nightly-only with a cited reason, named by no rule, never gate-only', flow => {
    expect(NIGHTLY_ONLY[flow]).toBeDefined();
    expect(uncited({ [flow]: NIGHTLY_ONLY[flow] })).toEqual([]);
    expect(ROUTES.some(r => r.flows.includes(flow))).toBe(false);
    expect(GATE_ONLY).not.toHaveProperty(flow);
  });

  it('keeps the two routed flows out of NIGHTLY_ONLY and GATE_ONLY', () => {
    for (const flow of ROUTED) {
      expect(NIGHTLY_ONLY).not.toHaveProperty(flow);
      expect(GATE_ONLY).not.toHaveProperty(flow);
    }
  });

  it('cites the kernel lines each nightly-only reason rests on', () => {
    expect(NIGHTLY_ONLY['supplier-hire-fire']).toMatch(/Kernel\/Kernel\.pas:6784-6785/);
    expect(NIGHTLY_ONLY['connect-on-map']).toMatch(/Kernel\/World\.pas:3710-3726/);
    expect(NIGHTLY_ONLY['company-input-demand']).toMatch(/Kernel\/Kernel\.pas:5887/);
    expect(NIGHTLY_ONLY['warehouse-wares']).toMatch(/StdBlocks\/MegaWarehouse\.pas:25/);
    expect(NIGHTLY_ONLY['quick-trade-roundtrip']).toMatch(/Kernel\/Kernel\.pas:4593-4600/);
  });
});

describe('route — build & demolish (#1150)', () => {
  it.each([
    'src/server/session/building-templates-handler.ts',
    'src/server/session/building-management-handler.ts',
    'src/client/handlers/build-menu-handler.ts',
  ])('%s requires build-menu-read and place-rename-demolish', file => {
    expect(route([file]).required).toEqual([SPINE_FLOW, 'build-menu-read', 'place-rename-demolish']);
    expect(file in FALLBACK_ONLY).toBe(false);
  });

  it('neither flow is nightly-only or gate-only', () => {
    for (const name of ['build-menu-read', 'place-rename-demolish']) {
      expect(NIGHTLY_ONLY).not.toHaveProperty(name);
      expect(GATE_ONLY).not.toHaveProperty(name);
    }
  });
});
