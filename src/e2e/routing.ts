/**
 * Diff -> required flows (doc/E2E-POLICY.md §4).
 *
 * A fixed smoke script drifts and eventually tests nothing that changed. The routing
 * table is what keeps the run pointed at the delta — and what makes an unmapped path an
 * error rather than a silent pass.
 */

import { PRESIDENT_MEMBERS, SECONDARY_ACCOUNT } from './config';

export interface RouteRule {
  /** Matched against the repo-relative path. */
  test: RegExp;
  /** L2 flows this path requires. */
  flows: string[];
  /** True when only a browser can observe the change (renderer, layout, input). */
  needsL3?: boolean;
  /**
   * A broad catch-all: it routes whatever no specific rule claimed. A handler file whose first
   * matching rule is a fallback must be a FALLBACK_ONLY key (routing.test.ts ratchet).
   */
  fallback?: boolean;
  why: string;
}

/** Always appended — the spine is the cheapest regression detector there is. */
export const SPINE_FLOW = 'login-spine';

/**
 * Flow -> why no gate requires it (data-gated, or a reading). The nightly still runs it.
 * A data-gated flow ends UNPROVEN when the world holds no data, and a required UNPROVEN flow
 * fails the gate (scripts/verify-gate.js, stage 6) — so routing must never require it.
 */
export const NIGHTLY_ONLY: Record<string, string> = {
  'newspaper-read':
    'data-gated: planitia keeps no newspaper issue and the bench cannot create one (News.pas:986, #1009) — a required run could only end UNPROVEN, which fails the gate',
  'warehouse-role-reading': 'a reading, recorded and never asserted (#1006) — nothing a gate could require',
  'vote-roundtrip':
    'data-gated: a prior vote cannot be seeded (a vote with no prior cannot be retracted) and goes stale at any town election (Kernel/TownPolitics.pas:690, :744; Kernel/Politics.pas:916-933) — E2E-POLICY §7',
  'fixtures-ensure':
    'builds only when a fixture is missing — the one sanctioned permanent mutation (#1149); the nightly re-creates a fixture that disappeared, no gate requires it',
  'industry-supply-limits':
    "data-gated: every industry fixture candidate is a farm (#1149), whose supply gate is a plain TPullInput (StdBlocks/Farms.pas:76-82) that never caches a sort mode (Kernel/Kernel.pas:7169-7171; only Kernel/MediaGates.pas:388-389 does), and a fixture built fresh has no supplier row for the overprice write — RDOSetInputSortMode / RDOSetInputOverPrice end UNPROVEN, which fails a gate (E2E-POLICY §7)",
  'supplier-hire-fire':
    "data-gated: it needs a supplier of SPO_test3's own company, in Helartia, on an input fluid of the industry fixture; none ends UNPROVEN, which fails a gate. Hiring anyone else writes their gate: TGate.ConnectTo inserts the link on both sides (Kernel/Kernel.pas:6784-6785)",
  'client-hire-remove':
    "data-gated: it needs a client of SPO_test3's own company, in Helartia, on an output fluid of the industry fixture; none ends UNPROVEN, which fails a gate. Adding anyone else writes their gate: TGate.ConnectTo inserts the link on both sides (Kernel/Kernel.pas:6784-6785)",
  'connect-on-map':
    'data-gated: it needs an own counterpart that shares a tradeable fluid with the industry fixture. ConnectFacilities hires every matching fluid in both directions (Kernel/World.pas:3710-3726, Kernel/Kernel.pas:5470-5513), on both gates (Kernel/Kernel.pas:6784-6785)',
  'company-input-demand':
    'data-gated: an editable company input is data, not guaranteed — cEditable is written only for a meta input flagged Editable (Kernel/Kernel.pas:5887); none ends UNPROVEN, which fails a gate',
  'warehouse-wares':
    'data-gated: only a MegaStorage publishes RDOSelectWare (StdBlocks/MegaWarehouse.pas:25; a TWarehouse publishes RDOSetRole only, StdBlocks/Warehouses.pas:95), and findFixture takes the first holding that carries whGeneral (#1149), which need not be one',
  'quick-trade-roundtrip':
    "data-gated by three guards: the disconnect drops the fixture's outputs from every SPO_test3 facility's matching input, whatever its type (Kernel/Kernel.pas:4593-4600), across all its companies and towns (Kernel/Kernel.pas:4537-4553), and unregisters the fixture as an initial supplier (Kernel/Kernel.pas:4564-4565, :4606-4607); a guard that holds ends UNPROVEN, which fails a gate",
};

