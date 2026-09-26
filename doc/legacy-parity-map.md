# Legacy → WebClient Parity Map

> **Scope:** where each surface of the original Starpeace client lives in this repo today.
> **Audience:** a claimer of a parity card who has never opened `~/SPO-Original`.
> **Last verified:** 2026-09-15 — every path below was re-opened against the three trees on that date.

## How a path is written here

| Root | A path is written | How to tell |
|---|---|---|
| this repo | `src/server/spo_session.ts` | starts `src/`, `doc/`, `scripts/` |
| `~/SPO-Original/` | `Voyager/URLHandlers/MapIsoHandler.pas`, `Kernel/World.pas`, `Mail Server/MailServer.pas` | ends `.pas` or `.dpr` |
| `~/SPO-ASP/Five/0/Visual/` | `Voyager/New Directory/Towns.asp`, `Clusters/WebLoader.asp`, `News/Newsreader.asp` | ends `.asp`, `.inc` or `.js` |

`Five/0` is language 0, not a version — § 1 explains why — and `Five/0` is the base the
gateway pins (`buildAspUrl`, `src/server/spo_session.ts:969`).

**Related documents** — this map does not restate ground already held elsewhere; follow these
for the facility inspector's tab architecture, the per-tab property groups, civic office gating
and a fuller index of `~/SPO-Original`: [voyager-inspector-architecture.md](voyager-inspector-architecture.md),
[facility-tabs-reference.md](facility-tabs-reference.md), [civic-roles-reference.md](civic-roles-reference.md),
[spo-original-reference.md](spo-original-reference.md).

## 1. How the legacy client was built

- Voyager is a native Delphi window (`Voyager/VoyagerWindow.pas`) hosting a frame set addressed
  by `frame_*` query strings. `frame_Class=HTMLView` instantiates `THTMLHandler`, an embedded IE
  control (`Voyager/URLHandlers/HTMLHandler.pas:54,89-92`) that appends the client's language to
  every navigation (`Voyager/URLHandlers/HTMLHandler.pas:141-143`).
- The ASP pages live under `Five/<lang>/`; the base is built once at logon,
  `fWorldURL := fWorldAbsURL + ActiveLanguage + '/'`
  (`Voyager/URLHandlers/ServerCnxHandler.pas:2754`). **`Five/0` is language 0, not a version** —
  `Five/0` … `Five/5` are the same tree in six languages.
- A link whose URL is not local is handed back to Voyager instead of followed
  (`Voyager/URLHandlers/HTMLHandler.pas:246-251`) — that is how an ASP page drove the native
  client, via `http://local.asp?frame_Id=<frame>&frame_Action=<verb>`.
- Every panel is a URL handler unit under `Voyager/URLHandlers/`, listed in
  `Voyager/FIVEVoyager.dpr` (Toolbar, Chat, ChatList, Options, MapIso, ObjectInspector,
  Input/OutputSearch, MsgComposer, Logon, ServerCnx). No other router exists.
- The facility inspector is **native, not web**. `TObjectInspectorContainer`
  (`Voyager/URLHandlers/ObjectInspectorHandleViewer.pas`) builds one tab per sheet; each sheet
  registers itself by name into a sorted `TStringList` of creator functions
  (`Voyager/URLHandlers/SheetHandlerRegistry.pas:8,25-31`, populated by `SheetHandlers.pas`),
  and which tabs a class gets comes from CLASSES.BIN's `[InspectorInfo]` section, read via
  `Voyager/URLHandlers/VisualClassesHandler.pas:174-185`.
- **Reads and writes are two different servers.** Sheets and ASP pages *read* cache-server
  properties through one late-bound COM object: `Cache/CachedObjectAuto.pas:55-66,78-110` turns
  `Obj.Foo`, `Obj.Foo(i)`, `Obj.Foo(i,j)` into the property names `Foo`, `Foo<i>`, `Foo<i>.<j>`
  — the same names the WebClient asks the cacher for (ASP side:
  `Voyager/includes/CacheObject.inc:16-36`). *Writes* are RDO calls onto the model
  server, declared in the kernel (`TFacility` block, `Kernel/Kernel.pas:1077-1095`).
- **The RDO catalogue rule.** `src/shared/rdo-members.ts` is a census of the members the
  WebClient actually emits, each with `kind` (`function`/`procedure`/`accessor`) and `arity`.
  The only authority for those two is the server-side declaration, and the register discipline
  that makes a wrong one unrecoverable is `Rdo/Server/RDOObjectServer.pas:218,266-277`. Read the
  declaration with `delphi-archaeologist`, cite `File.pas:Line`, never probe the live server
  (root `CLAUDE.md` § RDO).
- **Three things were already dead in the deployed legacy** — a legacy page is not a
  specification by itself:
  1. `Clusters/WebLoader.asp:39-52` has the visual-class page resolution commented
     out and `:53` hard-codes `url = "/five/visual/clusters/generic/search/cnxsSearch.asp"`.
     **Every** `WebLoader.asp?Page=Home|Jobs|Gates|Services` landed on the connection-search
     page, so the per-cluster facility sites under `Clusters/` (`Common`, `Dissidents`,
     `Generic`, `IFEL`, `Magna`, `Mariko`, `Moab`, `PGI`, `UW`) were unreachable from the shipped
     client.
  2. QuickWeb — the `Voyager/IsoMap/*Edit.asp` family opened by selecting a building — is
     commented out: `Voyager/URLHandlers/MapIsoHandler.pas:1207-1243` is one `{ … }` block, and
     the live `ShowQuickWeb` at `:1245` opens the native inspector instead.
  3. Units absent from `Voyager/FIVEVoyager.dpr` never shipped: `Voyager/IndustrySheet.pas` and
     `Voyager/Components/IndustrySheet.pas` (the "both copies"), `Voyager/TemplateSheet.pas`,
     `Voyager/InputSelectionForm.pas`, `Voyager/InventionsSheet2.pas`,
     `Voyager/Components/MapIsoView/TraincarSprite.pas`.

