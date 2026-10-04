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
| **Username** | `SPO_test3` | `SPO_test` |
| **Password** | `test3` | `test` |
| **Region** | `Free Space` | `Free Space` |
| **World** | `planitia` | `planitia` |
| **Company** | `SPO_test3 - Green` | (its own) |
| **Holds** | **Mayor of Helartia**, Minister of Agriculture | a dedicated basic test account, no special buildings — no flow depends on its holdings |

- Pick **Free Space**, not BETA — the live directory hosts `planitia`/`shamba`/`zorcon` under Free Space; BETA only has `aries`.
- `SPO_test3` **has mayor powers** (verified live 2026-08-20, [civic-roles-reference.md](civic-roles-reference.md): `canGovern` true on the Town Hall). Road building, zone overlays and town governance are testable live. It is **not** president — see the exclusion in [E2E-POLICY.md](E2E-POLICY.md) §7.
- `SPO_test` exists for what one account cannot do: permission-negative checks, mail
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
7. **Close a dialog with its named button, not Escape or Enter.** The supplier picker and the
   "Find supplier for …" dialog handle Escape without stopping it, so with focus on a button the
   global dismiss also closes the layer beneath; the bug-report dialog has no Escape handler at
   all; and a text prompt with a default value may submit on Enter, which writes. Click
   `Close` / `Cancel`.

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

Company-select screen also shows **"Political Offices"** (a Minister card first, then the card
whose badge reads `Mayor of Helartia`) and **"Create New Company"**. Only Phase 8b clicks a
Political Offices card — the `Mayor of Helartia` one; every other step logs into
`SPO_test3 - Green`. "Create New Company" is only opened and closed (Phase 1), never submitted.

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
  `Demolish road`, `Zone painting` (only for a public-office role), `Search`, `Map overlays`,
  `Docked minimap`, `My facilities`, `Settings`, `Keyboard shortcuts`, `Switch server`.
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
`tycoonStats`, `wire`. `panels.buildMenu` = the top surface of the stack is `build` or, on
mobile, the Build tab's content is on screen;
`panels.chat` = the chat strip is expanded.

Added by #1133, unit-tested in `client.test.tsx`:
`chat {visible (expanded), shown (strip shown at all), messageCount, lastMessage}`,
`ui {stack (surface kinds, top last), modal, modalBeneath, pinned, commandPaletteOpen,
contextMenuOpen, hudVisible, serverSwitchMode, mobileTab, mobileSheetSnap}`,
`modes {placingBuilding, roadBuilding, roadDemolish, zonePainting, connecting}`,
`login {stage, authError (boolean only), isVisitor, isPublicOfficeRole}`,
`subViews {profileTab, searchPage, mailFolder, mailView, tutorialAssigned, buildingPreview}`.
Values only — never a player name, message text beyond `chat.lastMessage`, or error text.

