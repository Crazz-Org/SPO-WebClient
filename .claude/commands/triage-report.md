---
description: Turn the queued bug reports in ~/.spo-reports into kanban cards — reproduce, route, dedup, review, file, archive — without asking the maintainer anything
argument-hint: "[a queue filename, to triage only that report]"
---

# Triage the bug-report queue

A manual test session flags what looks wrong and moves on; the report lands in a local queue.
This command is the other half: it reads that queue and files proper kanban cards, alone.

**The boundary, and it is not negotiable.** `/triage-report` **creates** cards and never
implements one. The orchestrator (sibling SPO-Pipeline repo) **claims and implements** cards, and
its daemon **also takes reports from this queue**: report intake (stage 1) runs every 15 minutes
by default, takes the oldest top-level `*.json` files, files each as a raw issue on the private
`Crazz-Org/SPO-Reports`, and moves it to `~/.spo-reports/pending/` (later `in-progress/`). The two
keep apart by moving a report out of the top level before working on it — triage into
`~/.spo-reports/triage/` (§ 1), the daemon into `pending/`. The daemon reads only the top level
and triage never reads the daemon's folders, so whichever moves a file first owns it. A session
that triages a report and then starts fixing it has taken work nobody prioritised — file the
card, move to the next report.

The feature itself is documented in [doc/bug-reporting.md](../../doc/bug-reporting.md); the board
rules are [doc/kanban-workflow.md](../../doc/kanban-workflow.md). Do not restate either here.

## 0 · Read the queue

```bash
ls -1 ~/.spo-reports/*.json 2>/dev/null | sort
```

Oldest first — the filename begins with `createdAtUtc`, so lexical order *is* chronological.
**Skip `~/.spo-reports/archive/`**: it holds what previous runs already disposed of. **Never
touch `pending/` or `in-progress/`**: those are the pipeline daemon's. A `*.json` still in
`~/.spo-reports/triage/` was left there by an interrupted run and is already claimed — take it
first, and skip § 1's claim step for it. With `$ARGUMENTS` naming a file, triage that one and
nothing else.

**Refuse a version mismatch rather than guessing.** Read `version` from the claimed copy, once
§ 1's first step has moved the file. Every report carries `version`; the only
shape this command understands is `BUG_REPORT_SCHEMA_VERSION` in
[src/shared/bug-report-schema.ts](../../src/shared/bug-report-schema.ts), which is the authority
for the whole shape — read it there, it is not copied here because a copy drifts. A report whose
`version` differs is archived with `disposition: schema-version`, and the mismatch goes in the
final report. Guessing at an older shape is how a field silently changes meaning.

An empty queue is a normal outcome. Say so and stop.

## 1 · Reproduce, before anything else

**First, claim the report** — take it out of the pipeline daemon's reach before any work on it:

```bash
mkdir -p ~/.spo-reports/triage
mv ~/.spo-reports/<file>.json ~/.spo-reports/triage/
```

The daemon's intake reads only top-level files, so it never sees a report in `triage/`. **If the
`mv` fails because the file is gone, the daemon took it first** (it is now in `pending/`): drop
that report — no archive, no disposition — and count it as "taken by the pipeline" in the end
report. From here on, the report is `~/.spo-reports/triage/<file>.json`.

**A report that was not reproduced does not become a card.** Take a bench lease and drive the
client yourself:

```bash
npm run dev
```

The report gives you everything needed to get back to the moment: `world`, `username`, the
`anchor` (the component chain and text, or the tile and layer), and the `journal` — the last
~60 s of clicks, surface pushes, verbatim `ws-out` / `ws-in` frames and any `console` error or
warning. Replay that sequence, not an approximation of it.

Reproduced → continue. Not reproduced → **§ 6**, archived, no card. Do not file a card that says
"could not reproduce": the claimer would start from nothing, which is the asymmetry the card
review exists to prevent.

## 2 · Route on `profile`

The two profiles are not two skins on one flow — they answer different questions, and each has
its own evidence standard.

### `desktop` → a data-correctness card

`Area` is usually `rdo` or `gateway`: the question is whether the number on screen matches what
the server holds.

**Server-log verification is mandatory.** Take `createdAtUtc`, `username` and `world`, then pull
the model server's log for that day from the open listing at http://158.69.153.134/logs/ :

```bash
curl -s "http://158.69.153.134/logs/FIVEMODELSERVER/Survival%20<YY-MM-DD>.log" -o /tmp/survival.log
```

The civic members log on entry, *before* their `try`, so a line there proves the frame reached
the object. Reading a log is **not** probing the live server — `doc/E2E-POLICY.md` §5 says so explicitly.
The log runs 2–3 MB/day: grep it, never read it into context.

⚠ **Clock skew — grep a window, not a second.** The client stamps `createdAtUtc` and the gateway
stamps `receivedAtUtc` on deposit from its own clock. Search a window spanning both, and record
which one the log line falls near.

Then correlate **element → store slice → WS message**: read
[`src/client/handlers/`](../../src/client/handlers/) and [`src/client/store/`](../../src/client/store/)
against the journal's verbatim `ws-*` entries. That correlation is the card's value — it is what
`report-submit.ts` deliberately does not attempt, because triage does it better with the tree open.

The card states, with `file:line`: what was shown, what the server holds, whether the frame
landed, and where the two diverge.

### `mobile` → an ergonomics card

`Area` is `client` or `renderer`. There are no screenshots by design; there are numbers, and the
`geometry` block is the evidence. **Quote the verdicts with their figures** — they become the
card's evidence lines verbatim:

```
target 28×28 px, below the 44 px minimum
covered by html > body > nav.bottom
escapes its parent: right 12 px
```

Apply the predicates in [`src/client/report/geometry.ts`](../../src/client/report/geometry.ts)
to the stored capture — `isUndersizedTarget`, `isKeyboardOpen`, `describeTarget`. **The threshold
is not a stored field, on purpose**: the report carries the measured rect, which stays true, and
running the predicate now gives today's judgement rather than the one current when the report was
filed. `isKeyboardOpen` returning `null` means the browser had no `visualViewport` — unknown, not
closed; do not write "the keyboard was closed" from it.

The `quickPicks` say what the human felt; the geometry says what was on screen. Where they
disagree, the numbers are the evidence and the picks are the symptom — report both.

## 3 · Merge repeats by `anchorKey`, before filing

`anchorKey` is the dedup key two reports of the same problem share — the same control flagged
twice produces the same key. **Merge within the batch first**, then check the board, or the queue
files a duplicate for every re-flag.

Every card this command files **embeds its key as a greppable marker in the body**:

```
<!-- anchorKey: a1b2c3d4 -->
```

That marker is what makes dedup work *across runs*, and it is the thing to search for:

```bash
gh issue list --repo Crazz-Org/SPO-WebClient --state all --search "anchorKey: <key> in:body" --json number,title
```

**A match adds a comment to the existing issue and nothing else.** Never a field edit, never a
status move, never a `Session` touch — whatever that card holds, and whoever owns it. That is
ownership law 1, and a triage session is not an exception to it. The comment names the new
occurrence: its date, its profile, and what differed.

## 4 · `Category`, `Size`, `Area`

`kind` pre-orients `Category` — it does not decide it:

| `kind` | `Category` |
|---|---|
| `wrong-data` | 🔴 Defect |
| `broken-action` | 🔴 Defect |
| `visual` | 🟡 Feature/Gap or ⚪ Observation — triage's judgement |

`Size` is the usual rough estimate. `Area` comes from the partition in kanban-workflow § The
areas — one per card, where the majority of the change lands. Set the project fields **and** the
matching `cat:` / `size:` labels: the field is the board's truth, the label is the only projection
`gh issue list --label` can read.

## 5 · The card review, then the filing

**Every draft goes to the `card-reviewer` sub-agent before `gh issue create`** — title, body,
`Category`, `Size`, `Area` and its labels, verbatim, and nothing else. `FILE` files it;
`FILE AMENDED` applies the named corrections first; any other change after the verdict goes
back to the reviewer; **`DO NOT FILE` files nothing**, and the final report says what was found and
why no card exists. The verdict is posted verbatim as the card's first comment, dated
`### Card review — <YYYY-MM-DD>`.

**English only.** `freeText` may well be French — the capture never asked the human to switch
language mid-test, which was the point. Translate it on the way in; never transcribe.

**The card is public; the report is not.** The card never names the reporter (`username`),
never quotes `observed`, `expected` or `freeText` — summarise them in English — and never
pastes a journal payload (`ws-in` / `ws-out` payloads, `console` messages). Message-type names,
`file:line` references and the on-screen `anchor.text` are fine. The rule, and what the check
cannot catch, are in [doc/bug-reporting.md](../../doc/bug-reporting.md) § What may reach the
public board.

**Check it before filing.** Write the title, the body and the review comment to one file, then
run the check once per report merged into the card — it takes one report at a time:

```bash
npm run report:card -- --check-public ~/.spo-reports/triage/<file>.json /tmp/card-<anchorKey>.md
```

Exit 0 → file. Exit 1 prints only the category (`leak: username` / `leak: free-text` /
`leak: journal`): fix the draft, send it back to the reviewer (it is a change after the verdict),
and re-run. **Never file on a non-zero exit** — 2 or 3 means the check failed, not that it passed.

Then file, comment, add to the board in Todo, and set the fields — the recipes are in
kanban-workflow § gh CLI recipes.

## 6 · Every report leaves the queue

Nothing stays behind: a report left in `~/.spo-reports/triage/` gets triaged again next run.

```bash
mkdir -p ~/.spo-reports/archive
mv ~/.spo-reports/triage/<file>.json ~/.spo-reports/archive/
```

Beside it, a one-line disposition sidecar `<file>.disposition.txt`:

| Outcome | Line |
|---|---|
| Filed | `filed: #<N> — <YYYY-MM-DD>` |
| Merged into an existing card | `duplicate: #<N> — <YYYY-MM-DD>` |
| Could not reproduce | `not-reproduced: <what was tried> — <YYYY-MM-DD>` |
| Reviewer said no | `do-not-file: <the verdict's reason> — <YYYY-MM-DD>` |
| Too thin to act on | `insufficient: <what was missing> — <YYYY-MM-DD>` |
| Unknown schema version | `schema-version: <found> vs <expected> — <YYYY-MM-DD>` |

## 7 · Ask the maintainer nothing

This is the half that makes the feature worth having. A report too thin to act on is **archived**
with `disposition: insufficient` — it is not a question back to the maintainer, who is not in the
test session any more and would have to reconstruct it from memory.

What happens instead: **the pattern of what was missing goes in the session report.** "Three
mobile reports carried picks but no `freeText`, and in two of them the picks alone did not say
which control was meant" is a capture bug worth a card of its own — filed like any other finding,
through the same review. That is the feedback loop that improves the capture. One report being
thin is noise; the same gap three times is a defect in what the capture asks for.

## Report at the end

Summary: how many filed, how many duplicates, how many skipped, how many taken by the pipeline. Then detail only the `DO NOT FILE` cases with the reviewer's reason.
