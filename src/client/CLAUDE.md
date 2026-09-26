# src/client/ — Browser Client (React + Canvas 2D)

## Zustand Stores

All stores in `store/`. Created with `create()`. Only `map-store.ts` adds the
`subscribeWithSelector` middleware — the rest are plain `create<T>((set, get) => ({ ... }))`.
Reach for the middleware only when non-React code needs `.subscribe(selector, cb)` on a slice
(what `map-store` needs it for); a plain store's `.subscribe(listener)` only takes the whole-state
form, so a selector-form call against one of the other twelve will not compile.

Patterns:
- **Map-based caches** for keyed data (buildings, research categories)
- **Optimistic updates**: `PendingUpdate` -> confirmed/failed with `ConfirmedUpdate`/`FailedUpdate` tracking timestamps
- **Tab load state**: `'idle' | 'loading' | 'loaded' | 'error'` for lazy-loaded tab data
- Always unsubscribe in cleanup (`useEffect` return)

Main store: `useGameStore` (connection status, server startup state).
Building store: `useBuildingStore` (focus, details panel, overlays, research).

## CSS Modules

All styles use `.module.css` with scoped class names. No CSS-in-JS.

```tsx
import styles from './MyComponent.module.css';
```

A new fixed HUD element registers its band in the table in `design-tokens.test.ts`.

## Canvas Renderer

Custom 2D isometric engine in `renderer/`. The main file is `isometric-map-renderer.ts` (~195KB monolith).

Render layers (back to front): terrain base -> vegetation -> concrete -> roads -> buildings -> pending placements -> zone overlay -> fog -> placement preview -> road preview -> UI overlays.

Uses chunk caching and texture atlases. No Three.js. Performance-critical code -- profile before optimizing.

Input handling: `renderer/touch-handler-2d.ts` for canvas mouse/touch events.

## Component Structure

Each component folder contains: main component + optional `.module.css` + optional utils + optional `__tests__/` + `index.ts` barrel export.

Before closing a fix on a shared component, grep every renderer (`grep -rn '<Name' src/client`) and fix each, or say in the PR why not.

## ClientContext

`useClient()` hook (from `context/ClientContext.tsx`) provides server communication callbacks. Components must use this hook -- never import the bridge module directly.

## Handlers

`handlers/` directory maps incoming WS messages to store updates. Key files: `auth-handler`, `map-handler`, `building-focus-handler`, `chat-handler`, `road-handler`, `zone-handler`, `build-menu-handler`, `event-handler`, `building-action-handler`.

Reconnection logic in `handlers/reconnect-utils.ts`. Handler utilities in `handlers/handler-utils.ts`.

New message types need a handler registered in `handlers/index.ts`.

## Lazy Loading

Modals (e.g., `CompanyCreationModal`) and research inventory tabs load on demand via `React.lazy()`. Do not eagerly fetch data for tabs/panels not yet visible.

## Keyboard Shortcuts

Global shortcuts registered in `hooks/useKeyboardShortcuts.ts` (B, E, M, R, D, F1–F4, Escape, Cmd+K). Canvas-specific input in the renderer's touch handler.

## Bug Reporting (dev-only)

`report/` holds the in-app capture: `SPO_BUG_REPORT=true` mounts `BugReportRoot` lazily from
`main.tsx`, and nothing in the directory runs without it. Desktop arms on **F8** — its own
listener, deliberately outside the `SHORTCUTS` table above; mobile arms on a floating button.

The rolling journal is a module singleton armed at mount and running continuously, tapped from
`client.ts` at `:568`, `:592` (ws-out) and `:980` (ws-in). The taps are no-ops when it is not
armed, so leave them where they are rather than guarding them at the call site.

Reports POST to `/api/bug-report` and queue outside the worktree; a `/triage-report` session
turns them into kanban cards. Full picture: [doc/bug-reporting.md](../../doc/bug-reporting.md).
Schema: `src/shared/bug-report-schema.ts`.

## App Entry Point

`App.tsx` routes between `LoginScreen` and `GameScreen` based on `useGameStore.status`. Shows `ServerStartupScreen` until backend is ready.

## Legacy images

Cross-origin legacy images go through `/proxy-image`; the CSP blocks the rest and no test layer will tell you.
