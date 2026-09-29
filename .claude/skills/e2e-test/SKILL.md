---
name: e2e-test
description: Run the L3 browser walkthrough with Playwright MCP on a gateway leased from the bench (same procedure as /e2e)
user-invokable: true
disable-model-invocation: true
---

# E2E Test Runner

Drives the live game client in a real browser via Playwright MCP.

**This skill is a pointer — do not duplicate procedure here.** Read, in order:

1. **[doc/E2E-TESTING.md](../../../doc/E2E-TESTING.md)** — the canonical procedure:
   - LOCKED credentials: `SPO_test3` / `test3` / **Free Space** / **planitia** /
     **SPO_test3 - Green** (never change without explicit developer approval)
   - Verified selectors (post-React, a11y-based) and the child-frame login quirk
   - `window.__spoDebug` programmatic verification API
   - The gateway lease (`npm run dev` / `npm run dev:release`) — never started or stopped by hand
   - Screenshot policy (sub-agent delegation only)
   The ordered Phase 0–9 walkthrough (every screen and panel once) and its report format live
   in the same file.
2. **[doc/E2E-POLICY.md](../../../doc/E2E-POLICY.md)** — the gate: which layer a change
   must reach, and what counts as proof. L3 opens every screen once and is required for pixels
   (renderer, layout, mobile) and pre-release; every player action is L2,
   `npm run test:live`.

**Before running, read the "Target" section of [.claude/commands/e2e.md](../../commands/e2e.md)**
— what the leased gateway cannot show (bug reporter, "Create an account", nginx/TLS/CSP).

## Scenario argument

`/e2e-test <scenario>` (same as `/e2e <scenario>`): `login` (Phases 0, 1 and 9), `smoke` (full
Phases 0–9, default), `custom` (user describes the flow — still read-only, still the locked
account, still ending with Phase 9).

## Hard rules

- Credentials LOCKED; Free Space (not BETA). `SPO_test3` **now holds the mayor role**, so
  road and zone flows are reachable — but this browser pass stays read-only; mutations
  belong to L2's round-trip probe, which restores what it writes.
- President members are a **capability exception** when the server says the account is not
  president — recorded by the gate, never overridden by hand (doc/E2E-POLICY.md §7).
- **Never start the gateway yourself — lease it.** `npm run dev` queues a bench lease: the
  worker builds this worktree, starts its gateway on 8080 and holds it for you (30 min by
  default; the walkthrough's Phase 0 asks `-- --lease-minutes=60`, up to 120). Navigate to `http://localhost:8080`. When
  the pass is over, `npm run dev:release` — the worker tears the gateway down; you never
  kill anything (doc/bench-worker.md). An unreleased lease expires on its own.
- Always run login first and always end with Phase 9 (Logout, then `npm run dev:release`);
  report per-phase PASS/FAIL, a screen with no data in the world as *absent*.
- Never load screenshots into the main context — delegate to a sub-agent.
