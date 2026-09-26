# Research / Inventions System — Architecture Reference

> **Delphi source:** `SPO-Original/Kernel/ResearchCenter.pas`, `Kernel/Headquarters.pas`, `Inventions/Inventions.pas`, `Voyager/InventionsSheet.pas`
> **Generated:** 2026-02-28 by delphi-archaeologist skill
> **Evidence confidence:** HIGH — all claims verified against Delphi source

## Overview

The Research system (internally called "Inventions") allows players to research technologies through their **Headquarters (HQ)** buildings. Each HQ specializes in a specific `InventionKind` (research category). Inventions are organized in a tree structure with prerequisites, cost money and time, and once completed unlock new building types or improve existing facility performance.

The Voyager client opens the research UI as a **modal dialog** from the HQ building inspector's "Research..." button.

## Class Hierarchy

```
TMetaWorkCenter
  └── TMetaResearchCenter          (ResearchCenter.pas:17)
       └── TMetaHeadquarterBlock   (Headquarters.pas:9)
            ├── TMetaMainHeadquarter       (Headquarters.pas:24)
            ├── TMetaAreaHeadQuarter        (Headquarters.pas:43)
            └── TMetaPublicAffairsHeadquarter (Headquarters.pas:58)

TFinanciatedWorkCenter
  └── TResearchCenter              (ResearchCenter.pas:57)
       └── THeadquarterBlock       (Headquarters.pas:18)
            ├── TMainHeadquarter          — Ads + LegalServ + CompServ inputs
            ├── TAreaHeadquarter          — CompServ + LegalServ inputs
            └── TPublicAffairsHeadquarter — Ads + prestige boost
```

Every HQ type **IS** a Research Center. `TMetaResearchCenter` is created with an `InventionKind` string and holds a collection of `TInvention` objects registered to it via `RegisterInvention()`.

## Invention Data Model (Inventions.pas:91)

Each invention loaded from XML has:

| Field | Type | Purpose | Source |
|-------|------|---------|--------|
| `fId` | `string` | Unique string identifier (e.g., `"GreenTech.Level1"`) | Inventions.pas:98 |
| `fNumId` | `integer` | Runtime numeric ID for bitset tracking (assigned sequentially at load) | :100 |
| `fName` | `string` | Display name (MLS-supported via `fName_MLS`) | :101 |
| `fKind` | `string` | InventionKind category string (e.g., `'Farming'`) | :102 |
| `fDesc` | `string` | Description text (MLS-supported via `fDesc_MLS`) | :103 |
| `fParent` | `string` | Parent category for tree grouping in UI (MLS-supported) | :104 |
| `fPrice` | `TMoney` | Research cost in money | :109 |
| `fTime` | `integer` | Research time in simulation hours. **0 = instant research** | :110 |
| `fBasic` | `boolean` | If true, auto-queued when HQ is first built | :111 |
| `fPrestige` | `integer` | Prestige points awarded on completion | :112 |
| `fTier` | `integer` | Required tycoon level tier (0=Apprentice..5=Legend) | :115 |
| `fLicLevel` | `single` | License level requirement (causes recurring cost; makes volatile) | :119 |
| `fVolatile` | `boolean` | If true, can be sold back (retired) | :120 |
| `fCache` | `boolean` | Whether pre-cached in client-side `.dat` file | :121 |
| `fEnablesTech` | `boolean` | Enables a technology (unlocks building types) | :122 |
| `fNobility` | `integer` | Required nobility points | :123 |
| `fCatPos` | `integer` | Category tab position (0..10 for multi-tab display) | :124 |
| `fObsolete` | `boolean` | Deprecated invention (not linked to blocks) | :125 |
| `fReq` | `TCollection` | Prerequisite inventions (must all be researched first) | :117 |
| `fLevel` | `integer` | Level points (contributes to company research level) | :114 |

### TInventionRecord (Company's completed invention record, Inventions.pas:182)

| Field | Type | Purpose |
|-------|------|---------|
| `fInvention` | `TInvention` | Reference to the invention definition |
| `fTotalCost` | `TMoney` | Total cost paid (research price + licence fee) |
| `fSubsidy` | `TMoney` | Any subsidies received |
| `fUsage` | `integer` | Number of facilities currently using this invention |

### Cost Formulas (Inventions.pas:843-858)

```
Per-facility hourly implementation cost:
  HourlyCostPerFac = (0.5/100) × Price / (365×24)

Total hourly cost:
  HourlyCost = Usage × HourlyCostPerFac

Yearly cost:
  YearCost = (0.5/100) × Price

License fee:
  FeePrice = 1,000,000 × 2^(TycoonLicenceLevel + InventionLicLevel - 1)
  (only if LicLevel > 0)
```

