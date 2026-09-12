# Starpeace Online — WebClient

A browser-based multiplayer tycoon game client for [Starpeace Online](http://www.starpeaceonline.com), rebuilt from scratch in TypeScript with React 19 and a custom Canvas 2D isometric renderer.

![release](https://img.shields.io/github/v/release/Crazz-Org/SPO-WebClient)

## Overview

Starpeace Online is a massively multiplayer economic simulation where players build companies, trade goods, run for political office, and compete in a persistent online world. Originally shipped as a Delphi Win32 desktop client in the early 2000s, the game runs on dedicated servers that speak a custom RDO (Remote Data Objects) protocol over TCP.

This project is a modern web client that replaces the original desktop application. A Node.js gateway translates browser WebSocket messages into raw RDO commands, handling authentication, session management, and asset serving. The browser client renders the isometric game world on Canvas 2D and provides the full game UI in React.

```
Browser Client ──WebSocket──> Node.js Gateway ──RDO/TCP──> Game Servers (Delphi)
```

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Language | TypeScript (strict mode) | 5.9 |
| Client UI | React, Zustand, CSS Modules, Lucide React | 19.2, 5.0 |
| Accessibility | React Aria Components | 1.15 |
| Rendering | Canvas 2D isometric engine (custom) | — |
| Server | Node.js, WebSocket (ws) | 18+, 8.x |
| Protocol | RDO over TCP (binary/text, type-prefixed values) | — |
| Build | Vite (client), tsc (server), esbuild (terrain test) | 7.3 |
| Testing | Jest, ts-jest, Testing Library | 30.2 |
| HTML Parsing | Cheerio (mail body extraction) | 1.1 |
| Animation | gifuct-js (GIF decoding for vehicle sprites) | 2.1 |
| Archive | 7zip-min (CAB asset extraction) | 2.1 |
| CDN | Cloudflare R2 + CDN (static terrain assets) | — |

## Key Features

- **Canvas 2D isometric engine** — 9-layer renderer (terrain, vegetation, concrete, roads, buildings, zones, placement preview, road preview, UI overlays) with chunk caching, texture atlases, and vehicle animations
- **React 19 UI with Zustand state** — 65+ React components across 16 directories, styled with CSS Modules. 11 Zustand stores manage all client state
- **Four-stage cinematic login** — Authentication > Zone > World > Company selection with glassmorphism cards and animated backgrounds
- **MMORPG-style HUD** — Top bar with status ticker, left/right rails, slide-in panels, minimap, overlay menu
- **Building inspector** — Real-time facility data with tabbed property groups (General, Supplies, Production, Workforce, Budget, Research), quick stats, revenue graphs, and pricing controls
- **Empire overview** — Company facility list, financial summaries, profile panel, favorites
- **Mail system** — Folder-based mail (Inbox, Sent, Drafts) with compose, reply, save draft, and HTML body rendering
- **Chat system** — Channel-based chat with typing indicators
- **Politics** — Six tabs: Jobs, Ministries, Ratings, Residentials, Towns, Votes
- **Transport** — Route management panel
- **Search** — Cross-entity search: Home, Towns, People, Rankings, Banks with tycoon profile view
- **Build menu** — Category-based building placement with zone-type picker and placement validation
- **Command palette** — Ctrl+K keyboard launcher for quick navigation and actions
- **Mobile-responsive** — Bottom navigation, bottom sheets, touch handling, responsive breakpoints
- **Road and concrete systems** — Road building/demolition with topology-based texture selection, concrete tile rendering around buildings
- **Surface overlays** — Environment, population, and market data visualizations on the map
- **Mock server** — L1 protocol substrate (`src/mock-server/`): an RDO mock, a strict wire validator and per-feature scenarios, used for protocol-conformance tests. Not a mock backend for end-to-end runs — those go live against the real servers (`src/e2e/`)
- **Service registry** — Managed service lifecycle with dependency ordering, health checks, and graceful shutdown
- **In-app changelog** — Version badge with changelog modal for tracking updates
- **Docker-ready** — Dockerfile and docker-compose.yml build a production-ready container; the deploy procedure itself lives in [SPO-Deploy](https://github.com/Crazz-Org/SPO-Deploy)
- **Auto-reconnect** — Seamless session recovery on mobile tab switch without re-login

## Getting Started

### Prerequisites

- Node.js >= 22 (`engines` in package.json; the Dockerfiles and CI both use Node 22)
- npm >= 10

### Install & Run

```bash
npm install
npm run dev:local  # Build all + start the server (first free port from 8081 up)
```

`dev:local` prints the port it chose — open that URL. It is **never 8080**: on the shared
test machine the bench worker owns 8080, and a hook refuses any other way of taking it.
Pass `PORT=<n>` to pick one yourself.

## Production Deployment

[SPO-Deploy](https://github.com/Crazz-Org/SPO-Deploy) owns the deploy procedure, script,
nginx config and env template, and deploys from this repo's tagged Releases. This repo
only produces the build artifact (`Dockerfile`, `docker-compose.yml`) and the Releases
(`release.yml`). See SPO-Deploy's `DEPLOY.md` for the full step-by-step guide (VPS setup,
firewall, SSH hardening, fail2ban, Docker install, DNS, TLS, security checklist,
verification, troubleshooting).

### Commands

```bash
# Build
npm run build              # Build all (server + client + terrain test)
npm run build:server       # Build server only (tsc)
npm run build:client       # Build client only (Vite)
npm run build:terrain-test # Build terrain test (esbuild)

# Run
npm run dev:local          # Build all + start the server on the first free port from 8081 up (PORT=<n> to choose); never 8080 — the bench worker owns it
npm run dev                # On the shared test machine: lease the bench worker's gateway (doc/bench-worker.md)
npm run dev:react          # Vite dev server only (hot reload, no backend)
npm start                  # Start server (must build first)

# Test
npm test                   # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
npm run test:verbose       # Verbose output
npm run test:changed       # Test only changed files (bail on first failure)
npm run test:smoke         # Component smoke tests only (jsdom)

# Release
npm run release:preview    # Preview the notes the next merge to main will publish
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP/WebSocket server port |
| `RDO_DIR_HOST` | `www.starpeaceonline.com` | RDO directory server hostname |
| `CHUNK_CDN_URL` | — | CDN URL for static terrain assets (e.g., `https://spo.zz.works`) |
| `SPO_REGISTER_URL` | — | Registration page linked as "Create an account" on the sign-in screen; unset shows no link |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | Set to `production` to disable colorized logs |

## Project Architecture

```
src/
├── client/
│   ├── main.tsx                 # Vite entry — boots client, mounts React
│   ├── App.tsx                  # Root router (LoginScreen <-> GameScreen)
│   ├── client.ts                # StarpeaceClient — game logic controller
│   ├── context.ts               # ClientContext (React <-> client bridge)
│   ├── bridge/                  # ClientBridge (store-pushing adapter)
│   ├── store/                   # 11 Zustand stores
│   │   ├── building-store.ts    # Building inspector state
│   │   ├── chat-store.ts        # Chat channels and messages
│   │   ├── empire-store.ts      # Company facilities and finances
│   │   ├── game-store.ts        # Core game state (session, map, zones)
│   │   ├── log-store.ts         # Action log
│   │   ├── mail-store.ts        # Mail folders and messages
│   │   ├── politics-store.ts    # Capitol and voting data
│   │   ├── profile-store.ts     # User and tycoon profiles
│   │   ├── search-store.ts      # Search queries and results
│   │   ├── transport-store.ts   # Transport routes
│   │   └── ui-store.ts          # Panels, modals, HUD state
│   ├── hooks/                   # Custom hooks
│   │   ├── usePanel.ts          # Panel open/close logic
│   │   ├── useResponsive.ts     # Responsive breakpoints
│   │   ├── useCommandPalette.ts # Command palette state
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useChangelogCheck.ts # Version change detection
│   ├── styles/                  # Design tokens, reset, typography, animations
│   ├── layouts/                 # LoginScreen, GameScreen
│   ├── components/              # React components (CSS Modules)
│   │   ├── common/              # Badge, Toast, GlassCard, Skeleton, SliderInput, ...
│   │   ├── hud/                 # TopBar, LeftRail, RightRail, StatusTicker
│   │   ├── panels/              # RightPanel, LeftPanel (slide-in)
│   │   ├── building/            # BuildingInspector, QuickStats, PropertyGroup, InspectorTabs
│   │   ├── empire/              # EmpireOverview, FacilityList, FinancialSummary, ProfilePanel
│   │   ├── mail/                # MailPanel, HtmlMailBody
│   │   ├── chat/                # ChatStrip
│   │   ├── search/              # SearchPanel, TycoonProfileView
│   │   ├── politics/            # JobsTab, MinistriesTab, RatingsTab, VotesTab, ...
│   │   ├── transport/           # TransportPanel
│   │   ├── modals/              # BuildMenu, SettingsDialog, CompanyCreationModal, ...
│   │   ├── mobile/              # MobileShell, BottomNav, BottomSheet
│   │   ├── command-palette/     # CommandPalette (Ctrl+K)
│   │   ├── login/               # AuthStage, ZoneStage, WorldStage, CompanyStage
│   │   ├── icons/               # ZoneIcon, RoadIcons
│   │   └── map/                 # Map-related UI components
│   ├── renderer/                # Canvas 2D isometric engine
│   │   ├── isometric-map-renderer.ts      # Main renderer orchestrator
│   │   ├── isometric-terrain-renderer.ts  # Terrain layer
│   │   ├── chunk-cache.ts                 # Off-screen chunk caching
│   │   ├── texture-cache.ts               # LRU texture cache
│   │   ├── texture-atlas-cache.ts         # Atlas sprite sheet cache
│   │   ├── road-texture-system.ts         # Road topology + texture mapping
│   │   ├── concrete-texture-system.ts     # Concrete tile rendering
│   │   ├── vehicle-animation-system.ts    # Vehicle sprite animation
│   │   ├── terrain-loader.ts              # Terrain data loading
│   │   ├── coordinate-mapper.ts           # Iso <-> screen transforms
│   │   ├── placement-validation.ts        # Building placement rules
│   │   ├── painter-algorithm.ts           # Draw ordering
│   │   └── touch-handler-2d.ts            # Touch/pointer input
│   └── ui/                      # Legacy canvas UI (minimap + map navigation)
├── server/
│   ├── server.ts                # HTTP + WebSocket server
│   ├── spo_session.ts           # RDO session manager (TCP <-> WebSocket)
│   ├── rdo.ts                   # RDO protocol parser
│   ├── rdo-helpers.ts           # RDO utility functions
│   ├── service-registry.ts      # ServiceRegistry (lifecycle, dependencies, health)
│   ├── update-service.ts        # Game asset sync service
│   ├── building-data-service.ts # Building dimensions + data cache
│   ├── map-data-service.ts      # Map data caching and parsing
│   ├── map-parsers.ts           # Map file format parsers
│   ├── cab-extractor.ts         # CAB archive extraction (7zip)
│   ├── classes-bin-parser.ts    # Binary class data parser
│   ├── asp-url-extractor.ts     # ASP URL parsing
│   ├── facility-dimensions-cache.ts # Building dimension cache
│   ├── mail-list-parser.ts      # Mail list parsing
│   ├── search-menu-parser.ts    # Search menu parsing
│   └── search-menu-service.ts   # Search menu service
└── shared/
    ├── rdo-types.ts             # RDO type system (RdoValue, RdoCommand, RdoParser)
    ├── config.ts                # Environment-aware configuration
    ├── error-utils.ts           # toErrorMessage(err: unknown)
    ├── types/                   # Shared TypeScript interfaces
    └── building-details/        # Property templates and RDO definitions
```

### Services

The server runs background services managed by a `ServiceRegistry` with dependency ordering:

| Service | Purpose | Dependencies |
|---------|---------|--------------|
| `update` | Sync game assets from update server | — |
| `facilities` | Building dimensions cache | update |
| `mapData` | Map data caching and parsing | update |

## Static Terrain Assets (CDN)

Terrain chunks, texture atlases, object sprites, and map previews are pre-generated offline and served from **Cloudflare R2 CDN** — the game server no longer generates or serves these assets.

```
SPO-WebClient-Chunks (standalone Linux tool)
  sync → extract → generate → upload ──> Cloudflare R2 (spo.zz.works)

SPO-WebClient (this project)
  Client fetches static assets from CDN  <── https://spo.zz.works/...
  Server handles only game logic, WebSocket, and dynamic endpoints
```

| Asset | CDN Path | Description |
|-------|----------|-------------|
| Terrain chunks | `/chunks/{map}/{terrain}/{season}/z{zoom}/chunk_{i}_{j}.webp` | Pre-rendered isometric tiles (4 zoom levels) |
| Terrain atlases | `/textures/{terrain}/{season}/atlas.png` + `.json` | Sprite sheets for terrain rendering |
| Object atlases | `/objects/{category}-atlas.png` + `.json` | Road, concrete, car sprite sheets |
| Map previews | `/chunks/{map}/{terrain}/{season}/preview.png` | Low-res map backdrops |
| Object textures | `/cache/{category}/{name}.png` | Baked road/concrete/car textures |

Set `CHUNK_CDN_URL=https://spo.zz.works` to enable CDN. Without it, the client falls back to local rendering.

See **[SPO-WebClient-Chunks](https://github.com/Crazz-E/SPO-WebClient-Chunks)** for the generation pipeline, R2 setup, and upload tool.

## RDO Protocol

The game servers speak a custom RDO (Remote Data Objects) protocol over TCP. Values are type-prefixed:

| Prefix | Type | Example |
|--------|------|---------|
| `#` | Integer | `#42` |
| `%` | String (OLE) | `%Hello` |
| `!` | Float | `!3.14` |
| `@` | Double | `@3.14159` |
| `$` | Short string | `$ID` |
| `^` | Variant | `^value` |
| `*` | Void | `*` |

Commands are built with a type-safe builder:

```typescript
import { RdoValue, RdoCommand, RdoParser } from '@/shared/rdo-types';

// Build commands
const cmd = RdoCommand.sel(objectId)
  .call('RDOSetPrice').push()
  .args(RdoValue.int(priceId), RdoValue.float(value))
  .build();

// Parse responses
const { prefix, value } = RdoParser.extract(token);
```

## API Endpoints

The Node.js server exposes REST endpoints for game data and asset serving. Static terrain assets (chunks, atlases, textures, previews) are served from [Cloudflare R2 CDN](https://github.com/Crazz-E/SPO-WebClient-Chunks) when `CHUNK_CDN_URL` is set.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/map-data/:mapName` | Map terrain, buildings, and roads |
| `GET /api/road-block-classes` | Road block class definitions |
| `GET /api/concrete-block-classes` | Concrete block class definitions |
| `GET /api/car-classes` | Vehicle class definitions |
| `GET /api/terrain-info/:terrainType` | Terrain type metadata (seasons) |
| `GET /api/research-inventions` | Research invention data |
| `GET /cache/:category/:filename` | Game object textures (buildings) |
| `GET /proxy-image?url=<url>` | Image proxy for remote assets |

## Development Workflow

### Git Conventions

- **Branches:** `feature/`, `fix/`, `refactor/`, `doc/` + descriptive name
- **Commits:** `type: short summary` — types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`

### Releases

Every merge to `main` is a release: `release.yml` derives the version from the last
`v*` tag and the conventional commits since it (`feat` → minor, otherwise patch), builds,
tags and publishes it on [GitHub Releases](https://github.com/Crazz-Org/SPO-WebClient/releases)
with generated notes. Nobody creates `v*` tags by hand. [CHANGELOG.md](CHANGELOG.md) is the
frozen history up to 1.3.2-beta.

```bash
npm run release:preview    # the notes the next merge to main would publish
```

## Coding Standards

- TypeScript strict mode — `unknown` for catch blocks, no `any`
- camelCase for variables/methods, PascalCase for classes/interfaces
- CSS Modules for component styling, design tokens for shared values
- JSDoc for public API only — no over-engineering, small focused changes
- Never construct RDO protocol strings manually — always use `RdoValue`/`RdoCommand`
- All code changes require tests

## Testing

- **Framework:** Jest 30 with ts-jest, two projects: `unit` (Node.js env) and `component` (jsdom env)
- **Convention:** `module.ts` -> `module.test.ts` in the same directory
- **Custom matchers:** seven, all in `src/server/__tests__/matchers/rdo-matchers.ts` —
  `toContainRdoCommand()`, `toMatchRdoFormat()`, `toMatchRdoCallFormat()`, `toMatchRdoSetFormat()`,
  `toHaveRdoTypePrefix()`, `toMatchRdoResponse()`, `toPassStrictRdoValidation()`

### The four layers, and what decides a merge

| | Layer | Runs |
|---|---|---|
| **L0** | Unit + component (Jest node/jsdom, coverage ratchet) | CI, every PR |
| **L1** | Protocol conformance (Jest + `src/mock-server/`) | CI, every PR |
| **L2** | **Live WebSocket drive** (`src/e2e/`, gateway -> real game servers) | **the gate**, pre-merge |
| **L3** | Live browser smoke (Playwright) | manual, pre-release |

**The gate is the merge condition.** CI alone cannot merge: `main` requires both the
`typecheck + tests` check and a `bench/gate` commit status, and only the bench worker can
publish the latter — it fetches the pushed commit, builds it and drives the L2 flows live.
The order is **commit -> push -> open the PR -> `npm run gate`**. See
[doc/E2E-POLICY.md](doc/E2E-POLICY.md) for the rules and
[doc/bench-worker.md](doc/bench-worker.md) for the mechanics.

### Coverage — two numbers, not one

- **New or modified lines must reach >= 93 %**, enforced by `npm run coverage:changed`
  (CI runs it on every PR).
- **`jest.config.js` holds a separate machine floor** per directory. Thresholds only ever go
  UP, so read them from the file rather than from here:

```bash
node -e "console.log(require('./jest.config.js').coverageThreshold)"   # the floors in force
find src \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l       # how many test files
```

### Running tests

```bash
npm test                           # All tests
npm test -- rdo-types              # Specific file
npm test -- --testNamePattern="X"  # Specific test name
npm run test:coverage              # Coverage report against the jest.config.js floors
npm run coverage:changed           # The >= 93 % rule on this branch's changed lines
npm run test:smoke                 # Component smoke tests only
npm run gate                       # The gate: a bench job for the PUSHED sha (commit + push + PR first)
```

## Documentation

Detailed technical docs live in the [doc/](doc/) directory:

**Protocol & Architecture**
- [Architecture Overview](doc/architecture-overview.md) — Directory structure, API endpoints, services
- [SPO-Original Reference](doc/spo-original-reference.md) — Delphi source index with `File.pas:Line` citations
- [Logging System](doc/logging-system.md) — Structured NDJSON logging and session tracking

**Building System**
- [Facility Tabs Reference](doc/facility-tabs-reference.md) — Inspector tab configurations
- [Supply System](doc/supply-system.md) — Supply/demand mechanics
- [Research System Reference](doc/research-system-reference.md) — Research and technology tree

**Rendering**
- [Texture → Rendering Architecture](doc/texture-rendering-architecture.md) — Asset pipeline, zoom levels, gotchas
- [Road Rendering](doc/road_rendering_reference.md) — Road topology and texture mapping
- [Concrete Rendering](doc/concrete_rendering.md) — Concrete tile system

**Voyager (Inspector)**
- [Voyager Inspector Architecture](doc/voyager-inspector-architecture.md) — Container lifecycle and data binding

**Game Model**
- [Civic Roles Reference](doc/civic-roles-reference.md) — Mayor, President and Minister powers, Voyager parity, server rules

**UX**
- [Ergonomics Redesign Plan](doc/ergonomics-redesign-plan.md) — Scoping for the new interface via the `/design` skill (in French)
- [UX notes](doc/ux/) — Audit, brief, designs and handoff, plus the missing-features list

**Testing & Development**
- [E2E Policy](doc/E2E-POLICY.md) — The gate's own specification: what must be driven live, and the rules of a run
- [Bench Worker](doc/bench-worker.md) — The single owner of the live bench; job life, the push chain, attestations
- [E2E Testing](doc/E2E-TESTING.md) — Canonical live procedure and locked credentials
- [E2E Strategy](doc/E2E-STRATEGY.md) — Test layers L0–L4 and target architecture (superseded by E2E-POLICY.md)
- [Mock Server](src/mock-server/CLAUDE.md) — L1 substrate: RDO mock, scenarios and strict validator
- [CAB Asset Extraction](doc/CAB-EXTRACTION.md) — Extracting textures from game archives
- [In-app Bug Reporting](doc/bug-reporting.md) — Capturing a finding from inside a running session

**Project & Operations**
- [Kanban board](https://github.com/orgs/Crazz-Org/projects/1) — All open work, tracked as issues
- [Kanban workflow](doc/kanban-workflow.md) — Columns, ownership rules, session lifecycle
- [Production Security Policy](doc/production-security-policy.md) — Normative SEC-* requirements and recorded exceptions
- [Deployment Guide](https://github.com/Crazz-Org/SPO-Deploy) — VPS deployment procedure (SPO-Deploy repo)

## License

ISC
