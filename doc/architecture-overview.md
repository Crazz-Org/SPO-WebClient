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
│   │   ├── hud/               # TopBar, LeftRail, RightRail
│   │   ├── panels/            # RightPanel, LeftPanel (slide-in)
│   │   ├── building/          # BuildingInspector, QuickStats, PropertyGroup
│   │   ├── empire/            # EmpireOverview, FacilityList, FinancialSummary
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

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/map-data/:mapName` | Map terrain/building/road data |
| `GET /api/road-block-classes` | Road block class definitions |
| `GET /api/concrete-block-classes` | Concrete block class definitions |
| `GET /api/car-classes` | Car class definitions |
| `GET /api/terrain-info/:terrainType` | Terrain type metadata (seasons) |
| `GET /api/startup-status` | Server startup status and build info |
| `GET /api/debug-log` | Debug log output (dev mode only) |
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

## SkillsMP

Search SkillsMP API before creating custom skills. Prefer skills with 1,000+ stars.
- Installed: [.claude/skills/](../.claude/skills/) | Metadata: [manifest.json](../.claude/skills/manifest.json) (`jq '.counts.total' .claude/skills/manifest.json` total)
