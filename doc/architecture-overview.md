# Architecture Overview

## Directory Structure

```
src/
├── client/
│   ├── client.ts              # StarpeaceClient — game session + canvas UI
│   ├── main.tsx               # Vite entry, mounts React app
│   ├── App.tsx                # Root router (LoginScreen vs GameScreen)
│   ├── bridge/                # ClientBridge (pushes state to Zustand stores)
│   ├── context/               # ClientContext + useClient() hook
│   ├── store/                 # Zustand stores (11 total)
│   ├── hooks/                 # Custom hooks (usePanel, useResponsive, etc.)
│   ├── styles/                # Design tokens, reset, typography, animations
│   ├── layouts/               # LoginScreen, GameScreen
│   ├── components/            # React UI (60+ components, CSS Modules)
│   │   ├── common/            # Badge, Toast, GlassCard, Skeleton, etc.
│   │   ├── hud/               # StatusPill, CommandBar, RightRail
│   │   ├── building/          # BuildingInspector, QuickStats, PropertyGroup
│   │   ├── empire/            # EmpireOverview, FacilityList
│   │   ├── mail/              # MailPanel
│   │   ├── chat/              # ChatStrip
│   │   ├── search/            # SearchPanel
│   │   ├── politics/          # Capitol tabs (Towns, Ministries, Jobs, Votes)
│   │   ├── modals/            # BuildMenu, Settings, CompanyCreation
│   │   ├── mobile/            # MobileShell, BottomNav, BottomSheet
│   │   └── command-palette/   # CommandPalette (Cmd+K)
│   ├── renderer/              # Canvas 2D isometric engine
│   └── ui/                    # Canvas UI (minimap + map navigation)
├── server/
│   ├── server.ts              # HTTP/WebSocket server + API endpoints
│   ├── spo_session.ts         # RDO session manager
│   ├── rdo.ts                 # RDO protocol parser
│   └── *-service.ts           # Background services (ServiceRegistry)
└── shared/
    ├── rdo-types.ts           # RDO type system (CRITICAL)
    ├── error-utils.ts         # toErrorMessage(err: unknown)
    ├── types/                 # Type definitions
    └── building-details/      # Property templates
```

**No Transport panel.** The legacy transport handler was non-visual
(`Voyager/URLHandlers/TransportHandler.pas:139`, `:180-183` — `hopNonVisual`, `getControl`
returns `nil`), so there was never a route-management screen to port; the panel, its
`transport-store.ts` and the `ui-store` entry were removed in PR #270.