Added by #1192, unit-tested in `client.test.tsx` (read from on-screen `data-testid` markers
listed in `src/client/debug-markers.ts`, the stores, and the renderer):
`ui.moreMenuOpen` (the command bar's More menu),
`chat {channelPickerOpen, usersListShown}` (`usersListShown` is also true on the mobile
embedded chat, where `chat.visible` may be false),
`build {phase (categories|facilities|null), category, loading, facilityCount, mobileSubTab}`
(`phase` is null when no BuildMenu is on screen; `category` is the chosen category label while
`phase === 'facilities'`; `facilityCount` is 0 until loaded; `mobileSubTab` =
`buildings`/`roads`/`demolish`, null off the mobile Build tab),
`bugReporter {available (Settings shows Support), armed (report-mode overlay), modalOpen}`,
`layers {overlay (the SurfaceType value, `ZONES` for city zones, null for none),
debugSubLayers {tileInfo, buildingInfo, concreteInfo, waterGrid, roadInfo} (keys 1–5, null
without a renderer), season (`Winter`/`Spring`/`Summer`/`Autumn`, what F1–F4 force)}`,
`mobile {infoBar, chatBanner}` (booleans only — never the banner's text).

Reading the existing `buildingDetails.currentTab` (non-null while `panels.buildingDetails`):
on a standard facility a section drawer is open iff `buildingDetails.tabs` has an entry whose
`id === currentTab` (no match = the section menu is showing); on a civic building the shown tab
is `currentTab` when it names a civic tab, else the first one.

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

Some screens live only in a component's local state, and `getState()` has **no field** for
them: the Empire bank forms, the portrait dialog, the facility filter, the search ranking
detail, the mobile search pill and the bug reporter's quick-pick grid. For those, assert the
surrounding context through `getState()` (the open surface, `ui.modal`, the profile tab), then
the element itself by role and accessible name — and say so in the report. Never invent a field.

Requests sent outside the debug counters (`REQ_SEARCH_CONNECTIONS`,
`REQ_CONNECTION_REACHABILITY`, `REQ_BUILDING_FOCUS` / `REQ_BUILDING_UNFOCUS`) never reach
`__spoDebug.history` or `wire`: never assert on them.

### Phase map

Every screen a player can reach, with the step that opens it (`3.5` = Phase 3 step 5) or the
reason it is not opened.

| Screen | Mounted in | Opened by / reason |
|---|---|---|
| Server startup screen | `ServerStartupScreen` | 0 — shown while the leased gateway warms up; recorded present or absent |
| Login intro, sign-in, language | `AuthStage` | 1.1, 1.2 |
| Authentication Failed | `AuthErrorModal` | 1.3 |
| Select a Region / a World | `ZoneStage`, `WorldStage` | 1.4 |
| Select a Company — own companies | `CompanyStage` | 1.4, 1.6 |
| Select a Company — Political Offices | `CompanyStage` | 8b.3 |
| Select a Company — visitor, world-full, nobility, world-limit, access-denied views | `CompanyStage` | excluded — unreachable with the LOCKED accounts |
| Create New Company | `CompanyCreationModal` | 1.5 (closed, never submitted) |
| Map loading screen | `MapLoadingScreen` | 1.6 — shown during world entry |
| StatusPill | `StatusPill` | 2.1, 2.2 |
| CommandBar tiles, More menu | `CommandBar` | 2.3, 2.4 |
| Mode row | `CommandBar` | 6 |
| RightRail | `RightRail` | 2.5 |
| Version badge, What's New | `VersionBadge`, changelog modal | 2.6 |
| Context strip | `ContextStatusStrip` | 2.7 (absent when empty) |
| World-event ticker | `WorldEventTicker` | 2.8 (absent until an event arrives) |
| Toasts | notification stack | 1.3 / any step that raises one; recorded when seen |
| Build surface | `build` | 3.1 |
| Map surface, bookmark prompt | `map`, `PromptDialog` | 3.2 |
| Empire tabs | `empire` | 3.3 |
| Bank Account borrow / send forms | `ProfilePanel` | 3.3 (cancelled) |
| Portrait uploader | `PortraitUploader` | 3.3 (cancelled) |
| Initial Suppliers search | `SupplierSearchModal` | 3.3 (closed) |
| Government home | `politics` | 3.4 |
| Capitol inspector (Towns, Ministries) | `BuildingInspector` | 3.4 (read only) |
| Helartia town hall | `BuildingInspector` | 4.5 |
| Mail list / read | `MailPanel` | 3.5 |
| Mail compose | `MailPanel` | 3.5 (closed unsent) |
| Search pages | `SearchPanel` | 3.6 |
| Search ranking detail | `SearchPanel` | 3.6 |
| Newspaper | `NewspaperModal` | 3.6, 4.5 |
| My facilities, new-folder prompt | `facilities`, `PromptDialog` | 3.7 (cancelled) |
| Map overlays | `OverlayMenu` | 3.8 |
| Facility filter | `FacilityFilter` | 3.8 (nothing toggled) |
| Sheet chrome (pin, chip row) | `Sheet` | 3.9 |
| Building preview | `StatusOverlay` | 4.1 |
| Inspector, section menu, sections | `BuildingInspector` | 4.2–4.4 |
| Inspector v2 (UI v2 side panel) and its diagnosis-banner Connect | `InspectorV2` | 6 — Banner Connect step: Settings → Interface → "New (experimental)", map click → FocusCard `Inspect`; switched back to Classic |
| One inspector per fixture kind (industry, warehouse, residential, TV, research HQ, bank) | `PropertyGroup`, `template-groups.ts` | 4.7 |
| Research panel | `ResearchPanel` | 4.7 |
| Bank loan request | `BankLoanRequest` | recorded absent — renders only for a visitor of the bank |
| Supplier-search surface | `supplierSearch` (`SupplierSearchSurface`) | 4.8 (closed) |
| Map context menu | `MapContextMenu` | 4.6 |
| Chat strip, users sidebar, channel picker | `ChatStrip` | 5, 5.1, 5.2 |
| Chat history | `chatHistory` modal | 5.3 |
| New Channel | `createChannel` modal | 5.4 |
| Channel password prompt | `PromptDialog` | 5.5 (cancelled; absent when no protected channel) |
| Placement, road build, road demolish, connect modes | mode row | 6 |
| Command palette | `CommandPalette` | 6, 7.5, 7.9 |
| Hidden HUD | — | 6 |
| Debug overlay | renderer | 6 |
| Keyboard shortcuts | `shortcuts` modal | 6 |
| Settings, logout confirm | `settings`, `confirm` modals | 6, 9.2 |
| Bug reporter — armed overlay, report dialog | `ReportModeOverlay`, `ReportModal` | 6 (normally absent under the lease) |
| Bug reporter — quick-pick grid, report button | `QuickPickGrid`, `ReportFab` | 7.10 (normally absent: needs `SPO_BUG_REPORT=true` below 768 px) |
| Zone Type Picker | `ZoneTypePicker` | 8b.5 (closed, nothing painted) |
| Switch server | `ServerSwitchOverlay` | 2.4, 7.9 |
| Docked minimap | minimap | 2.4, 2.5 |
| Chase badge | `ChaseBadge` | absent unless `SPO_test` is online — never required |
| Mobile BottomNav, sheet snaps, menu, build content | `MobileShell` | 7.1–7.4 |
| Mobile info bar, chat banner | `MobileInfoBar`, `ChatBanner` | 7.1, 7b |
| Mobile search pill | `MobileSearchPill` | 7.5 |
| Placement HUD | `PlacementHUD` | 7.6 |
| Mobile mode bar | `MobileModeBar` | 7.7 |
| Inspector in the bottom sheet | `BottomSheet` | 7.8 |
| Every MobileMenu destination | `MobileMenu` | 7.9 |
| Bottom sheet `peek` snap | `BottomSheet` | recorded absent — touch drag only |
| Tablet band 768–1023 px | `MobileShell` | 7b |
| Reconnect overlay | `ReconnectingOverlay` | 8.2 (absent when offline does not close the socket) |
| Tutorial surface | `tutorial` | recorded absent when no assignment; its Close finalises the task, never clicked |
| New-version banner | `NewVersionBanner` | excluded — not safely triggerable |
| Crash screen | `CrashScreen` | excluded — not safely triggerable |

**Maintainer follow-up.** `.claude/commands/e2e.md` and `.claude/skills/e2e-test/SKILL.md`
must follow these steps and the two sub-phases (Phase 7b, Phase 8b); the pipeline cannot write
under `.claude/`, so a maintainer session mirrors them. Two stale lines to fix there as well:
`SKILL.md` still names Phase 0's lease as 60 minutes (it is now 90), and `e2e.md` still names
`Crazz / test` as the secondary account, while this file says `SPO_test` / `test`.

A screen whose data the world may not hold — the world-event ticker, the tutorial, the chase
badge with the secondary account (`SPO_test`) online — is recorded **absent**, not failed. `SPO_test` is never required. A pass
against the production URL runs only when the maintainer asks for one.

### Phase 0 — Lease the bench
```
Bash (background): npm run dev -- --lease-minutes=90   # bench lease — returns when THIS
                                                       # worktree's gateway is ready on :8080
                                                       # (~2 min cold build)
browser_navigate → http://localhost:8080
browser_resize → 1440×900
```
The walkthrough opens every screen once, including the tablet pass and the Mayor sub-phase, so
the lease is 90 minutes. The lease is the only
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
   `Demolish road`, `Search`, `Map overlays`, `Docked minimap`, `My facilities`, `Settings`,
   `Keyboard shortcuts`, `Switch server` — plus `Zone painting` while
   `login.isPublicOfficeRole` is true (that item is opened only in Phase 8b). Here open only:
   - `Docked minimap` — assert `panels.minimap` flips, click again to restore.
   - `Switch server` — assert `ui.serverSwitchMode === true` and the region picker; leave with
     `Back to planitia`, assert `ui.serverSwitchMode === false` and the map still loaded. Pick
     nothing in it.

   `Search`, `My facilities` and `Map overlays` are opened in Phase 3; `Build road`, `Demolish road`,
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
   `panels.buildingDetails === true`; close it). Click `Bookmark this place`: assert the dialog
   "Bookmark this place" and `ui.modal === "prompt"`; click `Cancel` (never press Enter — the
   field holds a default value, so Enter saves it), assert `ui.modal === null`. Never rename or
   delete a bookmark.
3. **Empire** — `Empire` tile (sheet "Profile"); in `Profile sections` open each of
   Curriculum, Bank Account, Profit & Loss, Companies, Initial Suppliers, Strategy and assert
   `subViews.profileTab` reads `curriculum`, `bank`, `profitloss`, `companies`,
   `autoconnections`, `policy`; close each with `Close section` (`subViews.profileTab === null`).
   While a section is open, also:
   - **Bank Account** — click `Request Loan`: assert the form with its `Borrow` and `Cancel`
     buttons, click `Cancel`. Same for `Send Money` (`Send` / `Cancel`) when shown. Never
     `Borrow`, `Send` or `Pay Off` (`Pay Off` writes with no confirmation). No `getState()`
     field exists for these forms: assert `subViews.profileTab === "bank"` and the buttons by
     name.
   - **Initial Suppliers** — click `Add Supplier` under one fluid (`handleOpenSearch` in
     `ProfilePanel`). Assert the dialog "Find supplier for <fluid>",
     `ui.modal === "supplierSearch"` and `subViews.profileTab === "autoconnections"`; click its
     `Close`, assert `ui.modal === null`. Never `Search`, never `Add Selected`; touch no switch
     and no `Remove`.
   - **Portrait** — click `Change portrait` (the profile header). Assert the dialog
     "Change portrait" — `ui.modal` stays null, the dialog is local state — then click `Cancel`.
     Never choose an image, never `Send`.
4. **Government** — `Government` tile; assert `panels.politics === true` and the home shows its
   "Capitol" and "Towns" sections. Click `Open the Capitol` (`PoliticsHome` →
   `client.onOpenCapitol`); if it is disabled ("No Capitol found in this world"), record this
   part *absent*. Assert `ui.stack` is `['building']`, `panels.buildingDetails === true` and
   `buildingDetails.tabs` contains `capitolTowns` or `ministeries`. Open each civic tab present
   (`role="tab"`: Overview, Administration, …), reading only — Administration shows Towns and
   Ministries. **Never click `Elect`**: it opens a prompt that writes on Submit, and it is
   president-only. Close the sheet. (The Helartia town hall is Phase 4.)
5. **Mail** — `Mail` tile; assert `panels.mail === true`, `subViews.mailView === "list"`. Click
   each tab `Inbox`, `Sent`, `Drafts` and assert `subViews.mailFolder` = `Inbox`, `Sent`,
   `Draft`. Open **one** message — from `Sent` by default — assert `subViews.mailView === "read"`,
   return with `← Back`. An Inbox message may be opened only if its row is not styled unread (the
   row carries `styles.unread` in `MailPanel.tsx`; the class is hashed, so match
   `[class*="unread"]` on the row — an inference, say so in the report); the folder badge is only
   a count. **An unread Inbox message is never opened**: opening it makes the gateway's
   `markInboxMessageRead` (`src/server/session/mail-handler.ts`) clear the mail server's unread
   flag, and no RDO member can set it back — `Mail Server/MailServer.pas:557`,
   `Mail/MailMessageAuto.pas:165-166`. Click `Compose`: assert `subViews.mailView === "compose"`,
   then click `Cancel` (`clearCompose` saves no draft and sends nothing) and assert
   `subViews.mailView === "list"`. Never `Send` or `Save draft`; Reply, Forward and Delete are
   never clicked.
6. **Search** — More → `Search`. Assert `panels.searchMenu`
   and `subViews.searchPage === "home"`. Open each page the home offers once — `towns`,
   `people`, `rankings`, `banks`, `media`, `directory`, and a tycoon's `tycoon-profile` /
   `tycoon-full-profile` when reachable — asserting `subViews.searchPage`, and return with
   `← Back`. A page with no tile on the live home is recorded *absent*. Then:
   - **Ranking detail** — on `rankings`, click one category row (rows have no role: use a text
     locator). It sends `REQ_SEARCH_MENU_RANKING_DETAIL`, a read. The detail renders inline and
     `subViews.searchPage` **stays `"rankings"`** — no store value ever reads `ranking-detail`,
     so assert the request in `__spoDebug.history` and the detail's heading. Return with
     `← Back to rankings`.
   - **Newspaper** — on `media`, click one paper card (`role="button"`, named by paper and
     town). Assert the dialog "<paper> — daily issue" and `ui.modal === "newspaper"`; it reads
     `REQ_NEWSPAPER_ISSUES` / `REQ_NEWSPAPER_ISSUE`. Never `Post a column`. Click `Close`. The
     second entry point — `Read News` on a town hall's Overview (`OverviewSection`, beside
     `Rate the Mayor`) — is walked in Phase 4 step 5.
