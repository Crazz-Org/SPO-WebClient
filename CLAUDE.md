# CLAUDE.md — Starpeace Online WebClient

Browser-based multiplayer tycoon client, wire-compatible with the original Delphi
Starpeace Online servers. TypeScript + Node.js + WebSocket + Canvas 2D isometric.
RDO protocol. Beta — version = latest `v*` tag / GitHub Release.

```
Browser Client --WebSocket--> Node.js Gateway --RDO/TCP--> Delphi Game Servers
```

**The RDO protocol is the project.** Everything else is replaceable; a wire divergence is
not. Treat RDO work as the highest-stakes work in the repo.

**This file carries the trigger and the decision. The mechanism and the history live in
[doc/](doc/)** — start from [architecture-overview.md](doc/architecture-overview.md).
Bug intake lands in [doc/bug-reporting.md](doc/bug-reporting.md) and is drained into
kanban cards by `/triage-report` ([.claude/commands/triage-report.md](.claude/commands/triage-report.md)).

## Never do these

- Construct RDO protocol strings manually — always `rdoCall` / `rdoGet` / `rdoSet` from
  `@/shared/rdo-frame`, with `RdoValue` arguments
- Use `any` — `unknown` in catch blocks, typed interfaces for data
- Modify a file without reading it first
- Ship code without tests — new/modified lines must reach ≥ 93 % coverage
- Change `rdo-members.ts` without citing the server declaration, or lower a Jest threshold —
  **enforced**: `scripts/check-pr-rules.js` runs inside the required CI check and fails a
  change to `rdo-members.ts` whose PR body cites no `File.pas:Line`, and any lowered
  `jest.config.js` threshold (thresholds only go UP)
- Load screenshots into the main context during debug/E2E — delegate to a sub-agent
- Add a UI element without wiring its action — no dead buttons

## Working rules

- **Simplest solution that meets the criterion.** No abstraction built for a hypothetical
  future need — solve the case in front of you.
- **No new external dependency without asking first.** Explain what it brings and what is
  lost without it, then wait for the answer.
- **Explain design choices without jargon**, as to someone who does not program.
- **Never modify a test to make it pass.** A failing test means the code is wrong, or the
  criterion was badly stated — in that case, ask.
- **An ambiguous request is a question, not a guess.** Ask before implementing.

## RDO — one catalogue, one emitter

**The separator is not a decision.** It follows from the member's kind, and the emitter derives
it. Nothing else in the codebase writes one.

| file | role |
|------|------|
| `src/shared/rdo-members.ts` | the catalogue — one entry per member actually emitted, with its `kind` (`function` / `procedure` / `accessor`) and `arity` |
| `src/shared/rdo-frame.ts` | the emitter — `rdoCall` / `rdoGet` / `rdoSet` / `rdoIdOf`, and the five frame forms |

```ts
rdoCall('ObjectAt', targetId, RdoValue.int(x), RdoValue.int(y))   // -> "^", 2 args, checked
rdoGet('WorldName', targetId)
rdoSet('Stopped', targetId, RdoValue.int(-1))
```

`.packet` feeds `sendRdoRequest`; `.toFrame()` feeds `writeRdoFrame`.

### Adding or changing a member

The catalogue is a census of what the client emits, not a copy of the Pascal. To add an entry
you need the member's **kind** and **arity**, and the only authority for those is the
**declaring unit** in SPO-Original — the server-side object under `Kernel/`
(`Kernel/TownPolitics.pas:40` declares the 3-arg `RDOSetRatingFrom` the catalogue cites),
`DServer/` for the directory server, or the Voyager unit for a member the reference client
declares (`TVGeneralSheet.pas:15`); `Rdo/Server/` (`RDOObjectServer.pas`) is the **transport** —
it fixes how a call is dispatched (kind → separator, arity → register file) and holds no member
declaration at all. Read it with **`delphi-archaeologist`**,
cite `File.pas:Line`, and never probe the live server (`~/SPO-Original`, or `../SPO-Original`
relative to the repo root). Get it wrong and the server has no
self-recovery: `"^"` on a `procedure` leaves a result pointer nobody pops (**freeze**); `"*"` on
a `function` writes through a register nobody set (**arbitrary memory write**); `"^"` with no rid
builds a reply with no destination (**crash**). Arity follows the same register file —
`ParamCount` comes from the *received* array (`RDOObjectServer.pas:218`), args land `EDX` →
`ECX` → stack (`:266-277`). The type system carries all three: an uncatalogued member does not
compile, a wrong argument count throws, the separator cannot be hand-written.

