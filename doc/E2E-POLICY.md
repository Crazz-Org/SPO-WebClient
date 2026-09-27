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
L3  LIVE browser smoke        Playwright MCP, SPO_test3 / Crazz         UI/render/mobile diffs, + pre-release
```

L2 replaces both the abandoned mock-E2E plan and most of the browser smoke. L3 survives only
for what a WebSocket cannot observe: rendering, layout, input, mobile.

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
| `src/client/components/politics/**` | L2 `politics-read`, `politics-write` |
| `src/client/components/building/**` | L2 `building-details` |
| `src/client/renderer/**`, mobile layout, `*.module.css` | **L3** browser smoke (a WS drive cannot see a pixel) |
| `package.json`, `package-lock.json` | L2 spine + `building-details` — the shipped code moved even though no `src/` file did |
| `doc/**`, `*.md`, CI config, tooling | static only |

The **login spine** (connect -> auth -> directory -> world login -> company select ->
logoff) is appended to every L2 run regardless of routing. It is the cheapest possible
regression detector and it is where session-lifecycle breakage surfaces first.

Unmapped path -> the gate fails closed and asks for a routing entry. Silence is never a pass.

---

## 5. The round-trip probe

Every mutation exercised live uses this shape, and nothing else counts as verification:

```
read original -> write test value
              -> assert the FIVEMODELSERVER/Survival log line inside the run's UTC window
              -> read back
              -> restore original
              -> assert restored
```

The log line is the only evidence that is not the client agreeing with itself. Civic RDO
members log on entry, *before* their `try`, so a line proves the frame reached the object:

| Member | Log marker |
|---|---|
| `RDOSetTaxValue` | `Setting Tax value:` |
| `RDOSetMinSalaryValue` | `Setting Min Wage:` |
| town cache load | `Caching Town..` |

Read-back may legitimately lag the write (`OB-29`) — so a read-back mismatch **downgrades**
to `UNCONFIRMED`, it does not by itself fail the probe. A missing log line **fails**.

### The live server logs — http://158.69.153.134/logs/

An open IIS directory listing, no auth — this is how a live run is proved rather than assumed.
**Reading a log is not probing the server.** It is also not a substitute for the Pascal: a log
proves what *happened*, the declaring unit under `Kernel/` (or `DServer/`, `Voyager/`) in
SPO-Original defines a member's kind and arity. Download and grep; the Survival log runs 2–3
MB/day, too big for context.

| Path | Carries |
|------|---------|
| `FIVEMODELSERVER/Survival <YY-MM-DD>.log` | **the one that matters** — civic RDO members log on entry, *before* their `try`, so a line here proves the frame reached the object (`Setting Tax value: …`, `Setting Min Wage: …`, `Caching Town..`) |
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
  takeover now always preserves or flags what was owed.)
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
by run, and are unaffected by this removal; they remain raised for the test phase and are
tightened at public-deployment time per SEC-H-4 (`doc/production-security-policy.md`).

---

## 7. Capability exceptions — what the account cannot do

A change can only be driven live if the test account is **authorised to perform it on the
server**. That is a property of the account, read from the server — never of the UI. The
distinction is the whole point:

| What the gate sees | What it is | What happens |
|---|---|---|
| a control missing, a request refused by the gateway, a wrong frame | a **bug** | `FAIL` — diagnose, fix, iterate (§8) |
| the server says the account does not hold the role the member needs | a **capability exception** | recorded with its evidence; the gate continues |

The six `TPresidentialHall` members ([civic-roles-reference.md:101-106](civic-roles-reference.md))
— `RDOSetMinSalaryValue` · `RDOSetTownTaxes` · `RDOSitMayor` · `RDOSitMinister` ·
`RDOBanMinister` · `RDOSetMinistryBudget` — need the **president** capability. When the diff
touches one, the live stage reads two server facts for `SPO_test3` (`src/e2e/capability.ts`):
`IsPresident` from the tycoon cache (`Tycoons\<name>.five\`, written by `StoreRoleInfoToCache`)
and `canGovern` on the Capitol itself — the server's own `grantAccess` decision on the
presidential hall. `granted` follows `canGovern`; the cache flag rides along as evidence.

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
| `Crazz` | `test` | Second party — a real account, holdings not enumerated here | Permission-negative, mail receive, rating another tycoon's term. **Read-only apart from mail:** it receives the `mail-roundtrip` test mail, and sends one seed `Zoning Alert!` to SPO_test3 per `zoning-alert-read` run, deleted from SPO_test3's Inbox and from Crazz's `Sent` in the same run. |

Both are **LOCKED** — never changed without explicit developer approval. Zone **Free Space**,
world **planitia**.

Two accounts unlock four things that were structurally impossible:

| Now testable | Why it matters |
|---|---|
| **Negative permission** — drive `Crazz` at the Town Hall, assert `canGovern=false` and that the control is *absent*, not merely disabled | Catches the `tycoonratings.asp:24-25` failure mode (guard commented out, result hardcoded `true`) in our own client |
| **Mail send -> receive** | Genuinely end-to-end for the first time; send was previously untestable |
| **Ratings** | `OB-30`: nobody can rate their own term. `Crazz` rating `SPO_test3` is a real path |
| **Roads / zones** | Mayor role removes these from the "structurally untestable" list |

**Blast radius.** All mutations happen on `SPO_test3`'s own town (Helartia). The second
account is touched only by mail: `mail-roundtrip` sends it one message and deletes it
in the same run, and the `zoning-alert-read` seed has it send SPO_test3 one look-alike
`Zoning Alert!`, deleted from SPO_test3's Inbox and from Crazz's `Sent` in the same run.
No flow reads or writes its buildings (`flows.ts`: it appears at the login in
`permission-negative`, which does not mutate, as the mail recipient, and as the seed sender).
Never another player's assets. Never a world-scope value. Every mutation is restored in
the same run (§5).

---

## 10. Artifact format

`report/e2e/gate-<sha>.json` — gitignored, per-machine, summarised into the PR body:

```jsonc
{
  "head": "<sha>", "branch": "fix/…", "verdict": "PASS|FAIL|BLOCKED",
  "createdAt": "2026-08-21T09:12:44.101Z",
  "static": { "typecheck": "PASS", "lint": "PASS", "test": "PASS" },
  "routing": { "changed": ["src/…"], "required": ["login-spine", "politics-write"] },
  "live": {
    "world": "planitia", "account": "SPO_test3",
    "window": { "from": "…Z", "to": "…Z" },
    "flows": [{ "name": "politics-write", "status": "PASS",
                "probes": [{ "member": "RDOSetTaxValue", "logLine": "Setting Tax value: 12",
                             "restored": true, "readBack": "CONFIRMED" }] }]
  },
  "exclusions": { "presidentMembersTouched": ["RDOSitMayor"],
                  "capability": [{ "capability": "president", "members": ["RDOSitMayor"],
                                   "account": "SPO_test3",
                                   "checks": [{ "what": "canGovern on the Capitol (server grantAccess)", "value": "false" }],
                                   "checkedAt": "…Z" }] },
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
npm run gate -- --flows=login-spine,politics-write
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