7. **My facilities** — More → `My facilities`; assert the top of `ui.stack` is `facilities`.
   Click `New folder` (`+ New Folder`): assert the dialog "New folder" and
   `ui.modal === "prompt"`, then click `Cancel`. Facility and folder rename is an inline field,
   not a prompt, and committing it writes: leave it untouched. Do not create or rename a folder.
8. **Map overlays** — More → `Map overlays`; assert the top of `ui.stack` is `overlays`. Click
   one item (e.g. `Beauty`): assert `layers.overlay === "Beauty"` (the `SurfaceType` value);
   click it again, assert `layers.overlay === null`. The **facility filter** in the same menu
   (`FacilityFilter`): assert its `Show all` / `Hide all` buttons and its checkboxes, and toggle
   nothing — a toggle writes `settings.hiddenFacIds` to the browser's localStorage (never the
   server), and is still not touched. No `getState()` field exists for the filter.
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
   is recorded *absent*. Read only — no rating, tax or vote control is touched. On its Overview,
   if `Read News` is present, click it: assert `ui.modal === "newspaper"`, then `Close`.
6. **Right-click menu** — on your own building, `page.mouse.click(x, y, { button: 'right' })`
   with no movement: assert `[data-testid="map-context-menu"]`, `ui.contextMenuOpen === true`
   and a `menuitem` reading `Inspect`; click it and assert the building surface opens
   (`nav[aria-label="Facility sections"]` present). Right-click an empty `tileProbe` tile: the
   menu has no `Inspect` item (`Centre view here` only). Press Escape: the menu is gone
   (`ui.contextMenuOpen === false`). Right-drag 100 px (press, move, release, all with
   `button: 'right'`): no menu appears and the camera panned instead.
