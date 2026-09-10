# Voyager Facility Inspector — Client Architecture Reference

> **Scope:** How the SPO-Original Delphi 5 Voyager client converts RDO data into visual UI, determines editability, and manages the building inspector lifecycle.
>
> **Audience:** WebClient developers implementing or debugging the facility inspector equivalent.
>
> **Source codebase:** `SPO-Original/Voyager/` — all citations use `FileName.pas:Line` format.

## Related Documents

| Document | Covers |
|----------|--------|
| [facility-tabs-reference.md](facility-tabs-reference.md) | Tab configurations from CLASSES.BIN, handler registry, 20 configs × 863 classes |
| [spo-original-reference.md](spo-original-reference.md) | RDO server-side method signatures, type mappings, dispatch rules |
| [research-system-reference.md](research-system-reference.md) | Research/Inventions system (hdqInventions handler) |
| [civic-roles-reference.md](civic-roles-reference.md) | Town Hall and Capitol sheets — Mayor/President powers, the civic permission model, server rules |

---

## 1. Container Lifecycle

### Entry Point

When the user clicks a building on the isometric map, the Voyager URL router dispatches a `SHOWOBJECT` action to `TObjectInpectorHandler`.

**ObjectInspectorHandler.pas:107-134** — `HandleURL()` flow:

```
URL: "SHOWOBJECT?ClassId=123&ObjectId=456&x=100&y=200"
  ↓ parse URL params
  fClassId  := StrToInt(GetParmValue(URL, 'ClassId'))   // :116
  fObjectId := StrToInt(GetParmValue(URL, 'ObjectId'))   // :117
  fXPos     := StrToInt(GetParmValue(URL, 'x'))          // :118
  fYPos     := StrToInt(GetParmValue(URL, 'y'))          // :119
  ↓
  fControl.ChangeObject(fClientView, fXPos, fYPos, fClassId, fObjectId)  // :121
```

### ChangeObject Flow

**ObjectInspectorHandleViewer.pas:978-1009** — Called when a building is clicked:

1. Close any open SupplyFinder/ClientFinder frames (:983-984)
2. Set cursor to hourglass
3. Lazy-create `TObjectInspectorContainer` if nil (:986-993)
4. `Container.SetObjectData(ClassId, ObjectId)` — sets `fObjChanged` flag if different (:995)
5. `Container.SetXPos(xPos)`, `SetYPos(yPos)` (:998-999)
6. **`AddControlTabs()`** — the critical tab configuration step (:1002)
7. **`Container.Refresh()`** (:1003)
8. **`ShowImage(WorldName, xPos, yPos)`** — loads facility image in embedded IE (:1005)

### AddControlTabs: Tab Configuration

**ObjectInspectorHandleViewer.pas:1070-1149** — Determines which tabs appear for a facility:

1. Queries **VisualClass data** (local INI/binary registry, NOT game server):
   - `GetValue('InspectorInfo', 'TabCount', vtInteger)` (:1085)
   - For each tab `i`: reads `TabName{i}` (display name) and `TabHandler{i}` (handler class name) (:1092-1093)
   - Translates name via `tabNamesMLS.TranslateName(name)` for localization (:1094)
   - Uppercases handler name for registry lookup (:1095)

