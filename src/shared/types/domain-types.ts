/**
 * Domain Types - Application Domain Entities
 * Contains business domain objects used throughout the application
 */

// =============================================================================
// WORLD & SESSION
// =============================================================================

export interface WorldInfo {
  name: string;
  url: string;
  ip: string;
  port: number;
  season?: string;
  mapSizeX?: number;
  mapSizeY?: number;
  players?: number;      // Online players count
  population?: number;   // Total population
  investors?: number;    // Investors count
  online?: number;       // Online count (same as players typically)
  date?: string;         // Server date
  running3?: boolean;    // Server online status (Interface/Running3)
}

export interface CompanyInfo {
  id: string;
  name: string;
  value?: number;
  ownerRole?: string; // Role de fonction publique (Maire, Ministre, Président) ou username du joueur
}

// =============================================================================
// MAP DATA STRUCTURES
// =============================================================================

export interface MapObject {
  id: string;
  typeId: number;
  x: number;
  y: number;
}

/**
 * Parsed building object from ObjectsInArea
 *
 * ObjectsInArea response format (5 lines per building):
 * Line 1: VisualClass - Building visual class ID (uint16)
 * Line 2: TycoonId - Owner player/company ID (uint16, 0 = no owner)
 * Line 3: OptionsByte - Encoded byte (see below)
 * Line 4: xPos - X coordinate (uint16)
 * Line 5: yPos - Y coordinate (uint16)
 *
 * OptionsByte encoding (spec Section 4.3):
 *   Bits 4-7: Level (encoded upgrade level: 1 + UpgradeLevel/10)
 *   Bits 1-3: Attack indicator (even values 0-14)
 *   Bit 0:    Alert flag (1 = facility losing money)
 *
 * Client-side decoding:
 *   level  = optionsByte >> 4          (unsigned shift right)
 *   alert  = (optionsByte & 0x0F) != 0 (any low nibble bit set)
 *   attack = optionsByte & 0x0E        (bits 1-3 of low nibble)
 */
export interface MapBuilding {
  visualClass: string; // Building visual class ID (from ObjectsInArea line 1)
  tycoonId: number;    // Owner player/company ID (from ObjectsInArea line 2)
  options: number;     // Raw encoded options byte (from ObjectsInArea line 3)
  x: number;           // X coordinate (from ObjectsInArea line 4)
  y: number;           // Y coordinate (from ObjectsInArea line 5)
  level: number;       // Decoded upgrade level indicator (options >> 4)
  alert: boolean;      // True if facility is losing money ((options & 0x0F) != 0)
  attack: number;      // Attack indicator (options & 0x0E, even values 0-14)
}

/**
 * Parsed road segment from SegmentsInArea
 */
export interface MapSegment {
  x1: number;          // Start X coordinate
  y1: number;          // Start Y coordinate
  x2: number;          // End X coordinate
  y2: number;          // End Y coordinate
  unknown1: number;    // Unknown value 1
  unknown2: number;    // Unknown value 2
  unknown3: number;    // Unknown value 3
  unknown4: number;    // Unknown value 4
  unknown5: number;    // Unknown value 5
  unknown6: number;    // Unknown value 6
}

/**
 * Map data with parsed structures
 */
export interface MapData {
  x: number;
  y: number;
  w: number;
  h: number;
  buildings: MapBuilding[];  // Changed from 'objects: string[]'
  segments: MapSegment[];    // Changed from 'segments: string[]'
}

// =============================================================================
// CHAT STRUCTURES
// =============================================================================

/** Nobility tier thresholds — sorted descending for reverse lookup. */
export const NOBILITY_TIERS = [
  { minPoints: 16000, label: 'Sr. Duke' },
  { minPoints: 8000,  label: 'Duke' },
  { minPoints: 4000,  label: 'Marquess' },
  { minPoints: 2000,  label: 'Earl' },
  { minPoints: 1000,  label: 'Viscount' },
  { minPoints: 500,   label: 'Baron' },
  { minPoints: 0,     label: 'Commoner' },
] as const;

/** Account modifier bit flags (upper 16 bits of AccDesc). */
export const CHAT_MODIFIER_FLAGS = {
  SUPPORT:     0x0001,
  DEVELOPER:   0x0002,
  PUBLISHER:   0x0004,
  AMBASSADOR:  0x0008,
  GAME_MASTER: 0x0010,
  TRIAL:       0x0020,
  NEWBIE:      0x0040,
  VETERAN:     0x0080,
  UNKNOWN:     0x8000,
} as const;

/**
 * Parse a packed AccDesc cardinal into nobility points, modifier flags, and tier label.
 *
 * AccDesc format (from Delphi Protocol.pas):
 * - Lower 16 bits (0x0000FFFF) = nobility points
 * - Upper 16 bits (0xFFFF0000) = modifier flags (shifted left 16)
 */
export function parseAccDesc(accDescStr: string): {
  nobilityPoints: number;
  modifiers: number;
  nobilityTier: string;
} {
  const accDesc = parseInt(accDescStr, 10) || 0;
  const nobilityPoints = accDesc & 0xFFFF;
  const modifiers = (accDesc >>> 16) & 0xFFFF;
  const tier = NOBILITY_TIERS.find(t => nobilityPoints >= t.minPoints) ?? NOBILITY_TIERS[NOBILITY_TIERS.length - 1];
  return { nobilityPoints, modifiers, nobilityTier: tier.label };
}

export interface ChatUser {
  name: string;
  id: string;
  status: number; // 0 = normal, 1 = typing
  nobilityPoints: number;
  nobilityTier: string;
  modifiers: number;
}

export interface ChatChannel {
  name: string;
  userCount?: number;
  info?: string;
}

// =============================================================================
// BUILDING FOCUS
// =============================================================================