7. **One inspector per fixture kind** — using the #1149 fixtures. They have no committed
   coordinates (`findFixture` in `src/e2e/fixtures.ts` finds them by kind at run time): open
   each from a More → My facilities row and identify it by its `buildingDetails.tabs` ids
   (`template-groups.ts`):

   | Kind | Tab ids |
   |---|---|
   | generic industry | `indGeneral` + `supplies` + `products` |
   | warehouse | `whGeneral` |
   | residential | `resGeneral` |
   | TV | `tvGeneral` |
   | research HQ | `hqGeneral` + `hqInventions` |
   | bank | `bankGeneral` |

   Open each kind's own section once and touch no control in it; close the sheet. A kind missing
   from My facilities is recorded *absent*.
   - **Research HQ** — the "Research" section mounts `ResearchPanel`, which reads
     `/api/research-inventions` and sends `REQ_RESEARCH_INVENTORY`. Its `Research`, `Cancel` and
     `Sell` buttons write: never click them.
   - **Bank** — `BankLoanRequest` renders only for a **visitor** (`PropertyGroup`), so on
     SPO_test3's own bank it is recorded *absent* with that reason. The owner sees sliders,
     which stay untouched.
8. **Supplier-search surface** — on the industry fixture's Supplies or Products section, expand
   one gate card and click `Hire` (`handleHire` → `ClientBridge.showConnectionPicker`). Assert
   `ui.stack` is `['building','supplierSearch']`, the region "Find Suppliers" and its heading
   "Find Suppliers for:" (or "Find Clients for:" from Products); `panels.buildingDetails` reads
   false while the picker is on top. Never `Search`, never `Connect Selected`, never
   `Pick on map`. Leave with the picker's own `Close` — scope it inside the picker, the sheet
   has a `Close` too — and assert `ui.stack` is `['building']`. If `Hire` is not offered (no
   edit rights), record it *absent*.

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
5. **Channel password prompt** — in the channel picker, if a protected channel is listed, click
   it: assert the dialog `Join "<channel>"` and `ui.modal === "prompt"`, then click `Cancel`
   (never type a password, never press Enter). With no protected channel, record it *absent*
   with that reason.

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

