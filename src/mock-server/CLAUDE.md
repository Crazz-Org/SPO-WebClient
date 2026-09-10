# src/mock-server/ — the L1 protocol substrate

## Purpose

Matches and validates RDO exchanges without a real game server. This is **L1** in
[doc/E2E-POLICY.md](../../doc/E2E-POLICY.md) — the layer that proves a frame is well formed
before it ever reaches the wire — and it is consumed by 19 suites under
`src/server/__tests__/`, plus the `toPassStrictRdoValidation` matcher and the scenario
tests in `scenarios/` (`newspaper-scenario.test.ts` among them).

> **It is not a mock backend for E2E.** The replay half (`capture-store.ts`,
> `replay-engine.ts`, `mock-ws-client.ts`, `index.ts`, `test-helpers.ts` and the
> `__tests__/integration/` suites) was retired on 2026-08-21: it had no consumer outside
> this directory and existed to serve a mock-backed E2E layer that was never built.
> `MockWebSocketClient` never opened a socket, so it could not be pointed at the live
> gateway either. End-to-end coverage now runs live over a real socket — `src/e2e/`.

## Key Files

| File | Role |
|------|------|
| `rdo-mock.ts` | Core matcher -- matches incoming RDO commands to scenario exchanges |
| `rdo-strict-validator.ts` | Protocol compliance checker -- validates outgoing RDO commands |
| `http-mock.ts` | Mock HTTP/ASP endpoint handler |
| `types/` | Exchange and scenario types shared with the scenarios |

## Scenarios

Scenario files in `scenarios/` define canned RDO exchanges. Each exports a `create*Scenario()` factory function that returns `{ ws: WsCaptureScenario; rdo: RdoScenario }`.

Available scenarios: `auth`, `world-list`, `select-company`, `company-list`, `building-details`, `build-menu`, `build-roads`, `mail`, `switch-focus`, `civic-mutations`, `newspaper`.

`newspaper` is the daily paper (`Visual/News/Newsreader.asp`): the issue bar `ShowBar.asp`
renders, and one `home.asp` per kept issue. HTTP only — the paper is reachable through the
ASP pages alone. Its bar serves the cells in an order that is **not** the answer order, so
the sort the gateway derives from the folder id (`News.pas:956-961`) has something to prove;
`createNewspaperScenario(vars, { issues: [] })` is the paper that has printed nothing yet.
It also serves the directory's `New Directory/Newspapers.asp` listing (`{ papers: [] }` is
the world with no papers).

`civic-mutations` is the write half of the Politics surface — one RDO exchange per
civic `procedure` the gateway emits (built by `rdoCall`, so it cannot drift), the two
id lookups that precede a tax or budget write, and the five Politics ASP pages
`getPoliticsData` fetches. Its mutation exchanges carry an **empty response** on
purpose: a `procedure` answers nothing, so no reply can ever say the write landed.
It also serves the two cache reads by path `getPoliticsData` makes — the town
folder's ruler block and `world.five`'s `ElectionsOn`, `1` by default, `0` via
`createCivicMutationsScenario(vars, { electionsOn: false })`.

### Scenario Structure

Each `RdoScenario` has a `name`, `description`, and array of `RdoExchange` objects:

```ts
{
  id: 'auth-rdo-001',
  request: 'C 0 idof "DirectoryServer"',          // Raw RDO command
  response: 'A0 objid="${directoryServerId}"',     // Expected response
  matchKeys: { verb: 'idof', targetId: '...' },   // Flexible matching fields
  pushes: [],                                       // Optional server pushes
  pushOnly: false,                                  // true = server-initiated, no request
}
```

### Scenario Variables

`scenarios/scenario-variables.ts` provides `mergeVariables(overrides?)` for injecting test-specific values (username, serverId, etc.) into scenario templates.

### Adding a New Scenario

1. Create `scenarios/my-scenario.ts`
2. Export `createMyScenario(overrides?: Partial<ScenarioVariables>)`
3. Define exchanges with `matchKeys` for flexible matching
4. Register in `scenarios/scenario-registry.ts`

## RDO Matching Hierarchy

`RdoMock.match()` tries strategies in order (first match wins):
1. **Exact match**: verb + targetId + action + member + all args
2. **Key field match**: verb + action + member (wildcard targetId)
3. **Method match**: action + member only
4. **Nth occurrence**: same method, return next unconsumed exchange

## Strict Validator

`rdo-strict-validator.ts` validates every outgoing RDO command against protocol rules. Use it in tests to catch protocol violations (wrong type prefixes, missing separators, invalid verbs) before they reach a real server.

## Testing Pattern

```ts
const mock = new RdoMock();
mock.addScenario(createAuthScenario());
const result = mock.match('C 0 idof "DirectoryServer"');
expect(result).not.toBeNull();
expect(result!.response).toContain('objid=');
```

Tests are co-located: `*.test.ts` in the same directory and in `scenarios/`.