## Invention Kind Constants (Standards.pas:24-80)

Each HQ type specializes in one `InventionKind`. Inventions are grouped by kind.

**Direction (Main HQ):** `'Direction'`

**Basic Facilities (Area HQs):**
- `'Farming'`, `'Industries'`, `'Residentials'`, `'ServiceFacilities'`, `'PublicFacilities'`, `'BusinessFacilities'`

**Business:**
- `'TV'`, `'Software'`, `'LegalServices'`, `'Offices'`, `'Banking'`

**Fancy:** `'Monuments'`

**Large Industries (20 kinds):**
- `'LargeFarms'`, `'LargeChemical'`, `'LargeMines'`, `'LargeChemMines'`, `'LargeSiliconMines'`, `'LargeStoneMines'`, `'LargeCoalMines'`, `'Plastics'`, `'LargeFoodProc'`, `'LargeTextile'`, `'LargeClothes'`, `'LargeElectComp'`, `'LargeMetallurgy'`, `'Construction'`, `'HeavyIndustry'`, `'Cars'`, `'LargeHHA'`, `'BMIndustry'`, `'Paper'`, `'Printing'`, `'CD'`

**Commerce:**
- `'Supermarkets'`, `'Bars'`, `'Restaurants'`, `'Movies'`, `'Funerals'`

**Other:** `'Agencies'`, `'MovieStudios'`

## Research States

Inventions for a given HQ exist in exactly one of three states:

| State | Server Storage | Cache Prefix | UI Section |
|-------|---------------|-------------|------------|
| **Available** | Not in queue, not completed | `avl{cat}Rs...` | TreeView — Available |
| **In Development** | `fCurrResearch` or `fDevResearches` queue | `dev{cat}Rs...` | ListView — Researching |
| **Completed** | `Company.HasInvention[NumId]` bitset | `has{cat}Rs...` | TreeView — Developed |

### Enabled vs Disabled (Available state)

An available invention is **enabled** (can be queued) when ALL of:
1. Tycoon tier matches: `Owner.Level.Tier >= Invention.GetTierOf(Company)` [Inventions.pas:664]
2. Nobility points sufficient: `Tycoon.NobPoints >= Invention.Nobility` [Inventions.pas:674]
3. All prerequisites completed: every invention in `fReq` is in the company's `HasInvention` set [Inventions.pas:690]

Disabled inventions appear greyed out (icon index 0) in the UI but are still visible.

## RDO Methods (ResearchCenter.pas:73-78)

Published on `TResearchCenter`, bound via `BindTo(blockObjectId)`:

| Method | Kind | Signature | Return | Line | Notes |
|--------|------|-----------|--------|------|-------|
| `RDOQueueResearch` | procedure | `(%inventionId, #priority)` | void (`*`) | :73 | Priority=10 from UI. Validates: auth, not already queued, not completed, enabled, prereqs met |
| `RDOCancelResearch` | procedure | `(%inventionId)` | void (`*`) | :74 | Works for: queued (removes from queue), active (partial refund), **or completed** (sells/retires) |
| `RDOGetInvProps` | function | `(%inventionId)` | `%string` | :75 | Returns formatted properties in owner's language |
| `RDOGetInvPropsByLang` | function | `(%inventionId, %lang)` | `%string` | :76 | Properties in specified language |
| `RDOGetInvDesc` | function | `(%inventionId)` | `%string` | :77 | Description + prerequisites list in default language |
| `RDOGetInvDescEx` | function | `(%inventionId, %langId)` | `%string` | :78 | Description in specified language |

### Wire Protocol (from InventionsSheet.pas:610-648)

```
// Queue research (void procedure — push separator):
sel #<blockObjectId>
call RDOQueueResearch * %<inventionId> #<priority>

// Cancel/sell research:
sel #<blockObjectId>
call RDOCancelResearch * %<inventionId>

// Get properties (function — call separator):
sel #<blockObjectId>
call RDOGetInvPropsByLang ^ %<inventionId> %<langId>
← res="%<properties text>"

// Get description:
sel #<blockObjectId>
call RDOGetInvDescEx ^ %<inventionId> %<langId>
← res="%<description text>"
```

**CRITICAL**: `RDOQueueResearch` and `RDOCancelResearch` are declared `procedure`
(`Kernel/ResearchCenter.pas:73-74`), so their separator is `"*"` — and it is `"*"` because of the
declaration, not because of what the call site wants. Both QueryId-bearing (`A<id> ;` ack) and
QueryId-less (silent) forms are legal for a procedure; the Voyager client uses the first.

## Cache Properties (StoreToCache, ResearchCenter.pas:770-828)

