# Facility Inspector Tabs — Voyager Legacy Reference

> **Purpose**: Documents how SPO-Original Voyager client identifies, loads, and renders facility detail tabs. Optimized for AI agent consumption during WebClient implementation.

## Data Source

**`cache/BuildingClasses/CLASSES.BIN`** (157,993 bytes, June 2003) contains `[InspectorInfo]` sections for **all 863 visual classes**. The existing parser at `src/server/classes-bin-parser.ts` already parses this binary (extracts `[General]`, `[MapImages]`, `[Animations]`, `[Sounds]`, `[Effects]`) but does **not yet extract `[InspectorInfo]`**. Extending the parser is the correct approach — no hardcoding needed.

### All Sections in CLASSES.BIN

| Section | Classes | Currently Parsed | Notes |
|---------|---------|-----------------|-------|
| `General` | 863 | Yes | Name, xSize, FacId, Urban, etc. |
| `InspectorInfo` | 863 | **No** | Tab definitions (this document) |
| `MapImages` | 863 | Yes | Texture filenames |
| `Paths` | 863 | No | Resource paths |
| `Actions` | 859 | No | Context menu actions |
| `Images` | 859 | No | UI icon images |
| `SitePages` | 859 | No | Web page references |
| `Sounds` | 859 | Yes | Sound effects |
| `VoyagerActions` | 853 | No | URL handler actions |
| `Site` | 752 | No | Web site URLs |
| `SiteImages` | 621 | No | Web site images |
| `HomePageText` | 342 | No | Info panel text |
| `Effects` | 82 | Yes | Visual effects |
| `Animations` | 27 | Yes | Sprite animation regions |
| `xSounds` | 2 | No | Extra sounds (2 entries) |

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│  BUILD TIME (Class Packer tool)                             │
│  *.final.ini  ──compile──>  classes.bin (binary)            │
│  [InspectorInfo] sections define tabs per facility class    │
└──────────────────────────┬──────────────────────────────────┘
                           │ bundled with client install
┌──────────────────────────▼──────────────────────────────────┐
│  WEBCLIENT (classes-bin-parser.ts)                           │
│  cache/BuildingClasses/CLASSES.BIN → parseClassesBin()       │
│  → 863 BuildingClassEntry objects in memory                  │
│  → TODO: add inspectorTabs field to BuildingClassEntry       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  ORIGINAL VOYAGER (Delphi — for reference only)              │
│  ObjectInspectorHandleViewer.AddControlTabs()                │
│  → reads InspectorInfo.TabCount/TabName{i}/TabHandler{i}    │
│  → SheetHandlerRegistry.GetSheetHandler(handlerName)         │
│  → creates IPropertySheetHandler instances                   │
│  → renders tab bar in TPDTabControl                          │
└─────────────────────────────────────────────────────────────┘
```

## Tab Configuration Format

Each facility class has an `[InspectorInfo]` section in its visual class definition (originally INI, compiled to binary `classes.bin`):

```ini
[InspectorInfo]
TabCount=4
TabName0=GENERAL
TabHandler0=IndGeneral
TabName1=PRODUCTS
TabHandler1=Products
TabName2=SUPPLIES
TabHandler2=Supplies
TabName3=MANAGEMENT
TabHandler3=facManagement
```

### Access Constants

Source: `Voyager/URLHandlers/ObjectInspectorHandleViewer.pas:11-15`

```
Section name:    'InspectorInfo'
Tab count key:   'TabCount'        → integer
Tab name key:    'TabName' + i     → string (e.g., 'TabName0', 'TabName1')
Tab handler key: 'TabHandler' + i  → string (e.g., 'TabHandler0', 'TabHandler1')
```

### Runtime Tab Loading Procedure

Source: `ObjectInspectorHandleViewer.pas:1070-1149`

```
1. Read TabCount = GetValue('InspectorInfo', 'TabCount', vtInteger)
2. For i = 0 to TabCount-1:
   a. name    = GetValue('InspectorInfo', 'TabName' + i, vtString)    → e.g., "GENERAL"
   b. handler = GetValue('InspectorInfo', 'TabHandler' + i, vtString) → e.g., "IndGeneral"
   c. Translate name: tabNamesMLS.TranslateName("GENERAL") → localized display text
   d. Uppercase handler: "INDGENERAL"
   e. Lookup: SheetHandlerRegistry.GetSheetHandler("INDGENERAL") → creator function
   f. AddSheet(translatedName, handler) → add to UI tab bar