/**
 * Flow -> why the nightly never runs it: its action posts a message every online player sees.
 * The gate still runs it when its code changes (an explicit --flows list names it).
 */
export const GATE_ONLY: Record<string, string> = {
  'politics-write':
    'each RDOSetTaxValue by the mayor posts a world event every online player sees (Kernel/Population.pas:1264-1284, WorldLocator.SendEvent) — driven only at the gate, when its code changes',
  'policy-roundtrip':
    `RDOSetPolicyStatus broadcasts a world event naming ${SECONDARY_ACCOUNT.username} to every online tycoon, twice per run (Kernel/Kernel.pas:11790-11800, Kernel/World.pas:5179-5196, texts Kernel/Kernel.pas:13495-13497); accepted by the maintainer (2026-09-29) at the gate only, when this code changes — never in the nightly`,
  'chat-private-channel':
    'creating and deleting a channel and the typing / away states broadcast to every connected client (Interface Server/InterfaceServer.pas:4594, :4049-4060, :4690, :3968-3980); accepted by the maintainer (2026-09-29) at the gate only, when chat code changes — never in the nightly',
  'bank-borrow-payoff':
    "TBank.AskLoan broadcasts 'SPO_test3 borrowed $X from the <bank>.' to every online tycoon (Kernel/Kernel.pas:8849-8859, text Kernel/Kernel.pas:13487); accepted by the maintainer (2026-09-29) at the gate only, when this code changes — never in the nightly",
};

/**
 * Handler file (repo-relative) -> why only a fallback rule routes it:
 * `awaiting card #<n>` or `excluded: <reason>`. An area card that gives a file its own rule
 * (placed before the fallbacks) removes it from here.
 */
export const FALLBACK_ONLY: Record<string, string> = {
  'src/server/session/abandon-role-handler.ts':
    'excluded: abandoning a role is never driven (maintainer, 2026-09-29 — recorded in card #1134)',
  'src/server/session/tutorial-handler.ts':
    'excluded: the tutorial needs an active assignment and its close finalises the task (maintainer, 2026-09-29 — recorded in card #1134)',
};