**Porting a legacy screen?** [legacy-parity-map.md](legacy-parity-map.md) names the WebClient file that owns each Voyager panel and ASP page of the original client.

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/map-data/:mapName` | Map terrain/building/road data |
| `GET /api/road-block-classes` | Road block class definitions |
| `GET /api/concrete-block-classes` | Concrete block class definitions |
| `GET /api/car-classes` | Car class definitions |
| `GET /api/terrain-info/:terrainType` | Terrain type metadata (seasons) |
| `GET /api/startup-status` | Server startup status and build info |
| `GET /api/health` | Liveness + cached directory reachability (public; 200/503, `Cache-Control: no-store`) |
| `GET /api/metrics` | Runtime metrics JSON (**local-only**: loopback peer and no `X-Forwarded-For`; also logged as `METRICS` every 60 s at `info`) |
| `GET /api/rdo-error-contract` | P-M3 `errorCode` contract census readout (**local-only**) |
| `GET /api/property-fallback` | P-M3 property-fallback census readout (**local-only**) |
| `POST /api/client-error` | Anonymous browser error report (no identity fields), 20/min/IP, 60/min gateway-wide; logged as `CLIENT_ERROR` at `warn`, counted in `/api/metrics` `clientErrors` |
| `GET /cache/:category/:filename` | Object texture (BuildingImages served locally) |
| `GET /cdn/*` | Static asset delivery (CSS, JS, images) |
| `GET /proxy-image?url=<url>` | Image proxy for remote assets |
| `GET /spo-runtime-config.js` | Client runtime configuration |
| `WS /ws` | WebSocket connection for game protocol |

## Services (ServiceRegistry)

Service files live flat in `src/server/` (no subdirectory).

| Service | Purpose | Dependencies |
|---------|---------|--------------|
| `update` | Sync game assets | none |
| `facilities` | Building dimensions | update |
| `mapData` | Map data caching | update |

## Session parking

A browser tab that sleeps or reloads drops its WebSocket. The gateway, not the browser, holds the
TCP connection to the Interface Server, so the gateway keeps that connection open while the tab is
away ("parks" the session) and lets the returning tab re-attach it with a single-use token.
Module: `src/server/session-park.ts` (pure); wiring: the `wss.on('connection')` closure in
`src/server/server.ts`. Card #1045; the browser side is #1046, the live proof #1047.

### Why the gateway must keep the connection (Delphi facts, `~/SPO-Original`)

- A ClientView lives exactly as long as its TCP connection: `TClientView.OnDisconnect` →
  `DoLogOff` (`Interface Server/InterfaceServer.pas:1799`, `:1949`) → `TInterfaceServer.Logoff`
  (`:3296`), which sends `RDOSleepTycoon` (`:3304`) and removes the view from `fClients` (`:3314`).
- Nothing ends a view whose connection stays open: the idle check (`CheckState`, `:2458`) and its
  `fSentinel` timer (`:2676`) are commented out, and the published `TClientView.Logoff` is a
  no-op (`:2019`). The transport only reacts to a real disconnect
  (`Rdo/Server/WinSockRDOConnectionsServer.pas:707`).
- There is no re-attach. `AccountStatus` (`:3131`) looks up an existing view by name (`:3138`)
  and, on a matching password, retires it (`[OJO!] Retiring the old Client View`, `:3145`,
  `PreviousClient.DoLogoff`, `:3146`) before answering `ACCOUNT_Valid` (`:3151`); on a wrong
  password it answers `ACCOUNT_InvalidName` (`:3153`). `Logon` refuses a name that still has a
  view (`:3192`). Voyager never re-attached either: `OnSocketDisconnect`
  (`Voyager/URLHandlers/ServerCnxHandler.pas:3482`) ends in a brand-new `Logon` (`:3439`).
- The name match is case-insensitive (`GetClientByName`, `InterfaceServer.pas:3508-3511`), so the
  gateway keys parked sessions by the upper-cased username.
- Voyager sends `ClientNotAware` only inside `Logoff` (`ServerCnxHandler.pas:2043`), and
  `TClientView.ClientNotAware` broadcasts a "user left" message (`InterfaceServer.pas:1704`).

### Lifecycle

- **Park.** When a WebSocket closes and its session is `WORLD_CONNECTED` and holds a token, the
  session keeps its world / map / mail sockets, its timers (ServerBusy poll, KeepAlive) and its
  state; it is detached from the dead WebSocket and a park timer starts. **Nothing is sent
  upstream** — no `ClientNotAware`, no `get Logoff`: to the world it is a connected, idle player.
  A close that follows `REQ_LOGOUT`, a close during the shutdown drain, a close over the cap and a
  close in any other phase end the session exactly as before (`endSession()` then `destroy()`).
  A WebSocket cut by the heartbeat (`ws-hygiene.ts`) parks like any other close; a parked session
  has no WebSocket, so the heartbeat cannot reach it.
- **While parked.** Server pushes keep arriving. Events go to the session's *current*
  WebSocket; with none they are dropped, except a FIFO of at most 100 events that nothing can
  re-read later: `EVENT_CHAT_MSG`, `EVENT_SHOW_NOTIFICATION`, `EVENT_NEW_MAIL`,
  `EVENT_TYCOON_RETIRED`. Everything else is state the session tracks or map data the client asks
  for again.
- **Re-attach.** `REQ_RESUME_SESSION { username, token }`, as the first message on a new
  WebSocket: the new connection's empty session is dropped, the parked session is bound to the
  new WebSocket, its park timer is cleared, a still-open previous WebSocket (the phone that slept)
  is terminated, and the gateway answers `RESP_RESUME_SESSION` with a snapshot (username,
  `tycoonId`, world name / size / season, company `{id, name, ownerRole}`, money, virtual date,
  failure level, camera, chat channel), replays the FIFO in order, then pushes a new token.
  Every refusal — unknown token, used token, token for another username, expired park — answers
  the same `ERROR_AccessDenied` "Session cannot be resumed" and leaves the parked session alone.
- **Expiry.** When the park timer fires: `endSession()` + `destroy()`, the path a close took
  before parking existed.
- **Eviction.** `REQ_LOGIN_WORLD` first ends every *parked* session of the same username and
  waits for its `get Logoff` to be acknowledged or to time out (`LOGOFF_TIMEOUT_MS`), and only
  then sends `AccountStatus`. Otherwise `AccountStatus` would retire the parked view underneath
  the gateway (a zombie session polling a dead context), or answer `ACCOUNT_InvalidName` to a
  wrong password for as long as the view lives.
- **Shutdown.** The shutdown drain ends parked sessions along with attached ones.

### Token rules

- `EVENT_SESSION_RESUME_TOKEN { token }` is pushed once the world is entered (after
  `REQ_SELECT_COMPANY` / `REQ_SWITCH_COMPANY`) and again after every re-attach.
- 32 random bytes from `crypto.randomBytes`, base64url. The gateway keeps only its SHA-256,
  bound to the username (**not** to the IP), and compares with `crypto.timingSafeEqual`.
- Single-use: every re-attach consumes it and issues a new one. It dies with the park.
- It travels only as the first message on a new WebSocket, never in a URL, and is never logged.
- Residual risk: anyone who reads the token from the tab (XSS on the origin, a shared browser
  profile) before its next use can take over the parked session from any IP, for at most
  `SPO_SESSION_PARK_MS`.
- `REQ_RESUME_SESSION` is allowed before authentication and has its own per-IP `auth:` rate-limit
  bucket at `RATE_LIMIT_MAX_AUTH` (`checkResumeRateLimit`, `rate-limit.ts`).

### Limits

| Setting | Default | Meaning |
|---------|---------|---------|
| `SPO_SESSION_PARK_MS` | `300000` (5 min) | How long a parked session waits for its tab |
| `SPO_MAX_PARKED_SESSIONS` | `100` | Global ceiling on parked sessions (SEC-W-3); over it a closing session ends at once. `0` disables parking. The number is a planner choice — the card set none |
| `SPO_MAX_SESSIONS` | `recommendedCap` of `src/__tests__/load/session-capacity.json` (4550) | Global cap on admitted game sessions, parked ones included (SEC-W-3); a `REQ_LOGIN_WORLD` over it gets `RESP_ERROR` "server full" and a 1013 close. A resume is never capped. An invalid value stops the gateway at start |

A parked session keeps its `wsConnectionsPerIp` slot under the IP that parked it until it ends or
is re-attached; a re-attach from another IP moves the slot to the new IP. The password stays in
memory only (SEC-L-1) and `destroy()` clears it when the park ends.

### Maintainer decisions (2026-09-27)

- Park duration `SPO_SESSION_PARK_MS`, default 5 minutes — about the client's reconnect window.
  While parked the player still appears online and holds a Delphi ClientView.
- The resume token is not bound to the IP (mobile players switch between Wi-Fi and mobile data);
  it is high-entropy, single-use, rotated on every re-attach, bound to the username.
- "Newest login wins" for *attached* sessions is out of scope: a fresh login evicts only parked
  sessions.
- The WebSocket heartbeat belongs to the socket-hygiene card (#1044).

### The browser side

The tab keeps the latest token and hands it back on its next socket, so a dropped connection or a
reloaded page returns to the same Delphi session instead of logging in again. Module:
`src/client/store/resume-token.ts`; wiring: `attemptReconnect` and `resumeHeldSessionAtStartup`
in `src/client/client.ts`, `enterFromResumeSnapshot` in `src/client/handlers/auth-handler.ts`.
Card #1046.

- **Where it lives.** The `sessionStorage` key `spo_resume_token` holds `{ username, token }`
  (the login username the gateway parked the session under). It is written on
  `EVENT_SESSION_RESUME_TOKEN`, replaced on each rotation, and deleted on Logout (before the
  post-logout reload) and on any refusal. Every access is wrapped in try/catch: a storage that
  throws reads as "no token".
- **Socket dropped, page alive.** While a token is held, the first frame on the reconnect socket
  is `REQ_RESUME_SESSION` — including the immediate attempt on `visibilitychange`, `pageshow` or
  `resume`. On success the game view is kept: the stats are updated from the snapshot, and the
  camera, the visible map area and the open building inspector are sent again. On refusal the
  login replay runs on the same socket when the password is still in memory; otherwise the
  status becomes `session_expired`. With no token held, the reconnect is the login replay.
- **Page reloaded (F5 or a discarded tab).** A held token is sent at start-up, before the login
  screen settles. On success the client enters the game from the snapshot through
  `enterWorldWithCompany`, the same function `selectCompanyAndStart` calls after a company is
  chosen, with no login and no company step. On refusal the normal login screen shows, with the
  remembered session.
- **Why `sessionStorage`.** It belongs to one tab, survives a reload and a discard, and dies with
  the tab: a second tab must never take over the first tab's session.

### The L2 drive

`logoff` in `src/e2e/session.ts` is a bare `driver.close()` with no `REQ_LOGOUT`, so every L2
flow's close now parks the account's session, and the next flow's login evicts it live. Changing
that helper is card 3/3's ground (#1047).

## SkillsMP

Search SkillsMP API before creating custom skills. Prefer skills with 1,000+ stars.
- Installed: [.claude/skills/](../.claude/skills/) | Metadata: [manifest.json](../.claude/skills/manifest.json) (`jq '.counts.total' .claude/skills/manifest.json` total)