export interface BuildingFocusInfo {
  buildingId: string;
  buildingName: string;
  ownerName: string;
  salesInfo: string;
  revenue: string;
  detailsText: string; // Ticker section 1 (sales/usage details)
  hintsText: string;   // Ticker section 2 (status/hints)
  x: number;
  y: number;
  xsize: number;       // Footprint width in tiles (enriched client-side)
  ysize: number;       // Footprint height in tiles (enriched client-side)
  visualClass: string; // Building type ID (enriched client-side)
  /**
   * Town Hall population/demographics, parsed from the RefreshObject ExtraInfo.
   * Present only for Town Hall facilities (the status text carries a class
   * breakdown). Undefined for every other building type.
   */
  demographics?: TownHallDemographics;
}

// =============================================================================
// TOWN HALL DEMOGRAPHICS
// =============================================================================
// Parsed from the RefreshObject/SwitchFocusEx ExtraInfo status text of a Town
// Hall. The Delphi server (TTownHall.GetStatusText) emits three ":-:" sections:
//   sttMain      -> "<total> inhabitants"
//   sttSecondary -> per-class "<count> <Class> class (<n>% unemp)" comma-joined
//   sttHint      -> per-class GetMoveReport (immigration/emigration + reasons)

/** Per-class population + unemployment line (sttSecondary). */
export interface TownHallClassStat {
  className: string;        // 'High' | 'Middle' | 'Low'
  population: number;       // e.g. 253
  populationLabel: string;  // e.g. "253" (as printed, with thousands separators)
  unemploymentPct: number;  // 0..100
}

/** A single "<pct>% due to <reason>" clause of a movement report. */
export interface TownHallMovementReason {
  pct: number;    // e.g. 54
  reason: string; // e.g. "lack of products and services"
}

/** Per-class citizen movement report (sttHint). */
export interface TownHallMovement {
  className: string;                  // 'High' | 'Middle' | 'Low'
  direction: 'none' | 'in' | 'out';   // 'none' => "No <Class> class movements."
  count: number;                      // citizens moved (0 when direction === 'none')
  reasons: TownHallMovementReason[];  // empty when direction === 'none'
}

/** Structured Town Hall demographics, attached to BuildingFocusInfo. */
export interface TownHallDemographics {
  totalInhabitants: number;        // e.g. 18372
  totalInhabitantsLabel: string;   // e.g. "18,372" (as printed)
  classes: TownHallClassStat[];
  movements: TownHallMovement[];
}

// =============================================================================
// BUILDING CONSTRUCTION
// =============================================================================

export interface BuildingCategory {
  kindName: string;           // Display name (e.g., "Commerce")
  kind: string;               // Kind identifier (e.g., "PGIServiceFacilities")
  cluster: string;            // Cluster identifier (e.g., "PGI")
  folder: string;             // Folder identifier
  tycoonLevel: number;        // Required tycoon level
  iconPath: string;           // Category icon path
}

export interface BuildingInfo {
  name: string;               // Building display name
  facilityClass: string;      // Class identifier (e.g., "PGIFoodStore")
  visualClassId: string;      // Visual class ID for rendering
  cost: number;               // Construction cost in dollars
  area: number;               // Building size in square meters
  description: string;        // Building description
  zoneRequirement: string;    // Zone type requirement
  iconPath: string;           // Building icon path
  available: boolean;         // Whether player can build this
  residenceClass?: 'high' | 'middle' | 'low'; // Derived from zone requirement text
  xsize?: number;             // Width in tiles (from FacilityDimensions)
  ysize?: number;             // Height in tiles (from FacilityDimensions)
}

// =============================================================================
// CLUSTER / COMPANY CREATION
// =============================================================================

export interface ClusterInfo {
  id: string;                      // 'PGI', 'Moab', 'Dissidents', 'Magna', 'Mariko'
  displayName: string;             // 'Mariko Enterprises', 'The Moab', etc.
  description: string;             // Lore text from info.asp
  categories: ClusterCategory[];
}

export interface ClusterCategory {
  name: string;                    // 'Headquarters', 'Farms', etc.
  folder: string;                  // '00000003.DissidentsFarms.five'
}

export interface ClusterFacilityPreview {
  name: string;                    // 'Company Headquarters'
  iconUrl: string;                 // Proxy URL for icon
  cost: string;                    // '$8,000K' — CacheClass.ImportPrice
  // Ground surface, NOT a duration: the page renders CacheClass.Size
  // (NewLogon/FacilityList.asp:227). Was named `buildTime` and displayed as one.
  area: string;                    // '3600 m.'
  zoneType: string;                // Zone tooltip text
  description: string;             // Optional description
}

// =============================================================================
// SURFACE / ZONE OVERLAYS
// =============================================================================

export interface SurfaceData {
  width: number;              // Grid width (typically 65)
  height: number;             // Grid height (typically 65)
  rows: number[][];           // 2D array of zone values
}

export interface FacilityDimensions {
  visualClass: string;        // Visual class identifier (matches ObjectsInArea response)
  name: string;               // Building name
  facid: string;              // Internal FacID
  xsize: number;              // Building width in tiles
  ysize: number;              // Building height in tiles
  level: number;              // Building level/tier
  textureFilename?: string;   // Complete building texture filename
  emptyTextureFilename?: string;  // Empty residential texture filename
  constructionTextureFilename?: string;  // Construction state texture filename
  animated?: boolean;         // Whether sprite has animation frames (from CLASSES.BIN)
  animArea?: { left: number; top: number; right: number; bottom: number };  // Animation sub-region
}

export interface ZoneOverlayState {
  enabled: boolean;
  surfaceType: SurfaceType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  data: SurfaceData | null;
}

