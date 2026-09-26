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

Available scenarios: `auth`, `world-list`, `world-login`, `select-company`, `company-list`, `building-details`, `build-menu`, `build-roads`, `mail`, `switch-focus`, `civic-mutations`, `newspaper`, `connection-search`, `connection-reachability`, `tycoon-profile`, `abandon-role`, `people-search`, `trade-settings`, `gate-map`, `product-owner`, `service-figures`, `bank-tv-live-reads`, `auto-buy`, `disconnect-connections`, `worker-counts`, `chase`, `define-zone`, `context-status`, `world-event`, `show-notification`, `chat-flags`, `channel-password`, `create-channel`, `channel-list-change`, `refresh-season`, `bank-loan-request`, `status-lamps`, `tutorial`.

`bank-loan-request` is the Request button of a bank's borrow box — one exchange,
`RDOAskLoan(proxyId, amount)` on the bank block
(`StdBlocks/Banks.pas:46`, emitted at `Voyager/BankGeneralSheet.pas:434-439`).
`createBankLoanRequestScenario(vars, { result })` picks which `TBankRequestResult` ordinal the
block answers, so the same fixture covers approved (`0`), rejected (`1`), not-enough-funds (`2`)
and the client-local error sentinel (`3`).

It exists for two traps. First the **name collision**: `TTycoon` publishes an unrelated
1-argument `RDOAskLoan` (`Kernel/Kernel.pas:2522`) reached only over ASP, answering Protocol
codes rather than ordinals — a 1-argument frame sent at the block would reach a member that is
not on it. Second the **pointer cast**: the first argument is the InitClient proxy id
(`Voyager/URLHandlers/ServerCnxHandler.pas:514-516`), which the server casts straight to a
pointer, `TMoneyDealer(ClientId)` (`Banks.pas:165`) — the persistent `TTycoon.Id` would
dereference nothing, with no error to show for it. Both the arity and that argument are pinned
in the exchange.

`world-login` is the world socket during `loginWorld` — RDO only; the company list is the
`company-list` scenario's own RDO half, described below. It exists for its second exchange: the
admission question the reference client asked before offering company creation
(`logonComplete.asp:143-152`).
`createWorldLoginScenario(vars, { canJoin })` sets what the world answers — `-1` for a world at
its user cap, a positive number for the nobility the player is short, `0` (the default) for
"go ahead". That exchange pins the target to the InterfaceServer id and the argument list to a
single `%`-prefixed string, because that is the whole shape of the declaration
(`Interface Server/InterfaceServer.pas:441`, a one-argument `function`): a second argument or a
frame sent against the context id would answer about nobody, with no error to show for it.

`company-list` is the player's company list, and it has both halves for one reason: the login
path reads it over **RDO**, while the HTTP half serves `logonComplete.asp`, which the login asks
after the RDO read for its portal-travel verdict (`logonComplete.asp:26-67`), and
`chooseCompany.asp`, which `readPersonalCompanies` still fetches (the read-before-resign list of
`rdoAbandonRole.asp:22-27`). Its `noAccess` variant drives the denial and the fail-open cases
(`company-list-logon-verdict.test.ts`): only a real `PA` date denies, while `01/01/2008` or an
empty `PA` logs one warning and the login continues. The RDO half is five exchanges, one per
field the legacy page read in its own loop (`chooseCompany.asp:166-170`): `GetCompanyOwnerRole`, `GetCompanyName`,
`GetCompanyId`, `GetCompanyCluster`, `GetCompanyFacilityCount` — each a published one-argument
`function` on `TClientView` (`Interface Server/InterfaceServer.pas:169`-`:173`), so every frame
carries `"^"`, a QueryId, and exactly one argument. That argument is `#`-prefixed and must stay
so: the index lands in `EDX` as an integer (`RDOObjectServer.pas:266`), and a `"%0"` would hand
the same register a widestring pointer — no error, just an answer about nobody.
`GetCompanyProfit` (`:174`) is deliberately absent: the page had it commented out
(`chooseCompany.asp:171`) and the server body computes a value then unconditionally overwrites
it with `0` (`Kernel/World.pas:4088-4090`). `GetCompanyCount` is absent for a different reason —
it is already answered by `buildWorldPropertyFallbacks` (`protocol-test-harness.ts:370`), and
`visitor-login.validation.test.ts` overrides that fallback to `#0` to drive the zero-company
fork; a second source for one member would break that override. Its test
(`company-list-rdo.test.ts`) drives the real `loginWorld` and asserts the five frames, their
order, the parsed `CompanyInfo`, and that `logonComplete.asp` is asked exactly once.

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
civic `procedure` the gateway emits (its request the literal frame, written out by hand), the two
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
about — so the captured `#54` (`CAPTURED_FIND_SUPPLIERS_RESPONSE` in `src/server/session/politics-handler.test.ts`) is the
only thing that can catch it. Its test drives the real `searchConnections` and matches the
emitted frame back against the exchange.

