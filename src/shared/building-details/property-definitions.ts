/**
 * Building Details Property Definitions
 *
 * Defines the types and interfaces for the building details system.
 * Properties are fetched from the game server via RDO protocol.
 */

/**
 * Property value types for rendering
 */
export enum PropertyType {
  /** Simple text display */
  TEXT = 'TEXT',
  /** Formatted number with optional unit */
  NUMBER = 'NUMBER',
  /** Dollar formatting ($1,234.56) */
  CURRENCY = 'CURRENCY',
  /** 0-100% with color coding */
  PERCENTAGE = 'PERCENTAGE',
  /** x/y format (e.g., workers 4/5) */
  RATIO = 'RATIO',
  /** Numeric value that can be SET (salaries, prices) */
  SLIDER = 'SLIDER',
  /** Time-series sparkline */
  GRAPH = 'GRAPH',
  /** Multi-column data table */
  TABLE = 'TABLE',
  /** Link to another building (x, y coordinates) */
  CONNECTION = 'CONNECTION',
  /** Boolean yes/no display */
  BOOLEAN = 'BOOLEAN',
  /** Workforce table (3 columns: Executives, Professionals, Workers) */
  WORKFORCE_TABLE = 'WORKFORCE_TABLE',
  /** Upgrade action controls (downgrade, start upgrade, stop upgrade buttons) */
  UPGRADE_ACTIONS = 'UPGRADE_ACTIONS',
  /** Dropdown/select for enum values (TradeRole, TradeLevel) */
  ENUM = 'ENUM',
  /** Clickable action button (e.g., "Visit Politics Page") */
  ACTION_BUTTON = 'ACTION_BUTTON',
  /** Repair control: progress bar + conditional start/stop button */
  REPAIR_CONTROL = 'REPAIR_CONTROL',
  /** Research/Inventions panel (custom rendering for HQ inventions tab) */
  RESEARCH_PANEL = 'RESEARCH_PANEL',
  /** Service cards layout (card-per-service with price slider + avg marker) */
  SERVICE_CARDS = 'SERVICE_CARDS',
  /**
   * Close/Open toggle button for facility Stopped property.
   * Shows "Close" when building is open (Stopped=0), "Open" when stopped (Stopped≠0).
   * Sends: C sel <CurrBlock> set Stopped "#-1" (close) or "#0" (open)
   * Wordbool convention: true=-1, false=0. Only visible to owner.
   * Archaeology: TBlock.Stopped — published property, wordbool, Kernel/Kernel.pas
   */
  STOP_TOGGLE = 'STOP_TOGGLE',
  /**
   * Quick trade connect/disconnect buttons (3 rows: stores, factories, warehouses).
   * Visible to ALL players (not owner-gated). Uses RDOConnectToTycoon/RDODisconnectFromTycoon.
   * Server auto-injects the visiting player's tycoonId.
   * Kind values: 1=warehouses (ftpWarehouses=$01), 2=factories (ftpFactories=$02), 4=stores (ftpStores=$04).
   */
  TRADE_CONNECT_BUTTONS = 'TRADE_CONNECT_BUTTONS',
  /**
   * Clone settings panel: checkbox list of clone options + Apply button.
   * Hardcoded: "Same Company" (0x02), "Same Town" (0x01) — both checked by default.
   * Dynamic: parsed from CloneMenu0 pipe-delimited string ("Label|value|Label|value|...").
   * Apply button OR's checked flags → fire-and-forget CloneFacility on ClientView.
   * Archaeology: ManagementSheet.pas:132-149, CloneOptions.pas
   */
  CLONE_SETTINGS = 'CLONE_SETTINGS',
  /**
   * Warehouse ware checklist: checkbox list of gates with names and enable/disable toggles.
   * Data source: GateMap (binary string) + GetInputNames (ware names from server).
   * Owner can toggle via RDOSelectWare(index, value).
   * Archaeology: WHGeneralSheet.pas clbNames checklist
   */
  WARE_CHECKLIST = 'WARE_CHECKLIST',
  /**
   * Loan request box + Request button of the bank sheet. Offered to VISITORS
   * ONLY — the legacy inversion, `eBorrow`/`fbRequest.Enabled := not fOwnsFacility`
   * (Voyager/BankGeneralSheet.pas:156,160). Sends RDOAskLoan(securityId, amount)
   * and draws the answer in its own panel (`:446-468`).
   */
  BANK_LOAN_REQUEST = 'BANK_LOAN_REQUEST',
}