export enum SurfaceType {
  // Special overlays (ssUnder — tint ground tiles)
  ZONES = 'ZONES',
  TOWNS = 'TOWNS',
  // Environment overlays (ssOver — gradient heatmaps)
  BEAUTY = 'Beauty',
  CRIME = 'Crime',
  POLLUTION = 'Pollution',
  QOL = 'QOL',
  BAP = 'BAP',
  // Population overlays
  HI_PEOPLE = 'hiPeople',
  MID_PEOPLE = 'midPeople',
  LO_PEOPLE = 'loPeople',
  // Market overlays
  FRESH_FOOD = 'FreshFood',
  ELAB_FOOD = 'ElabFood',
  CLOTHES = 'Clothes_Market',
  APPLIANCES = 'HouseHoldingAppliances',
  CARS = 'Cars_Market',
  RESTAURANT = 'Restaurant',
  BAR = 'Bar',
  TOYS = 'Toys',
  DRUGS = 'Drugs',
  MOVIE = 'Movie',
  GASOLINE = 'Gasoline',
  COMPUTERS = 'Computers',
  FURNITURE = 'Furniture',
  BOOKS = 'Books',
  CDS = 'CDs',
  FUNERAL = 'Funeral',
}

/**
 * Overlay metadata for the overlay selector UI.
 * Color scales match the Delphi MapIsoView.pas SurfaceData definitions.
 * Each entry has 3 color scale points for linear RGB interpolation.
 */
export interface OverlayInfo {
  type: SurfaceType;
  label: string;
  category: 'special' | 'environment' | 'population' | 'market';
}

export const OVERLAY_LIST: OverlayInfo[] = [
  // Special
  { type: SurfaceType.ZONES,      label: 'City Zones',              category: 'special' },
  { type: SurfaceType.TOWNS,      label: 'Towns',                   category: 'special' },
  // Environment
  { type: SurfaceType.BEAUTY,     label: 'Beauty',                  category: 'environment' },
  { type: SurfaceType.QOL,        label: 'QOL',                     category: 'environment' },
  { type: SurfaceType.CRIME,      label: 'Crime',                   category: 'environment' },
  { type: SurfaceType.POLLUTION,  label: 'Pollution',               category: 'environment' },
  { type: SurfaceType.BAP,        label: 'BAP',                     category: 'environment' },
  // Population
  { type: SurfaceType.HI_PEOPLE,  label: 'High-class Population',   category: 'population' },
  { type: SurfaceType.MID_PEOPLE, label: 'Middle-class Population',  category: 'population' },
  { type: SurfaceType.LO_PEOPLE,  label: 'Low-class Population',    category: 'population' },
  // Market
  { type: SurfaceType.FRESH_FOOD, label: 'Fresh Food',              category: 'market' },
  { type: SurfaceType.ELAB_FOOD,  label: 'Processed Food',          category: 'market' },
  { type: SurfaceType.CLOTHES,    label: 'Clothes',                 category: 'market' },
  { type: SurfaceType.APPLIANCES, label: 'Appliances',              category: 'market' },
  { type: SurfaceType.CARS,       label: 'Cars',                    category: 'market' },
  { type: SurfaceType.RESTAURANT, label: 'Restaurants',             category: 'market' },
  { type: SurfaceType.BAR,        label: 'Bar',                     category: 'market' },
  { type: SurfaceType.TOYS,       label: 'Toys',                    category: 'market' },
  { type: SurfaceType.DRUGS,      label: 'Drugs',                   category: 'market' },
  { type: SurfaceType.MOVIE,      label: 'Movies',                  category: 'market' },
  { type: SurfaceType.GASOLINE,   label: 'Gas',                     category: 'market' },
  { type: SurfaceType.COMPUTERS,  label: 'Computers',               category: 'market' },
  { type: SurfaceType.FURNITURE,  label: 'Furniture',               category: 'market' },
  { type: SurfaceType.BOOKS,      label: 'Books',                   category: 'market' },
  { type: SurfaceType.CDS,        label: 'CDs',                     category: 'market' },
  { type: SurfaceType.FUNERAL,    label: 'Funeral',                 category: 'market' },
];

// =============================================================================
// ZONE TYPES (for zone painting)
// =============================================================================

/**
 * Zone types matching Delphi Protocol.pas TZoneType constants (0-9).
 * Colors converted from Delphi BGR ($00BBGGRR) → CSS RGB hex.
 */
export enum ZoneType {
  NONE = 0,
  RESERVED = 1,
  RESIDENTIAL = 2,
  HI_RESIDENTIAL = 3,
  MID_RESIDENTIAL = 4,
  LO_RESIDENTIAL = 5,
  INDUSTRIAL = 6,
  COMMERCIAL = 7,
  CIVICS = 8,
  OFFICES = 9,
}

export interface ZoneTypeInfo {
  id: ZoneType;
  label: string;
  color: string;
  overlayColor: string;
}

export const ZONE_TYPES: ZoneTypeInfo[] = [
  { id: ZoneType.NONE,            label: 'Erase',              color: '#595959', overlayColor: 'rgba(89,89,89,0.3)' },
  { id: ZoneType.RESERVED,        label: 'Reserved',           color: '#800000', overlayColor: 'rgba(128,0,0,0.3)' },
  { id: ZoneType.RESIDENTIAL,     label: 'Residential',        color: '#008080', overlayColor: 'rgba(0,128,128,0.3)' },
  { id: ZoneType.HI_RESIDENTIAL,  label: 'High Residential',   color: '#C0FFBB', overlayColor: 'rgba(192,255,187,0.3)' },
  { id: ZoneType.MID_RESIDENTIAL, label: 'Mid Residential',    color: '#4FA343', overlayColor: 'rgba(79,163,67,0.3)' },
  { id: ZoneType.LO_RESIDENTIAL,  label: 'Low Residential',    color: '#23481E', overlayColor: 'rgba(35,72,30,0.3)' },
  { id: ZoneType.INDUSTRIAL,      label: 'Industrial',         color: '#D7D988', overlayColor: 'rgba(215,217,136,0.3)' },
  { id: ZoneType.COMMERCIAL,      label: 'Commercial',         color: '#4974D8', overlayColor: 'rgba(73,116,216,0.3)' },
  { id: ZoneType.CIVICS,          label: 'Civics',             color: '#FFFFFF', overlayColor: 'rgba(255,255,255,0.3)' },
  { id: ZoneType.OFFICES,         label: 'Offices',            color: '#394488', overlayColor: 'rgba(57,68,136,0.3)' },
];