`connection-reachability` is the road-flag sweep that follows a connection search (issue
#584): `NearCircuits` is a string the facility cache agent writes into the object cache
(`RenderCircuitStr`, `Kernel/KernelCache.pas:156-165`/`:440`), never an RDO member, and the
gateway reads it exactly as it reads any cached property — `SetObject` + `GetPropertyList` on
one temp object per candidate, compared as `TFluidLink.Intercept` does
(`Cache/FluidLinks.pas:116-134`), an empty side making the comparison false (`:121`). Because
`ctx.cacherSetObject` discards `SetObject`'s own reply, the sweep issues that frame itself and
reads the `WordBool` answer (`Cache Server/CachedObjectAuto.pas:15`) to tell "nothing loaded
here" from "loaded, with an empty circuit string" — both of which `GetPropertyList` would
otherwise answer `''` for (`Cache Server/CachedObjectWrap.pas:209-235`). Its `FindSuppliers`
answers four seven-field rows; one candidate's circuits are empty (the `FluidLinks.pas:121`
case) and one has no `NearCircuits` fixture at all, so its read fails and the row must come
back `unknown`, never a false `not connected`. Its test drives the real `searchConnections`
and `resolveConnectionReachability` and asserts the connected/isolated/isolated/unknown split.

`people-search` is the pair of patterns the directory's People page puts in the first argument
of `RDOSearchKey`. The A-Z index sends the bare `*` inside one `Root/Users/<Letter>` bucket —
what the reference client emitted for a letter (`DirectoryServer.wsc:841-847`), which the
server turns into `Entry LIKE 'Root/Users/<Letter>/%'` (`DirectoryManager.pas:1001-1017`) — and
a typed term sends the wrapped `*term*` across all 26 buckets. A wrong pattern draws no error,
just other people's names, so the two frames are fixed here. Every request is a literal
frame, as production emits it with the QueryId stripped. Its test drives the real
`searchPeople` and matches the session open, the bucket select and the two `RDOSearchKey`
frames back against their exchanges, each byte-equal to its fixture literal.

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

`product-owner` is a factory with one output gate and one customer whose `GetSubObjectProps`
query carries `cnxCreatedBy0` as an eighth name: the server writes it for an output exactly as
it does for an input (`Kernel/KernelCache.pas:712`), though the reference client's product sheet
never asked (`Voyager/ProdSheetForm.pas:407-413`). It is appended last so the seven Voyager
positions still decode unchanged. Its test drives the real `getBuildingTabData` and
`getBuildingGateConnections` and asserts the full decoded connection, owner included.

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

`auto-buy` is the automatic-buying flag of an input gate, and it fixes two things a reply could
never catch. The gate header is read with **ten** names, in the reference client's order
(`Voyager/SupplySheetForm.pas:460`) — `tidSelected` is the ninth, and without it the browser
never learns the flag's state. And the two `RDOSelSelected` frames are addressed to the gate's
own `ObjectId`: the member is declared on `TPullInput` (`Kernel/Kernel.pas:1623`), not on the
block, and Voyager binds the id it read off the gate header before forking the call
(`SupplySheetForm.pas:1001` → `:697-699`). The scenario's four ids are deliberately all
different, so a handler that picked the facility's block or object fails instead of matching by
accident. Responses are **empty**, the usual reason: a `procedure` answers nothing, so the frame
is the only evidence there is. Its test drives the real `setBuildingProperty` and the real
`getBuildingGateConnections`.