The server writes these properties to the object cache for client consumption:

### Top-level

| Property | Type | Purpose |
|----------|------|---------|
| `RsKind` | string | InventionKind string (e.g., `'Direction'`) |
| `CatCount` | integer | Maximum category tab index (0..10) |

### Per category tab (cat = 0..CatCount)

| Property | Type | Purpose |
|----------|------|---------|
| `avlCount{cat}` | integer | Count of available inventions in this category |
| `devCount{cat}` | integer | Count of developing/queued inventions |
| `hasCount{cat}` | integer | Count of completed inventions |

### Per invention item (written by Invention.StoreToCache, Inventions.pas:750)

Format: `{prefix}{cat}Rs{field}{index}` where prefix = `avl`|`dev`|`has`

| Property | State | Type | Purpose |
|----------|-------|------|---------|
| `{prefix}{cat}RsId{idx}` | all | string | Invention ID |
| `{prefix}{cat}RsName{idx}` | volatile only | string | Display name (only written for volatile inventions) |
| `{prefix}{cat}RsDyn{idx}` | volatile only | `'yes'` | Indicates dynamic/volatile |
| `{prefix}{cat}RsParent{idx}` | volatile only | string | Parent category name |
| `avl{cat}RsEnabled{idx}` | available only | boolean (`'1'`/`'0'` via `WriteBoolean`) | `'1'` if prerequisites met + tier met |
| `has{cat}RsCost{idx}` | completed only | string | Formatted cost (TotalCost - Subsidy) |

### Example Cache

Single-category HQ with 2 available, 1 developing, 1 completed:

```
RsKind=Direction
CatCount=0
avlCount0=2
devCount0=1
hasCount0=1
avl0RsId0=Dir.Marketing    avl0RsEnabled0=1
avl0RsId1=Dir.Finance      avl0RsEnabled1=0       (prereq not met)
dev0RsId0=Dir.Research
has0RsId0=Dir.Basic        has0RsCost0=$5,000,000
```

## Research Properties Text (GetProperties, Inventions.pas:709-748)

`RDOGetInvPropsByLang` returns a multi-line text string with these fields:

```
Price: $10,000,000          — if Price > 0
Licence: $2,000,000         — if LicLevel > 0
Implementation Cost/h: $15  — if completed + implementable (hourly cost across all facilities)
Usage: 5 facilities         — if completed
Impl. Cost/Year: $50,000    — if not yet completed + implementable (projected yearly cost)
Prestige: +10               — if Prestige ≠ 0
Level: Entrepreneur         — tycoon level name for the required tier
Nobility: 500               — if Nobility > 0
```

## Description Text (GetFullDesc, Inventions.pas:766-781)

`RDOGetInvDescEx` returns:

```
<invention description text>
Requires: Prerequisite A, Prerequisite B.
```

The "Requires:" line is only appended if the invention has prerequisites (`fReq.Count > 0`).

## Research Process Flow

### 1. Queue Research (QueueResearch, ResearchCenter.pas:314-339)

```
Validation:
  1. Invention exists in this HQ's registered set
  2. Not already queued or active (CanResearch check)
  3. Not already completed (Company.HasInvention)
  4. Enabled (tier + nobility + prerequisites)

If Invention.Time > 0:
  → Insert into priority queue (fDevResearches)
  → If no active research, StartResearch()

If Invention.Time = 0 (instant):
  → Check budget >= Price + FeePrice
  → Charge Price immediately
  → DeclareInvention (complete immediately)
```

### 2. Start Research (StartResearch, ResearchCenter.pas:219-266)

```
Pop next from priority queue
If Enabled:
  Check budget >= Price + FeePrice
  If insufficient:
    → Send "No Money for Research" email to tycoon
    → Set fCurrResearch = nil (skip this one)
  Else:
    → Set fCurrResearch, reset fProgress = 0
Else:
  → Recursive call: skip to next in queue
```

### 3. Evaluate (each simulation tick, ResearchCenter.pas:497-648)

```
1. Compute workforce capacity:
   capacity = avg(Workers[kind].Q / WorkersMax[kind].Q) across all people kinds

2. Apply time dilation:
   dtCorrection = min(5, 24/hoursADay)

3. Cap by company direction support:
   capacity = dtCorrection × min(capacity, fDirCoverage/100)

4. Advance progress:
   fProgress += capacity × dt

5. Charge cost proportionally:
   ToPay = Price × capacity × dt / Time
   BlockGenMoney(-ToPay)

6. Check completion:
   if fProgress >= Invention.Time:
     Refund overpayment: BlockGenMoney(Price × extraProgress / Time)
     Company.DeclareInvention(invention)
     StartResearch()  // move to next in queue
```