### Two rules the catalogue does not encode

1. **Verb follows the reference client, not the declaration.** `get` on a 0-arg `function` is
   correct and is what Voyager emits (`GetProperty` falls through to `CallMethod`,
   `RDOObjectServer.pas:112-116`). `set` has no fallthrough — a missing property returns
   `errUnexistentProperty` (`:176`).
2. **A form the reference client demonstrably emitted wins over what the declaration suggests.**
   Explain why it works, then follow it; never silently "fix" a working call.

What the catalogue does not describe — forbidden members, session-lifecycle members,
connection-bound members, buffer depth — is held by the ratchet in
`src/server/__tests__/rdo/capability-inventory.test.ts`, which derives every assertion from the
sources at test time. The separate `rdo-request-guards.ts` module that once carried this was
absorbed into the catalogue and `src/shared/rdo-frame.ts`.

**A PR touching `rdo-members.ts` gets a second, automated reader before `change-validator`:**
the `citation-verifier` sub-agent (`.claude/agents/citation-verifier.md`) opens every cited
`File.pas:Line` itself and confirms the citation is genuine and the entry's kind and arity
match it — directly, or via one of the two rules above, stated and explained. It returns
`PASS`, `REJECT` (a false citation, or a mismatch neither rule excuses — blocks the merge), or
`DIVERGES` (citation genuine, entry correct, but a real, rule-justified divergence from the
bare declaration — does not block, flagged for a human to confirm). It is read-only and never
probes the live server, same as everything else in this section.

## Legacy Delphi source — SPO-Original

Sibling of this repo, Delphi 5, ~1750 `.pas` — **both halves of the original system**, the
Delphi servers *and* the Voyager client. Its own git repo (`Crazz-E/SPO-Original`), a
**read-only historical artifact**: never write into it, never probe the live server instead.
Every claim from it cites `File.pas:Line`, or is marked `[INFERRED]` / `[UNKNOWN]`. Read the WSL copy — the Windows
mount (`/mnt/c/Users/Crazz/Documents/SPO/SPO-Original`) is the same commit with CRLF.
Path: `~/SPO-Original`, or `../SPO-Original` relative to the repo root — **not** from a session
worktree, where `..` resolves to `.claude/worktrees/`, not the repo root.

| Path | Holds |
|------|-------|
| `Rdo/Server/` | the RDO **transport** (`RDOObjectServer.pas`): how a frame is dispatched; holds no member declarations |
| `Rdo.BIN/`, `Rdo.IS/` | divergent forks of the same units — do not cite them: a line number from `Rdo/` lands on other code there |
| `Voyager/`, `Voyager.1/` | the original Delphi client — the reference for *what the client demonstrably emitted* (rule 2 above) |
| `Kernel/`, `Model Server/`, `Interface Server/`, `Directory Server/` | game model and the servers behind the gateway — **the member declarations the catalogue cites** (`Kernel/TownPolitics.pas`, `Kernel/WorldPolitics.pas`, `Kernel/World.pas`, `DServer/DirectoryServer.pas`) |

⚠ **Some `.pas` files are ISO-8859-encoded and defeat grep's binary detection** — a plain
`grep <pattern> some-file.pas` silently returns nothing and exits 1, as if the text were absent
(`Kernel/KernelCache.pas`, `rc4.pas`, `MediaNameGenerator.pas`, `PublicFacility.pas` at least;
`file *.pas` names them "ISO-8859 text"). Use `grep -a` or the Read/Grep tools — never conclude
a name is absent on an unqualified `grep`. Never re-encode a file to work around it.

⚠ [spo-original-reference.md](doc/spo-original-reference.md) indexes the tree but is
hand-maintained and **has misclassified a member's kind before**. For kind or arity, open the
`.pas` and read the declaration; the index is a finding aid, not an authority.
## Legacy web source — SPO-ASP

The other half of the original client: the **ASP pages IIS serves**, where the Politics, News
and campaign screens actually live. A separate tree from `SPO-Original`.
Path: `~/SPO-ASP`, or `../SPO-ASP` relative to the repo root — **not** from a session
worktree, where `..` resolves to `.claude/worktrees/`, not the repo root.

