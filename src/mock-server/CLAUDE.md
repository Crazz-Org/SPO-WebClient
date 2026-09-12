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

Available scenarios: `auth`, `world-list`, `world-login`, `select-company`, `company-list`, `building-details`, `build-menu`, `build-roads`, `mail`, `switch-focus`, `civic-mutations`, `newspaper`, `connection-search`, `tycoon-profile`.

`world-login` is the world socket during `loginWorld` — RDO only, since the company list itself
arrives over HTTP. It exists for its second exchange: the admission question the reference client
asked before offering company creation (`logonComplete.asp:143-152`).
`createWorldLoginScenario(vars, { canJoin })` sets what the world answers — `-1` for a world at
its user cap, a positive number for the nobility the player is short, `0` (the default) for
"go ahead". That exchange pins the target to the InterfaceServer id and the argument list to a
single `%`-prefixed string, because that is the whole shape of the declaration
(`Interface Server/InterfaceServer.pas:441`, a one-argument `function`): a second argument or a
frame sent against the context id would answer about nobody, with no error to show for it.

`world-list` is the directory query session: the world list itself, plus the world-limit
question the reference client asked before offering a new world.
`createWorldListScenario(vars, { canJoinNewWorld })` sets what the directory answers —
`true` (the default) may join, `false` is an account already holding as many worlds as its
nobility allows (`DServer/DirectoryServer.pas:116`, body `:1217-1234`;
`logonComplete.asp:100-106`). That exchange targets the directory **session** id, not the
`DirectoryServer` id: `RDOCanJoinNewWorld` is declared on `TDirectorySession`, the object
`get RDOOpenSession` hands back, so a frame sent against the server id would reach a member
that is not there.

`newspaper` is the daily paper (`Visual/News/Newsreader.asp`): the issue bar `ShowBar.asp`
renders, and one `home.asp` per kept issue. HTTP only — the paper is reachable through the
ASP pages alone. Its bar serves the cells in an order that is **not** the answer order, so
the sort the gateway derives from the folder id (`News.pas:956-961`) has something to prove;
`createNewspaperScenario(vars, { issues: [] })` is the paper that has printed nothing yet.
It also serves the directory's `New Directory/Newspapers.asp` listing (`{ papers: [] }` is
the world with no papers).

`tycoon-profile` is `NewTycoon/TycoonCurriculum.asp` served TWICE, under two different
`Tycoon` query parameters, because that parameter is the only thing that decides whose page
comes back. The frame carries the VIEWER's password (`Tycoon.asp:14-17`), so for a tycoon who
is not the viewer `FullAccess` is false (`TycoonCurriculum.asp:25`) and the server withholds
the Reset / Abandon table (`:175-211`) and the upgrade checkbox (`:250-261`); everything else
renders for any viewer. A fixture serving one page could not catch a gateway that asked for
the viewer's own name — two pages keyed on the parameter can. It also serves the avatar card
`New Directory/RenderTycoon.asp` and a trailing 404, so an unserved tycoon fails loudly.
HTTP only — the page is reachable through ASP alone.

`civic-mutations` is the write half of the Politics surface — one RDO exchange per
civic `procedure` the gateway emits (built by `rdoCall`, so it cannot drift), the two
id lookups that precede a tax or budget write, and the five Politics ASP pages
`getPoliticsData` fetches. Its mutation exchanges carry an **empty response** on
purpose: a `procedure` answers nothing, so no reply can ever say the write landed.
It also serves the two cache reads by path `getPoliticsData` makes — the town
folder's ruler block and `world.five`'s `ElectionsOn`, `1` by default, `0` via
`createCivicMutationsScenario(vars, { electionsOn: false })`.

`connection-search` is the pair of searches a fluid gate offers — `FindSuppliers`
(`direction: 'input'`) and `FindClients` (`direction: 'output'`) — and it exists for their
**ninth argument**. `Role` is a `TFacilityRoleSet` cast to a byte
(`Voyager/WHGeneralSheet.pas:155`), so every checkbox contributes the bit of its ordinal:
every box of the supplier form ticked is `#54`, of the client form `#78`. A wrong mask
produces no crash and no error reply — the server simply answers about facilities nobody asked
about — so the captured `#54` (`src/server/__tests__/rdo/connection-search.test.ts:9`) is the
only thing that can catch it. Its test drives the real `searchConnections` and matches the
emitted frame back against the exchange.

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