### 4. Cancel/Sell Research (CancelResearch, ResearchCenter.pas:341-380)

Three cases based on invention state:

| State | Action | Refund |
|-------|--------|--------|
| Active (fCurrResearch) | Stop research, start next in queue | `(fProgress/100) × Price` |
| Queued (in fDevResearches) | Remove from queue | None (nothing paid yet) |
| Completed (HasInvention) | `RetireInvention()` — recursive cascade removes dependent inventions too | `TotalCost - Subsidy` (via existing record) |

### 5. Auto-Research on HQ Construction (Headquarters.pas:97-111)

When a new HQ is first built (`AutoConnect, loaded=false`):

```
for each registered invention where Basic=true AND not already researched AND Enabled:
  ResearchInvention(invention, priority=0)
```

## Company Direction System (Kernel.pas)

Each InventionKind maps to a `TCompanyDirection` on the company:

| Field | Type | Purpose |
|-------|------|---------|
| `fId` | string | = InventionKind |
| `fStrength` | single | Accumulated from HQ worker calculations |
| `fDemand` | single | Total research demand |
| `fSupport` | single | Strength / Demand ratio (caps research speed) |
| `fCount` | integer | Number of facilities using this direction |

`fDirCoverage = round(100 × CompanyDirection.Support)` — this caps how fast research progresses. If direction support < 100%, research runs slower.

**Upgrade cost scaling** (ResearchCenter.pas:650-666):
- `UpgradeCost = sqr(sqr(UpgradeLevel)) × baseCost`
- Upgrades blocked if direction support >= 1.5 (oversupported)

## Research Time Constants (DissidentConst.pas)

```
tmeInvention_VeryShort = 7    hours
tmeInvention_Short     = 20   hours
tmeInvention_Normal    = 33   hours
tmeInvention_Long      = 60   hours
tmeInvention_VeryLong  = 80   hours
```

## Client UI Architecture (Voyager)

### HQ Main Sheet (HqMainSheet.pas)

- Registered as `'HqGeneral'` handler
- Has a **"Research..."** button (`fbResearches`)
- On click: creates/gets `'hdqInventions'` sheet handler, shows it as **modal dialog**

### Inventions Sheet (InventionsSheet.pas)

- Registered as `'hdqInventions'` handler
- **Two versions exist**: `Voyager.1/` (flat, no category tabs) and `Voyager/` (with `TPDTabControl` for category tabs)
- The newer version (Voyager/) has tabbed categories loaded from `research.{lang}.dat`

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│ [Tab1] [Tab2] [Tab3] ...          (TPDTabControl)   │
├─────────────────────────────────────────────────────┤
│ FingerTabs: [AVAILABLE] [RESEARCHING] [DEVELOPED]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  AVAILABLE page:                                    │
│  ┌─────────────────────────────────┐               │
│  │ TreeView (tvAvailInventions)    │               │
│  │  ├── Agriculture                │               │
│  │  │    ├── Green Farming  ✓      │ ← enabled     │
│  │  │    └── Organic Tech   ✗      │ ← disabled    │
│  │  └── Manufacturing              │               │
│  │       └── Better Tools  ✓       │               │
│  └─────────────────────────────────┘               │
│  Description: [lbAvlDesc]                           │
│  Properties:  [lbAvlProps]  (UPPERCASE)             │
│  [Research]  button                                 │
│                                                     │
│  RESEARCHING page:                                  │
│  ┌─────────────────────────────────┐               │
│  │ ListView (lvSchedInvention)     │               │
│  │  ● Green Farming                │               │
│  │  ● Better Tools                 │               │
│  └─────────────────────────────────┘               │
│  Description: [lbSchDesc]                           │
│  Properties:  [lbSchProps]                          │
│  [Stop]  button                                     │
│                                                     │
│  DEVELOPED page:                                    │
│  ┌─────────────────────────────────┐               │
│  │ TreeView (tvAlrDevInventions)   │               │
│  │  ├── Agriculture                │               │
│  │  │    └── Basic Farming         │               │
│  │  └── Manufacturing              │               │
│  │       └── Simple Tools          │               │
│  └─────────────────────────────────┘               │
│  Description: [lbDevDesc]                           │
│  Properties:  [lbDevProps]                          │
│  [Sell]  button                                     │
│                                                     │
│ [Close]                                             │
└─────────────────────────────────────────────────────┘
```

### Icon States

| Icon Index | Constant | Meaning |
|-----------|----------|---------|
| 0 | `isDissabled` | Greyed out — prerequisites not met |
| 1 | `isEnabled` | Available — can be researched |
| 2 | `isResearching` | Currently in research queue |

### Tree Node Structure

- Inventions with no `fParent` → root nodes
- Inventions with `fParent` → grouped under a parent category node (e.g., "Agriculture", "Manufacturing")
- Parent nodes are auto-created when first needed

### Data Loading Flow

1. **On dialog open**: reads `Inventions/research.{lang}.dat` binary file for pre-cached invention metadata (id, name, category, description, parent, properties, cache flag)
2. **Tab names** come from the `.dat` file footer (string list of category tab labels)
3. **Per-tab loading**: When a tab is selected, requests cache properties from server: `hasCount{tab}`, `devCount{tab}`, `avlCount{tab}`, then fetches per-item properties in a second pass
4. **Lazy detail fetch**: When an invention is selected, if not cached, calls `RDOGetInvPropsByLang` + `RDOGetInvDescEx` via background thread

### User Actions

| Action | Button | Condition | What Happens |
|--------|--------|-----------|-------------|
| Research | `btnResearch` | Selected node is enabled + user owns facility | Calls `RDOQueueResearch(inventionId, 10)`. Moves item from Available tree to Researching list. |
| Stop | `btnStop` | Selected item in research list | Calls `RDOCancelResearch(inventionId)`. Moves item from Researching list back to Available tree. |
| Sell | `btnSell` | Selected node in developed tree + user owns facility | Calls `RDOCancelResearch(inventionId)`. Removes from Developed tree. Server does cascade retirement. |

## Client Invention Data File — `research.{lang}.dat`

### Origin and Pipeline

The XML invention definition files (not in the repo — deployed on the game server) are the authoritative source. Two tools compile them:

| Tool | Source | Purpose |
|------|--------|---------|
| `InvMaker.dpr` | `SPO-Original/Inventions/` | Early tool. Writes per-invention `.inv` binary files (simple format: name, kind, price, effic, Q, prestige, desc, base) |
| `InvComp.dpr` | `SPO-Original/Inventions/` | Production compiler. Reads `*.xml` + `<link>` class files. Writes `{id}.inv` per invention with full properties + tree info. Also generates the `research.{lang}.dat` consumed by Voyager |

```
*.xml (game server)
    │
    ▼