```
# paths below are relative to ~/SPO-ASP
~/SPO-ASP/Five/<n>/Visual/Voyager/...   the per-world instances, 0..5
~/SPO-ASP/Five/<n>/language/*.lng       the UI strings the pages interpolate
~/SPO-ASP/Five/Visual/...               the template the instances were cut from — DIFFERENT
```

**Cite `Five/0`.** The six instances are byte-identical to each other and `Five/0` is the path
the gateway fetches (`buildAspUrl`, `spo_session.ts:927`); the bare `Five/` template diverges,
so a line number from it lands on other code.

Two things the pages are the authority for, and the Pascal is not:

- **What the reference client demonstrably emitted** — `rdoModifyRating.asp:24-27` shows the
  `BindTo(TownHallId)` and the argument order for `RDOSetRatingFrom`.
- **Which controls a player was actually offered.** Read the guard, not just the markup: a
  `<select>` can ship inside a `display: none` div that only a `canModify`-gated handler
  reveals (`tycoonratings.asp:53`, `:76`, `:149-151`). ⚠ And read the ASP, not the comment —
  `tycoonratings.asp:24-25` has the real test commented out and the result hardcoded `true`.

`Five/Client/Cache/` is the client's **map image** cache (`images.cab`), not the model server's
object cache — it cannot tell you what a cached property currently holds.

## Backlog — GitHub Projects