/**
 * Color coding for property values
 */
export type ColorCode = 'positive' | 'negative' | 'neutral' | 'auto';

/**
 * Definition of a single property to fetch and display
 */
export interface PropertyDefinition {
  /** RDO property name as sent to server */
  rdoName: string;
  /** Display label in UI */
  displayName: string;
  /** How to render the value */
  type: PropertyType;
  /** Unit suffix (e.g., "kg/day", "%", "years") */
  unit?: string;
  /** Can user change this value via slider? */
  editable?: boolean;
  /** Color coding rule */
  colorCode?: ColorCode;
  /** Is this an indexed property (e.g., Workers0, Workers1, Workers2)? */
  indexed?: boolean;
  /** For indexed: how many indices (0, 1, 2 = 3 indices) */
  indexMax?: number;
  /** RDO property that provides the count for dynamic indexing */
  countProperty?: string;
  /** For indexed: suffix to append (e.g., ".0" for cInput0.0, covName0.0) */
  indexSuffix?: string;
  /** For SLIDER: minimum value */
  min?: number;
  /** For SLIDER: maximum value */
  max?: number;
  /** For SLIDER: step increment */
  step?: number;
  /** For RATIO: the "max" property name (e.g., WorkersMax0 for Workers0) */
  maxProperty?: string;
  /** For TABLE: column definitions */
  columns?: TableColumn[];
  /** Tooltip/help text */
  tooltip?: string;
  /** Whether to hide if value is empty */
  hideEmpty?: boolean;
  /** For ENUM: map of numeric value → display label */
  enumLabels?: Record<string, string>;
  /** For ACTION_BUTTON: action identifier dispatched on click */
  actionId?: string;
  /** For ACTION_BUTTON: button label text */
  buttonLabel?: string;
  /**
   * The model server never writes this property to the object cache, so asking
   * the cacher for it yields an empty string (spo_session.ts:1416-1417) and the
   * row renders wrong. The definition still draws the row and carries
   * `editable`; the value arrives from a live RDO get instead — exactly how
   * Voyager reads it (Voyager/ManagementSheet.pas:272-273, and the cached list
   * at :242-250 does not contain it).
   */
  notCached?: boolean;
}

/**
 * Table column definition for TABLE type properties
 *
 * Property name construction: rdoSuffix + index + (columnSuffix || '') + (indexSuffix || '')
 * Standard pattern: rdoSuffix='Debtor', index=0 → 'Debtor0'
 * Mid-index pattern: rdoSuffix='Tax', columnSuffix='Name', index=0 → 'Tax0Name'
 */
export interface TableColumn {
  /** RDO property name prefix before index (e.g., "Debtor" → "Debtor0") */
  rdoSuffix: string;
  /** Suffix AFTER index for mid-index patterns (e.g., 'Name' → Tax0Name) */
  columnSuffix?: string;
  /** Column header label */
  label: string;
  /** Column type for formatting */
  type: PropertyType;
  /** Column width (CSS value) */
  width?: string;
  /** Can user change this column value? (only for SLIDER type) */
  editable?: boolean;
  /** For SLIDER columns: minimum value */
  min?: number;
  /** For SLIDER columns: maximum value */
  max?: number;
  /** For SLIDER columns: step increment */
  step?: number;
  /** Suffix appended AFTER the index (e.g., '.0' for MLS → srvNames0.0) */
  indexSuffix?: string;
  /** For ACTION_BUTTON columns: action identifier dispatched to client */
  actionId?: string;
  /** For ACTION_BUTTON columns: button label text */
  buttonLabel?: string;
  /** For ACTION_BUTTON columns: condition for visibility based on another column's value */
  visibleWhen?: { column: string; condition: 'empty' | 'notEmpty' };
  /** For ACTION_BUTTON columns: alternate action shown when visibleWhen condition is NOT met */
  altAction?: { actionId: string; buttonLabel: string; condition: 'empty' | 'notEmpty' };
}

/**
 * Maps editable property names to RDO write commands.
 * Used by the client to determine which RDO method to call when a property is changed.
 */
