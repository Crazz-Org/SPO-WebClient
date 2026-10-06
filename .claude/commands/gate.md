---
description: Run the pre-push gate — local precheck, then a bench-worker job (build, static, President exclusion, L2 live drive against planitia, attestation)
argument-hint: "[--static-only|--flows=a,b]"
allowed-tools: Bash(npm run gate*), Bash(npm run test:live*), Bash(npm run bench:status*), Bash(npm run e2e:unlock*), Bash(bash scripts/bench-*), Bash(git status*), Bash(git diff*), Bash(git log*), Read, Grep, Glob
---

# Pre-Push Gate

Run the gate for the current HEAD, passing `$ARGUMENTS` through when given. **Run it in
the background** — it queues a job on the bench worker and waits its turn, possibly behind
other sessions' jobs; the wait costs nothing:

```bash
npm run gate
```

It prechecks locally (typecheck, lint, tests — a red precheck queues nothing), then the
bench worker builds **this worktree**, replays the static stages, applies the President
exclusion and the diff routing, drives the routed L2 flows live, and writes the
attestation the push hook reads. Only the worker attests — `npm run gate:local` is
evidence for reading, not a push unblock.

**The rules are [doc/E2E-POLICY.md](../../doc/E2E-POLICY.md)**, the mechanics
[doc/bench-worker.md](../../doc/bench-worker.md) — do not restate or reinvent them here.
What matters when reading the result:

- **A crash is a failure, but silence is not a pass.** A mutation is proven by the
  `FIVEMODELSERVER/Survival` log line, not by a `success: true` response (`OB-28`).
- A **read-back mismatch is not a failure** — the Town Hall's cached copy lags the write by
  up to two minutes (`OB-29`). A **missing log line** is UNTESTABLE when the read-back agrees — recorded with its reason, not a failure; a read-back that contradicts the write is.
- A `CAPABILITY EXCEPTION` is not a failure: the server said the test account does not
  hold the role the touched member needs (doc/E2E-POLICY.md §7). Report it with the
  members and the checks; nothing clears it, and no flag should. If the capability is
  GRANTED the gate fails closed — write the flow that drives the member.
- `STALE` means the tree changed while the job was queued or running — resubmit on the
  tree you mean. Not an attempt.
- `ENVIRONMENT` does not consume one of the three attempts.
- `WORKER DOWN` (exit 3) is a bench problem, not a verdict: `systemctl --user restart
  spo-bench-worker`, then resubmit.
- If the world is left dirty, say so loudly: every later live run on this machine is
  blocked until a human restores the values and runs `npm run e2e:unlock`.

Report the verdict, job id, and attestation path (`~/.spo-bench/verdicts/<sha>.json`). On failure, add the job log path.
