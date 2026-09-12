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

Available scenarios: `auth`, `world-list`, `world-login`, `select-company`, `company-list`, `building-details`, `build-menu`, `build-roads`, `mail`, `switch-focus`, `civic-mutations`, `newspaper`, `connection-search`, `tycoon-profile`, `abandon-role`, `people-search`, `trade-settings`, `gate-map`, `service-figures`, `bank-tv-live-reads`.

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

`newspaper` is the town paper (`Visual/News/Newsreader.asp`): the issue bar `ShowBar.asp`
renders, and one `home.asp` per kept issue. It also carries the **rated post**, which is two
protocols that must agree — the RDO half is two `RDOSetRatingFrom` exchanges with an **empty
response** (a `procedure` answers nothing), and the HTTP half is the `POST boardmsg.asp` the
column is published with and the `GET boardlist.asp` the page reloads beside it; the report
the posted body ends with may only name ratings whose frame went out first
(`boardmsg.asp:96-146`). Its bar serves the cells in an order that is **not** the answer order, so
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

`abandon-role` proves the read-before-resign order the reference client requires
(`rdoAbandonRole.asp:22-27`): the player's own company list must be fetched from
`NewLogon/logonComplete.asp` before the two-step resignation (`NewTycoon/abandonRole.asp`
then `NewTycoon/rdoAbandonRole.asp`) runs, so the gateway can switch back to that company once
the role is gone. It also serves the post-abandon `NewTycoon/TycoonCurriculum.asp` oracle
(`command="abandon"` vs `command="reset"`) and a trailing 404. HTTP only — every leg is an
ASP page.

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

`people-search` is the pair of patterns the directory's People page puts in the first argument
of `RDOSearchKey`. The A-Z index sends the bare `*` inside one `Root/Users/<Letter>` bucket —
what the reference client emitted for a letter (`DirectoryServer.wsc:841-847`), which the
server turns into `Entry LIKE 'Root/Users/<Letter>/%'` (`DirectoryManager.pas:1001-1017`) — and
a typed term sends the wrapped `*term*` across all 26 buckets. A wrong pattern draws no error,
just other people's names, so the two frames are fixed here. Both are built by the emitter
(`rdoCall`); only `idof` is written out, because it has no fire-and-forget form. Its test
drives the real `searchPeople` and matches each emitted frame back against the exchange.

`trade-settings` is every argument the two facility trade controls can send: `RDOSetRole` with
2, 5 or 6 and `RDOSetTradeLevel` with 0, 2 or 3 — one exchange per value, six in all. Both are
`procedure`s with no server-side range check (`StdBlocks/Warehouses.pas:527`,
`Kernel/Kernel.pas:6408`), so the legal set is enforced by the client alone, and `1`
(`tlvPupil`) is provably absent. Their responses are **empty** for the usual reason: a procedure
answers nothing, so the frame is the only evidence there is. The values come from
`shared/building-details/trade-settings.ts`, the same lists the controls build their options
from. Its test drives the real `setBuildingProperty` and matches each emitted frame back against
the exchange it must be.

`gate-map` is a factory with `GateMap = '101'` over three input names: two supplies are listed,
and the trap — the disabled middle gate's `SetPath` answers exactly like the two enabled ones,
so a gateway that (re-)applied the old warehouse-only filter would open it and get an answer for
its trouble. This encodes the Voyager finger-strip rule (`Voyager/SupplySheetForm.pas:382`,
`Voyager/ProdSheetForm.pas:324`): a gate is listed unless the map has an explicit `'0'` at its
position. Its test drives the real `getBuildingTabData` and `getBuildingGateConnections` and
asserts on `RdoMock.getConsumedIds()` that the middle gate's `SetPath` and header exchanges were
never consumed.

`service-figures` is the live Offer / Demand pair of one selected service: two 1-argument
`function` reads on the block, `RDOGetDemand(index)` and `RDOGetSupply(index)`
(`StdBlocks/ServiceBlock.pas:309-310`), which the reference client polls for the selected finger
alone (`Voyager/SrvGeneralSheetForm.pas:411-413`). Its answers are chosen to **disagree** with
the cached `srvSupplies0` / `srvDemands0` columns `building-details` serves — the block says
64 / 37 where the cache says 5 / 12 — because a client that still drew the cached columns for
the selected card would otherwise render plausible numbers and pass. The index travels as the
single `#`-prefixed argument, so a frame built for another service matches nothing.

`bank-tv-live-reads` is the six bank and TV inspector values the object cache never holds:
`TBankBlock.StoreToCache` (`StdBlocks/Banks.pas:188-206`) writes the loan list alone and
`TBroadcaster.StoreToCache` (`StdBlocks/Broadcast.pas:431-453`) only antenna data, so Estimated
Loan, Interest, Term, Budget, Hours On Air and Commercials came back empty every time. The
reference client never asked the cache for them — it binds to `CurrBlock` and reads live
(`Voyager/BankGeneralSheet.pas:258-273`, `Voyager/TVGeneralSheet.pas:269-275`), and so the
scenario answers one `RDOEstimateLoan` call plus five property `get`s. Two things it pins that
nothing else can catch: `RDOEstimateLoan` answers a **FormatMoney string** (`$5,000,000`,
`Utils/Misc/MathUtils.pas:87-109`) the gateway must strip to digits, and its single argument is
the **InitClient proxy id**, which the server pointer-casts — `TMoneyDealer(ClientId)`
(`Banks.pas:149`) — so the persistent `TTycoon.Id` would dereference nothing with no error to
show for it. The `building-details` cache fixture serves a `CurrBlock` pointing at these blocks
and none of the six values, matching what StoreToCache actually writes.

`building-details` also carries the class picture: each fixture's `imagePath` is the class's
`[MapImages] 64x32x0` file, and the response carries it as `iconUrl` under
`/cache/BuildingImages/`. `MOCK_UNKNOWN_CLASS` (`visualClass '999999'`) is the one class the
cache does not hold a texture for, and its response carries no `iconUrl` key at all. Its test
drives the real `handleBuildingDetails` and matches the emitted frame to the canned response.

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