3. If same handler set as previous facility → reuse tabs, just refresh data
4. If different → clear all tabs and rebuild
```

### Tab Name → Localized Display Mapping

Source: `Voyager/tabNamesMLS.pas:25-49`

| Tab Name ID | Literal Key | English Display |
|-------------|-------------|-----------------|
| `GENERAL` | Literal463 | General |
| `PRODUCTS` | Literal469 | Products |
| `SUPPLIES` | Literal474 | Supplies |
| `MANAGEMENT` | Literal467 | Management |
| `SERVICES` | Literal473 | Services |
| `RESIDENTIALS` | Literal472 | Residentials |
| `CLIENTS` | Literal461 | Clients |
| `COMMERCE` | Literal462 | Commerce |
| `HISTORY` | Literal464 | History |
| `JOBS` | Literal465 | Jobs |
| `LOANS` | Literal466 | Loans |
| `MINISTERIES` | Literal468 | Ministries |
| `PUBLICITY` | Literal470 | Publicity |
| `RESEARCHES` | Literal471 | Researches |
| `TAXES` | Literal475 | Taxes |
| `MAUSOLEUM` | Literal475 | Mausoleum |
| `TOWNS` | Literal478 | Towns |
| `FILMS` | Literal479 | Films |
| `ANTENNAS` | Literal480 | Antennas |
| `VOTES` | Literal481 | Votes |
| `WARES` | Literal492 | Wares |

Note: `MAUSOLEUM` reuses the same literal key as `TAXES` (Literal475).

## Sheet Handler Registry

Source: `Voyager/SheetHandlerRegistry.pas`

Handlers are registered at module initialization (Delphi `initialization` block). The registry stores creator functions in a sorted, case-insensitive `TStringList`. Lookup converts handler name to uppercase.

### Complete Handler Registry (42 registrations, 30 unique handler names)

| Handler Name (case as registered) | Uppercase Key | Creator Function | Source File | Facility Category |
|---|---|---|---|---|
| `IndGeneral` | INDGENERAL | IndustryGeneralSheetHandlerCreator | IndustryGeneralSheet.pas:495 | Industry |
| `IndGeneral` | INDGENERAL | ServiceGeneralSheetHandlerCreator | IndustrySheet.pas:348 | Industry (duplicate — last wins) |
| `Products` | PRODUCTS | ProductSheetHandlerCreator | ProdSheetForm.pas:901 | Any production |
| `Supplies` | SUPPLIES | SupplyHandlerCreator | SupplySheetForm.pas:1261 | Any with inputs |
| `Workforce` | WORKFORCE | WorkforceSheetHandlerCreator | WorkforceSheet.pas:467 | Any with employees |
| `facManagement` | FACMANAGEMENT | ManagementHandlerCreator | ManagementSheet.pas:482 | Any facility |
| `SrvGeneral` | SRVGENERAL | ServiceGeneralSheetHandlerCreator | SrvGeneralSheetForm.pas:602 | Service |
| `ResGeneral` | RESGENERAL | ResidentialSheetHandlerCreator | ResidentialSheet.pas:437 | Residential |
| `ResGeneral` | RESGENERAL | ResidentialSheetHandlerCreator | Components/IndustrySheet.pas:309 | Residential (duplicate) |
| `HqGeneral` | HQGENERAL | HqSheetHandlerCreator | HqMainSheet.pas:371 | HQ |
| `hdqInventions` | HDQINVENTIONS | InventionSheetHandlerCreator | InventionsSheet.pas:1106 | HQ |
| `hdqInventions` | HDQINVENTIONS | InventionSheetHandlerCreator | InventionsSheet2.pas:951 | HQ (duplicate) |
| `BankGeneral` | BANKGENERAL | BankGeneralSheetHandlerCreator | BankGeneralSheet.pas:485 | Bank |
| `BankLoans` | BANKLOANS | BankLoansSheetHandlerCreator | BankLoansSheet.pas:265 | Bank |
| `WHGeneral` | WHGENERAL | WHGeneralSheetHandlerCreator | WHGeneralSheet.pas:586 | Warehouse |
| `TVGeneral` | TVGENERAL | TVGeneralSheetHandlerCreator | TVGeneralSheet.pas:413 | TV Station |
| `Ads` | ADS | AdvertisementSheetHandlerCreator | AdvSheetForm.pas:791 | Any with ad inputs |
| `Films` | FILMS | FilmsSheetHandlerCreator | FilmsSheet.pas:473 | Movie Studio |
| `Antennas` | ANTENNAS | AntennasSheetHandlerCreator | AntennasSheet.pas:331 | TV Station |
| `Mausoleum` | MAUSOLEUM | MausoleumSheetHandlerCreator | MausoleumSheet.pas:275 | Monument |
| `Votes` | VOTES | VotesSheetHandlerCreator | VotesSheet.pas:377 | Capitol |
| `Chart` | CHART | ChartHandlerCreator | ChartSheet.pas:175 | Generic chart |
| `InputSelection` | INPUTSELECTION | InputSelectionHandlerCreator | InputSelectionForm.pas:241 | Generic |
| `compInputs` | COMPINPUTS | CompanyInputsSheetHandlerCreator | CompanyServicesSheetForm.pas:379 | Company |
| `capitolGeneral` | CAPITOLGENERAL | CapitolPoliticSheetHandlerCreator | CapitolSheet.pas:312 | Capitol |
| `CapitolTowns` | CAPITOLTOWNS | CapitolTownsHandlerCreator | CapitolTownsSheet.pas:377 | Capitol |
| `townGeneral` | TOWNGENERAL | TownHallPoliticSheetHandlerCreator | TownHallSheet.pas:388 | Town Hall |
| `townJobs` | TOWNJOBS | TownJobsSheetHandlerCreator | TownHallJobsSheet.pas:281 | Town Hall |
| `townRes` | TOWNRES | TownResSheetHandlerCreator | TownHallResSheet.pas:178 | Town Hall |
| `townProducts` | TOWNPRODUCTS | TownProdSheetHandlerCreator | TownProdSheet.pas:296 | Town Hall |
| `townServices` | TOWNSERVICES | TownParamSheetHandlerCreator | TownParamSheet.pas:318 | Town Hall |
| `townServices` | TOWNSERVICES | TownProdSheetHandlerCreator | TownProdxSheet.pas:294 | Town Hall (duplicate) |
| `townTaxes` | TOWNTAXES | TownTaxesSheetHandlerCreator | TownTaxesSheet.pas:560 | Town Hall |
| `townPolitics` | TOWNPOLITICS | TownHallPoliticSheetHandlerCreator | PoliticSheet.pas:242 | Town Hall |
| `Ministeries` | MINISTERIES | MinisteriesHandlerCreator | MinisteriesSheet.pas:406 | Government |
| `Ministeries` | MINISTERIES | MinisteriesHandlerCreator | TemplateSheet.pas:133 | Government (duplicate) |
| `facMinisteries` | FACMINISTERIES | MinisteriesHandlerCreator | xMinisteriesSheet.pas:158 | Facility-level govt |
| `unkGeneral` | UNKGENERAL | UnknownFacilitySheetHandlerCreator | UnkFacilitySheet.pas:330 | Fallback |

**Note on duplicates**: Registry uses `dupIgnore` — first registration wins when names collide.

## All 20 Tab Configurations (from CLASSES.BIN)

Extracted directly from `cache/BuildingClasses/CLASSES.BIN` — ground truth, not reconstructed.

### Config 1 — Fallback + Supplies (336 classes)

Construction frames + simple facilities with no specialized handler.

```
TabCount=2
TabName0=GENERAL    TabHandler0=unkGeneral
TabName1=SUPPLIES   TabHandler1=Supplies
```

IDs: 151, 171, 301–431, ... (336 entries — largest group, includes all construction-stage visual classes)

### Config 2 — Residential (183 classes)

All residential buildings (high/mid/low class, all clusters).

```
TabCount=3
TabName0=GENERAL       TabHandler0=ResGeneral
TabName1=MANAGEMENT    TabHandler1=facManagement
TabName2=HISTORY       TabHandler2=Chart
```

IDs: 1302–1303, 1312–1313, ... (183 entries — includes construction + complete variants)

### Config 3 — Industry / Factory (172 classes)

Full-featured production facilities with all tabs.

```
TabCount=7
TabName0=GENERAL    TabHandler0=IndGeneral
TabName1=PRODUCTS   TabHandler1=Products
TabName2=SUPPLIES   TabHandler2=Supplies
TabName3=SERVICES   TabHandler3=compInputs
TabName4=JOBS       TabHandler4=Workforce
TabName5=MANAGEMENT TabHandler5=facManagement
TabName6=HISTORY    TabHandler6=Chart
```

IDs: 1112–1113, 1122–1123, ... (172 entries — farms, factories, mines, all clusters)

### Config 4 — Service Facility (58 classes)

Stores, offices, and service buildings.

```
TabCount=6
TabName0=GENERAL    TabHandler0=SrvGeneral
TabName1=SUPPLIES   TabHandler1=Supplies
TabName2=SERVICES   TabHandler2=compInputs
TabName3=JOBS       TabHandler3=Workforce
TabName4=MANAGEMENT TabHandler4=facManagement
TabName5=HISTORY    TabHandler5=Chart
```

IDs: 1712, 1722, 1732, ... (58 entries)

### Config 5 — Simple Employment (28 classes)

Facilities with workforce but no production (public works, parks, etc.).

```
TabCount=3
TabName0=GENERAL       TabHandler0=unkGeneral
TabName1=JOBS          TabHandler1=Workforce
TabName2=MANAGEMENT    TabHandler2=facManagement
```

IDs: 1022, 1992, 2802–2852, ... (28 entries)

### Config 6 — HQ with Supplies (25 classes)

Headquarters buildings (general, industry, service, residential, public).

```
TabCount=5
TabName0=GENERAL    TabHandler0=HqGeneral
TabName1=SERVICES   TabHandler1=Supplies
TabName2=JOBS       TabHandler2=Workforce
TabName3=MANAGEMENT TabHandler3=facManagement
TabName4=HISTORY    TabHandler4=Chart
```

IDs: 602–606, 652–654, ... (25 entries — note: SERVICES tab name but Supplies handler)

### Config 7 — Cold Storage / Distribution (18 classes)

Facilities that distribute products (cold storage, distribution centers).

```
TabCount=5
TabName0=GENERAL    TabHandler0=IndGeneral
TabName1=CLIENTS    TabHandler1=Products
TabName2=SUPPLIES   TabHandler2=Supplies
TabName3=JOBS       TabHandler3=Workforce
TabName4=MANAGEMENT TabHandler4=facManagement
```

IDs: 302–304, 312–314, 322–324, ... (18 entries — note: CLIENTS tab name but Products handler)

### Config 8 — HQ with Company Inputs (10 classes)

Alternative HQ variant using compInputs instead of Supplies.

```
TabCount=5
TabName0=GENERAL    TabHandler0=HqGeneral
TabName1=SERVICES   TabHandler1=compInputs
TabName2=JOBS       TabHandler2=Workforce
TabName3=MANAGEMENT TabHandler3=facManagement
TabName4=HISTORY    TabHandler4=Chart
```

IDs: 1912, 1922, 1932, 1942, 2912, 2922, 2932, 2942, 3912, 4912

### Config 9 — Media / Advertising (8 classes)

Facilities with client connections and company services.

```
TabCount=6
TabName0=GENERAL    TabHandler0=IndGeneral
TabName1=CLIENTS    TabHandler1=Products
TabName2=SERVICES   TabHandler2=compInputs
TabName3=JOBS       TabHandler3=Workforce
TabName4=MANAGEMENT TabHandler4=facManagement
TabName5=HISTORY    TabHandler5=Chart
```

IDs: 1032, 1042, 2222, 2242, 3222, 3242, 4222, 4242

### Config 10 — Town Hall (4 classes)

One per cluster.

```
TabCount=6
TabName0=GENERAL       TabHandler0=townGeneral
TabName1=COMMERCE      TabHandler1=townServices
TabName2=TAXES         TabHandler2=townTaxes
TabName3=JOBS          TabHandler3=townJobs
TabName4=RESIDENTIALS  TabHandler4=townRes
TabName5=VOTES         TabHandler5=Votes
```

IDs: 1500, 2500, 3500, 4500

### Config 11 — Trade Center (4 classes)

Simple output-only buildings.

```
TabCount=2
TabName0=GENERAL    TabHandler0=unkGeneral
TabName1=PRODUCTS   TabHandler1=Products
```

IDs: 1510, 2510, 3510, 4510

### Config 12 — TV Station (4 classes)

Broadcasting facilities with antenna management.

```
TabCount=6
TabName0=GENERAL    TabHandler0=TVGeneral
TabName1=JOBS       TabHandler1=Workforce
TabName2=CLIENTS    TabHandler2=Products
TabName3=MANAGEMENT TabHandler3=facManagement
TabName4=ANTENNAS   TabHandler4=Antennas
TabName5=HISTORY    TabHandler5=Chart
```

IDs: 1982, 2982, 3882, 4982

### Config 13 — Minimal Fallback (4 classes)

No inspector tabs beyond basic info.

```
TabCount=1
TabName0=GENERAL    TabHandler0=unkGeneral
```

IDs: 6012, 6022, 6031, 6032

### Config 14 — Warehouse (2 classes)

Full warehouse with product distribution.

```
TabCount=5
TabName0=GENERAL    TabHandler0=WHGeneral
TabName1=CLIENTS    TabHandler1=Products
TabName2=SUPPLIES   TabHandler2=Supplies
TabName3=JOBS       TabHandler3=Workforce
TabName4=MANAGEMENT TabHandler4=facManagement
```

IDs: 532, 542

### Config 15 — Mausoleum (2 classes)

Monument buildings.

```
TabCount=1
TabName0=GENERAL    TabHandler0=Mausoleum
```

IDs: 8092, 8102

### Config 16 — Capitol (1 class)

National government building.

```
TabCount=7
TabName0=GENERAL       TabHandler0=capitolGeneral
TabName1=MINISTERIES   TabHandler1=Ministeries
TabName2=TOWNS         TabHandler2=CapitolTowns
TabName3=SERVICES      TabHandler3=townServices
TabName4=JOBS          TabHandler4=townJobs
TabName5=RESIDENTIALS  TabHandler5=townRes
TabName6=VOTES         TabHandler6=Votes
```

ID: 152

### Config 17 — Simple Workforce (1 class)

Single facility with only workforce tab.

```
TabCount=2
TabName0=GENERAL    TabHandler0=unkGeneral
TabName1=JOBS       TabHandler1=Workforce
```

ID: 172

### Config 18 — Special HQ (1 class)

HQ variant with both compInputs and Supplies (duplicate SERVICES tab name).

```
TabCount=5
TabName0=GENERAL    TabHandler0=HqGeneral
TabName1=SERVICES   TabHandler1=compInputs
TabName2=SERVICES   TabHandler2=Supplies
TabName3=MANAGEMENT TabHandler3=facManagement
TabName4=HISTORY    TabHandler4=Chart
```

ID: 1902

### Config 19 — Bank (1 class)

Banking facility.

```
TabCount=5
TabName0=GENERAL    TabHandler0=BankGeneral
TabName1=LOANS      TabHandler1=BankLoans
TabName2=JOBS       TabHandler2=Workforce
TabName3=MANAGEMENT TabHandler3=facManagement
TabName4=HISTORY    TabHandler4=Chart
```

ID: 2262

### Config 20 — Movie Studio (1 class)

Film production facility (most tabs of any building: 8).

```
TabCount=8
TabName0=GENERAL    TabHandler0=IndGeneral
TabName1=FILMS      TabHandler1=Films
TabName2=PRODUCTS   TabHandler2=Products
TabName3=SUPPLIES   TabHandler3=Supplies
TabName4=SERVICES   TabHandler4=compInputs
TabName5=JOBS       TabHandler5=Workforce
TabName6=MANAGEMENT TabHandler6=facManagement
TabName7=HISTORY    TabHandler7=Chart
```

ID: 5242

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total visual classes | 863 |
| Unique tab configurations | 20 |
| Unique handler names | 27 |
| Unique tab display names | 17 |
| Max tabs per facility | 8 (Movie Studio) |
| Min tabs per facility | 1 (Minimal/Mausoleum) |

### All Handler Names Used in CLASSES.BIN

`Antennas`, `BankGeneral`, `BankLoans`, `CapitolTowns`, `Chart`, `Films`, `HqGeneral`, `IndGeneral`, `Mausoleum`, `Ministeries`, `Products`, `ResGeneral`, `SrvGeneral`, `Supplies`, `TVGeneral`, `Votes`, `WHGeneral`, `Workforce`, `capitolGeneral`, `compInputs`, `facManagement`, `townGeneral`, `townJobs`, `townRes`, `townServices`, `townTaxes`, `unkGeneral`

### All Tab Display Names Used in CLASSES.BIN

`ANTENNAS`, `CLIENTS`, `COMMERCE`, `FILMS`, `GENERAL`, `HISTORY`, `JOBS`, `LOANS`, `MANAGEMENT`, `MINISTERIES`, `PRODUCTS`, `RESIDENTIALS`, `SERVICES`, `SUPPLIES`, `TAXES`, `TOWNS`, `VOTES`

**Not used in CLASSES.BIN** (registered in tabNamesMLS but no class uses them): `MAUSOLEUM` (as tab name — the handler exists), `PUBLICITY`, `RESEARCHES`, `WARES`

## Sheet Handler Data Fetching Pattern

All sheet handlers inherit from `TSheetHandler` (SheetHandlers.pas) and follow this lifecycle:

```
SetFocus()                              ← Tab becomes visible
  └→ Fork(threadedGetProperties)        ← Background thread
       ├→ Build TStringList of property names
       ├→ fContainer.GetProperties(Names) ← RDO call (blocks)
       └→ Join(threadedRenderProperties)  ← Back to main thread
            └→ RenderProperties(Props)    ← Update UI