export interface RdoCommandMapping {
  /** RDO method name (e.g., 'RDOSetTradeLevel') or 'property' for direct property set */
  command: string;
  /** If true, extract index from property name (e.g., srvPrices0 → index=0) */
  indexed?: boolean;
  /** If true, collect all 3 salary values when one changes */
  allSalaries?: boolean;
  /** Fixed additional params to pass with this command (e.g., { levelIndex: '0' }) */
  params?: Record<string, string>;
}

/**
 * Property group for organizing properties into tabs.
 * Each group corresponds to a Voyager sheet handler (e.g., IndGeneral, BankLoans).
 */
export interface PropertyGroup {
  /** Unique identifier */
  id: string;
  /** Tab display name */
  name: string;
  /** Tab icon (emoji or icon class) */
  icon: string;
  /** Sort order (lower = first) */
  order: number;
  /** Properties in this group */
  properties: PropertyDefinition[];
  /** Nested sub-groups (tabs within tabs) */
  subGroups?: PropertyGroup[];
  /** Whether this group requires special handling (e.g., supplies need SetPath) */
  special?: 'supplies' | 'services' | 'products' | 'workforce' | 'connections' | 'town' | 'compInputs';
  /** Original CLASSES.BIN handler name (set by registerInspectorTabs) */
  handlerName?: string;
  /** Maps editable property base names → RDO write commands */
  rdoCommands?: Record<string, RdoCommandMapping>;
}

/**
 * The groups whose content is read GATE BY GATE, never from the building's property bag.
 *
 * `Supplies`, `Products` and `Company inputs` list gates: each one is a sub-object the
 * client opens on demand (`REQ_BUILDING_TAB_DATA`, then `getBuildingGateConnections`).
 * Their `properties` describe a GATE's columns — `MetaFluid`, `MaxPrice`, `cnxCount`,
 * and, for supplies, `ObjectId` meaning *the gate's* object id.
 *
 * That last one is why this set exists. `ObjectId` is also a header property read for
 * every building, so the opening read had a value for it and published
 * `groups['supplies'] = [{ name: 'ObjectId', value: <the BUILDING's id> }]` — a wrong
 * value under a right-looking name. The client then read the mere presence of that key
 * as "this gate is already loaded" and never asked for the gates at all.
 */
export const GATE_TAB_IDS: ReadonlySet<string> = new Set(['supplies', 'products', 'compInputs']);

/** True for a tab or `special` marker whose content comes from a gate read. */
export function isGateTab(id: string | undefined): boolean {
  return id !== undefined && GATE_TAB_IDS.has(id);
}

/**
 * Template defining which properties to fetch for a building type.
 * The template itself represents a building category (e.g., Retail, Industry, Public Service).
 */
export interface BuildingTemplate {
  /** VisualClass IDs this template applies to */
  visualClassIds: string[];
  /** Template/category display name */
  name: string;
  /** Property groups (tabs) */
  groups: PropertyGroup[];
}

/**
 * Format a currency value
 */
export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (absNum >= 1e9) {
    return `${sign}$${(absNum / 1e9).toFixed(2)}B`;
  } else if (absNum >= 1e6) {
    return `${sign}$${(absNum / 1e6).toFixed(2)}M`;
  } else if (absNum >= 1e3) {
    return `${sign}$${(absNum / 1e3).toFixed(2)}K`;
  }

  return `${sign}$${absNum.toFixed(2)}`;
}

/**
 * Format a percentage value
 */
export function formatPercentage(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';
  return `${num.toFixed(0)}%`;
}

/**
 * Format a number with optional unit
 */
export function formatNumber(value: number | string, unit?: string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';

  let formatted: string;
  if (Math.abs(num) >= 1e6) {
    formatted = `${(num / 1e6).toFixed(2)}M`;
  } else if (Math.abs(num) >= 1e3) {
    formatted = `${(num / 1e3).toFixed(2)}K`;
  } else if (Number.isInteger(num)) {
    formatted = num.toString();
  } else {
    formatted = num.toFixed(2);
  }

  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Parse a tab-separated response into property values
 */
export function parsePropertyResponse(
  response: string,
  propertyNames: string[]
): Map<string, string> {
  const values = response.split('\t');
  const result = new Map<string, string>();

  for (let i = 0; i < propertyNames.length; i++) {
    if (i < values.length) {
      result.set(propertyNames[i], values[i].trim());
    }
  }

  return result;
}