InvComp.dpr ──► research.{lang}.dat (×6 languages) ──► inventions.cab
    │                                                        │
    │   (XML loaded at runtime by Inventions.pas)            │
    ▼                                                        ▼
Game Server (TInvention registry)              Voyager client (pre-cached names)
                                                             │
                                                             ▼
                                               WebClient (via /api/research-inventions)
```

### Binary Format (`research.{lang}.dat`)

Located at: `cache/Inventions/research.{0..5}.dat` (also packed in `inventions.cab`)

Language indexes: `0`=English, `1`=Spanish, `2`=Portuguese, `3`=French(?), `4`=German(?), `5`=Italian(?)

```
┌───────────────────────────────────────────────────────┐
│ Header                                                │
│   uint32    inventionCount                            │
├───────────────────────────────────────────────────────┤
│ Per invention (×inventionCount):                      │
│   DelphiString    id           — e.g. "24HoursProduction"     │
│   DelphiString    name|category — "24 Hour Production|Industry"│
│   DelphiString    description  — text + "\r\nRequires: X, Y." │
│   DelphiString    parent       — tree grouping e.g. "Oil"     │
│   byte            cache        — boolean (0x00 or 0x01)       │
│   DelphiString    properties   — formatted "\r\n"-separated   │
├───────────────────────────────────────────────────────┤
│ Footer                                                │
│   DelphiString    tabNames     — "\r\n"-separated tab labels  │
│                                  e.g. "GENERAL\r\nCOMMERCE..." │
└───────────────────────────────────────────────────────┘

