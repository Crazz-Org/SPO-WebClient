# The Bench Worker — single owner of the live test bench

**Status:** Adopted 2026-08-22 · Companion to [E2E-POLICY.md](E2E-POLICY.md) (the rules)
**Code:** `src/e2e/bench/` · **Client scripts:** `scripts/bench-*.sh` · **Hooks:** `.claude/hooks/pre-push-gate.sh`, `.claude/hooks/bench-port-guard.sh`

## 1. Why

The live layer (L2 drive, L3 browser smoke) is **not parallelizable**: it shares three
unique mutable resources — the gateway port (8080), the LOCKED account `SPO_test3`, and
the Helartia world state on planitia. Two sessions testing at once produce mutually
polluted evidence: a `FIVEMODELSERVER/Survival` line can no longer be attributed to a run.
Port-shifting (`PORT=8081`) never solved this — two gateways still write into the same
world with the same account — and it leaked orphaned gateways.

**The principle: bench ownership is never transferred.** Sessions do not start gateways,
do not kill processes, do not hold locks. They deposit a request and wait for a report.
Serialization is a mechanical consequence — one worker, one job at a time — not a
discipline rule.

## 2. The pieces

```
~/.spo-bench/                       fixed, ext4, outside every worktree, never /mnt/c
├── worker.json                     pid, repo, port — who the worker is
├── heartbeat                       touched every 5 s; its mtime IS the sign of life
├── spool/job-<epochms>-<rand>.json deposits; filename order = queue order
├── running/                        the one claimed job
├── done/<jobid>.json + .log        reports; only the .log is purged (24 h) — see jobs.jsonl
├── jobs.jsonl                      one durable line per finished job, forever (§B4.2 below)
├── verdicts/<sha>.json             per-commit attestations — what `bench/gate` publishes
├── cache/                          the ~570-file asset mirror, ONE copy for the machine
├── nightly/checkout + latest.json  the worker's own `main` clone, and last night's verdict
├── nightly/manual-request.json     a maintainer's request for a proof — the worker's to serve
├── nightly/manual/<id>.json        every manual outcome, attested or not; never deleted
├── ref/checkout                    the checkout a fetched commit is gated in
└── world/                          world-lock.json — finally GLOBAL
```

`cache/` is the mirror of `update.starpeaceonline.com/five/client/cache/`. It used to sit
at `<worktree>/cache`, so every new branch downloaded all 570 files again — the same bytes,
on the same machine, on the bench's exclusive time (11 of 47 jobs in the #130 measurement).
It is bench-wide because those files are a copy of a remote tree, not build output: no
worktree can hold a version of them that differs from another's. The one-writer-at-a-time
this assumes is the job queue itself. Nothing purges it; a stale mirror is repaired by the
next sync, and `rm -rf ~/.spo-bench/cache` forces a full re-prime.

Every hand-off is a same-filesystem `rename(2)`: atomic, no locks needed, because exactly
one process (the worker) consumes the spool.

`jobs.jsonl` (action B4.2, SPO-Pipeline/doc/bench-plan-derived-2026-09-02.md row 4.2) is
the durable answer to "what happened to this job", for every verdict — including DIRTY,
ENVIRONMENT, ABANDONED and INTERRUPTED, which `verdicts/` never records at all and `done/`
used to lose the moment its 24 h purge ran. `Spool.writeReport` (`src/e2e/bench/job.ts`)
appends one JSON line per finished job — never rewritten, never reordered, a single
`fs.appendFileSync` so a crash mid-write cannot corrupt an earlier line — and `purgeDone`
now deletes only the `.log`; the `.json` and this file are left alone. It is bookkeeping,
not evidence: an unwritable `jobs.jsonl` cannot fail or even taint the job it was trying to
record (same rule as `gate-attempts.json`, B4.3), and the failure surfaces through the
worker's own log rather than vanishing silently. No rotation: see `appendJobsLog`'s doc
comment in `job.ts` for the measured line size and growth rate.

| Piece | File | Role |
|---|---|---|
| Worker | `src/e2e/bench/worker.ts` | the permanent loop — claims, builds, drives, reports |
| Client | `src/e2e/bench/cli.ts` | `submit` / `wait` / `status` (wrapped by `scripts/bench-*.sh`) |
| Fingerprint | `src/e2e/bench/fingerprint.ts` | moving-target detector (HEAD + diff + status + untracked content) |
| Merge queue | `src/e2e/bench/merge-queue.ts` | discovery, priority and the tree dedup for queue entries (§12) |
| Gateway | `src/e2e/bench/gateway.ts` | clean-port guarantee, per-job gateway start/stop |
| Attestations | `src/e2e/bench/verdict.ts` | `verdicts/<sha>.json` + `bench/gate` GitHub commit status |
| Supervision | `scripts/bench-install.sh` | systemd --user unit, `Restart=always`, linger |
| Nightly | `src/e2e/bench/nightly.ts` | the schedule, the `main` checkout, `nightly/latest.json`, and the manual request a maintainer may leave for it (§8) |
| Owner lease | `src/e2e/bench/owner.ts` | the cross-host exclusion — the `BENCH_OWNER` repository variable (§9) |
| Checkout | `src/e2e/bench/checkout.ts` | a worker-owned clone brought to any ref, with a conditional `npm ci` (§10) |
| CI proof | `src/e2e/bench/ci-proof.ts` | whether CI already proved a sha's static half (§11) |

## 3. A job's life

1. **Deposit** (`npm run gate` / `test:live` / `dev`): the client checks the worker is
   alive (pid + heartbeat < 20 s) — **a dead worker is exit 3, immediately, at deposit
   time**. It fingerprints the tree, writes the request, returns the job id. `--wait`
   folds into the wait loop so the whole round trip is one background command —
   a queued session spends **zero tokens** waiting.
2. **Claim**: the worker takes the oldest deposit. If the depositing session's pid is
   dead → report `ABANDONED`, nothing runs, the queue cleans itself.
3. **Owner lease** (§9): the worker must hold `BENCH_OWNER`, or the job is `ENVIRONMENT`
   and **nothing runs** — checked before the port is cleared, because clearing it SIGKILLs
   whatever holds 8080 and on a second host that would be the other worker's gateway.
   While the lease has never been established on this machine the check passes, so a host
   that cannot reach GitHub behaves exactly as it did before the lease existed.
4. **Clean bench**: kill anything on 8080 (safe because no session may start a gateway
   there — enforced by `.claude/hooks/bench-port-guard.sh`, §7), verify the port is free.
5. **Fingerprint `atStart`**, compare with `atSubmit`. A **gate on a dirty tree is `DIRTY`**
   — nothing runs, nothing is attested: the attestation names a sha, so the tested tree
   must be exactly that commit (the client already refuses it at deposit, exit 2; the
   worker enforces it again). Then `git fetch origin main` (best-effort)
   so verify-gate routes the diff against the real `origin/main`, not a lagging local one.
6. **Build**: in the job's worktree, always — a stale `dist/` runs yesterday's code and
   produces a silently wrong PASS. But only what the body will actually load, because the
   bench is serialised and a build nobody reads is time every other session waits for:

   | Type | Built | Why not more |
   |---|---|---|
   | `ref` | `build:server` | the L2 drive is a headless `ws` client — no page, no bundle; the gateway starts without the Vite manifest (`server.ts:90-98`), and `verify-gate.js` compiles the e2e driver itself |
   | `live` | `build:server` + `build:e2e` | this branch runs `dist/e2e/run.js` directly, so it compiles it rather than hoping an earlier job left one behind |
   | `lease` | `build` (everything) | it serves a real browser — the client bundle and the terrain-test are the point |
| `nightly` | `build:server` + `build:e2e` | it *is* a live drive; only the target differs (§8) |

   The full build also used to double as a "does the client still compile" check. CI runs
   exactly that build on every pull request, so the proof moved rather than disappeared.
   A failing step is a `FAIL` naming the step, before any gateway starts.
7. **Gateway** from that worktree, with `SPO_CACHE_DIR=~/.spo-bench/cache` so it reads the
   machine-wide asset mirror instead of priming an empty one in the worktree; wait for
   `phase=ready`.