export const ROUTES: RouteRule[] = [
  // Order matters: the first matching rule wins, so the paths that need no live drive
  // are matched before the broad source rules that would otherwise swallow them.
  //
  // How an E2E area card routes its flows: its rule goes BEFORE THE FALLBACKS (the rules
  // with `fallback: true`) — a rule placed after a fallback is shadowed and never matches —
  // and it removes its handler files from FALLBACK_ONLY. A data-gated flow (it ends UNPROVEN
  // when the world holds no data, and a required UNPROVEN fails the gate, verify-gate.js
  // stage 6) goes in NIGHTLY_ONLY; a flow whose action posts a message every online player
  // sees goes in GATE_ONLY (the card states the maintainer accepts the broadcast at the gate
  // on that basis). Each exemption carries a cited reason: `File.pas:Line`, `file.asp:Line`
  // or `#<issue>`. The tooling rule below routes no flow for a diff under src/e2e/; the gate
  // itself adds the flows. verify-gate.js stage 3 adds the flows the diff CHANGED — a hunk
  // inside a `FLOWS` entry, or inside a shared helper of the six flow sources, which drives
  // every flow that reaches it (src/e2e/bench/changed-flows.ts) — and the flows a card
  // DECLARES with `npm run gate -- --also-flows=a,b`. All of them land in `routing.required`,
  // so the card's own gate drives them and a required flow that ends UNPROVEN fails it.
  // `--flows=` replaces the set and is refused unless it names every required flow.
  {
    test: /^doc\/|\.md$|^src\/mock-server\/|\.test\.tsx?$|^src\/__tests__\//,
    flows: [],
    // `src/__tests__/` holds only test code and its data (baselines, the load measurement
    // and its committed output) — none of it ships in the built tree.
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
    test: /^src\/client\/renderer\/|\.module\.css$|^src\/client\/layouts\/|^src\/client\/components\/mobile\/|\.css$/,
    flows: [],
    needsL3: true,
    why: 'pixels — a WebSocket drive cannot see a rendered frame',
  },
  {
    // Before the favorites rule: the Empire panel shows the Favorites tree and the profile tabs.
    test: /^src\/client\/components\/empire\//,
    flows: ['favorites-roundtrip', 'favorites-folders', 'profile-read'],
    why: 'the Empire panel — the Favorites tree it shows and the profile & finance pages it reads',
  },
  {
    // Before the broad wire-level rule below, which would otherwise swallow
    // `session/favorites-handler.ts` and drive the politics flows instead of
    // the one flow that actually exercises the Favorites tree.
    test: /favorites-handler\.ts$|^src\/shared\/favorites-tree\.ts$/,
    flows: ['favorites-roundtrip', 'favorites-folders'],
    why: 'the Favorites tree — the two flows that write to it',
  },
  {
    // Before the broad wire-level rule below, which would otherwise route
    // login-handler.ts's people-search sweep through flows that never drive it.
    test: /^src\/server\/session\/login-handler\.ts$/,
    flows: ['people-search', 'politics-read', 'politics-write', 'building-details', 'search-menu-read', 'company-switch'],
    why: 'the directory login/search path changed — including the Root/Users sweep, the one-bucket prefix path search-menu-read drives, and the company switch (switchCompany)',
  },
  {
    // Before the search-handlers rule and the broad src/ rules below: the directory tree
    // (town page, folders, facility card) is read by this flow and by nothing else.
    test: /^src\/server\/search-menu-(service|parser)\.ts$|^src\/client\/store\/search-store\.ts$/,
    flows: ['directory-browse', 'search-menu-read'],
    why: 'the search menu service and parser — the two flows that read its pages',
  },
  {
    // Every search screen, after the test and pixel rules that claim its tests and CSS.
    test: /^src\/client\/components\/search\//,
    flows: ['directory-browse', 'search-menu-read'],
    needsL3: true,
    why: 'the search screens — the two flows that read what they show, plus a browser look',
  },
  {
    // Same reason, one rule earlier than the ws-handlers rule below.
    test: /^src\/server\/ws-handlers\/search-handlers\.ts$/,
    flows: ['people-search', 'building-details', 'politics-read', 'search-menu-read'],
    why: 'the search WS handler changed — including the people-search request path',
  },
  {
    // Before everything else below: a change to the translator itself is exercised only
    // by the flow that reads a link through it, not by the broader mail-handler rule.
    test: /^src\/shared\/local-asp-url\.ts$/,
    flows: ['zoning-alert-read'],
    why: 'the local.asp translator — the one flow that reads a link through it',
  },
  {
    // Before the broad wire-level rule below, which would otherwise route a
    // mail-handler change through flows that never open the mail socket. The WS side
    // (ws-handlers/mail-handlers.ts) is here too: the later mail rule's `^src\/server\/mail`
    // does not match it, so it used to fall to the ws-handlers fallback.
    test: /^src\/server\/session\/mail-handler\.ts$|^src\/server\/ws-handlers\/mail-handlers\.ts$/,
    flows: ['mail-roundtrip', 'zoning-alert-read', 'mail-drafts', 'mail-send-from-draft', 'mail-reply'],
    why: 'the mail handlers changed — the flows that drive them',
  },
  {
    // The paper modal: the board read the modal shows, plus a browser look at the modal.
    test: /^src\/client\/components\/modals\/NewspaperModal\.tsx$/,
    flows: ['newspaper-board-read'],
    needsL3: true,
    why: 'the town paper modal — newspaper-board-read reads the columns board it shows; a browser look at the modal',
  },
  {
    // Before the broad wire-level rule below: the paper is not on the RDO wire
    // at all, so the governance flows would say nothing about it. newspaper-read itself is
    // not required (#1009): planitia keeps no newspaper issue and the bench cannot create
    // one (News.pas:986), so it could only end UNPROVEN. The columns board read is required
    // instead: it answers with or without columns.
    test: /newspaper-handlers?\.ts$|^src\/client\/store\/newspaper-store\.ts$/,
    flows: ['newspaper-board-read'],
    why: 'the town paper — newspaper-board-read reads the columns board, which answers with or without columns; newspaper-read stays nightly-only (News.pas:986, #1009)',
  },
  {
    // Before the fallbacks below: the governance handlers are driven by these two flows.
    test: /^src\/server\/session\/politics-handler\.ts$|^src\/server\/ws-handlers\/politics-handlers\.ts$/,
    flows: ['politics-read', 'politics-write', 'town-min-wage', 'publicity-roundtrip'],
    why: 'the governance handlers changed — the flows that read and write the town hall (tax, minimum wage, publicity)',
  },
  {
    // Before the fallbacks below: the Empire panel's profile & finance reads and writes.
    // picture-transfer.ts is not a *-handler.ts, so it was never in FALLBACK_ONLY.
    test: /^src\/server\/ws-handlers\/profile-handlers\.ts$|^src\/server\/session\/(profile-finance|auto-connection)-handler\.ts$|^src\/client\/store\/profile-store\.ts$|^src\/server\/session\/picture-transfer\.ts$/,
    flows: [
      'profile-read', 'policy-roundtrip', 'autoconnection-roundtrip',
      'bank-borrow-payoff', 'bank-send-return', 'portrait-roundtrip',
    ],
    why:
      'the profile & finance handlers — the flow that reads every Empire panel tab, the two that write the strategy ' +
      'and the initial suppliers, the loan and the money transfer round trips, and the portrait upload',
  },
  {
    // Before the fallbacks below. permission-negative's one request is REQ_BUILDING_DETAILS,
    // and it asserts the canGovern that grantAccess in building-details-handler.ts computes.
    test: /^src\/server\/session\/building-(details|property)-handler\.ts$/,
    flows: [
      'building-details', 'politics-write', 'permission-negative', 'town-min-wage',
      'inspector-reads', 'store-price-salaries', 'industry-output-price', 'facility-open-close', 'industry-auto-buy',
      'trade-settings',
      'residential-settings', 'residential-repair', 'bank-settings', 'tv-settings', 'accept-cloning', 'research-roundtrip',
    ],
    why:
      'the facility details/property handlers changed — the flows that read and write a facility (including the ' +
      'minimum-wage argument builder), the one that asserts canGovern (grantAccess), the inspector reads no other ' +
      "flow sends (gate connections, service figures, worker counts, refresh), the owner setters on SPO_test3's " +
      'store and industry fixtures (#1152), the trade role and level on its warehouse and industry (#1153), and its ' +
      'residential, bank, TV, industry and research fixtures — including the RDOQueueResearch / RDOCancelResearch ' +
      'cases of buildRdoCommandArgs (#1154)',
  },
  {
    // Before the fallbacks below. A shared file: later area cards only APPEND flows here.
    // zoning-alert-read is left out: its one REQ_BUILDING_FOCUS is incidental to reading the
    // alert, it needs the secondary account, and the mail rules route it.
    test: /^src\/server\/ws-handlers\/building-handlers\.ts$/,
    flows: [
      'building-details', 'politics-write', 'permission-negative', 'nearest-town-hall',
      'build-menu-read', 'place-rename-demolish', 'inspector-reads', 'upgrade-stop',
    ],
    why:
      'the building WS handlers changed — the flows sending its REQ_BUILDING_DETAILS / TAB_DATA / SET_PROPERTY / FOCUS, ' +
      'REQ_GET_BUILDING_CATEGORIES / _FACILITIES / REQ_PLACE_BUILDING / REQ_RENAME_FACILITY / REQ_DELETE_FACILITY, ' +
      'the one sending GATE_CONNECTIONS / SERVICE_FIGURES / WORKER_COUNTS / REFRESH_PROPERTIES, and the one sending ' +
      'REQ_BUILDING_UPGRADE (#1154)',
  },
  {
    // Before the fallbacks below. A shared file: later area cards only APPEND flows here.
    test: /^src\/server\/ws-handlers\/misc-handlers\.ts$/,
    flows: [
      'favorites-roundtrip', 'favorites-folders', 'world-readers', 'cluster-info-read', 'zone-roundtrip',
      'supplier-search-read', 'research-roundtrip',
    ],
    why:
      'the misc WS handlers changed — the flows sending its REQ_EMPIRE_FACILITIES / REQ_FAVORITE_* / REQ_WORLD_EVENT / ' +
      'REQ_CLUSTER_INFO / REQ_CLUSTER_FACILITIES / REQ_DEFINE_ZONE, REQ_SEARCH_CONNECTIONS / ' +
      'REQ_CONNECTION_REACHABILITY (supplier-search-read, #1153) and REQ_RESEARCH_INVENTORY / REQ_RESEARCH_DETAILS ' +
      '(research-roundtrip, #1154); not driven by any flow yet: REQ_CREATE_COMPANY',
  },
  {
    // Before the fallbacks below. A shared rule: later area cards only APPEND flows here.
    test: /^src\/server\/ws-handlers\/map-handlers\.ts$|^src\/server\/session\/(context-status|world-events|zone-surface)-handler\.ts$/,
    flows: ['world-readers', 'building-details', 'zone-roundtrip'],
    why:
      'the map & world readers changed — context status, world event, surfaces, facility dimensions, camera (world-readers), ' +
      'the map load the inspector flow sends, and the zone paint round trip (zone-roundtrip)',
  },
  {
    // Before the fallbacks below. src/shared/road-circuits.ts is deliberately not here: it is
    // connection-candidate reachability (NearCircuits), which road-roundtrip never sends.
    test: /^src\/server\/ws-handlers\/road-handlers\.ts$|^src\/server\/session\/road-handler\.ts$/,
    flows: ['road-roundtrip'],
    why: 'the road handlers changed — the flow that builds, breaks and wipes a road as the Mayor of the governed town',
  },
  {
    // Before the fallbacks below: the build menu, placement, rename and demolition (#1150).
    test: /^src\/server\/session\/building-(templates|management)-handler\.ts$|^src\/client\/handlers\/build-menu-handler\.ts$/,
    flows: ['build-menu-read', 'place-rename-demolish', 'upgrade-stop'],
    why:
      'the build menu, placement, rename, demolition and upgrade handlers — the flow that reads the build menu, the one ' +
      'that places, renames and demolishes a facility on a free Helartia lot, and the upgrade → stop round trip on ' +
      "SPO_test3's industry fixture (manageConstruction, #1154)",
  },
  {
    // Before the fallbacks below: the research inventory / details reads and the queue → cancel round trip (#1154).
    test: /^src\/server\/session\/research(-status)?-handler\.ts$/,
    flows: ['research-roundtrip'],
    why:
      "the research handlers — the flow that reads the research fixture's inventory and an invention's details, then " +
      'queues it and cancels it (#1154)',
  },
  {
    // Before the fallbacks below (#1148): chat-private-channel is GATE_ONLY — it broadcasts.
    test: /^src\/server\/session\/chat-handler\.ts$|^src\/server\/ws-handlers\/chat-handlers\.ts$|^src\/client\/store\/chat-store\.ts$/,
    flows: ['chat-read', 'chat-private-channel', 'chat-chase'],
    why: `the chat handlers and store — the channel list read, the password channel the flow creates and removes (send, typing, away), and the chase of ${SECONDARY_ACCOUNT.username}`,
  },
  {
    // After the pixel rule, which keeps the chat CSS.
    test: /^src\/client\/components\/chat\//,
    flows: ['chat-read', 'chat-private-channel', 'chat-chase'],
    needsL3: true,
    why: 'the chat strip and chase badge — the chat flows, plus a browser look',
  },
  {
    test: /^src\/shared\/rdo-|^src\/server\/rdo\.ts$/,
    flows: ['politics-read', 'politics-write', 'building-details'],
    why: 'wire-level change: frames or RDO members',
  },
  {
    test: /^src\/server\/session\//,
    flows: ['politics-read', 'politics-write', 'building-details'],
    fallback: true,
    why: 'session layer (fallback): session phases, cross-cutting helpers, or a handler still awaiting its own rule — see FALLBACK_ONLY',
  },
  {
    test: /^src\/shared\/types\/message-types\.ts$/,
    flows: ['politics-read', 'building-details', 'mail-roundtrip'],
    why: 'the client/gateway message contract changed',
  },
  {
    // Before the ws-handlers rule below: these three files implement session parking and
    // resume (#1045), which only session-resume drives live.
    test: /^src\/server\/server\.ts$|^src\/server\/spo_session\.ts$|^src\/server\/ws-handlers\/auth-handlers\.ts$/,
    flows: ['building-details', 'politics-read', 'session-resume', 'company-switch'],
    why: 'gateway session lifecycle changed — parking, resume and logout, and the company switch',
  },
  {
    test: /^src\/server\/ws-handlers\/|^src\/server\/server\.ts$/,
    flows: ['building-details', 'politics-read'],
    fallback: true,
    why: 'gateway request handling (fallback) — see FALLBACK_ONLY',
  },
  {
    test: /^src\/client\/components\/politics\//,
    flows: ['politics-read', 'politics-write', 'permission-negative', 'town-min-wage', 'publicity-roundtrip'],
    why: 'governance UI — including who is offered the controls',
  },
  {
    test: /^src\/client\/components\/building\/|^src\/shared\/building-details\//,
    flows: [
      'building-details', 'town-min-wage',
      'inspector-reads', 'store-price-salaries', 'industry-output-price', 'facility-open-close', 'industry-auto-buy',
      'trade-settings',
      'residential-settings', 'residential-repair', 'bank-settings', 'tv-settings', 'accept-cloning', 'research-roundtrip',
    ],
    why:
      "facility inspector and its template groups — TOWN_JOBS_GROUP's rdoCommands (the minimum-wage mapping) live in " +
      'template-groups.ts, the store and industry owner setters the panels send (#1152), the trade role and ' +
      'level (trade-settings.ts, #1153), and the residential, bank, TV, accept-cloning and research controls ' +
      '(ResearchPanel.tsx, HQ_INVENTIONS_GROUP) (#1154)',
  },
  {
    test: /^src\/client\/components\/mail\/|^src\/server\/mail/,
    flows: ['mail-roundtrip', 'zoning-alert-read', 'mail-drafts', 'mail-send-from-draft', 'mail-reply'],
    why: 'mail path',
  },
  {
    // Before the broad src/ rule below: the map surface's Town Hall button and the
    // shared metric it uses are exercised by this flow and by nothing else.
    test: /^src\/client\/components\/map\/MapSurface\.tsx$/,
    flows: ['nearest-town-hall'],
    needsL3: true,
    why: 'the nearest-town-hall jump — the one flow that drives it, plus a browser look at the map surface',
  },
  {
    test: /^src\/shared\/nearest-town\.ts$/,
    flows: ['nearest-town-hall'],
    why: 'the nearest-town-hall jump — the one flow that drives it',
  },
  {
    // Before the hud/ rule below: these three send the map & world readers' requests.
    test: /^src\/client\/components\/hud\/(ContextStatusStrip|WorldEventTicker|OverlayMenu)\.tsx$/,
    flows: ['world-readers'],
    needsL3: true,
    why: 'the context strip, world ticker and overlay menu — the flow that drives their requests, plus a browser look',
  },
  {
    test: /^src\/client\/handlers\/(context-status|world-event|map)-handler\.ts$/,
    flows: ['world-readers'],
    why: 'the client halves of the map & world readers — the flow that drives their requests',
  },
  {
    // Before the broad src/ rule below: the company list's switch into a Political Office.
    test: /^src\/client\/components\/login\/CompanyStage\.tsx$/,
    flows: ['company-switch'],
    why: 'the company list — the flow that drives its REQ_SWITCH_COMPANY',
  },
  {
    // Before the modals/ rule below: the company-creation dialog's cluster reads.
    test: /^src\/client\/components\/modals\/CompanyCreationModal\.tsx$/,
    flows: ['cluster-info-read'],
    needsL3: true,
    why: 'the company-creation dialog — the flow that drives its cluster reads, plus a browser look',
  },
  {
    // Before the broad src/ rule below: the sender of the switch and the cluster reads.
    test: /^src\/client\/handlers\/auth-handler\.ts$/,
    flows: ['company-switch', 'cluster-info-read'],
    why: 'the client auth handler — the flows that drive its company switch and cluster reads',
  },
  {
    // Before the broad src/ rule below: the rest of these component folders gets the same
    // flows that rule gives, plus a browser look.
    test: /^src\/client\/components\/hud\/|^src\/client\/components\/sheet\/|^src\/client\/components\/modals\/|^src\/client\/components\/map\//,
    flows: ['building-details'],
    needsL3: true,
    why: 'HUD, sheets, modals and map surface — the gateway contract, plus a browser look',
  },
  {
    test: /^src\/client\/|^src\/shared\/|^src\/server\//,
    flows: ['building-details'],
    fallback: true,
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