- **Banner Connect** — as `SPO_test3`, the diagnosis banner's `Connect` (`DiagnosisBanner`), in
  both inspectors. Read-only: the map is never clicked while connect mode runs.
  - **Building**: the TV station **TV 1** at (968, 993), banner
    "No antenna attached — connect one.", or the antenna at (933, 993), banner
    "Connect this antenna to a station.". Reach it
    with the **Clicking a Building on the Map** recipe. The map preview's banner is compact and has
    no button, so the full inspector must be opened.
  - **Nothing-sent check**: just before each click, take a baseline `t0 = Date.now()`. After
    Escape, `__spoDebug.history` must hold no `REQ_CONNECT_FACILITIES` entry (`message-types.ts`)
    with `ts > t0` — the count is unchanged (0 before, 0 after); a completed connect would send one.
  - **(a) Classic inspector**: preview → `INSPECT` → `BuildingInspector`. Click the banner's
    `Connect` — not the General tab's `Connect` action. Assert `modes.connecting === true` (the
    pick cursor or connect hint shows). Press Escape; assert `modes.connecting === false` and the
    nothing-sent check.
  - **(b) v2 inspector**: More → `Settings` → section "Interface" → `In-game interface` →
    `New (experimental)`; assert the v2 chrome (dock, top bar) and `Close`. Click the same building
    on the map; the `FocusCard` appears — click its `Inspect` (`data-testid="inspect-button"`) and
    the side panel shows `InspectorV2`. Same banner `Connect` click, same
    `modes.connecting === true`, same Escape → `false`, same nothing-sent check with a fresh `t0`.
  - **Switch back** (mandatory, even when (b) fails or is recorded absent after the switch): dock
    `More` → `Settings` → "Interface" → `Classic`, `Close`, assert the classic chrome is back.
    `uiVersion` is persisted in localStorage (`ui-version.ts`) and survives a logout, so leaving v2
    on would change every later phase and the next run.
  - **Absent**: if neither building shows the banner (the station already has an antenna attached,
    or the buildings are gone), the step is recorded *absent* with that reason — still switching
    back if v2 was turned on.