2. **Same-class optimization** (:1096-1098, 1102):
   - Compares new handler list against `fLastHandlers` (previous building's handlers)
   - If all handlers match AND count matches → `fSameClass = true`
   - Same class: calls `ClearSheets(false)` (clear data but keep controls), then `FocusSheet` (:1138-1142)

3. **Different class** (:1103-1134):
   - `ClearSheets(true)` → releases all sheet handler instances
   - For each handler: `AddSheet(TabNames[i], TabHdlrs[i])` (:1110)
   - Remembers last selected tab name, restores it if found in new set (:1121)
   - If no tabs added → closes the inspector frame (:1130)

See [facility-tabs-reference.md](facility-tabs-reference.md) Section "All 20 Tab Configurations" for the tab definitions per visual class.

### AddSheet: Handler Instantiation

**ObjectInspectorHandleViewer.pas:722-764** — Container-level:

1. Check cache: `GetCachedSheet(Handler, Shdl)` (:730)
2. If not cached:
   - `SheetHandlerRegistry.GetSheetHandler(Handler)` — factory lookup (:734)
   - `Shdl.SetContainer(Self)` (:738)
   - `Shdl.CreateControl(fControl)` — creates VCL form (:740)
   - Adds a new `TInfoBookPage` to the Pages component (:741)
   - Caches for reuse (:747-748)
3. If cached: reuses existing handler instance and control (:757-759)

### FocusSheet: Tab Activation

**ObjectInspectorHandleViewer.pas:473-484**:

1. Previous sheet: `fSheets[fCurSheet].LostFocus`
2. New sheet: `fSheets[index].SetFocus` — triggers property fetching
3. Updates `fCurSheet`

### Event Handling

**ObjectInspectorHandler.pas:136-200** — handles system events:

| Event | Action | Line |
|-------|--------|------|
| `evnRefresh` | `Container.Refresh()` | :143 |
| `evnHandlerExposed` | `Container.Exposed()`, check world change | :148 |
| `evnRefreshObject` | If `fchStructure` and same ObjectId → refresh | :172 |
| `evnLogonCompleted` | Clear connections, close inspector | :179 |
| `evnShutDown` | Nil all references | :189 |

---

## 2. RDO Proxy Architecture

The container manages three types of RDO proxy connections:

### Cache Server Proxy (Read)

**Purpose:** Fetch facility properties from the Cache Server.

**ObjectInspectorHandleViewer.pas:552-597** — `GetCacheObjectProxy()`:

```
1. Connect to Cache Server (getCacheAddr:getCachePort)
2. Create server proxy → call srvProxy.CreateObject(WorldName)
3. Get object reference → create RDO proxy
4. Call tmpProxy.SetObject(xPos, yPos)     // :569 — points at facility by map coordinates
5. Store as fCacheObj for reuse
```

When `fObjChanged` is true, calls `fCacheObj.SetObject(xPos, yPos)` to re-point (:582).

**Key RDO methods called on Cache Object Proxy:**

| Method | Purpose | Reference |
|--------|---------|-----------|
| `GetPropertyList(tabDelimitedNames)` | Fetch named properties | SheetUtils.pas:67 |
| `GetSubObjectProps(subIdx, names)` | Fetch sub-object properties | SheetUtils.pas:141 |
| `GetInputNames(0, lang)` | Get input gate names | Used by Supplies, Ads, WH |
| `GetOutputNames(0, lang)` | Get output gate names | Used by Products |
| `SetPath(path)` | Navigate to sub-object path | Used for gate drill-down |
| `SetObject(x, y)` | Point at facility | Container setup |
| `Refresh` | Force cache refresh from model server | Container.Refresh() |
| `KeepAlive` | Prevent timeout | Timer-based, 60s interval |

### Model Server Proxy (Write)

**Purpose:** Execute state-changing RDO commands (SET/CALL).

**ObjectInspectorHandleViewer.pas:599-632** — `GetMSProxy()`:

```
1. Connect to Model Server (DAAddr:DALockPort)
2. Create proxy → bind to 'World' object
3. Call Proxy.RDOLogonClient(userName, password)    // :617 — authenticate
4. Re-bind to fObjectId                              // :618 — target the specific facility
5. Store as fMSObj for reuse
```

When object changes: re-binds to new `fObjectId` (:626).

**Critical patterns for MS Proxy usage:**
- `BindTo(targetId)` before every call — target can be `fCurrBlock`, gate `ObjectId`, or `'World'`
- `WaitForAnswer := false` for fire-and-forget SET commands
- `WaitForAnswer := true` for synchronous operations (connect/disconnect, research queue)

### KeepAlive Timer

**ObjectInspectorHandleViewer.pas:1172-1180** — `KeepAliveTimer()`:

Fires periodically (interval: `CacheConnectionTimeOut = 60000ms`) and calls `fCacheObj.KeepAlive` to prevent the cache server from releasing the object reference due to inactivity.

---

## 3. Data Binding: FiveViewUtils and xfer_* Controls

### The xfer_* Naming Convention

**FiveViewUtils.pas** (`Utils/Misc/FiveViewUtils.pas`) implements automatic data binding between Delphi VCL controls and RDO property values.

**Convention:** Any form control whose `Name` starts with `xfer_` is automatically bound to a cache property. The suffix after `xfer_` is the property name.

| Control Name | Property Mapped | Example Value |
|-------------|----------------|---------------|
| `xfer_Cost` | `Cost` | `$1,250,000` |
| `xfer_Creator` | `Creator` | `PlayerName` |
| `xfer_Name` | `Name` | `My Factory` |
| `xfer_Years` | `Years` | `3` |
| `xfer_Salaries0` | `Salaries0` | `120` (percent) |
| `xfer_Workers0` | `Workers0` | `45` |
| `xfer_AdPerc` | `AdPerc` | `75` (percent) |

### GetViewPropNames: Collecting Property Names

```
FiveViewUtils.GetViewPropNames(Control, Names : TStringList)
```

Recursively scans all child controls of `Control`. For any with name starting `'xfer_'`, extracts the suffix as a property name and adds it to `Names`. This builds the list of properties to request from the cache server.

### SetViewProp: Auto-Mapping Values

```
FiveViewUtils.SetViewProp(Control, Properties : TStringList)
```

Recursively scans all child controls. For each `xfer_*` control:
- Looks up `Properties.Values[suffix]`
- If found: sets the control's text/caption to the value
- If empty: sets to `'n/a'`

This mechanism means most sheet handlers need **zero explicit rendering code** for basic properties — just name the controls correctly and call `SetViewProp`.

### Custom RenderProperties Override

Handlers that need non-trivial rendering override `RenderProperties(Properties: TStringList)` instead of (or in addition to) relying on auto-binding:

| Handler | Why Custom Rendering |
|---------|---------------------|
| Products | Dynamic finger tabs per output, connection sub-tables |
| Supplies | Dynamic finger tabs per input, connection sub-tables, sort modes |
| Workforce | 3-tier table with conditional visibility per tier |
| TownTaxes | Dynamic rows per tax, percent vs value formatting |
| Inventions | 3-section tree view (available/researching/developed) |
| Films | Conditional field visibility based on production state |

### Property Name Patterns

| Pattern | Example | Used By |
|---------|---------|---------|
| Simple | `Cost`, `ROI`, `Name` | All general handlers |
| Indexed (suffix) | `Workers0`, `Salaries1`, `WorkersCap2` | Workforce |
| Indexed (prefix) | `Tax0Id`, `Tax1Name0` | TownTaxes |
| MLS (multi-language) | `cInput0.0`, `prdName0.0` | compInputs, townProducts |
| Prefixed-indexed | `svrName0`, `svrDemand0` | townServices |
| Connection sub | `cnxFacilityName`, `cnxCompanyName` | Products, Supplies, Ads |

### WebClient Equivalent

The `xfer_*` pattern maps to `PropertyDefinition.rdoName` fields in [template-groups.ts](../src/shared/building-details/template-groups.ts). Where Voyager uses control naming convention, the WebClient uses declarative property templates.

---

## 4. Threaded Property Fetching

### The SetFocus → Fork → Join Pattern

Every concrete sheet handler follows this canonical flow:

```
                    Main Thread                          Background Thread
                    ───────────                          ─────────────────
1. SetFocus()
   ├── fExposed := true
   ├── fLoaded := true
   ├── inc(fLastUpdate)         ← version counter
   ├── Names := GetViewPropNames()
   ├── Names.Add('SecurityId')
   ├── Names.Add('Trouble')
   ├── Names.Add('CurrBlock')
   └── Fork(threadedGetProperties,
            [Names, fLastUpdate])
                                            2. threadedGetProperties(Names, Update)
                                               ├── if Update ≠ fLastUpdate → abort
                                               ├── Prop := Container.GetProperties(Names)
                                               │   └── RDO call to Cache Server (blocks)
                                               ├── if Update ≠ fLastUpdate → Free(Prop), abort
                                               └── Join(threadedRenderProperties, [Prop, Update])
3. threadedRenderProperties(Prop, Update)
   ├── if Update ≠ fLastUpdate → Free(Prop), abort
   ├── SetViewProp(Control, Prop)           ← auto-bind xfer_* controls
   ├── fOwnsFacility := GrantAccess(...)    ← permission check
   ├── enable/disable controls              ← visual state
   └── Free(Prop)
```

### Version Guard: fLastUpdate

**SheetHandlers.pas:100-105** — The `fLastUpdate` integer serves as a cancellation token:

- Incremented on every `SetFocus()` and `Clear()` call
- Background thread captures the value at fork time
- Checks `if Update = fLastUpdate` at **three** points: before RDO call, before Join, before rendering
- If the user clicks a different building or tab during fetch, `fLastUpdate` changes and stale results are discarded

During `Refresh()` (:119-124), `fLastUpdate` is incremented **twice** (once in `Clear`, once in `SetFocus`).

### Timer-Based Dynamic Refresh

Some handlers poll for live data using a `TTimer`:

| Handler | Timer Method | RDO Call | Interval |
|---------|-------------|----------|----------|
| Workforce | `RenderWorkForce` | `RDOGetWorkers(tierIndex)` | ~5 seconds |
| SrvGeneral | `tRefresh` | `RDOGetDemand(finger)`, `RDOGetSupply(finger)` | ~5 seconds |

Each timer call uses the same Fork/Join/version-guard pattern.

### WebClient Equivalent

The threaded pattern maps to `fetchBuildingDetails()` (async) + `buildingStore.setDetails()` in the WebClient. The version guard maps to checking `focusedBuilding.objectId` before applying server responses.

---

## 5. Permission / Authorization Model

### Overview

The Voyager client implements **dual-layer authorization**: client-side UI state (cosmetic) + server-side enforcement (real). The client uses 6 permission variants to determine whether edit controls are enabled or disabled.

### 5.1 Standard GrantAccess (Most Common)

**Protocol.pas:428-431:**

```delphi
function GrantAccess(RequesterId, SecurityId : TSecurityId) : boolean;
begin
  result := pos(SecIdItemSeparator + RequesterId + SecIdItemSeparator, SecurityId) > 0;
end;
```

Where `SecIdItemSeparator = '-'` (:353) and `TSecurityId = string` (:350).

**How it works:**
- The facility's `SecurityId` property is a hyphen-delimited string: `"-123-456-789-"`
- Each number is a tycoon ID authorized to edit this facility
- `GrantAccess` checks if `'-{clientId}-'` appears as a substring
- The client's security ID comes from `fContainer.GetClientView.getSecurityId`

**Client-side usage (typical):**

```delphi
// IndustryGeneralSheet.pas:142
fOwnsFacility := GrantAccess(
  fContainer.GetClientView.getSecurityId,
  Properties.Values[tidSecurityId]
);
```

**Used by:** IndGeneral, SrvGeneral, ResGeneral, HqGeneral, BankGeneral, WHGeneral, TVGeneral, Products, Supplies, Workforce, facManagement, Films, Votes

### 5.2 ExtraSecurityId Fallback

**Pattern:** Check `ExtraSecurityId` first; if empty, fall back to `SecurityId`.

```delphi
// TownHallJobsSheet.pas:142-145
aux := Properties.Values[tidExtSecurityId];
if aux = ''
  then aux := Properties.Values[tidSecurityId];
fOwnsFacility := GrantAccess(fContainer.GetClientView.getSecurityId, aux);
```

**Purpose:** Some objects have a secondary permission scope. For example, town jobs may have a town-level permission (the mayor) in `ExtraSecurityId` that is separate from the facility owner's `SecurityId`.

**Used by:** TownHallJobs (`TownHallJobsSheet.pas:142`), Ads (`AdvSheetForm.pas:434-437`)

### 5.3 Dual: GrantAccess OR ActualRuler Username

**Pattern:** Access granted if SecurityId matches OR if current user IS the political ruler.

```delphi
// CapitolTownsSheet.pas:114
fHasAccess := GrantAccess(
    fContainer.GetClientView.getSecurityId,
    Properties.Values['SecurityId']
  ) or (
    uppercase(Properties.Values[tidActualRuler]) =
    uppercase(fContainer.GetClientView.getUserName)
  );
```

**Purpose:** Both the facility owner AND the elected president/ruler can manage political buildings (set budgets, appoint ministers, adjust town taxes).

**Used by:** CapitolTowns (`CapitolTownsSheet.pas:114`), Ministeries (`MinisteriesSheet.pas:115`)

### 5.4 Username Comparison (OwnerName)

**Pattern:** Direct case-insensitive username comparison — no SecurityId involved.

```delphi
// MausoleumSheet.pas:127
if (UpperCase(Properties.Values[tidOwnerName]) =
    UpperCase(fContainer.GetClientView.getUserName))
  then fOwnFac := true
  else fOwnFac := false;
```

**Purpose:** Mausoleum/monument ownership is personal — tied to a username, not a tycoon/company security chain.

**Used by:** Mausoleum (`MausoleumSheet.pas:127`)

### 5.5 No Permission Check (Read-Only)

**Pattern:** No ownership check performed. All visitors see the same read-only display.

**Used by:**
- `capitolGeneral` (`CapitolSheet.pas`) — political overview, coverage table
- `townGeneral` (`TownHallSheet.pas`) — town overview, ruler info, links to politics/news
- `BankLoans` (`BankLoansSheet.pas`) — read-only loan list
- `Antennas` (`AntennasSheet.pas`) — read-only antenna list
- `unkGeneral` (`UnkFacilitySheet.pas`) — fallback handler
- `Chart` (`ChartSheet.pas`) — historical chart display

### 5.6 Inverted Permission (Bank)

**Pattern:** Some controls are enabled for **non-owners** (the opposite of normal).

```delphi
// BankGeneralSheet.pas:156
fbRequest.Enabled := not fOwnsFacility;   // loan request for visitors
eBorrow.Enabled   := not fOwnsFacility;   // borrow amount field
```

**Purpose:** You request loans from someone else's bank. The bank owner sets interest rates and budget; visitors submit loan requests.

**Used by:** BankGeneral (`BankGeneralSheet.pas:156,160`)

### 5.7 Per-Property Editability: cEditable

Beyond ownership, individual properties can be marked as non-editable at the **server level**.

**Server-side** (`Kernel.Iroel.pas:5871-5889`):

```delphi
if TMetaCompanyInput(MetaBlock.CompanyInputs[i]).Editable
  then WriteString('cEditable' + iStr, 'yes')
  // else: no 'cEditable' property written
```

**Client-side** (`CompanyServicesSheetForm.pas:340-342`):

```delphi
edt := Info.StrValue[tidEditable] <> '';    // non-empty = editable
peDemand.Visible := edt;                    // HIDDEN if not editable (not just disabled)
peDemand.Enabled := edt and fHandler.fOwnsFacility;  // enabled only if BOTH conditions met
```

**Decision tree:**

```
cEditable{i} property exists?
  NO  → control HIDDEN entirely (Visible := false)
  YES → control VISIBLE
    fOwnsFacility?
      NO  → control DISABLED (grayed out)
      YES → control ENABLED (interactive)
```

### 5.8 Server-Side Enforcement: CheckOpAuthenticity

Client-side permission checks are **cosmetic only** — they prevent the user from interacting with controls, but the real enforcement happens server-side.

**Enforcement chain** (`Kernel.Iroel.pas`):

```
RDO SET command invoked (e.g., RDOSetCompanyInputDemand)     // :6191
  ↓
Facility.CheckOpAuthenticity                                  // :4693
  → (fCompany <> nil) and fCompany.CheckOpAuthenticity
    ↓
Company.CheckOpAuthenticity                                   // :10379
  → (fOwner <> nil) and fOwner.CheckOpAuthenticity
    ↓
TTycoon.CheckOpAuthenticity                                   // :12680
  → LoggedUserData.CheckAuthenticity(MasterRole)
    ↓
LoggedUserData.CheckAuthenticity                              // LoggedUserData.pas
  → usrData := GetUserData   (thread-local tycoon pointer set at login)
  → (usrData = data) or (usrData = SYSTEM_SIM)
```

**If authentication fails:** The RDO command silently exits — no error returned to client, no state change applied. The client-side disabled controls prevent reaching this point in normal operation.

**No admin override:** The codebase has no per-facility admin flag, no moderator edit pattern, and no bypass mechanism. The only bypass is `SYSTEM_SIM` for internal server operations.

### Summary Table

| Variant | Handlers | How Access Is Determined |
|---------|----------|------------------------|
| **Standard** | IndGeneral, SrvGeneral, ResGeneral, HqGeneral, BankGeneral, WHGeneral, TVGeneral, Products, Supplies, Workforce, facManagement, Films, Votes | `GrantAccess(clientSecId, SecurityId)` |
| **ExtraSecId fallback** | TownHallJobs, Ads | Check ExtraSecurityId first, fall back to SecurityId |
| **Dual (owner OR ruler)** | CapitolTowns, Ministeries | GrantAccess OR `ActualRuler == getUserName()` |
| **Username comparison** | Mausoleum | `OwnerName == getUserName()` |
| **Read-only** | capitolGeneral, townGeneral, BankLoans, Antennas, unkGeneral, Chart | No check, all controls read-only |
| **Inverted** | BankGeneral (loan UI) | `NOT fOwnsFacility` enables loan request |

---

## 6. Visual State Management

### Enabled vs Visible vs ReadOnly

Delphi controls have three relevant state properties:

| State | Visual Effect | Used For |
|-------|--------------|----------|
| `Enabled := false` | Control appears **grayed out** (dimmed text, non-interactive) | Owner-gated edit controls |
| `Visible := false` | Control **hidden entirely** (no space occupied) | `cEditable`-gated controls, conditional UI sections |
| `ReadOnly := true` | Text visible but not editable (normal appearance, no cursor) | Mausoleum words of wisdom for non-owners |

### Trouble Flag

The `Trouble` property is a bitmask indicating facility problems:

```delphi
// Protocol.pas
facStoppedByTycoon = $04;   // bit 2 — manually stopped by owner
```

**Client-side usage** (e.g., `IndustryGeneralSheet.pas:141-146`):

```delphi
trbl := StrToInt(Properties.Values[tidTrouble]);
if trbl and facStoppedByTycoon <> 0
  then btnClose.Caption := 'Reopen'
  else btnClose.Caption := 'Close';
```

### Dynamic Finger Tabs

Products, Supplies, SrvGeneral, and WHGeneral use "finger tabs" — sub-tabs within a sheet that are created dynamically:

1. **Products**: `Proxy.GetOutputNames(0, ActiveLanguage)` returns CR-delimited `Path:FluidName` pairs
2. **Supplies**: `Proxy.GetInputNames(0, ActiveLanguage)` returns CR-delimited `Path:FluidName` pairs
3. Each pair is parsed → a finger tab is created for each fluid
4. `GateMap` string controls visibility: `gateMap[i+1] = '0'` hides that finger
5. Each finger stores a `TGateInfo` object with cached per-gate data

### Name Editing Pattern

All general handlers follow the same pattern for the facility name:

```
IF fOwnsFacility:
  xfer_Name (TEdit) visible and enabled     → user can type new name
  NameLabel (TLabel) hidden
  On Enter key → MSProxy.Name := xfer_Name.Text   (property SET, WaitForAnswer=false)
ELSE:
  xfer_Name hidden
  NameLabel visible with current name text   → read-only display
```

---

## 7. HTML/ASP Embedded Web Views

The Voyager client embeds Internet Explorer (`TCustomWebBrowser` component in `Components/WebBrowser/`) for several features. These are **legacy features** — the ASP servers are no longer operational.

### Facility Image

**ObjectInspectorHandleViewer.pas:1156-1170** — `ShowImage()`:

```
{WorldURL}/Visual/Voyager/IsoMap/FacilityImage.asp
  ?ClassId={classId}
  &WorldName={worldName}
  &xPos={x}
  &yPos={y}
```

Loaded in the `IECompPanel` embedded browser at the top of the inspector.

### Facility Website

**IndustryGeneralSheet.pas:412-418** — `btnVisitSiteClick`:

```
{WorldURL}/Visual/Clusters/WebLoader.asp
  ?Page=Home
  &x={x}
  &y={y}
  &WorldName={world}
  &DAAddr={daAddr}
  &DAPort={daPort}
  &frame_Id=FacilitySiteView
  &frame_Class=HTMLView
  &frame_NoBorder=Yes
  &frame_Align=client
  &Access=MODIFY       ← only if owner (fOwnsFacility = true)
```

### Politics Page

**CapitolSheet.pas:264-273** and **TownHallSheet.pas:326-333**:

```
{WorldURL}/Visual/Voyager/Politics/politics.asp
  ?WorldName={world}
  &TycoonName={tycoonName}
  &Password={password}
  &Capitol=YES                ← only for Capitol, omitted for TownHall
  &TownName={townName}        ← only for TownHall
  &X={x}&Y={y}
  &DAAddr={daAddr}
  &DAPort={daPort}
```

### Newspaper / Rate Mayor

**TownHallSheet.pas:343-369**:

```
{WorldURL}/Visual/News/boardreader.asp       ← Rate Mayor
  ?WorldName={world}&Tycoon={name}&Password={pwd}&TownName={town}&PaperName={paper}&DAAddr=...&DAPort=...

{WorldURL}/Visual/News/newsreader.asp        ← Read News
  ?WorldName={world}&Tycoon={name}&Password={pwd}&TownName={town}&PaperName={paper}&DAAddr=...&DAPort=...
```

### WebClient Relevance

Both of these pages are live, and the gateway scrapes them — they are not an embedded web view
in the client, and nothing here is rendered as HTML: the gateway strips the markup and the
client draws React from the text.

- `boardreader.asp` / `boardmsg.asp` → the **editorial board** of `NewspaperModal`
  (`server/session/newspaper-handler.ts`), what "Rate the Mayor" opens.
- `newsreader.asp` → the **paper view** of the same modal (issue #516): its bar frame
  `ShowBar.asp` lists the kept issue folders, and `ShowPaper.asp:30` redirects to the issue's
  own `home.asp`, which is what the gateway fetches for the stories.

The URL patterns above are the parameters both still take.

---

## 8. Key Constants

### From ObjectInspectorHandleViewer.pas

```
tidObjectInspectorSection = 'InspectorInfo'    // :12
tidTabCount               = 'TabCount'          // :13
tidTabName                = 'TabName'            // :14
tidTabHandler             = 'TabHandler'         // :15
CacheConnectionTimeOut    = 60000               // :18 (ms)
MSConnectionTimeOut       = 60000               // :19
RDOProxyTimeOut           = 60000               // :20
MaxSheetHandlers          = 128                 // :29
```

### From ObjectInspectorHandler.pas

```
tidParmName_ClassId  = 'ClassId'               // :10
tidParmName_ObjectId = 'ObjectId'              // :11
tidParmName_xPos     = 'x'                     // :12
tidParmName_yPos     = 'y'                     // :13
htmlAction_ShowObject = 'SHOWOBJECT'           // :16
```

### From Protocol.pas

```
SecIdItemSeparator = '-'                       // :353
facStoppedByTycoon = $04                       // :119 (bitmask)
```

### From SheetUtils.pas

```
NA = 'n/a'                                     // :10 (default for empty properties)
```