```

### Data Access Layers

| Layer | Access Method | Use Case |
|-------|--------------|----------|
| **Session Cache** | `fContainer.GetProperties(nameList)` | Simple scalar properties (SecurityId, Cost, ROI) |
| **Cache Object Proxy** | `fContainer.CreateCacheObjectProxy` + `SetPath()` + `GetPropertyList()` | Array properties via path navigation (inputs/outputs) |
| **Sub-Object Properties** | `Proxy.GetSubObjectProps(index, nameList)` | Indexed children (connection 0, connection 1, ...) |
| **RDO Proxy (writes)** | `fContainer.GetMSProxy` + `BindTo(blockId)` | Method calls that modify state (SetPrice, Connect, etc.) |

### Security Check

Every handler checks ownership before enabling edit controls:

```
securityId = Properties.Values['SecurityId']
canEdit = GrantAccess(securityId)   ← compares to current tycoon
```

### Update Tracking

Stale data prevention via counter:

```
fLastUpdate++                        ← incremented on each SetFocus
threadStart: capture update = fLastUpdate
threadEnd:   if update != fLastUpdate → discard results (tab already changed)
```

## Per-Handler Property Reference

### IndGeneral (Industry General)

**Properties fetched**: `SecurityId`, `Trouble`, `CurrBlock`, `Role`, `Cost`, `ROI`, `TradeRole`, `TradeLevel`, `Years`

**RDO write methods**:
| Method | Params | Purpose |
|--------|--------|---------|
| `RDOConnectToTycoon` | (tycoonId, kind, true) | Sell to another tycoon |
| `RDODisconnectFromTycoon` | (tycoonId, kind, true) | Stop selling to tycoon |
| `RDOSetTradeLevel` | (level: 0\|2\|3) | 0=owner, 2=allies, 3=anyone |
| `RDOSetRole` | (roleId) | Distributor/exporter/importer |
| `RDODelFacility` | (x, y) | Demolish building |
| `Name :=` | (string) | Rename facility (property set) |
| `Stopped :=` | (bool) | Pause/resume facility |

**UI**: Facility name (editable), cost/ROI display, role dropdown, trade level dropdown, sell buttons, close/demolish buttons, age display.

### Products

**Structure**: Finger tabs — one sub-tab per output fluid/commodity.

**Initial properties**: `SecurityId`, `Trouble`, `CurrBlock`, `GateMap`

**Per-finger properties** (via Cache Object Proxy + SetPath):
| Property | Type | Description |
|----------|------|-------------|
| `MetaFluid` | string | Fluid type ID |
| `LastFluid` | number | Current stock amount |
| `FluidQuality` | number | Quality % |
| `PricePc` | number | Price as % of market |
| `AvgPrice` | number | Average selling price |
| `MarketPrice` | number | Current market price |
| `cnxCount` | integer | Number of buyer connections |

**Per-connection sub-properties** (via GetSubObjProperties):
| Property | Type | Description |
|----------|------|-------------|
| `cnxFacilityName{i}` | string | Buyer facility name |
| `cnxCompanyName{i}` | string | Buyer company name |
| `LastValueCnxInfo{i}` | number | Amount per cycle |
| `ConnectedCnxInfo{i}` | 0\|1 | Is connection active |
| `tCostCnxInfo{i}` | number | Transport cost |
| `cnxXPos{i}`, `cnxYPos{i}` | integer | Buyer map coordinates |

**RDO write methods**:
| Method | Params | Purpose |
|--------|--------|---------|
| `GetOutputNames` | (0, language) | List all output fluids |
| `RDOConnectOutput` | (fluidId, cnxList) | Add buyers |
| `RDODisconnectOutput` | (fluidId, cnxList) | Remove buyers |
| `RDOSetOutputPrice` | (fluidId, price) | Set output price |

**UI**: Tabs per output product, stock/quality display, price slider, buyer connection list with facility/company names and amounts.

### Supplies

**Structure**: Finger tabs — one sub-tab per input fluid/commodity.

**Initial properties**: `SecurityId`, `ObjectId`, `Trouble`, `TradeRole`, `CurrBlock`, `GateMap`

**Per-finger properties**:
| Property | Type | Description |
|----------|------|-------------|
| `MetaFluid` | string | Fluid type ID |
| `FluidValue` | number | Current stock amount |
| `LastCostPerc` | number | Last cost % |
| `minK` | number | Minimum quantity threshold |
| `MaxPrice` | number | Max acceptable price |
| `QPSorted` | 0\|1 | Sorting available |
| `SortMode` | integer | Sort by cost vs quality |
| `cnxCount` | integer | Number of supplier connections |
| `Selected` | 0\|1 | Auto-buy enabled |

**Per-connection sub-properties**:
| Property | Type | Description |
|----------|------|-------------|
| `cnxFacilityName{i}` | string | Supplier facility name |
| `cnxCreatedBy{i}` | string | Supplier company name |
| `cnxNfPrice{i}` | number | Negotiated price |
| `OverPriceCnxInfo{i}` | number | Overprice % |
| `LastValueCnxInfo{i}` | number | Amount per cycle |
| `tCostCnxInfo{i}` | number | Transport cost |
| `cnxQuality{i}` | number | Supply quality % |
| `ConnectedCnxInfo{i}` | 0\|1 | Is active |
| `cnxXPos{i}`, `cnxYPos{i}` | integer | Supplier coordinates |

**RDO write methods**:
| Method | Params | Purpose |
|--------|--------|---------|
| `GetInputNames` | (0, language) | List all input fluids |
| `RDOConnectInput` | (fluidId, cnxList) | Add suppliers |
| `RDODisconnectInput` | (fluidId, cnxList) | Remove suppliers |
| `RDOSetInputOverPrice` | (fluidId, index, overprice) | Adjust supplier price |
| `RDOSetInputMinK` | (fluidId, minK) | Set minimum quantity |
| `RDOSetInputMaxPrice` | (fluidId, maxPrice) | Set max acceptable price |
| `RDOSetInputSortMode` | (fluidId, mode) | Sort by cost or quality |
| `RDOSelSelected` | (bool) | Toggle auto-buy |

**UI**: Tabs per input supply, stock display, cost/min-K/max-price controls, auto-buy toggle, supplier list sortable by cost or quality.

### Workforce

**Properties fetched** (3 skill levels: 0=high, 1=mid, 2=low):
| Property | Description |
|----------|-------------|
| `CurrBlock` | Block ID for RDO calls |
| `SecurityId` | Ownership |
| `Salaries{0,1,2}` | Salary % for each level |
| `WorkForcePrice{0,1,2}` | Base wage cost |
| `SalaryValues{0,1,2}` | Formatted salary display |
| `Workers{0,1,2}` | Current workers / max jobs |
| `WorkersK{0,1,2}` | % of jobs filled |
| `WorkersMax{0,1,2}` | Max job capacity |
| `WorkersCap{0,1,2}` | Whether jobs exist (0=disabled) |
| `MinSalaries{0,1,2}` | Minimum salary floor |

**RDO write methods**:
| Method | Params | Purpose |
|--------|--------|---------|
| `RDOGetWorkers` | (levelIndex) | Fetch current worker count (timer-based) |
| `RDOSetSalaries` | (sal0, sal1, sal2) | Update all salaries at once |

**UI**: Three panels (high/mid/low skill), each showing worker count, fill %, salary slider. Timer refreshes worker counts every few seconds.

### facManagement (Management)

**Properties fetched**: `CurrBlock`, `SecurityId`, `UpgradeLevel`, `MaxUpgrade`, `Upgrading`, `Pending`, `NextUpgCost`, `CloneMenu{Lang}`

**RDO write methods**:
| Method | Params | Purpose |
|--------|--------|---------|
| `RDOAcceptCloning` | (get/set) | Enable/disable cloning |
| `RDOStartUpgrades` | (count) | Start N upgrades |
| `RDOStopUpgrade` | — | Cancel current upgrade |
| `RDODowngrade` | — | Downgrade facility |
| `CloneFacility` | (x, y, inTown, inComp) | Clone to other location |

**UI**: Clone toggle + options, upgrade level display, pending count, upgrade cost, upgrade/downgrade buttons.

### SrvGeneral (Service General)

Similar to IndGeneral but for service facilities (stores, offices). Uses same property set plus service-specific fields.

### ResGeneral (Residential)

**Properties**: Residential population, quality of life, rent levels, crime rates, pollution exposure.

### BankGeneral / BankLoans

**BankGeneral**: Bank overview, capital, interest rates.
**BankLoans**: Loan list with `LoanCount`, then per-loan: `Debtor`, `Interest`, `Amount`, `Term`.

### WHGeneral (Warehouse)

**Properties**: Stored goods inventory, capacity, throughput rates.

### TVGeneral / Films / Antennas

**TVGeneral**: Station overview, broadcast stats.
**Films**: Movie production status, `InProd`, `FilmDone`, `AutoProd`, `AutoRel`.
**Antennas**: Tower list with `antCount`, per-antenna: `antName`, `antTown`, `antViewers`, `antActive`, `antX`, `antY`.

### Town Hall tabs (townGeneral, townJobs, townRes, townServices, townTaxes, townPolitics)

Government facility tabs for town management:
- **townGeneral**: Mayor info, prestige, rating, population, QOL/QOS
- **townJobs**: Employment statistics per skill level
- **townRes**: Residential breakdown
- **townServices**: Service coverage metrics
- **townTaxes**: Tax configuration with `TaxCount` entries
- **townPolitics**: Election/voting system

### Capitol tabs (capitolGeneral, CapitolTowns, Ministeries, Votes)

National government:
- **capitolGeneral**: Ruler info, prestige, periods
- **CapitolTowns**: `TownCount` towns list with names, population, ratings
- **Ministeries**: `MinisterCount` ministers
- **Votes**: Election results, campaigns, `CampaignCount`

### unkGeneral (Unknown Facility)

Fallback handler for unrecognized facility types. Shows basic name, owner, cost info.

## Visual Class Data Storage

### Binary Format (classes.bin)

Source: `Class Packer/VisualClassManager.pas` — WebClient parser: `src/server/classes-bin-parser.ts`

```
[uint16: stringTableCount]
[string[]: stringTable]        ← CRLF-terminated, Windows-1252 encoded, deduplicated
[uint16: classCount]
[classes[]: visual classes]    ← each with sections → properties
```

Each visual class:
```
[uint16: ClassId]
[uint8:  sectionCount]
  For each section:
    [uint16: nameIndex]        ← index into string table = section name
    [uint8:  propertyCount]
      For each property:
        [uint16: valueIndex]   ← index into string table = "Key=Value" string