- **Zone painting** — opened in Phase 8b, not here. `login.isPublicOfficeRole` is set from the
  account's real offices by the `REQ_TYCOON_ROLE` reply, and SPO_test3 is mayor and minister,
  so `Zone painting` may already be listed in the More menu at this point. It is still opened
  only in Phase 8b, which follows the chosen Mayor login. Never paint.
- **Command palette** — Ctrl+K; assert `ui.commandPaletteOpen === true`; Escape, assert false.
- **Hidden HUD** — `h`; assert `ui.hudVisible === false`; restore with the `Show` toast (or `h`),
  assert true.
- **Debug overlay** — `d`; assert `renderer.debugMode === true`; `d` again, assert false.
- **Shortcuts** — `?`; assert the dialog "Keyboard shortcuts" and `ui.modal === "shortcuts"`;
  close it. The same dialog is More → `Keyboard shortcuts`.
- **Settings** — More → `Settings`; assert the dialog "Settings" and `ui.modal === "settings"`.
  Scroll through each section — Visual, Audio, Connection, Ignored Players, Keyboard Shortcuts,
  and Support when the bug reporter is on — toggling nothing; `Close`. (Interface is switched
  only in the **Banner Connect** step above, and always switched back to `Classic`.)
- **Bug reporter** — present only when the gateway runs with `SPO_BUG_REPORT`
  (`window.__SPO_BUG_REPORT__` defined, `src/server/runtime-config.ts`). When present: Settings →
  Support → `Report a problem` arms it (`[data-testid="report-mode-overlay"]`,
  `bugReporter.armed === true`). While armed, make **one** capture click on the map: `onCapture`
  in `BugReportRoot.tsx` only sets local state — the sole POST is `send`, to `/api/bug-report`.
  Assert the dialog "Report a bug" (`ReportModal`) and `bugReporter.modalOpen === true`. Click
  its `Cancel` (Escape is not wired there) and assert
  `bugReporter.modalOpen === false && bugReporter.armed === false`. Never `Send report` — a
  submit files a real report. The bench lease loads no production `.env`, so it is normally
  recorded *absent*.

