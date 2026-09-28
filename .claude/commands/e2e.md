---
description: Run the L3 browser smoke via Playwright MCP, on a gateway leased from the bench
argument-hint: "[login|smoke|custom]"
---

# Full Game E2E Test

Run the live smoke test in a real browser using Playwright MCP tools.

**L3 is the narrow layer.** Regression coverage belongs to L2 — the headless WebSocket
drive, `npm run test:live` — which reaches everything below the pixel. Use this command for
what a socket cannot observe: rendering, layout, input, mobile, or a pre-release pass.

**This command is a pointer — the procedure is maintained in one place:**

- **[doc/E2E-TESTING.md](../../doc/E2E-TESTING.md)** — locked credentials (SPO_test3 /
  test3 and Crazz / test, Free Space / planitia — NEVER change), verified selectors
  (a11y-based; login stages live in a child frame — use snapshot refs, not
  `document.querySelectorAll`), the `__spoDebug` verification API, the gateway lease, and
  the ordered Phase 0–8 smoke script with its report table.
- The gate that decides when this is required: **[doc/E2E-POLICY.md](../../doc/E2E-POLICY.md)**.

## Scenario argument

- `login` — Phases 0–2 only: lease, login, game view loaded.
- `smoke` (default) — the full Phase 0–8 script.
- `custom` — the user describes the flow; still read-only, still the locked account.

## Target

The gateway leased from the bench (`npm run dev`, then `http://localhost:8080`): it builds
**this worktree** and talks to planitia. It runs in single-user mode and loads no production
`.env`, so it cannot show what only the production configuration turns on — the Support /
bug-reporter entry (`SPO_BUG_REPORT`), the "Create an account" link (`SPO_REGISTER_URL`), and
nginx, TLS and the Content-Security-Policy as deployed. This command does not cover those.

## ⚠ Known stale in doc/E2E-TESTING.md (audit of 2026-09-29)

The procedure predates `CommandBar` (2026-08-23). Until it is rewritten, adapt as follows and
report the adaptation — do not fail a phase on these alone:

- The "In-Game HUD" button titles are gone. `CommandBar` buttons go by accessible name —
  Build, Map, Empire, Government, Mail (`Mail, N unread` with unread mail), Chat, More;
  Settings, overlays, "My facilities", keyboard shortcuts, switch server and road/zone tools
  sit in the More menu; the search bar opens the command palette (Ctrl+K).
- `__spoDebug.getState().panels.buildMenu` never turns true any more (the Build button opens
  the `build` surface) — Phase 6's check on it cannot pass.
- There **is** a Logout: Settings → Logout → confirm "Log out". End Phase 8 with it — the
  page must land on the login screen with no reconnect overlay — then `npm run dev:release`.
  Never stop the server yourself.
- Phase 5 posts a message to a public chat channel, which conflicts with the read-only rule
  below: ask the maintainer before running it.

## Rules

Execute the scenario phases in order, assert programmatically via
`window.__spoDebug.getState()` (no screenshots for state verification), and continue to the
next phase on failure. Report: on green, one summary line; on failure, which phases failed with brief reason.

Rules that always apply: credentials are LOCKED; this browser pass stays **read-only**
(mutations belong to L2's round-trip probe, which restores what it writes); the gateway is
**leased** from the bench worker (`npm run dev`), never started or stopped by hand
([doc/bench-worker.md](../../doc/bench-worker.md)); delegate any screenshot reads to a
sub-agent.