// =============================================================================
// BUILDING DETAILS
// =============================================================================

/**
 * Property value from building details
 */
export interface BuildingPropertyValue {
  /** Property name */
  name: string;
  /** Raw value from server */
  value: string;
  /** Index for indexed properties (e.g., Workers0, Workers1) */
  index?: number;
}

/**
 * Supply/input connection data
 */
export interface BuildingConnectionData {
  /** Connected facility name */
  facilityName: string;
  /** Company name */
  companyName: string;
  /** Creator */
  createdBy: string;
  /** Price */
  price: string;
  /** Overprice percentage */
  overprice: string;
  /** Last transaction value */
  lastValue: string;
  /** Cost */
  cost: string;
  /** Quality */
  quality: string;
  /** Connected status */
  connected: boolean;
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
}

/**
 * Supply/input gate.
 *
 * A gate arrives in two stages, and the type says which one it is in.
 *
 * Listing a building's gates costs one RDO call (`GetInputNames`) and yields
 * `path` and `name` — those two are always present. Everything else lives on
 * the gate itself and costs a `SetPath` + `GetPropertyList` to read, so it is
 * read only when the user opens that gate, exactly as the reference client does
 * (`LoadFingerInfo` runs for `CurrentFinger` alone,
 * Voyager/SupplySheetForm.pas:440-506). Until then those fields are `undefined`
 * — meaning NOT READ YET, never "zero" or "empty". A renderer that shows `0`
 * for an unread `connectionCount` is stating something the server never said.
 *
 * `connections` is the one exception: it is always an array, empty until the
 * gate is read. Whether that emptiness means "none" or "not read yet" is
 * carried by `gateLoadingStates` in the building store, which the panels
 * already consult.
 */
export interface BuildingSupplyData {
  /** Supply path — from GetInputNames, always present. */
  path: string;
  /** Supply name (e.g., "Pharmaceutics") — from GetInputNames, always present. */
  name: string;
  /** Meta fluid type. Undefined until the gate is opened. */
  metaFluid?: string;
  /** Current value. Undefined until the gate is opened. */
  fluidValue?: string;
  /** Last cost percentage */
  lastCostPerc?: string;
  /** Minimum quality threshold */
  minK?: string;
  /** Maximum price willing to pay (0-1000) */
  maxPrice?: string;
  /** Whether sorted by Q/P ratio */
  qpSorted?: string;
  /** Sort mode: 0=cost, 1=quality */
  sortMode?: string;
  /** Connection count. Undefined until the gate is opened — not zero. */
  connectionCount?: number;
  /** Connections — empty until the gate is opened. */
  connections: BuildingConnectionData[];
}

/**
 * Product/output gate.
 *
 * Two-stage like {@link BuildingSupplyData}, for the same reason: `GetOutputNames`
 * lists the gates and gives `path` and `name`; everything else is read off the
 * gate itself when the user opens it. Undefined means NOT READ YET.
 */
export interface BuildingProductData {
  /** Output gate path — from GetOutputNames, always present. */
  path: string;
  /** Product name (e.g., "Chemicals", "Clothing") — from GetOutputNames, always present. */
  name: string;
  /** Meta fluid type identifier. Undefined until the gate is opened. */
  metaFluid?: string;
  /** Last produced value (LastFluid). Undefined until the gate is opened. */
  lastFluid?: string;
  /** Quality percentage (FluidQuality). Undefined until the gate is opened. */
  quality?: string;
  /** Sell price percentage (PricePc, 0-300, 100=market). Undefined until the gate is opened. */
  pricePc?: string;
  /** Average price percentage (AvgPrice). Undefined until the gate is opened. */
  avgPrice?: string;
  /** Market price (absolute value). Undefined until the gate is opened. */
  marketPrice?: string;
  /** Connection count. Undefined until the gate is opened — not zero. */
  connectionCount?: number;
  /** Output connections (clients/buyers) — empty until the gate is opened. */
  connections: BuildingConnectionData[];
}

/**
 * Company input entry — eagerly fetched via cInputCount + indexed cInput{i}.* properties.
 * Handler: compInputs (CompanyServicesSheetForm.pas)
 * Displayed as per-input sections with demand slider, supply bar, and supplied/demanded text.
 * RDO: RDOSetCompanyInputDemand(inputIndex, percValue)
 *
 * Note: Config 6 HQ buildings use a tab also named "SERVICES" but with the Supplies handler
 * (GetInputNames + SetPath protocol), not this compInputs protocol.
 */
export interface CompInputData {
  /** Display name — cInput{i}.0 (e.g. "Advertisement", "Computer Services") */
  name: string;
  /** Amount supplied — cInputSup{i} */
  supplied: number;
  /** Amount demanded — cInputDem{i} */
  demanded: number;
  /** Supply/demand ratio 0-100 — cInputRatio{i} = min(100, round(100 * supplied / demanded)) */
  ratio: number;
  /** Maximum demand capacity — cInputMax{i} */
  maxDemand: number;
  /** Whether this input can be edited — cEditable{i} === 'yes' */
  editable: boolean;
  /** Unit label — cUnits{i}.0 (e.g. "hits", "hours") */
  units: string;
}

/**
 * Warehouse ware/gate data — one entry per input gate.
 * Populated from GetInputNames RDO call + GateMap binary string.
 * Archaeology: WHGeneralSheet.pas clbNames checklist, TWareInfo record
 */