### Phase 7 — Mobile pass
`browser_resize` → 390×844 (below 1024 px the `MobileShell` replaces the desktop chrome).

1. **BottomNav** (`role="tablist"` "Game actions") — tap each tab and assert `ui.mobileTab`:
   `Build` → `build`, `Map` → `map`, `Chat` → `chat`, `More` → `more`; `Government` and `Mail`
   leave `ui.mobileTab === "map"` and put `politics` / `mail` on top of `ui.stack`.
2. **BottomSheet snaps** — with a sheet open, tap `Resize panel`: `ui.mobileSheetSnap` cycles
   `half` → `full` → `half`. `peek` is reachable only by a touch drag → recorded *absent*.
   `Close` the sheet.
3. **MobileMenu** — the `More` tab lists the groups Communication, Exploration, Map Controls,
   System; confirm each is present. Each destination is tapped in step 9.
4. **Mobile build content** — the `Build` tab shows the sub-tabs Buildings, Roads, Demolish;
   open each, start no mode. Assert `panels.buildMenu === true` while the tab is shown, and
   `build.mobileSubTab` reads `buildings` / `roads` / `demolish` per sub-tab.
5. **Search pill** (`MobileSearchPill`, button "Search or run a command") — shown on the Map
   tab with no sheet open and no mode running. Tap it, assert `ui.commandPaletteOpen === true`;
   Escape, assert `false`. No `getState()` field exists for the pill itself.
6. **Placement HUD** (`PlacementHUD`) — from the Build tab, enter Placement on one facility.
   Assert `modes.placingBuilding === true` and the buttons `Cancel placement`, `Rotate view`,
   `Confirm placement`. Tap `Cancel placement`, assert `false`. **Never `Confirm placement`**:
   it builds a real building.
7. **Mode bar** (`MobileModeBar`) — from the Build tab's Roads sub-tab, enter Road mode. Assert
   `modes.roadBuilding === true` and the button `Done — leave Road mode`. Tap it, assert
   `false`. Nothing is drawn.
8. **Inspector in the bottom sheet** — More → `My facilities`, then tap a facility row (named
   after the facility). Assert the bottom sheet `role="dialog"` "Building Inspector",
   `panels.buildingDetails === true` and `ui.mobileSheetSnap`. `Close`.
9. **Every MobileMenu destination** — each tapped from the `More` tab, asserted, and closed:

   | Group | Item | Assert |
   |---|---|---|
   | Communication | Mail | `ui.stack` is `['mail']` |
   | Exploration | Search | `['search']` |
   | Exploration | Command palette | `ui.commandPaletteOpen` |
   | Exploration | Profile | `['empire']` |
   | Exploration | My facilities | `['facilities']` |
   | Exploration | Government | `['politics']` |
   | Map Controls | Zoom In / Zoom Out | `renderer.zoom` changes and restores |
   | Map Controls | Rotate view | `renderer.rotation` changes; rotate back to the start |
   | Map Controls | Map Overlays | `['overlays']` |
   | Map Controls | Refresh Map | `renderer.mapLoaded` stays true |
   | System | Settings | `ui.modal === "settings"` |
   | System | Debug Overlay | `renderer.debugMode` flips; restore it |
   | System | Support | only when the bug reporter is on — Phase 6 rules |
   | System | Switch Server | `ui.serverSwitchMode === true`; leave through its back control as in Phase 2, pick nothing |
   | System | Logout | `ui.modal === "confirm"` and the dialog "Log out"; then **`Cancel`** — never `Log out` here |