```

File location: `cache/BuildingClasses/CLASSES.BIN` (157,993 bytes, 1511 strings, 863 classes)

### Existing Parser

`src/server/classes-bin-parser.ts` already handles the binary format correctly. It extracts:
- `[General]` → size, name, facId, urban, accident, zone, selectable, buildOpts, animated, levelSign, etc.
- `[MapImages]` → imagePath (texture filename)
- `[Animations]` → animArea rect
- `[Sounds]` → sound entries with attenuation, priority, looping
- `[Effects]` → visual effects with position and flags

**Missing**: `[InspectorInfo]` extraction. The section loop (line ~304) needs an `else if (sectionName === 'InspectorInfo')` branch.

### Voyager Query Path (reference only)

```
ObjectInspectorHandleViewer.GetValue(section, name, type)
  → MasterURLHandler.HandleEvent(evnAnswerVisualClassData, item)
    → VisualClassesHandler.HandleEvent()
      → class = LocalCacheManager.ClassManager.ClassById[classId]
      → class.ReadString(section, name, default)
        → search fSections[] for matching section
        → return fProperties.Values[name]
```

Event ID: `evnAnswerVisualClassData = 7000`

## WebClient Implementation Guidance

### Step 1: Extend classes-bin-parser.ts

Add `[InspectorInfo]` extraction to the existing parser. Minimal changes needed:

```typescript
// Add to BuildingClassEntry interface:
inspectorTabs: { tabName: string; tabHandler: string }[];