export interface WarehouseWareData {
  /** Ware display name (from GetInputNames path parsing) */
  name: string;
  /** Whether this gate is enabled (GateMap char = '1') */
  enabled: boolean;
  /** Gate index (0-based) */
  index: number;
}

/**
 * Tab metadata sent from server to client.
 * Driven by CLASSES.BIN [InspectorInfo] section — each building class
 * defines exactly which tabs to display.
 */
export interface BuildingDetailsTab {
  /** Unique tab ID (group ID, possibly handler-suffixed for uniqueness) */
  id: string;
  /** Display name from CLASSES.BIN (e.g., "GENERAL", "PRODUCTS", "JOBS") */
  name: string;
  /** Icon character for the tab button */
  icon: string;
  /** Sort order for tab navigation */
  order: number;
  /** Special rendering hint: 'supplies' | 'finances' | 'workforce' | 'upgrade' etc. */
  special?: string;
  /** Original handler name from CLASSES.BIN [InspectorInfo] (e.g., "IndGeneral", "Supplies") */
  handlerName: string;
}

/**
 * Complete building details response
 */
export interface BuildingDetailsResponse {
  /** Building ID */
  buildingId: string;
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
  /** Visual class ID */
  visualClass: string;
  /** Template name used */
  templateName: string;
  /** Building name (from focus) */
  buildingName: string;
  /** Owner name (from focus) */
  ownerName: string;
  /** Security/owner ID */
  securityId: string;
  /**
   * Does this session's tycoon govern this facility?
   *
   * `grantAccess(fTycoonProxyId, securityId)`, decided by the gateway because
   * only the gateway holds the requester half. Both ids are **object pointers**
   * — `TTycoon.GetSecurityId` builds the list from `integer(Tycoon)`
   * (Kernel/Kernel.pas:11135-11154) and Voyager's own requester id is the
   * `InitClient` push's 4th argument (ServerCnxHandler.pas:514-516), which is
   * `integer(Tycoon)` too (Kernel/World.pas:3827).
   *
   * NOT `ctx.tycoonId`: that is the persistent `TTycoon.Id`, a small ordinal,
   * and it never appears in a SecurityId. See building-property-handler.ts:542.
   */
  canGovern: boolean;
  /** Tab configuration from CLASSES.BIN [InspectorInfo] — drives tab navigation */
  tabs: BuildingDetailsTab[];
  /** All property values grouped by tab */
  groups: { [groupId: string]: BuildingPropertyValue[] };
  /** Supply/input data (if applicable) */
  supplies?: BuildingSupplyData[];
  /** Product/output data (if applicable) */
  products?: BuildingProductData[];
  /** Company input data — eagerly fetched via cInputCount + cInput{i}.* indexed properties */
  compInputs?: CompInputData[];
  /** Warehouse ware data — gate names + enable/disable state from GateMap */
  warehouseWares?: WarehouseWareData[];
  /** Money graph data points */
  moneyGraph?: number[];
  /** Timestamp */
  timestamp: number;
  /** When set, only these group IDs were refreshed (R1 tab-scoped refresh).
   *  Client should merge these groups into existing details, keeping other groups intact. */
  refreshedGroups?: string[];
}

// =============================================================================
// SEARCH MENU / DIRECTORY
// =============================================================================

/**
 * Search menu navigation item
 */
export interface SearchMenuCategory {
  id: string;
  label: string;
  enabled: boolean;
  iconUrl?: string;
  x?: number;
  y?: number;
}

/**
 * Town information from Towns.asp
 */
export interface TownInfo {
  name: string;
  iconUrl: string;
  mayor: string | null;
  population: number;
  unemploymentPercent: number;
  qualityOfLife: number;
  x: number;
  y: number;
  path: string;
  classId: string;
}

/** One row of the directory's Media page (New Directory/Newspapers.asp:12-24). */
export interface NewspaperListing {
  paperName: string;
  townName: string;
}

/**
 * Tycoon profile from RenderTycoon.asp
 */
export interface TycoonProfile {
  name: string;
  photoUrl: string;
  fortune: number;
  thisYearProfit: number;
  ntaRanking: string;
  level: string;
  prestige: number;
  profileUrl: string;
  companiesUrl: string;
}

/**
 * Ranking category item (tree structure)
 */
export interface RankingCategory {
  id: string;
  label: string;
  url: string;
  level: number;
  children?: RankingCategory[];
}

/**
 * Ranking detail entry
 */
export interface RankingEntry {
  rank: number;
  name: string;
  value: number;
  photoUrl?: string;
}

// =============================================================================
// MAIL SYSTEM
// =============================================================================

/**
 * Standard mail folder names (matching original MailConsts.pas)
 */
export type MailFolder = 'Inbox' | 'Sent' | 'Draft';

/**
 * Mail message header (from msg.header ini-style key=value pairs)
 */
export interface MailMessageHeader {
  messageId: string;
  fromAddr: string;      // Sender's mail address (e.g., alice@starworld.net)
  toAddr: string;        // Recipient address(es), semicolon-separated
  from: string;          // Sender display name
  to: string;            // Recipient display name(s)
  subject: string;
  date: string;          // In-game date as float string
  dateFmt: string;       // Human-readable date string
  read: boolean;         // false=unread, true=read
  stamp: number;         // 0-99 random value for visual variety
  noReply: boolean;      // true=system message, no reply allowed
}

/**
 * Full mail message with body and attachments
 */
export interface MailMessageFull extends MailMessageHeader {
  body: string[];               // Message body lines
  attachments: MailAttachment[];
  stampUrl?: string;            // Proxied stamp picture (MessageHeader.asp:167-169); absent when no world is joined
}

/**
 * Mail attachment (from attach*.ini files)
 */
export interface MailAttachment {
  class: string;                       // Attachment type (e.g., "MoneyTransfer")
  properties: Record<string, string>;  // Key=value pairs from [Properties] section
  executed: boolean;
}

