---
name: e2e-test
description: Run the L3 browser smoke with Playwright MCP on a gateway leased from the bench (same procedure as /e2e)
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
   The ordered Phase 0–8 smoke script and report format now live in the same file.
2. **[doc/E2E-POLICY.md](../../../doc/E2E-POLICY.md)** — the gate: which layer a change
   must reach, and what counts as proof. L3 is required only for pixels (renderer, layout,
   mobile) and pre-release; everything below the pixel is L2,
   `npm run test:live`.

**Before running, read the "Target" and "⚠ Known stale" sections of
[.claude/commands/e2e.md](../../commands/e2e.md)** — what the leased gateway cannot show, and
how to adapt the phases that predate `CommandBar`.

## Scenario argument

`/e2e-test <scenario>` (same as `/e2e <scenario>`): `login` (Phases 0–2 only), `smoke` (full Phases 0–8, default),
`custom` (user describes the flow — still read-only, still the locked account).

## Hard rules

- Credentials LOCKED; Free Space (not BETA). `SPO_test3` **now holds the mayor role**, so
  road and zone flows are reachable — but this browser pass stays read-only; mutations
  belong to L2's round-trip probe, which restores what it writes.
- President members are a **capability exception** when the server says the account is not
  president — recorded by the gate, never overridden by hand (doc/E2E-POLICY.md §7).
- **Never start the gateway yourself — lease it.** `npm run dev` queues a bench lease: the
  worker builds this worktree, starts its gateway on 8080 and holds it for you (30 min by
  default, `-- --lease-minutes=N` up to 120). Navigate to `http://localhost:8080`. When
  the pass is over, `npm run dev:release` — the worker tears the gateway down; you never
  kill anything (doc/bench-worker.md). An unreleased lease expires on its own.
- Always run login first; report per-phase PASS/FAIL.
- Never load screenshots into the main context — delegate to a sub-agent.