`disconnect-connections` pins what a multi-row disconnect looks like on the wire: **one**
`RDODisconnectInput` / `RDODisconnectOutput` frame whose second argument carries every selected
pair, `"%10,20,30,40,50,60,"` — not one frame per row. That is the form the reference client
emitted (`Voyager/SupplySheetForm.pas:889-908`, `Voyager/ProdSheetForm.pas:715-734`, each
building a single `Cnxs` string from the whole list selection), and the server reads it back in
pairs (`Kernel/Kernel0.pas:4157-4180`, `ParseGateList`), so the trailing comma is mandatory and
any even token count is legal. Both members bind to `ObjectId`, not `CurrBlock`, and both are
`procedure`s — the responses are **empty**, so the frame is the only evidence there is. Its test
drives the real `setBuildingProperty` and asserts a single emitted frame carrying the list once.

`worker-counts` is the Workforce tab's live jobs-filled read — one `RDOGetWorkers` per class
whose cached maximum is above zero, the way the reference client polled it
(`Voyager/WorkforceSheet.pas:365-377`). It fixes three things nothing else can: the separator
(`RDOGetWorkers` is a 1-argument published FUNCTION, `Kernel/WorkCenterBlock.pas:139`, so the
frame carries `"^"` and a reply comes back — a `"*"` would be an arbitrary memory write with no
error to show for it), the **bind target** (the building's block, never the cacher temp object
the inspector holds), and the call count (one exchange per kind, so a gateway that asked for a
class with no jobs would leave one unconsumed). Its test drives the real `readWorkerCounts`.

`chase` is following another player's camera: two published FUNCTIONS on `TClientView`,
`Chase( UserName )` (`Interface Server/InterfaceServer.pas:189`, body `:1579-1607`) and the
0-argument `StopChase` (`:190`, body `:1610-1632`), so both frames carry `"^"` and a QueryId and
both are answered `res="#<code>"` — `0` is NOERROR, `12` is `ERROR_InvalidUserName` for self, an
unknown name or a user already chasing us, `1` is `ERROR_Unknown` for "was not chasing"
(`Protocol/Protocol.pas:29,30,41`). `createChaseScenario(vars, { chaseResult: 12 })` is the
refusal. What it pins that no reply could: **the mirroring is the push, not the answer** — every
`SetViewedArea` of the followed player pushes `MoveTo` to each chaser (`:707-716`, `:742`), and
the accepted `Chase` sends the first one straight away (`:1592`), so `chase-start` carries that
push and a client that only read the reply would follow nothing. And the **abort has no frame at
all**: when the followed player leaves, the only notice is the ordinary `NotifyUserListChange`,
which is where the reference client clears its own `fChasedUser`
(`Voyager.1/URLHandlers/ServerCnxHandler.pas:3029-3039`). Its test runs one ordered flow through
both real halves — the gateway's `chaseUser`/`stopChase` against the mock, then the real push
dispatcher into the real browser `dispatchEvent` — and asserts the camera actually moved. The
mirroring is gated client-side on a live chase (the pending flag while `Chase` is still in
flight, then the badge once it lands): `chaseLateMoveToPush` is a `MoveTo` shaped exactly like
the accepted chase's own push but at different coordinates, standing in for a frame the server
wrote before our `StopChase` reached it, and it is an exported push rather than an exchange
because `StopChase` answers no push of its own for the test to attach it to.