// =============================================================================
// TYCOON PROFILE (EXTENDED)
// =============================================================================

/**
 * Extended tycoon profile data from TTycoon RDO properties
 */
export interface TycoonProfileFull {
  name: string;
  realName: string;
  ranking: number;
  budget: string;            // Large number as string (TMoney)
  prestige: number;
  facPrestige: number;
  researchPrestige: number;
  facCount: number;
  facMax: number;
  area: number;
  nobPoints: number;
  licenceLevel: number;
  failureLevel: number;
  levelName: string;
  levelTier: number;
  photoUrl?: string;         // Avatar photo URL (from RenderTycoon.asp)
}

// =============================================================================
// PROFILE TABS - CURRICULUM
// =============================================================================

/**
 * Curriculum/level data for the tycoon profile Curriculum tab.
 * Uses existing TycoonProfileFull fields + level progression constants from TycoonLevels.pas.
 */
export interface CurriculumData {
  tycoonName: string;
  currentLevel: number;
  currentLevelName: string;
  currentLevelDescription: string;
  /** Proxied URL of the level badge (TycoonCurriculum.asp:228-236), '' when the page has none. */
  currentLevelBadgeUrl: string;
  /** Obj.LevelCond — rendered only past level 5 (TycoonCurriculum.asp:245-249), '' otherwise. */
  currentLevelCondition: string;
  /** Obj.LevelReqStatus — the maroon banner (TycoonCurriculum.asp:262-266), '' when absent. */
  levelReqStatus: string;
  nextLevelName: string;
  nextLevelDescription: string;
  nextLevelRequirements: string;
  canUpgrade: boolean;
  isUpgradeRequested: boolean;
  fortune: string;
  averageProfit: string;
  prestige: number;
  facPrestige: number;
  researchPrestige: number;
  budget: string;
  ranking: number;
  facCount: number;
  facMax: number;
  area: number;
  nobPoints: number;
  tournamentOn: boolean;
  abilityTotal: number;
  abilityRankingPoints: number;
  abilityLevelPoints: number;
  abilityLoanPoints: number;
  rankings: CurriculumRanking[];
  curriculumItems: CurriculumItem[];
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

export interface CurriculumRanking {
  category: string;
  rank: number | null;
}

export interface CurriculumItem {
  item: string;
  prestige: number;
}

export type CurriculumActionType = 'resetAccount' | 'abandonRole' | 'upgradeLevel' | 'rebuildLinks';

// =============================================================================
// PROFILE TABS - BANK ACCOUNT
// =============================================================================

export interface LoanInfo {
  bank: string;
  date: string;
  amount: string;
  interest: number;
  term: number;
  slice: string;
  loanIndex: number;
}

/** Why TycoonBankAccount.asp offers no Send form — the explanation it prints in its place
 *  (`:506` StrTyconBank_28 / `:476` _16 / `:478` _17 / `:467`,`:488` _27). */
export type TransferDenial = 'tournament' | 'loans' | 'no-money' | 'demo';

export interface BankAccountData {
  balance: string;
  maxLoan: string;
  totalLoans: string;
  /** The digits of the "You can transfer up to $X" note (`TycoonBankAccount.asp:438`);
   *  **absent** when the page carries no note — never `'0'`. */
  maxTransfer?: string;
  /** Why the page printed an explanation instead of the Send form; absent when it offers it. */
  transferDenied?: TransferDenial;
  totalNextPayment: string;
  loans: LoanInfo[];
  defaultInterest: number;
  defaultTerm: number;
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

export type BankActionType = 'borrow' | 'send' | 'payoff';

export interface BankActionResult {
  success: boolean;
  message: string;
}

// =============================================================================
// PROFILE TABS - PROFIT & LOSS
// =============================================================================

export interface ProfitLossNode {
  label: string;
  level: number;
  amount: string;
  chartData?: number[];
  isHeader?: boolean;
  children?: ProfitLossNode[];
}

// Declaration merging: adds the tax fields without touching the interface block above
// (kept verbatim for the plan's invariant).
export interface ProfitLossNode {
  /** Tax account (TycoonProfitAndLoses.asp:167, :179 — Obj.AccountIsTax). On the level-2
   *  header the page renders the Town / IFEL captions; on each row beneath, the split. */
  isTax?: boolean;
  /** The IFEL share of `amount` (:190, FormatValue(AccountSecValue)); Town = amount − secAmount
   *  (:183). Only on a tax row deeper than level 2. Same signed, group-free format as `amount`. */
  secAmount?: string;
}

export interface ProfitLossData {
  root: ProfitLossNode;
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

// =============================================================================
// PROFILE TABS - COMPANIES
// =============================================================================

export interface CompanyListItem {
  name: string;
  companyId: number;
  ownerRole: string;
  cluster: string;
  facilityCount: number;
  companyType: string;
}

export interface CompaniesData {
  companies: CompanyListItem[];
  currentCompany: string;
  worldName: string;
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

// =============================================================================
// PROFILE TABS - AUTO CONNECTIONS (INITIAL SUPPLIERS)
// =============================================================================

export interface SupplierEntry {
  facilityName: string;
  facilityId: string;
  companyName: string;
}

export interface AutoConnectionFluid {
  /** Localised product name — TycoonAutoConnections.asp:90 */
  fluidName: string;
  /** Internal fluid id, the `<div id=…>` of the section header — :89 */
  fluidId: string;
  suppliers: SupplierEntry[];
  hireTradeCenter: boolean;
  onlyWarehouses: boolean;
  /**
   * Whether the product can be warehoused. The `…HireWH` checkbox is rendered
   * only under `Obj.Properties("AutoConnection<Fluid>Storable")` (:103-104), so
   * a missing checkbox means "not storable", not "storable but unchecked" —
   * without this flag the client cannot tell the two apart.
   */
  storable: boolean;
}

export interface AutoConnectionsData {
  fluids: AutoConnectionFluid[];
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

export type AutoConnectionActionType = 'add' | 'delete' | 'hireTradeCenter' | 'dontHireTradeCenter' | 'onlyWarehouses' | 'dontOnlyWarehouses';

// =============================================================================
// PROFILE TABS - POLICY (STRATEGY)
// =============================================================================

export interface PolicyEntry {
  tycoonName: string;
  yourPolicy: number;
  theirPolicy: number;
}

export interface PolicyData {
  policies: PolicyEntry[];
  /** `false` when the page comments out the Ally option (`TycoonPolicy.asp:96`, `:451`,
   *  world flag `AlliesPageOn` off, `:56`): the stance may still be READ, never OFFERED. */
  alliesAllowed: boolean;
  /** `true` when the page carried "cannot retrieve Tycoon information from server"
   *  (ObjValid=false — e.g. TycoonBankAccount.asp:304/:623) or the fetch itself failed;
   *  absent on a page that parsed. The rest of the object is the neutral default. */
  cacheUnavailable?: boolean;
}

// =============================================================================
// POLITICS
// =============================================================================

export interface PoliticsRatingEntry {
  name: string;
  value: number;
  /**
   * Rating cache Id — the `RatingId` argument of `RDOSetRatingFrom` /
   * `RDOSetPublicity` (Kernel/PoliticsCache.pas:65 writes it as `Id`).
   *
   * Only the two pages that let you CHANGE a value carry it in their markup:
   * `tycoonratings.asp:135` and `mayorpub.asp` render `<tr id=<Id>>`.
   * `popularratings.asp:66` and `ifelratings.asp:64` render the same row
   * WITHOUT an id — those two tabs are read-only, so their entries have none.
   */
  id?: string;
}

/**
 * One row of the PUBLICITY tab (`mayorpub.asp`).
 *
 * `level` is the raw 0/25/50/75/100 the `<select>` posts, not the label:
 * `RulerPublicity` is quantised to 25 (`mayorpub.asp:169`) and the five labels
 * Lowest..Highest are just its rendering (`ePolitics.lng` StrMayorPub_5..9).
 */
export interface PoliticsPublicityEntry {
  id: string;
  name: string;
  level: number;
}

export interface PoliticsCampaignEntry {
  candidateName: string;
  rating: number;
  /** `Prestige{i}` — Kernel/PoliticsCache.pas:162, Kernel/WorldPolitics.pas:1398. */
  prestige: number;
  /**
   * `opositiondata.asp:53` — `/fivedata/userinfo/<World>/<Tycoon>/largephoto.jpg`,
   * absolute on the world host, built by the gateway like `rulerPhotoUrl`.
   * Empty string when the entry has no name (never an `<img>` for it).
   */
  photoUrl: string;
}

/**
 * One row of the YOUR CAMPAIGN project list (`tycooncampaign.asp:250-315`).
 *
 * Two shapes share the row, told apart by the cache object's `TypeId`:
 *  - `minister` — a tycoon name to appoint, free text, with a validation state;
 *  - `goal` — a numeric promise rendered as "More than"/"Less than" N %.
 */
export interface PoliticsProjectEntry {
  id: string;
  name: string;
  kind: 'minister' | 'goal';
  /** minister only — the proposed tycoon, empty when none is proposed yet. */
  ministerName?: string;
  /** minister only — `ProposalState`: 1 unknown name, 2 not eligible, 3 OK. */
  proposalState?: 1 | 2 | 3;
  /**
   * goal only — the comparator the page printed, VERBATIM.
   *
   * `tycooncampaign.asp:295-299` picks between `strMoreThan` and `strLessThan`
   * on `CacheObj.Mode`, and both come from `ePolitics.lng`, which is localised
   * per the tycoon's `LangId`. There is no structural difference between the
   * two branches, so the words are the only signal — and matching them against
   * the English pair would silently mislabel every non-English player. We carry
   * the server's own words through to the UI instead of guessing a boolean.
   */
  comparator?: string;
  /** goal only — the promised percentage. */
  value?: number;
}

/**
 * Which of the five mutually exclusive states the YOUR CAMPAIGN panel is in.
 *
 *  - `running`     — you have a campaign; the panel offers Withdraw + projects
 *  - `available`   — you have none and may launch one
 *  - `ruler`       — you already hold the office (`tycooncampaign.asp:391`)
 *  - `refused`     — a launch was attempted and denied (`:400-413`)
 *  - `noElections` — tournament planet (`tycooncampaignnoelections.asp`)
 */
export type CampaignState = 'running' | 'available' | 'ruler' | 'refused' | 'noElections';

export interface PoliticsData {
  townName: string;
  /** Capitol (president) vs Town Hall (mayor) — changes every label and both thresholds. */
  isCapitol: boolean;
  hasRuler: boolean;
  yearsToElections: number;