// Add to section loop in parseClassesBin():
} else if (sectionName === 'InspectorInfo') {
  if (key === 'TabCount') tabCount = parseInt(value, 10) || 0;
  else if (key.startsWith('TabName')) inspectorTabNames.set(key, value);
  else if (key.startsWith('TabHandler')) inspectorTabHandlers.set(key, value);
}

// After section loop, reconstruct tab array:
const inspectorTabs = [];
for (let i = 0; i < tabCount; i++) {
  inspectorTabs.push({
    tabName: inspectorTabNames.get('TabName' + i) ?? '',
    tabHandler: inspectorTabHandlers.get('TabHandler' + i) ?? '',
  });
}
```

### Step 2: Expose via BuildingDataService

`src/server/building-data-service.ts` already loads all 863 classes. After parser extension, tab data flows through automatically:

```
CLASSES.BIN → parseClassesBin() → BuildingClassEntry.inspectorTabs
            → BuildingDataService.getBuilding(visualClass).inspectorTabs
            → serve to client via API or WebSocket
```

### Step 3: Handler Registry (client-side)

Map handler name → UI component. Each handler needs:
- Property list to fetch (see per-handler tables above)
- RDO write methods for editable fields
- UI template

### Step 4: Data Fetching

Use the existing WebSocket/RDO proxy infrastructure:
- `GetPropertyList` for scalar properties
- `SetPath` + `GetPropertyList` for navigating to inputs/outputs
- `GetSubObjectProps` for indexed sub-objects (connections)
- All via `spo_session.ts` RDO calls

### Step 5: Finger Tabs

Products and Supplies handlers need sub-tabs for each fluid. Use `GetOutputNames`/`GetInputNames` to discover fluids at runtime.

### Step 6: Security Gating

Check `SecurityId` against current tycoon before showing edit controls.

### What NOT to Implement

- Class Packer tool — build-time only, irrelevant to WebClient
- COM/OLE proxy infrastructure — replaced by WebSocket RDO
- `LocalCacheManager` class caching — `BuildingDataService` already handles this

## Cross-Reference

| Related Document | Content |
|-----------------|---------|
| [spo-original-reference.md](spo-original-reference.md) | Index of the Delphi source, per class, with File.pas:Line citations |
| [voyager-inspector-architecture.md](voyager-inspector-architecture.md) | Container lifecycle, xfer_* data binding, threading, the permission model in full |
| [civic-roles-reference.md](civic-roles-reference.md) | The 6 civic handlers (`townTaxes`, `townJobs`, `CapitolTowns`, `Ministeries`, `townRes`, `Votes`) and the verified tab configs for classes 152 / 1500 / 2500 / 3500 |
| [../src/mock-server/CLAUDE.md](../src/mock-server/CLAUDE.md) | Adding mock scenarios for new tab handlers |

---

## Per-Handler Control Semantics

### Permission variant per handler

Six variants, defined in full in
[voyager-inspector-architecture.md](voyager-inspector-architecture.md) §5.

| Handler | Variant | Gate |
|---|---|---|
| IndGeneral, SrvGeneral, ResGeneral, HqGeneral, WHGeneral, TVGeneral, Products, Supplies, Workforce, facManagement, Films, Votes | Standard | `GrantAccess(clientSecId, SecurityId)` |
| townJobs, Ads | ExtraSecurityId fallback | `ExtraSecurityId` first, else `SecurityId` |
| CapitolTowns, Ministeries | Dual | `GrantAccess(...)` **OR** `ActualRuler = getUserName()` |
| Mausoleum | Username comparison | `OwnerName = getUserName()` — no `GrantAccess` at all |
| capitolGeneral, townGeneral, BankLoans, Antennas, unkGeneral, Chart, townServices, townProducts | Read-only | no check; every control is display-only |
| BankGeneral (loan UI only) | **Inverted** | `NOT fOwnsFacility` — you borrow from someone *else's* bank |
| townRes | [UNKNOWN] | never fully read |

`SecurityId` is a hyphen-delimited list and the check is a substring test; the server enforces
independently and **silently**.

### Enabled conditions per handler

| Handler | Control | Enabled when |
|---|---|---|
| IndGeneral | `xfer_Name`, `btnClose`, `btnDemolish`, `cbMode`, `cbTrade` | `fOwnsFacility` |
| IndGeneral | `btnSellToWareHouses` | `fOwnsFacility AND role != Warehouse` |
| IndGeneral | `btnConnect`, `btnSellToStores`, `btnSellToFacs` | always |
| SrvGeneral | `btnClose`, `btnDemolish`, price slider | `fOwnsFacility` |
| SrvGeneral | `btnConnect` | always |
| ResGeneral | `xfer_Name`, `xfer_Rent`, `xfer_Maintenance`, `btnClose`, `btnDemolish`, `btnRepair` | `fOwnsFacility` |
| HqGeneral | `xfer_Name`, `btnClose`, `btnDemolish` | `fOwnsFacility` |
| HqGeneral | `btnConnect` | always |
| BankGeneral | `btnClose`, `btnDemolish`, `peInterest`, `peTerm`, `peBankBudget` | `fOwnsFacility` (owner) |
| BankGeneral | `fbRequest`, `eBorrow` | **`NOT fOwnsFacility`** (visitor) |
| WHGeneral | `clbNames` items, `btnClose`, `btnDemolish` | `fOwnsFacility` |
| TVGeneral | `peHoursOnAir`, `peAdvertisement`, `btnClose`, `btnDemolish` | `fOwnsFacility` |
| Products | `PricePc` slider, `btnHireSuppliers`, `btnDelete` | `fOwnsFac` |
| Supplies | `xfer_minK`, `xfer_MaxPrice`, `btnHireSuppliers`, `btnModify` | `fOwnsFac` |
| Supplies | `cbAlmBuy` (buy checkbox) | `role IN (2,5,6) AND fOwnsFac` |
| compInputs | `peDemand.Visible` | `cEditable{i} != ''` — **hidden**, not merely disabled |
| compInputs | `peDemand.Enabled` | `cEditable{i} != '' AND fOwnsFacility` |
| Workforce | `xfer_Salaries{n}.Visible` | `WorkersCap{n} != '' AND != '0'` |
| Workforce | `xfer_Salaries{n}.Enabled` | `fOwnsFacility` |
| facManagement | `cbAcceptSettings`, `cblSettings`, `btnClone` | `fOwnsFacility` |
| facManagement | `fbUpgrade` | `fOwnsFacility AND maxUpgrades > 0 AND upgradeCost > 0` |
| facManagement | `fbDowngrade` | `fOwnsFacility AND upgradeLevel > 1` |
| Films | `xfer_FilmName`, `btnLaunch`, `cbAutoRelease`, `xfer_FilmBudget`, `xfer_FilmTime` | `fOwnsFacility AND NOT inProd` |
| Films | `btnReleaseFilm` | `fOwnsFacility AND FilmDone = 'YES'` |
| Films | `btnCancelFilm` | `fOwnsFacility AND inProd` |
| Films | `cbAutoProduction` | `fOwnsFacility` |
| Mausoleum | `btnSetWords` | `fOwnFac` |
| Mausoleum | `eWordsOfWisdom.ReadOnly` | `NOT fOwnFac` |
| Mausoleum | `btnCancel` | `fOwnFac AND Transcended != '1'` |
| Votes | the vote button | **always** — `fOwnsFacility` is computed but never used to gate it |
| CapitolTowns | `pnTax` | `fHasAccess` (shown/hidden) |
| Ministeries | `pnBudgetEdit` | `fHasAccess` (shown/hidden) |
| Ministeries | `edBudget`, `btnSetBudget`, `btnDepose` | a list selection plus valid data |
| townJobs | `xfer_hiMinSalary`, `xfer_midMinSalary`, `xfer_loMinSalary` | `fOwnsFacility` |
| townTaxes | every tax editing control | `fOwnsFacility` — non-owners see an empty page |

### UI enumerations

Wire values on the left, what the tab shows on the right.

**Facility role** (`TradeRole` / `Role`) — `IndustryGeneralSheet.pas:130-131`:

| Value | Name | Combo index |
|---|---|---|
| 0 | `rolNeutral` | — |
| 1 | `rolProducer` | — |
| 2 | `rolDistributer` | 0 |
| 3 | `rolBuyer` | — |
| 4 | `rolImporter` | — |
| 5 | `rolCompExport` | 1 |
| 6 | `rolCompInport` | 2 |

**Trade level** (`TradeLevel`):

| Combo index | Wire value | Meaning |
|---|---|---|
| 0 | 0 | same owner |
| 1 | 2 | allies |
| 2 | 3 | anyone |

**Loan request result** (`TBankRequestResult`, `BankGeneralSheet.pas:22`):

| Value | Meaning |
|---|---|
| 0 | `brqApproved` |
| 1 | `brqRejected` |
| 2 | `brqNotEnoughFunds` |
| 3 | `brqError` |

**Film auto-flags** — a bitmask packed into one wire argument:

| Bit | Meaning |
|---|---|
| 0 (`$01`) | auto-release checkbox |
| 1 (`$02`) | auto-production checkbox |

The older two-boolean signature is commented out in the Delphi source; there is no separate
`RDOAutoRelease` member.

**Trouble bitmask** — `facStoppedByTycoon = $04` (`Protocol.pas:119`). A set bit flips the
Close button's caption to Reopen.

**Encodings that are not obvious:**

| Where | Encoding |
|---|---|
| Mausoleum words of wisdom | a pipe character separates paragraphs (`EncodeParagraph` / `DecodeParagraph`) |
| `CloneMenu{lang}` | pipe-delimited `Name`/`bitmask` pairs — live: `Salaries`, 256, `Price`, 65536, `Suppliers`, 4, `Ads`, 131072 |
| Service and output prices | an **integer percentage of market price**; the money value is `MarketPrice * Price / 100` |
| `Tax{i}Percent` | may be negative — a negative percent is a **subsidy** |
| Company input demand | a slider percent; real demand is `(perc / 100) * cInputMax{i}` |
| `GateMap` | one character per gate position; `'0'` hides that finger tab |

### Handlers registered but absent from CLASSES.BIN

| Handler | Source | Status |
|---|---|---|
| `hdqInventions` | `InventionsSheet.pas` | **live** — loaded at runtime by `HqGeneral`'s `fbResearches` button (`HqMainSheet.pas:338-366`), not from a tab config. See [research-system-reference.md](research-system-reference.md) |
| `Ads` | `AdvSheetForm.pas` | registered but referenced by no visual class; advertisement is served through `compInputs` instead |
| `InputSelection` | `InputSelectionForm.pas` | likely dead code |
| `townPolitics` | `PoliticSheet.pas` | likely dead code |
| `facMinisteries` | `xMinisteriesSheet.pas` | likely dead code |

### The SERVICES tab name is reused by two different handlers

`TabName=SERVICES` appears with **two** handlers, and they share nothing:

| Handler | Fetch shape | WebClient group |
|---|---|---|
| `compInputs` | `cInputCount` plus indexed `cInput{i}.*` | `ADVERTISEMENT_GROUP` |
| `Supplies` (Config 6 HQ only) | `GetInputNames` then `SetPath` then per-gate `GetPropertyList` | `SUPPLIES_GROUP` |

### A gate group is not a property group — and never rides in `groups`

Three tabs are **gate-backed**: `supplies`, `products`, `compInputs` (plus `ads` and
`advertisement`, whose ids differ but whose `special` marker is one of those three). Their
content is a list of gates, each one a sub-object read on demand — `REQ_BUILDING_TAB_DATA`,
then `getBuildingGateConnections` per gate. Nothing about them comes from the building's
property bag.

Their `properties` array describes a **gate's** columns, not the building's, and that is a
trap: `SUPPLIES_GROUP` declares `ObjectId` meaning *the gate's* object id, while `ObjectId`
is also a **header property** (`HEADER_PROPERTY_NAMES`) read for every building. So the
opening read had a value for the name, `fetchPropertiesAndGroups` published
`groups['supplies'] = [{ name: 'ObjectId', value: <the BUILDING's id> }]` — a wrong value
under a right-looking name — and the client read the mere *presence* of that key as "this
gate is already loaded". `REQ_BUILDING_TAB_DATA` was never sent and the Supplies tab said
**"No supply inputs" on every building** (fixed 2026-08-23).

The rule now holds on both sides of the socket, from one list —
`isGateTab` / `GATE_TAB_IDS` in `shared/building-details/property-definitions.ts`:

- the gateway **skips gate groups** when it builds `groups` (`building-details-handler.ts`);
- the client **never settles a gate's load state from a group key** (`building-store.ts`);
  only the gate data itself (`details.supplies` / `products` / `compInputs`) does that.

`products` and `compInputs` were structurally exposed to the same collision but declare no
header name, so only `supplies` — and `ads`, which shares its key — ever broke.

### Embedded ASP URLs

Kept for the parameter shapes. The two News rows are **reproduced by the WebClient** — the
gateway scrapes those pages and `NewspaperModal` draws the result; the others are not, and no
ASP page is embedded anywhere in the client.

| Handler | URL |
|---|---|
| capitolGeneral | `{WorldURL}/Visual/Voyager/Politics/politics.asp?WorldName=&TycoonName=&Password=&Capitol=YES&X=&Y=&DAAddr=&DAPort=` |
| townGeneral | the same page with `&TownName=` instead of `Capitol=YES` |
| townGeneral | `{WorldURL}/Visual/News/boardreader.asp?...&PaperName=` (rate mayor) — WebClient: the board view of `NewspaperModal` |
| townGeneral | `{WorldURL}/Visual/News/newsreader.asp?...&PaperName=` (read news) — WebClient: the paper view of `NewspaperModal` (#516) |
| Antennas | double-click navigates the map: `?frame_Id=MapIsoView&frame_Action=MoveTo&x=&y=` |
| IndGeneral | `{WorldURL}/Visual/Clusters/WebLoader.asp?Page=Home&x=&y=&WorldName=&DAAddr=&DAPort=&frame_Id=FacilitySiteView&frame_Class=HTMLView&frame_NoBorder=Yes&frame_Align=client`, plus `&Access=MODIFY` when the viewer owns the facility |
| every facility | `{WorldURL}/Visual/Voyager/IsoMap/FacilityImage.asp?ClassId=&WorldName=&xPos=&yPos=` |

### Handler index

| Handler | Section | Permission | Has wire mutations | WebClient group |
|---|---|---|---|---|
| Ads | core data | ExtraSecId fallback | yes | `ADS_GROUP` |
| Antennas | specialized | read-only | no | `ANTENNAS_GROUP` |
| BankGeneral | general | standard + inverted | yes | `BANK_GENERAL_GROUP` |
| BankLoans | specialized | read-only | no | `BANK_LOANS_GROUP` |
| capitolGeneral | general | read-only | no | `CAPITOL_GENERAL_GROUP` |
| CapitolTowns | specialized | dual | yes | `CAPITOL_TOWNS_GROUP` |
| Chart | core data | read-only | no | `FINANCES_GROUP` |
| compInputs | core data | standard | yes | `ADVERTISEMENT_GROUP` |
| facManagement | core data | standard | yes | `UPGRADE_GROUP` |
| Films | specialized | standard | yes | `FILMS_GROUP` |
| hdqInventions | not in BIN | standard | yes | — |
| HqGeneral | general | standard | yes | `HQ_GENERAL_GROUP` |
| IndGeneral | general | standard | yes | `IND_GENERAL_GROUP` |
| Mausoleum | specialized | username comparison | yes | `MAUSOLEUM_GROUP` |
| Ministeries | specialized | dual | yes | `MINISTERIES_GROUP` |
| Products | core data | standard | yes | `PRODUCTS_GROUP` |
| ResGeneral | general | standard | yes | `RES_GENERAL_GROUP` |
| SrvGeneral | general | standard | yes | `SRV_GENERAL_GROUP` |
| Supplies | core data | standard | yes | `SUPPLIES_GROUP` |
| townGeneral | general | read-only | no | `TOWN_GENERAL_GROUP` |
| townJobs | town hall | ExtraSecId fallback | yes | `TOWN_JOBS_GROUP` |
| townProducts | town hall | read-only | no | `TOWN_PRODUCTS_GROUP` |
| townRes | town hall | [UNKNOWN] | [UNKNOWN] | `TOWN_RES_GROUP` |
| townServices | town hall | read-only | no | `TOWN_SERVICES_GROUP` |
| townTaxes | town hall | standard | yes | `TOWN_TAXES_GROUP` |
| TVGeneral | general | standard | yes | `TV_GENERAL_GROUP` |
| unkGeneral | general | read-only | no | `UNK_GENERAL_GROUP` |
| Votes | specialized | standard, **not used to gate** | yes | `VOTES_GROUP` |
| WHGeneral | general | standard | yes | `WH_GENERAL_GROUP` |
| Workforce | core data | standard | yes | `WORKFORCE_GROUP` |