8. **Static witness** (`ref` only): ask GitHub whether `typecheck + tests` concluded
   **success for this exact sha**. On a recorded success, `--skip-static --static-from=ci`
   is passed to verify-gate and the ~113 s of typecheck + lint + Jest is not replayed on the
   exclusive bench; the report carries `staticProof.used`. Anything else — no run yet, still
   running, failed, cancelled, GitHub unreachable, an answer that cannot be parsed — replays
   the static stage in full and says why in the job log. **Only stage 1 is ever skipped**:
   `build:e2e`, the routing, the President exclusion and the live drive are what the bench
   alone can do, and they always run. See `src/e2e/bench/ci-proof.ts` and §11.
9. **Body**, with `E2E_WORLD_STATE_DIR=~/.spo-bench/world` and
   `SPO_CACHE_DIR=~/.spo-bench/cache` — the same two variables the gateway was started
   with at step 6, so a replayed Jest suite reads the assets the gateway served:
   - `ref` → `node scripts/verify-gate.js` (static, President exclusion, routing, live
     drive) — **one exit code per outcome**: 0 `PASS` · 1 `FAIL` · 2 `BLOCKED` ·
     3 `ENVIRONMENT`. Anything else is read as `FAIL`. The gate used to return 0 or 1 and
     nothing else, so a live stage that aborted arrived here as `FAIL` — and step 12 then
     attested a sha whose code was never judged. The two tables must move together:
     `EXIT` in `scripts/verify-gate.js`, `GATE_EXIT_VERDICT` in `src/e2e/bench/worker.ts`
   - `live`, `nightly` → `node dist/e2e/run.js [flags]`
   - `lease` → report `LEASED` **immediately** (that is what the waiting session unblocks
     on), then hold the gateway until the lease expires or the session releases it
     (`npm run dev:release` drops a marker the hold loop watches). No pid watching: the
     waiting CLI exits the moment the report lands, and a session has no longer-lived pid
     to offer — so a session killed mid-lease simply lets the lease run to its expiry
     (30 min default, 120 max); the worker tears the gateway down then, never later
10. **Teardown**: stop the gateway, re-verify 8080 is free. **No gateway survives between
   two jobs.**
11. **Fingerprint `atEnd`**; if the three differ → verdict **`STALE`, never PASS** — the
   report says so plainly and carries all three fingerprints.
12. **Report** to `done/` (and, in the same `writeReport` call, one durable line to
    `jobs.jsonl` — see above), **attestation** to `verdicts/<sha>.json` (gate jobs) or
    `nightly/latest.json` (nightly jobs — never both, §8), running slot released, next job.
    **Three verdicts attest nothing** — `NON_ATTESTING` in `src/e2e/bench/worker.ts`:
    `DIRTY` (the tree is not the sha), `ENVIRONMENT` (fetch, owner lease, gateway or live
    stage refused before the change could be judged) and `ABANDONED` (the worktree was
    gone). None of them read a line of the code, so none may write a file the merge rule
    trusts — and `merge-queue.ts` treats any existing attestation as *already answered*, so
    a wrong one is never revisited.

Verdicts: `PASS` (possibly with capability exceptions listed — §7 of the policy) · `FAIL` ·
`BLOCKED` (the live stage was refused before running: dirty world or another run already
in flight) · `ENVIRONMENT` (does not consume an attempt) · `STALE` · `DIRTY` (gate on
uncommitted changes — commit first) · `ABANDONED` ·
`INTERRUPTED` (worker died mid-job — check the world lock before resubmitting) · `LEASED`.

A second deposit from a worktree whose first job is still queued is **refused, naming the
queued job** (exit 2) — what a retry-after-edit wants is the newest tree tested once.

## 4. Supervision — the covered failure

systemd (`Restart=always`, `RestartSec=2`, linger enabled) revives a dead worker; the
spool survives; `running/` jobs are reported `INTERRUPTED` at startup. What systemd cannot
see — a worker wedged in a crash loop, deposits silently piling up — is caught by the
**heartbeat**: submitters check its mtime at deposit and during waits, and fail loudly
(`WORKER DOWN`, exit 3) the moment it goes stale. The failure mode "requests accumulate
and nobody notices" is structurally announced at the deposit.

```bash
scripts/bench-install.sh                       # one-time (or after worker changes): build, unit, enable, linger
systemctl --user status spo-bench-worker       # why it stopped
systemctl --user restart spo-bench-worker      # bring it back; the queue resumes
npm run bench:status                           # liveness + queue, from any worktree
```

## 5. The push chain — Claude Code Desktop → this PC → GitHub

```
session edits worktree
  → git commit              a sha is what gets attested
  → git push                hook refuses `main` and nothing else now
  → GitHub CI               typecheck + tests on that sha — the static authority (§11)
  → npm run gate            refuses if HEAD is not on origin, else deposits a `ref` job
  → bench job               worker FETCHES the sha into its own checkout, builds, drives it
                            live, attests, publishes bench/gate on it
  → merge                   ruleset: PR, CI green AND bench/gate green, no bypass;
                            GitHub deletes the remote branch
  → npm run finish          main ff'd, refs pruned, worker reinstalled if its sources changed,
                            worktree RETIRED (removed by the next run, once no session is in
                            it) — the end state is main alone. `--now` removes it at once.
  → release.yml             on the push to main: computes the version from the last v* tag
                            and the commits since it, builds, tags, publishes the GitHub
                            Release — never create v* tags by hand
```

Only the worker writes attestations. A session cannot unblock its own push, and a PR
cannot merge on CI alone — the live evidence must exist even if the local hook were
sidestepped.

**An update is finished only after `npm run finish`.** It refuses unless the PR is MERGED, then
fast-forwards `~/SPO-WebClient`, prunes stale refs, reinstalls the bench worker if the merge
touched `src/e2e/bench/` or `scripts/bench-*`, and **retires** this worktree — it stays on disk
while a session stands in it, and the next run reaps it (it also heals worktrees a previous
session forgot). **A session may keep working after `finish`**: a process standing anywhere inside the worktree
protects it, and that is the only thing that does. A per-session heartbeat was the second
protection until #441 removed it — its writer had gone with the pilot hooks in #425, so it had
been abstaining on every worktree since. Keep a shell inside the tree if you want the ground to
stay. `npm run finish -- --now` removes immediately, for a human on the way out.

### The gate base

Every attestation records `baseMain`: the `origin/main` sha the run was judged against,
read in the worktree right after the worker's `git fetch origin main`.

