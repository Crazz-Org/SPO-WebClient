# E2E Testing — Canonical Procedure (L3, browser)

**This is the single source of truth for driving the app in a real browser.**
The gate — which layer a change must reach, and what counts as proof — lives in
[E2E-POLICY.md](E2E-POLICY.md). `.claude/commands/e2e.md` and the `e2e-test` skill are thin
pointers to this file.

> **L3 is now the narrow layer.** Regression coverage belongs to **L2**, the headless
> WebSocket drive in `src/e2e/` (`npm run test:live`), which reaches everything below the
> pixel. Reach for a browser run when the change is one a WebSocket cannot observe —
> rendering, layout, input, mobile — or before a release.

> **Selector status (verified live 2026-07-03):** the React UI no longer exposes the legacy
> `#inp-username` / `#btn-connect` / `#build-menu` IDs that older revisions of this document
> listed. Interaction is accessibility-first (roles, labels, titles). Verification is
> programmatic via `window.__spoDebug`.

## MANDATORY Test Credentials (DO NOT CHANGE)

> **These credentials MUST be used for ALL live E2E runs. NEVER modify, skip, or substitute
> them without EXPLICIT developer approval.**

| Field | Primary | Secondary |
|-------|---------|-----------|
| **Username** | `SPO_test3` | `Crazz` |
| **Password** | `test3` | `test` |
| **Region** | `Free Space` | `Free Space` |
| **World** | `planitia` | `planitia` |
| **Company** | `SPO_test3 - Green` | (its own) |
| **Holds** | **Mayor of Helartia**, Minister of Agriculture | a real player account — holdings not enumerated, and no flow depends on them |

- Pick **Free Space**, not BETA — the live directory hosts `planitia`/`shamba`/`zorcon` under Free Space; BETA only has `aries`.
- `SPO_test3` **has mayor powers** (verified live 2026-08-20, [civic-roles-reference.md](civic-roles-reference.md): `canGovern` true on the Town Hall). Road building, zone overlays and town governance are testable live. It is **not** president — see the exclusion in [E2E-POLICY.md](E2E-POLICY.md) §7.
- `Crazz` exists for what one account cannot do: permission-negative checks, mail
  send→receive, and rating another tycoon's term.
- **Blast radius** ([E2E-POLICY.md](E2E-POLICY.md) §9): mutations only on Helartia. The
  second account is touched only by the mail round-trip, which deletes what it sent in the
  same run — no flow touches its buildings. Never another player's assets, never a
  world-scope value, never demolish or create-company.

## Interaction Rules (React UI reality)

1. **Login stages render in a child frame** — page-level `document.querySelectorAll()` from
   `browser_evaluate` does NOT see them. Use `browser_snapshot` + ref clicks (or Playwright
   role/text locators, which pierce frames). Snapshot refs for frame content are prefixed
   (`f1e…`).
2. **In-game HUD is in the main document** — `browser_evaluate` works normally after login.
3. **React controlled inputs** need either `browser_type` (preferred) or the native-setter
   pattern in `evaluate`:
   `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true}))`.
4. **Timing:** directory auth can take 5–60 s against the live server; world login another
   5–30 s. The live world server can be slow (`SayThis`, `ObjectsInArea` may run into the
   180 s proxy timeout) or transiently refuse TCP connects (`ETIMEDOUT`) — retry after a
   few minutes before concluding anything is broken.
5. **The chat input keeps focus and swallows every shortcut.** Both key handlers bail out on
   an `INPUT`/`TEXTAREA` target (`isometric-map-renderer.ts:619`, `isTextInput` in
   `useKeyboardShortcuts.ts:39`), so after Phase 5 types into the chat box, `q`/`m`/`d` do
   nothing at all — silently. Call `document.activeElement?.blur()` before any keyboard
   assertion that follows a `browser_type`.
6. **The expanded chat panel covers the lower-left of the canvas.** Its message area sits
   above the map, so a map click there hits the chat, not the world, and nothing happens.
   Click `Collapse chat` before driving the map, and confirm the target with
   `document.elementFromPoint(x, y).id === 'game-canvas'`.

## Login Procedure (verified)