`define-zone` is `RDODefineZone`, a 6-argument `"^"` FUNCTION on `TWorld`
(`Kernel/World.pas:4502`, declared `:392`) answering `NOERROR` (`:4568`) or
`ERROR_Unknown` (`:4581`, `:4583`) — nothing between the two. Per-tile
refusals inside an accepted call are silent by design (`:4544-4546`): the
zoning loop skips a tile whose reachability/ownership guard fails and still
answers `NOERROR`, so the reply can only say "the call was accepted or
refused", never "N tiles were painted". `createDefineZoneScenario(vars,
{ result })` sets the code the reply carries, `0` by default. Its test drives
the real gateway `handleDefineZone` and the real browser `zone-handler`
end to end, and asserts an `ERROR_Unknown` reply reaches the player as an
error notification, never a success toast.

`context-status` is `ContextStatusText`, a 2-argument `"^"` FUNCTION on
`TClientView` (`Interface Server/InterfaceServer.pas:149`) forwarding to
`TWorld.RDOContextStatusText( ToTycoon, x, y )` (`Kernel/World.pas:4233`) — the
tycoon id is injected server-side, so the client sends only `(x, y)`, x first,
as Voyager does (`ServerCnxHandler.pas:1444`). Its two exchanges are the two
answers that matter: a sentence for a tile inside a town, and `res="%"` for a
tile with none (`World.pas:4243`), which is a normal answer and not an error.
`createContextStatusScenario(vars, { text })` sets the sentence the first
exchange carries. Its test drives the real gateway `handleContextStatus` and the
real browser handler, then renders `ContextStatusStrip` and asserts a camera
move produces the second ask and that the empty answer hides the strip.

`world-event` is `PickEvent`, a 1-argument `"^"` FUNCTION on `TClientView`
(`Interface Server/InterfaceServer.pas:166`) forwarding to `TWorld.RDOPickEvent`
(`Kernel/World.pas:4840-4871`), which pops one event off the tycoon's queue and
renders it as a CRLF-separated `Name=Value` block (`TEvent.Render`,
`Kernel/Events.pas:99-115`) — the argument is the tycoon id, injected nowhere,
unlike `ContextStatusText`'s world context. Its two answers, the rendered
block and `res="%"`, travel on an **identical** frame, since `PickEvent` takes
no argument that distinguishes them, and no `RdoMock` match strategy skips an
already-consumed exchange, so two exchanges in one scenario would answer the
event block twice and starve the empty answer. `createWorldEventScenario`
therefore builds one exchange per call, keyed on its `{ event }` option
(`undefined`/`EVENT_FIXTURE` for the block, `null` for `res="%"`), and its
test plays the sequence itself with `mock.clearScenarios()` between the two
asks — the same "the factory option picks the answer" convention
`createChaseScenario(vars, { chaseResult })` uses. Its test drives the real
gateway `handleWorldEvent`, the real browser handler and the real
`WorldEventTicker`, and asserts the empty answer leaves the first event's
text on screen with no error logged.

`show-notification` is `ShowNotification`, the Interface Server's one push for "tell the player
something" — a 4-argument `procedure` (`Protocol/Protocol.pas:219`), so every frame here carries
`"*"`, no QueryId and no reply. **The kind is the routing**: Voyager dispatched on it in one
`case` (`Voyager/VoyagerWindow.pas:506-563`) rather than treating every kind as the same toast.
A push-only scenario has no reply to prove anything with, so its four frames — one each for
kind 0, 1, 2 and 4 — plus the browser behaviour they produce through the real dispatcher are the
only evidence there is. Kind 4 is in the set precisely to prove the one behaviour that must
**not** change: the toast and the build-catalogue invalidation on `Options = 1`, both carried
through unmodified from before this scenario existed.

`tutorial` is the onboarding curriculum, and it is the other half of `show-notification`'s
kind 1. The engine is entirely server-side: it announces itself with ONE push,
`ShowNotification(ntkURLFrame, MetaTask.NotTitle, <URL>, MetaTask.NotOptions)`
(`Tasks/Tasks.pas:470`), and everything a panel could draw sits on the tycoon's own cache
object under the `Tutorial` prefix (`TTask.StoreToCache`, `Tasks/Tasks.pas:521-550`) — so the
push says *something changed* and the cache says *what*. Three things it pins. **`Options` is
the routing, not the body**: `NotOptions` defaults to `nopTutorial_SHOW` = 4
(`Tasks/Tasks.pas:285`, constants `:29-32`) and the reference client tested
`Options and (4 or 2) <> 0` (`Voyager/URLNotification.pas:77`), while `HideTaskButton` sends
the same push with an empty title and `Options = 0` to take the affordance away
(`Tasks/Tasks.pas:636-644`) — two frames that differ only in that field mean opposite things,
so both are here. **The body is a URL and must never be rendered**: it is built by
`TTask.GetBaseURL` (`Tasks/Tasks.pas:620-634`) and points at a page written for Internet
Explorer 5. **The four actions bind `TutorialObjId`, not the tycoon** (`ModifyTask.asp:13`,
`:23-34`); three are `procedure`s on `TInformativeTask` (`Tasks/InformativeTask.pas:15-17`), so
their frames carry `"*"` and their **responses are empty**, and the fourth is a `set` on the
published `Completed` property (`Tasks/Tasks.pas:156`). `createTutorialScenario(vars,
{ assignment })` picks which cache shape the read answers — `welcome`, `goal` (the only kind
that writes `TutorialGoal`, `Tasks/MakeProfitTask.pas:81`), `done`, or `none` for the tycoon
who has no assignment. Its test drives the real push dispatcher into the real browser
`dispatchEvent`, then the real `fetchTutorialState` against the mock, then the real
`TutorialPanel` — and asserts an assignment on screen with no URL anywhere in it.

`chat-flags` is `ChatMsg` carrying the packed AccDesc middle field
(`ComposeChatUser`, `Protocol/Protocol.pas:482-492`) — a `procedure`
push (`Protocol/Protocol.pas:206`), so both frames here carry `"*"`, no
QueryId and no reply, the same shape as `show-notification`. Its two
exchanges pin the one thing a reply could never prove: a speaker absent
from the local user list (`chat-flags-stranger`, `Zorg`) still renders
with the correct nobility tier and modifier badge because
`DecodeCodeMSGChat` decorates from the AccDesc on the line itself, never
from the roster (`Voyager/URLHandlers/ChatListHandlerViewer.pas:137-149`);
and a speaker already in the user list (`chat-flags-known`, `SPO_test3`)
with matching AccDesc renders the same badge either way, proving nothing
regresses for a known speaker.

`create-channel` is making a chat channel: `CreateChannel( ChannelName, Password, aSessionApp,
aSessionAppId : widestring; anUserLimit : integer )`, a published FUNCTION on `TClientView`
(`Interface Server/InterfaceServer.pas:186`), so both frames carry `"^"` and a QueryId and both
are answered `res="#<code>"`. Its **five arguments** are what it fixes first: the reference
client's New Channel dialog sent the session app and its id as **empty strings, not omitted**,
and the user limit as `100` (`Voyager.1/URLHandlers/ChatHandlerViewer.pas:221`, which forces the
channel-session tab closed at `:219`). Drop the two empties and `anUserLimit` lands in
`aSessionApp`'s slot and is read as a widestring — no error, no reply difference, a channel with
a meaningless session app and a zero user limit. What no reply could prove is the second thing:
the body (`:1512-1533`) creates the channel only when `GetChannel` returns nil and otherwise
**falls through to `JoinChannel`**, and both branches answer `0`. `ClientCreatedChannel` is the
only thing that broadcasts `uchInclusion` (`:4594`, fanned out at `:4049`), so the free-name
exchange carries that push and the taken-name exchange carries none — the push asymmetry is the
only wire evidence of which branch ran, and it lives in the fixture because no client could
recover it (the broadcast travels on a different path with no correlation id, and nothing needs
the distinction). `createCreateChannelScenario(vars, { takenResult })` sets what the taken name
answers: `13` `ERROR_InvalidPassword` or `32` `ERROR_NotEnoughRoom`
(`Protocol/Protocol.pas:42,61`), both reachable through that fall-through alone and so themselves
proof the name was taken. Its test drives the real gateway `createChatChannel` against the mock,
then feeds the inclusion push through the real dispatcher into the real browser `dispatchEvent`
and asserts the channel appeared in the store.

`refresh-season` is the world's season turning: a single `pushOnly: true` exchange carrying
`RefreshSeason( Season )`, a `procedure` pushed to every client view when the season changes
(`Interface Server/InterfaceServer.pas:3721-3737`) — there is no request of its own, only the
push. What it pins is that the season arrives as a push and nothing else: a client that only
read the season at login (`RESP_LOGIN_SUCCESS.worldSeason`) would follow nothing when the world's
season turns mid-session. Its default `season: 0` (WINTER) is deliberate — the terrain renderer's
own default is `SUMMER`, so a handler that silently did nothing cannot pass by coincidence. Its
test drives the real push dispatcher into the real browser `dispatchEvent` and asserts
`renderer.setSeason` is called with the pushed value.

`building-details` also carries the class picture: each fixture's `imagePath` is the class's
`[MapImages] 64x32x0` file, and the response carries it as `iconUrl` under
`/cache/BuildingImages/`. `MOCK_UNKNOWN_CLASS` (`visualClass '999999'`) is the one class the
cache does not hold a texture for, and its response carries no `iconUrl` key at all. Its test
drives the real `handleBuildingDetails` and matches the emitted frame to the canned response.

`status-lamps` is the two desktop status-pill indicators: `NotifyCompanionship`, the watching
players list, and `ModelStatusChanged`, the model server's backup state — both pushed
`procedure`s, so every frame carries `"*"`, no QueryId and no reply. It pins that the
companions list is CRLF-separated (`Interface Server/InterfaceServer.pas:2359-2361`) and that
an empty string means nobody's viewport intersects this player's — the "extinguish" case. The
backup state has two sources collapsed onto one browser event (`EVENT_MODEL_STATUS_CHANGED`):
the push itself, a production dead letter (`TClientView.ModelStatusChanged` is an empty stub),
and the polled `ServerBusy` boolean, which is what actually drives the lamp on the live wire.
Its test drives the real push dispatcher into the real browser `dispatchEvent` and asserts the
four resulting UI states on a rendered `StatusPill`.

### Scenario Structure

Each `RdoScenario` has a `name`, `description`, and array of `RdoExchange` objects:

```ts
{
  id: 'auth-rdo-001',
  request: 'C 0 idof "DirectoryServer"',          // Raw RDO command
  response: 'A0 objid="${directoryServerId}"',     // Expected response
  matchKeys: { verb: 'idof', targetId: '...' },   // Every declared key must match the frame
  looseMatch: undefined,                            // Optional: '<reason>' to answer on member/verb alone
  pushes: [],                                       // Optional server pushes
  pushOnly: false,                                  // true = server-initiated, no request
}
```

### Scenario Variables

`scenarios/scenario-variables.ts` provides `mergeVariables(overrides?)` for injecting test-specific values (username, serverId, etc.) into scenario templates.

### Adding a New Scenario

1. Create `scenarios/my-scenario.ts`
2. Export `createMyScenario(overrides?: Partial<ScenarioVariables>)`
3. Define exchanges with `matchKeys` — every key you declare is checked, and `argsPattern` is the full argument list
4. Register in `scenarios/scenario-registry.ts`
5. Write each `request:` as a string literal copied from the frame production emits in the
   sibling test (QueryId stripped), never built with the emitter (`rdoCall` / `rdoGet` /
   `rdoSet`) — a fixture built from the catalogue cannot catch a wrong catalogue entry.
   `scenario-fixture-literals.test.ts` enforces this.

## RDO Matching Hierarchy

An exchange answers a frame only if **every key its `matchKeys` declares** matches the frame. A
declared `targetId` (other than `'*'`) must equal the frame's target; a declared `argsPattern` is
the **full** argument list — the frame must carry exactly that many args (`'*'` leaves a position
unpinned, extra trailing args are refused). `RdoMock.match()` tries strategies in order (first
match wins):
1. **Exact match**: verb + specific targetId + action + member + argsPattern, all declared and equal
2. **Key field match**: every declared key equal — argsPattern exchanges first, then those
   without. An exchange declaring only a member (no verb/action/args, target absent or `'*'`)
   is skipped
3. **idof match**: an `idof` frame whose name equals an exchange's exact `targetId`
4. **Loose fallback**: only exchanges with a non-empty `looseMatch: '<reason>'` — answers on the
   member name alone (for `idof`, the verb alone). Without a reason, a frame that matches no
   declared key set gets `null`

No strategy skips an already-consumed exchange. `looseMatch` is the written exception, never the
default: give an exchange precise keys first, and state why when it genuinely must answer any
frame for its member.

## Strict Validator

`rdo-strict-validator.ts` validates every outgoing RDO command against protocol rules. Use it in tests to catch protocol violations (wrong type prefixes, missing separators, invalid verbs) before they reach a real server. A wrong verb, action or separator is an `ERROR`, and so is an **arg count or arg type prefix** mismatch — except for a member listed in `KNOWN_PRODUCTION_DIVERGENCES`, the one allowlist of known production divergences (member, what differs, reason or `[UNKNOWN]`), which reports it as a `WARNING`. An entry is added only when a currently-working production frame would otherwise fail; the production frame is never changed to satisfy a fixture.

## Testing Pattern

```ts
const mock = new RdoMock();
mock.addScenario(createAuthScenario());
const result = mock.match('C 0 idof "DirectoryServer"');
expect(result).not.toBeNull();
expect(result!.response).toContain('objid=');
```

Tests are co-located: `*.test.ts` in the same directory and in `scenarios/`.