**All open work lives on the kanban:**
[github.com/orgs/Crazz-Org/projects/1](https://github.com/orgs/Crazz-Org/projects/1) — every
task is a GitHub issue on the board. **The board is driven by the orchestrator in the sibling
[SPO-Pipeline](https://github.com/Crazz-Org/SPO-Pipeline) repo**, not from inside this one: it
claims a card, opens a worktree, implements, gates, validates and merges, writing the board at
each state transition. This repo supplies the `board:*` scripts it spawns, and nothing else.
This rulebook covers the ten columns (Intake · Todo · Planning · Implementing · Checks & PR ·
Gate · Validation · Merging · Done · Parked), the
`Session` field as ownership marker, board writes at state transitions only, ownership,
one-session-per-area, blocking order, GitHub API budgeting and card filing:
[doc/kanban-workflow.md § The short form](doc/kanban-workflow.md).

**Ownership is sacred** — never touch a card whose `Session` is filled; every owner closes its
ownership (Done or Parked). A task that dies without closing it leaves a card only the
human may free (`.github/workflows/orphan-cards.yml` only comments; it frees nothing).

**Stay on the claimed card.** A session solves and implements the task it took, and reports on
that task only. What it met in passing — an unrelated snag noticed while reading, a smell in a
file it did not change, a "valuable but out of scope" remark — is neither filed nor narrated:
no new issue, no closing section of the end report. A test session or a requested audit finds
it again, at a moment where someone asked for it. Only the maintainer widens a session's scope.
The pipeline harness refuses writes under `.claude/`; a card whose change must land there is
maintainer-only and says so in its body.

## Environment

**WSL2 (Linux) on a Windows 11 host** — bash inside WSL, repo at `/home/<user>/SPO-WebClient`,
Node.js 22 / npm 10 in WSL (`/usr/bin/node`). Everything the project needs runs inside WSL.

- Use Claude Code tools (Read, Grep, Glob, Edit, Write) rather than shell `grep`/`find`/`cat`/`sed`.
  The permission allowlist deliberately excludes those shell aliases.
- Processes: `ps` / `kill` inside WSL; `tasklist` / `taskkill` only for host-side processes
- Line endings: LF only (`.gitattributes` and `.editorconfig`) — never introduce CRLF
- Minimum supported runtime is Node 22 (`engines`, the Dockerfile's `node:22`, CI)

## Commands

```bash
npm run build              # server + client + terrain-test
npm run typecheck          # all four tsconfigs (server, client, e2e, tests)
npm run lint                # ESLint 10, flat config — 0 errors is the CI gate
npm test                     # full Jest suite
npm run test:changed        # --onlyChanged --bail
npm run coverage:changed    # the coverage ratchet on new/modified lines
npm run verdict -- <alias>  # run test/typecheck/lint/... with the full log kept, short transcript
npm run gate                # THE GATE — commit, push, open the PR first; then this
npm run finish              # THE END of an update, after the PR is merged
npm run dev:local           # build + start yourself, for debugging only — attests nothing
# every other alias (leases, bench:status, bench:wait, pr:wait, test:live, deps:gate,
# e2e:unlock, gate:local): doc/bench-worker.md
```

**Verdict = exit code, never the printed report.** Never pipe a verdict command into
`tail`/`head`/`grep`, never background it with a trailing `&`, never `out=$(…)` — each of
those drops or destroys the exit code. `npm run verdict -- <alias>` is the sanctioned way to
keep a transcript short. Codes: 0 PASS · 1 verdict not passing · 2 refused at deposit (dirty
tree) · 3 worker down · 4 wait timed out. Full spec: [doc/bench-worker.md](doc/bench-worker.md) §5.

## Automation (`.claude/hooks/`)

| Hook | Event | Does |
|------|-------|------|
| `pre-push-gate.sh` | PreToolUse (Bash) | Blocks a **direct push to `main`** — nothing else. It cannot demand an attestation for HEAD: the worker gates a *pushed* sha |
| `bench-port-guard.sh` | PreToolUse (Bash) | Blocks anything that would take the bench port (8080) or drive the live world outside the worker; names the sanctioned form |
| `main-commit-guard.sh` | PreToolUse (Bash) | Refuses `git add` / `git commit` when the repository the command resolves to is standing on `main` — the drift where an absolute path or a persisted `cd` lands a session's work on the main checkout instead of its worktree. `pre-push-gate.sh` and the ruleset stop the push; this stops the commit itself |

`npm test` and `npm run build` stay manual — run them before declaring a session complete.

## Testing — four layers, and the push gate

```
L0  Unit + component          Jest node/jsdom, coverage ratchet           CI: every PR
L1  Protocol conformance      Jest + src/mock-server/ (rdo-mock, strict   CI: every PR
                              validator) — NOT a mock backend for E2E
L2  LIVE WS drive  <- gate    src/e2e/, headless `ws` -> gateway ->       PRE-MERGE: every code change
                              planitia. `npm run test:live`
L3  LIVE browser smoke        Playwright MCP, SPO_test3 / Crazz       pixels only, + pre-release
```

**The gate.** The bench gates a **pushed commit**, not your worktree, so the order is
**commit → push → open the PR → `npm run gate`**. **Open the pull request before gating**:
`ci.yml` triggers on `pull_request`, so a branch with no PR has no CI run for its sha and the
worker replays the entire Jest suite on the exclusive bench — the slowest path, which has
already killed a gateway mid-job. **Only the worker attests**; `npm run gate:local` is evidence
for reading, never a merge unblock. **A crash is a failure, but silence is not a pass**: a
mutation is proven by the `FIVEMODELSERVER/Survival` log line, not by a `success: true`
response (`OB-28`); a lagging read-back is expected (`OB-29`) and does not fail a probe, a
missing log line does. Three attempts maximum, each naming a different root cause. Full rules:
[doc/E2E-POLICY.md](doc/E2E-POLICY.md), [doc/bench-worker.md](doc/bench-worker.md). Live server
logs (open IIS listing, `http://158.69.153.134/logs/`) prove what happened; reading one is not
probing the server — `doc/E2E-POLICY.md` §5.

**The nightly proves `main`** (`doc/bench-worker.md` §8): while `main` is red no task merges
`origin/main` into its branch.

`module.ts` → `module.test.ts`, same directory. Two Jest projects: `unit` (node, `.test.ts`)
and `component` (jsdom, `.test.tsx`).

**Two coverage numbers — do not conflate them.** New/modified lines must reach ≥ 93 %,
enforced by `npm run coverage:changed` (`scripts/coverage-changed.js`, run by `gate:precheck`
and by CI on every PR; `COVERAGE_CHANGED_MIN` overrides the floor). **That script IS the
precheck's suite pass** — `--collectCoverageFrom` restricts instrumentation, not execution, so
running `npm test` beside it runs the whole suite twice. `jest.config.js` separately enforces a
machine floor (global 38 %, higher per directory). Thresholds only go UP. Details:
**`spo-testing`** skill.

## Skills, commands, sub-agents

20 skills installed — inventory in [manifest.json](.claude/skills/manifest.json), regenerate
with `node .claude/generate-skills-manifest.js` (`--check` in CI fails if stale). Skill count derives from `find .claude/skills -maxdepth 1 -type d | wc -l`.

**Project skills, invokable via `/name`:**

| Skill | For |
|-------|-----|
| `delphi-archaeologist` | Reverse-engineering SPO-Original (`~/SPO-Original`), tracing RDO handlers |
| `spo-testing` | Tests, coverage, fixtures, L1 substrate, RDO matchers |
| `dependencies` | Vulnerability audit, licences, package updates |
| `e2e-test` | L3 live browser smoke (user-invoked only) |

**Auto-load only** (not slash-invokable): `web-games` (Canvas 2D renderer, frame budget),
`zustand-store-ts` (stores, selector stability), `mobile-ux-optimizer`
(MobileShell/BottomNav/BottomSheet).

Slash **commands** live in `.claude/commands/`: `/gate`, `/commit-push`,
`/coverage-check`, `/e2e`, `/release-notes`, `/triage-report`.

**Sub-agents** (`.claude/agents/`), read-only:

| Agent | Model | Use for |
|-------|-------|---------|
| `security-reviewer` | Opus | WebSocket auth, RDO parsing, session management, OWASP |
| `performance-analyzer` | Opus | Renderer bottlenecks, chunk caching, frame budget |
| `card-reviewer` | Fable | The neutral reader of a draft backlog card, before it is filed |
| `change-validator` | Fable | Read-only semantic review of a finished change — adequacy to the card's criterion and coherence of integration — after a gate PASS, before the merge |

Delegation ladder and model routing: `doc/kanban-workflow.md` § Sub-agent handoffs and §
Model routing. Never delegate understanding — synthesise an agent's result yourself, then act.

## E2E credentials — LOCKED

Accounts `SPO_test3`/`test3` (Mayor of Helartia, primary) and `Crazz`/`test` (secondary), zone
Free Space, world planitia. **Never change without explicit developer approval.** Mutations only
on Helartia; capability exceptions are read from the server, never overridden —
`doc/E2E-POLICY.md` §7 and §9, procedure `doc/E2E-TESTING.md`.

## Code style

TypeScript strict. camelCase vars/methods, PascalCase classes/interfaces. `unknown` in catch
blocks + `toErrorMessage(err)` from `@/shared/error-utils`. JSDoc for public API only.
Small, focused changes.

`eslint.config.js` encodes what is a rule here and what is a deliberate shape — read the
comments before turning something off. CI fails on any ESLint **error**; warnings are a
backlog, not a gate. Prettier is configured (`.prettierrc.json`) but **not enforced**: the
tree has never been formatted, so `npm run format` would rewrite ~440 files at once. Format
what you touch, or make that sweep a commit of its own.

## Git

**Nothing gates a local commit or the push — the gate is on the merge.** Commit freely on a
branch; each retry attempt is its own commit so the loop stays readable. Then **push, open the
pull request, and gate that sha**, in that order: the worker *fetches* the commit it judges, so
"no push without an attestation" and "no attestation without a push" cannot both hold.
`.claude/hooks/pre-push-gate.sh` refuses one thing only — a direct push to `main`.

**`main` is governed by one ruleset that binds the owner too** (empty bypass list): PR required
(0 approvals — solo maintainer), `typecheck + tests` **and** `bench/gate` required, no
force-push, no deletion. CI cannot hold the locked credentials, so the worker publishes its
verdict as the `bench/gate` commit status — a PR cannot merge on CI alone.

The branch is deliberately not required to be up to date with `main` — `doc/bench-worker.md`
§ The gate base.

**`main` has a merge queue** — `gh pr merge <N> --merge` **enqueues**; it does not merge.
**Never add `--delete-branch`**. Judge on the exit code and the PR state, never on stderr
text — the whole trap, both directions, in [bench-worker.md §12](doc/bench-worker.md).

`gh pr edit` and the bare `gh pr view` / `gh issue view` fail on this repository (Projects
classic deprecation) and apply nothing — use `--json` or REST; `doc/kanban-workflow.md` § gh
CLI recipes.

An update is finished only after `npm run finish` (refuses unless the PR is MERGED; retires
the worktree) — `doc/bench-worker.md` §5.

Branches: `feature/`, `fix/`, `refactor/`, `doc/` + description — or the session worktree
branch (`claude-<user>/…`); the hook accepts any branch but `main`.
Commits: `type: short summary` — `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`.

## Transparency

When posting a change summary, an end report, or a plan, list the skills used to produce it, on one line.
