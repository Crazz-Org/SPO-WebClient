# In-app bug reporting

A manual test session finds more than it can write down. Noticing a wrong number, stopping to
describe where it was, which account, which world, what had just happened — that is a minute of
typing per finding, and on a phone it ends the test session outright. Most findings never get
written down at all.

This feature removes the writing. The maintainer flags what looks wrong, the client captures the
context that was already there, and a JSON report lands in a local queue. Later, a
[`/triage-report`](../.claude/commands/triage-report.md) session reads that queue and files
proper kanban cards, on its own.

**It is dev-only.** Off by default, and in a normal deployment the deposit endpoint does not
exist — it answers `404`, not `403`, because nothing about the response should suggest it might.

> **The schema is [`src/shared/bug-report-schema.ts`](../src/shared/bug-report-schema.ts).**
> Every field, every limit and the validator live there and are deliberately not restated in this
> document — a second copy of a contract drifts from the first, and the drift is invisible until
> a report is rejected.

## Enabling it

One flag, `SPO_BUG_REPORT=true`, read by both halves: the gateway serves the deposit endpoint,
and the client mounts the capture UI.

The gateway passes the flag to the browser by injecting `/spo-runtime-config.js`, which sets
`window.__SPO_BUG_REPORT__`; the client prefers that over its own build-time environment
([`src/shared/config.ts:31`](../src/shared/config.ts)). So the browser follows the gateway it is
talking to, and no client rebuild is needed to turn the feature on or off.

### On the bench (`npm run dev`)

⚠ **Setting the flag in your own shell does nothing.** `npm run dev` deposits a job file and
waits; the gateway is started by the **bench worker**, from the worker's environment
([`bench-submit.sh`](../scripts/bench-submit.sh) passes none, and
[`runJob` in `worker.ts`](../src/e2e/bench/worker.ts) builds the gateway's environment as exactly
`E2E_WORLD_STATE_DIR` and `SPO_CACHE_DIR`). `SPO_BUG_REPORT=true npm run dev` is inert.

The flag has to live in the worker's own environment:

```bash
systemctl --user set-environment SPO_BUG_REPORT=true && systemctl --user restart spo-bench-worker
```

and to turn it off again:

```bash
systemctl --user unset-environment SPO_BUG_REPORT && systemctl --user restart spo-bench-worker
```

Leaving it on between test sessions is safe but not free of effect. On the gateway it adds one
`<script src="/spo-runtime-config.js">` tag to `index.html`
([the `index.html` injection in the `http.createServer` handler of `server.ts`](../src/server/server.ts)) — the L2 live drive is a headless `ws` client that
never loads the HTML, so gates and nightly runs are untouched. A browser, though, gets the
capture UI: nothing visible on desktop until F8, but on mobile the floating button is there,
which is a distraction during an L3 pass. Turn it off when you are done.

The queue lands in the **worker's** `~/.spo-reports`. Same machine, same user, so a triage
session finds it where it expects to.

### On a session-owned gateway (`npm run dev:local`)

```bash
SPO_BUG_REPORT=true npm run dev:local
```

Here the flag works the ordinary way, because the session starts the gateway itself. It binds the
first free port from 8081 up — never 8080, which
[`bench-port-guard.sh`](../.claude/hooks/bench-port-guard.sh) enforces. Its results attest
nothing, which does not matter for capture: a bug report is an observation to be reproduced
later, not a proof.

## The two profiles

The profile is chosen by `useResponsive().isMobile`, not by a setting, and the two answer
different questions.

| | `desktop` | `mobile` |
|---|---|---|
| Answers | **is this number right?** | **is this usable?** |
| Arm | `F8` | tap the floating button |
| Capture | the next click | the next tap |
| Describe | *observed* (pre-filled) and *expected*, typed | six one-tap picks, free text optional |
| Extra evidence | canvas screenshot on a map target | a `geometry` block — numbers, no screenshot |
| Triage files | a data-correctness card | an ergonomics card |

Both capture the same anchor and the same journal; they differ in what they ask the human for and
what they measure.

### Desktop — F8, then click

`F8` arms report mode and `F8` again disarms it. The next click is intercepted in the capture
phase, so the control never fires: flagging a button does not press it.

A click on the map canvas takes a different path — the DOM cannot describe a tile — and is
recorded as a tile anchor plus a JPEG of the canvas. Everywhere else the anchor is the React
component chain, the CSS chain and the element's text.

Then a modal, with *observed* pre-filled from what the element actually displayed and *expected*
for you to type. Typing is affordable here; it is the profile where the exact number matters.

### Mobile — the button, then tap

A 56 px floating button, draggable, its position kept in `localStorage` under
`spo-report-fab-pos`. A movement under 8 px is a tap and arms report mode; more is a drag. It
paints on `--z-hud` (350), above the shell and the info bar and below the nav bar and every
sheet — it must never sit on top of the sheet it just opened. Being outside the canvas and
outside `MobileShell`, it does not disturb pan or zoom.