`~/SPO-Original/Tasks/` holds 29 `.pas` units.

## 2. The correspondence table

Paths: ASP page folders (`NewLogon/`, `NewTycoon/`, `New Directory/`, `Politics/`, `Mail/`,
`Build/`, `IsoMap/`, `Toolbar/`, `Options/`) sit under `~/SPO-ASP/Five/0/Visual/Voyager/`, and
`Clusters/` + `News/` under `~/SPO-ASP/Five/0/Visual/`. Delphi units under `Voyager/` sit under
`~/SPO-Original/Voyager/`; `Kernel/`, `StdBlocks/`, `Cache/`, `Protocol/`, `Surfaces/`, `Tasks/`,
`Inventions/`, `Mail Server/`, `News Server/`, `Interface Server/` sit directly under
`~/SPO-Original/`. WebClient: repo root.

| Legacy surface | Legacy sources | What it did | WebClient home today | Area |
|---|---|---|---|---|
| **Logon &amp; company entry** | | | | |
| Sign-in | `Voyager/NewLogon/logon.asp`, `Voyager/NewLogon/logonError.asp`; `Voyager/URLHandlers/LogonHandlerViewer.pas` | Alias + password to the DS; 7 error branches | `src/client/components/login/AuthStage.tsx`, `src/client/components/login/AuthErrorModal.tsx`; `src/server/session/login-handler.ts`; `src/shared/auth-error.ts`, `src/shared/error-codes.ts` | client + gateway |
| Zone &amp; world pick | `Voyager/NewLogon/chooseworld.asp`; `Voyager/URLHandlers/LogonHandlerViewer.pas` (`Area` combo) | DS area, then a world grid (year, population, tycoons, online) | `src/client/components/login/ZoneStage.tsx`, `src/client/components/login/WorldStage.tsx`; `src/shared/types/protocol-types.ts` | client |
| Visa &amp; company chooser | `Voyager/NewLogon/chooseVisa.asp`, `Voyager/NewLogon/chooseCompany.asp` | Tycoon Visa vs Visitor Visa, then pick a registered company or "Create New!" | `src/client/components/login/CompanyStage.tsx`; `src/client/layouts/LoginScreen.tsx`; `src/server/session/login-handler.ts`. The Visitor Visa itself is ported: `src/shared/visitor-visa.ts` (`VISITOR_COMPANY_ID = '0'`, cited from `Voyager/NewLogon/chooseVisa.asp:44`) | client |
| Company creation | `Voyager/NewLogon/createCompany.asp`, `Voyager/NewLogon/toptabs.asp`, `Voyager/NewLogon/info.asp`, `Voyager/NewLogon/FacilityList.asp`, `Voyager/NewLogon/entername.asp` | Seal tabs, charter, facility catalogue, name, Magna gate | `src/client/components/modals/CompanyCreationModal.tsx`; `src/server/session/building-templates-handler.ts`; `src/shared/cluster-data.ts` | client + gateway |
| Account creation | `Voyager/NewLogon/createAccount.asp`, `Voyager/NewLogon/createDemoAccount.asp`, `Voyager/NewLogon/rdoCreateAccount.asp` | Account against the DS registry (serial, alias, status) | **none**; would land in `src/server/session/login-handler.ts` + new `src/shared/rdo-members.ts` entries | gateway |
| World entry, reconnect, switch | `Voyager/URLHandlers/ServerCnxHandler.pas`; `Voyager/ConnectingWindow.pas` | IS logon, ClientView, event registration, reconnect, quit | `src/server/session/login-handler.ts`; `src/server/ws-handlers/auth-handlers.ts`; `src/client/handlers/auth-handler.ts`, `src/client/handlers/reconnect-utils.ts`; `src/client/components/modals/ServerSwitchOverlay.tsx` | gateway + client |
| **Tycoon panel** | | | | |
| Profile rail + curriculum | `Voyager/NewTycoon/Tycoon.asp`, `Voyager/NewTycoon/TycoonOptions.asp`, `Voyager/NewTycoon/TycoonCurriculum.asp` | Portrait, rank line, 6 sections; fortune, prestige, nobility, levels, rankings, item log, reset / resign | `src/server/session/profile-finance-handler.ts`; `src/client/components/empire/ProfilePanel.tsx`; `src/client/components/hud/InfoWidget.tsx` | gateway + client |
| Bank account &amp; P&amp;L | `Voyager/NewTycoon/TycoonBankAccount.asp`, `Voyager/NewTycoon/TycoonProfitAndLoses.asp`, `Voyager/NewTycoon/CompanyPage.asp` | Balance, borrow, send money, loan book, pay off; hierarchical account tree + per-line chart links | `src/server/session/profile-finance-handler.ts`; `src/client/components/empire/ProfilePanel.tsx` | gateway |
| Companies | `Voyager/NewTycoon/TycoonCompanies.asp`, `Voyager/NewTycoon/TycoonCompany.asp` | List, "Operate with this company", per-company incomes, Dissolve | `src/server/session/profile-finance-handler.ts`; `src/client/components/empire/EmpireOverview.tsx`, `src/client/components/empire/FacilityList.tsx` | gateway + client |
| Commercial strategy | `Voyager/NewTycoon/TycoonPolicy.asp`, `Voyager/NewTycoon/ModifyPolicyStatus.asp` | Ally / Neutral / Enemy matrix, set-by-name form | `src/server/session/auto-connection-handler.ts` (`parsePolicyHtml`); `src/client/components/empire/ProfilePanel.tsx` | gateway |
| Auto-connections + supplier finder | `Voyager/NewTycoon/TycoonAutoConnections.asp`, `Voyager/NewTycoon/DeleteDefaultSupplier.asp`, `Voyager/NewTycoon/ModifyTradeCenterStatus.asp`, `Voyager/NewTycoon/ModifyWarehouseStatus.asp`, `Voyager/NewTycoon/TycoonSuppliesSearch.asp` | Initial suppliers per fluid, Trade Center / warehouse toggles, add via supplier search | `src/server/session/auto-connection-handler.ts`; `src/client/components/empire/ProfilePanel.tsx`; `src/client/components/modals/SupplierSearchModal.tsx` | gateway + client |
| Tycoon picture upload | `Voyager/PicShopForm.pas`; `Voyager/NewTycoon/TycoonOptions.asp:110-116` | Crop / preview / raw-socket upload on `PictureTransferPort` | `src/server/session/picture-transfer.ts` does the raw-socket portrait upload; wired from `src/server/ws-handlers/profile-handlers.ts` | gateway |
| **Directory &amp; the two searches** | | | | |
| Directory shell + home | `Voyager/New Directory/Directory.asp`, `Voyager/New Directory/DirectoryTop.asp`, `Voyager/New Directory/DirectoryMain.asp` | Docked panel, Back / Home, category grid (Capitol, Towns, You, People, Rankings, Banks) | `src/client/components/search/SearchPanel.tsx`; `src/client/store/search-store.ts`; `src/server/search-menu-service.ts`, `src/server/search-menu-parser.ts`; `src/server/ws-handlers/search-handlers.ts` | client + gateway |
| Towns + town drill-down | `Voyager/New Directory/Towns.asp`, `Voyager/New Directory/RenderTownIn.asp`, `Voyager/New Directory/TownsDetail.asp`, `Voyager/New Directory/InTownFacilities.asp`, `Voyager/New Directory/InTownCompanies.asp`, `Voyager/New Directory/InTownCompany.asp`, `Voyager/New Directory/RenderTown.inc` | Town list, town page, coverage, then facilities by kind and companies in town | `src/server/search-menu-parser.ts` (`parseTownPage`, `parseFolderPage`) + `src/client/components/search/SearchPanel.tsx` port the town list, the town page and the facility/company folder listing; `TownInfo` in `src/shared/types/domain-types.ts`. `TownsDetail.asp`'s per-kind coverage view has **no counterpart** | gateway + client |
| People search | `Voyager/New Directory/Tycoons.asp`, `Voyager/New Directory/FoundTycoons.asp` | Free-text search and an A–Z index | `src/client/components/search/SearchPanel.tsx`; `src/server/session/login-handler.ts` (`searchPeople`) | client |
| Tycoon card + drill-down | `Voyager/New Directory/RenderTycoon.asp`, `Voyager/New Directory/TycoonCompanies.asp`, `Voyager/New Directory/TycoonCompany.asp`, `Voyager/New Directory/TycoonFacilities.asp`, `Voyager/New Directory/OpenFacility.asp` | Public card, then companies &rarr; kinds &rarr; facilities &rarr; facility page | `src/client/components/search/TycoonProfileView.tsx`; `src/server/search-menu-parser.ts` (card only) | client + gateway |
| Rankings, banks, media | `Voyager/New Directory/Rankings.asp`, `Voyager/New Directory/Ranking.asp`, `Voyager/New Directory/Banks.asp`, `Voyager/New Directory/Newspapers.asp` | Nested ranking tree then podium + ranks 4…N; bank list; newspaper list into the news reader | `src/server/search-menu-service.ts`, `src/server/search-menu-parser.ts` (`parseNewspapersPage`, `src/server/search-menu-parser.ts:264`); `src/client/components/search/SearchPanel.tsx` | gateway + client |
| Supplier / customer finder | `Voyager/URLHandlers/InputSearchHandlerViewer.pas`, `Voyager/URLHandlers/OutputSearchHandlerViewer.pas`; `Clusters/CnxsSearch.asp`; `Cache/OutputSearch.pas` | Docked finder: role bitmask, company / town / max filters, sortable results, multi-select hire | `src/client/components/modals/ConnectionPickerModal.tsx`; `src/server/session/politics-handler.ts` (`searchConnections`); `ConnectionSearchResult` in `src/shared/types/message-types.ts` | client + gateway |
| **Politics pages &amp; civic sheets** | | | | |
| Politics page shell | `Voyager/Politics/politics.asp`, `Voyager/Politics/header.asp`, `Voyager/Politics/mayordata.asp`, `Voyager/Politics/opositiondata.asp` | Election countdown, ruler card, strongest challenger | `src/client/components/politics/PoliticsSection.tsx`, `src/client/components/politics/RulerCard.tsx`; `src/server/session/politics-handler.ts` | client + gateway |
| Rating rails | `Voyager/Politics/ratingtabs.asp`, `Voyager/Politics/popularratings.asp`, `Voyager/Politics/ifelratings.asp`, `Voyager/Politics/tycoonratings.asp`, `Voyager/Politics/mayorpub.asp`, `Voyager/Politics/rdoModifyRating.asp`, `Voyager/Politics/rdoModifyPub.asp` | POPULAR / TYCOONS' / IFEL / PUBLICITY rails; rate the ruler; set publicity priority | `src/client/components/politics/RatingsRail.tsx`; `src/server/session/politics-handler.ts`; `src/shared/rdo-members.ts` | client + gateway |
| Campaigns | `Voyager/Politics/campaigntabs.asp`, `Voyager/Politics/allcampaigns.asp`, `Voyager/Politics/tycooncampaign.asp`, `Voyager/Politics/rdoModifyProject.asp` | Launch / withdraw, programme planks, minister slate, ranked list | `src/client/components/politics/CampaignPanel.tsx`; `src/server/session/politics-handler.ts`; `src/server/ws-handlers/politics-handlers.ts` | client + gateway |
| Town Hall sheets | `Voyager/TownHallSheet.pas`, `Voyager/TownTaxesSheet.pas`, `Voyager/TownHallJobsSheet.pas`, `Voyager/TownHallResSheet.pas`, `Voyager/TownParamSheet.pas` | Overview, taxes, jobs / minimum wage, residentials, services | `src/shared/building-details/template-groups.ts` (`TOWN_*` groups); `src/client/components/politics/OverviewSection.tsx`, `src/client/components/politics/TaxesTab.tsx`, `src/client/components/politics/JobsTab.tsx`, `src/client/components/politics/ResidentialsTab.tsx`, `src/client/components/politics/ServicesTab.tsx` | shared + client |
| Capitol sheets | `Voyager/CapitolSheet.pas`, `Voyager/CapitolTownsSheet.pas`, `Voyager/MinisteriesSheet.pas`, `Voyager/VotesSheet.pas` | World overview, towns + mayor tax + appoint, 8 ministries, the ballot | `src/shared/building-details/template-groups.ts`; `src/client/components/politics/TownsTab.tsx`, `src/client/components/politics/MinistriesTab.tsx`, `src/client/components/politics/VotesTab.tsx`; writes via `src/client/handlers/building-action-handler.ts`; gate `canGovern` in `src/server/session/building-details-handler.ts`. No legacy equivalent for the panel's own entry point, `src/client/components/politics/PoliticsHome.tsx` | shared + client |
| **Mail, newspapers, board** | | | | |
| Mailbox + notification | `Voyager/Mail/MailFolder.asp`, `Voyager/Mail/MailFolderTop.asp`, `Voyager/Mail/MessageList.asp`, `Voyager/Mail/MessageHeader.asp`, `Voyager/Mail/MessageBody.asp`; `Voyager/URLHandlers/MsgComposerHandler.pas`, `Voyager/URLHandlers/ToolbarHandler.pas`; `Mail Server/MailServer.pas` | Folders, list, read, compose / reply / forward / draft / delete; unread LED and "THE POSTMAN" chat line | `src/client/components/mail/MailPanel.tsx`; `src/client/store/mail-store.ts`; `src/server/session/mail-handler.ts`, `src/server/session/push-dispatcher.ts`; `src/server/mail-list-parser.ts`; `src/server/ws-handlers/mail-handlers.ts`; badge on `src/client/components/hud/CommandBar.tsx` | client + gateway |
| System mail templates | `Voyager/Mail/SpecialMessages/MsgWelcome.asp`, `Voyager/Mail/SpecialMessages/MsgZoned.asp`, `Voyager/Mail/SpecialMessages/MoneySendNotification.asp`, `Voyager/Mail/SpecialMessages/NotifyMinister.asp` | Server-rendered HTML mail with map-jump links | `src/client/components/mail/HtmlMailBody.tsx`; `src/shared/mail-html-utils.ts` | client + shared |
| Newspaper reader | `News/Newsreader.asp`, `News/ShowPaper.asp`, `News/ShowBar.asp`; `News Server/News.pas` | Generated issue, back-issue date bar, READ NEWS / READ COLUMNS | `src/server/session/newspaper-handler.ts` fetches the generated paper; `src/client/components/modals/NewspaperModal.tsx` renders it | gateway + client |
| Editorial board | `News/boardreader.asp`, `News/boardlist.asp`, `News/boardmsg.asp` | Nested column tree, read / post / reply, Rate-the-Mayor form | `src/server/session/newspaper-handler.ts`; `src/server/ws-handlers/newspaper-handlers.ts`; `src/client/store/newspaper-store.ts` | gateway + client |
| **Facility inspector — core sheets** | | | | |
| Inspector shell &amp; tab set | `Voyager/URLHandlers/ObjectInspectorHandleViewer.pas`, `Voyager/URLHandlers/ObjectInspectorHandler.pas`, `Voyager/URLHandlers/SheetHandlerRegistry.pas`, `Voyager/SheetHandlers.pas`; CLASSES.BIN `[InspectorInfo]` | Tabs per visual class, lazy per-tab read, KeepAlive on the cache object | `src/client/components/building/BuildingInspector.tsx`, `src/client/components/building/InspectorMenu.tsx`, `src/client/components/building/inspector-sections.ts`; `src/server/classes-bin-parser.ts`; `src/shared/building-details/property-templates.ts` | client + shared |
| General tab | `Voyager/IndustryGeneralSheet.pas`, `Voyager/UnkFacilitySheet.pas`, `Voyager/GateInfo.pas` | Name, owner, cost, ROI, age; rename / stop / demolish / connect; trade role and trade level | `src/shared/building-details/template-groups.ts` (`UNK_*`/`IND_*` general groups); `src/client/components/building/PropertyGroup.tsx`, `src/client/components/building/InspectorHeader.tsx`; `src/server/session/building-management-handler.ts` | shared + client |
| Supplies tab | `Voyager/SupplySheetForm.pas`, `Voyager/InputOptionsViewer.pas` | Per-input sub-tab, max price / min quality, supplier table, hire / fire / overpay | `src/client/components/building/SuppliesGroup.tsx`, `src/client/components/building/useGateConnections.ts`; `src/server/session/building-details-handler.ts`, `src/server/session/building-property-handler.ts` | client + gateway |
| Products tab | `Voyager/ProdSheetForm.pas` | Per-output sub-tab, stock / quality / price %, customer table, connect / drop | `src/client/components/building/ProductsGroup.tsx`; `src/server/session/building-details-handler.ts` | client + gateway |
| Workforce tab | `Voyager/WorkforceSheet.pas`; `Voyager/Components/PercentEdit.pas` | Jobs filled / max and quality per social class, salary sliders | `src/client/components/building/WorkforceTable.tsx`; `src/shared/building-details/template-groups.ts` | client + shared |
| Management / Upgrade tab | `Voyager/ManagementSheet.pas`, `Voyager/UpgradeFrm.pas`; `Kernel/CloneOptions.pas` | Accept cloning, clone settings, start / stop / downgrade upgrades | `src/client/components/building/PropertyActions.tsx`; `src/server/session/building-management-handler.ts`, `src/server/session/construction-lock.ts` | client + gateway |
| Chart / history tab | `Voyager/ChartSheet.pas`, `Voyager/ChartWindow.pas`, `Voyager/Components/PlotterGrid.pas`; `Kernel/Plotter.pas` | Yearly profit graph, "no history yet" page, pop-out window | `src/shared/building-details/template-groups.ts` (`FINANCES_GROUP`); `src/client/components/building/RevenueGraph.tsx`; parse in `src/server/session/building-details-handler.ts` | shared + client |
| **Facility inspector — special sheets** | | | | |
| HQ + research | `Voyager/HqMainSheet.pas`, `Voyager/InventionsSheet.pas`; `Kernel/ResearchCenter.pas`, `Inventions/Inventions.pas` | HQ overview; research tree, queue / stop / sell an invention | `src/client/components/building/ResearchPanel.tsx`, `src/client/components/building/research-utils.ts`; `src/server/session/research-handler.ts`; `src/shared/research-dat-parser.ts`; HQ group in `src/shared/building-details/template-groups.ts` | client + gateway |
| Bank | `Voyager/BankGeneralSheet.pas`, `Voyager/BankLoansSheet.pas`; `StdBlocks/Banks.pas` | Set rate / term / lending share; granted-loan table; borrow from another tycoon's bank | `src/shared/building-details/template-groups.ts` (bank group + `LoanCount` table); `src/client/components/building/PropertyTables.tsx` | shared |
| TV, antennas, films, ads | `Voyager/TVGeneralSheet.pas`, `Voyager/AntennasSheet.pas`, `Voyager/FilmsSheet.pas`, `Voyager/AdvSheetForm.pas`; `StdBlocks/Broadcast.pas`, `StdBlocks/MovieStudios.pas` | Broadcast hours, commercial share, antenna table, launch / cancel / release a movie, ad spend | `src/shared/building-details/template-groups.ts` (`ANTENNAS_GROUP`, `FILMS_GROUP`, `ADS_GROUP`); `src/client/components/building/PropertyTables.tsx`; actions in `src/client/handlers/building-action-handler.ts` | shared + client |
| Residential | `Voyager/ResidentialSheet.pas`; `Kernel/PopulatedBlock.pas` | Rent, maintenance, repair, livability | `src/shared/building-details/template-groups.ts` (`RES_*` groups); `REPAIR_CONTROL` in `src/client/components/building/PropertyActions.tsx` | shared |
| Services + company inputs | `Voyager/SrvGeneralSheetForm.pas`, `Voyager/CompanyServicesSheetForm.pas`; `StdBlocks/ServiceBlock.pas`, `StdBlocks/OfficeBlock.pas` | Price per service and supply / demand cards; demanded level per company input | `src/shared/building-details/template-groups.ts` (`SERVICE_CARDS`, `SRV_GENERAL_GROUP`); `src/client/components/building/InputsGroup.tsx`, `src/client/components/building/comp-inputs-utils.ts`; `src/server/session/building-details-handler.ts` | shared + client |
| Warehouse | `Voyager/WHGeneralSheet.pas`; `StdBlocks/Warehouses.pas` | Ware checklist, trade level, sell-to-all buttons | `src/shared/building-details/template-groups.ts` (`WARE_CHECKLIST`); `src/client/components/building/PropertyActions.tsx` | shared + client |
| Mausoleum | `Voyager/MausoleumSheet.pas`; `StdBlocks/TranscendBlock.pas` | Words of wisdom; cancel transcendence | `src/shared/building-details/template-groups.ts` (mausoleum group); write path `src/server/session/building-property-handler.ts` | shared + client |
| Crime, transport, trains | `Voyager/URLHandlers/CrimeHandler.pas`, `Voyager/URLHandlers/TransportHandler.pas`, `Voyager/URLHandlers/voyagertrains.pas`; `Voyager/Components/MapIsoView/Railroads.pas` | Criminal roster / missions; server-driven vehicles; railroads | none, and none planned — see `doc/architecture-overview.md` § Directory Structure (*No Transport panel*) | — |
| **The ASP facility "web site" and edit pages** | | | | |
| Facility web site | `Clusters/WebLoader.asp`, `Clusters/Generic/facilities/Farms/Home.asp`, `Clusters/Generic/facilities/Farms/Gates.asp`, `Clusters/Generic/facilities/Headquarters/Home.asp`, `Clusters/Generic/facilities/Headquarters/Jobs.asp`, `Clusters/Generic/facilities/Industries/Home.asp`, `Clusters/Generic/facilities/Industries/Jobs.asp`, `Clusters/Generic/facilities/Industries/Gates.asp`, `Clusters/Generic/facilities/PublicFacilities/Home.asp`, `Clusters/Generic/facilities/Residentials/Home.asp`, `Clusters/Generic/facilities/Stores/Home.asp`, `Clusters/Generic/facilities/Stores/Jobs.asp`, `Clusters/Generic/facilities/Stores/Gates.asp`, `Clusters/Generic/facilities/Stores/Services.asp`, `Clusters/Generic/facilities/Warehouses/Home.asp`, `Clusters/Generic/facilities/Warehouses/Jobs.asp`, `Clusters/Generic/facilities/Warehouses/Gates.asp` | Per-cluster site: identity, general info, workforce, gates, services — **dead in the deployed build** (§ 1) | Replaced by the native inspector: `src/client/components/building/InspectorHeader.tsx`, `src/client/components/building/QuickStats.tsx`, `src/client/components/building/RichDetails.tsx` | client |
| QuickWeb edit pages | `Voyager/IsoMap/BusinessEdit.asp`, `Voyager/IsoMap/SupplierEdit.asp`, `Voyager/IsoMap/ServiceEdit.asp`, `Voyager/IsoMap/ResidentialEdit.asp`, `Voyager/IsoMap/HeadquarterEdit.asp`, `Voyager/IsoMap/PublicFacEdit.asp`, `Voyager/IsoMap/TownHallEdit.asp`, `Voyager/IsoMap/ConstructionEdit.asp`, `Voyager/IsoMap/UnknownEdit.asp`, `Voyager/IsoMap/ModifyFacility.asp`, `Voyager/IsoMap/StopFacility.asp`, `Voyager/IsoMap/DeleteFacility.asp`, `Voyager/IsoMap/MoreOptions.asp` | Map-selection settings panel — **commented out** in the shipped client | `src/shared/building-details/template-groups.ts`; `src/server/session/building-property-handler.ts`, `src/server/session/building-management-handler.ts` | shared + gateway |
| Facility state / diagnosis | `Clusters/Dissidents/scripting/FacilityState.js`, `Clusters/Mariko/scripting/FacilityState.js`, `Clusters/Moab/scripting/FacilityState.js`, `Clusters/PGI/scripting/FacilityState.js`; `Kernel/Kernel.pas` `Trouble` | Why-is-this-not-working icon | `src/shared/building-details/facility-diagnosis.ts`; `src/client/components/building/DiagnosisBanner.tsx`, `src/client/components/building/StatusOverlay.tsx` | shared + client |
| ASP fetch path &amp; images | `Voyager/URLHandlers/HTMLHandler.pas`; `Voyager/URLHandlers/ServerCnxHandler.pas:2754`; `Voyager/IsoMap/FacilityImage.asp`, `Voyager/IsoMap/Image.asp` | How Voyager reached any `Five/<lang>/…` page, and the facility picture strip | `buildAspUrl` / `fetchAspPage` in `src/server/spo_session.ts:969,986`; `src/server/asp-url-extractor.ts`; `src/server/proxy-image.ts` (`GET /proxy-image`) | gateway |
| **Map view** | | | | |
| Camera: pan, zoom, rotate, history | `Voyager/Components/MapIsoView/MapIsoView.pas`, `Voyager/Components/MapIsoView/GameControl.pas`, `Voyager/Components/MapIsoView/FiveControl.pas`, `Voyager/Components/MapIsoView/GameTypes.pas` | Drag-pan, 4 zoom levels, 4 orientations, Back / Next | `src/client/renderer/isometric-map-renderer.ts`, `src/client/renderer/touch-handler-2d.ts`, `src/client/renderer/coordinate-mapper.ts`; `src/client/store/map-store.ts`; `src/client/hooks/useCameraHistory.ts`; `src/shared/map-config.ts` | renderer |
| Terrain, concrete, road textures | `Voyager/Components/MapIsoView/Map.pas`, `Voyager/Components/MapIsoView/Concrete.pas`, `Voyager/Components/MapIsoView/Roads.pas`, `Voyager/Components/MapIsoView/ImageCache.pas`, `Voyager/Components/MapIsoView/LocalCacheManager.pas` | Ground, seasons, concrete aprons, road textures, tile cache | `src/client/renderer/isometric-terrain-renderer.ts`, `src/client/renderer/concrete-texture-system.ts`, `src/client/renderer/road-texture-system.ts`, `src/client/renderer/terrain-loader.ts`, `src/client/renderer/texture-atlas-cache.ts`, `src/client/renderer/chunk-cache.ts`; `src/shared/land-utils.ts` | renderer |
| Data overlays / surfaces | `Voyager/Components/MapIsoView/MapIsoView.pas`; `Surfaces/Surfaces.pas`; `Kernel/World.pas` `RDOGetSurface` | One data overlay painted on the ground; zone colours; town colours | `src/client/handlers/overlay-mode.ts`, `src/client/handlers/map-handler.ts`; `src/client/components/hud/OverlayMenu.tsx`; overlay list in `src/shared/types/domain-types.ts` | client + shared |
| Zones | `Voyager/Build/MayorOptions.asp`; `Kernel/World.pas` `DefineZone`; `Protocol/Protocol.pas` zone consts | Paint / erase a zone rectangle, gated on office | `src/client/handlers/zone-handler.ts`; `src/client/components/modals/ZoneTypePicker.tsx`; `src/server/session/zone-surface-handler.ts`; `ZONE_TYPES` in `src/shared/types/domain-types.ts` | client + gateway |
| Roads | `Voyager/Build/RoadOptions.asp`; `Voyager/URLHandlers/MapIsoHandler.pas`; `Kernel/World.pas` `RDOCreateCircuitSeg`/`RDOBreakCircuitAt` | Drag-build with running cost; demolish point or rectangle | `src/client/handlers/road-handler.ts`; `src/server/session/road-handler.ts`; `src/server/ws-handlers/road-handlers.ts`; `src/shared/road-cost.ts` | client + gateway |
| Build menu | `Voyager/Build/Build.asp`, `Voyager/Build/KindList.asp`, `Voyager/Build/FacilityList.asp` | Categories, per-kind list with price / surface / zone / availability, place a building | `src/server/session/building-templates-handler.ts` (scrapes the same pages); `src/client/components/modals/BuildMenu.tsx`; `src/client/handlers/build-menu-handler.ts`; `src/client/renderer/placement-validation.ts` | gateway + client |
| Favorites | `Voyager/FavView.pas`, `Voyager/MoveFav.pas`; `Kernel/Favorites.pas`, `Kernel/FavProtocol.pas` | Server-side tree of folders and links: add / rename / delete / move / jump | `src/server/session/favorites-handler.ts`; `src/client/components/map/MapSurface.tsx`; `src/client/store/legacy-bookmarks.ts` | gateway + client |
| Minimap | `Voyager/Components/IsometricMap/FiveIsometricMap.pas`, `Voyager/Components/MapIsoView/Map.pas` (`GetColor`, fog) | Docked diamond, view rectangle, colour by class, fog of war | `src/client/ui/minimap-ui.ts`, `src/client/ui/minimap-colormap.ts`; `src/client/components/mobile/MinimapToggleButton.tsx` | client |
| Sounds &amp; animations | `Voyager/URLHandlers/MapIsoHandler.pas`, `Voyager/URLHandlers/JukeBox.pas`; `Voyager/Components/MapIsoView/Sounds.pas`, `Voyager/Components/MapIsoView/SoundCache.pas`, `Voyager/Components/MapIsoView/Car.pas`, `Voyager/Components/MapIsoView/Aircraft.pas` | Per-building ambience, music, cars and planes on the map | `src/client/audio/sound-manager.ts`; `src/client/renderer/vehicle-animation-system.ts`, `src/client/renderer/car-class-system.ts` | client + renderer |
| Map data transport | `Voyager/URLHandlers/MapIsoHandler.pas` (`evnRefreshArea`/`evnRefreshObject`); `Interface Server/InterfaceServer.pas` (`SetViewedRegion`) | Server pushes area / object refreshes for the viewed region | `src/server/map-data-service.ts`, `src/server/map-parsers.ts`; `src/server/ws-handlers/map-handlers.ts`; `src/client/handlers/event-handler.ts` | gateway + client |
| **Shell** | | | | |
| Toolbar &rarr; HUD rails | `Voyager/Toolbar/toolbar.asp`; `Voyager/URLHandlers/ToolbarHandler.pas`, `Voyager/URLHandlers/ToolbarHandlerViewer.pas` | 13 buttons; date / money / profit / rank / facility counter; 5 status lamps | `src/client/components/hud/CommandBar.tsx`, `src/client/components/hud/StatusPill.tsx`, `src/client/components/hud/InfoWidget.tsx`, `src/client/components/hud/LeftRail.tsx`, `src/client/components/hud/RightRail.tsx`; `src/client/components/mobile/` | client |
| Event ticker | `Voyager/URLHandlers/ToolbarHandlerViewer.pas:207-270`; `Kernel/World.pas` `RDOPickEvent` | Scrolling next-event line with a clickable link | `src/server/session/world-events-handler.ts` emits it; `PickEvent` is catalogued at `src/shared/rdo-members.ts:166`; consumed by `src/client/handlers/event-handler.ts` | gateway + client |
| Options &rarr; SettingsDialog | `Voyager/URLHandlers/OptionsHandlerViewer.pas`, `Voyager/URLHandlers/ConfigHandler.pas`; `Voyager/Options/Options.asp` | Graphics toggles, per-kind facility visibility, sound volumes, network stats, language, quick logon | `src/client/components/modals/SettingsDialog.tsx`; `src/client/store/ui-store.ts`, `src/client/store/game-store.ts`; persistence via `src/client/bridge/client-bridge.ts` | client |
| Hints / notifications &rarr; toasts | `Voyager/URLHandlers/HintBox.pas`; `Voyager/URLNotification.pas`, `Voyager/MessageBox.pas` | Transient hint label, minimisable notification window, modal message box | `src/client/components/common/Toast.tsx`, `src/client/components/common/Dialog.tsx`, `src/client/components/common/ConfirmDialog.tsx`, `src/client/components/common/PromptDialog.tsx`; `ModalType` in `src/client/store/ui-store.ts` | client |
| Chat &rarr; ChatStrip | `Voyager/URLHandlers/ChatHandler.pas`, `Voyager/URLHandlers/ChatListHandler.pas`, `Voyager/URLHandlers/GMChatHandler.pas` + their viewers, `Voyager/URLHandlers/VoiceHandler.pas`; `Interface Server/InterfaceServer.pas` (`SayThis`, `GetChannelList`, `Chase`) | Channels, user list, typing indicator, ignore, follow, GM call, voice | `src/client/components/chat/ChatStrip.tsx`, `src/client/components/chat/NobilityBadge.tsx`; `src/client/handlers/chat-handler.ts`; `src/client/store/chat-store.ts`; `src/server/session/chat-handler.ts`, `src/server/session/push-dispatcher.ts`; `src/server/ws-handlers/chat-handlers.ts` | client + gateway |
| Tutorial / curriculum tasks | `Tasks/` (29 units, incl. `Tutorial.pas`); `Voyager/NewTycoon/Tasks/<TaskName>/<n>/*.asp` (41 task folders, 44 `.asp` files) | 22 server-pushed task kinds with Continue / Skip navigation | fully ported: `src/server/session/tutorial-handler.ts`, `src/server/ws-handlers/profile-handlers.ts`, `src/client/store/tutorial-store.ts`, `src/client/components/tutorial/TutorialPanel.tsx`, `src/client/components/tutorial/tutorial-content.ts` | client + gateway |
| Changelog | `Voyager/ChangeLog.pas` | "What's new" on entering the world | `src/client/components/modals/ChangelogModal.tsx`; `src/client/hooks/useChangelogCheck.ts` | client |

