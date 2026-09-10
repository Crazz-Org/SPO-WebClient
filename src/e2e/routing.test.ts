import { ROUTES, SPINE_FLOW, route, presidentMembersInDiff, isCallSite, launderedTests } from './routing';
import { PRESIDENT_MEMBERS } from './config';

describe('route', () => {
  it('appends the login spine whenever anything observable changed', () => {
    const decision = route(['src/client/components/building/SaveIndicator.tsx']);
    expect(decision.required[0]).toBe(SPINE_FLOW);
    expect(decision.required).toContain('building-details');
  });

  it('routes a wire-level change to the governance and inspector flows', () => {
    const decision = route(['src/server/session/politics-handler.ts']);
    expect(decision.required).toEqual(
      expect.arrayContaining([SPINE_FLOW, 'politics-read', 'politics-write', 'building-details']),
    );
    expect(decision.staticOnly).toBe(false);
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

  it('routes mail-handler.ts to mail-roundtrip, not to the governance flows', () => {
    const d = route(['src/server/session/mail-handler.ts']);
    expect(d.required).toEqual([SPINE_FLOW, 'mail-roundtrip']);
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

  it('reports why the live drive was required', () => {
    const decision = route(['src/server/session/politics-handler.ts']);
    expect(decision.reasons.join(' ')).toMatch(/wire-level/);
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
  it('routes the newspaper gateway handler to newspaper-read, not to the governance flows', () => {
    const d = route(['src/server/session/newspaper-handler.ts']);
    expect(d.required).toEqual([SPINE_FLOW, 'newspaper-read']);
  });

  it('routes the modal and the store the same way', () => {
    expect(route(['src/client/components/modals/NewspaperModal.tsx']).required)
      .toContain('newspaper-read');
    expect(route(['src/client/store/newspaper-store.ts']).required)
      .toContain('newspaper-read');
  });
});