  // -- The ruler (mayordata.asp) -------------------------------------------
  mayorName: string;
  mayorPrestige: number;
  /** Popular rating — `RulerRating`. */
  mayorRating: number;
  tycoonsRating: number;
  ifelRating: number;
  /** `RulerPeriods` — displayed as "Mandate No". */
  mandateNo: number;
  /**
   * Absolute URL of the ruler's portrait, or `''` when there is no ruler.
   *
   * Built server-side because only the gateway knows the world's IP.
   * `mayordata.asp:39` composes the same path, and ships it behind an
   * `if true then` where a `FileExists` check used to be (`:40`) — so the file
   * is frequently absent and the client must survive a 404 on it.
   */
  rulerPhotoUrl: string;

  /**
   * Is the player reading this page the holder of the office it describes?
   *
   * Answered server-side, once, by `holdsOffice` (politics-handler.ts) — the
   * only place in the codebase allowed to ask the question. It is not a
   * comparison the client can redo safely: the reference test has two prongs
   * (`tycooncampaign.asp:98`), and which prong fires depends on which identity
   * the session is currently operating under. Only the gateway holds both the
   * human login name and the role name a company switch installs, so only the
   * gateway can answer without guessing (OB-31).
   *
   * `false` whenever the answer is unknown — including the offline default —
   * so an unanswerable question never grants a power.
   */
  isRuler: boolean;