## 3. Placement rules for a port

1. **A new cache-property read, inspector side.** Add the property to the right group in
   `src/shared/building-details/template-groups.ts`. The server builds its cacher read list from
   the templates (`src/server/session/building-details-handler.ts`) — no fetch call is added for
   a plain cached property. Indexed properties (`Foo<i>`) use `indexed: true` + a
   `countProperty` (`src/shared/building-details/template-groups.ts:126-130`).
2. **A new cache-property read, ASP-scraped side.** The pages still scraped (tycoon panel,
   directory, politics, mail, board, build menu) are parsed in their session handler —
   `profile-finance-handler.ts`, `auto-connection-handler.ts`, `search-menu-parser.ts`,
   `search-menu-service.ts`, `politics-handler.ts`, `mail-list-parser.ts`,
   `newspaper-handler.ts`, `building-templates-handler.ts`. Extend the parser and its result
   type; never add a second fetch of the same page.
3. **A new RDO member is five files, in this order.** (a) catalogue entry in
   `src/shared/rdo-members.ts` with `kind` + `arity` cited from the server-side declaration
   (area `rdo` — that row wins over `shared`); (b) the emitting call in
   `src/server/session/<domain>-handler.ts` via `rdoCall`/`rdoGet`/`rdoSet`; (c) message types
   in `src/shared/types/message-types.ts`; (d) the route in
   `src/server/ws-handlers/<domain>-handlers.ts`; (e) the client handler in
   `src/client/handlers/`, then the store, then the component. That crosses blocking areas, so
   it is normally **two cards** (`rdo`/`gateway`, then `client`), the second naming its blocker.