It exists because the ruleset no longer requires a branch to be **up to date** with
`main`. That rule was correct and unaffordable: the bench is serialised and every merge
invalidated every other session's gate, so N parallel sessions cost N² bench runs — each
one a build plus a full live drive, for a merge that changed nothing they touched
([#134](https://github.com/Crazz-Org/SPO-WebClient/issues/134)).

What replaces it is not a weaker rule but a **visible** one. `baseMain` says which `main`
the live evidence stands on, and three surfaces read it back:

| Surface | Shows |
|---|---|
| `verdicts/<sha>.json` | `baseMain` — the machine-readable field |
| the `bench/gate` commit status | `PASS — base <sha8> — job <id>`, readable on the PR at merge time |
| `.claude/hooks/pre-push-gate.sh` | a `NOTE:` naming both shas when `origin/main` has moved past the base — it **allows** the push |

The honest trade: a branch can now merge while `main` has moved past its base, and nothing
refuses it. What the gate proved is `merge(branch, baseMain)`, not `merge(branch,
main-as-of-the-merge)`. Judgement replaces the rule — if the incoming `main` touches the
same ground, merge `origin/main` in and re-gate; the new sha needs its own attestation
either way. A base that cannot be resolved (offline, no remote ref) is recorded as absent,
never as matching.

**Gating the merged tree, not the branch (#183).** `prepareCheckout` (`src/e2e/bench/
checkout.ts`) narrows that gap itself, for every `ref` job — not only a merge-queue entry.
After resetting the shared checkout to the deposited ref, the worker checks one thing:
`git merge-base --is-ancestor origin/main HEAD`. That is the **fast path** — the branch
already contains everything on `main`, so nothing more happens: no merge commit, no risk
of a conflict, ~35 s of git plumbing on top of the reset. It is the common case, because it
is true whenever nothing has landed on `main` since the branch forked.

When it is *not* an ancestor, the worker merges `origin/main` into the checkout itself —
`git -c user.name="SPO Bench" -c user.email="bench@local" merge --no-edit origin/main` —
before anything is built. What the gate then judges is the tree the branch would actually
produce on landing, not the branch read in isolation. Three things follow from a real
merge having happened:

- **The static stage cannot trust a CI record for the pre-merge sha.** CI proved the
  branch alone; it never saw the merged tree. The worker forces stage 1 to replay rather
  than ask a question whose answer nobody has recorded yet — `staticProof.why` says so.
- **A conflict is a fact about the code, not the worker.** `merge --abort` runs
  immediately — the shared checkout is left exactly as it was found, clean, ready for the
  next job — and the verdict is `FAIL`, never `ENVIRONMENT`, with the base sha it could not
  merge with in the detail string.
- **The attestation still keys on the sha that was deposited, never the merge commit.**
  `prepareCheckout` can move `HEAD` to a commit nobody ever pushed; the push hook and the
  GitHub commit status both look up `request.fingerprint.head`, fixed at deposit time, so
  that is what `writeVerdictIn` uses — not whatever `git rev-parse HEAD` answers after the
  merge.

A merged attestation carries `merged: true` and `mergedBase` (the sha that was merged in);
the `bench/gate` description renders `merged base <sha8>` in place of the plain
`base <sha8>` so a reader can tell the two situations apart at a glance.

### What a session reads to know the verdict

**The exit code is the interface. The printed report is not.**

`npm run gate`, `npm run test:live` and `scripts/bench-wait.sh` all end in the same client
(`src/e2e/bench/cli.ts`) and return the same codes:

| exit | means | what the session does |
|---|---|---|
| 0 | `PASS` — or `LEASED`, for `npm run dev` | push |
| 1 | the job ran and the verdict is not passing (`FAIL`, `BLOCKED`, `STALE`, `ABANDONED`, `INTERRUPTED`, `ENVIRONMENT`) | read the report, fix, retry — 3 attempts, each naming a different root cause. `ENVIRONMENT` and `ABANDONED` are the exceptions: they judged nothing, so they cost no attempt and leave `verdicts/<sha>.json` exactly as they found it — resubmit |
| 2 | refused at deposit: a gate on a **dirty tree**, or a duplicate of a job already queued | commit (an attestation names a sha, so the tested tree must BE that sha), then re-deposit |
| 3 | **worker down** — nothing was queued | `systemctl --user restart spo-bench-worker`, then re-deposit |
| 4 | the wait timed out; the job may still be queued or running | `npm run bench:status` before assuming anything |

The two machine-readable surfaces are that exit code and `~/.spo-bench/verdicts/<sha>.json`
(the file the push hook itself reads). **Never parse or grep the `=== bench job … ===`
report**: it is formatted for a human, its wording is not a contract, and a session has
already mistaken a readable line for an API and drawn the wrong verdict from it. A `grep`
that finds nothing is indistinguishable from a `grep` that ran against a changed heading —
the exit code cannot fail that way.

The same reflex applies one level down, inside the live drive: a mutation is proven by the
`FIVEMODELSERVER/Survival` log line, never by a `success: true` in a response
(E2E-POLICY.md, `OB-28`).

#### The session-side rules

**The live bench has one owner: the bench worker.** Many sessions run on this machine, but
port 8080, the LOCKED accounts and the Helartia world state belong to one permanent process
(systemd --user unit `spo-bench-worker`, installed by `scripts/bench-install.sh`). Sessions
never start a gateway, never kill a process, never hold a lock: they deposit a job and wait for
the report — one background command, zero tokens. **Background it with the tool's own
`run_in_background`, never with a trailing `&`**: the shell then reports the fork rather
than the run, so the exit code is 0 whatever happened and the verdict is destroyed before
anyone reads it. The redirect to a log file is fine and needs no permission; only the
ampersand does. Jobs run one at a time, oldest first,
each in the depositing session's worktree, which the worker builds. `npm run dev:local` is the
conscious exception, for debugging only — its results attest nothing.
`.claude/hooks/bench-port-guard.sh` refuses every other route to the port and to the live
world, naming the sanctioned form in the refusal.

**Read the verdict from the exit code, never from the printed report** — 0 PASS · 1 verdict not
passing · 2 refused at deposit (dirty tree) · 3 worker down · 4 wait timed out. The
machine-readable surfaces are that code and `~/.spo-bench/verdicts/<sha>.json`. **And a
pipeline's exit code is the last stage's**, so never pipe a command whose exit code is the
verdict: `npm test | tail -20` reports *tail*, and has already been read here as a green suite
that had failed. Redirect to a file, capture the code, then filter the file. **A trailing `&`
loses it the same way** — the shell reports the fork, so the code is 0 whatever happened;
background with the tool's own `run_in_background`, keeping the redirect, which is fine on its
own. So does `out=$(npm test)`, which keeps the text and drops the number.

**Dependabot PRs** ride the same chain through `npm run deps:gate`: it merges main in, installs
(`npm ci` *in the PR's worktree* — a worktree has no `node_modules` of its own and would
otherwise build against the main checkout's old packages), gates, pushes and auto-merges
them one by one; a lockfile change routes to spine + building-details.

**One-time GitHub setup (repo admin).** The chain is only deterministic if nobody can
merge around it, so the rule must bind the admin too. On `main`:

- *Require status checks to pass* → **`typecheck + tests`** (CI) **and `bench/gate`**,
  **without** *require branches to be up to date* — that box is deliberately off, and
  `baseMain` (§ The gate base) is what replaced it. Turning it back on restores the N²
  re-gate cost. A branch updated after its gate (merge `origin/main` in — never a force
  push) gets a new sha, which needs a new attestation.
- *Require a pull request before merging* with **0 required approvals** — a single
  maintainer cannot approve their own PR, and a 1-approval rule only teaches the admin to
  use the bypass button, which also skips `bench/gate`.
- **No bypass**: *Do not allow bypassing the above settings* on a classic rule, or a ruleset
  with an empty bypass list. Either enforces against the owner; a rule the owner can skip
  attests nothing.

The worker publishes through `gh`, which must be authenticated for the user running the
unit (it is). Publishing cannot be disabled: a gate that ran but left no trace on GitHub
is exactly the silent pass this bench exists to prevent.

## 6. Rate limits (2026-08-22, developer decision; live-run limiter removed 2026-09-03)

The bench queue is the real throttle — one job at a time — so the gateway's own numeric
quotas got out of the way for the test phase; the servers hold this easily:

| Knob | Was | Is |
|---|---|---|
| gateway auth attempts / min / IP (`server.ts`) | 10 | 1000 |
| gateway proxy-image requests / min / IP | 60 | 1000 |
| gateway concurrent WS connections / IP | 5 | 1000 |

The mechanisms remain (env knobs, `production-config.ts` readout at boot) — tighten before
any public deployment.

The e2e layer's own live-run rate limiter — `checkRateLimit` in `src/e2e/world-lock.ts`,
a minimum interval between runs plus a daily cap — was **deleted**, not tuned, on
2026-09-03 (B3.5). Its config defaults (`minIntervalMinutes: 0`, `maxRunsPerDay: 1000`)
had stood since 2026-08-22, so neither guard could ever fire in production, and the threat
it named in its own error message — "keep a retry loop from becoming a login storm" — was
never `planitia`'s threat model: it is an MMO world built for many concurrent players, and
the worker's single-flight queue (§1) is bench policy (one owner, one job at a time), not
protection the world needs. `recordRun`, which existed only to feed that limiter, went with
it — but `~/.spo-bench/world/run-history.json`, the file it wrote, did **not**: nothing
else read that file, but nothing sweeps it either, so it is left behind on disk, inert.
It stops growing at whatever it held on 2026-09-03 and stays there indefinitely, looking
like a live artifact while recording nothing further. It was the only ledger of "a live
run happened at time T on branch B"; nothing replaces that record.

## 7. The conscious exceptions

- `npm run dev:local` — build and run a gateway yourself, for interactive debugging. It
  picks the first free port from 8081 up and **refuses 8080** (`scripts/dev-local.sh`);
  `PORT=<n>` chooses. Its behaviour attests nothing.
- `npm run gate:local` — the static gate without the worker; static-only by default, the
  live stage needs `--live`, which only the worker passes.
  Evidence for reading; the push hook does not accept it.

`.claude/hooks/bench-port-guard.sh` makes the boundary mechanical rather than advisory. It
refuses, before the command runs:

| Refused | Because | Sanctioned form |
|---------|---------|-----------------|
| `npm start`, `node dist/server/server.js`, any `PORT=8080 …`, `env PORT=8080 …`, `nohup node dist/server/server.js`, `bash -c '…'`/`sh -c "…"` wrapping any of the above, `npm --prefix … start` | the default port *is* the bench port (`src/shared/config.ts:23`), and step 3 of a job SIGKILLs whatever it finds there — wrapping the command in `env`, `nohup`, a shell `-c`, or an extra `npm` flag does not change what actually binds the port | `npm run dev` (a lease) or `npm run dev:local` |
| `npm run test:live:local`, `node dist/e2e/run.js`, `node scripts/verify-gate.js --live`, `npm run gate:local -- --live` | they use the LOCKED accounts and mutate Helartia with no world lock — a concurrent job lands in the same town; the last two are the explicit `--live` opt-in outside the worker | `npm run test:live`, `npm run gate` |

The escape hatch is deliberately awkward and human-only: prefix the command with
`SPO_BENCH_PORT_OVERRIDE=i-own-the-bench`. A session must not reach for it — if the bench
is in the way, ask the worker for it with `npm run dev` instead of taking it.

Step 3's "safe — only the worker starts gateways there" was an assumption held up by a
paragraph in CLAUDE.md. It had already been broken: a session verifying its own change
took 8080, and a listener the worker cannot attribute blocks *every* session's gate until
a human frees the port. The hook is what makes the assumption true.

## 8. The nightly proof of `main`

Every job in §3 proves a **branch**, judged against the `main` it was based on (§ The gate
base). Nothing ever drove `main` itself. So two branches that each pass alone and break
together land unchallenged — each piece was proven, the mixture never was — and the
regression surfaces days later, under a session working ground it does not own, which then
spends its three gate attempts on somebody else's defect. The cost is the misattribution,
not the failure.

**One live drive of `origin/main` a night, deposited by the worker itself.**

| Decision | Answer | Why |
|---|---|---|
| Where it runs | `~/.spo-bench/nightly/checkout` — a clone the worker owns, refreshed `fetch → reset --hard origin/main → clean -fd → npm ci` | Not the worker's own repo: a job builds its worktree, and the worker executes `dist/e2e/bench/worker.js` *from* that repo — building `main` there overwrites the running worker mid-flight. Not a `git worktree` of it either: `scripts/finish.sh` scans and reaps worktrees on its own schedule. |
| How it is scheduled | The worker's idle branch (`worker.ts`, `workerLoop`), inside a window of **02:00–05:59 UTC**, at most one per **20 h** | No second scheduler racing the first for a serialised resource; GitHub Actions cannot reach this machine at all. UTC, not local time, so the window is one number everywhere. |
| What "idle" means | It is a normal spool job, deposited only when the queue came back **empty** | Serialization, the `done/` report, the `.log`, `bench:status`, `INTERRUPTED` recovery and the 24 h purge all come for free. A session that deposits *during* the nightly simply queues behind it — the nightly is never aborted, and never starts while anyone waits. |
| Who may deposit one | The worker alone. A human may **request** one (`npm run bench:nightly-request`), and the worker still deposits it from its idle branch | A session asking for one would be asking for the bench outside the queue's discipline. `cli.ts` still does not accept `--type=nightly`; the request is a marker, not a deposit. |
| Manual proof | `npm run bench:nightly-request -- --reason="…"` writes `nightly/manual-request.json`. The worker serves it from the same idle branch: **independent of the 20 h slot**, but **counted against the 15-minute** `NIGHTLY_MOVE_RATE_LIMIT_MS`, and it replaces `latest.json` **only when it attests** | For the case the schedule cannot answer: a nightly that FAILs for a reason that is not the code (2026-09-13, twelve `connect ETIMEDOUT` lines) sticks to the tip until somebody pushes, and parks every card meanwhile. Independent of the slot because re-measuring one sha must not cancel that night's window run; counted against the rate limit because it **is** a live drive. Attest-only because a manual run that broke on the environment measured nothing — clearing a genuine red on the strength of a non-measurement is worse than the red. |
| What it attests | **Nothing.** No `verdicts/<sha>.json` | That file means a *gate* ran — static stage, President exclusion, verify-gate routing — and this is a bare live drive. It would also hand `publishPendingStatuses` a `bench/gate` status to post on `main`'s own sha, a context branch protection reads, and the push hook matches an attestation to the pushing worktree, which this checkout never is. |

**The published surface** is `~/.spo-bench/nightly/latest.json`, written tmp-then-rename:

```json
{ "jobId": "job-…", "sha": "<the main commit driven>", "verdict": "PASS",
  "submittedAt": "…", "finishedAt": "…", "detail": "live drive exited 0",
  "logFile": "/home/…/.spo-bench/done/job-….log",
  "trigger": "scheduled | manual",        // absent ≡ scheduled
  "scheduledSubmittedAt": "…",            // absent ≡ scheduled: use submittedAt
  "requestedBy": { "user": "…", "host": "…", "tty": "…",
                   "via": "bench-cli | spo", "reason": "…", "requestedAt": "…" },
  "supersedes": { "jobId": "…", "sha": "…", "verdict": "FAIL",
                  "trigger": "scheduled", "finishedAt": "…" } }
```

`submittedAt` is the **deposit** time, not the start: it is what the 20 h gap is measured
from, so a night that queued behind a long job cannot buy itself a second slot. A failure to
refresh the checkout at all is recorded as `ENVIRONMENT` with the failing step named — which
is also what stops the idle loop retrying every two seconds until the window closes.

The last four fields are the manual path, and all four are **absent on every record written
before it existed** — which is exactly what makes them backward-compatible. `trigger` absent
means `scheduled`. `scheduledSubmittedAt` is the deposit time of the last *scheduled* run and
is what the 20 h gap is really measured from; a manual write carries the previous one forward
rather than resetting it, and absent it `submittedAt` reproduces the old arithmetic exactly.
`requestedBy` and `supersedes` appear only on a record a manual run published — `supersedes`
summarising the record it replaced, so a green that arrived by request still says what red it
displaced.

**Asking for one.** `npm run bench:nightly-request -- --reason="…"` reads `origin/main`'s real
tip with `git ls-remote`, prints what is on file for it, and makes the human type the tip's
first 8 characters back before it writes anything. It refuses inside a Claude Code session
(`CLAUDECODE`) and refuses without a terminal, both exit 5, both before any write: deciding a
red is not the code is a maintainer's judgement, not a session's — see
[kanban-workflow.md § While `main` is red](kanban-workflow.md). It deposits nothing itself.

**A manual run that did not measure the sha publishes nothing.** `ENVIRONMENT`, `INTERRUPTED`,
`STALE`, `BLOCKED`, and a run whose tip moved between the confirmation and the refresh all
leave `latest.json` **byte-identical**. Every manual outcome is recorded regardless, in
`nightly/manual/<id>.json`, with `attested` saying which kind it was and `outcome` naming the
ones where no job ran at all (`already-green`, `prepare-failed`, `superseded`). The worker
never deletes those.

**Reading it** is the orchestrator's first move on a task, and the rule that follows — repair-only dispatch, no
`origin/main` merges while red — is [kanban-workflow.md § While `main` is red](kanban-workflow.md).
`main` counts as red only while the failing `sha` is *still* `origin/main`; `ENVIRONMENT` and
`INTERRUPTED` are not red, because the run learned nothing about `main` either way.

**The mapping, and its discriminator.** `dist/e2e/run.js`'s exit code is read through
`GATE_EXIT_VERDICT` (`worker.ts`): a night refused for a dirty world lock (exit 2) reads
`BLOCKED`, a pre-flight abort (exit 3) reads `ENVIRONMENT`. What stayed wrong was the fourth
case — a drive that reached the flows and failed them exits 1, and that read `FAIL` whether the
code was broken or the game server simply was not answering from this host. `main` then read red
for a failure that was not the code.

A `FAIL` from a `live` or `nightly` drive is now asked one further question, and only that one:
an **independent reachability probe** (`src/e2e/bench/reachability.ts`) opens a TCP connection and
closes it without writing a byte — no login, no RDO frame, nothing the world sees as traffic.

It dials **both halves of the game server**, in order, because a drive needs both:

1. the **directory front door** the gateway is configured with (`RDO_DIR_HOST`, port 1111 —
   `src/shared/config.ts`). It does not answer → that is the outage, and nothing downstream
   could have run anyway.
2. the **world server** the directory hands back at runtime (`158.69.153.134:8000` on
   2026-09-13). Its address is unknown to a process that never logged in, so the probe reads it
   out of the drive's own log: Node writes a failed connect as `connect ETIMEDOUT <ip>:<port>`,
   which names the exact endpoint. Every distinct endpoint the log names that way is re-dialled
   after the drive is over, up to `MAX_LOG_ENDPOINTS`.

Either dial refused or timed out → the verdict is rewritten `ENVIRONMENT` and `detail` names that
endpoint and says the probe failed, so `nightly-check.sh` reads UNKNOWN instead of RED and no
session is handed somebody else's outage as a repair. Every dial answered → the `FAIL` stands
untouched: a connect failure inside the flows against a server that is up right now IS a fact
about the code. A probe that could not be run at all is not an answer either, and neither is a
drive log that cannot be read — the `FAIL` stands in both cases, with the reason in `detail`.

The discriminator is deliberately outside the drive: the drive's own connect attempt cannot tell
"the server is down" from "this change broke the login path", because both arrive as the same
refused socket. Re-dialling *after* the fact is what separates them. Two limits remain, by
construction — a drive that never got far enough to log an address leaves only the front door to
judge by, and a server that comes back up between the drive and the probe reads `FAIL`.
`detail` and `logFile` are what a human reads for both.

## 9. The owner lease — one live bench across machines

**Status:** stage A of [#158](https://github.com/Crazz-Org/SPO-WebClient/issues/158) · Code: `src/e2e/bench/owner.ts`

Everything in §1–§8 excludes two live drives *on this machine*: one systemd unit, one port,
one `bench-port-guard.sh`. That worked because the worker and its sessions share a
filesystem — a second worker had to be a second process here, and the port refused it.

#158 removes that coupling. Once the worker fetches its work from GitHub it is not
host-bound at all, and a worker started on a laptop would drive the **same** Helartia world
with the **same** LOCKED account. Two drives in one world is the one genuinely destructive
failure of the whole change: a `FIVEMODELSERVER/Survival` line stops being attributable,
which is the single property the bench exists to provide.

So the exclusion moved somewhere both hosts can see — the repository variable
**`BENCH_OWNER`**:

```json
{ "host": "bench-pc", "pid": 4242, "renewedAt": "…", "expiresAt": "…" }
```

**It is a lease, not a flag.** A bare "host X owns the bench" claim fails in the way that
matters most: a worker that dies holding it locks the live world for every host forever, and
only a human with API access could clear it. The claim therefore carries an expiry
(`OWNER_LEASE_MS`, 5 min), the holder renews it on its own timer (`OWNER_RENEW_PERIOD_MS`,
60 s — four failed renewals of grace, so a network blip never drops the bench), and anyone
may take it once it has lapsed. **A dead worker frees the bench by doing nothing.**

**Enforcement is earned, not configured.** A mechanism that failed closed from its first
minute would take down the bench on the machine where it works today, for a second host that
does not exist yet. So while the lease has never been established here — no permission, no
network, first ever run — the worker logs and proceeds exactly as before. Once it has held
the lease *even once*, the mechanism is known to work on this host, and losing it afterwards
means somebody else may hold it: from that moment a job that cannot hold it is refused.
There is no flag to set, and the direction that stops the bench is the one that needs
evidence.

**What a refusal looks like:** verdict `ENVIRONMENT`, nothing built, no gateway, **no
attestation**. `ENVIRONMENT` sits in `NON_ATTESTING` beside `DIRTY` and `ABANDONED` for a
reason — writing one would overwrite a perfectly good `PASS` for that sha, and publish
`bench/gate=error` on a commit that genuinely passed, on the strength of something that
never read a line of the code.

**The residual race, stated rather than hidden.** A repository variable has no
compare-and-swap: two workers observing an expired lease in the same instant can both write.
The mitigation is the handshake the kanban already uses for claiming a card — write, then
**re-read**, and keep the lease only if what comes back is ours — plus a jitter before
taking a lease that is not already ours. That shrinks the window to two writes landing
between one write and its read-back; it does not close it. Closing it needs a CAS primitive
(a `git push` of a ref is one), and that is worth building only if this proves insufficient
in practice.

## 10. Gating a commit the worker fetched — the `ref` job

**Status:** stage B of [#158](https://github.com/Crazz-Org/SPO-WebClient/issues/158) · Code: `src/e2e/bench/checkout.ts`

Everything above tests **the depositing session's worktree**. That is the coupling #158
removes: it is the only reason a session must live on this machine, and the reason GitHub's
merge queue is unusable — a speculative merge commit exists on GitHub and in nobody's
worktree.

The input was already a commit. A `gate` refuses a dirty tree, so the tree it tests *is*
HEAD; replacing the worktree with a fetch changes the **transport**, not what is proven.

```bash
node dist/e2e/bench/cli.js submit --type=ref --ref=<sha|branch> --wait
```

The worker clones once into `<bench>/ref/checkout`, then per job: `fetch --prune --force`,
then a reset to `<ref>` **resolved against the remote** — `--ref=main` resets to
`origin/main`, never to the checkout's own stale local `main`, and a sha, or a ref already
spelled `origin/…`, is used as given — `clean -fd`, a merge with `origin/main` unless
`<ref>` already contains it (§ The gate base, "Gating the merged tree, not the branch"), and
**`npm ci` only when the lockfile moved** — checked after the merge, since a merge can move
it. From there it is an ordinary gate — same `verify-gate.js`, same routing, same President
exclusion, same live drive.

Three things that are not obvious:

- **Why `npm ci` had to become conditional.** It is not a no-op: it deletes `node_modules`
  and reinstalls, every time. The nightly could afford that; a gate on the serialised bench
  cannot. The lockfile's hash is recorded beside the checkout after each install, and the
  install runs only on a mismatch — or when `node_modules` is simply absent. **Session
  worktrees never needed any of this**, and that is worth saying because it is invisible:
  they sit *inside* the main checkout, so Node's upward resolution finds its `node_modules`
  and every worktree silently borrows it. A fetched checkout has no parent to borrow from.
- **A ref job is exempt from the staleness rule**, and necessarily. The checkout is reset to
  the ref *after* the deposit, so the tree at deposit time is whatever the previous job left
  and never matches. That is not a moving target, it is the absence of one — a fetched
  commit cannot move. The `atStart`/`atEnd` half still runs, because a tree that changes
  mid-run is a real fault whatever caused it.
- **Its answer is kept apart.** While both paths run (stage B is explicitly *alongside*),
  the same sha gets two independent verdicts. They go to `ref/verdicts/` and publish as
  **`bench/ref-gate`** — a context the ruleset does not require. Writing into `verdicts/`
  would leave whichever finished last, destroying the comparison; publishing as `bench/gate`
  would put the new path behind the required check before it has earned it.

### Why every fetch carries a token

**Code:** `src/e2e/bench/git-auth.ts` · **Incident:** 2026-09-03 07:44:26Z–07:49:22Z

SPO-WebClient is a **public** repository. Git's HTTP transport tries anonymously first and
consults a credential helper only after the server answers `401`; GitHub answers `200` to
anonymous reads of a public repo. So `credential.https://github.com.helper = !gh auth
git-credential` — which is configured on this machine, and works — was **never invoked for
this repo**, and every fetch the bench had ever made went out unauthenticated.

Confirmed with `GIT_TRACE=1`: `gh auth git-credential` is spawned for the private
SPO-Pipeline and never for this one.

Anonymous traffic is throttled. On 2026-09-03 GitHub refused seven consecutive merge-queue
fetches of PR #643 between 07:44:26Z and 07:45:17Z, then the nightly's at 07:49:22Z, each
with `GitHub is temporarily limiting some unauthenticated downloads`. `main` went unproven
for the day.

Two things follow, in this order of importance:

1. **The token goes in the environment of every git call that leaves the machine** —
   `GIT_CONFIG_KEY_n=http.https://github.com/.extraheader`, the mechanism
   `actions/checkout` uses. Not in `argv`, where `ps` would show it; not in a config file,
   where it would be a credential at rest; and never in a log. Local calls (`rev-parse`,
   `reset`, `merge-base`) and `npm ci` get nothing — `NETWORK_SUBCOMMANDS` in `worker.ts`
   is the list, and it is pinned by a test.
2. **`clone` and `fetch` retry** — `NETWORK_RETRY_DELAYS_MS` in `checkout.ts`, two retries
   over about ten seconds. This is the lesser half and deliberately modest: an authenticated
   fetch is not subject to the limit that was hit, the bench is serialised so patience costs
   every other job, and waiting out a multi-minute outage is the caller's business, not this
   loop's. `reset` and `clean` never retry — they are local and deterministic, and a second
   run would only hide a real error.

   Every attempt is numbered **in the job log itself**, not just the worker's own journal:
   `--- git fetch: attempt n/3 ---` before the child runs, then either
   `git fetch: succeeded on attempt n/3` or, on exhaustion,
   `git fetch: failed after 3 attempts (last exit c)`. A retried success is distinguishable
   from a first-try one by reading `done/<id>.log` or `nightly/prepare.log` alone.

   The bound is sized from the corpus, not guessed: `done/` on 2026-09-04 held 7
   ENVIRONMENT jobs, all `git fetch failed while fetching …`, all one episode
   (07:44:26Z–07:49:22Z, a floor of 296 s with **no observed ceiling** — one episode, not
   seven independent samples). Surviving that floor would take ≥ 296 s of patience — 2.3×
   the 128 s median `ref` job on a serialised bench — for a cause the token above already
   removes, and which produced zero fetch failures and zero retries in the worker journal
   since. No bound sized from this corpus could honestly claim to survive "an episode", so
   `[2_000, 8_000]` is an **honest partial mitigation**, sized on the cost side (10 s ≈ 8 %
   of a median job) for the ordinary transient, not a throttle survivor.

   `worker.ts`'s separate `git fetch --quiet origin main` (the `origin/main` refresh before
   `verify-gate`, ~worker.ts:799) is deliberately **not** wrapped in this retry: its failure
   is already ignored (`worker.test.ts:691-696` pins a 128 exit as still `PASS`), so it has
   never produced an ENVIRONMENT and is not part of the corpus above; for `ref` jobs it is
   redundant since `prepareRef` just ran a retried fetch; for `live`/`lease` jobs a missed
   refresh only leaves `baseMain` naming a lagging local ref, a precision loss in the
   attestation, not a lost job.

If `gh auth token` produces nothing, the fetch is anonymous exactly as it was before and a
line says so. A missing token must never turn a job that would have worked into one that
fails.

### Retry mutation proof

Measured, not asserted: each mutant below was applied by hand to `runNetworkCommand` in
`checkout.ts`, `npx jest src/e2e/bench/checkout.test.ts --selectProjects unit` was run against
it, and the file was restored before the next mutant. Non-zero exit = killed. **6/8 killed**;
the two survivors are both expected and accepted, not gaps — the comment block over
`checkout.test.ts:501` carries this same table anchored to the tests that killed each mutant.

| # | mutant | result |
|---|---|---|
| M1 | delete the `succeeded on attempt` append | killed |
| M2 | start `attempt` at 0 | killed |
| M3 | `const attempts = delays.length` (denominator off by one) | killed |
| M4 | delete `await deps.sleep(delay)` | killed |
| M5 | return `code` right after the first non-zero exit (no retry) | killed |
| M6 | write `failed after ${attempt}` instead of `${attempts}` | **survived — equivalent mutant.** On exhaustion `attempt === attempts` always (the loop only reaches the failure branch on the last iteration), so the two interpolations produce the same string; no test can distinguish them without changing what exhaustion means. |
| M7 | append the success line unconditionally, before the exit-code check | killed |
| M8 | write the attempt marker after `runCommand` instead of before | **survived — known, accepted.** The ordering this guards (git's own stderr for an attempt lands under that attempt's marker) is a property of two real processes racing to write the same file; a fake `runCommand` in the harness has no stderr of its own to interleave, so no in-repo unit test can observe the difference. Verified instead by reading — the append happens before the `await`, so nothing else can run between them in Node's single-threaded event loop. |

### SSH remotes vs a credential store — recommendation

**Recommendation: neither. Keep HTTPS with the `extraheader` token above; propose no
operational change today.**

Facts read on this machine (read-only): all three live checkouts —
`/home/crazz/SPO-WebClient`, `~/.spo-bench/ref/checkout`, `~/.spo-bench/nightly/checkout` —
use `https://github.com/Crazz-Org/SPO-WebClient.git`; `~/.ssh` holds only
`authorized_keys` (no key pair, no `known_hosts`; `ssh -T git@github.com` fails host
verification); the global credential helper is `!/usr/bin/gh auth git-credential`; the
worker runs from `/home/crazz/SPO-WebClient` under systemd with `HOME=/home/crazz`.

- A **credential store** (`credential.helper store` / libsecret) is *ineffective* here, not
  merely undesirable: git only consults a helper after a `401`, and GitHub answers `200` to
  anonymous reads of a public repo — a stored token would never be sent. It would also put
  a plaintext credential at rest in `~/.git-credentials`, the exact thing the `extraheader`
  approach above was built to avoid.
- **SSH remotes** would work and would remove HTTP throttling entirely, but add a second
  credential to manage (a deploy key with its own rotation, outside `gh`), need a
  `known_hosts` entry the box does not have, and make the `extraheader` token inert — a
  silent no-op nobody would notice. The token path is live, authenticated, and has shown
  zero throttle refusals since it shipped. Switching transports now would be change without
  a measured problem.

If the maintainer still wants SSH as belt-and-braces, the exact commands — **proposed, not
run**, applied only by the maintainer with the worker stopped:

```bash
ssh-keygen -t ed25519 -C "spo-bench@$(hostname)" -f ~/.ssh/spo-bench -N ""
gh repo deploy-key add ~/.ssh/spo-bench.pub --repo Crazz-Org/SPO-WebClient --title spo-bench   # read-only deploy key
ssh-keyscan github.com >> ~/.ssh/known_hosts
printf 'Host github.com\n  IdentityFile ~/.ssh/spo-bench\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git -C ~/.spo-bench/ref/checkout remote set-url origin git@github.com:Crazz-Org/SPO-WebClient.git
git -C ~/.spo-bench/nightly/checkout remote set-url origin git@github.com:Crazz-Org/SPO-WebClient.git
git -C /home/crazz/SPO-WebClient remote set-url origin git@github.com:Crazz-Org/SPO-WebClient.git   # prepareCheckout clones from this remote's URL
git -C ~/.spo-bench/ref/checkout ls-remote origin HEAD   # verify before restarting the worker
```

Reversal: `remote set-url origin https://github.com/Crazz-Org/SPO-WebClient.git` on the
same three checkouts. On SSH, `NETWORK_SUBCOMMANDS`'s auth env is harmless but does
nothing.

## 11. The push chain after #158 stage C

**The gate tests a pushed commit.** A session commits, pushes, and asks the bench to gate the
sha:

```bash
git push -u origin <branch>
gh pr create ...            # do this BEFORE gating — see below
npm run gate                # refuses with exit 2 if HEAD is not on origin
```

⚠ **Open the pull request before gating.** Nothing refuses a gate without one, but `ci.yml`
triggers on `pull_request`: a branch with no PR has **no CI run for its sha**, so the worker
replays the entire Jest suite on the exclusive bench — ~50 s of two projects and many workers,
alongside the job's own gateway. That is the slowest path and the heaviest one; it has already
killed a gateway mid-job and cost a gate an `ENVIRONMENT`. With the PR open and CI concluded,
the static stage is skipped outright.

`npm run gate` (`scripts/bench-gate.sh`) checks the tree is clean and the sha is on origin,
then deposits a `ref` job. Everything after that is §10.

### What changed, and what did not

| | Before | After |
|---|---|---|
| Subject of the gate | the session's worktree | the pushed commit |
| Local suite run | `gate:precheck` ran typecheck + lint + the whole suite | not required; CI runs them on the sha |
| Static stage on the bench | replayed, unless a precheck receipt matched the tree | skipped when **CI proved this sha**, else replayed |
| `git push` | refused without a bench attestation for HEAD | allowed on any branch but `main` |
| Merge | ruleset requires CI **and** `bench/gate` | unchanged |

**Nothing was loosened.** The push was never the irreversible act; the merge is. `bench/gate`
is a required status check on `main` with an **empty bypass list**, so a pull request still
cannot merge without the worker's live evidence for its head sha — the maintainer included.
Keeping the old push rule would have been self-contradictory: a commit must be pushed before
the worker can fetch it, so "no push without an attestation" and "no attestation without a
push" cannot both hold.

### The static witness — why CI and not the receipt

The receipt (#145) had the session run typecheck, lint and the suite, write a file naming the
tree it proved, and the worker re-key that file by the fingerprint it took itself. Careful, and
it closed the obvious hole (#126). But the proof was still produced by the session.

A pushed commit has a better witness: GitHub ran `typecheck + tests` **on that exact sha**, on
a machine nobody here controls, and the ruleset already requires it green to merge. So the
worker asks GitHub (`src/e2e/bench/ci-proof.ts`) instead of trusting a file.

**The rule is unchanged — skip on positive evidence, never on assumption.** A recorded
`success` for the sha skips stage 1, and the gate artifact records `CI` as the authority.
Everything else replays it: no run yet, still running, failed, cancelled, GitHub unreachable,
an unparseable answer.

⚠ The trap this avoids: *"CI is required for the merge"* is true **at merge time** and says
nothing about the moment the gate runs. A gate can run before the pull request exists, and
`coverage:changed` and `check-pr-rules` in `ci.yml` are `if: github.event_name ==
'pull_request'`. Asking about **this sha, right now** is the only safe form of the question.

### Dependabot

`npm run deps:gate` pushes **before** it gates, for the same reason. It used to gate first,
because the push hook refused anything unattested; that rule is gone, and `gh pr merge --auto`
still cannot land a commit `bench/gate` has not passed.

## 12. The merge queue

**Available since 2026-08-25**, when the repository moved from the personal account to the
`Crazz-Org` organization. GitHub's merge queue requires an organization-owned repository —
public visibility is not enough, the two are separate conditions — and the transfer is what
lifted that. `gh api repos/Crazz-Org/SPO-WebClient --jq .owner.type` now answers
`Organization`.

### The short form

**`main` has a merge queue** — so `gh pr merge <N> --merge` **enqueues**; it does not merge.
Every `gh pr merge` here — the correct form included — prints one stderr warning,
`! The merge strategy for main is set by the merge queue`, and exits 0: **expected and
benign**, not a failure. The queue's method is `MERGE`, so a `--squash` or `--rebase` you pass
is **overridden, not refused**; pass `--merge` so the command says what will happen. Judge on
the **exit code and the PR state, never on stderr text** — in doubt, one REST call settles it:
`gh api repos/Crazz-Org/SPO-WebClient/pulls/<N> --jq '{state,merged}'` (`open` = enqueued).
Never "recover" a merge that did not fail. **Never add `--delete-branch`**: `gh` honours it the
instant the entry is created, destroying it and leaving the PR CLOSED and unmerged — same exit
0, same warning. GitHub deletes the branch itself when the entry lands. Recovery:
`git push -u origin <branch>` + `gh pr reopen <N>` + merge again, same sha.

### What it buys, and why it is the point

A gate proves `merge(branch, the main it was based on)`. A queue entry is
`merge(branch, main-now)` — a speculative commit GitHub builds by merging the pull request
onto the current queue head — so driving *that* live proves the exact tree about to land.
This is the hole [#157](https://github.com/Crazz-Org/SPO-WebClient/issues/157) named: two
branches that pass alone can break together, and nothing drove the combination before it
landed.

`baseMain` stays regardless. It is what makes the *difference* visible on a gate that ran
outside the queue — Dependabot, a `ref` job, a branch gated before its pull request exists —
and § The gate base still announces a moved base rather than refusing it.

### What the worker does

`src/e2e/bench/merge-queue.ts`, three behaviours and each one has a reason:

- **Discovery by polling.** Required checks in a merge queue report on the *speculative*
  commit, and the worker takes no inbound connection — it pulls. One `git ls-remote` names
  every `gh-readonly-queue/main/*` ref and its sha per idle tick.
- **Priority over the spool.** GitHub ejects an entry whose checks exceed the queue's
  response timeout. The bench is serialised machine-wide and a `lease` can hold it — median
  11 min, **max 33 min** measured. Without priority a lease would eject a healthy branch, and
  that session would spend its three attempts on somebody else's `npm run dev`. One entry at
  a time, one gate per entry, so it cannot starve the spool for long.
- **Dedup on the tree, never the commit.** A queue ref is a fresh merge commit every time, so
  a sha dedup would never hit; its *tree* is byte-identical to the pull request head's
  whenever the queue head has not moved since that head was gated — the common case at one
  entry at a time. An identical tree reuses the verdict and publishes the status at once.
  When `main` has moved the trees differ, the drive happens, and that is the case worth
  paying for.
- **The entry is fetched before its tree is read.** A speculative commit exists on GitHub and
  in no checkout, so `rev-parse <sha>^{tree}` can only answer "unknown" until its objects are
  local. The ref is fetched by name with no refspec — objects only, nothing written under
  `refs/`, so an entry GitHub deletes leaves nothing behind, and almost every object is
  already present from the pull request head. A fetch that fails is logged and the tree read
  is attempted anyway (an earlier tick may have brought it down); a tree that still cannot be
  read means *gate it*, never "assume it matches".

  ⚠ This is the one ordering the mechanism cannot survive being wrong about, and it shipped
  wrong. Reading before fetching is **safe** — it fails toward driving — but it makes the hit
  impossible, so every entry pays a full live drive on a serialised bench and the `tree` field
  on every attestation is dead weight. It cost 113 s of exclusive bench time on the very first
  entry, in the ideal case for a hit. Fixed in
  [#192](https://github.com/Crazz-Org/SPO-WebClient/issues/192); pinned by a test whose fake
  checkout refuses to resolve a sha whose ref was never fetched, exactly as a real one does.

`ci.yml` reports on `merge_group` as well as `pull_request`, or an entry could never go
green.

### The ruleset

On ruleset 21111153, `merge_queue` with:

| Parameter | Value | Why |
|---|---|---|
| `max_entries_to_build` | 1 | No speculative parallelism — an ejection must not invalidate another entry's live drive |
| `max_entries_to_merge` | 1 | Same reason, on the landing side |
| `check_response_timeout_minutes` | 60 | Above the 33 min worst-case `lease`, or a lease ejects a healthy branch |
| `merge_method` | `MERGE` | |
| `grouping_strategy` | `ALLGREEN` | |

The `pull_request` rule's `allowed_merge_methods` is narrowed to `merge` at the same time —
otherwise a hand-picked squash lands without ever entering the queue, and the whole
guarantee is optional.

⚠ **Order matters when enabling it.** The `merge_group` trigger has to be on `main` *before*
the ruleset gains the rule. Enable the queue first and the very pull request that adds the
trigger cannot merge: its queue entry waits for checks that no event fires, and the entry is
ejected on timeout.

`bench/gate` was dropped from this required list on 2026-08-29T10:17:40Z (advisory only for
five days) and restored on 2026-09-03T07:32:42+02:00 — check the ruleset itself before trusting
either this sentence or that date: `gh api repos/Crazz-Org/SPO-WebClient/rulesets/21111153`.

### ⚠ Never pass `--delete-branch` while the queue is on

`gh pr merge <N> --merge --delete-branch` **does not merge** any more — the queue owns the
merge strategy, so `gh` enqueues the pull request, prints one warning line
(`! The merge strategy for main is set by the merge queue`) and then honours
`--delete-branch` immediately. Deleting the head branch destroys the entry GitHub was about
to build: the queue empties, the pull request is **CLOSED unmerged**, and `main` never moves.

It is quiet about it. The command exits 0, and the only clue in the output is a warning that
reads like advice rather than "your merge did not happen".

⚠ The warning is not the tell, in either direction. The **correct** form prints the very
same line and also exits 0 — every `gh pr merge` against `main` does, because the queue owns
the strategy — so its presence proves nothing. Reading it as a failure and starting to
"recover" an entry that is safely queued is the mirror image of this trap: recovery moves
against a live entry (closing, re-merging with extra flags) are exactly what can destroy it.
The verdict lives in the exit code and the pull request's state, one REST call:
`gh api repos/Crazz-Org/SPO-WebClient/pulls/<N> --jq '{state,merged}'` — `open` means
enqueued and fine; `closed` with `merged: false` is the destroyed entry above.

The correct form is `gh pr merge <N> --merge`, with nothing else — same warning, exit 0.
GitHub deletes the branch itself once the entry lands, because `delete_branch_on_merge` is
on — the flag was always redundant here and is now actively harmful.

Recovery, if it has already happened: push the local branch back (`git push -u origin <branch>`),
`gh pr reopen <N>`, and merge again without the flag. The head sha is unchanged, so the
`bench/gate` attestation still applies and nothing needs re-gating.

Observed on 2026-08-25, on the first pull request ever sent through this queue.

### Two things GitHub documents nowhere — both now observed

Both were assumptions when the queue was written. The first pull request through it, #190 on
2026-08-25, settled both, and they held:

1. **The sha the queue lands IS the sha it tested.** The speculative commit was `9b038a2c`,
   and `9b038a2c` is what `origin/main` points at — verbatim, not rewritten. Had it been
   rewritten, every attestation would name a commit that never existed on `main`. (The *tree*
   survives a rewrite either way, which is what the dedup keys on, so the dedup was never at
   risk here — the attestation's identity was.)
2. **A queue ref does jump the bench spool.** The worker picked the entry up on an idle tick
   and published `bench/gate` on the speculative commit (`job-01787638564662-add2f3`), which
   is what let the entry go green at all. The priority is ours to honour and GitHub's to
   enforce nowhere; it was honoured.

One entry, so neither is proven under contention — a `lease` holding the bench while an entry
waits is still untested, and the 60 min `check_response_timeout_minutes` is the margin that
covers it.

`npm run test:live` is the documented post-ejection diagnostic: an ejected session uses it to
separate "my defect" from "the combination" instead of re-queueing blind.

### History

Written in [#170](https://github.com/Crazz-Org/SPO-WebClient/pull/170) and
[#168](https://github.com/Crazz-Org/SPO-WebClient/pull/168), then removed in
[#178](https://github.com/Crazz-Org/SPO-WebClient/pull/178): the ruleset write returned **422
Validation Failed** on that one rule while the identical payload without it was accepted, and
that bisect is what proved a personal account cannot have a queue at all. The code worked; it
simply could never find a ref, and keeping code that cannot run is how a reader comes to
believe a mechanism is in place. It was restored by reverting #178 once the repository moved.

## 13. Acceptance criteria (verified by the test suites)

- Two simultaneous deposits execute one after the other, in deposit order, each with an
  attributable report — `job.test.ts`, `worker.test.ts`.
- The static stage is skipped **only** on a recorded CI success for that exact sha, and never
  skips more than stage 1 — `ci-proof.test.ts`, `worker.test.ts`, `verify-gate.test.ts`.
- A session killed while queued (with `--wait`, the npm default) leaves nothing:
  `ABANDONED`, queue cleaned — no orphan gateway is possible since sessions start none.
  Killed mid-lease: the gateway lives until the lease expires, then the worker tears it
  down. `worker.test.ts`.
- A killed worker restarts (systemd) and resumes the queue; mid-flight jobs are reported
  `INTERRUPTED`. `worker.test.ts`.
- No gateway survives between jobs — teardown re-verifies the port. `gateway.test.ts`.
- A deposit against a dead worker fails immediately with exit 3. `cli.test.ts`, `paths.test.ts`.
- A moved tree yields `STALE`, never PASS; the hook refuses unstable attestations.
  `worker.test.ts`, `pre-push-gate.test.ts`.
- A lease held by another live host refuses the job before the port is cleared, and a lapsed
  one frees the bench on its own; a host where the lease has never worked is unaffected.
  `owner.test.ts`, `worker.test.ts`.
- Nothing that ran no code — `DIRTY`, `ENVIRONMENT`, `ABANDONED` — can overwrite an existing
  attestation for the same sha, whichever stage produced it, and none of them publishes a
  `bench/gate` status. Every verdict is pinned to written / not-written. `worker.test.ts`.
- The gate body distinguishes its outcomes in the exit code (0/1/2/3) and the worker maps
  each one back explicitly; an unlisted code is `FAIL`, never a silent pass.
  `verify-gate.test.ts`, `worker.test.ts`.
- A readiness probe times out on its own budget, so one hung request cannot consume the
  gateway's whole 180-attempt window. `gateway.test.ts`.
- A `ref` job fetches before it builds, is never `STALE` for the tree it reset itself, still
  catches one that moves mid-run, and writes beside the session path rather than over it.
  `checkout.test.ts`, `worker.test.ts`.
- The install is skipped only on positive evidence that `node_modules` matches the lockfile;
  a missing record, a moved lockfile or an unreadable one all install. `checkout.test.ts`.
- The static stage is skipped only on a recorded CI **success for that exact sha**; absent,
  pending, failed, malformed and unreachable all replay it, and the artifact names which
  witness proved it. `ci-proof.test.ts`, `worker.test.ts`.
- The push hook refuses `main` and nothing else, while still telling a mention of `git push`
  from a real one. `pre-push-gate.test.ts`.
- A **scheduled** nightly is deposited only from an idle queue, inside its UTC window, at most
  one per 20 h; it publishes to `nightly/latest.json` and writes no attestation. A worker
  death mid-nightly stamps `INTERRUPTED` rather than leaving yesterday's PASS standing.
  — `nightly.test.ts`, `worker.test.ts`.
- A **manual** nightly is deposited from that same idle branch and nowhere else — the request
  is a marker, and `submit --type=nightly` is still refused. It skips the 20 h slot, waits out
  the 15-minute live-drive limit rather than being refused by it, and replaces
  `latest.json` **only when it attests**: `PASS` or `FAIL` at the sha that was requested.
  `ENVIRONMENT`, `INTERRUPTED`, `STALE` and a superseded tip leave the published file
  byte-identical and are recorded under `nightly/manual/` instead. The request itself refuses
  an agent session and a non-terminal, both before writing anything. — `nightly.test.ts`,
  `worker.test.ts`, `cli.test.ts`.
- A merge-queue entry is gated exactly once, only from GitHub's own queue refs, and its
  objects are **fetched before its tree is read** — so an entry whose tree already carries a
  passing attestation reuses it and takes no live slot, while an unfetchable or unreadable
  tree gates. `merge-queue.test.ts`, `worker.test.ts`.
- A `ref` job merges `origin/main` into the checkout unless the branch already contains it
  (the fast path — no merge, no conflict risk); a conflict runs `git merge --abort`
  explicitly and reports `FAIL` with the merge base in the detail, never `ENVIRONMENT`; a
  real merge forces the static stage to replay regardless of any CI record for the
  pre-merge sha; and the attestation always keys on the deposited sha, never on whatever
  commit the merge left `HEAD` pointing at. `checkout.test.ts`, `worker.test.ts`.