| Step | Action | Target (a11y) |
|------|--------|----------------|
| 1 | `browser_navigate` | `http://localhost:8080` (or the port you claimed — see **Server Lifecycle**) |
| 2 | `browser_type` | textbox **"Username"** → `SPO_test3` |
| 3 | `browser_type` | textbox **"Password"** → `test3` |
| 4 | `browser_click` | button **"Enter the World"** |
| 5 | `browser_wait_for` text `Free Space` (screen: **"Select a Region"**) | |
| 6 | `browser_click` | button starting **"Free Space"** |
| 7 | `browser_wait_for` text `planitia` (screen: **"Select a World"**) | |
| 8 | `browser_click` | the **planitia** world card (button) |
| 9 | `browser_wait_for` text `Your Companies` (screen: **"Select a Company"**) | |
| 10 | `browser_click` | button **"SPO_test3 - Green"** |
| 11 | Poll `getState()` until `session.connected && renderer.mapLoaded` (up to 45 s) | |

Company-select screen also shows **"Political Offices"** (Ministry of Agriculture) and
**"Create New Company"** — do not click either during standard runs.

**Login failure surfaces as a toast** (`status` role): e.g. *"World login failed: Unknown
error"* with a **Dismiss** button. Dismiss and retry once; if it persists, check the gateway
log for the underlying error (`REQ_LOGIN_WORLD FAIL`, often `connect ETIMEDOUT <world-ip>`).

## In-Game HUD (verified button titles)

Buttons are found by `title` attribute (main document, `evaluate`-friendly):

`Build (B)`, `Search`, `Profile (E)`, `Road`, `Capitol`, `Overlays`, `Mail (M)`,
`Settings`, `Facilities`, `Switch Server`, `Zoom In (+)`, `Zoom Out (-)`,
`Toggle Minimap`, `Debug (D)`, `Refresh (R)`.

- **There is no "Logout" button.** Leaving a world = **"Switch Server"** or closing the
  page/WS (the gateway then performs the canonical `ClientNotAware` → `get Logoff`).
- The **"Lobby" button in the chat strip is the channel picker**, not a lobby/logout
  control — clicking it lists channels (Lobby, Plano, …); clicking a channel joins it.
- Chat: textbox placeholder **"Type a message..."**, button **"Send message"** (disabled
  while empty), **"Collapse chat"**, online-user list visible in the strip.
- Info bar (top): world name, date, cash, income sparkline, ranking `#N · SPO_test3`,
  company link **"SPO_test3 - Green ›"** (opens Empire Overview), buildings `n/m`.

## Clicking a Building on the Map (verified live 2026-08-21)

The map is a canvas: there is no element to target, so a building is reached by converting
its world tile to a client pixel and clicking that pixel with a **real mouse**
(`page.mouse.click`) — a dispatched synthetic event is not enough, the renderer listens on
`mousedown`/`mouseup` (`isometric-map-renderer.ts:4946`).

1. Open **Facilities** (left rail) and read a row: it prints `name` and `x, y`. These are
   your own buildings, so they are always inspectable.
2. Collapse the chat and give the map room — `browser_resize` to 1440×900. At 780×493 the
   chat covers the useful half of the canvas (rule 6).
3. `__spoDebug.worldToCss(x, y)` → `{x, y}` in CSS client pixels. Confirm it is on the map
   with `document.elementFromPoint(...).id === 'game-canvas'`, then click it.
4. Allow **~3 s**: the click costs a `REQ_BUILDING_FOCUS` and a `REQ_BUILDING_DETAILS`
   round-trip before the preview renders. A 1.5 s wait reads as "nothing happened".

Clicking a **Facilities row** instead pans the camera and opens the inspector directly
(`FacilityList.tsx:40`) — it skips the preview overlay, so it does not exercise the
INSPECT path.

`tileProbe(x, y).hasConcrete` is **not** a building finder: concrete is the paving around a
facility, and a click there focuses nothing. Use real coordinates from the Facilities list.

Civic buildings (town halls) are not in that list, and hunting one by map click needs
screenshots — the civic `VISIT` path is covered at L2 by `politics-read` / `politics-write`.

### Inspector selectors (verified live 2026-08-21)

| Element | Selector |
|---|---|
| Preview popover | `[data-testid="status-overlay"]` |
| Its action button | `[data-testid="inspect-button"]` — reads `INSPECT`, or `VISIT` on a civic building |
| Section menu | `nav[aria-label="Facility sections"]`, one `button` per section |
| Section open? | that button's `aria-expanded` |
| Open section body | `section[aria-label="<section name>"]` |

## Programmatic State Verification (`__spoDebug`)