4. **Scrape or RDO.** The gateway fetches an ASP page with `buildAspUrl` / `fetchAspPage`
   (`src/server/spo_session.ts:969,986`), which pins the `Five/0/` base and the session
   parameters. Scrape when the legacy itself only had a page; go RDO when a declared member
   exists — except where the reference client only posted a form. The tycoon panel is that
   exception: its ASP pages held the `RDOClient.RDOObjectProxy` and called the member
   server-side, so the HTTP call keeps the WebClient on the legacy transport.
5. **Tests per layer.** `shared` or parser change &rarr; **L0** unit test beside the file. New
   or changed RDO frame &rarr; **L1** scenario in `src/mock-server/` (the strict validator
   asserts frame, separator and arity). A user-visible flow end to end &rarr; **L2** in
   `src/e2e/`, the pre-merge gate. Component behaviour &rarr; L0 with jsdom.
6. **Area — a partition, first match from the top** (`doc/kanban-workflow.md` § The areas):
   `docs` (`**/*.md`, `doc/**`) · `rdo` (`src/shared/rdo-*.ts`, `src/server/rdo*.ts`,
   `src/server/session/rdo-*.ts`, `src/mock-server/**`) · `bench` (`src/e2e/bench/**`,
   `scripts/bench-*.sh`, `scripts/verify-gate.js`, `.claude/hooks/**`) · `renderer`
   (`src/client/renderer/**`, `src/client/**/*.module.css`) · `gateway` (`src/server/**`) ·
   `client` (`src/client/**`, `public/**`) · `e2e` (`src/e2e/**`) · `shared` (`src/shared/**`,
   `src/*.d.ts`) · `ci` (catch-all). One area per card, where the **majority** lands.
7. **Do not take a legacy page at face value.** Check `Voyager/FIVEVoyager.dpr` before treating
   a `.pas` as shipped behaviour, and check for a wrapping `{ … }` comment before treating a
   Pascal block as live (§ 1). A `Clusters/**` page reachable only through `WebLoader.asp` was
   unreachable in the deployed build.
