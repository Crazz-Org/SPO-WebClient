# E2E & System Test Strategy — Audit and Target Architecture

> ## ⚠ SUPERSEDED (2026-08-21) — read [E2E-POLICY.md](E2E-POLICY.md) for the current rules
>
> The **findings below (F1–F8) still stand** and are the reasoning trail for what replaced
> this document. The **decisions** do not:
>
> | This document decided | Now |
> |---|---|
> | L2 = system E2E against a **mock backend**, the core investment | **Never built, and cancelled.** A mock validates the client against our *model* of the Delphi server; `OB-29` — a tax write that lands while the cached copy the client reads is never invalidated — cannot be found that way by construction |
> | Live server is **smoke-only**, manual, pre-release | **Live is the gate.** Every code change is verified over a real socket against planitia before it may be pushed |
> | `@playwright/test` specs are the regression layer | The regression layer is a **headless WebSocket drive** (`src/e2e/`, zero new dependencies). Playwright stays for pixels |
> | F2: the locked account caps coverage at ~40% of the surface | **Resolved.** `SPO_test3` now holds the **mayor** role and `Crazz` exists as a second party |
> | Phase E ships a desktop-shell test project | **Moot.** The desktop shell was removed from the repo (#149); the release workflow is `release.yml` and publishes no installer |
>
> The five-layer stack in §2 is now four layers; the traceability gate in §4 is now the
> routing table in E2E-POLICY.md §4.

**Status:** Adopted 2026-07-03 · **Superseded 2026-08-21** by [E2E-POLICY.md](E2E-POLICY.md)
**Companion policy:** [production-security-policy.md](production-security-policy.md) (SEC-* requirements referenced below)

This document defines how SPO-WebClient reaches and *keeps* 100% E2E coverage of existing and future features, verifies that the **full protocol logic** is respected (sequences, timers, lifecycle — not just individual requests), and verifies **production behavior** against the minimum security policy.

---

## 1. Audit of the Current Strategy

### 1.1 What exists today

| Layer | Mechanism | CI-gated? |
|---|---|---|
| Unit + component | Jest (2 projects: node + jsdom), per-directory coverage ratchet | Yes (CI runs `npm test` on every pull request and push to `main`; release.yml deliberately does not) |
| Protocol harness | Real `StarpeaceSession` wired to `MockTcpSocket` + `RdoMock` (`src/server/__tests__/protocol-validation/`) — order-asserted login/logoff/keepalive/ServerBusy/reconnect/timeout suites | No |
| Mock server | `src/mock-server/` — 9 capture-derived scenarios, `RdoStrictValidator`, WS integration tests | No |
| E2E | **Prose playbooks** (E2E-TESTING.md script, `/e2e` command, `e2e-test` skill) driven manually by an agent via Playwright MCP against the **live** game servers with one locked account | No — not code at all |
| Production/security | `security-hardening.test.ts` (5 suites) | No |

### 1.2 Findings

**F1 — The E2E layer is documentation, not code.** There is no `@playwright/test` runner, no `playwright.config.*`, no committed spec files. Regression detection depends on a human/agent re-executing a 17-phase prose script. Results are not reproducible, not diffable, and never gate a merge.

**F2 — The live-server dependency caps coverage permanently.** The locked `SPO_test3` account cannot exercise: road build/demolish, zone overlays (no mayor role), politics actions (vote/campaign), company creation, mail *send*, or any building mutation (rename/upgrade/delete/clone — forbidden as destructive). That is a structural ceiling of roughly 60% of the feature surface, and it can never be lifted while E2E runs only against production Delphi servers. Worse, scaling E2E traffic against the live servers is exactly what produces login storms and unthrottled load.

**F3 — Feature coverage is partial even for what the account *can* do.** Against the inventory of ~150 `WsMessageType`s and 20+ feature areas, the current scenario exercises roughly a third, read-only. Uncovered end-to-end (beyond the F2 list): reconnection UX (`ReconnectingOverlay`, `EVENT_WORLD_DISCONNECTED/RECONNECTED`, `EVENT_MAINTENANCE`), notifications (`EVENT_SHOW_NOTIFICATION`, `EVENT_MOVE_TO`), startup degraded mode, command palette, mobile layout/touch, search Banks/People deep paths, audio, the CDN/asset HTTP pipeline.

**F4 — Protocol-behavior testing is the strongest layer, but has known holes.** The Tier-4 harness asserts real sequences (auth 5-command chain, world-login 18-step order, logoff form, KeepAlive 60s cadence, ServerBusy never-reconnect, reconnect close-only with 3+20 bounded retries and jitter, timeout state machine). However:
- The mock engines themselves **do not enforce ordering or phase** — `RdoMock` matches each command independently; `ReplayEngine` records phase but never rejects out-of-phase requests. Ordering lives only in per-test `indexOf` assertions.
- Ten documented canonical behaviors lack automated verification (see §5.2, G1–G10), including the directory 20s timeout tier, pre-logon stale-session `Logoff`, cookie-restore/`ClientAware` handshake, viewport push filtering, the mail push path, and the ordered mail compose flow.
- The Tier-1/2/3 conformity branches are still gated on **manual** E2E runs.

**F5 — Production behavior is untested as wired.** `security-hardening.test.ts` re-implements the predicate functions (SSRF blocklist, traversal checks, origin validation) instead of booting the server and hitting it. Nothing asserts that a production-mode server actually emits the security headers exactly once, returns 429 on rate-limit breach, rejects a 6th WS connection, redacts passwords in logs, or refuses oversized payloads.

**F6 — No CI for the web/gateway path.** The only workflow is the release workflow (tag-triggered). No push/PR pipeline runs tests, coverage thresholds, lint, `npm audit`, or any E2E. The coverage ratchet in `jest.config.js` is enforced only when someone runs `test:coverage` locally.

**F7 — No formal security/production policy existed.** Guidance was spread across `doc/deployment-security.md` (advisory checklist, since removed as superseded) and the deployment guide, since extracted to SPO-Deploy (manual Step-9 verification) — with discrepancies (`.env.example` ships `LOG_LEVEL=info`, checklist says `warn`). Known open gaps: no global session cap, no startup validation of production env vars. → Resolved by creating [production-security-policy.md](production-security-policy.md).

**F8 — Procedure drift.** Four overlapping artifacts (E2E-TESTING.md, E2E-SCENARIO.md, `.claude/commands/e2e.md`, `e2e-test` skill) duplicate the same login procedure and selector tables. Each change must be made four times.

**Verdict:** the protocol harness is genuinely good; everything above it is manual, partial, and ungated. The new strategy keeps the harness, converts the prose E2E into code against a mock backend, and adds the two missing dimensions the user-facing product needs: *protocol-logic conformance as an enforced property* and *production-behavior compliance*.

---

## 2. Target Architecture — Five Layers

```
L4  Production Behavior & Security Compliance   (Jest, black-box vs server booted in prod mode)   CI: every PR
L3  Live Smoke                                  (Playwright MCP, locked account, read-only)       Manual: pre-release
L2  System E2E vs Mock Backend                  (@playwright/test specs, headless browser         CI: every PR
                                                 → real gateway → mock RDO/HTTP backend)
L1  Protocol Conformance                        (Jest, real StarpeaceSession + MockTcpSocket,     CI: every PR
                                                 strict-sequence scenarios)
L0  Unit + Component                            (Jest node + jsdom, coverage ratchet)             CI: every PR
```

Design decisions:

1. **The mock backend becomes the primary E2E target, the live server becomes smoke-only.** This inverts the current model. It is the only way to (a) cover permission-gated and destructive features, (b) get determinism, (c) run in CI, and (d) respect the live Delphi servers (SEC-N-3).
2. **Playwright graduates from MCP-driven to committed `@playwright/test` specs.** MCP remains the tool for L3 and for interactive debugging; regression coverage must be code.
3. **Coverage is enforced by a traceability gate, not by discipline** (§4). "100% of future features" is a mechanism, not a promise.
4. **The security policy is executable.** Every machine-checkable SEC-* item has an L4 test; the L4 suite is the compliance gate.

---

## 3. Layer Definitions

### L0 — Unit + Component (existing, unchanged)
Jest `unit` + `component` projects, co-located `*.test.ts(x)`, per-directory thresholds that only go up. New: thresholds are now **CI-enforced** (§7).

### L1 — Protocol Conformance (existing harness, extended)
- **Harness:** `protocol-test-harness.ts` wiring the real `StarpeaceSession` to `MockTcpSocket`/`HttpMock` — unchanged foundation.
- **New: strict-sequence mode** (§5.1) so that ordering/phase violations are detected by the mock itself in *every* test, not only where a test author remembered an `indexOf` assertion.
- **New: gap-closure suites** G1–G10 (§5.2).
- **Scope:** every session and protocol behavior that is wire-observable. Evidence hierarchy applies: live captures win.

### L2 — System E2E vs Mock Backend (new, the core investment)
- **Stack:** `@playwright/test` (dev dependency) + `playwright.config.ts` with two projects: `desktop-chromium` (1920×1080) and `mobile` (390×844 touch).
- **System under test:** the **real gateway** (`npm run dev` equivalent) started with `RDO_DIR_HOST=localhost` and the mock server serving RDO/HTTP scenarios — so the full chain Browser → WS → gateway → RDO framing → (mock) server is exercised. Only the Delphi endpoint is replaced.
- **New npm scripts:** `dev:mock` (gateway + mock backend), `test:e2e` (Playwright), `test:e2e:ci` (headless, retries=1, trace-on-failure).
- **Fixtures = mock scenarios.** Extend `src/mock-server/scenarios/` with the personas the live account can never be: `mayor-scenario` (roads, zones, town hall taxes), `rich-tycoon-scenario` (building placement, upgrade, clone, delete, company creation), `politics-scenario` (vote, campaign), `mail-send-scenario` (Post + `EVENT_NEW_MAIL` push), `resilience-scenario` (scripted socket kill → reconnect pushes → `EVENT_WORLD_RECONNECTED`), `degraded-startup-scenario`. Synthesized exchanges must be annotated with their Delphi-source justification.
- **Assertions:** `window.__spoDebug.getState()` + wire history (existing API, already designed for this), DOM via accessibility selectors. Screenshots only on failure (trace artifact), never as assertion.
- **Spec organization mirrors the feature inventory:** `e2e/specs/login.spec.ts`, `map-navigation`, `building-inspector`, `build-and-mutate`, `roads-zones`, `chat`, `mail`, `search`, `politics`, `empire-profile`, `settings-palette`, `mobile-shell`, `resilience`, `startup-degraded`, `notifications`.
- **Wire conformity in E2E:** the mock backend runs `RdoStrictValidator` over all traffic during every spec; violations fail the spec. This makes every UI test double as a protocol-shape test.

### L3 — Live Smoke (existing procedure, slimmed)
- Keep Playwright-MCP + locked credentials (`SPO_test3` / Free Space / planitia — unchanged, still LOCKED).
- Reduce E2E-SCENARIO.md's 17 phases to an 8-phase **read-only** smoke: server start → login → map render → zoom/rotate → stats → chat ping → one panel sweep → logout → server stop. Everything else moved to L2.
- Cadence: before a release/deploy, or on demand — never in CI, never in a loop. This is
  operator discipline, not a mechanised guard: the e2e layer's own live-run limiter that
  once enforced "never in a loop" was removed 2026-09-03, not tuned (B3.5,
  [bench-worker.md](bench-worker.md) §6). SEC-N-3 is a different rule — it routes load,
  soak, reconnect-storm and fuzz *traffic* to the mock backend
  ([production-security-policy.md](production-security-policy.md) §8); it does not cap how
  often this live smoke may run.

### L4 — Production Behavior & Security Compliance (new)
- **Stack:** Jest project `compliance` that boots the built server (`dist/server/server.js`) as a child process with `NODE_ENV=production`, `TRUST_PROXY=true`, `ENABLE_HSTS=true`, `LOG_JSON=true`, `LOG_FILE=<tmp>` and a mock RDO backend, then tests it **black-box** over real HTTP/WS sockets.
- **Checks map 1:1 to policy items** (IDs in [production-security-policy.md](production-security-policy.md)):
  - `SEC-H-1..3`: every response carries the security header set exactly **once** (catches nginx duplication regressions); CSP string matches policy; HSTS present when `ENABLE_HSTS=true`, absent otherwise.
  - `SEC-H-4`: auth endpoints return 429 after 10 attempts/min/IP; debug-log after 2/60s; proxy-image after 60/min.
  - `SEC-H-5/6`: path-traversal probes (`..`, `%2e%2e`, `\`, `%00`) on `/api/map-data`, `/cache/*`, `/cdn/*` → 4xx, never file contents; SSRF probes on `/proxy-image` (localhost, 10.x, 169.254, IPv6 fe80) → rejected.
  - `SEC-W-1..5`: WS handshake without/with bad Origin → 403; 6th connection from one IP → 429; >64KB frame → connection dropped; gameplay message pre-auth → `ERROR_AccessDenied`; unknown type → rejected.
  - `SEC-L-1/2`: send a real login attempt, then scan the NDJSON log file: password never appears, `[REDACTED]` does; no `debug`-level entries in production mode.
  - `SEC-R-2`: startup env validation — booting with `NODE_ENV=production` and a forbidden combination (e.g. `LOG_LEVEL=debug`) fails fast with a clear error (test lands with the fix).
- These tests replace the mirror-the-predicate style of `security-hardening.test.ts` (which stays as fast unit coverage of the predicates themselves).

---

## 4. The 100%-Coverage Mechanism (Existing *and Future* Features)

Discipline does not survive contributors; gates do. Three enforced registries make missing coverage a **red build**, so any future feature is covered by construction:

**4.1 WS message traceability manifest — `src/__tests__/coverage/ws-manifest.ts`**
A single table mapping **every** member of `WsMessageType` (all `REQ_*`, `RESP_*`, `EVENT_*`) to its coverage:
```ts
{ type: WsMessageType.REQ_BUILD_CAPITOL, l1: 'protocol-validation/capitol', l2: 'e2e/specs/roads-zones', }
{ type: WsMessageType.EVENT_MAINTENANCE, l1: 'rdo/push-maintenance', l2: 'e2e/specs/resilience', }
{ type: WsMessageType.RESP_PONG, excluded: 'transport-level, covered implicitly by every spec' }
```
A Jest gate iterates the enum: any message type absent from the manifest → **fail** with the message "new WsMessageType must declare L1/L2 coverage or a justified exclusion." Adding a feature (which always means adding a message type) is impossible without declaring its tests. A second assertion verifies the referenced spec/test files exist on disk.

**4.2 HTTP route registry gate.** Export the route table from `server.ts` (route list is already centrally dispatched); the gate asserts every route appears in either an L2 spec or the L4 suite manifest.

**4.3 Panel/feature registry gate.** The `ui-store` panel registry (login, chat, mail, profile, politics, settings, minimap, buildMenu, buildingDetails, searchMenu, + future) must each be referenced by at least one L2 spec (`panels.<name>` assertion grep, or explicit manifest). A new panel without an E2E spec fails the gate.

**4.4 Definition of Done (process, mirrored in CLAUDE.md):** a feature PR ships with (a) L0 tests meeting the ratchet, (b) mock-scenario exchanges for any new RDO traffic (capture-derived or Delphi-justified), (c) L2 spec or spec extension, (d) manifest entries. The gates in 4.1–4.3 make (b)–(d) non-optional.

---

## 5. Protocol-Logic Conformance ("the full protocol logic is respected")

### 5.1 Strict-sequence mode in the mocks
Today ordering is asserted only where individual tests do `indexOf` comparisons. Add enforcement to the engines, following the existing non-blocking `RdoStrictValidator` pattern (collect violations, assert in `afterEach`):
- **`RdoMock.enableSequenceMode(expectedOrder: string[])`** — exchange IDs consumed out of declared order, or re-consumed, record a `SEQUENCE` violation.
- **`ReplayEngine` phase enforcement** — it already tracks `MockSessionPhase`; add `strictPhases: true` so a request arriving in a phase where it is not legal (e.g. `REQ_MAP_LOAD` before `COMPANY_SELECTED`) records a violation instead of silently matching.
- Both default **on** for L1 protocol-validation suites and the L2 mock backend; opt-out per test for deliberately-adversarial cases.

Result: *every* L1 and L2 run asserts sequence and phase legality as a side effect, for current and future traffic.

### 5.2 Gap-closure backlog

| ID | Behavior | New verification |
|---|---|---|
| G1 | Directory ops use the 20s `DIRECTORY` timeout tier | L1: timeout-state-machine extension |
| G2 | Cacher KeepAlive 60s vs server 5-min TTL safety margin; idle-5-min survival | L1 fake-timer suite (5× margin invariant) + L2 `resilience` spec with accelerated mock TTL |
| G3 | Pre-logon stale-session `Logoff` with 5s deadline before fresh `Logon` | L1: world-login extension |
| G4 | `GetTycoonCookie` position-restore GET sequence + `ClientAware` fire-and-forget ordering | L1: post-login handshake suite |
| G5 | `PickEvent` polling — accepted divergence D4: **assert it is NOT sent** on a cadence, only at login/company-select | L1 negative assertion (guards the divergence decision) |
| G6 | Viewport-intersect filtering of `RefreshArea`/`RefreshObject` pushes | L1 push suite + L2 assertion that off-viewport pushes don't mutate state |
| G7 | Mail push path — `ReportNewMail` drives unread count; client never polls | L1 push suite + L2 `mail` spec via `mail-send-scenario` |
| G8 | Ordered mail compose flow NewMail→AddLine→Save/Post→CloseMessage with QueryId continuity | L1 sequence suite through the real session |
| G9 | Anti-pattern negatives: no world/mail-socket keepalive, never `CheckNewMail(#0)`, `"^"` never fire-and-forget without RID | L1 negative suite scanning `MockTcpSocket.capturedCommands` across all scenarios |
| G10 | Tier-1/2/3 branch E2E gates (login+accents, clean logout+idle, reconnect soak) currently manual | Automate as L2 `resilience`/`login` specs vs mock; live L3 run remains the final gate before merging those branches |

### 5.3 Cross-cutting invariants (asserted globally, not per-feature)
Run over the captured wire traffic of **every** L1/L2 execution: RID monotonicity per socket; booleans emitted as `#-1`/`#0`; the separator matches the member's Pascal kind — `"^"` only on a `function`, `"*"` only on a `procedure`, enforced by `assertNotVoidPush` (note that `"*"` **with** a QueryId is legal and proven for every member in `VOID_MEMBERS`, so "void push" does not imply "no RID"); Latin-1 framing round-trip; `sent ≈ received` balance; zero unanswered RIDs at session close.

---

## 6. Production-Behavior Verification

Covered by L4 (§3) executing the policy. The one code change **required by policy** has since landed:
1. ~~**Startup production-env validation** (policy SEC-R-2)~~ — **done 2026-08-25**, `src/server/production-config.ts`: in `NODE_ENV=production` the gateway refuses to start on `LOG_LEVEL=debug`, warns when `TRUST_PROXY`/`ENABLE_HSTS` are unset, and logs the effective security configuration once at boot.
Optional hardening queued behind it: global session cap (SEC-W-3).

---

## 7. CI Pipeline

New workflow `.github/workflows/ci.yml` (push + PR to `main`), independent from the release workflow:

```
jobs:
  quality:    npm ci → tsc typecheck → npm run test:coverage   (thresholds = existing ratchet, now enforced)
  protocol:   npm test -- --selectProjects unit --testPathPattern "protocol-validation|__tests__/rdo"  (L1, incl. sequence mode)
  e2e:        npm run build → start gateway+mock → npx playwright test  (L2, headless; trace+video artifacts on failure)
  compliance: npm run build → jest --selectProjects compliance          (L4, prod-mode boot)
  audit:      npm audit --omit=dev --audit-level=high                   (SEC-D-1)
```
Nightly (optional, Phase E): long-run soak — reconnect storm, 30-min idle keepalive, memory watermark.
L3 live smoke is deliberately **not** in CI.

---

## 8. Implementation Roadmap

| Phase | Deliverables | Acceptance criteria |
|---|---|---|
| **A — Foundations** (small, highest immediate value) | `@playwright/test` + config + `dev:mock` script; CI workflow with quality/protocol/audit jobs; **L4 compliance suite** for all currently-met SEC items; startup env validation (SEC-R-2) | CI red/green on PRs; L4 passes against prod-mode boot; booting prod with `LOG_LEVEL=debug` fails |
| **B — Coverage gates** | ws-manifest + route + panel gates (§4), seeded with current coverage (gaps declared as `pending:` entries, gate tolerates `pending` but prints the debt) | Adding an unmapped `WsMessageType` breaks the build |
| **C — E2E conversion** | Port E2E-SCENARIO phases to L2 specs vs mock; new persona scenarios (mayor, rich-tycoon, politics, mail-send, resilience, degraded); mobile project | All 16 F3 gaps have specs; `pending` debt in manifest ≤ 10% |
| **D — Protocol closure** | Strict-sequence mode; G1–G10 suites; cross-cutting invariant checker | Sequence mode on by default; conformity report gates automatable via L2 |
| **E — Long tail** | Nightly soak; L3 slimming; consolidate the four E2E procedure docs into one (E2E-TESTING.md) + pointers | `pending` debt = 0 → **100% manifest coverage**; docs deduplicated |

Effort note: A+B are days; C is the bulk (scenario data authoring is the long pole); D reuses the existing harness; E is opportunistic.

---

## 9. Rules Carried Forward (unchanged)

- Live credentials `SPO_test3` / `test3` / Free Space / planitia / `SPO_test3 - Green` remain **LOCKED** and are used **only** in L3.
- No destructive actions on the live server, ever — destructive coverage lives in L2 against the mock.
- New mock scenario data is verified against the Delphi source in `../SPO-Original` before it is trusted.
- Screenshot analysis stays delegated to sub-agents (L3 only; L2 uses traces).