DelphiString = uint32_LE(length) + raw_bytes(length)
```

**research.0.dat (English):** 879 inventions, 248,730 bytes

### Invention Data Fields

Each parsed invention from the `.dat` file provides:

| Field | Type | Example | Purpose |
|-------|------|---------|---------|
| `id` | string | `"24HoursProduction"` | Unique ID — matches cache `{prefix}{cat}RsId{idx}` values |
| `name` | string | `"24 Hour Production"` | Display name (NOT in server cache for non-volatile inventions) |
| `category` | string | `"Industry"` | InventionKind mapped to display name — used for category tab assignment |
| `description` | string | `"Your rigs never stop...\r\nRequires: Oil Production."` | Full text with prerequisites appended |
| `parent` | string | `"Oil"` | Tree grouping label — inventions with same parent group together |
| `cached` | boolean | `true` | Whether pre-cached in client (almost always true) |
| `properties` | string | `"Price: $190,000,000\r\nPrestige: -5 pts\r\n..."` | Pre-formatted property lines |

### Category Tab Assignment

The `.dat` footer declares global tab labels. Each invention's `category` field determines which tab it belongs to:

**Tab labels from research.0.dat:** `GENERAL`, `COMMERCE`, `REAL ESTATE`, `INDUSTRY`, `CIVICS`

| Tab Index | Tab Label | Invention Categories (from `category` field) | Count |
|-----------|-----------|-----------------------------------------------|-------|
| 0 | GENERAL | `"General"` | 56 |
| 1 | COMMERCE | `"Commerce"` | 243 |
| 2 | REAL ESTATE | `"Real Estate"` | 67 |
| 3 | INDUSTRY | `"Industry"` | 503 |
| 4 | CIVICS | `"Civics"`, `"Ministry Headquarters"` | 10 |

**Matching rule:** `tabLabel.toUpperCase() === category.toUpperCase()` for tabs 0-3. Tab 4 (CIVICS) collects `"Civics"` AND `"Ministry Headquarters"` as a fallback bucket.

**Important:** These are GLOBAL tabs across ALL HQ types. A given HQ only sees inventions that are registered to its `InventionKind` (e.g., `'Farming'`, `'Direction'`). The server's `CatCount` property tells the client how many tabs this specific HQ uses. Most HQs use `CatCount=0` (single tab, no tabs visible).

### Parent Grouping (Tree Hierarchy)

Within each category tab and section (Available/Researching/Developed), inventions are grouped by `parent`:

```
INDUSTRY tab
  ├── Oil (16 inventions)
  │   ├── 24 Hour Production
  │   ├── Centralized Quality Control
  │   └── ...
  ├── Farms (19 inventions)
  │   ├── Farming
  │   ├── Advanced Genetics
  │   └── ...
  └── Textile (20 inventions)
      ├── Textile Production
      └── ...