10. **Report button** (`ReportFab`) — renders only with `SPO_BUG_REPORT=true` and a width below
    768 px. The lease does not set the variable, so it is normally recorded *absent*; when
    present, its `QuickPickGrid` follows Phase 6's rules (one capture, `Cancel`, never send).

`peek` stays recorded *absent* (touch drag only).

### Phase 7b — Tablet pass
`browser_resize` → 900×1000. `BREAKPOINTS` in `useResponsive` calls 768–1023 px `tablet`, and
it gets the same `MobileShell` as a phone; only text sizes and panel widths differ, and there
is no `ReportFab`. One pass:

1. Each BottomNav tab, asserting `ui.mobileTab` as in Phase 7 step 1.
2. One sheet open, assert `ui.mobileSheetSnap`, then `Close`.
3. The `More` tab lists the four groups Communication, Exploration, Map Controls, System.
4. `mobile.infoBar === true`.
5. The desktop `nav[aria-label="Game actions"]` is hidden, while the BottomNav
   `role="tablist"` "Game actions" is shown.

`browser_resize` → 1440×900 before Phase 8.

### Phase 8 — Wire health
**Assert:** `wire.sent > 10`, `wire.received > 10`, `wire.errors === 0`.

1. **Reconnect overlay** — take the browser offline with `browser_run_code_unsafe`:
   `async (page) => { await page.context().setOffline(true); }`.
2. Wait up to 30 s for `ReconnectingOverlay` (mounted in `App.tsx`): a `role="status"` titled
   "Connection lost", the line "Reconnecting… attempt N of 15", a `Try now` button, and
   `panels.login === true` with `session.connected === false`. `getState()` has no status
   field; `panels.login` reads `status !== 'connected'`.
3. Bring the browser back with `setOffline(false)`, click `Try now`, and wait until
   `panels.login === false && renderer.mapLoaded === true`.
4. The client learns of a disconnect only from the socket's own `onclose`, and Chromium's
   offline emulation may leave an open WebSocket untouched. If no overlay shows within 30 s,
   restore online and record the step **absent: "a live WebSocket does not close offline"**.
   Use no other way to kill the socket: only the offline route is allowed.
5. Re-assert `wire.errors === 0`. Record any reconnect error; never re-run the step to hide it.

### Phase 8b — Mayor of Helartia sub-phase
1. Log out (More → `Settings` → `Logout` → `Log out`).
2. Follow the login table again up to "Select a Company".
3. Under the "Political Offices" heading (`CompanyStage.tsx`), click the card (`role="button"`)
   whose badge reads `Mayor of Helartia`. A Minister card is listed first: never click the first
   card blindly. The click sends `REQ_SWITCH_COMPANY` — a read-only role choice, driven live by
   the L2 `company-switch` flow.
4. Assert the standard post-login set — record `session.companyName` rather than match it
   against `SPO_test3`, since this login enters through the office — and
   `login.isPublicOfficeRole === true`.
5. Open More → `Zone painting` (menuitem). Assert the dialog "Zone Type Picker",
   `ui.modal === "zonePicker"` and `modes.zonePainting === false` — opening the picker sends
   nothing.
6. Click `Close` without picking a zone. Assert `ui.modal === null` and
   `modes.zonePainting === false`. Nothing is painted; `REQ_DEFINE_ZONE` is never sent.

Phase 9 then exits from this session.

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
| 7b Tablet pass | |
| 8 Wire health | |
| 8b Mayor sub-phase | |
| 9 Clean exit | |

Out of scope: the tutorial surface (`TutorialPanel`, recorded absent when there is no
assignment; its Close finalises the task); the `CompanyStage` visitor, world-full, nobility,
world-limit and access-denied views (unreachable with the LOCKED accounts); the new-version
banner (`NewVersionBanner`) and the crash screen (`CrashScreen`) (not safely triggerable).
