/**
 * Diff -> required flows (doc/E2E-POLICY.md §4).
 *
 * A fixed smoke script drifts and eventually tests nothing that changed. The routing
 * table is what keeps the run pointed at the delta — and what makes an unmapped path an
 * error rather than a silent pass.
 */

import { PRESIDENT_MEMBERS } from './config';

export interface RouteRule {
  /** Matched against the repo-relative path. */
  test: RegExp;
  /** L2 flows this path requires. */
  flows: string[];
  /** True when only a browser can observe the change (renderer, layout, input). */
  needsL3?: boolean;
  why: string;
}

/** Always appended — the spine is the cheapest regression detector there is. */
export const SPINE_FLOW = 'login-spine';

export const ROUTES: RouteRule[] = [
  // Order matters: the first matching rule wins, so the paths that need no live drive
  // are matched before the broad source rules that would otherwise swallow them.
  {
    test: /^doc\/|\.md$|^src\/mock-server\/|\.test\.tsx?$/,
    flows: [],
    why: 'documentation, L1 substrate or tests — static verification only',
  },
  {
    test: /^package(-lock)?\.json$/,
    flows: ['building-details'],
    why: 'dependency change — the shipped code moved even though no src/ file did',
  },
  {
    // Before the tooling rule: that one ends at .json/.js/.yml, so a TypeScript build config
    // fell through to no rule at all and the gate failed closed (#172). This file is not
    // tooling — it is what produces the bundle the browser runs.
    test: /^vite\.config\.ts$/,
    flows: ['building-details'],
    needsL3: true,
    why: 'the client bundle is built here — the shipped code moved even though no src/ file did, and a minifier or chunking setting is only observable once a browser runs it',
  },
  {
    test: /^src\/e2e\/|^scripts\/|^\.claude\/|^\.github\/|^\.[^/]*$|^[^/]+\.(json|js|cjs|mjs|ya?ml)$/,
    flows: [],
    why: 'tooling and repo config — verified by its own unit tests',
  },
  {
    test: /^report\/|^coverage\/|^dist\/|^logs\//,
    flows: [],
    why: 'generated output — not source',
  },
  {
    // The container image. No L2 flow can observe it: the bench builds the worktree and
    // runs `dist/server/server.js` directly — it never builds the image. Proven by its own
    // suite instead (`container-healthcheck` runs the shipped HEALTHCHECK snippet). Deploy
    // machinery itself now lives in SPO-Deploy, outside this repo. Without this rule the
    // gate failed closed on any change to it (#215).
    test: /^Dockerfile(\.[\w-]+)?$|^\.dockerignore$/,
    flows: [],
    why: 'container image — the live drive runs the built tree, not the image',
  },
  {
    test: /^src\/client\/renderer\/|\.module\.css$|^src\/client\/layouts\/|^src\/client\/mobile\/|\.css$/,
    flows: [],
    needsL3: true,
    why: 'pixels — a WebSocket drive cannot see a rendered frame',
  },
  {
    // Before the broad wire-level rule below, which would otherwise swallow
    // `session/favorites-handler.ts` and drive the politics flows instead of
    // the one flow that actually exercises the Favorites tree.
    test: /favorites-handler\.ts$|^src\/client\/components\/empire\/|^src\/shared\/favorites-tree\.ts$/,
    flows: ['favorites-roundtrip', 'favorites-folders'],
    why: 'the Favorites tree — the two flows that write to it',
  },
  {
    // Before the broad wire-level rule below, which would otherwise route
    // login-handler.ts's people-search sweep through flows that never drive it.
    test: /^src\/server\/session\/login-handler\.ts$/,
    flows: ['people-search', 'politics-read', 'politics-write', 'building-details'],
    why: 'the directory login/search path changed — including the Root/Users sweep',
  },
  {
    // Same reason, one rule earlier than the ws-handlers rule below.
    test: /^src\/server\/ws-handlers\/search-handlers\.ts$/,
    flows: ['people-search', 'building-details', 'politics-read'],
    why: 'the search WS handler changed — including the people-search request path',
  },
  {
    // Before the broad wire-level rule below, which would otherwise route a
    // mail-handler change through flows that never open the mail socket.
    test: /^src\/server\/session\/mail-handler\.ts$/,
    flows: ['mail-roundtrip'],
    why: 'the mail-socket handler changed — the one flow that drives it',
  },
  {
    // Before the broad wire-level rule below: the paper is not on the RDO wire
    // at all, so the governance flows would say nothing about it.
    test: /newspaper-handlers?\.ts$|^src\/client\/components\/modals\/NewspaperModal\.tsx$|^src\/client\/store\/newspaper-store\.ts$/,
    flows: ['newspaper-read'],
    why: 'the town paper — the one flow that reads it',
  },
  {
    test: /^src\/shared\/rdo-|^src\/server\/rdo\.ts$|^src\/server\/session\//,
    flows: ['politics-read', 'politics-write', 'building-details'],
    why: 'wire-level change: frames, session phases or RDO members',
  },
  {
    test: /^src\/shared\/types\/message-types\.ts$/,
    flows: ['politics-read', 'building-details', 'mail-roundtrip'],
    why: 'the client/gateway message contract changed',
  },
  {
    test: /^src\/server\/ws-handlers\/|^src\/server\/server\.ts$/,
    flows: ['building-details', 'politics-read'],
    why: 'gateway request handling changed',
  },
  {
    test: /^src\/client\/components\/politics\//,
    flows: ['politics-read', 'politics-write', 'permission-negative'],
    why: 'governance UI — including who is offered the controls',
  },
  {
    test: /^src\/client\/components\/building\/|^src\/shared\/building-details\//,
    flows: ['building-details'],
    why: 'facility inspector and its template groups',
  },
  {
    test: /^src\/client\/components\/mail\/|^src\/server\/mail/,
    flows: ['mail-roundtrip'],
    why: 'mail path',
  },
  {
    test: /^src\/client\/|^src\/shared\/|^src\/server\//,
    flows: ['building-details'],
    why: 'code reached through the gateway contract',
  },
];

