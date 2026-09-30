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
  world-scope value, never demolish anything but the facility `place-rename-demolish` placed in
  the same run (#1150), never create-company.

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

## In-Game HUD (verified accessible names)

Controls are found by **accessible name** (role + name; main document, `evaluate`-friendly).
Desktop layout (viewport ≥ 1024 px):

- **CommandBar** (`nav[aria-label="Game actions"]`, `CommandBar.tsx`): tiles `Build`, `Map`,
  `Empire`, `Government`, `Mail` (named `Mail, N unread` while mail is unread), `Chat` (toggles
  the chat strip, not a surface), `More`. Beside them, the search button
  `Search or run a command (Ctrl+K)` opens the command palette. While a mode runs, that button
  is replaced by a mode row whose exit button is `Done` (`Cancel` in connect mode).
- **More menu** (`role="menu"` named `More actions`, items `role="menuitem"`): `Build road`,
  `Demolish road`, `Zone painting` (only for a public-office role), `Search the directory`,
  `Map overlays`, `Docked minimap`, `My facilities`, `Settings`, `Keyboard shortcuts`,
  `Switch server`.
- **RightRail** (`nav[aria-label="Map controls"]`): `Zoom In (+)`, `Zoom Out (-)`,
  `Rotate view (Q)`, `Rotate view (W)`, `Toggle Minimap`, `Debug (D)`, `Refresh (R)`.
- **StatusPill** (`header[aria-label="Player status"]`): `Open profile` (the name) and
  `Open profile (finances)` (the cash) both open the Empire surface.
- **Logout** = More → `Settings` → `Logout` → confirm dialog `Log out` (`Cancel` backs out).
  The client sends `REQ_LOGOUT` and the page reloads onto the login screen.
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

1. Open More → **My facilities** and read a row: it prints `name` and `x, y`. These are
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
| Map context menu | `[data-testid="map-context-menu"]`, items are `role="menuitem"` |

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
`tycoonStats`, `wire`. `panels.buildMenu` = the top surface of the stack is `build`;
`panels.chat` = the chat strip is expanded.

Added by #1133, unit-tested in `client.test.tsx`:
`chat {visible (expanded), shown (strip shown at all), messageCount, lastMessage}`,
`ui {stack (surface kinds, top last), modal, modalBeneath, pinned, commandPaletteOpen,
contextMenuOpen, hudVisible, serverSwitchMode, mobileTab, mobileSheetSnap}`,
`modes {placingBuilding, roadBuilding, roadDemolish, zonePainting, connecting}`,
`login {stage, authError (boolean only), isVisitor, isPublicOfficeRole}`,
`subViews {profileTab, searchPage, mailFolder, mailView, tutorialAssigned, buildingPreview}`.
Values only — never a player name, message text beyond `chat.lastMessage`, or error text.

**Standard post-login assertion set:**
`session.connected === true`, `session.worldName === "planitia"`,
`session.companyName` contains `SPO_test3`, `panels.login === false`,
`renderer.mapLoaded === true`, `renderer.buildingCount > 0`,
`renderer.canvasHasContent === true`, `wire.errors === 0`.

Keyboard (nothing focused — see rule 5): `+`/`-` zoom, `q` / `w` rotate counter-clockwise /
clockwise, `b` Build, `e` Empire, `m` Map, `l` Mail, `p` Government, `r` refresh map, `h` hide /
show the interface, `?` the shortcut list, `d` debug overlay (then `1`–`5` sub-layers: tile info,
building info, concrete IDs, water grid, road info). The reference table is `SHORTCUTS` in
`useKeyboardShortcuts.ts`.

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

## L3 Walkthrough (ordered)

One browser pass with the primary account, run when the diff touches pixels or before a
release. It opens **every screen and panel once**, asserts it through `getState()` — never a
screenshot for state — and closes it. Nothing is submitted, bought, sent or saved, except the
Phase 5 chat ping. Every player *action* belongs to L2 (`npm run test:live`).

A screen whose data the world may not hold — the world-event ticker, the tutorial, the chase
badge with Crazz online — is recorded **absent**, not failed. Crazz is never required. A pass
against the production URL runs only when the maintainer asks for one.

### Phase 0 — Lease the bench
```
Bash (background): npm run dev -- --lease-minutes=60   # bench lease — returns when THIS
                                                       # worktree's gateway is ready on :8080
                                                       # (~2 min cold build)
browser_navigate → http://localhost:8080
browser_resize → 1440×900
```
The walkthrough is longer than the old smoke, so the lease is 60 minutes. The lease is the only
sanctioned way to get a gateway (see **Server Lifecycle**; `bench-port-guard.sh` refuses the
others): the worker holds the gateway and tears it down at expiry, or when Phase 9 hands it
back with `npm run dev:release`. `WORKER DOWN` at this step is a bench problem, not a test
result.

### Phase 1 — Before the game
1. **Intro** — the login screen opens on the intro (`AuthStage.tsx` root `data-intro="playing"`,
   then `"done"` after ~1.4 s; any key or click skips it). Assert `login.stage === "auth"`.
2. **Language** — open the `Language` select, confirm it lists English, Español, Français,
   Deutsch, Italiano, Português, and leave it on its current value (a change writes a setting).
3. **Authentication Failed** — log in with a **made-up account name** (never a wrong password
   on a LOCKED account). Assert the dialog "Authentication Failed" and `login.authError === true`;
   dismiss with `Try Again`, assert `login.authError === false`.
4. **Region → world → company** — follow the login table above with `SPO_test3`. Assert
   `login.stage` reads `zones` on "Select a Region", `worlds` on "Select a World",
   `companies` on "Select a Company".
5. **Company creation** — click the "Create New Company" card; assert the dialog
   "Create New Company" and `ui.modal === "createCompany"`. It has no Cancel button: close it
   with the header `Close` (or Escape), assert `ui.modal === null`. Never click "Create Company".
6. Click `SPO_test3 - Green`. **Assert** the standard post-login set above, plus
   `renderer.canvasSize.width > 0`.

### Phase 2 — Chrome
1. **StatusPill** — click `Open profile`; assert `ui.stack` ends with `empire` and
   `panels.profile === true`; close. Same with `Open profile (finances)`.
2. **Tycoon stats** — assert on the rendered StatusPill, not on `getState()`: it shows `#N`,
   `SPO_test3`, a `$` cash figure and `N/M` buildings.

   ⚠ `getState().tycoonStats` carries the **raw model values**, not what the widget prints:
   `cash` is a bare number (`115316825276`, no `$`, no separators) and `ranking` is `#11`
   alone — the tycoon name is added by the widget. Asserting `cash` starts with `$` or that
   `ranking` contains `SPO_test3` fails against a perfectly healthy client; this file asked for
   both until 2026-08-21.
3. **CommandBar tiles** — for each of `Build`, `Map`, `Empire`, `Government`, `Mail`: click,
   assert the top of `ui.stack` (`build`, `map`, `empire`, `politics`, `mail`) and, where one
   exists, the flag (`panels.buildMenu`, `panels.profile`, `panels.politics`, `panels.mail`);
   close the sheet, assert `ui.stack` is empty. `Chat` toggles the strip: assert `chat.shown`
   flips, click again to restore. The screens behind the tiles are walked in Phase 3.
4. **More menu** — click `More`; assert the menu "More actions" lists `Build road`,
   `Demolish road`, `Search the directory`, `Map overlays`, `Docked minimap`, `My facilities`,
   `Settings`, `Keyboard shortcuts`, `Switch server`. Here open only:
   - `Docked minimap` — assert `panels.minimap` flips, click again to restore.
   - `Switch server` — assert `ui.serverSwitchMode === true` and the region picker; leave with
     `Back to planitia`, assert `ui.serverSwitchMode === false` and the map still loaded. Pick
     nothing in it.

   `Search the directory`, `My facilities` and `Map overlays` are opened in Phase 3; `Build road`, `Demolish road`,
   `Settings` and `Keyboard shortcuts` in Phase 6.
5. **RightRail** — `Zoom In (+)` then `Zoom Out (-)`: `renderer.zoom` changes and restores.
   `Rotate view (Q)` four times: `renderer.rotation` steps NORTH→WEST→SOUTH→EAST→NORTH; then
   `Rotate view (W)` once and back with `Rotate view (Q)`. `Toggle Minimap`: `panels.minimap`
   flips and restores. `Debug (D)`: `renderer.debugMode` flips and restores. `Refresh (R)`:
   `renderer.mapLoaded` stays true and `wire.errors === 0`.
6. **Version badge** — click the `Beta …` badge; assert the dialog "What's New" and
   `ui.modal === "changelog"`; close it with `Close` (Escape does not mark the notes seen).
7. **Context strip** — the `role="status"` strip above the CommandBar
   (`ContextStatusStrip.tsx`): record its text, or *absent* when it has nothing to say (it hides
   itself when empty or when a building is focused).
8. **World-event ticker** — `WorldEventTicker.tsx` renders nothing until an event arrives (it
   polls every 45 s): record it present or *absent*.

### Phase 3 — Surfaces
Each surface opens as a sheet; open it, assert, close it (`ui.stack` back to empty).

1. **Build** — `Build` tile; assert `panels.buildMenu === true`. Click one category card (named
   by server data); the facility list shows with its back arrow; go back. Never expand a
   facility into "Place Building" here (Phase 6 does).
2. **Map** — `Map` tile; assert the top of `ui.stack` is `map`. In the `Map tools` toolbar click
   `Back`, `Next`, then `Nearest Town Hall` (it opens that town hall's building surface —
   `panels.buildingDetails === true`; close it). Never click "Bookmark this place", and never
   rename or delete a bookmark.
3. **Empire** — `Empire` tile (sheet "Profile"); in `Profile sections` open each of
   Curriculum, Bank Account, Profit & Loss, Companies, Initial Suppliers, Strategy and assert
   `subViews.profileTab` reads `curriculum`, `bank`, `profitloss`, `companies`,
   `autoconnections`, `policy`; close each with `Close section` (`subViews.profileTab === null`).
4. **Government** — `Government` tile; assert `panels.politics === true` and the home shows its
   "Capitol" and "Towns" sections. Open nothing from it here (the Helartia town hall is Phase 4).
5. **Mail** — `Mail` tile; assert `panels.mail === true`, `subViews.mailView === "list"`. Click
   each tab `Inbox`, `Sent`, `Drafts` and assert `subViews.mailFolder` = `Inbox`, `Sent`,
   `Draft`. Open **one** message — from `Sent` by default — assert `subViews.mailView === "read"`,
   return with `← Back`. An Inbox message may be opened only if its row is not styled unread (the
   row carries `styles.unread` in `MailPanel.tsx`; the class is hashed, so match
   `[class*="unread"]` on the row — an inference, say so in the report); the folder badge is only
   a count. **An unread Inbox message is never opened**: opening it makes the gateway's
   `markInboxMessageRead` (`src/server/session/mail-handler.ts`) clear the mail server's unread
   flag, and no RDO member can set it back — `Mail Server/MailServer.pas:557`,
   `Mail/MailMessageAuto.pas:165-166`. Never click Compose, Reply, Forward or Delete.
6. **Search** — More → `Search the directory` (there is no desktop tile). Assert `panels.searchMenu`
   and `subViews.searchPage === "home"`. Open each page the home offers once — `towns`,
   `people`, `rankings`, `banks`, `media`, `directory`, and a tycoon's `tycoon-profile` /
   `tycoon-full-profile` when reachable — asserting `subViews.searchPage`, and return with
   `← Back`. A page with no tile on the live home is recorded *absent*. `ranking-detail` is
   never navigated to.
7. **My facilities** — More → `My facilities`; assert the top of `ui.stack` is `facilities`.
   Do not create or rename a folder.
8. **Map overlays** — More → `Map overlays`; assert the top of `ui.stack` is `overlays`.
9. **Sheet chrome** — with My facilities open: click
   `Pin sheet — keep it open while clicking the map`, assert `ui.pinned === true`; click a
   facility row, assert `ui.stack.length === 2` and the `Open surfaces` chip row; press Escape,
   assert `ui.stack.length === 1`; click `Unpin sheet — map clicks replace this content`, assert
   `ui.pinned === false`; `Close`, assert `ui.stack` is empty.

### Phase 4 — Inspector
Reach one of your own buildings with the recipe above (**Clicking a Building on the Map**),
then assert in order:

1. **Preview** — `[data-testid="status-overlay"]` present, opening on name + level, society,
   revenue; `subViews.buildingPreview === true`. Exactly one `REQ_BUILDING_DETAILS` in
   `history`, and **no** `REQ_BUILDING_TAB_DATA`.
2. **INSPECT** — the button reads `INSPECT` (`VISIT` on a civic building). Clicking it flips
   `panels.buildingDetails` and adds **no** round-trip: the panel reuses the preview's read.
3. **Section menu** — `nav[aria-label="Facility sections"]` lists the server-sent tabs, every
   one `aria-expanded="false"` and no `section[aria-label=…]` drawer open. Nothing is selected
   on mount, which is what makes the deferred read observable.
4. **Each section once** — open each section in turn: `REQ_BUILDING_TAB_DATA` increments by one
   and the drawer fills with values (the header group — General — often rides in with the
   opening read and correctly costs nothing). Give a section **~4 s**: `Finances` draws its
   graph only once the `moneyGraph` payload lands. Touch no control inside a section.
5. **Helartia town hall** — reach it with the Map surface's `Nearest Town Hall` when Helartia is
   the nearest, else Government → the Helartia row → "Open the Town Hall of Helartia". Open each
   civic tab present (`CIVIC_TABS` in `CivicTabConfig.ts`): Overview, Administration,
   Demographics, Elections, Politics. Which appear depends on the server's groups: a missing tab
   is recorded *absent*. Read only — no rating, tax or vote control is touched.
6. **Right-click menu** — on your own building, `page.mouse.click(x, y, { button: 'right' })`
   with no movement: assert `[data-testid="map-context-menu"]`, `ui.contextMenuOpen === true`
   and a `menuitem` reading `Inspect`; click it and assert the building surface opens
   (`nav[aria-label="Facility sections"]` present). Right-click an empty `tileProbe` tile: the
   menu has no `Inspect` item (`Centre view here` only). Press Escape: the menu is gone
   (`ui.contextMenuOpen === false`). Right-drag 100 px (press, move, release, all with
   `button: 'right'`): no menu appears and the camera panned instead.

### Phase 5 — Chat ping
Type `E2E smoke ping` into the chat textbox and send (`Send message`). **Assert:**
`REQ_CHAT_SEND_MESSAGE` appears in `__spoDebug.history` (the outbound request is the
assertion; the live world can be slow to echo). This is the one message the walkthrough sends.

Then, nothing created or joined:

1. **Channel list** — click the channel picker (the button named by the current channel,
   `Lobby`); the dropdown lists the channels and `New Channel…`. Close it without picking one.
2. **Users sidebar** — it has no toggle: it shows whenever the strip is expanded (header
   `Online (N)`). Assert `chat.visible === true` and the header visible. Never click Follow or
   Ignore.
3. **Chat history** — `Open chat history`; assert the dialog "Lobby history" and
   `ui.modal === "chatHistory"`; `Close`.
4. **New Channel** — picker → `New Channel…`; assert the dialog "New Channel" and
   `ui.modal === "createChannel"`; `Cancel` (never `Create`).

Blur the chat input before Phase 6 (rule 5: `document.activeElement?.blur()`).

### Phase 6 — Modes and overlays
Each mode is **entered and cancelled with nothing placed** — never click the map while a mode
runs.

| Mode | Enter | Assert | Leave |
|---|---|---|---|
| Placement | `Build` → a category → expand a facility → `Place Building` | `modes.placingBuilding === true` | mode-row `Done`, or Escape |
| Road build | More → `Build road` | `modes.roadBuilding === true` | `Done`, or Escape |
| Road demolish | More → `Demolish road` | `modes.roadDemolish === true` | `Done` — Escape is not wired for this mode |
| Connect | inspector action `Connect` on an own industry or service facility | `modes.connecting === true` | mode-row `Cancel`, or Escape |

After each, assert the flag is back to `false`. A disabled `Place Building` (unaffordable) or no
facility offering `Connect` is recorded *absent* with that reason.

- **Zone paint — recorded absent**: CommandBar offers "Zone painting" only when
  `isPublicOfficeRole` is true, and this pass logs into the company "SPO_test3 - Green", never
  "Political Offices" (`login.isPublicOfficeRole === false`; a role switch is an L2 action, card
  `C1` (#1142)). Should the flag read true anyway, open the `Zone Type Picker` dialog, close it
  with `Close` without picking a zone (`modes.zonePainting` stays false), and say so.
- **Command palette** — Ctrl+K; assert `ui.commandPaletteOpen === true`; Escape, assert false.
- **Hidden HUD** — `h`; assert `ui.hudVisible === false`; restore with the `Show` toast (or `h`),
  assert true.
- **Debug overlay** — `d`; assert `renderer.debugMode === true`; `d` again, assert false.
- **Shortcuts** — `?`; assert the dialog "Keyboard shortcuts" and `ui.modal === "shortcuts"`;
  close it. The same dialog is More → `Keyboard shortcuts`.
- **Settings** — More → `Settings`; assert the dialog "Settings" and `ui.modal === "settings"`.
  Scroll through each section — Visual, Audio, Connection, Ignored Players, Keyboard Shortcuts,
  and Support when the bug reporter is on — toggling nothing; `Close`.
- **Bug reporter** — present only when the gateway runs with `SPO_BUG_REPORT`
  (`window.__SPO_BUG_REPORT__` defined, `src/server/runtime-config.ts`). When present: Settings →
  Support → `Report a problem` arms it (`[data-testid="report-mode-overlay"]`); cancel with
  Escape. Never click while armed (a click captures), never `Send report` — a submit files a
  real report. The bench lease loads no production `.env`, so it is normally recorded *absent*.

### Phase 7 — Mobile pass
`browser_resize` → 390×844 (below 1024 px the `MobileShell` replaces the desktop chrome).

1. **BottomNav** (`role="tablist"` "Game actions") — tap each tab and assert `ui.mobileTab`:
   `Build` → `build`, `Map` → `map`, `Chat` → `chat`, `More` → `more`; `Government` and `Mail`
   leave `ui.mobileTab === "map"` and put `politics` / `mail` on top of `ui.stack`.
2. **BottomSheet snaps** — with a sheet open, tap `Resize panel`: `ui.mobileSheetSnap` cycles
   `half` → `full` → `half`. `peek` is reachable only by a touch drag → recorded *absent*.
   `Close` the sheet.
3. **MobileMenu** — the `More` tab lists the groups Communication, Exploration, Map Controls,
   System; confirm each is present. Do not tap Logout or Switch Server here.
4. **Mobile build content** — the `Build` tab shows the sub-tabs Buildings, Roads, Demolish;
   open each, start no mode. `panels.buildMenu` stays false on mobile (it is a tab, not the
   `build` surface) — do not assert it here.

`browser_resize` → 1440×900 before Phase 8.

### Phase 8 — Wire health
**Assert:** `wire.sent > 10`, `wire.received > 10`, `wire.errors === 0`.

### Phase 9 — Clean exit
The logout reloads the page, which resets `__spoDebug.history`, so the history is captured on
the way out:

1. `browser_evaluate`:
   `addEventListener('pagehide', () => sessionStorage.setItem('e2e-history', JSON.stringify(__spoDebug.history.map(h => h.type))))`.
2. More → `Settings` → `Logout`; assert the confirm dialog "Log out" (`ui.modal === "confirm"`);
   click `Log out`.
3. After the reload, assert the login screen (`login.stage === "auth"`), no reconnect overlay
   (no `role="status"` reading "Reconnecting…", no `role="alert"` with "Return to home page"),
   and `JSON.parse(sessionStorage.getItem('e2e-history')).includes('REQ_LOGOUT')`; then
   `sessionStorage.removeItem('e2e-history')`.
4. `npm run dev:release` — hands the lease back; the worker tears the gateway down. **The server
   is never stopped by hand.**

### Report

| Phase | Status (PASS / FAIL / absent + reason) |
|-------|--------|
| 0 Lease the bench | |
| 1 Before the game | |
| 2 Chrome | |
| 3 Surfaces | |
| 4 Inspector | |
| 5 Chat ping | |
| 6 Modes and overlays | |
| 7 Mobile pass | |
| 8 Wire health | |
| 9 Clean exit | |

Out of scope: the tutorial surface's buttons (its Close finalises the task); the visitor,
world-full and denied screens (unreachable with the LOCKED accounts); the reconnect overlay,
the new-version banner and the crash screen (not safely triggerable).