Then a bottom sheet with six picks — *Too small · Covered · Out of reach · Cut off · Does not
respond · Wrong data* — multi-select, and an **optional** free-text field. Picks alone make a
submittable report, and that is the point: two taps, and the test session continues.

**No screenshots, and no `html2canvas`.** The reason is usefulness, not cost. A PNG forces the
triage session to delegate its reading to a sub-agent, and yields an impression. What an
autonomous session can act on is numbers — `target 28×28 px, below the 44 px minimum`, `covered
by html > body > nav.bottom`, `escapes its parent: right 12 px` — read from
`getBoundingClientRect`, `getComputedStyle` and `elementFromPoint`, with no dependency, and
directly comparable against a threshold.

The threshold itself is **not** stored. The report carries the measured rect, which stays true;
`isUndersizedTarget`, `isKeyboardOpen` and `describeTarget` in
[`src/client/report/geometry.ts`](../src/client/report/geometry.ts) are applied by triage, so a
report judged next month gets that month's answer rather than the one frozen at capture.

## The journal — the 60 seconds before the flag

The journal is armed when the client mounts, not when report mode is armed, and runs
continuously. Nobody arms a mode *before* noticing a problem; the seconds that led up to the flag
are the evidence.

It records clicks, surface pushes and pops, every WebSocket frame in and out **verbatim**, and
any `console` error or warning — the last especially, because a phone has no devtools. The taps
are in [`src/client/client.ts`](../src/client/client.ts) (`:568`, `:592`, `:980`) and cost
nothing when the journal is not armed.

## The queue

Reports land as one file each in `~/.spo-reports`, named
`<createdAtUtc>_<profile>_<anchorKey>.json` with the timestamp's `:` and `.` replaced by `-`.

**It sits outside the worktree on purpose.** `npm run finish` retires worktrees; a queue inside
one would disappear with the branch that produced the reports, which is exactly when they are
still waiting to be triaged.

Two fields carry more weight than their size suggests:

- **`createdAtUtc`** — UTC to the millisecond. It is the key that lets triage grep
  `FIVEMODELSERVER/Survival <date>.log` at http://158.69.153.134/logs/ and prove whether the
  frame reached the object. The gateway stamps its own `receivedAtUtc` on deposit, so the two
  clocks bracket the moment — triage greps a window spanning both, never a single second.
- **`anchorKey`** — a stable hash of the component chain and text, or of the tile and layer. Two
  reports of the same problem share it, which is how triage merges repeats instead of filing a
  card per re-flag.

`/triage-report` empties the queue: every report it reads ends in `~/.spo-reports/archive/` with
a one-line disposition beside it, whether it became a card or not.

## F8 is not in the `SHORTCUTS` table

Every other global shortcut is registered in
[`useKeyboardShortcuts.ts`](../src/client/hooks/useKeyboardShortcuts.ts), whose `SHORTCUTS` table
is the single source of truth and is what the Settings dialog renders its list from. F8 is not
there. It has its own `window` listener in
[`BugReportRoot.tsx`](../src/client/report/BugReportRoot.tsx).

That is deliberate, and it is the one exception. `SHORTCUTS` describes the shortcuts a *player*
has; F8 exists only when `SPO_BUG_REPORT` is on, and listing it would put a key in the Settings
dialog that does nothing in every build a player will ever run. The mount point is lazy for the
same reason — a build without the flag never fetches the chunk.

## Proving it end to end

Roughly ten minutes, no phone required for the first half.

1. **Turn it on**, by either route above, and confirm the gateway is serving the endpoint. With
   the feature off this must answer `404`:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:8080/api/bug-report
   ```
   With it on the same call answers `400` — the endpoint exists and the empty body failed
   validation, which is the answer you want.
2. **Log in** and reach a screen with real data.
3. **Press F8**, then click a control showing a number. The control must not fire.
4. **Fill *expected*** and submit. A toast reports the queue filename.
5. **Check the file**, and that it validates:
   ```bash
   ls -1t ~/.spo-reports/*.json | head -1
   ```
   Confirm it carries a non-empty `journal`, an `anchor` matching what you clicked, and a
   `receivedAtUtc` the client never sent.
6. **Flag the map canvas** with F8 and one click on a building: the anchor becomes a tile and the
   report carries a JPEG data URL.
7. **Mobile**, from a phone on the LAN pointed at the same gateway: the button is draggable and
   its position survives a reload; tapping it then tapping a cramped control opens the sheet; two
   taps submit. Deliberately flag one undersized control and one covered control, then check the
   deposited `geometry` numbers against what is on the screen.
8. **Triage it**: run [`/triage-report`](../.claude/commands/triage-report.md) and confirm the
   cards land on the board and the queue is left empty.

## Who does what

`/triage-report` **creates** cards from the queue and never implements one. The orchestrator
(sibling SPO-Pipeline repo) **claims and implements** cards and never reads the queue. A card born in the queue is an ordinary card from the moment it is filed: same
columns, same ownership law, same [kanban rulebook](kanban-workflow.md).