  // -- The rating rails (ratingtabs.asp) ------------------------------------
  popularRatings: PoliticsRatingEntry[];
  ifelRatings: PoliticsRatingEntry[];
  tycoonsRatings: PoliticsRatingEntry[];
  publicity: PoliticsPublicityEntry[];
  /** `Obj.Ads` — hits/hour currently purchased, as the page prints it. */
  publicityAds: string;

  // -- The opposition (opositiondata.asp / allcampaigns.asp) ----------------
  campaignCount: number;
  campaigns: PoliticsCampaignEntry[];

  // -- Your campaign (tycooncampaign.asp) -----------------------------------
  campaignState: CampaignState;
  campaignMessage: string;
  canLaunchCampaign: boolean;
  /** Prestige needed to be accepted: 200 for a town, 1000 for the Capitol. */
  prestigeThreshold: number;
  projects: PoliticsProjectEntry[];
  promise: string;

  /**
   * Model-server id of the political entity — the bind target of the three
   * politics mutations. `TownHallId` on the cache object
   * (Kernel/PoliticsCache.pas:156 = the Town Hall's `CurrBlock`;
   * Kernel/WorldPolitics.pas:1413 = the presidential hall itself).
   * `0` when the property could not be read — the mutations refuse to emit.
   */
  townHallId: number;
}

// =============================================================================
// NEWSPAPER — the town paper's editorial board (Visual/News/boardmsg.asp)
// =============================================================================

/** One entry of the index, or one reply — the two share a shape. */
export interface NewspaperColumn {
  author: string;
  subject: string;
  /** Board path, the id every board link carries. Opens the column. */
  path: string;
  summary: string;
}

/**
 * One open column.
 *
 * `body` is PLAIN TEXT, not markup: `boardmsg.asp:255` emits `NewsObj.BodyHTML`,
 * which is HTML typed by other players, and this client has no sanitiser. The
 * tags are stripped at the gateway.
 */
export interface NewspaperArticle {
  subject: string;
  /** "By <author> <description>", as the page prints it (`boardmsg.asp:258`). */
  byline: string;
  body: string;
  replies: NewspaperColumn[];
  /**
   * Board path of the parent column — the `path` of the Up link
   * (`boardmsg.asp:236`). `''` when the parent is the board root: the index
   * is what "All columns" already opens, so there is nothing to go up to.
   */
  parentPath: string;
  /** Absolute URL of the author's portrait (`boardmsg.asp:244`), or `''`. */
  photoUrl: string;
}

export interface NewspaperBoard {
  paperName: string;
  /** `boards\<World>\<Paper>\` — the board root (`boardreader.asp:5`). */
  root: string;
  /** What this response describes: the root for the index, else a column path. */
  path: string;
  /** The latest columns. Empty when `article` is set — the index is not rendered then. */
  columns: NewspaperColumn[];
  article: NewspaperArticle | null;
  /** Non-empty when the board could not be read; everything else is then empty. */
  error: string;
}

// =============================================================================
// NEWSPAPER — the daily paper (Visual/News/Newsreader.asp)
// =============================================================================

/** One kept issue: the folder `ShowBar.asp` iterates and the date it prints for it. */
export interface NewspaperIssueRef {
  /** `<issueId>@<date>`, the folder name (`News.pas:986`). The id of the issue. */
  folder: string;
  /** What the bar shows for it — `DecodeDate(folder)` (`ShowBar.asp:14-31`). */
  date: string;
}

/**
 * One story of an issue.
 *
 * `body` is PLAIN TEXT, not markup, for the same reason as `NewspaperArticle`:
 * nothing leaves the gateway as HTML, so the client never needs a sanitiser.
 */
export interface NewspaperStory {
  headline: string;
  /** `<div class=author>` when the story carries one, else empty. */
  byline: string;
  body: string;
}

export interface NewspaperIssueList {
  paperName: string;
  /** Newest first — the folder id is `IssueMax - Issue` (`News.pas:956-961`). */
  issues: NewspaperIssueRef[];
  /** Non-empty when the bar could not be read; `issues` is then empty. */
  error: string;
}

export interface NewspaperIssue {
  paperName: string;
  /** The folder this issue was read from — echoed so a stale answer is detectable. */
  folder: string;
  townName: string;
  title: string;
  /** The long date the issue's own header prints (`standard.header:19`). */
  date: string;
  stories: NewspaperStory[];
  /** Non-empty when the issue could not be read; everything else is then empty. */
  error: string;
}

// =============================================================================
// POLITICAL ROLES (Tycoon Cache)
// =============================================================================

export interface PoliticalRoleInfo {
  tycoonName: string;
  isMayor: boolean;
  town: string;
  isCapitalMayor: boolean;
  isPresident: boolean;
  isMinister: boolean;
  ministry: string;
  queriedAt: number;
}

// =============================================================================
// ROAD BUILDING
// =============================================================================

/**
 * Road drawing state for client-side tracking
 */
export interface RoadDrawingState {
  /** Whether road drawing mode is active */
  isDrawing: boolean;
  /** Start X coordinate (world coordinates) */
  startX: number;
  /** Start Y coordinate (world coordinates) */
  startY: number;
  /** Current end X coordinate (world coordinates) */
  endX: number;
  /** Current end Y coordinate (world coordinates) */
  endY: number;
  /** Whether mouse is currently pressed */
  isMouseDown: boolean;
  /** Timestamp when mouse was pressed */
  mouseDownTime: number;
}
