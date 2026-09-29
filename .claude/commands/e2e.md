---
description: Run the L3 browser walkthrough via Playwright MCP, on a gateway leased from the bench
argument-hint: "[login|smoke|custom]"
---

# Full Game E2E Test

Run the live L3 walkthrough in a real browser using Playwright MCP tools.

**L3 opens every screen once; L2 does every action.** Regression coverage of player actions
belongs to L2 — the headless WebSocket drive, `npm run test:live`. This command covers what a
socket cannot observe: that every screen and panel renders, layout, input, mobile — run when a
diff touches pixels, or before a release.

**This command is a pointer — the procedure is maintained in one place:**

- **[doc/E2E-TESTING.md](../../doc/E2E-TESTING.md)** — locked credentials (SPO_test3 /
  test3 primary; Crazz / test optional, only for a flow that needs a second account; Free
  Space / planitia — NEVER change), verified selectors
  (a11y-based; login stages live in a child frame — use snapshot refs, not
  `document.querySelectorAll`), the `__spoDebug` verification API, the gateway lease, and
  the ordered Phase 0–9 walkthrough with its report table.
- The gate that decides when this is required: **[doc/E2E-POLICY.md](../../doc/E2E-POLICY.md)**.

## Scenario argument

- `login` — Phases 0, 1 and 9: lease, the screens before the game through the company login,
  then the clean exit (Logout, lease handed back).
- `smoke` (default) — the full Phase 0–9 walkthrough.
- `custom` — the user describes the flow; still read-only, still the locked account, and it
  still ends with Phase 9.

## Target

The gateway leased from the bench (`npm run dev`, then `http://localhost:8080`): it builds
**this worktree** and talks to planitia. It runs in single-user mode and loads no production
`.env`, so it cannot show what only the production configuration turns on — the Support /
bug-reporter entry (`SPO_BUG_REPORT`), the "Create an account" link (`SPO_REGISTER_URL`), and
nginx, TLS and the Content-Security-Policy as deployed. A pass on the production URL
(https://starpeace.zz.works) runs **only when the maintainer asks for one** — never as a
routine step of this command.

## Rules

Execute the scenario phases in order, assert programmatically via
`window.__spoDebug.getState()` (no screenshots for state verification), and continue to the
next phase on failure. A screen whose data the world may not hold is recorded **absent**, not
failed. Report: on green, one summary line; on failure, which phases failed with brief reason.

Rules that always apply: credentials are LOCKED; this browser pass stays **read-only**
(mutations belong to L2's round-trip probe, which restores what it writes) — the one
exception is Phase 5's chat ping, kept by maintainer decision (2026-09-29); the gateway is
**leased** from the bench worker (`npm run dev`), never started or stopped by hand — Phase 9
hands it back with `npm run dev:release` ([doc/bench-worker.md](../../doc/bench-worker.md));
delegate any screenshot reads to a sub-agent.
