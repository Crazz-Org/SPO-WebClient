# E2E Policy — The Pre-Push Gate

**Status:** Adopted 2026-08-21 · Supersedes the *layer decisions* in
[E2E-STRATEGY.md](E2E-STRATEGY.md) (its findings F1–F8 remain the reasoning trail)
**Procedure:** [E2E-TESTING.md](E2E-TESTING.md) — credentials, selectors, flow catalogue
**Companion:** [production-security-policy.md](production-security-policy.md)

This is the rule an automated session must satisfy before it may push. It is enforced by
`.claude/hooks/pre-push-gate.sh`, not by discipline: `git push` is blocked unless the
**bench worker** — the single process owning the live bench, see
[bench-worker.md](bench-worker.md) — has attested the current HEAD.

---

## 1. Why live, and why now

The mock-backend E2E layer planned in E2E-STRATEGY §2 (L2) was never built, and the reason
to build it has gone.

- A mock validates the client against *our model* of the Delphi server. Live validates it
  against the server. `OB-29` — *a tax write lands but the cached copy the client reads is
  never invalidated* — cannot be found by a mock **by construction**: the bug is precisely a
  divergence between the real cache behaviour and our model of it.
- The 2026-08-20 live WebSocket drive recorded in [civic-roles-reference.md](civic-roles-reference.md)
  produced `OB-28`, `OB-29` and `OB-31` in a single run.
- E2E-STRATEGY F2's justification for the mock investment was that the locked account could
  not exercise permission-gated features. `SPO_test3` now holds the **mayor** role, and a
  second account exists. That ceiling is gone.

The live layer also costs **zero new dependencies** — `ws` and `@types/ws` are already
production dependencies. `@playwright/test` was never installed.

**A crash is a failure, but silence is not a pass.** `OB-28` is *a write reported confirmed
when it was discarded*. The pass criterion for a mutation is the round-trip probe (§5), not
the absence of an exception.

---

## 2. The four layers

```
L0  Unit + component          Jest node/jsdom, coverage ratchet             CI: every PR
L1  Protocol conformance      Jest + rdo-mock + RdoStrictValidator          CI: every PR
L2  LIVE WS drive  ← the gate headless `ws` client -> gateway -> planitia   PRE-PUSH: every code change
L3  LIVE browser walkthrough  Playwright MCP, SPO_test3 / SPO_test      every screen once, pixels only, + pre-release
```

L2 replaces both the abandoned mock-E2E plan and most of the browser smoke. L3 survives only
for what a WebSocket cannot observe: rendering, layout, input, mobile. It is a **walkthrough**
that opens every screen and panel once, pixels only; every player action belongs to L2.

`src/mock-server/` is **not** a mock backend for L2 — it is the substrate of L1
(`rdo-mock`, `rdo-strict-validator`, `scenarios/`, `types/`, consumed by 19 suites under
`src/server/__tests__/`). It stays. Only its replay half was retired (§11).

---

## 3. The gate

The unit of enforcement is the **push**, not the commit.

1. Work on `feature/` `fix/` `refactor/` `doc/` — or the session's `claude-<user>/…`
   worktree branch. Never push `main` directly: the hook refuses it, and the ruleset takes
   PRs only.
2. **Commit freely** — no gate on commit. Each retry attempt is its own commit so the loop
   stays readable afterwards.
3. Before `git push`, run:

```bash
npm run gate
```

   It **prechecks locally** (`npm run typecheck`, `npm run lint`, then
   `npm run coverage:changed`, which runs the Jest suite **once** and measures the changed
   lines from that same run — free, parallelizable, consumes no bench slot), stamps a
   **precheck receipt** for the tree it just proved, then **queues a job on the bench
   worker** and waits (one background command, zero tokens). The worker, in the depositing
   worktree:

   | Stage | Check |
   |---|---|
   | Clean bench | nothing listens on 8080; fingerprint the tree — uncommitted changes -> `DIRTY`, nothing runs (the attestation names a sha, so the tree must be that commit) |
   | Build | `npm run build:server` in the worktree — the tested gateway IS this tree's code. Only the gateway: an L2 gate opens no browser, so the client bundle and the terrain-test are not built here (a `live` job adds `build:e2e`, a `lease` builds everything — [bench-worker.md §3](bench-worker.md)) |
   | Static | typecheck, lint, tests — **replayed here unless GitHub already recorded the `typecheck + tests` check as successful for this exact sha** (`src/e2e/bench/ci-proof.ts`), in which case the artifact records `CI` and the ~113 s of exclusive bench is not spent re-proving it. Fail closed: no run yet, still running, failed, cancelled, GitHub unreachable, or an unparseable answer → full replay. (This replaced the session-produced precheck receipt of #145: a gate can run before the PR exists, so only "this sha, right now" is safe to ask.) The attestation stays the worker's: it decides which receipt to look for, and CI replays all three independently on every PR |
   | Capabilities | President members / Capitol governance in the diff -> the live stage reads, from the server, whether the account holds the capability (§7): granted -> a flow must drive it (fail closed); refused -> recorded exception |
   | Routing | map the diff to the required L2 flows (§4) |
   | Live | pre-flight, acquire the (now machine-global) lock, run the flows against planitia, release |
   | Attest | `report/e2e/gate-<sha>.json` in the worktree + `~/.spo-bench/verdicts/<sha>.json` |

4. The hook reads the **attestation** at push time and blocks unless it exists for HEAD,
   its verdict is `PASS`, the tree fingerprint was stable across the run (a moved tree is
   `STALE`, never PASS), it names the pushing worktree, and it is younger than
   `GATE_MAX_AGE_MINUTES` (default 60). **Only the worker attests** — `npm run gate:local`
   is static-only and produces evidence for reading, not a push unblock.
5. CI re-runs L0/L1 on the PR — it cannot hold the locked credentials. The worker
   publishes the attestation as the `bench/gate` **commit status** once the sha reaches
   GitHub (automatic retry); branch protection requires it, so a PR cannot merge on CI
   alone. The detailed evidence rides in the PR body.

---

## 4. Routing — what the diff requires

The gate maps changed paths to required flows. A static script drifts and eventually tests
nothing that changed; the routing table is what keeps the run pointed at the delta.

| Diff touches | Required |
|---|---|
| `src/shared/rdo-*.ts`, `src/server/session/**`, `src/server/rdo.ts` | L1 + **L2 login spine + every flow touching the changed members** |
| `src/shared/types/message-types.ts`, `src/server/session/*-handler.ts` | L2 flows for the affected message types |
| `src/client/components/politics/**` | L2 `politics-read`, `politics-write`, `permission-negative`, `town-min-wage`, `publicity-roundtrip`, `mayor-rating-roundtrip` |
| `src/client/components/building/**`, `src/shared/building-details/**` | L2 `building-details`, `town-min-wage`, `inspector-reads`, `store-price-salaries`, `industry-output-price`, `facility-open-close`, `industry-auto-buy`, `trade-settings`, `residential-settings`, `residential-repair`, `bank-settings`, `tv-settings`, `accept-cloning`, `research-roundtrip`, `ad-budget-roundtrip` |
| `src/client/renderer/**`; the component folders `mobile`, `hud`, `sheet`, `modals`, `map`, `search`, `chat`, `building`, `politics`, `mail`, `empire`, `login`, `common`, `command-palette`, `startup`, `tutorial` under `src/client/components/`; `src/client/report/*.tsx`; `src/client/App.tsx`, `main.tsx`, `client.ts`; `src/client/ui/**`, `src/client/hooks/**`; `src/client/store/ui-store.ts`; `*.css` | **L3** browser smoke (a WS drive cannot see a pixel) — a printed note, nothing blocks on it |
| `package.json`, `package-lock.json` | L2 spine + `building-details` — the shipped code moved even though no `src/` file did |
| `src/e2e/flows.ts`, `src/e2e/{fixtures,research,probe,session,ws-driver,live-log}.ts` | L2 spine + every flow the diff changed, and the flows reaching a changed helper |
| `doc/**`, `*.md`, CI config, tooling | static only |

The **login spine** (connect -> auth -> directory -> world login -> company select ->
logoff) is appended to every L2 run regardless of routing. It is the cheapest possible
regression detector and it is where session-lifecycle breakage surfaces first.

Unmapped path -> the gate fails closed and asks for a routing entry. Silence is never a pass.

Five exemption sets in `src/e2e/routing.ts` record, with a cited reason each (`File.pas:Line`,
`file.asp:Line` or `#<issue>`), where a flow or a handler departs from that table;
`src/e2e/routing.test.ts` holds all five.

- **`NIGHTLY_ONLY`** lists the flows no routing rule requires — a data-gated flow (a required
  `UNPROVEN` fails the gate), a reading that asserts nothing, or the fixture builder
  `fixtures-ensure`, which builds only when a fixture is missing (§9). The nightly still runs
  them; every other flow must be reached by some tracked path. A diff that changes such a
  flow's own body does require it (below).
- **`GATE_ONLY`** lists the flows whose action posts a message every online player sees
  (`politics-write`, `Kernel/Population.pas:1264-1284`; `policy-roundtrip`,
  `Kernel/Kernel.pas:11790-11800`; `chat-private-channel`,
  `Interface Server/InterfaceServer.pas:4594`, `:3968-3980`; `bank-borrow-payoff`,
  `Kernel/Kernel.pas:8849-8859`; `facility-bank-loan`, `Kernel/Kernel.pas:8849-8859`). The nightly leaves them out and prints them as
  `gate-only, not driven`; the gate still runs them when their code changes.
- **`FALLBACK_ONLY`** lists the handler files only a broad fallback rule routes, each `awaiting
  card #<n>` or `excluded: <reason>`. An area card adds its rule before the fallbacks and removes
  its file from the set, so a new handler cannot land unrouted. The handler set is
  `src/server/session/*-handler.ts`, `src/server/ws-handlers/*-handlers.ts` and
  `src/client/handlers/*-handler.ts`.
- **`EXCLUDED`** lists the request types no gate-required flow sends (no flow yet, a
  nightly-only sender, or a request the gateway answers alone); it excuses that request in every
  handler file.
- **`NOT_ROUTED`** maps a handler file to the requests a gate flow does send but that file's rule
  leaves out (a rule pinned by an exact routing test).

The handler ratchet (#1187) derives the `WsMessageType` requests each handler file serves or
sends — server session handlers through `spo_session.ts` and the ws-handlers registry, ws-handlers
through the registry, client handlers from their text — and the requests each flow sends, and
requires that a flow the file's rule routes to sends each one, or that the request is listed in
`EXCLUDED`, `NOT_ROUTED` or (the whole file) `FALLBACK_ONLY`.

### Changed and declared flows

The routing table sends `src/e2e/` to no flow, so the gate adds two more sets to the routed
one and drives **routed ∪ changed ∪ declared** (`scripts/verify-gate.js`, stage 3):

- **Changed** — `src/e2e/bench/changed-flows.ts` reads the diff of the seven flow sources
  (`src/e2e/flows.ts`, `fixtures.ts`, `research.ts`, `probe.ts`, `session.ts`, `ws-driver.ts`,
  `live-log.ts`). A hunk inside a `FLOWS` entry requires that flow — an edited body, an added
  flow, a renamed flow under its new name — even when it is `NIGHTLY_ONLY`. A hunk inside a
  shared helper requires every flow that reaches the helper, directly or through another
  helper: the related flows, never a full nightly. A `NIGHTLY_ONLY` flow reached only through
  a helper is listed in the artifact (`routing.changedFlowsNotDriven`), not driven. A diff the
  mapping cannot pair with the `FLOWS` array fails the gate closed.
- **Declared** — `npm run gate -- --also-flows=a,b` adds the card's own flows to the routed
  set (a union).
- **Quarantined** — a `SERVER_QUARANTINE` flow (§7, "Server quarantine") is never required,
  whether a rule routes it, the diff changed it (even its own body) or `--also-flows` declares
  it. It is listed in the artifact's `routing.quarantined`, with a reason line. An explicit
  `--flows=` that names it still drives and judges it.

When either set is non-empty the spine is added too. All of them land in `routing.required`,
so a flow-only diff is no longer static-only: an undriven required flow is `BLOCKED`, and a
required flow that ends `UNPROVEN` fails (§7). `--flows=` still **replaces** the set, but it
is refused (`BLOCKED`) unless it names every required flow — a gate cannot attest `PASS`
having driven only the spine. No separate `test:live` run proves a card's flows: its own gate
does.

### Proof and regression flows — what a PR names

A pull request that changes shipped code carries two lines in its body:

```
Proof flows: mail-roundtrip, new:mail-delete-refresh
Regression flows: mail-drafts, mail-reply
```

- **Proof flows** — the flows whose assertions show the change working. A new feature is
  proven by a live flow; when no flow drives it yet, the PR writes one and names it
  `new:<flow>`.
- **Regression flows** — the few existing flows that drive the features next to the change,
  as the agents judge. Related flows, never a full nightly.
- `none — <reason>` replaces the list on either line for a change nothing on the wire or the
  screen can observe (docs, tests, build tooling).

The lines are required when the diff changes a file under `src/client/`, `src/server/` or
`src/shared/` — tests (`*.test.ts(x)`, `__tests__/`) and mocks (`__mocks__/`) aside. A PR
that changes none of those needs neither line. `scripts/check-pr-rules.js`, inside the
required `typecheck + tests` check, fails such a PR when a line is missing, when a named flow
— proof or regression alike — is not in `FLOWS` (`src/e2e/flows.ts`) at the head, or when a
`new:` flow is not added by the diff. The gate drives the named flows with
`npm run gate -- --also-flows=a,b` (above).

**The nightly is the global review.** It drives every flow over `main`
(`doc/bench-worker.md` §8); a card's gate drives only what the card touches and names. When
a full pass is wanted before the next scheduled one, the maintainer asks for it mid-day with
`npm run bench:nightly-request -- --reason="…"` — refused from inside a Claude Code session
(`doc/bench-worker.md` §5, exit 5).

---

## 5. The round-trip probe

Every mutation exercised live uses this shape, and nothing else counts as verification:

```
read original -> record the pending restore -> write test value
              -> poll the read-back until it shows the value (up to the spec's boundMs)
              -> assert the FIVEMODELSERVER/Survival log line (marker + the flow's match)
              -> restore original (always, even after a throw)
              -> poll the read-back until it shows the original
              -> clear the pending restore
```

`runRoundTrip` in `src/e2e/probe.ts` carries this shape for politics, profile, zone and building
mutations; `runProbe` is its building-property adapter. `road-roundtrip` drives the same shape
step by step, because a road's undo is two proven writes of its own — a break, then a wipe —
each shown by its Survival line and a `SegmentsInArea` read-back.

The one mutation left in place is the permanent fixture build (`fixtures-ensure`, §9), proven by
its line, its result code and the lot read-back.

**The line proves receipt; the read-back proves the change.** Most handlers log before their
owner check (e.g. `Kernel/Kernel.pas:4336` -> `:4337`), so a refused write prints its line.
A lag (`OB-29`) is polled out up to the spec's `boundMs`; a read-back that never shows the
value FAILs, as does a missing line. A member with a marker must carry a log part; a member
with none (e.g. `RDOPayOff`, `RDOSendMoney`) is proven by the read-back alone. The restore is
proven the same way: its read-back must reach the original, or the pending restore is kept.
When the restore write throws, the read-back is still polled: only a read-back that shows the
original clears the pending restore (a server that refused both writes left the world
unchanged), and the probe still FAILs.

The read-back is any authoritative channel, named in the spec with why it is authoritative —
an object-cache property re-read after its refresh, a live RDO `get`, a server-generated mail
read from the recipient's mailbox, or a direct HTTP re-fetch compared byte for byte. For
`C7b` (#1147): the money transfer is proven by the transfer notification in the receiver's
Inbox, the portrait upload by a direct re-fetch of the stored image compared byte for byte;
the cache server's `OK` reply alone proves nothing.

The markers (`LOG_MARKERS` in `src/e2e/live-log.ts`, the citation beside each entry). A
`Fac(<x>,<y>)` line is keyed by the text after the coordinates; the identifying fields —
town, `Fac(x,y)`, voter, circuit id, the value — go in each flow's `match`:

| Member | Line contains | Cited at |
|---|---|---|
| `RDOSetTaxValue` | `Setting Tax value: <town>, <TaxId>, <value>` | `Kernel/Population.pas:1250` |
| `RDOSetMinSalaryValue` (town hall) | `Setting Min Wage: <town>, <PopKind>, <value>` | `Kernel/Population.pas:1292` |
| `RDOSetPublicity` | `Setting town politics publicity:` | `Kernel/TownPolitics.pas:220` |
| `RDOSetRatingFrom` | `Setting town politics Tycoon rating:` | `Kernel/TownPolitics.pas:186` |
| `RDOVote` | `Voting: <voter> by <choice>` — `TPresidentialHall.RDOVote` logs the identical text (`Kernel/WorldPolitics.pas:1822`), so a vote's `match` carries the voter | `Kernel/TownPolitics.pas:395` |
| `RDOSetPrice` | `Service SetPrice: <index>, <value>` | `StdBlocks/ServiceBlock.pas:1578` |
| `RDOSetSalaries` | `Setting salaries: <hi>, <mid>, <lo>` | `Kernel/WorkCenterBlock.pas:582` |
| `RDOSetOutputPrice` | `Fac(<x>,<y>) Output price set:` | `Kernel/Kernel.pas:4332` |
| `RDOSetInputOverPrice` | `Fac(<x>,<y>) Input overprice set:` | `Kernel/Kernel.pas:4358` |
| `RDOSetInputMaxPrice` | `Fac(<x>,<y>) Input max price set:` | `Kernel/Kernel.pas:4390` |
| `RDOSetInputMinK` | `Fac(<x>,<y>) Input min K set:` | `Kernel/Kernel.pas:4416` |
| `RDOSetInputSortMode` | `Changing Sort Mode..` | `Kernel/Kernel.pas:4442` |
| `RDOSetInputFluidPerc` | `Fac(<x>,<y>) Setting Input fluid perc:` | `Kernel/Kernel.pas:7154` (log `:7156`) |
| `RDOConnectInput` / `RDOConnectOutput` | `Fac(<x>,<y>) Input connected:` / `Output connected:` | `Kernel/Kernel.pas:4304` / `:4311` |
| `RDODisconnectInput` / `RDODisconnectOutput` | `Fac(<x>,<y>) Input disconnect:` / `Output disconnect:` | `Kernel/Kernel.pas:4320` / `:4327` |
| `RDOConnectToTycoon` | `Fac(<x>,<y>) Connect to Tycoon:` | `Kernel/Kernel.pas:4521` |
| `RDOSetCompanyInputDemand` | `Fac(<x>,<y>) SetCompanyInputDemand` | `Kernel/Kernel.pas:6371` |
| `RDOSetTradeLevel` | `Fac(<x>,<y>) SetTradeLevel` | `Kernel/Kernel.pas:6395` (in `TBlock.SetTradeLevel`, called by `RDOSetTradeLevel` `:6408` after its owner check) |
| `Stopped` (property `set`, `TFacility.SetStopped`) | `Stopping Facility.` — no coordinates, so the read-back attributes it | `Kernel/Kernel.pas:3948` (log `:3950`) |
| `RDOStartUpgrades` / `RDOStopUpgrade` | `Facility Start Upgrade count:` / `Facility Stop Upgrade..` | `Kernel/Kernel.pas:4668` (inside its `CheckOpAuthenticity` guard) / `:4685` |
| `RDOQueueResearch` / `RDOCancelResearch` | `Queue Research:` / `Cancel Research:` | `Kernel/ResearchCenter.pas:382` / `:394` |
| `RdoRepair` | `Repairing: <facility name>` | `Kernel/PopulatedBlock.pas:771` |
| `RDONewFacility` | `New Facility: <class> Company: <id> x: <x> y: <y>` | `Kernel/World.pas:3560` (log `:3565`) |
| `RDODelFacility` | `Del Facility, x: <x> y: <y>` | `Kernel/World.pas:3571` |
| `RDOCreateCircuitSeg` | `CreateCircuitSeg: <CircuitId>, <TycoonId>, <x1>, <y1>, <x2>, <y2>` | `Kernel/World.pas:4252` (log `:4263`) |
| `RDOBreakCircuitAt` | `BreakCircuit: <CircuitId>, <TycoonId>, <x>, <y>` | `Kernel/World.pas:4311` (log `:4320`) |
| `RDOWipeCircuit` | `WipingCircuit: <CircuitId>, <TycoonId>, <x1>, <y1>, <x2>, <y2>` | `Kernel/World.pas:4356` (log `:4366`) |
| `RDODefineZone` | `Defining Zone: <ZoneId>, <TycoonId>, <x1>, <y1>, <x2>, <y2>` | `Kernel/World.pas:4502` (log `:4526`) |
| `RDOAskLoan` | `AskLoan: <tycoon>, $<amount>` | `Kernel/Kernel.pas:11451` |
| `RDOSetPolicyStatus` | `Setting policy status: <tycoon>, <to>, <status>` | `Kernel/Kernel.pas:11772` |
| `TBankBlock.RDOAskLoan` | `Fac(<x>,<y>) AskLoan` — no tycoon, no amount; its own key, since `RDOAskLoan` is the tycoon form above, and its `match` is `facLineMatches` so neither `AskLoan:` nor `Error in AskLoan` satisfies it | `StdBlocks/Banks.pas:160` (log `:162`) |
| `CloneFacility` | `CloneFacility: <TycoonId>` — the clone is only queued (`:4815`) | `Kernel/World.pas:4794` (log `:4801`) |
| `CacheTown` (not a write, no flow's proof) | `Caching Town..` | `Kernel/PoliticsCache.pas:139` |

- The three circuit lines log the gateway's tycoon **object reference**, not the tycoon id
  (`TTycoon(TycoonId)`, `Kernel/World.pas:4270`), which no WS message exposes — their `match`
  uses the circuit id and the coordinates. `CreateCircuitSeg: OK!` (`Kernel/World.pas:4307`)
  is logged unconditionally and is never a proof.
- `TPresidentialHall.RDOSetMinSalaryValue` logs `Setting Ministry Salary.` instead
  (`Kernel/WorldPolitics.pas:1772`), so the town marker can never be satisfied by the Capitol
  variant. `RDOPayOff` (`Kernel/Kernel.pas:11555`) logs nothing, and `RDOSendMoney` logs to a
  `Money` log (`Kernel/Kernel.pas:11491`) the public listing does not carry — both are proven
  by the read-back alone.

### The live server logs — http://158.69.153.134/logs/

An open IIS directory listing, no auth — this is how a live run is proved rather than assumed.
**Reading a log is not probing the server.** It is also not a substitute for the Pascal: a log
proves what *happened*, the declaring unit under `Kernel/` (or `DServer/`, `Voyager/`) in
SPO-Original defines a member's kind and arity. Download and grep; the Survival log runs 2–3
MB/day, too big for context.

| Path | Carries |
|------|---------|
| `FIVEMODELSERVER/Survival <YY-MM-DD>.log` | **the one that matters** — RDO members log on entry, *before* their `try`, so a line here proves receipt; the change is proven by the read-back (`Setting Tax value: …`, `Setting Min Wage: …`, `Caching Town..`) |
| `FIVEMODELSERVER/TimeWarp <date>.log` | a periodic world snapshot — who holds each ministry, per-town vacancies and average salaries. Small (~20 KB), good for checking model state without replaying a session |
| `FIVEINTERFACESERVER/Survival <date>.log` | `LOGON ATTEMPT: User=<name>` / `Start Disconnecting <name>` — which identity (human vs role company) was active at a given second |
| `FIVECACHESERVER/`, `FIVEMAILSERVER/` | near-empty, rarely useful |

---

## 6. Safety rails

An autonomous loop mutating a production game world needs two rails a human run does not.

- **World-dirty lock.** If a run aborts before restore, `~/.spo-bench/world/world-lock.json`
  is left behind with the pending restores — one file for the whole machine, visible from
  every worktree. **All further live runs are blocked** until a human clears it
  (`npm run e2e:unlock`). Attempt 2 never starts on a world attempt 1 left mutated. This
  holds even when the aborting run never got to call `release()` — a hard crash (SIGKILL,
  OOM, host reboot) with writes still owed. `acquire()` treats any pending restores it finds
  on a takeover as proof the previous holder left the world dirty, and marks it dirty itself
  before refusing, whether or not that holder's process is still alive. (Before 2026-09-03,
  B5.5: `acquire()` taking over a dead holder silently dropped its pending restores and never
  marked the lock dirty, so this guarantee held only for a clean unwind — a hard crash left
  `Helartia` mutated with nothing to block the next run or tell a human to look. Fixed; a
  takeover now always preserves or flags what was owed.) Each pending restore carries a
  unique `key` and a `what` that names the literal undo a human can perform (the town or
  facility, the id or rating, the original value); `npm run e2e:unlock` prints both. A binary
  original is stored base64 in `originalValue`, so an interrupted run's restore uses the
  saved bytes.
- **Single-flight.** Mechanical since 2026-08-22: the bench worker executes one job at a
  time ([bench-worker.md](bench-worker.md)). The lock file remains as the world-dirty
  carrier and as a belt-and-braces refusal for `gate:local` runs.
- **Bench ownership.** The gateway port, the LOCKED accounts and the world belong to the
  bench worker — sessions deposit jobs instead of starting gateways. Driving a browser
  needs a **lease** (`npm run dev`); `npm run dev:local`, which picks a port off the bench, is
  the conscious exception, for debugging, and attests nothing. `.claude/hooks/bench-port-guard.sh`
  refuses anything else that would take the bench port or drive the live world outside the worker.
  Procedure: [E2E-TESTING.md](E2E-TESTING.md) § Server Lifecycle.

**Pre-flight** before any flow: gateway reachable, world date advancing (server alive), no
stale session for the account. A failed pre-flight is an **environment abort** — it does not
consume one of the three attempts (§8).

**Rate limit — removed, not tuned (2026-09-03, B3.5).** The e2e layer used to carry its
own live-run limiter (`checkRateLimit` in `src/e2e/world-lock.ts`: a minimum interval
between runs, a daily cap). It has been deleted. Its config defaults — interval 0, cap
1000 — had stood since 2026-08-22, so the guard could never fire in production, and the
threat it was written against, a retry loop becoming a login storm, is not `planitia`'s
threat model: this is an MMO world built for many concurrent players. What actually
serializes live traffic is the bench worker's single-flight queue above, which is bench
policy — one owner, one job at a time — not a protection the world needs. Gateway-side
rate limits (auth attempts, `/proxy-image`, concurrent WS connections per IP —
[bench-worker.md](bench-worker.md) §6) are a separate mechanism, keyed by IP rather than
by run, and are unaffected by this removal; they stand at the production values (SEC-H-4,
SEC-W-3, `doc/production-security-policy.md`); the bench gateway skips them through
`SINGLE_USER_MODE`.

**GM broadcast — contained to the bench gateway (2026-09-30, #1197).** The bench gateway is
started with `SPO_GM_USERS=SPO_test3` (set in the gateway launch env in `runJob`,
`src/e2e/bench/worker.ts` — gateway only, the drive's own process never sees it). A GM
message (`handleGmChatSend`) makes no RDO or game-server call and is sent only to the
clients connected to that same gateway process — on the bench, only the drive's own
sessions — so a live `/gm` drive reaches no player and mutates nothing in the world.
Production gateways are untouched: their `SPO_GM_USERS` comes from their own deployment env.
The flow `gm-broadcast` (#1199) drives this live — at the gate whenever the chat handlers
change, and in the nightly: it proves delivery to the secondary account on channel `GM`, and
the two refusals, a non-GM sender and a session not yet in the world.

---

## 7. Capability exceptions — what the account cannot do

A change can only be driven live if the test account is **authorised to perform it on the
server**. That is a property of the account, read from the server — never of the UI. The
distinction is the whole point:

| What the gate sees | What it is | What happens |
|---|---|---|
| a control missing, a request refused by the gateway, a wrong frame | a **bug** | `FAIL` — diagnose, fix, iterate (§8) |
| the server says the account does not hold the role the member needs | a **capability exception** | recorded with its evidence; the gate continues |
| the flow ran and nothing failed, but the world held no data to exercise it on (`UNPROVEN`) | an **unproven flow** | required by routing → `FAIL`; run only because `--flows` named it → recorded, informational |
| the flow needs the optional second account, which was refused at login before the flow's first write (`SKIPPED`) | a **skipped flow** | never a gate `PASS` — `runLive` returns `BLOCKED`, and so does an explicit `--flows`; the no-`--flows` nightly records it and reports `PASS` with the skip listed. A skip after a write is `FAIL` |

The six `TPresidentialHall` members ([civic-roles-reference.md:101-106](civic-roles-reference.md))
— `RDOSetMinSalaryValue` · `RDOSetTownTaxes` · `RDOSitMayor` · `RDOSitMinister` ·
`RDOBanMinister` · `RDOSetMinistryBudget` — need the **president** capability. When the diff
touches one, the live stage reads two server facts for `SPO_test3` (`src/e2e/capability.ts`):
`IsPresident` from the tycoon cache (`Tycoons\<name>.five\`, written by `StoreRoleInfoToCache`)
and `canGovern` on the Capitol itself — the server's own `grantAccess` decision on the
presidential hall. `granted` follows `canGovern`; the cache flag rides along as evidence.
`RDOSetMinSalaryValue` stays in that list for its Capitol variant (`Kernel/WorldPolitics.pas:265`);
its town variant (`Kernel/Population.pas:167`) is driven by `town-min-wage`, so a gate that routes
it drives the town hall and still records the Capitol variant as a capability exception.

- **Granted** → the members *can* be driven, so they *must* be: the gate **fails closed**
  until a flow exercises the changed member (`src/e2e/flows.ts`) and the routing table
  sends the diff there. Silence is never a pass.
- **Refused** → a `CAPABILITY EXCEPTION` is written to the artifact (members, account, the
  checks and their values, the time) and summarised in the `bench/gate` status and the PR.
  The gate goes on to its verdict. The catalogue (kind + arity, `src/shared/rdo-members.ts`)
  remains the guard for those frames — `RDOSitMinister` has two variants a name+arity
  catalogue cannot tell apart (`civic-roles-reference.md:112-115`), which is why the
  exception is listed loudly rather than silently.
- **Undetermined** (the server did not answer) → `FAIL`: a capability is read, never assumed.

There is **no human override**: nothing a session or a developer types turns an exception
into a verification. The only way to verify these members is an account that holds the
capability — and then the gate demands the flow.

### Unproven flows — what the world cannot show

**A required flow that ends UNPROVEN fails the gate.**

- Missing data is not a capability exception. The account *can* act; the world holds
  nothing to act on, so the change was never seen working.
- The remedy is the flow's seed step (#1009), which creates the data before the flow runs.
  It is never an override, and never a `PASS` for a flow that exercised nothing.
- A flow whose data cannot be seeded is either kept failing or taken out of the routed set
  by a routing change (`src/e2e/routing.ts`), and that choice is the maintainer's.
- A flow that is not required — run only because `--flows=` named it beyond the required
  set (for example the probes of #1004 and #1006) — may end UNPROVEN as information. A flow
  the diff changed or a card declared (§4, "Changed and declared flows") is required. **A card
  that makes such a flow required must seed its data first.**

`verify-gate.js` records every UNPROVEN flow in the artifact's top-level `unproven` list
(`{ flow, required, reasons }`, §10) — outside `exclusions`, because a required entry is a
failure, not an exclusion — and the `bench/gate` status shows the count as
`— N unproven flow(s)`.

### Server quarantine — a live-server fault, never a code defect

A flow the **live server** keeps from passing — a fault the client cannot fix — can be put in
`SERVER_QUARANTINE` (`src/e2e/routing.ts`). It is a temporary maintainer decision, and never
for a code defect, nor for a flake (§8 handles a flake). Every entry carries a `reason`, a
`link` (`https://`) to where the fault is recorded, a `lift` condition and the date it was
`added` (`YYYY-MM-DD`); `src/e2e/routing.test.ts` refuses an entry missing any of them. The
entry is deleted the day its lift condition holds, and the entry is the only thing that
changes: `ROUTES`, `NIGHTLY_ONLY` and `EXCLUDED` keep describing a healthy server, and the
quarantine is applied on top of them.

- A quarantined flow still runs in the nightly, and its real outcome is recorded: its result
  keeps its status and gains a `quarantined` mark (`reason`, `link`, `lift`).
- No gate requires it, whatever names it — a routing rule, a changed flow body or helper, or
  `--also-flows` (§4). An explicit `--flows=` still drives and judges it, which is how its lift
  condition is checked.
- A nightly whose only FAILs are quarantined flows is `PASS`. **A dirty world still FAILs the
  run**, whatever flow left it dirty, as does any FAIL of a flow outside the quarantine.
- The list is printed as `Server quarantine (N):` on every run, gate or nightly, passing or
  not — each entry's flow, reason, link, lift condition, date added and its outcome in this
  run — and `latest.json` names the quarantined flows the nightly drove under `quarantined`
  (`doc/bench-worker.md` §8).

| Flow | Reason | Link | Lift when | Added |
|---|---|---|---|---|
| `portrait-roundtrip` | The picture server cannot store an upload since the 2026-10-02 planitia maintenance (`SERVER_ERROR The picture server could not store the picture (ERROR after the transfer)`). | [#1310](https://github.com/Crazz-Org/SPO-WebClient/issues/1310) | `npm run test:live -- --flows=portrait-roundtrip` PASSes on the bench | 2026-10-04 |
| `newspaper-board-read` | Every post to the Helartia Herald (`boardmsg.asp?action=post`) answers HTTP 500 since the 2026-10-02 planitia maintenance, so no column can be seeded. | [#1260 comment](https://github.com/Crazz-Org/SPO-WebClient/issues/1260#issuecomment-5973821564) | a post to the Helartia Herald succeeds, so #1260's seed can land | 2026-10-04 |

### Parked flows — never built, by maintainer decision

A flow no account can ever exercise is not kept failing: it is not written at all, and its
handler stays in `FALLBACK_ONLY` (`src/e2e/routing.ts`). It comes back only when the reason
below stops holding.

| Flow | Why no live drive is possible | Covered by | Revisit when |
|---|---|---|---|
| `tutorial-read` (read the tutorial assignment, next/back) | No E2E account holds a tutorial, and none can be given one. The server builds a tutorial only when a tycoon is **created** on a world whose `Tutorial` setting is `enabled` (default `disabled`, `Kernel/Kernel.pas:10907-10908`), and skips it if the tycoon holds a role, has 10+ nobility points, or carries the `tutorial` cookie (`Kernel/Kernel.pas:12959`). It is deleted for good, cookie `tutorial=done`, once the tycoon's level tier passes 0 (`Kernel/Kernel.pas:12206-12214`). An account reset (`Kernel/World.pas:6203`, `:6368`) only rebuilds a tutorial that still exists (`Kernel/Kernel.pas:12924-12939`), and "Get New Assignment" only steps an existing one (`NewTycoon/Tasks/ModifyTask.asp:25-34`). SPO_test3 is Mayor and has none; the secondary accounts show none either. | the mock-server suite, `src/mock-server/scenarios/tutorial-scenario.ts` | a brand-new account is created on a world with `Tutorial` enabled |

Not project-critical (maintainer, 2026-10-01 — [#1199](https://github.com/Crazz-Org/SPO-WebClient/issues/1199#issuecomment-5937034602)).

---

## 8. The failure loop

Gate fails -> write a hypothesis -> fix -> re-run. **Maximum three attempts**, and each
attempt must name a root cause **different** from the previous one. Repeating a hypothesis
ends the loop immediately.

Not every red run consumes an attempt:

| Class | Consumes an attempt? | Action |
|---|---|---|
| **My change is wrong** | Yes | Diagnose, fix, re-run |
| **Environment** (server down, maintenance, network, pre-flight fail) | No | Backoff + retry; after 2, abort as `blocked: environment` |
| **Flake** (passes on re-run, no code change) | No | Record; 2 flakes on one flow -> quarantine + backlog entry |
| **The criterion was wrong** | — | **Stop and ask.** Never launder a bad requirement into a code change |

The last row is `CLAUDE.md`'s existing rule ("never modify a test to make it pass") applied
to the loop. **Not yet machine-enforced** — `verify-gate.js` records `--attempt` in the
artifact but does not compare attempts; the rule "attempt *N* must not touch a test file
that was failing at attempt *N-1*" is a review convention until a gate stage carries the
previous attempt's failing set. Mechanical today: the worker's fingerprint (`STALE`), the
clean-tree rule (`DIRTY`), the President exclusion (`BLOCKED`) and the hook.

**On exhaustion:** push the branch, open a **draft** PR titled `blocked: …`, attach the
evidence and all three hypotheses, do not merge, hand back. Work is never discarded.

Structured output, not a chat message: the report is posted as a comment on the task's
issue ([kanban-workflow.md](kanban-workflow.md)) with the three hypotheses, what each
predicted, and what actually happened. That is the input that makes the next session start
ahead of zero.

---

## 9. Accounts

| Account | Password | Holds | Used for |
|---|---|---|---|
| `SPO_test3` | `test3` | Mayor of **Helartia**, Minister of Agriculture, company *SPO_test3 - Green* | Primary. Governance reads and writes, roads, zones |
| `SPO_test` | `test` | dedicated basic test account, no special buildings (maintainer, 2026-10-01) | Permission-negative, mail receive, mail reply, rating another tycoon's term. **Optional:** a flow logs it in with `loginSecondary()` **before its first write**; a typed login refusal (a named directory refusal, or a bad user name / password at world login) skips the flow — `SKIPPED`, recorded, not failed (§7). It **writes only to complete a pair the test undoes:** it receives the `mail-roundtrip` test mail, and sends one seed `Zoning Alert!` to SPO_test3 per `zoning-alert-read` run, deleted from SPO_test3's Inbox and from SPO_test's `Sent` in the same run. It receives the `mail-send-from-draft` mail, and in `mail-reply` receives SPO_test3's marker mail and sends one reply back — every copy (both Inboxes, both `Sent`) deleted in the same run. In `mayor-rating-roundtrip` it rates SPO_test3's term at Helartia `0`, then back to the flow's baseline `100` (maintainer, 2026-09-29): its opinion cannot be read back, so the first run leaves it at `100` for good — a test account's opinion of a test account. |

Both are **LOCKED** — never changed without explicit developer approval. Zone **Free Space**,
world **planitia**.

Two accounts unlock four things that were structurally impossible:

| Now testable | Why it matters |
|---|---|
| **Negative permission** — drive `SPO_test` at the Town Hall, assert `canGovern=false` and that the control is *absent*, not merely disabled | Catches the `tycoonratings.asp:24-25` failure mode (guard commented out, result hardcoded `true`) in our own client |
| **Mail send -> receive** | Genuinely end-to-end for the first time; send was previously untestable |
| **Ratings** | `OB-30`: nobody can rate their own term. `SPO_test` rating `SPO_test3` is a real path |
| **Roads / zones** | Mayor role removes these from the "structurally untestable" list |

**Blast radius.** All mutations happen on `SPO_test3`'s own town (Helartia). The second
account takes part through mail, one rating and one loan: `mail-roundtrip` sends it one message and deletes it
in the same run, and the `zoning-alert-read` seed has it send SPO_test3 one look-alike
`Zoning Alert!`, deleted from SPO_test3's Inbox and from SPO_test's `Sent` in the same run.
`mail-send-from-draft` sends it one message, and in `mail-reply` it sends SPO_test3 one
reply; each flow sweeps and deletes every copy it created in the same run. In
`mayor-rating-roundtrip` it rates SPO_test3's term at Helartia `0`, then `100` again — the
flow's fixed baseline; the aggregate `TycoonsRating` is the read-back, and a run where it does
not move ends `UNPROVEN` (`Kernel/Politics.pas:374-392`).
No flow reads or writes its buildings (`flows.ts`: it appears at the login in
`permission-negative`, which does not mutate, as the mail recipient, as the reply sender, as the seed sender, and as the rater).
`facility-bank-loan` (#1189, lifted by the maintainer on 2026-09-29) has SPO_test borrow $1 at
SPO_test3's own bank fixture and pay it off in the same run.
Never another player's assets. Never a world-scope value. Every mutation is restored in
the same run (§5).

**Permanent fixtures — the one exception.** Sanctioned by the maintainer on 2026-09-29, the
nightly-only flow `fixtures-ensure` (#1149, `src/e2e/fixtures.ts`) keeps one facility of each
kind the owner-setter flows need — `industry`, `store`, `warehouse`, `residential`, `research`,
`bank`, `tv` — owned by *SPO_test3 - Green* in Helartia. It builds a kind only when it is
missing, once, and keeps it. Fixtures are found **by kind at run time** (`findFixture`: the
directory's tycoon branch, then the lot's owner and the inspector's template groups), never by
coordinates committed to the tree — the world moves. A build is proven by its `New Facility:`
line, result code 0 and the lot read-back. While SPO_test3 owns a construction site in Helartia,
the flow places nothing: a site cannot be tied to a kind. A mausoleum is never a fixture
(placing one flags its owner to transcend, which resets the tycoon, `Kernel/Kernel.pas:10127-10128`),
and neither is a studio. The seven fixtures occupy seven of SPO_test3's facility slots for good.
**Research queued by the fixture builder is permanent setup data too** (maintainer, 2026-10-01,
#1233). The bank and TV classes stay locked until *SPO_test3 - Green* owns the invention that
unlocks them (`RESEARCH_UNLOCKS`); the builder then queues one research step per run at
SPO_test3's research fixture: the first missing link of the chain that reads enabled and fits
under cash − the cash floor − `research-roundtrip`'s own cost. It is proven by its
`Queue Research:` line and an inventory read-back. It never sends `RDOCancelResearch` (on an
owned invention that sells it, `Kernel/ResearchCenter.pas:372`), never queues
`research-roundtrip`'s target, and records no pending restore, so no restore or unlock step can
cancel it.

**Build → demolish (#1150).** `place-rename-demolish` places the cheapest buildable facility —
never a mausoleum, never the Capitol (`isRefusedClass`) — on a free Helartia lot as
*SPO_test3 - Green*, renames it to a marker and back, and demolishes it in the same run. Its
pending restore (the lot, the class, the company id and the literal undo) is recorded **before**
`NewFacility` is sent, and cleared only after the `Del Facility` line and an empty lot on
`REQ_MAP_LOAD`. The cleanup demolishes only a lot holding the placed class (or its construction
state) whose owner tycoon id is SPO_test3's — never the Mayor role's, never another player's;
anything else is left in place, the flow FAILs and the lock goes dirty (§6). The construction
cost is spent each run — accepted by the maintainer on 2026-09-29.

**Supplier and client links (#1153).** A link is written on **both** gates (`TGate.ConnectTo`,
`Kernel/Kernel.pas:6784-6785`), so a hire is another player's asset the moment the counterpart
is theirs. `supplier-hire-fire`, `client-hire-remove` and `connect-on-map` link the industry
fixture only to a facility of *SPO_test3 - Green* in Helartia (search filtered by town and
company, the row's company checked, the lot's owner read back), snapshot every gate they can
touch, and undo every new link in the same run. `quick-trade-roundtrip` runs only when its undo
cannot reach beyond the test: no SPO_test3 facility already a client of the fixture
(`Kernel/Kernel.pas:4593-4600`), the fixture not an initial supplier (`:4564-4565`,
`:4606-4607`), and no SPO_test3 warehouse outside Helartia (`:4537-4553`) — otherwise `UNPROVEN`,
nothing sent.

**Clone facility (#1189).** Clone facility is driven only as `clone-salaries-roundtrip` (lifted
by the maintainer on 2026-09-29, limited to salaries): options same town + same company +
salaries (`0x103`, `Kernel/CloneOptions.pas:7-13`). `TWorld.CloneFacility` writes every facility
of the source's kind in that scope (`Kernel/World.pas:3494`), so the flow snapshots the salaries
of every SPO_test3 work center in Helartia, and each same-class target's `AcceptCloning`, before
it sends anything. A target that refuses cloning (`Kernel/Kernel.pas:5101-5104`) must read back
unchanged. Every facility is restored in the same run. An unreadable target, or no accepting
target, is `UNPROVEN` with nothing sent.

**Excluded members (#1195).** `industry-supply-limits` drives the max price and the min K only.
`RDOSetInputSortMode` is never driven: only `TMediaInput` caches `QPSorted` / `SortMode`
(`Kernel/MediaGates.pas:388-389`), its sole user is the movie theatre's Films input
(`StdBlocks/Movie.pas:84`), a plain input's `SetSortMode` is empty (`Kernel/Kernel.pas:7169-7171`),
and no fixture kind is a movie theatre. `RDOSetInputOverPrice` is never driven: it is set per
supplier row, overpaying another player's supplier touches that player's income, and an own row
exists only after `supplier-hire-fire` (#1153), itself nightly-only and data-gated.

**Ad budget (#1195).** `ad-budget-roundtrip` drives `RDOSetInputFluidPerc` on the Advertisement
input of the `research` fixture — the general headquarters declares it
(`Kernel/Headquarters.pas:130-143`); a store takes advertisement as a company input, with no gate
to address (`StdBlocks/ServiceBlock.pas:540`). The write binds to the input's own ObjectId, as
Voyager does (`Voyager/AdvSheetForm.pas:456-457`), and reads back as
`min(100, round(100*nfActualMaxFluidValue/nfCapacity))` (`:651-660`). That read-back can never
show the write: Advertisement is a company fluid (`StdBlocks/StdFluids.pas:499`), so the input joins
its company's `TCompanyInput` (`Kernel/Kernel.pas:5232-5233`), whose `Spread` runs every company
cycle (`:10160`) and overwrites `ActualMaxFluid` from the demand slices (`:10003-10008`). **The one
log-proven round trip (maintainer decision 2026-10-01, #1195 option c):** the write PASSes on its
own `Setting Input fluid perc` Survival line at the fixture's coordinates, and the restore — the
percentage read before the write, put back — is proven by its own line. A missing write line
FAILs; a missing restore line FAILs and keeps the pending restore. Every other round trip still
needs its read-back.

---

## 10. Artifact format

`report/e2e/gate-<sha>.json` — gitignored, per-machine, summarised into the PR body:

```jsonc
{
  "head": "<sha>", "branch": "fix/…", "verdict": "PASS|FAIL|BLOCKED",
  "createdAt": "2026-08-21T09:12:44.101Z",
  "static": { "typecheck": "PASS", "lint": "PASS", "test": "PASS" },
  "routing": { "changed": ["src/…"],
               "required": ["login-spine", "politics-write", "zoning-alert-read"],
               // §4, "Changed and declared flows" — all three are also in `required`,
               // except the NIGHTLY_ONLY flows a changed helper reaches, listed only.
               "changedFlows": ["zoning-alert-read"],
               "changedFlowsNotDriven": ["newspaper-read"],
               "declared": ["politics-write"],
               // §7, "Server quarantine" — changed or declared, never in `required`.
               "quarantined": ["portrait-roundtrip"] },
  "live": {
    "world": "planitia", "account": "SPO_test3",
    "window": { "from": "…Z", "to": "…Z" },
    "flows": [{ "name": "politics-write", "status": "PASS",
                "probes": [{ "member": "RDOSetTaxValue", "logLine": "Setting Tax value: 12",
                             "restored": true, "readBack": "CONFIRMED",
                             "restoreReadBack": "CONFIRMED" }] },
              { "name": "zoning-alert-read", "status": "UNPROVEN",
                "unproven": ["the flow's data — seed failed: …"] }]
  },
  "exclusions": { "presidentMembersTouched": ["RDOSitMayor"],
                  "capability": [{ "capability": "president", "members": ["RDOSitMayor"],
                                   "account": "SPO_test3",
                                   "checks": [{ "what": "canGovern on the Capitol (server grantAccess)", "value": "false" }],
                                   "checkedAt": "…Z" }] },
  // Outside `exclusions`: a required entry is a failure (§7, "Unproven flows").
  "unproven": [{ "flow": "zoning-alert-read", "required": true,
                 "reasons": ["the flow's data — seed failed: …"] }],
  "attempt": 1
}
```

---

## 11. What was retired

`src/mock-server/`'s replay half — `capture-store.ts`, `replay-engine.ts`,
`mock-ws-client.ts`, `index.ts`, `test-helpers.ts` and the three
`__tests__/integration/` suites — had **zero consumers** outside its own directory and
existed to serve the L2 mock backend that this policy deletes. `MockWebSocketClient` never
opened a socket; it was pure in-memory replay, so it could not be retargeted at the live
gateway.

The L1 half — `rdo-mock.ts`, `rdo-strict-validator.ts`, `http-mock.ts`, `types/`,
`scenarios/` — is load-bearing and untouched.

---

## 12. Commands

```bash
npm run gate                     # local precheck -> bench job: build, static, routing, live, attest
npm run gate -- --static-only    # skip the live layer (docs/tooling diffs)
npm run gate -- --also-flows=a,b   # add flows to the routed set (a card's own flows)
npm run gate -- --flows=login-spine,politics-write   # replaces the set; refused unless it covers every required flow
npm run test:live                # the L2 drive as a bench job
npm run dev                      # bench LEASE: this worktree's gateway held on 8080 for you
npm run dev:release              # ...and give it back as soon as you are done
npm run bench:status             # worker liveness + queue
npm run e2e:unlock               # clear a world-dirty lock after a human restore
npm run finish                   # after the merge: main ff'd, refs pruned, worker reinstalled if needed, worktree + branch gone
npm run deps:gate [PR...]        # Dependabot PRs: merge main in, npm ci in the PR's worktree, gate, push, auto-merge — one at a time

npm run gate:local               # verify-gate directly, static-only — evidence for reading, no push unblock
npm run dev:local                # a debug gateway of your own, off the bench — attests nothing
```