All assertions use `browser_evaluate` + `window.__spoDebug` — never screenshots.

```javascript
window.__spoDebug.sent / .received / .errors        // wire counters
window.__spoDebug.lastSent / .lastReceived           // last message types
window.__spoDebug.history                            // last 200 [{dir, type, ts, reqId}]
window.__spoDebug.getState()                         // full snapshot, see below
```

`getState()` (verified live): `session {connected, worldName, companyName, worldSize}`,
`renderer {mapLoaded, zoom, rotation, cameraPosition, buildingCount, segmentCount,
mapDimensions, debugMode, canvasSize, canvasHasContent}`,
`panels {login, chat, mail, profile, politics, settings, minimap, buildMenu,
buildingDetails, searchMenu}` (note: `minimap` is `true` by default after login),
`tycoonStats`, `chat {visible, messageCount, lastMessage}`, `wire`.

**Standard post-login assertion set:**
`session.connected === true`, `session.worldName === "planitia"`,
`session.companyName` contains `SPO_test3`, `panels.login === false`,
`renderer.mapLoaded === true`, `renderer.buildingCount > 0`,
`renderer.canvasHasContent === true`, `wire.errors === 0`.

Keyboard (nothing focused — see rule 5): `+`/`-` zoom, `q` rotate counter-clockwise,
`b` Build, `e` Empire, `m` Mail, `r` refresh map, `d` debug overlay (then `1`–`5`
sub-layers: tile info, building info, concrete IDs, water grid, road info).

⚠ **Two keys this file claimed until 2026-08-21 and the client does not bind.**

- **No clockwise rotate on the keyboard.** `KeyAction.ROTATE_CW` names `e` in
  `key-binding-registry.ts:38`, but that registry is a declaration nothing reads for map
  keys: the renderer's own `keydown` binds `q` alone (`isometric-map-renderer.ts:623`), and
  `e` is taken by the Empire panel (`useKeyboardShortcuts.ts:49`). Clockwise rotation itself
  works — `rotateCW()` (`isometric-map-renderer.ts:723`) and the mobile rotate gesture
  (`:805`) both reach it — it simply has no key. Press `q` until rotation cycles back to
  NORTH.
- **`m` opens Mail** (`useKeyboardShortcuts.ts:53`), not the minimap, which has its own
  `Toggle Minimap` HUD button.

## Server Lifecycle

### The bench worker owns the gateway — lease it, don't start it

Several Claude sessions (and several worktrees) run on this machine at once, but the live
bench — port 8080, the LOCKED accounts, the world — has a **single owner**: the bench
worker ([bench-worker.md](bench-worker.md)). For an L3 browser pass, take a **lease**:

```bash
npm run dev                                   # queues a lease job and waits
# → the worker builds THIS worktree, starts ITS gateway on :8080, and holds it
#   for 30 min (npm run dev -- --lease-minutes=60 for longer, max 120)
```

The command returns when the gateway is ready (the report says until when). Navigate
Playwright to `http://localhost:8080` and drive. You never stop the server: the lease
ends at expiry, or earlier with `npm run dev:release` — **release it as soon as you are
done**, other sessions' jobs are waiting behind it. Either way the worker tears the
gateway down; no orphan survives.

If the deposit fails with `WORKER DOWN` (exit 3), the worker itself needs attention:
`systemctl --user restart spo-bench-worker`, or `scripts/bench-install.sh` first-time.

### The conscious exception — a debug gateway of your own

For interactive debugging only, off the bench, **never on 8080**:

```bash
npm run dev:local                             # build + start yourself, first free port from 8081
curl -s http://localhost:8081/api/startup-status      # → phase:"ready"
# stop it yourself when done: ss -ltnp "sport = :8081" → kill <your pid>
```

Nothing observed against a `dev:local` gateway is evidence — the push hook only accepts
the worker's attestations. Never leave E2E traffic running unattended against the live
servers (policy SEC-N, [production-security-policy.md](production-security-policy.md)).

## Screenshot Policy

Screenshots are for **visual rendering bugs only** — never for state verification.
**Never load screenshot images in the main conversation context** (3–5 MB each): save with
`browser_take_screenshot(filename: "screenshots/<name>.png")` and delegate analysis to a
sub-agent that returns a text verdict.

## Reporting

On failure capture: the failing step, `getState()` output, `browser_console_messages`, and
the relevant gateway log lines (`logs/*.ndjson`, filter by `sid`). Report as a per-area
PASS/FAIL table.

