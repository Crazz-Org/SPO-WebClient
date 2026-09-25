# Kanban workflow — GitHub Projects is the backlog

**Single source of truth for all open work:**
[github.com/orgs/Crazz-Org/projects/1](https://github.com/orgs/Crazz-Org/projects/1)
(organization project #1, Kanban — **public**). Every task is a **GitHub issue** on
`Crazz-Org/SPO-WebClient`,
added to the project. Draft items are not used.

The former documentary backlog (`doc/BACKLOG.md`, `doc/BACKLOG-OPEN.md`) is **retired and
deleted**; its full text stays readable at the archive permalink:
[`doc/BACKLOG-OPEN.md` @ `94b059a0`](https://github.com/Crazz-Org/SPO-WebClient/blob/94b059a08caa5d834ce9e1fac6ac5f398b91943f/doc/BACKLOG-OPEN.md)
· [`doc/BACKLOG.md` @ `94b059a0`](https://github.com/Crazz-Org/SPO-WebClient/blob/94b059a08caa5d834ce9e1fac6ac5f398b91943f/doc/BACKLOG.md).
`OB-N` identifiers survive as issue titles; new tasks get plain issue numbers.

## The short form — what every session must know

**All open work lives on the kanban:**
[github.com/orgs/Crazz-Org/projects/1](https://github.com/orgs/Crazz-Org/projects/1) — every
task is a GitHub issue on the board. **The board is driven by the orchestrator in the sibling
[SPO-Pipeline](https://github.com/Crazz-Org/SPO-Pipeline) repo**, not from inside this one: it
claims a card, opens a worktree, implements, gates, validates and merges, writing the board at
each state transition. This repo supplies the `board:*` scripts it spawns, and nothing else.
This rulebook covers the ten columns (Intake · Todo ·
Planning · Implementing · Checks & PR · Gate · Validation · Merging · Done · Parked), the
`Session` field as ownership marker, board writes at state transitions only, and which board
workflows are on.

**Ownership is sacred** — never touch a card whose `Session` is filled; every owner closes its
ownership (Done or Parked). A task that dies without closing it leaves a card only the
human may free (`.github/workflows/orphan-cards.yml` only comments; it frees nothing).

**One session per area:** a card also carries an `Area` — the one part of the tree its change
lands in — and the orchestrator claims the topmost Todo card whose area no live card already
holds. `docs` never blocks; every other area does. The reservation expires on inactivity
(`SPO_WORKTREE_IDLE_MIN`, 120 min), the card's `Session` field never does.

**Order, where it exists, is a `blocked by` link** between two issues — the relation lives on
the issue, not on the card. The claim read pulls the whole blocked set in one GraphQL call and
the orchestrator does not claim a card whose blocker is still open: it skips it and names the
skip, or refuses out loud when that card was the one it was handed. A dependency
records *cannot start yet*, never priority — priority stays the human's vertical order in Todo.

**GitHub reads are budgeted like board writes.** One account's quota — 5000 GraphQL points per
hour — is shared by every session, worktree, workflow and PC. A `gh project item-list` costs
~103 points; the composite claim read costs ~2. So a session reads the pool **once**, at claim,
with the recipe in § GitHub API discipline, below; it
never polls GitHub for a state that has a local surface (bench verdict, nightly — both under
`~/.spo-bench/`); it asks `rateLimit { cost remaining resetAt }` in every
hand-written GraphQL call; and on `RATE_LIMITED` mid-claim the **write half decides** — a
half-made claim is never walked away from, because it leaves a card only a human can free.

**Filing a card is a deliberate act** — `/triage-report`, a maintainer's request, the split
of a claimed task that turned out to be two, or a
`PASS WITH FINDINGS` verdict from the `change-validator` sub-agent, bounded to ground the diff
touched. `Auto-add to project` then puts the issue on the
board and sets `Status` to Todo, so it lands straight in the pool the claim read walks — no
`item-add`, no column set by hand. What no workflow sets is `Category`, `Size` and `Area`; those
stay the filer's job, along with the matching `cat:` / `size:` labels.
**Every draft card is read first by the `card-reviewer` sub-agent** — which checks those three
fields too, `Area` included, because the claim rule reads it and a card filed without one
reserves no ground — whose dated verdict becomes the card's first comment; on `DO NOT FILE` no
issue is created.

**The board is written in English — all of it**, whatever language the session, the source or
the conversation was in: titles, bodies, every comment, columns, fields, labels. Translate on
the way in; never transcribe. The former `doc/BACKLOG*.md` files are deleted; their text is
archived at commit `94b059a0`.

## The board — ten columns, one per milestone

The `Status` field is single-select: a task is in exactly one column. The column names below
are the ones the machinery actually writes — `orchestrator/board.js`'s `COLUMN_BY_STATE` in the
sibling [SPO-Pipeline](https://github.com/Crazz-Org/SPO-Pipeline) repo, and the busy-set query in
[scripts/claim-read.sh](../scripts/claim-read.sh). Rename a column on the board and both break;
this table is the description, not the source.

| Column | Milestone | Enters when | Leaves when |
|---|---|---|---|
| 📨 **Intake** | A raw bug report, filed mechanically, not yet judged | `report-intake` filed the report verbatim as a card. Carries the `report:raw` label, and the claim read never sees it. | A maintainer comments `confirm` (→ triage, then Todo) or `discard`. |
| 📥 **Todo** | Unowned pool | Issue created and added to the project. **Vertical order = priority**, maintained by the human — the orchestrator always takes the topmost unowned item. | The orchestrator claims it. |
| 🗺️ **Planning** | Owned, worktree open, change being planned | The claim handshake wrote the task's identity into `Session`; the worktree exists. | The plan is in hand and implementation starts. |
| 🔨 **Implementing** | Owned, in development | Planning returned a plan. Branch, implementation, tests. | Local checks start. |
| 🧾 **Checks & PR** | typecheck / lint / coverage, then the pull request | Implementation done. The mechanical checks run here, and the PR opens with `Closes #N`. | Checks green and the PR open → the gate is deposited. |
| 🧪 **Gate** | `npm run gate` deposited on the bench worker | Committed, pushed, PR open, gate queued (the PR precedes the gate — the worker only fetches a pushed sha, and `ci.yml` needs an open PR to run CI on it). | Gate PASS → Validation. Gate failure loops back to Implementing (3 attempts max, then the task parks). |
| 🔍 **Validation** | `scripts/check-rdo-citation.js` mechanically verifying each new/changed catalogue entry's citation first; `citation-verifier` — only when the diff touches `rdo-members.ts` and only on the entries the parser could not cleanly verify — adjudicating those, then `change-validator` reviewing the diff against the card's criterion and the code it landed in | Gate returned PASS. | `citation-verifier` `REJECT` → back to Implementing, same as a `change-validator` `REJECT` (own budget of 3, separate from gate attempts). `citation-verifier` `DIVERGES` does not block — it flags the entry and validation proceeds to `change-validator`. `change-validator` `PASS` / `PASS WITH FINDINGS` → Merging. `change-validator` `REJECT` → back to Implementing (own budget of 3; a corrected attempt is re-committed, re-pushed and re-gated, then parked after 3). |
| 🔀 **Merging** | The pull request is being merged | `change-validator` returned `PASS` or `PASS WITH FINDINGS`. CI + `bench/gate` statuses already green. | Merge (issue auto-closes). |
| ✅ **Done** | Merged, released, finished | PR merged, release published, the worktree removed. Final synthetic comment posted. | Terminal. |
| 🅿️ **Parked** | Ownership closed on failure, exhausted budget or an unhandled case | The orchestrator parked the task with a legible reason as an issue comment. `Session` deliberately stays filled, as the trace ownership law 4 asks. | **Human only**: a `retry` comment restarts the task at intake, an `abandon` comment closes it. |

**A new or changed catalogue entry's citation is checked mechanically first, in Validation, and
only when the diff changed `src/shared/rdo-members.ts`.** `scripts/check-pr-rules.js` diffs the
file, finds which entries actually changed, and runs `scripts/check-rdo-citation.js` (a
deterministic Pascal-declaration parser) against each one's cited `File.pas:Line`. An entry the
parser can confirm MATCHes clears with no LLM involvement at all. `citation-verifier` is invoked
only on the entries the parser flagged — a MISMATCH, a citation it could not find, or an entry
its own grammar could not read — to judge whether the mismatch is a real defect or a
documented, rule-justified divergence under one of the two RDO rules (CLAUDE.md § *RDO — one
catalogue, one emitter*); if it is ever handed the whole diff instead of a specific flagged set
(the fallback path), it judges every new/changed entry the way it always has. `REJECT` (a false
citation, or an unjustified kind/arity mismatch) blocks the merge exactly like a
`change-validator` `REJECT` — back to Implementing, same shared budget of 3. `DIVERGES`
(citation genuine, entry correct, but a real, rule-justified divergence from the bare
declaration) does not block: it is flagged for a human to confirm the intent, and validation
still proceeds to `change-validator`. A diff that does not touch `rdo-members.ts` skips this
whole check entirely.

## Fields on each card

| Field | Kind | Meaning |
|---|---|---|
| `Session` | text | **The ownership marker.** Empty = claimable. Format: `<branch> @ <YYYY-MM-DD>` (e.g. `claude-crazz/mail-refresh-x1 @ 2026-08-24`). All sessions push as the same GitHub account, so the assignee cannot distinguish them — this field can. The date records the day of the first claim and is never recomputed; `board-take.sh` decides ownership by the branch part alone, so a retry of the same branch that crosses midnight keeps its claim. |
| `Category` | single select | 🔴 Defect · 🟠 Latent trap · 🟡 Feature/Gap · ⚪ Observation · 📚 Doc/Infra — called `Category` and not `Type`, which GitHub Projects reserves |
| `Size` | single select | S · M · L — rough estimate at creation, for scanning the pool. |
| `Area` | single select | **The ground reservation.** Which part of the tree the card's change lands in — exactly one per card, from the partition below. No other field says what ground a task occupies, and the orchestrator skips a Todo card whose area another live task already holds. |

### The areas — a partition, first match from the top

Every path belongs to **exactly one** area. Where two rules could match, the earlier row wins.

| `Area` | Paths |
|---|---|
| `docs` | `**/*.md`, `doc/**` |
| `rdo` | `src/shared/rdo-*.ts`, `src/server/rdo*.ts`, `src/server/session/rdo-*.ts`, `src/mock-server/**` |
| `bench` | `src/e2e/bench/**`, `scripts/bench-*.sh`, `scripts/verify-gate.js`, `.claude/hooks/**` |
| `renderer` | `src/client/renderer/**`, `src/client/**/*.module.css` |
| `gateway` | `src/server/**` |
| `client` | `src/client/**`, `public/**` |
| `e2e` | `src/e2e/**` |
| `shared` | `src/shared/**`, `src/*.d.ts` |
| `ci` | `.github/**`, `scripts/**`, `.claude/**`, `src/__tests__/**`, `src/__mocks__/**`, `jest.config.js`, `eslint.config.js`, `tsconfig*.json`, `vite.config.ts`, `Dockerfile*`, `docker-compose.yml` |

**`ci` is the last row and the catch-all.** Anything reachable that no earlier row claims is
`ci` — the machinery that builds, tests, ships and automates the repository. That is what makes
this table a *partition* rather than a list to be extended every time a file appears at the
root: a session can always read an area off it, so §4's "never leave `Area` empty" is a rule it
is possible to obey.

**`docs` comes first, so a Markdown file is documentation wherever it lives** —
`.github/pull_request_template.md`, `.claude/commands/*.md`, `src/mock-server/CLAUDE.md`. Prose
cannot break a build, and `docs` never blocks (§ One session per area), so reserving no ground
for it costs nothing; the reverse costs a great deal — editing one slash command would hold the
whole `ci` area, and nearly every task edits some Markdown.

**`shared` is ground of its own**, because `src/shared/` is consumed by both halves and neither
owns it. `gateway` and `client` were each plausible for `logger.ts` or `road-cost.ts`, and two
sessions guessing differently is exactly the silent overlap this field exists to remove. A card
centred on `src/shared/` blocks neither half; one that genuinely has to change `src/shared/`
*and* `src/server/` is two cards, by the rule below.

**No row may match nothing.** `electron` had one until 2026-08-25, and it was dead from birth:
`electron/` was deleted at 19:25 on 2026-08-24 (`ba7822a6`, #149) and the row was written at 20:38
the same evening (`eb6307b6`, #159) — 73 minutes later. A row that can never match is offered at
every classification and read by every session, so `src/__tests__/area-reservation.test.ts` now
checks each row's directories against the tracked tree.

**This is not [`.github/labeler.yml`](../.github/labeler.yml).** That file's labels overlap on
purpose — a PR can be both `client` and `renderer`. An area must *not* overlap, or two sessions
holding `client` and `renderer` would each believe they are on separate ground while editing
the same tree.

**One area per card** — where the *majority* of the change lands. Incidental edits do not
change the choice, specifically `CLAUDE.md`, `package.json`, `package-lock.json`, `README.md`,
and anything under `doc/`: a card that touches `src/client/renderer/` plus three Markdown files
is `renderer`, not `docs`. A task that genuinely spans two blocking areas is **split into two
cards** — never invent a combined area, and never leave `Area` empty to dodge the rule.

**No `area:` labels.** `Category` and `Size` carry labels because workflows and
`gh issue list --label` cannot read a project field. `Area` is read only by the claim read
(`board:claim`, § gh CLI recipes), which reads project fields directly. A hand-posted `area:`
label would duplicate the automatic PR path labels and drift from them.

## The board is written in English — all of it

**Every word that lands on the board is English**, whatever language the session, the
source or the conversation was in: issue titles, issue bodies, every comment, the release
explanation, the final synthetic comment. A finding read off a French ASP page, a Delphi
comment in Portuguese or a chat in French is *translated* on the way in, not transcribed.

Why it is a rule and not a preference: the backlog is the one artefact every session reads
and no session owns. A bilingual backlog costs a reader twice — once to find the card, once
to be sure they understood it — and the cost lands on whoever picks the card up, never on
whoever wrote it. Titles carry `file:line` references and RDO member names that must be
greppable; mixing languages around them makes the pool unsearchable in practice.

The one thing this does **not** change: the release comment (§ ownership law 4) is still
written for a non-programmer. Plain English, not technical English.

Board structure follows the same rule — columns, fields and `cat:` / `size:` labels are all
English. Conversation with the maintainer is not board content and is not affected.

## The ownership law

1. **Ownership is sacred.** A card whose `Session` field is non-empty belongs to that
   session. No other session may take it, edit it, or work its scope — ever. There is no
   staleness timeout for sessions.
2. **Claiming is a handshake, not a write.** Read the board → write your identity into
   `Session` → **re-read the field**. If it holds someone else's identity, you lost the
   race: take the next item. Claim one card at a time.
3. **Every owner must close its ownership** — in success (→ Done) or in failure
   (→ Parked). A task that ends without doing either leaves a locked card; **only
   the human** may free it (clear `Session`, move back to Todo).
4. **Parking a task** (failure, exhausted budget, out of scope): move to Parked, keep
   `Session` filled (it is the trace), and post one issue comment explaining **in simple,
   non-technical English** why the task failed — what was attempted, what blocked it, in
   words a non-programmer follows. The human reclassifies from there.

**One narrow exception to "only the human may free it" (#299):** `npm run board:take --
<n> --release` may clear a *different* session's stale claim when the card is the trace of
an issue that got **reopened** after its owner correctly closed it — not a failure trace, and
not a live owner. It checks all three at once: Status is `Done` or `Parked`, the issue
is **open**, and the issue's `stateReason` is **REOPENED**. A failure release never sets
`stateReason` (the issue was never closed), so law 4's trace stays exactly as human-only as
it was — this exception can never fire on it. Anything short of all three — a live owner in
Todo/Planning/Implementing/Checks & PR/Gate/Validation/Merging, a failure trace, or a closed issue — still exits refused, and the
tool says which.

### One session per area — the ground reservation

Git only refuses a merge when both sides changed the **same lines**. Two changes on different
lines that break each other merge cleanly, and the defect is visible only once it is on `main`.
Measured on 2026-08-24: **19** forced `Merge remote-tracking branch 'origin/main'` commits in a
single day, one branch re-syncing **six times** before it landed. Ownership of a *card* is
therefore joined by a reservation on its *ground*.

**The busy set.** An area is **busy** when a card holds it in **Planning**, **Implementing**,
**Checks & PR**, **Gate**, **Validation** or **Merging**, and that card's reservation is still
live (below). `Todo`, `Done` and `Parked`
never make an area busy. `Gate`, `Validation` and `Merging` do: the branch exists and is about to land.

**`docs` never blocks.** Two or more cards may hold `docs` at the same time. A documentation
change cannot break the build, and a same-line collision is caught by Git; blocking on it would
freeze the board for no gain, since nearly every task edits some Markdown. **Every other area
blocks.**

**The claim rule.** The orchestrator walks Todo top-down and takes the first card whose `Area`
is not in the busy set; a card with an **empty** `Area` is claimable and blocks nothing. The busy
set itself is computed by [scripts/claim-read.sh](../scripts/claim-read.sh) (`npm run
board:claim`), which is the executable half of this rule. The full algorithm — including what to
do when the area determined *after* claiming turns out to be busy, and what to do when no card is
claimable — lives in the orchestrator's INTAKE step (SPO-Pipeline `orchestrator/README.md`).

**The reservation expires on inactivity — the card's ownership never does.** A task here can
legitimately run for **several hours**, and board writes happen at state transitions only, so a
busy task goes hours without touching its card. The reservation is keyed to factual activity
instead.

The activity a reservation is keyed to is **the branch's last commit date on `origin`**, read by
[scripts/claim-read.sh](../scripts/claim-read.sh) in one batched GraphQL call covering the whole
busy set. `Session` holds a branch, so no mapping step is needed: the card's own `Session` field
names the ref to age.

The window is **`SPO_WORKTREE_IDLE_MIN`** (default 120 minutes). While the branch's last commit is
younger than that, the reservation is live; older, and the area is free. A branch whose ref cannot
be read at all — it never existed on `origin`, or the lookup failed — does not hold its area, and
`board:claim` prints a `note:` line whenever a failed lookup is the reason.

There was a second and cheaper signal until #441: a per-session heartbeat under
`~/.spo-bench/sessions/*.alive`, stamped by `.claude/hooks/session-heartbeat.sh`. That hook was
retired with the pilot hook layer in #425, which left the store with no writer, so the commit-date
rule above had been the only live path ever since; the readers were removed in #441 rather than
left to imply a signal nothing produced. See
[#158](https://github.com/Crazz-Org/SPO-WebClient/issues/158) for the cross-machine case that rule
also covers.

**`Session` is never touched by any of this**, in any of these cases. Ownership law 1 stands
unchanged: a card whose `Session` is filled still belongs to that session, and only the human
may free it. What expires is the *ground reservation*, and nothing else — that distinction is
the whole point of the field.

### Blocking order — the card that cannot start yet

The area reservation above says *two sessions must not stand on the same ground at once*. It
says nothing about **order**, and nothing else did either: a session could claim a card whose
work cannot begin until another card's change exists. Until 2026-08-25 that order lived in
prose — [#120](https://github.com/Crazz-Org/SPO-WebClient/issues/120) carried
"⚠ Depends on #108 … Fix #108 first" inside its own body, and the claim step offered it at every
claim like any other Todo card. Its order held only because the human's vertical rank happened
to agree, and any reprioritisation would have destroyed it silently.

GitHub records the relation on the **issue**, not on the card — `blocked by` / `blocks`
(`Issue.blockedBy`, `Issue.issueDependenciesSummary`, the `addBlockedBy` / `removeBlockedBy`
mutations). The project's fields do not include it, so `gh project item-list` cannot see one:
reading the relation rides in the claim read's single GraphQL call over the open issues — for
the whole set, never one per card (recipe in § gh CLI recipes).

**A blocked card is not claimable, and closing the blocker is the whole lifecycle.**
`issueDependenciesSummary.blockedBy` counts the **open** blockers only, so a blocker that closes
frees the card by itself, with no board write anywhere.

**What a session does when it meets one** — and none of it touches the card:

| The session was | It does |
|---|---|
| walking Todo top-down | **skips the card and names the skip in its final report** — `#120 skipped: blocked by #108`. A silent skip would make the board read *worse* with dependencies than without: the human sees a card passed over and is given no reason. |
| handed the card by number (`spo run 120`) | **stops and says so out loud**, exactly as it does for a card another session owns. The human named that card; claiming it anyway breaks the order, and skipping it silently answers nothing. |

In both cases `Session` stays empty, `Status` stays **Todo**, and no comment is posted. A
blocked card is **not** Parked — nothing failed, and it was never owned.

**Who may post one, and what it may never be used for.**

1. **The human always may**, on any card.
2. **A session may add one** when the relation is a fact of the code — the blocked card's work
   cannot begin until the blocker's change exists — and it says why in one comment on the
   blocked card. A session **never removes** one: that is the human's, or the blocker closing.
3. **A dependency is never a substitute for priority.** Priority is the vertical rank of Todo
   and it belongs to the human (§ The board). A dependency says *cannot start yet*, never
   *matters less* — to push work back, move the card down; do not invent a blocker.
4. **It neither substitutes for the `Area` reservation nor is substituted by it.** Areas guard
   against merge collisions between two live sessions; dependencies guard logical order between
   two cards that may never be live at the same moment. Both are checked, independently.
5. **A sub-issue link is not a dependency.** `Parent issue` / `Sub-issues progress` decompose a
   task ([#167](https://github.com/Crazz-Org/SPO-WebClient/issues/167) → #171–#174); nothing in
   that link orders the children.

[src/\_\_tests\_\_/card-dependencies.test.ts](../src/__tests__/card-dependencies.test.ts) keeps
the two surfaces of this rule — this rulebook and `CLAUDE.md` — from drifting apart.

## The orphan watch — the law's missing half

Rule 3 says a session that ends without closing its ownership leaves a locked card, and only
the human may free it. Nothing told the human it had happened. With several sessions running
in parallel on one machine, a session dying mid-flight is the likeliest failure of the
assignment process, and its card sat in Implementing / Gate / Merging — owned by nobody alive —
until somebody happened to re-read the board.

[`.github/workflows/orphan-cards.yml`](../.github/workflows/orphan-cards.yml) runs
[`scripts/orphan-cards.js`](../scripts/orphan-cards.js) every morning at 07:10 UTC and makes
that visible. **It frees nothing.** It never edits the board, never clears a `Session`, never
moves a card — rule 1 is untouched, and the job holds no token that could break it.

| Decision | Answer | Why |
|---|---|---|
| What is a suspect | `Session` non-empty **and** column ∈ {Planning, Implementing, Checks & PR, Gate, Validation, Merging} **and** the card's `updatedAt` is ≥ N old | `updatedAt` is the one clock that ticks on every milestone a live task must write. A missing branch or a missing PR is **evidence printed next to the card**, never the trigger — a card in Planning legitimately has neither. |
| N | **24 h** (`ORPHAN_STALE_HOURS`) | The bench serialises every session's gate on one machine, so an L-sized task behind a queue can honestly be quiet for most of a working day. 12 h fires on a card claimed in the evening and worked next morning; every card that has landed so far was claimed and finished the same day. |
| Shape of the reminder | **One comment on the quiet card**, once per ownership episode, plus a table in the run's job summary | A digest issue would be auto-added to the board (see below) and the orchestrator would eventually claim the machine's own bookkeeping as work. A comment creates no card and lands where the decision is made. |
| Repeat | Never, for the same owner | Each comment carries a hidden `<!-- orphan-watch:<Session> -->` marker. Keyed on the `Session` text, not a timestamp: posting the comment can itself bump `updatedAt`, and a timestamp key would make the job re-fire on the trace of its own last run every day. A freed and re-claimed card gets a new `Session` and re-arms. |

**One human step, once.** The board is a Projects v2 board, which the repository's
`GITHUB_TOKEN` cannot read at any permission level — moving it into the organization changed
nothing there, because the resource is the project and not the repository. Provision a PAT with `read:project` as
the `PROJECTS_TOKEN` secret (Settings → Secrets and variables → Actions). Until it exists the
job is inert: green, skipped, one notice — never a red X every morning. `--dry-run` and
`workflow_dispatch` give a manual check without commenting on anything.

### The built-in Projects workflows — configured, and four that stay off

The other half of #124 — the mechanical transitions nobody should have to remember — is
configuration, not code, and **it did not survive the move to the organization**: a project's
`Auto-add to project` workflow is bound to a repository filter belonging to *that* project, so
the whole set had to be built again on the new board. That was done on **2026-08-25**. Read the
current state rather than assuming it:

```bash
gh api graphql -f query='query{organization(login:"Crazz-Org"){projectV2(number:1){workflows(first:20){nodes{name enabled}}}}}'
```

⚠ **There is no mutation for this, and the read is partial.** The public GraphQL API can
*delete* a project workflow (`deleteProjectV2Workflow`) and can read its `enabled` flag, but it
can neither create one, enable one, nor read the **value** a `Set value` step is configured
with. So a session can prove a workflow is *on*; only the UI can turn it on, and only the
board's behaviour proves it points at the right column. Project → ⋯ → Workflows.

**On, and what each one buys:**

| Workflow | Configured as | Why it matters |
|---|---|---|
| **Auto-add to project** | repository **picker** → `Crazz-Org/SPO-WebClient`; filter box → `is:issue is:open` | **The feeding rule rests on this one.** Without it a new issue belongs to no board, so a finding filed by a session is invisible |
| **Item added to project** | trigger `issue, pull request`; set `Status` = **Todo** | Auto-add only *adds*. Without this a new card arrives with no status — on the board and outside the pool at the same time, since the claim read selects on `Status = Todo` |
| **Pull request linked to issue** | set `Status` = **Merging** | The column the ownership law defines as "pull request open", reached from the `Closes #N` the PR body already carries. Currently **OFF** — the orchestrator writes the column itself |
| **Item reopened** | trigger `issue, pull request`; set `Status` = **Parked** | Without it, reopening a closed issue leaves its card in Done, where it misrepresents the work. **Not Todo:** `Session` still holds the old owner and Parked is the human's column — though `board:take --release` (#299) can now clear that stale claim itself, since a reopened issue's `stateReason` is the one thing a failure trace can never forge |
| **Item closed** | trigger `issue, pull request`; set `Status` = **Done** | The Done cards with an empty `Session` are the trace of this firing on its own |
| **Auto-close issue** | trigger *when the status is updated* → `Status: Done` | Closes the issue when a session moves the card |
| **Auto-add sub-issues to project** | — | Inherited, no value to set |

**Every `Set value` step needs its value, and the value is not optional** — a workflow whose
value is unset shows a red **!** in the sidebar and its *Save and turn on workflow* button
stays greyed. Expect all of them to arrive that way on a freshly rebuilt board: rebuilding
`Status` with these columns regenerates the option ids, so whatever GitHub pre-filled
against its own `Todo` / `In Progress` / `Done` defaults is left pointing at options that no
longer exist.

⚠ **A new column must be appended to the `Status` field in the UI, never added by rebuilding
the field.** Rebuilding regenerates every option id, including those that already exist, which
would leave all four `Set value` workflows above pointing at options that no longer exist.

**`board:move` needs no change** — `board-move.sh` resolves a column by name against the
`Status` field's own options, so it works the moment the option exists. Say so; do not edit
`scripts/board-move.sh`. Adding a new option in the UI leaves the existing ids untouched.

**Off, and staying off.** Three of the four are **pull-request workflows on an issue-only
board** — GitHub's wording for the merge one is *"when pull requests in your project are
merged"*, and the auto-add filter is `is:issue is:open`, so no pull request is ever an item
here and none of the three could fire whatever value it held.

| Off | Fires on | Covered instead by |
|---|---|---|
| `Pull request merged` | PR items | merge → `Closes #N` closes the issue → `Item closed` → Done |
| `Code review approved` | PR items | nothing to cover — solo maintainer, 0 approvals required |
| `Code changes requested` | PR items | idem |
| `Auto-archive items` | any item | deliberately nothing — Done **is** the record of finished work; archiving would hide it |

⚠ **Never widen the auto-add filter to pull requests to "unlock" those three.** Combined with
`Item added to project` → Todo, every open PR would drop into the pool and the
orchestrator would claim a pull request as work.

That is not a theoretical risk, and the reason is in the trigger rows above: `Item added to
project`, `Item closed` and `Item reopened` are all typed **`issue, pull request`** — none of
them excludes a pull request by itself. **The auto-add filter is the only thing keeping pull
requests off this board**, and therefore the only thing that makes those three safe. It is a
single UI field, and changing it changes the meaning of every column.

⚠ **Two traps in the auto-add row, and the first is a hard error.** The repository is chosen
from a *separate picker*; the filter box beside it accepts only `is:`, `label:`, `reason:`,
`assignee:` and `no:` (all but `no:` negatable). Writing the repository into the filter is
rejected outright — `Invalid filter: Unknown field name "repo"`. And **auto-add sets no field
value**: `Status` = Todo is the separate `Item added to project` workflow, so turning on only
the first of the two leaves every new card statusless.
([GitHub docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically))

**What a session still does by hand.** Nothing on the way in — a filed issue reaches Todo on
its own (auto-add verified live 2026-08-25: a throwaway issue reached the board in under ten
seconds). But no workflow sets `Category`, `Size` or `Area`, and every transition after the
claim is still a board write its owner makes (§ *What a session writes on the board*). A
card that reaches Todo without them is on the board but outside the pool the claim rule reads
— `Area` above all, since a card carrying none reserves no ground — which is how one was
nearly lost when the repository moved and the old board's filter stopped matching.

## What is written on the board — and only this

Board writes happen at **state transitions only** — no running log, no progress notes.
Every write is very short.

| Moment | Writes |
|---|---|
| Claim | `Session` field + Status → Planning |
| PR opened, gate deposited | Status → Gate (the PR link appears on the card automatically via `Closes #N`; if `Pull request linked to issue` is enabled it also sets the column from that link, and the owner's Status → Gate write right after corrects the automatic jump rather than fighting it — the owner's write is what the law relies on) |
| Gate PASS | Status → Validation |
| `change-validator` PASS / PASS WITH FINDINGS | Status → Merging |
| Merged + finished | Status → Done + **one final comment, 2–4 lines**: what changed, PR number, anything the human should know |
| Parked | Status → Parked + the legible reason comment |
| Gate attempt failed | Nothing on the board (Status stays Gate or returns to Implementing); the detail lives in the PR/commits |
| `change-validator` REJECT | Status → Implementing + ledger line (the failed attempt's detail lives in the PR/commits, not the board) |

## GitHub API discipline — reads are budgeted like writes

Every session, every workflow and every machine authenticates as **one GitHub account**, and
the account is the quota: **5000 GraphQL points per hour**, and separately 5000 REST requests
per hour (`gh api rate_limit` shows both buckets; a second PC adds nothing). On 2026-08-25,
five sessions re-reading the board in a loop emptied the GraphQL bucket and the board went
unreadable for ~5 minutes, mid-claim. The rules below make that behaviour impossible to write
by accident: if there are ever too many requests, it must be because of a real need, never
because a session used the API badly.

**The costs are measured, not guessed** — measured 2026-08-25 by asking `rateLimit { cost }`
inside the query, which is the measure every hand-written call carries (rule 3):

| Call | Bucket | Cost |
|---|---|---|
| `gh project item-list 1 --limit 100` | GraphQL | **~103 points** — its generated query nests every field's options inside every field value of every item, and pulls every card body |
| the claim read (§ gh CLI recipes) | GraphQL | **2 points** |
| the single-item handshake re-read | GraphQL | 1 point |
| one `item-edit` / issue mutation | GraphQL | ~1 point |
| `gh api repos/…` (issue, PR, branch, comment) | REST | 1 request, the other bucket |
| `gh api rate_limit` | neither | **free — and still answers when a bucket is empty** |

~48 `item-list` calls end the hour for every session at once. That is why a session never
reads the pool with `gh project item-list`: the claim read returns the same decision data
*plus* the ids `item-edit` needs, fifty times cheaper (2 points against 103, both measured
2026-08-25 on this board). (`item-list` stays fine for a human
one-off at a terminal; it is the loop and the fan-out that killed the board.)

**The five rules:**

1. **Reads happen at state transitions only, exactly like writes.** One pool read at claim —
   the claim read, once; it carries the board, the blocked set and every project/field/option
   id the claim's writes take. The handshake re-read is the single-item recipe, never a second
   listing. A back-off to the next candidate reuses the first read. After the claim, milestone
   writes are blind `item-edit`s: nothing between claim and Done re-reads the pool.
2. **Never poll GitHub for a state that has a local surface.** The bench verdict is the exit
   code of `npm run gate` (one background command) and `~/.spo-bench/verdicts/<sha>.json`; the
   nightly is `~/.spo-bench/nightly/latest.json`. Neither is ever asked of GitHub. Reservation
   liveness is the one state with no local surface — it is a ref read, and it is already folded
   into the claim read's own batched call, so it costs no extra poll. The only GitHub-only waits
   are **CI and the merge queue**: check once when you arrive — CI normally concluded while
   the gate was queued — and if something is genuinely pending, re-read at **≥ 30 s**
   intervals, over REST (`gh api repos/Crazz-Org/SPO-WebClient/pulls/<N>`), the way
   `scripts/deps-gate.sh` waits for its merge, and **for at most 20 polls or 10 minutes,
   whichever comes first** — "a hard deadline" is not a number, and a wait that never states
   one is a wait a background loop can run forever without anyone noticing. **That wait is a
   script, not a line you compose**: `npm run pr:wait -- <N>` is exactly this rule — REST,
   the 30 s floor (refused below it, never clamped), both bounds, and an exit code for the
   answer (0 merged · 1 closed unmerged · 4 still open). Four hand-rolled
   `until … do sleep 5 … done` loops were proposed here on 2026-08-25, three of them polling
   at 5 s. `npm run bench:wait -- <job-id>` is the counterpart for a bench job whose wait was
   interrupted. (A `poll-loop-guard.sh` hook used to refuse that shape mechanically; it was
   retired with the pilot hook layer in #425, so this is now a rule, not an enforcement.) A tight retry
   loop on any GitHub error is never correct: on failure, read the bucket's `reset` from
   `gh api rate_limit` (free) and wait once, in the background, until then. The same rule
   [doc/E2E-POLICY.md](E2E-POLICY.md) states for live evidence holds for a watch loop too —
   a crash is a failure, but silence is not a pass: a watcher that has printed nothing is
   suspect, not calm, and its own bound is what tells you which.
3. **Ask the price inside the query.** Every hand-written GraphQL call includes
   `rateLimit { cost remaining resetAt }` — it costs nothing and turns drift into a number in
   the transcript instead of a discovery at exhaustion. The session's final report states the
   last `remaining` it saw. Below **500 remaining**, stop every optional read and say so: what
   is left belongs to claims and milestone writes.
4. **REST where GraphQL is not required.** Projects v2 items and fields, issue dependencies
   and project workflows exist **only** in GraphQL — those reads are the budget's legitimate
   owners. Issues, PRs, comments, labels and branches all exist in REST, and `gh issue …` /
   `gh pr … --json` go through GraphQL even when they look REST-shaped — for a repeated or
   bulk read of those, prefer the `gh api repos/…` form and spend the other bucket. The MCP
   GitHub tools spend this same account's quota and are bound by every rule here
   (`search_issues` also draws on the search bucket, 30/min). The recipes below are the
   sanctioned forms; a GitHub read outside them needs a reason the session's report can state.
5. **`RATE_LIMITED` mid-claim: the write half decides.** The handshake is write → re-read. If
   the **write** failed rate-limited, nothing landed: the card is untouched, you own nothing —
   claim nothing else, wait for `reset` (rule 2), then start the handshake over. If the write
   succeeded and the **re-read** is what failed, the card is provisionally yours and must not
   be abandoned half-claimed: wait for `reset` in the background, then finish the re-read. A
   session that must end before the bucket resets names the card and the unverified write in
   its final report — that report is what lets the human read the board instead of discovering
   a locked card. Ownership law 3 — every owner closes its ownership — binds the rate-limited
   case too.
6. **Never assert another card's state from memory.** Rule 1 forbids re-reading the *pool*
   between claim and Done, but a session's own claim-time snapshot of *other* cards goes
   stale within minutes — a PR merges, a card moves — and several sessions run at once
   precisely on that pool. A session may cache what it owns (nobody else writes its own
   card); anything it is about to *state* about another card — in an issue comment, a PR
   body, or its final report — it re-reads first, with `scripts/board-status.sh <n>…`
   (`npm run board:status -- <n>…`): one call, ~1 GraphQL point regardless of how many
   issue numbers are passed, because it reads each named issue's own project item and
   linked pull requests, never the pool. This is the single-item shape of rule 1's
   handshake re-read, generalised to any card a session is about to talk about — not a
   second listing, and not covered by rule 2's "no local surface" exemption, because the
   board has none.

## Feeding rule (replaces the BACKLOG-OPEN feeding rule)

**A card is filed deliberately, never in passing.** The board is fed by the surfaces whose job
is to feed it — `/triage-report` draining the queued bug reports, a maintainer asking for a card
by name, a claimed task that turned out to be two, the `Nightly: main is red` repair filed when
the nightly proof says `main` is broken, and a
`PASS WITH FINDINGS` verdict from the `change-validator` sub-agent (§ 3) — and by nothing
else. That last one is on the list because it is not a finding met on the way: it is a
consequence of the change the card produced, bounded to ground the diff touched, and the
session that ran the validation is the surface whose job it is to file it. The one before it
is on the list because it is not a finding met on the way either: it is the only
admissible work while `main` is red, so the session that reads the verdict is the surface whose
job it is to file it. **§ 0.5 is on the list for the same reason** — the journal entry was
produced by machinery whose one job is to record an uncovered command, not by a session
noticing something while working on its own card, and the session draining the journal is the
surface whose job it is to file what it finds. A session driving a
card solves and implements *that* card: what it met on the way is neither filed nor written
into its final report, because a test session or a requested audit finds it again at a moment
where someone asked for it. Widening a session's scope is the maintainer's call.

What is filed lands **as a new issue on the board**, in Todo (bottom — the human prioritises),
with `Category` set and a synthetic body: what is wrong or missing, key `file:line` references,
source (journey/date).

**Set the matching label too**, not only the project field. The field is the board's truth;
the label is the only projection a workflow or `gh issue list --label` can read — GitHub
cannot query a project field, and the emoji in the title is not a query either.

| `Category` | label | | `Size` | label |
|---|---|---|---|---|
| 🔴 Defect | `cat:defect` | | S | `size:S` |
| 🟠 Latent trap | `cat:latent-trap` | | M | `size:M` |
| 🟡 Feature/Gap | `cat:feature` | | L | `size:L` |
| ⚪ Observation | `cat:observation` | | | |
| 📚 Doc/Infra | `cat:doc-infra` | | | |

Pull requests are labelled by **path**, automatically (`actions/labeler`, `.github/labeler.yml`)
— `rdo`, `gateway`, `client`, `renderer`, `e2e`, `bench`, `ci`, `documentation`.
Never post those by hand.

### The card review — a neutral reader before the pool

**Before the `gh issue create`, the draft card goes to the `card-reviewer` sub-agent**
([.claude/agents/card-reviewer.md](../.claude/agents/card-reviewer.md)) — title, body,
`Category`, `Size`, `Area`, verbatim, and nothing else. It is read-only, it carries none of the
finder's context, and it does not want the work.

Why: a pull request has had a second reader since #143. A card had none — the session that
finds something also judges it worth doing, sizes it and picks its `Category`.

**`Area` is checked here because nothing else checks it.** No workflow sets it, the orchestrator
only fills it *after* a claim, and the claim rule reads it: a card filed without one is
claimable by anyone and reserves no ground, which is the overlap § The areas exists to
prevent. On 2026-08-25, 22 of 49 Todo cards had none — two of them filed after the field
shipped ([#236](https://github.com/Crazz-Org/SPO-WebClient/issues/236)). The cost of a
misread claim, a duplicate, a card with no `file:line` or no statement of what *done* looks
like lands entirely on whoever claims it, never on whoever wrote it. That is the same
asymmetry the English-only rule above exists to prevent.

Three verdicts, and what each does to the flow:

| Verdict | The session |
|---|---|
| `FILE` | Files the card as written. |
| `FILE AMENDED` | Applies the named corrections — body, `Category`, `Size`, `Area` — then files. |
| `DO NOT FILE` | Files nothing, and says nothing of it in its final report. |

`DO NOT FILE` names the code, the issue number or the commit that makes the finding moot — or,
for a card whose ground truth is in another repo, the tracker to refile on. It is never about
priority: **priority is the human's**, and a real but low-value finding is
still filed, at the bottom of Todo like any other.

**The trace.** Immediately after creating the issue, the session posts the verdict
**verbatim as the card's first comment**, dated (`### Card review — <YYYY-MM-DD>`). Every
comment on this board posts as the same GitHub account, so that heading — not the author
line — is what marks the card as read by something other than its writer. A card whose first
comment is not a verdict is visibly unreviewed; that visibility is the enforcement, and
[src/\_\_tests\_\_/card-reviewer-agent.test.ts](../src/__tests__/card-reviewer-agent.test.ts)
keeps the four surfaces of the mechanism — this rulebook, the agent, `/triage-report` and
CLAUDE.md — from drifting apart.

**What does not change.** The claim handshake is untouched. No human step is added. No
session ever waits on another session's review: the cost is one sub-agent inside the
finder's own turn, and it is paid by the finder rather than by the claimer.

## Context discipline for sessions

- A good context stays **under ~250k tokens**. A session may deliberately exceed it when
  the task's goal justifies it — its call.
- Delegate heavy reads to sub-agents (screenshot reads are mandatory delegation; large
  inventories, cross-corpus audits, multi-file investigations should be).
- Compact deliberately: when the exploratory phase is over, summarise what matters and
  drop the rest.

## Sub-agent handoffs

**The spawn is the cost, not the payload.** Every sub-agent invocation re-pays a fixed
preamble — the project instructions, the agent definition, the tool schemas it was granted —
before it reads the first word of its task. Measured on this repo: `CLAUDE.md` alone is
~5.4k tokens (was ~8.8k before #671) and `card-reviewer.md` ~1.7k, against a task payload of ~150. Re-encoding that
payload from Markdown prose to a `key: value` block saves ~40 tokens — real, and worth
taking, but it is a rounding error next to the four levers above it.

In descending order of what they actually save:

1. **Spawn fewer agents.** Two questions for the same reader are one prompt. A one-liner is
   a direct tool call, never an agent (§ Delegation strategy, below).
2. **Grant the narrowest tool set.** An agent declared `tools: *` inherits the whole MCP
   surface; the five agents in `.claude/agents/` declare `Read, Grep, Glob, Bash` — or less,
   `citation-verifier` needs no `Glob` — and stay that way. Prefer them, or `Explore`, over a general-purpose spawn.
3. **Pass pointers, never bodies.** `src/server/session/push-dispatcher.ts:88` costs eight
   tokens; the function pasted around it costs four hundred, and the agent can open the file
   itself. The one exception is content that does not exist on disk — a draft card, a
   verdict — which is exactly what the payload block is for.
4. **Cap the reply in the prompt.** Name the shape you want and forbid the rest: no
   preamble, no restatement of the task, no summary of what was read, no closing offer.
   A reply that opens with "I have analysed the file you mentioned" is billed twice — once
   as the agent's output, once as the session's input.
5. **Then the encoding.** Compact `key: value`, one field per line, for anything the session
   consumes; **Markdown for anything posted verbatim** to GitHub or read by the human — the
   `card-reviewer` verdict becomes an issue comment, so encoding it as YAML only means
   rendering it back to Markdown afterwards, at a net loss.

### Delegation strategy

- **Skills first** — they load into the main conversation, keep context unified, cost nothing to spawn
- **Sub-agents** for work that produces heavy intermediate output: screenshot reads
  (mandatory), cross-corpus RDO audits, deep multi-file investigations
- **Explore agents** (up to 3 in parallel) when scope is genuinely uncertain
- **Direct tools** for anything targeted — never spawn an agent for a one-liner
- **Never delegate understanding.** Do not write "based on your findings, fix the bug."
  Synthesise the agent's results yourself, then act.
- **Model routing — most steps are not execution.** Run each step on the cheapest model it
  needs and escalate by isolating the hard step, never by raising the floor for all of them.
  Fable 5 for planning and diagnosis; Sonnet 5 for ordinary execution; **Opus 5 only where
  being wrong is not caught by a test** — the RDO wire, an `L`-sized card, an unreproduced
  defect. Effort follows the card's `Size` (S low · M medium · L high). The **per-step** table
  is not prose anywhere: it is executable config in SPO-Pipeline
  `orchestrator/step-contracts.js` (`doc/state-machine-spec.md` § Step contracts). What stays
  in § Model routing, below, is the escalation policy
  only. A session that cannot switch its own model applies the routing to its sub-agents.

## Model routing

**Most of a task is not execution.** Picking a card, waiting on the gate, writing the PR body
and moving the column are the bulk of the steps, and none of them is judgement. Pricing them
all at the rate of the hardest step is how a board of S-sized cards ends up billed as Opus.

So the rule is inverted from the obvious one: **run each step on the cheapest model that step
needs, and escalate by isolating the hard step**, never by raising the floor for all of them.
The orchestrator applies this per step rather than per session, which is why the routing is
configuration and not prose — a `claude -p` call is pinned to its own model, effort and tool
set.

### The steps of a task, and what each one is worth

The per-step model and effort routing is **not** kept here any more. The orchestrator owns it,
as executable configuration rather than prose: SPO-Pipeline `orchestrator/step-contracts.js`,
documented in its `doc/state-machine-spec.md` § Step contracts. A table in this file could only
drift away from the thing that actually spawns the models.

What stays here is the policy the routing has to honour — which work earns Opus, and how effort
follows `Size`.

### Escalation — what actually earns Opus 5

Opus is for execution whose **cost of being wrong is not caught by a test**:

- anything touching the RDO wire — `src/shared/rdo-*`, `src/server/rdo.ts`,
  `rdo-members.ts`, the session phases (CLAUDE.md: *a wire divergence is not replaceable*);
- an `L`-sized card, or one whose change spans more than ~5 files;
- a 🔴 Defect or 🟠 Latent trap whose reproduction is not yet understood.

Everything else — `S`/`M` cards in `client`, `docs`, tests, mechanical sweeps, renames,
a change the failing test already describes — is **Sonnet 5** execution. Reach for Opus when
the first Sonnet attempt is wrong in a way that is about judgement rather than about a
missing fact; do not pre-emptively route to it because the card looks important.

### Effort follows `Size`, not the model

| `Size` | plan effort | execution effort |
|---|---|---|
| S | low | low |
| M | medium | medium |
| L | high | medium, raised to high only after a first attempt fails |

Two adjustments: a card whose `Category` is 🔴 Defect or 🟠 Latent trap gets **one notch
more** on the plan step (the diagnosis is the work); a gate retry gets one notch more than
the attempt that failed, never the same effort twice.

### Applying it

Whatever model the session was started with, it is entitled to switch to comply. If the
harness cannot switch the session's own model, apply the routing to its **sub-agents**
(`model: haiku` / `model: sonnet` / `model: fable` / `model: opus` on the Agent tool or on
workflow `agent()` calls). A `.claude/commands/*.md` file may also pin a whole command with
`model:` frontmatter — `coverage-check` and `release-notes` do, because they are single-step
and read-only. A multi-step command must **not**: pinning one model across steps that differ in
kind is exactly the mistake this section exists to prevent.

## gh CLI recipes

The project scope is required once per machine: `gh auth refresh -s project` (run inside WSL).

`jq` (1.7+) is required by four scripts that call the `jq` binary directly:
`scripts/claim-read.sh` (15 standalone `jq` calls), `scripts/board-take.sh` (14),
`scripts/board-move.sh` (9) and `scripts/nightly-check.sh` (6) — `apt install jq`. Seven
other scripts pass `--jq` to `gh` itself (its own built-in JSON filter, no separate binary
needed) and work with no `jq` installed.

**The reads are npm aliases, and that is deliberate.** `board:claim`, `board:verify`,
`board:status` and `bench:nightly` each wrap one script under `scripts/`.
The orchestrator spawns them by alias and branches on their exit codes, so the query has one
definition and one place to change it — **the query belongs in the script, never in the caller**.
Change a query by editing its script; do not paste one back into this file.

```bash
# THE CLAIM READ — one query, ~2 GraphQL points per page (4 on today's 116-item board),
# everything a claim needs: every card with Status/Session/Area in board order (topmost
# Todo first = priority order), the blocked set, the project/field/option ids item-edit
# takes, and the price of asking. Run it ONCE per claim.
# Never read the pool with `gh project item-list` in a session: same data, ~103 points
# (§ GitHub API discipline). The busy set is computed inside this call, never by a second one.
npm run board:claim                        # the query lives in scripts/claim-read.sh
# The `busy areas:` line IS the busy set (§ One session per area) — derived inside this one
# call, never fetched by a second: Planning, Implementing, Checks & PR, Gate, Validation or
# Merging, `docs` excluded because it never
# blocks. It is computed rather than eyeballed off the item lines so the rule stays executable;
# `$cards` is bound once and both outputs read it.
# The blocked lines: `issueDependenciesSummary { blockedBy }` counts OPEN blockers only, so a
# closed blocker frees the card by itself. The board side paginates itself now; only
# `issues(first: 100)` remains a raise-when-exceeded number (41 open today).
# jq is available, but gh's own `--jq` runs once per page under `--paginate`, so it cannot
# sum rateLimit.cost, dedupe the metadata, or compute a busy set across pages — hence `jq -s`
# over the whole stream: the whole claim read is one program over one response, and not a
# saved file filtered twice.

# Re-read before stating another card's status anywhere durable — a comment, a PR body, the
# final report (§ GitHub API discipline, rule 6). ~1 point for any number of issues.
npm run board:status -- 144 106            # scripts/board-status.sh

# The handshake re-read — ONE item, ~1 point, after writing `Session`. Never a second listing.
# It prints Session, Status and Area, so a single call proves all three claim writes landed.
npm run board:verify -- <ITEM_ID>          # the query lives in scripts/claim-verify.sh

# Move a card (single-select field, e.g. Status) — every id below comes from the claim read
gh project item-edit --id <ITEM_ID> --project-id <PROJECT_ID> \
  --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>

# Claim (text field Session)
gh project item-edit --id <ITEM_ID> --project-id <PROJECT_ID> \
  --field-id <SESSION_FIELD_ID> --text "<branch> @ <date>"

# Fill Area before the card moves out of Todo (single select, like Status)
gh project item-edit --id <ITEM_ID> --project-id <PROJECT_ID> \
  --field-id <AREA_FIELD_ID> --single-select-option-id <OPTION_ID>

# The blocked set — Todo cards that cannot be claimed — is the tail of the claim read above:
# ONE call for the whole pool, never one per card, and never a separate query beside the claim.

# Record a blocking order (§ Blocking order)
npm run board:block -- <blocked-issue> <blocker-issue>  # scripts/board-block.sh

# A SANCTIONED filing → card review → issue → board (label = the queryable mirror of
# Category/Size). "Sanctioned" is the whole point: § Feeding rule lists the surfaces that may
# file — /triage-report, a split, a card asked for by name, § 0's nightly repair — and a
# finding met while driving a card is NOT one of them. This recipe is how those surfaces file,
# never a licence to file what you noticed on the way.
# The draft goes to the `card-reviewer` sub-agent FIRST; on DO NOT FILE, nothing below runs.
gh issue create --repo Crazz-Org/SPO-WebClient --title "…" --body-file <file> \
  --label "cat:latent-trap" --label "size:M"
gh issue comment <N> --repo Crazz-Org/SPO-WebClient --body-file <file>  # <the verdict, verbatim>
# `Auto-add to project` + `Item added to project` put the card in Todo on their own.
# Only if a card has not appeared after ~30 s (a workflow was turned off):
gh project item-add 1 --owner Crazz-Org --url <ISSUE_URL>

# Final comment
gh issue comment <N> --repo Crazz-Org/SPO-WebClient --body-file <file>
```

### Two gh commands that fail on this repository

**`gh pr edit` does not work on this repository.** Every invocation fails with `GraphQL:
Projects (classic) is being deprecated …`, exit 1, **and applies nothing** — on stderr, so a
piped or backgrounded call reads as success while the PR is unchanged. Use REST: `gh api -X
PATCH repos/Crazz-Org/SPO-WebClient/pulls/<N> --input <json>`.

**The same deprecation kills the _bare_ `gh pr view` and `gh issue view`.** Both ask for
`projectCards`, so `gh pr view <N>` and `gh issue view <N>` exit 1 on
`(repository.pullRequest.projectCards)` / `(repository.issue.projectCards)` and print nothing
usable — the error is on stderr, so a piped or backgrounded call reads as success again.
**`--json` never touches that field and works**: `gh pr view <N> --json state`,
`gh issue view <N> --json state,title`. That is why nothing in the tree is broken — every
caller already passes it (every `gh pr view` / `gh pr list` in `scripts/finish.sh` and `scripts/deps-gate.sh`). Read a
PR or an issue with `--json`, or with REST (`gh api repos/Crazz-Org/SPO-WebClient/issues/<N>`).
⚠ `.github/workflows/claude-review.yml:123` allowlists the bare `gh pr view`, so the review
agent meets the same wall. `gh pr create`, `gh pr merge` and `gh issue list` are unaffected.

The entry point for a working task is the **orchestrator** in the sibling
[SPO-Pipeline](https://github.com/Crazz-Org/SPO-Pipeline) repo — it encodes the claim handshake
and the milestone writes, driving them through the `board:*` aliases below; this document is the
rulebook it follows.

## While `main` is red — the nightly rule

The bench proves **branches**, each against the `main` it was based on. Two branches that
each pass alone and break together therefore land unchallenged: the mixture is never driven
live. One nightly run of the L2 flows against `origin/main` closes that gap — the worker
deposits it itself when the queue is idle, and publishes the answer to
`~/.spo-bench/nightly/latest.json`. Mechanism:
[bench-worker.md § The nightly proof of `main`](bench-worker.md).

**`main` is red** when that file's `verdict` is `FAIL` *and* its `sha` is still what
`origin/main` points at. A verdict of `ENVIRONMENT` or `INTERRUPTED` is not red: the run
never learned anything about `main`, and an unproven `main` is where the project already
stood every night before this existed.

Two rules follow, and they bind every session:

1. **The orchestrator hands out only the repair.** No new card is claimed while `main` is red.
   The repair is an ordinary card — issue `Nightly: main is red`, claimed, gated, merged like
   any other — it is simply the only one on offer.
2. **No session merges `origin/main` into its branch.** Updating from `main` must never
   import a defect. A branch already based on the last green `main` keeps working; its
   attestation records that `baseMain`, and the honest note the push hook prints about a
   moved `main` is exactly the signal to wait rather than sync.

**When the red is not the code.** A nightly can FAIL for a reason that has nothing to do with
`main` — on 2026-09-13 a run recorded `FAIL` at `609928f1` behind twelve
`connect ETIMEDOUT 158.69.153.134:8000` lines. `main` is immutable at a sha, so that red
sticks to the tip until somebody pushes a commit, and rule 1 parks every card in the meantime
(39 of them by 13:00Z that day). A **maintainer** who has opened `logFile` and believes the
failure was the environment may ask for the same tip to be re-driven:
`npm run bench:nightly-request -- --reason="…"`. It confirms the tip with them, leaves a
marker, and the worker deposits the job from its own idle branch like any other nightly — the
proof turns `main` green only if it actually passes, and a run that breaks on the environment
again leaves the red exactly where it was. **A session may not ask for one, and the command
refuses to run inside one** (exit 5): asking for a re-measurement is asking past rule 1, and
that judgement is the maintainer's. Mechanism:
[bench-worker.md § The nightly proof of `main`](bench-worker.md).

Why the rule is written here rather than enforced by a hook: a red `main` is the moment the
board's priority order stops being the human's to set, and that is a rule about *dispatch* —
the thing this document governs. A hook refusing merges would also have to be sure which
`main` a branch is being updated *from*, and would refuse the repair itself.

**This does not conflict with merged-tree gating** (bench-worker.md § The gate base,
"Gating the merged tree, not the branch"). When a branch is behind `main`, every gate —
red `main` or green — merges `origin/main` into the worker's own throwaway checkout before
judging it, so it tests the tree that would actually land. That merge is ephemeral: it
happens in `<bench>/ref/checkout`, never touches the branch's own history, and nothing is
pushed. Rule 2 above is about a session running `git merge origin/main` **on its branch** —
a real commit a session would otherwise be tempted to add to sync with a red `main`. If a
gate on a branch behind a red `main` fails because the worker's merge exercised main's own
defect, that is the gate doing exactly what it is for; it is not the session having synced,
and it is not grounds to treat the branch's own code as at fault.

**The misattribution this prevents** is the whole point. Without it, a later session claims a
card, gates it, and burns its three attempts ([E2E-POLICY.md](E2E-POLICY.md) §8) on a
regression it did not write, on ground it does not own. The failure is cheap; being unable to
tell whose failure it is, is not.