```

Parent groups (top 10 by count):

| Parent | Count | Category |
|--------|-------|----------|
| Housing | 46 | Real Estate |
| Metallurgy | 32 | Industry |
| Movie Studios | 21 | Industry |
| Offices | 21 | Real Estate |
| Television | 21 | General |
| Textile | 20 | Industry |
| Farms | 19 | Industry |
| Food Processing | 17 | Industry |
| (7 mining types) | 17 each | Industry |
| Bars | 16 | Commerce |

### Name Resolution Chain

The server cache only writes `Name` for **volatile** inventions (those with `licLevel > 0`). For the vast majority of inventions, the cache only has the `Id`. The name resolution chain:

```
1. Server cache: {prefix}{cat}RsName{idx}  → only for volatile inventions
2. .dat file:    lookup by id → name        → primary source for all inventions
3. Fallback:     use invention ID as-is     → worst case (e.g., "24HoursProduction")
```

**WebClient implementation:** `src/shared/research-dat-parser.ts` parses `research.0.dat` at server startup and serves invention metadata via `GET /api/research-inventions`. The server-side `getResearchInventory()` enriches cache items with names from the parsed data.

## WebClient Implementation Status

### Fully Implemented

| Component | File | What it does |
|-----------|------|-------------|
| **Template group** | `src/shared/building-details/template-groups.ts:186-205` | `HQ_INVENTIONS_GROUP` with `RESEARCH_PANEL` marker property |
| **Handler mapping** | same file, HANDLER_TO_GROUP | `'hdqInventions'` → `HQ_INVENTIONS_GROUP` |
| **Tab injection** | `registerInspectorTabs()` | Auto-appends Research tab for any HQ building |
| **RDO commands** | `src/server/session/building-property-handler.ts` (`buildRdoCommandArgs`) | `RDOQueueResearch` + `RDOCancelResearch` wire format |
| **Cache inventory** | `src/server/session/research-handler.ts` | `getResearchInventory()` — fetches counts + per-item cache props in batches |
| **Detail fetch** | `src/server/session/research-handler.ts` | `getResearchDetails()` — calls `RDOGetInvPropsByLang` + `RDOGetInvDescEx` |
| **Item parser** | `src/server/session/session-utils.ts` | `parseResearchItems()` — builds `ResearchInventionItem[]` from cache values |
| **Message types** | `src/shared/types/message-types.ts:1117-1175` | `ResearchInventionItem`, `ResearchCategoryData`, `ResearchInventionDetails`, WsReq/Resp types |
| **Server gateway** | `src/server/ws-handlers/misc-handlers.ts` (`handleResearchInventory` / `handleResearchDetails`) | `REQ_RESEARCH_INVENTORY` + `REQ_RESEARCH_DETAILS` handlers |
| **Client callbacks** | `src/client/client.ts` | `onResearchLoadInventory()`, `onResearchGetDetails()` |
| **Client actions** | `src/client/handlers/building-action-handler.ts` | `queueResearchDirect()`, `cancelResearchDirect()` — fully wired |
| **State store** | `src/client/store/building-store.ts:15-86` | `ResearchState` with inventory, selection, details, loading flags |
| **React panel** | `src/client/components/building/ResearchPanel.tsx` | Section tabs, invention list with parent grouping, detail panel, action bar |
| **Panel CSS** | `src/client/components/building/ResearchPanel.module.css` | Full styling |
| **`.dat` parser** | `src/shared/research-dat-parser.ts` | Parses `research.{lang}.dat` binary → structured invention data |
| **API endpoint** | `src/server/server.ts` | `GET /api/research-inventions` serves parsed `.dat` data as JSON |
| **Tests** | `src/server/__tests__/research-inventory.test.ts` | `parseResearchItems()` tests (93 lines) |
| **Tests** | `src/server/__tests__/rdo/research-commands.test.ts` | Drives setBuildingProperty; asserts the literal RDOQueueResearch / RDOCancelResearch frames |
| **Tests** | `src/shared/building-details/hq-inventions.test.ts` | Template structure tests (91 lines) |
| **Tests** | `src/shared/research-dat-parser.test.ts` | Binary parser tests |

### Remaining Gaps (for future implementation)

1. **Category tab UI** — `ResearchPanel.tsx` hardcodes `categoryIndex: 0`. When `CatCount > 0`, a top-level tab bar should appear above the Available/Researching/Developed section tabs. The building store needs `activeCategoryIndex` state, and `loadResearchInventory()` should re-fetch when the category tab changes.
2. **Name enrichment** — `getResearchInventory()` in `spo_session.ts` should enrich non-volatile items by looking up names/descriptions from the parsed `.dat` data. Currently non-volatile inventions display their ID as the name.
3. **Sell action** — The Developed section should show a "Sell" button (uses same `RDOCancelResearch` command). Currently only Available→"Research" and Developing→"Cancel" are wired.
4. **Progress display** — Developing items have no progress indicator. Progress is NOT in the server cache — it would require periodic polling via `RDOGetInvPropsByLang` or a push notification mechanism.
5. **Pre-cached properties** — The `.dat` file contains pre-formatted property text per invention. These could serve as instant display data while the RDO detail call loads, avoiding the loading skeleton for basic info.

## Evidence Chain

- [ResearchCenter.pas:17-110] — TMetaResearchCenter + TResearchCenter interface section
- [ResearchCenter.pas:314-339] — QueueResearch validation and instant-research path
- [ResearchCenter.pas:341-380] — CancelResearch with refund calculation
- [ResearchCenter.pas:382-404] — RDO wrappers with auth check
- [ResearchCenter.pas:497-648] — Evaluate loop with progress formula
- [ResearchCenter.pas:770-828] — StoreToCache with full property map
- [Headquarters.pas:97-111] — AutoConnect auto-queues Basic inventions
- [Inventions.pas:91-180] — TInvention full data model
- [Inventions.pas:658-695] — Enabled check (tier + nobility + prerequisites)
- [Inventions.pas:697-707] — GetFeePrice licence cost formula
- [Inventions.pas:709-748] — GetProperties formatted output
- [Inventions.pas:750-764] — StoreToCache per-invention
- [Inventions.pas:766-781] — GetFullDesc with requirements
- [Inventions.pas:828-831] — GetClientProps delegates to GetProperties
- [Inventions.pas:843-858] — TInventionRecord cost formulas
- [InventionsSheet.pas:1-42] — Constants and icon states
- [InventionsSheet.pas:100-152] — TInventionInfo + TInventionsSheetHandler interface
- [InventionsSheet.pas:281-367] — RenderProperties parses cache into Available/Scheduled/Developed lists
- [InventionsSheet.pas:548-608] — threadedGetResearchInfo calls RDOGetInvPropsByLang + RDOGetInvDescEx
- [InventionsSheet.pas:610-648] — QueueResearch/CloseResearch RDO wire calls
- [InventionsSheet.pas:661-756] — RenderTab populates trees and list
- [InventionsSheet.pas:784-837] — btnResearch/btnStop click handlers
- [Standards.pas:24-80] — All InventionKind constants

## Research Completion Push Sequence

When a research item completes, the server sends three push commands in rapid succession to the client. This sequence is critical for proper UI refresh.

### Push 1: ShowNotification (toast)

```
C sel <tycoonProxy> call ShowNotification "*" "#4","%","%Research ""Water Quest Licenses"" completed. Check for new items in your Build page.","#1";
```

- **Kind:** `#4` = GenericEvent (from `TNotificationKind` in Protocol.pas)
- **Title:** `%` (empty)
- **Body:** `%Research "..." completed. Check for new items in your Build page.`
- **Options:** `#1` = `gevnId_RefreshBuildPage` (Protocol.pas:186)
- **WebClient actions:**
  1. Displays a success toast via `showNotification()`
  2. Invalidates the cached build catalog (`buildingCategories = []`) because completed research may unlock new building types. The catalog is re-fetched on next Build Menu open.

