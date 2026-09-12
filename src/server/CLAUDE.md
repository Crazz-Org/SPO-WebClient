# src/server/ — Gateway Server

## RDO Socket Rule

- **Build every frame with `rdoCall` / `rdoGet` / `rdoSet` / `rdoIdOf`** (`shared/rdo-frame.ts`).
  The separator is derived from the member's kind in `shared/rdo-members.ts` — it is never
  written at a call site, and there is no way to pass one.
- **Synchronous call** (expects a response): `sendRdoRequest(socketName, rdoCall(...).packet, timeout, category)`.
  It allocates the QueryId. Returns `Promise<RdoPacket>`.
- **Fire-and-forget** (void push): `writeRdoFrame(socket, rdoCall(...).toFrame())`. No QueryId.
- **ALL RDO socket writes go through `writeRdoFrame()`** (`rdo-helpers.ts`) -- it encodes Latin-1
  (ANSI) to match the Delphi wire. Never call `socket.write(string)` on an RDO socket: Node
  defaults to UTF-8 and corrupts accented characters.
- **Adding a member to the catalogue is the one moment the Pascal matters.** `"^"` on a
  `procedure` freezes the shared server (live-proven 2026-08-15, `RDOQueryServer.pas:422-424` ->
  `RDOObjectServer.pas:292`); `"*"` on a `function` is an arbitrary memory write that does not
  self-recover (live-proven 2026-08-18, `call GetUserList "*"`). Read the server-side declaration
  with `delphi-archaeologist` and cite it. Once catalogued, neither mistake is expressible.
- What the catalogue does not describe — forbidden members, session-lifecycle members,
  connection-bound members, buffer depth — is held by the ratchet in
  `__tests__/rdo/capability-inventory.test.ts` (control 5 and the connection-bound case), not by
  a guards module: `session/rdo-request-guards.ts` was absorbed into the catalogue and
  `shared/rdo-frame.ts`.
- Session/timer work (login, logoff, reconnect, KeepAlive, ServerBusy): verify the sequence
  against `~/SPO-Original` (or `../SPO-Original` relative to the repo root — not from a session
  worktree, where `..` resolves to `.claude/worktrees/`, not the repo root) before changing it.

## Session Lifecycle

Phases defined in `SessionPhase` enum: `DISCONNECTED` -> `DIRECTORY_CONNECTED` -> `WORLD_CONNECTING` -> `WORLD_CONNECTED` -> `RECONNECTING`.

Login sequence lives in `session/login-handler.ts`. It uses a `LoginContext` interface (not the full session class).

## Handler Extraction Pattern

Handlers in `session/` receive a narrow context interface (`SessionContext` or `LoginContext`) instead of the full `StarpeaceSession` class. This prevents circular imports and keeps handlers independently testable.

When adding a new handler:
1. Create `session/my-handler.ts`
2. Accept `SessionContext` as the first parameter
3. Import it in `spo_session.ts` and wire the delegation

Existing handlers: `chat-handler`, `mail-handler`, `profile-finance-handler`, `auto-connection-handler`, `politics-handler`, `building-management-handler`, `road-handler`, `zone-surface-handler`, `building-templates-handler`, `building-details-handler`, `building-property-handler`, `research-handler`, `login-handler`, `context-status-handler`.

## Push Dispatcher

Incoming RDO pushes from game servers route through `push-dispatcher.ts`. New push types must be registered there.

## ws-handlers/

Files in `ws-handlers/` route WebSocket messages from the browser client to session methods. Each file groups related WS message types (auth, building, chat, mail, map, politics, profile, road, search, misc). The `index.ts` barrel registers all handlers.

Handler type signature defined in `ws-handlers/types.ts`. Utility helpers in `ws-handlers/ws-utils.ts`.

## Timeout Categories

Every `sendRdoRequest()` call should specify a `TimeoutCategory` (FAST / NORMAL / SLOW / VERY_SLOW). Categories are defined in `shared/timeout-categories.ts`. FAST = 60s (legacy proxy DefTimeOut); NORMAL/SLOW/VERY_SLOW share the legacy in-play deadline `IS_PROXY_TIMEOUT_MS` = 180s (Delphi ISProxyTimeOut). Default is NORMAL.

## Protected Files

`rdo.ts` and `spo_session.ts` require extra care. Verify against Delphi source (`delphi-archaeologist` skill) before modifying RDO framing or protocol logic.

## Testing

Co-located `__tests__/` directories. Custom RDO matchers available: `toContainRdoCommand`, `toMatchRdoCallFormat`, `toMatchRdoSetFormat`, `toMatchRdoResponse`, `toHaveRdoTypePrefix`.