export interface RoutingDecision {
  changed: string[];
  /** Flows to run, spine first. */
  required: string[];
  /** Paths no rule matched — the gate fails closed on these. */
  unmapped: string[];
  /** A browser smoke is required on top of the WS drive. */
  needsL3: boolean;
  /** Nothing in the diff can be observed live. */
  staticOnly: boolean;
  reasons: string[];
}

/**
 * @param changedFiles every path this branch touched, repo-relative.
 * @param deletedFiles the subset of those the branch removed from the tree. A removed path
 *   that no rule covers is not an unmapped area waiting for a rule — there is nothing left
 *   at it to drive, and no later diff can name it again. A removed path a rule *does* cover
 *   still routes: deleting a session handler changes behaviour, and the rule says which
 *   flows see it.
 */
export function route(changedFiles: string[], deletedFiles: string[] = []): RoutingDecision {
  const required = new Set<string>();
  const unmapped: string[] = [];
  const reasons = new Set<string>();
  const deleted = new Set(deletedFiles);
  let needsL3 = false;
  let touchedCode = false;

  for (const file of changedFiles) {
    const rule = ROUTES.find(r => r.test.test(file));
    if (!rule) {
      if (!deleted.has(file)) unmapped.push(file);
      continue;
    }
    if (rule.needsL3) needsL3 = true;
    if (rule.flows.length > 0 || rule.needsL3) {
      touchedCode = true;
      reasons.add(rule.why);
    }
    for (const flow of rule.flows) required.add(flow);
  }

  // The spine rides along whenever anything observable changed.
  const ordered = touchedCode ? [SPINE_FLOW, ...Array.from(required)] : [];

  return {
    changed: changedFiles,
    required: ordered,
    unmapped,
    needsL3,
    staticOnly: ordered.length === 0 && !needsL3,
    reasons: Array.from(reasons),
  };
}

/**
 * Files that could actually emit a frame — an allowlist, not a denylist.
 *
 * A member name appears in plenty of places that are references rather than call sites:
 * the catalogue that declares them, the policy that documents them, the tests that pin
 * them, a generated coverage report that lists them. Scanning those would block every
 * change to the gate itself — the same mention-versus-invocation trap the push hook has.
 * Only shipped `src/` TypeScript, excluding the e2e tooling and tests, can be a call site.
 */
export function isCallSite(file: string): boolean {
  if (!/^src\/.*\.tsx?$/.test(file)) return false;
  if (/\.test\.tsx?$/.test(file)) return false;
  if (/^src\/e2e\//.test(file)) return false;
  return true;
}

/**
 * President-only members newly written by this diff. A hit sends the gate to the server
 * for the account's capability (doc/E2E-POLICY.md §7) — `SPO_test3` is not president, and
 * `RDOSitMinister` has two variants a name+arity catalogue cannot tell apart.
 *
 * Only **added** lines in real call sites count. A deletion cannot introduce a bad frame,
 * and a mention in prose is not a call.
 */
export function presidentMembersInDiff(diffText: string): string[] {
  const hits = new Set<string>();
  let file = '';
  let scanning = false;

  for (const line of diffText.split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) {
      file = header[1];
      scanning = isCallSite(file);
      continue;
    }
    if (!scanning) continue;
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    for (const member of PRESIDENT_MEMBERS) {
      if (new RegExp(`\\b${member}\\b`).test(line)) hits.add(member);
    }
  }
  return PRESIDENT_MEMBERS.filter(m => hits.has(m));
}

/**
 * Attempt N must not "fix" a test that was failing at attempt N-1.
 * CLAUDE.md's rule, applied to the retry loop by machine.
 */
export function launderedTests(changedFiles: string[], previouslyFailingTests: string[]): string[] {
  const normalise = (p: string) => p.replace(/^\.\//, '');
  const failing = new Set(previouslyFailingTests.map(normalise));
  return changedFiles.map(normalise).filter(f => failing.has(f));
}