---

## L3 Smoke Script (ordered)

Read-only browser pass with the primary account, run when the diff touches pixels or
before a release. Everything below the pixel belongs to L2 (`npm run test:live`).

### Phase 0 — Lease the bench
```
Bash (background): npm run dev              # bench lease — returns when THIS worktree's
                                            # gateway is ready on :8080 (~2 min cold build)
browser_navigate → http://localhost:8080
```
You start nothing and stop nothing: the worker holds the gateway for the lease (30 min
default) and tears it down at expiry, or earlier when you run `npm run dev:release` at the
end of the pass (see **Server Lifecycle**). `WORKER DOWN` at this step is a bench problem,
not a test result.

### Phase 1 — Login (MANDATORY, always first)
Follow the login table above. **Assert** via `getState()`: `session.connected`,
`worldName === "planitia"`, `companyName` contains `SPO_test3`, `panels.login === false`,
`wire.errors === 0`.

### Phase 2 — Map render
**Assert:** `renderer.mapLoaded`, `renderer.buildingCount > 0`, `renderer.canvasHasContent`,
`canvasSize.width > 0`.

### Phase 3 — Camera controls
Press `+` then `-` (zoom changes and restores), then `q` (rotation steps
NORTH→WEST→SOUTH→EAST→NORTH — four presses to return) — assert via `renderer.zoom` /
`renderer.rotation` after each key. No key rotates clockwise; see the ⚠ above.

### Phase 4 — Tycoon stats
**Assert on the rendered info bar**, not on `getState()`: it shows `#N`, `SPO_test3`, a `$`
cash figure and `N/M` buildings.

⚠ `getState().tycoonStats` carries the **raw model values**, not what the bar prints:
`cash` is a bare number (`115316825276`, no `$`, no separators) and `ranking` is `#11`
alone — the tycoon name is added by the widget. Asserting `cash` starts with `$` or that
`ranking` contains `SPO_test3` fails against a perfectly healthy client; this file asked for
both until 2026-08-21.

### Phase 5 — Chat ping
Type `E2E smoke ping` into the chat textbox and send. **Assert:**
`REQ_CHAT_SEND_MESSAGE` appears in `__spoDebug.history` (the outbound request is the
assertion; the live world can be slow to echo).

### Phase 6 — Panel sweep (open → close, one pass)
For each HUD button by `title`: `Build (B)`, `Search`, `Profile (E)`, `Mail (M)`,
`Settings` — click, assert the matching `panels.*` flag flips true, press `Escape`, assert
it flips back. Toggle the minimap with its `Toggle Minimap` HUD button (**not** `m`).
Do not click actions inside the panels.

### Phase 6b — Facility inspector (only when the diff touches it)
Reach one of your own buildings with the recipe above, then assert in order:

1. **Preview** — `[data-testid="status-overlay"]` present, opening on name + level, society,
   revenue. Exactly one `REQ_BUILDING_DETAILS` in `history`, and **no** `REQ_BUILDING_TAB_DATA`.
2. **INSPECT** — the button reads `INSPECT` (`VISIT` on a civic building). Clicking it flips
   `panels.buildingDetails` and adds **no** round-trip: the panel reuses the preview's read.
3. **Section menu** — `nav[aria-label="Facility sections"]` lists the server-sent tabs, every
   one `aria-expanded="false"` and no `section[aria-label=…]` drawer open. Nothing is selected
   on mount, which is what makes the deferred read observable.
4. **Open a section** — `REQ_BUILDING_TAB_DATA` increments by one and the drawer fills with
   values. Pick a section that is *not* the header group (Workforce reads cleanly; General
   often rides in with the opening read and correctly costs nothing).

Give a section **~4 s**: `Finances` draws its graph only once the `moneyGraph` payload lands,
and sampling earlier shows an empty drawer that fills a moment later.

### Phase 7 — Wire health
**Assert:** `wire.sent > 10`, `wire.received > 10`, `wire.errors === 0`.

### Phase 8 — Clean exit
Close the browser page (triggers the gateway's `ClientNotAware` → `get Logoff`), stop the
server (only the PID you started), confirm your port is free again.

### Report

| Phase | Status |
|-------|--------|
| Login | PASS/FAIL |
| Map render | |
| Camera | |
| Stats | |
| Chat | |
| Panels | |
| Inspector (if driven) | |
| Wire health | |
| Clean exit | |