### Push 2: RefreshObject (building visual + focus update)

```
C sel <tycoonProxy> call RefreshObject "*" "#129625108","#1","%";
```

- **BuildingId:** `#129625108`
- **KindOfChange:** `#1` = `fchStructure` (visual changed)
- **ExtraInfo:** `%` (empty — status text clears after completion)
- **WebClient action:** Invalidates the building's renderer zone (re-draws on map). If the building is currently focused, propagates empty detailsText/hintsText to the StatusTicker (hides it) and re-fetches building details.

### Push 3: Bare Refresh (cache invalidation)

```
C 241 sel 31413720 call Refresh "*" ;
```

- **Connection 241:** The IS connection hosting the cache object proxy
- **ObjectId 31413720:** The cache proxy object for the focused building
- **No args:** This is a bare `Refresh` call — tells the cache proxy to invalidate all cached properties and re-read from the model server
- **WebClient action:** Re-fetches building details via `requestBuildingDetails()`, which refreshes all tabs (including the Research tab inventory showing the newly completed item).

### Flow Diagram

```
Server completes research
  │
  ├─ ShowNotification(4, "", "Research X completed...", 1)
  │    → Client: success toast shown to player
  │
  ├─ RefreshObject(buildingId, 1, "")
  │    → Client: re-render building on map
  │    → Client: clear StatusTicker (empty detailsText/hintsText)
  │    → Client: update focused building store
  │
  └─ Refresh() [bare, on cache proxy connection]
       → Client: re-fetch building details + tabs
       → Client: Research tab shows updated inventory
```

### Key Observations

1. **ShowNotification and RefreshObject are often concatenated** in a single TCP message separated by `;` — the WebClient's `handleIncomingMessage()` splits on `;` and processes each command separately.
2. The bare `Refresh` push arrives on a **different TCP connection** (the cache proxy connection, not the tycoon proxy), but in the WebClient's multiplexed architecture it routes through the same `processSingleCommand()` path.
3. During active research, the `RefreshObject` push periodically updates the StatusTicker with progress (e.g., `detailsText: "Researching X. Cost: $10M. Company supported at 200%."`, `hintsText: "Please wait..."`). On completion, these fields clear.

### ShowNotification Protocol Reference (from Delphi VoyagerWindow.pas:506-563)

| Kind | Constant | Options | Delphi Action |
|------|----------|---------|---------------|
| 0 | `ntkMessageBox` | (unused) | `ShowMsgBox()` — modal dialog |
| 1 | `ntkURLFrame` | `OP_Minimized` bitflag | Opens URL in embedded frame |
| 2 | `ntkChatMessage` | (unused) | `SayThis()` — chat message |
| 3 | `ntkSound` | (unused) | `SayThis()` — chat message + sound |
| 4 | `ntkGenericEvent` | `gevnId_RefreshBuildPage=1` | Chat message + refresh Build page |

The `gevnId_RefreshBuildPage` option (value `1`, Protocol.pas:186) is sent when research completes or an invention is sold, signaling the client to refresh its building catalog because new facility types may have been unlocked.

## Open Questions

- [x] [RESOLVED] How does the `research.{lang}.dat` binary file get generated? → **`InvComp.dpr`** reads `*.xml` + `<link>` class definition files, writes per-invention `.inv` binary files and the combined `research.{lang}.dat`. See "Client Invention Data File" section above.
- [x] [RESOLVED] What is the exact XML schema for invention definition files? → XML files are NOT in the repo. Tags: `<invention>`, `<inventionset>`, `<properties>` with attributes `id`, `name`, `kind`, `parent`, `price`, `time`, `basic`, `cache`, `tier`, `lclevel`, `volatile`, `nob`, `catpos`, `obsolete`. See `Inventions.pas:378-468` for the full XML parser.
- [ ] [UNKNOWN] How does invention "implementation" affect facilities concretely? The `OutputEvaluators.pas` has `TInventionEfficiencyEffect` (QEffect) and `TInventionQualityEffect` (KEffect) but the exact mapping from invention → facility effect is not in ResearchCenter — it's in the facility block evaluators.
