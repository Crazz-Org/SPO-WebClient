---
name: spo-testing
description: "TRIGGER: When writing or fixing tests, chasing coverage, or adding fixtures. Jest projects layout, the coverage ratchet, the 7 custom RDO matchers, and the L1 protocol substrate. Replaces the generic jest-testing skill."
user-invokable: true
disable-model-invocation: false
---

# Testing

Jest + ts-jest. Convention: `module.ts` → `module.test.ts` **in the same directory**.

## Two Jest projects

| Project | Env | Matches | Setup |
|---------|-----|---------|-------|
| `unit` | node | `**/*.test.ts` | `src/server/__tests__/setup/jest-setup.ts` |
| `component` | jsdom | `**/*.test.tsx` | + `src/client/__tests__/setup/component-setup.ts` |

```bash
npm test                              # everything
npm test -- rdo-types                 # one file/pattern
npm test -- --testNamePattern="X"     # one suite
npm run test:changed                  # --onlyChanged --bail
npm run test:smoke                    # component project only
npm run test:coverage
```

Path aliases resolve in tests: `@/`, `@shared/`, `@server/`, `@client/`.

## Coverage — two different numbers, do not conflate them

**Project rule:** new or modified lines must be ≥ **93 %** covered. Enforced by
`npm run coverage:changed` (`scripts/coverage-changed.js`: diff against `origin/main`, one Jest
run with coverage restricted to the changed files, aggregate ratio over changed statement
lines) in `gate:precheck` and in CI on pull requests — meeting the jest thresholds is not
sufficient.

**That one run is the precheck's whole test pass.** `--collectCoverageFrom` restricts what
Jest *instruments*, never what it *runs*, so this has always executed the entire suite;
`gate:precheck` no longer calls `npm test` beside it. A branch with no eligible source
change still runs the suite here — it simply collects no coverage.

**Machine floor** (`jest.config.js`, ratchet baseline 2026-03-11) — thresholds **only go UP**:

| Scope | lines | functions | branches | statements |
|-------|------:|----------:|---------:|-----------:|
| global | 38 | 39 | 29 | 38 |
| `src/shared/` | 54 | 65 | 37 | 54 |
| `src/shared/building-details/` | 92 | 100 | 80 | 91 |
| `src/shared/types/` | 96 | 73 | 90 | 96 |

`jest.config.js` is a **protected file**. Never lower a threshold to make a change pass —
add tests. Raising one after a genuine improvement is encouraged; do it in its own commit.

## Custom RDO matchers

Defined in `src/server/__tests__/matchers/rdo-matchers.ts`, typed in the sibling `.d.ts`:

```
toContainRdoCommand(method, args?)     toMatchRdoResponse(requestId?)
toMatchRdoCallFormat(method)           toMatchRdoFormat()
toMatchRdoSetFormat(property)          toPassStrictRdoValidation(config?)
toHaveRdoTypePrefix(prefix)
```

Prefer these over hand-rolled string assertions on RDO frames — they encode the wire rules
and fail with a protocol-aware message.

```ts
expect(frame).toMatchRdoCallFormat('SetPrice');
expect(frame).toHaveRdoTypePrefix('#');
expect(frame).toPassStrictRdoValidation();
```

## L1 substrate, not hand-written frames

Protocol tests match real captured exchanges rather than invented strings. See
`src/mock-server/CLAUDE.md` for the full API, the match hierarchy and the
step-by-step for adding a scenario.

`src/mock-server/` is **L1** — it proves a frame is well formed before it reaches the wire.
It is not a mock backend for E2E: the replay half was retired on 2026-08-21, and
end-to-end coverage now runs live over a real socket (`src/e2e/`, `npm run test:live`).
Which layer a change must reach, and what counts as proof, is
[doc/E2E-POLICY.md](../../../doc/E2E-POLICY.md).

```ts
const mock = new RdoMock();
mock.addScenario(createAuthScenario());
expect(mock.match('C 0 idof "DirectoryServer"')).not.toBeNull();
```

## Mock RDO responses, not simplified mock HTML

`src/mock-server/` is the real substrate: captured, real server responses assembled into
scenarios, not simplified mock HTML. Parsing tests must run against these — the classic
silent-truncation bug (`[A-Za-z0-9]` clipping `PGISRVCOMMON_AlienParkA` to `PGISRVCOMMON`)
only reproduces on real payloads. See `src/mock-server/CLAUDE.md` for the full API, the
match hierarchy and the step-by-step for adding a scenario.

## Traps that produce green-but-wrong suites

| Trap | Fix |
|------|-----|
| `ClientFacilityDimensionsCache` is a singleton | `clear()` then `initialize()` in `beforeEach`, or tests contaminate each other |
| Regex asserted only on shape | Also assert result **length/format** — silent truncation passes a shape check |
| Mock HTML that is too clean | Use `src/mock-server/` captured scenarios |
| Testing only level 1 of property resolution | Cover all three: direct → indexed (`Price0`) → columnSuffix (`Tax0Percent`) |
| Async RDO test without timeout category | `testTimeout` is 10 s; a VERY_SLOW category call will hang the suite |

## An assertion must be able to fail

A green test that cannot go red proves nothing and still counts toward coverage.

- **Watch it fail first.** Before committing a new test, break the production line it guards
  (delete or invert it) and watch the test go red. Then restore the line.
- **Never compare a value to a lookup of itself** — `expect(MAP[k]).toBe(MAP[k])` passes on
  any `MAP`.
- **Never copy the function under test into the test file.** A test-local copy tests the
  copy. Export the function, or drive its public caller.
- **A loop of `expect`s is preceded by a non-empty assertion** — `expect(rows.length).toBeGreaterThan(0)`
  — or an empty list passes every iteration it never ran.
- **Assert the change, not the resting state.** If a mount effect or a fixture already
  produces the asserted state, the test passes without the code under test; assert what the
  action changed.
- **No `Date.now()` bounds in unit tests.** The bench runs under load, so a wall-clock limit
  flakes. Use fake timers (`jest.useFakeTimers()`), or assert order instead of duration.
- **In `src/mock-server/scenarios/`, do not stub `fake.cacher.*` / `fake.ctx.*`.** A stub
  there tests your belief about the server, not the server's captured answer. Serve the row
  from the scenario, or mark the line `// substrate-exception: <why>`.
- **RDO expected frames are string literals**, never built with `rdoCall` / `RdoCommand` —
  a frame built by the emitter under test agrees with it by construction. Pin the separator
  the client emits today; never change a separator from a test.

## Before declaring done

```bash
npm run typecheck    # auto-enforced by the Stop hook when .ts/.tsx changed
npm test
npm run build
```
