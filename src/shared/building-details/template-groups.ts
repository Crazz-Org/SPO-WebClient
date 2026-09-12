/**
 * Building Details Template Groups
 *
 * Pre-defined property groups (tabs) that can be composed into building templates.
 * Each group corresponds to a Voyager sheet handler (e.g., IndGeneral, BankLoans).
 * RDO property names are matched to the original Delphi source.
 */

import { PropertyGroup, PropertyType } from './property-definitions';

// =============================================================================
// GENERIC FALLBACK GROUP
// =============================================================================

export const GENERIC_GROUP: PropertyGroup = {
  id: 'generic',
  name: 'Details',
  icon: 'D',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'SecurityId', displayName: 'Security ID', type: PropertyType.TEXT },
    { rdoName: 'ObjectId', displayName: 'Object ID', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'CurrBlock', displayName: 'Block ID', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
  ],
};

// =============================================================================
// GROUP A: GENERAL TAB VARIANTS (10 handlers)
// =============================================================================

/**
 * unkGeneral — Unknown/construction facilities (336 classes)
 * Voyager: UnkFacilitySheet.pas — basic facility info
 */
export const UNK_GENERAL_GROUP: PropertyGroup = {
  id: 'unkGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Stopped': { command: 'property' },
  },
};

/**
 * IndGeneral — Industry/factory facilities (172 classes)
 * Voyager: IndustryGeneralSheet.pas — trade settings
 */
export const IND_GENERAL_GROUP: PropertyGroup = {
  id: 'indGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT, editable: true },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    // Read for the Quick Trade gate only — Voyager compares it with 'Warehouse'
    // (IndustryGeneralSheet.pas:143) and never shows it. PropertyGroup skips the row.
    { rdoName: 'Role', displayName: 'Role', type: PropertyType.TEXT },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'TradeRole', displayName: 'Trade Role', type: PropertyType.ENUM, editable: true, enumLabels: { '0': 'Neutral', '1': 'Producer', '2': 'Distributor', '3': 'Buyer', '4': 'Importer', '5': 'Export', '6': 'Import' } },
    { rdoName: 'TradeLevel', displayName: 'Trade Level', type: PropertyType.ENUM, editable: true, enumLabels: { '0': 'Same Owner', '1': 'Subsidiaries', '2': 'Allies', '3': 'Anyone' } },
    { rdoName: 'connectMap', displayName: 'Connect', type: PropertyType.ACTION_BUTTON, actionId: 'connectMap', buttonLabel: 'Connect' },
    { rdoName: 'tradeConnect', displayName: 'Quick Trade', type: PropertyType.TRADE_CONNECT_BUTTONS },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Name': { command: 'property' },
    'TradeLevel': { command: 'RDOSetTradeLevel' },
    'TradeRole': { command: 'RDOSetRole' },
    'Stopped': { command: 'property' },
    'RDOConnectToTycoon': { command: 'RDOConnectToTycoon' },
    'RDODisconnectFromTycoon': { command: 'RDODisconnectFromTycoon' },
  },
};

/**
 * SrvGeneral — Service/store facilities (58 classes)
 * Voyager: SrvGeneralSheetForm.pas — overview + indexed service price table
 */
export const SRV_GENERAL_GROUP: PropertyGroup = {
  id: 'srvGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT, editable: true },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'Trouble', displayName: 'Issues', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'SecurityId', displayName: 'SecurityId', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    {
      rdoName: 'srvNames',
      displayName: 'Services',
      type: PropertyType.SERVICE_CARDS,
      indexed: true,
      countProperty: 'ServiceCount',
      columns: [
        { rdoSuffix: 'srvNames', label: 'Product', type: PropertyType.TEXT, width: '20%', indexSuffix: '.0' },
        { rdoSuffix: 'srvPrices', label: 'Price', type: PropertyType.SLIDER, width: '15%', editable: true, min: 0, max: 500, step: 10 },
        { rdoSuffix: 'srvSupplies', label: 'Offer', type: PropertyType.NUMBER, width: '15%' },
        { rdoSuffix: 'srvDemands', label: 'Demand', type: PropertyType.NUMBER, width: '15%' },
        { rdoSuffix: 'srvMarketPrices', label: 'Market', type: PropertyType.CURRENCY, width: '15%' },
        { rdoSuffix: 'srvAvgPrices', label: 'Avg Price', type: PropertyType.CURRENCY, width: '15%' },
      ],
    },
    { rdoName: 'connectMap', displayName: 'Connect', type: PropertyType.ACTION_BUTTON, actionId: 'connectMap', buttonLabel: 'Connect' },
    { rdoName: 'tradeConnect', displayName: 'Quick Trade', type: PropertyType.TRADE_CONNECT_BUTTONS },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Name': { command: 'property' },
    'Stopped': { command: 'property' },
    'srvPrices': { command: 'RDOSetPrice', indexed: true },
    'RDOConnectToTycoon': { command: 'RDOConnectToTycoon' },
    'RDODisconnectFromTycoon': { command: 'RDODisconnectFromTycoon' },
  },
};

/**
 * ResGeneral — Residential facilities (183 classes)
 * Voyager: ResidentialSheet.pas — rent/maintenance sliders
 */
export const RES_GENERAL_GROUP: PropertyGroup = {
  id: 'resGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT, editable: true },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    // Residential-specific stats (PopulatedBlock.StoreToCache)
    { rdoName: 'Occupancy', displayName: 'Occupancy', type: PropertyType.PERCENTAGE },
    { rdoName: 'Inhabitants', displayName: 'Inhabitants', type: PropertyType.NUMBER },
    { rdoName: 'QOL', displayName: 'Quality of Life', type: PropertyType.PERCENTAGE },
    { rdoName: 'Beauty', displayName: 'Beauty', type: PropertyType.PERCENTAGE },
    { rdoName: 'Crime', displayName: 'Crime', type: PropertyType.PERCENTAGE },
    { rdoName: 'Pollution', displayName: 'Pollution', type: PropertyType.PERCENTAGE },
    // Investment stats (read-only informational data)
    { rdoName: 'invCrimeRes', displayName: 'Crime Resistance', type: PropertyType.PERCENTAGE },
    { rdoName: 'invPollutionRes', displayName: 'Pollution Resistance', type: PropertyType.PERCENTAGE },
    { rdoName: 'invPrivacy', displayName: 'Privacy', type: PropertyType.PERCENTAGE },
    { rdoName: 'InvBeauty', displayName: 'Beauty Investment', type: PropertyType.PERCENTAGE },
    // Editable sliders
    { rdoName: 'Rent', displayName: 'Rent', type: PropertyType.SLIDER, editable: true, min: 0, max: 200, unit: '%' },
    { rdoName: 'Maintenance', displayName: 'Maintenance', type: PropertyType.SLIDER, editable: true, min: 0, max: 200, unit: '%' },
    // Repair control: progress bar + conditional start/stop (Voyager: RdoRepair / RdoStopRepair)
    { rdoName: 'Repair', displayName: 'Repair', type: PropertyType.REPAIR_CONTROL, maxProperty: 'RepairPrice' },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Name': { command: 'property' },
    'Rent': { command: 'property' },
    'Maintenance': { command: 'property' },
    'Stopped': { command: 'property' },
  },
};

/**
 * HqGeneral — Headquarters facilities (35 classes)
 * Voyager: HqMainSheet.pas — same as unkGeneral (inventions sub-handler is separate)
 */
export const HQ_GENERAL_GROUP: PropertyGroup = {
  id: 'hqGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'connectMap', displayName: 'Connect', type: PropertyType.ACTION_BUTTON, actionId: 'connectMap', buttonLabel: 'Connect' },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Stopped': { command: 'property' },
  },
};

/**
 * HQ Inventions — Research/technology tab for HQ buildings
 * Voyager: InventionsSheet.pas — 3 sections: developing, completed, available
 * Note: No CLASSES.BIN config references hdqInventions — runtime-injected for HQ buildings
 *
 * RDO methods:
 *   RDOQueueResearch(inventionId: widestring, priority: integer) — void
 *   RDOCancelResearch(inventionId: widestring) — void
 */
export const HQ_INVENTIONS_GROUP: PropertyGroup = {
  id: 'hqInventions',
  name: 'Research',
  icon: 'R',
  order: 15,
  properties: [
    { rdoName: 'RsKind', displayName: 'Research Type', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'CatCount', displayName: 'Categories', type: PropertyType.NUMBER, hideEmpty: true },
    // Counts fetched from cache — used by ResearchPanel to show section badges
    { rdoName: 'avlCount0', displayName: 'Available', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'devCount0', displayName: 'Developing', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'hasCount0', displayName: 'Completed', type: PropertyType.NUMBER, hideEmpty: true },
    // Custom renderer — per-item data fetched separately via REQ_RESEARCH_INVENTORY
    { rdoName: '_researchPanel', displayName: 'Research', type: PropertyType.RESEARCH_PANEL },
  ],
  rdoCommands: {
    'RDOQueueResearch': { command: 'RDOQueueResearch' },
    'RDOCancelResearch': { command: 'RDOCancelResearch' },
  },
};

/**
 * BankGeneral — Bank facilities (1 class)
 * Voyager: BankGeneralSheet.pas — bank stats + budget slider
 */
export const BANK_GENERAL_GROUP: PropertyGroup = {
  id: 'bankGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'EstLoan', displayName: 'Estimated Loan', type: PropertyType.CURRENCY },
    { rdoName: 'loanRequest', displayName: 'Request a loan', type: PropertyType.BANK_LOAN_REQUEST },
    { rdoName: 'Interest', displayName: 'Interest Rate', type: PropertyType.SLIDER, editable: true, min: 0, max: 100, step: 1, unit: '%' },
    { rdoName: 'Term', displayName: 'Loan Term', type: PropertyType.SLIDER, editable: true, min: 1, max: 20, step: 1, unit: 'years' },
    { rdoName: 'BudgetPerc', displayName: 'Budget', type: PropertyType.SLIDER, editable: true, min: 0, max: 100, unit: '%' },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'Interest': { command: 'property' },
    'Term': { command: 'property' },
    'BudgetPerc': { command: 'RDOSetLoanPerc' },
    'Stopped': { command: 'property' },
  },
};

/**
 * WHGeneral — Warehouse facilities (2 classes)
 * Voyager: WHGeneralSheet.pas — trade settings
 */
export const WH_GENERAL_GROUP: PropertyGroup = {
  id: 'whGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'Role', displayName: 'Trade Role', type: PropertyType.ENUM, enumLabels: { '0': 'Neutral', '1': 'Producer', '2': 'Distributor', '3': 'Buyer', '4': 'Importer', '5': 'Export', '6': 'Import' } },
    { rdoName: 'TradeLevel', displayName: 'Trade Level', type: PropertyType.ENUM, editable: true, enumLabels: { '0': 'Same Owner', '1': 'Subsidiaries', '2': 'Allies', '3': 'Anyone' } },
    { rdoName: 'GateMap', displayName: 'Wares', type: PropertyType.WARE_CHECKLIST },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'connectMap', displayName: 'Connect', type: PropertyType.ACTION_BUTTON, actionId: 'connectMap', buttonLabel: 'Connect' },
    { rdoName: 'tradeConnect', displayName: 'Quick Trade', type: PropertyType.TRADE_CONNECT_BUTTONS },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'TradeLevel': { command: 'RDOSetTradeLevel' },
    'RDOSelectWare': { command: 'RDOSelectWare' },
    'RDOConnectToTycoon': { command: 'RDOConnectToTycoon' },
    'RDODisconnectFromTycoon': { command: 'RDODisconnectFromTycoon' },
    'Stopped': { command: 'property' },
  },
};

/**
 * TVGeneral — TV station facilities (4 classes)
 * Voyager: TVGeneralSheet.pas — broadcast settings
 */
export const TV_GENERAL_GROUP: PropertyGroup = {
  id: 'tvGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'ROI', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'HoursOnAir', displayName: 'Hours On Air', type: PropertyType.SLIDER, editable: true, min: 0, max: 100, unit: '%' },
    { rdoName: 'Comercials', displayName: 'Commercials', type: PropertyType.SLIDER, editable: true, min: 0, max: 100, unit: '%' },
    { rdoName: 'Stopped', displayName: 'Status', type: PropertyType.STOP_TOGGLE },
    { rdoName: 'connectMap', displayName: 'Connect', type: PropertyType.ACTION_BUTTON, actionId: 'connectMap', buttonLabel: 'Connect' },
    { rdoName: 'demolish', displayName: 'Demolish', type: PropertyType.ACTION_BUTTON, actionId: 'demolish', buttonLabel: 'Demolish' },
  ],
  rdoCommands: {
    'HoursOnAir': { command: 'property' },
    // Read key and write name differ, and only here. Voyager stores the value
    // under the cache key `Comercials` (one m, `tidComercials`,
    // TVGeneralSheet.pas:15) but writes the published property `Commercials`
    // (two m, StdBlocks/Broadcast.pas:53) — `Proxy.Commercials := …`,
    // TVGeneralSheet.pas:322. `params.propertyName` overrides the read key on
    // the write side (property-utils.ts:32); without it the RTTI lookup misses
    // and the slider silently never lands.
    'Comercials': { command: 'property', params: { propertyName: 'Commercials' } },
    'Stopped': { command: 'property' },
  },
};

/**
 * capitolGeneral — Capitol building (1 class)
 * Voyager: CapitolSheet.pas — ruler stats + indexed coverage
 */
export const CAPITOL_GENERAL_GROUP: PropertyGroup = {
  id: 'capitolGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    // See TOWN_GENERAL_GROUP: requested so `grantAccess` has something to test.
    { rdoName: 'SecurityId', displayName: 'SecurityId', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'QOL', displayName: 'QOL', type: PropertyType.PERCENTAGE },
    {
      rdoName: 'covName',
      displayName: 'Coverage',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'covCount',
      columns: [
        { rdoSuffix: 'covName', label: 'Service', type: PropertyType.TEXT, width: '50%' },
        { rdoSuffix: 'covValue', label: 'Coverage', type: PropertyType.PERCENTAGE, width: '50%' },
      ],
    },
    { rdoName: 'ActualRuler', displayName: 'President', type: PropertyType.TEXT },
    { rdoName: 'RulerRating', displayName: 'Popular Rating', type: PropertyType.PERCENTAGE },
    { rdoName: 'TycoonsRating', displayName: 'Tycoons Rating', type: PropertyType.PERCENTAGE },
    // Kernel/WorldPolitics.pas:1410 writes it on the Capitol's own cache object.
    { rdoName: 'IFELRating', displayName: "IFEL's Rating", type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'RulerPeriods', displayName: 'Mandate No.', type: PropertyType.NUMBER },
    { rdoName: 'YearsToElections', displayName: 'Years to Elections', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'HasRuler', displayName: 'Has Ruler', type: PropertyType.BOOLEAN, hideEmpty: true },
  ],
};

/**
 * townGeneral — Town hall (4 classes)
 * Voyager: TownHallSheet.pas — mayor stats + coverage
 */
export const TOWN_GENERAL_GROUP: PropertyGroup = {
  id: 'townGeneral',
  name: 'General',
  icon: 'i',
  order: 0,
  properties: [
    // Requested, never displayed. `allValues` only ever holds what a template
    // declares, so without this line the facility's SecurityId is never read
    // and `grantAccess` refuses every civic control — including the mayor's own.
    // Voyager fetches it per sheet (`TownTaxesSheet.pas:145`,
    // `TownHallJobsSheet.pas:168-169`); one shared read serves every group here.
    { rdoName: 'SecurityId', displayName: 'SecurityId', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'ActualRuler', displayName: 'Mayor', type: PropertyType.TEXT },
    { rdoName: 'Town', displayName: 'Town', type: PropertyType.TEXT },
    { rdoName: 'NewspaperName', displayName: 'Newspaper', type: PropertyType.TEXT },
    { rdoName: 'RulerPrestige', displayName: 'Prestige', type: PropertyType.NUMBER },
    { rdoName: 'RulerRating', displayName: 'Ruler Rating', type: PropertyType.PERCENTAGE },
    { rdoName: 'TycoonsRating', displayName: 'Tycoons Rating', type: PropertyType.PERCENTAGE },
    // Kernel/PoliticsCache.pas:153 writes it on the TOWN folder object, not on
    // the Town Hall facility — hidden when the facility read comes back empty.
    { rdoName: 'IFELRating', displayName: "IFEL's Rating", type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'YearsToElections', displayName: 'Years to Elections', type: PropertyType.NUMBER },
    { rdoName: 'HasRuler', displayName: 'Has Ruler', type: PropertyType.BOOLEAN },
    { rdoName: 'RulerPeriods', displayName: 'Ruler Periods', type: PropertyType.NUMBER },
    { rdoName: 'CampaignCount', displayName: 'Active Campaigns', type: PropertyType.NUMBER, hideEmpty: true },
    {
      rdoName: 'covName',
      displayName: 'Coverage',
      type: PropertyType.TABLE,
      indexed: true,
      indexSuffix: '.0',
      countProperty: 'covCount',
      columns: [
        { rdoSuffix: 'covName', label: 'Service', type: PropertyType.TEXT, width: '50%' },
        { rdoSuffix: 'covValue', label: 'Coverage', type: PropertyType.PERCENTAGE, width: '50%', indexSuffix: '' },
      ],
    },
  ],
};

// =============================================================================
// GROUP B: CORE HANDLERS (already working — unchanged)
// =============================================================================

export const WORKFORCE_GROUP: PropertyGroup = {
  id: 'workforce',
  name: 'Workforce',
  icon: 'W',
  order: 10,
  special: 'workforce',
  properties: [
    {
      rdoName: 'WorkforceTable',
      displayName: 'Workforce Overview',
      type: PropertyType.WORKFORCE_TABLE,
    },
  ],
  rdoCommands: {
    'Salaries': { command: 'RDOSetSalaries', allSalaries: true },
  },
};

export const SUPPLIES_GROUP: PropertyGroup = {
  id: 'supplies',
  name: 'Supplies',
  icon: 'S',
  order: 20,
  special: 'supplies',
  properties: [
    { rdoName: 'MetaFluid', displayName: 'Product', type: PropertyType.TEXT },
    { rdoName: 'FluidValue', displayName: 'Last Value', type: PropertyType.TEXT },
    { rdoName: 'LastCostPerc', displayName: 'Cost %', type: PropertyType.PERCENTAGE },
    { rdoName: 'minK', displayName: 'Min Quality', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'MaxPrice', displayName: 'Max Price', type: PropertyType.SLIDER, editable: true, min: 0, max: 400, step: 1 },
    { rdoName: 'QPSorted', displayName: 'Sort by Q/P', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'SortMode', displayName: 'Sort Mode', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'Selected', displayName: 'Selected', type: PropertyType.BOOLEAN, hideEmpty: true },
    { rdoName: 'ObjectId', displayName: 'Gate Object', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'cnxCount', displayName: 'Connections', type: PropertyType.NUMBER },
  ],
  rdoCommands: {
    'MaxPrice': { command: 'RDOSetInputMaxPrice' },
    'minK': { command: 'RDOSetInputMinK' },
    'RDOConnectInput': { command: 'RDOConnectInput' },
    'RDODisconnectInput': { command: 'RDODisconnectInput' },
    'RDOSetInputOverPrice': { command: 'RDOSetInputOverPrice' },
    'RDOSetInputSortMode': { command: 'RDOSetInputSortMode' },
    'RDOSelSelected': { command: 'RDOSelSelected' },
  },
};

/**
 * Products — Output gate handler for industrial buildings (172 classes)
 * Voyager: ProdSheetForm.pas — FingerTabs with per-output gate properties + connections
 *
 * Data fetched via GetOutputNames + SetPath + per-gate property queries,
 * NOT from indexed srvNames/srvPrices properties (those are SrvGeneral inline table).
 *
 * Output gate properties: MetaFluid, LastFluid, FluidQuality, PricePc, AvgPrice, MarketPrice, cnxCount
 * Per-connection: cnxFacilityName, cnxCompanyName, LastValueCnxInfo, ConnectedCnxInfo, tCostCnxInfo, cnxXPos, cnxYPos
 */
export const PRODUCTS_GROUP: PropertyGroup = {
  id: 'products',
  name: 'Products',
  icon: 'P',
  order: 30,
  special: 'products',
  properties: [
    { rdoName: 'MetaFluid', displayName: 'Product', type: PropertyType.TEXT },
    { rdoName: 'LastFluid', displayName: 'Produced', type: PropertyType.NUMBER },
    { rdoName: 'FluidQuality', displayName: 'Quality', type: PropertyType.PERCENTAGE },
    { rdoName: 'PricePc', displayName: 'Price', type: PropertyType.SLIDER, editable: true, min: 0, max: 400, step: 1, unit: '%' },
    { rdoName: 'AvgPrice', displayName: 'Avg Price', type: PropertyType.PERCENTAGE },
    { rdoName: 'MarketPrice', displayName: 'Market Price', type: PropertyType.CURRENCY },
    { rdoName: 'cnxCount', displayName: 'Clients', type: PropertyType.NUMBER },
  ],
  rdoCommands: {
    'PricePc': { command: 'RDOSetOutputPrice' },
    'RDOConnectOutput': { command: 'RDOConnectOutput' },
    'RDODisconnectOutput': { command: 'RDODisconnectOutput' },
  },
};

/**
 * compInputs — Company inputs (supplies the facility needs)
 * Voyager: CompanyServicesSheetForm.pas — registered as 'compInputs'
 * Data comes from GetInputNames protocol (lazy-loaded per input),
 * NOT from indexed properties. The special marker triggers the accordion UI.
 */
export const ADVERTISEMENT_GROUP: PropertyGroup = {
  id: 'advertisement',
  name: 'Services',
  icon: 'A',
  order: 25,
  special: 'compInputs',
  properties: [],
  rdoCommands: {
    'RDOSetCompanyInputDemand': { command: 'RDOSetCompanyInputDemand' },
  },
};

/**
 * Ads — Advertisement input supply handler
 * Voyager: AdvSheetForm.pas — registered as 'Ads'
 * Specialized single-input handler: finds 'advertisement' input via GetInputNames,
 * navigates via SetPath, shows percentage slider (nfActualMaxFluidValue/nfCapacity).
 * Uses supply data fetching mechanism to display the advertisement input gate.
 */
export const ADS_GROUP: PropertyGroup = {
  id: 'ads',
  name: 'Services',
  icon: 'A',
  order: 25,
  special: 'supplies',
  properties: [
    { rdoName: 'MetaFluid', displayName: 'Product', type: PropertyType.TEXT },
    { rdoName: 'FluidValue', displayName: 'Current Value', type: PropertyType.TEXT },
    { rdoName: 'LastCost', displayName: 'Last Cost', type: PropertyType.CURRENCY },
    { rdoName: 'nfCapacity', displayName: 'Capacity', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'nfActualMaxFluidValue', displayName: 'Max Fluid', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'AdPerc', displayName: 'Ad Budget %', type: PropertyType.SLIDER, editable: true, min: 0, max: 100, step: 1, unit: '%' },
    { rdoName: 'cnxCount', displayName: 'Connections', type: PropertyType.NUMBER },
  ],
  rdoCommands: {
    'AdPerc': { command: 'RDOSetInputFluidPerc' },
    'RDOConnectInput': { command: 'RDOConnectInput' },
    'RDODisconnectInput': { command: 'RDODisconnectInput' },
    'RDOSetInputOverPrice': { command: 'RDOSetInputOverPrice' },
  },
};

export const UPGRADE_GROUP: PropertyGroup = {
  id: 'upgrade',
  name: 'Upgrade',
  icon: 'U',
  order: 40,
  properties: [
    { rdoName: 'UpgradeLevel', displayName: 'Current Level', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'MaxUpgrade', displayName: 'Max Level', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'NextUpgCost', displayName: 'Upgrade Cost', type: PropertyType.CURRENCY, hideEmpty: true },
    { rdoName: 'Upgrading', displayName: 'Upgrading', type: PropertyType.BOOLEAN, hideEmpty: true },
    { rdoName: 'Pending', displayName: 'Pending', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'UpgradeActions', displayName: 'Actions', type: PropertyType.UPGRADE_ACTIONS },
    // Read, never shown (HIDDEN_PROPERTY_NAMES): the block id `enrichUpgradeTab`
    // binds its live get to. Voyager's Management sheet asks the cache for the
    // same name and for the same reason — `Names.Add(tidCurrBlock)`
    // (Voyager/ManagementSheet.pas:243), then `Proxy.BindTo(fCurrBlock)` (:272).
    { rdoName: 'CurrBlock', displayName: 'Block ID', type: PropertyType.TEXT, hideEmpty: true },
    // `notCached`: TBlock.StoreToCache (Kernel/Kernel.pas:5824-5905) never emits
    // AcceptCloning, so the cache read came back empty and the checkbox was stuck
    // unchecked even though the server default is true (Kernel.pas:5239).
    // enrichUpgradeTab() supplies the real value via a live get on CurrBlock.
    { rdoName: 'AcceptCloning', displayName: 'Accept Cloning', type: PropertyType.BOOLEAN, editable: true, notCached: true },
    { rdoName: 'CloneMenu0', displayName: 'Clone Settings', type: PropertyType.CLONE_SETTINGS },
  ],
  rdoCommands: {
    'AcceptCloning': { command: 'RDOAcceptCloning' },
  },
};

export const FINANCES_GROUP: PropertyGroup = {
  id: 'finances',
  name: 'Finances',
  icon: 'F',
  order: 50,
  properties: [
    { rdoName: 'MoneyGraphInfo', displayName: 'Revenue History', type: PropertyType.GRAPH },
    { rdoName: 'MoneyGraph', displayName: 'Has Graph', type: PropertyType.BOOLEAN, hideEmpty: true },
  ],
};

// =============================================================================
// GROUP C: SPECIALIZED HANDLERS (11 handlers — NEW)
// =============================================================================

/**
 * BankLoans — Bank loan table
 * Voyager: BankLoansSheet.pas — indexed loan table
 */
export const BANK_LOANS_GROUP: PropertyGroup = {
  id: 'bankLoans',
  name: 'Loans',
  icon: 'L',
  order: 10,
  properties: [
    {
      rdoName: 'Debtor',
      displayName: 'Loans',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'LoanCount',
      columns: [
        { rdoSuffix: 'Debtor', label: 'Debtor', type: PropertyType.TEXT, width: '30%' },
        { rdoSuffix: 'Amount', label: 'Amount', type: PropertyType.CURRENCY, width: '25%' },
        { rdoSuffix: 'Interest', label: 'Interest', type: PropertyType.PERCENTAGE, width: '20%' },
        { rdoSuffix: 'Term', label: 'Term', type: PropertyType.NUMBER, width: '25%' },
      ],
    },
  ],
};

/**
 * Antennas — TV antenna table
 * Voyager: AntennasSheet.pas — indexed antenna table
 */
export const ANTENNAS_GROUP: PropertyGroup = {
  id: 'antennas',
  name: 'Antennas',
  icon: 'A',
  order: 10,
  properties: [
    {
      rdoName: 'antName',
      displayName: 'Antennas',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'antCount',
      columns: [
        { rdoSuffix: 'antName', label: 'Name', type: PropertyType.TEXT, width: '25%' },
        { rdoSuffix: 'antTown', label: 'Town', type: PropertyType.TEXT, width: '20%' },
        { rdoSuffix: 'antViewers', label: 'Viewers', type: PropertyType.NUMBER, width: '15%' },
        { rdoSuffix: 'antActive', label: 'Active', type: PropertyType.BOOLEAN, width: '15%' },
        { rdoSuffix: 'antX', label: 'X', type: PropertyType.NUMBER, width: '12%' },
        { rdoSuffix: 'antY', label: 'Y', type: PropertyType.NUMBER, width: '13%' },
      ],
    },
  ],
};

/**
 * Films — Film production status
 * Voyager: FilmsSheet.pas
 */
export const FILMS_GROUP: PropertyGroup = {
  id: 'films',
  name: 'Films',
  icon: 'F',
  order: 10,
  properties: [
    // Current film info (FilmsSheet.pas queries)
    { rdoName: 'FilmName', displayName: 'Film Name', type: PropertyType.TEXT },
    { rdoName: 'FilmBudget', displayName: 'Budget', type: PropertyType.CURRENCY },
    { rdoName: 'FilmTime', displayName: 'Duration', type: PropertyType.NUMBER, unit: 'months' },
    { rdoName: 'InProd', displayName: 'In Production', type: PropertyType.TEXT },
    { rdoName: 'FilmDone', displayName: 'Film Done', type: PropertyType.BOOLEAN },
    { rdoName: 'AutoProd', displayName: 'Auto Produce', type: PropertyType.BOOLEAN, editable: true },
    // Read-only by necessity: no server member sets auto-release after launch. The
    // studio publishes four members (StdBlocks/MovieStudios.pas:103-107) and none of
    // them is one. The flag rides bit 0 of RDOLaunchMovie's `AutoInfo : word`
    // (flgAutoRelease = $01, MovieStudios.pas:19), so it is chosen at launch — which
    // is exactly what Voyager does: cbAutoRelease has no click handler, only
    // Enabled/Checked for display (FilmsSheet.pas:183,194,200), read once at :383.
    { rdoName: 'AutoRel', displayName: 'Auto Release', type: PropertyType.BOOLEAN },
    { rdoName: 'launchMovie', displayName: 'Launch Movie', type: PropertyType.ACTION_BUTTON, actionId: 'launchMovie', buttonLabel: 'Launch Movie' },
    { rdoName: 'cancelMovie', displayName: 'Cancel Movie', type: PropertyType.ACTION_BUTTON, actionId: 'cancelMovie', buttonLabel: 'Cancel Movie' },
    { rdoName: 'releaseMovie', displayName: 'Release Movie', type: PropertyType.ACTION_BUTTON, actionId: 'releaseMovie', buttonLabel: 'Release Movie' },
  ],
  rdoCommands: {
    // AutoProd only. RDOAutoProduce is real (MovieStudios.pas:107); RDOAutoRelease is
    // not, and a mapping here would put a frame on the wire that the server discards.
    'AutoProd': { command: 'RDOAutoProduce' },
  },
};

/**
 * Mausoleum — Memorial building
 * Voyager: MausoleumSheet.pas
 */
export const MAUSOLEUM_GROUP: PropertyGroup = {
  id: 'mausoleum',
  name: 'Memorial',
  icon: 'M',
  order: 10,
  properties: [
    { rdoName: 'WordsOfWisdom', displayName: 'Words of Wisdom', type: PropertyType.TEXT },
    { rdoName: 'OwnerName', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Transcended', displayName: 'Transcended', type: PropertyType.BOOLEAN },
  ],
  rdoCommands: {
    'WordsOfWisdom': { command: 'RDOSetWordsOfWisdom' },
    'RDOCacncelTransc': { command: 'RDOCacncelTransc' },
  },
};

/**
 * Votes — Election/voting tab
 * Voyager: VotesSheet.pas — ruler + candidate table
 */
export const VOTES_GROUP: PropertyGroup = {
  id: 'votes',
  name: 'Votes',
  icon: 'V',
  order: 10,
  properties: [
    { rdoName: 'Trouble', displayName: 'Trouble', type: PropertyType.NUMBER, hideEmpty: true },
    { rdoName: 'RulerName', displayName: 'Ruler', type: PropertyType.TEXT },
    { rdoName: 'RulerVotes', displayName: 'Ruler Votes', type: PropertyType.NUMBER },
    { rdoName: 'RulerCmpRat', displayName: 'Ruler Campaign Rating', type: PropertyType.PERCENTAGE },
    { rdoName: 'RulerCmpPnts', displayName: 'Ruler Campaign Points', type: PropertyType.NUMBER },
    {
      rdoName: 'Candidate',
      displayName: 'Candidates',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'CampaignCount',
      columns: [
        { rdoSuffix: 'Candidate', label: 'Candidate', type: PropertyType.TEXT, width: '25%' },
        { rdoSuffix: 'Votes', label: 'Votes', type: PropertyType.NUMBER, width: '20%' },
        { rdoSuffix: 'CmpRat', label: 'Rating', type: PropertyType.PERCENTAGE, width: '20%' },
        { rdoSuffix: 'CmpPnts', label: 'Points', type: PropertyType.NUMBER, width: '20%' },
        { rdoSuffix: 'voteAction', label: '', type: PropertyType.ACTION_BUTTON, width: '15%', actionId: 'voteCandidate', buttonLabel: 'Vote' },
      ],
    },
  ],
  rdoCommands: {
    // No 'RDOVoteOf' entry: it is a read (`function`, Kernel/TownPolitics.pas:47),
    // served by enrichVotesTab, not a mutation the property path may emit.
    'RDOVote': { command: 'RDOVote' },
    'voteCandidate': { command: 'RDOVote' },
  },
};

/**
 * CapitolTowns — Capitol's town table
 * Voyager: CapitolTownsSheet.pas — indexed town table
 */
export const CAPITOL_TOWNS_GROUP: PropertyGroup = {
  id: 'capitolTowns',
  name: 'Towns',
  icon: 'T',
  order: 10,
  properties: [
    { rdoName: 'ActualRuler', displayName: 'Ruler', type: PropertyType.TEXT },
    {
      rdoName: 'Town',
      displayName: 'Towns',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'TownCount',
      // Voyager/CapitolTownsSheet.pas:120-125 captions the TownQOS column "Commerce" and the
      // TownWealth column "Wealth"; the three figures are written at
      // Kernel/WorldPolitics.pas:1379-1384.
      columns: [
        { rdoSuffix: 'Town', label: 'Name', type: PropertyType.TEXT, width: '14%' },
        { rdoSuffix: 'TownPopulation', label: 'Population', type: PropertyType.NUMBER, width: '12%' },
        { rdoSuffix: 'TownQOL', label: 'QOL', type: PropertyType.PERCENTAGE, width: '10%' },
        { rdoSuffix: 'TownRating', label: 'Rating', type: PropertyType.PERCENTAGE, width: '10%' },
        { rdoSuffix: 'TownQOS', label: 'Commerce', type: PropertyType.PERCENTAGE, width: '10%' },
        { rdoSuffix: 'TownWealth', label: 'Wealth', type: PropertyType.PERCENTAGE, width: '10%' },
        { rdoSuffix: 'TownTax', label: 'Tax', type: PropertyType.SLIDER, width: '14%', editable: true, min: 0, max: 100, step: 1 },
        { rdoSuffix: 'HasMayor', label: 'Mayor', type: PropertyType.BOOLEAN, width: '8%' },
        { rdoSuffix: 'electMayor', label: '', type: PropertyType.ACTION_BUTTON, width: '12%', actionId: 'electMayor', buttonLabel: 'Elect' },
      ],
    },
  ],
  rdoCommands: {
    'TownTax': { command: 'RDOSetTownTaxes', indexed: true },
    'RDOSitMayor': { command: 'RDOSitMayor' },
    'electMayor': { command: 'RDOSitMayor' },
  },
};

/**
 * Ministeries — Capitol minister table
 * Voyager: MinisteriesSheet.pas — indexed minister table
 */
export const MINISTERIES_GROUP: PropertyGroup = {
  id: 'ministeries',
  name: 'Ministries',
  icon: 'M',
  order: 10,
  properties: [
    { rdoName: 'ActualRuler', displayName: 'Ruler', type: PropertyType.TEXT },
    {
      rdoName: 'Ministry',
      displayName: 'Ministries',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'MinisterCount',
      columns: [
        { rdoSuffix: 'MinistryId', label: 'ID', type: PropertyType.TEXT, width: '0%' },
        { rdoSuffix: 'Ministry', label: 'Ministry', type: PropertyType.TEXT, width: '22%', indexSuffix: '.0' },
        { rdoSuffix: 'Minister', label: 'Minister', type: PropertyType.TEXT, width: '18%' },
        { rdoSuffix: 'MinisterRating', label: 'Rating', type: PropertyType.PERCENTAGE, width: '14%' },
        { rdoSuffix: 'MinisterBudget', label: 'Budget', type: PropertyType.CURRENCY, width: '24%', editable: true },
        {
          rdoSuffix: 'ministerAction', label: '', type: PropertyType.ACTION_BUTTON, width: '12%',
          actionId: 'electMinister', buttonLabel: 'Elect',
          visibleWhen: { column: 'Minister', condition: 'empty' },
          altAction: { actionId: 'deposeMinister', buttonLabel: 'Depose', condition: 'notEmpty' },
        },
      ],
    },
  ],
  rdoCommands: {
    'MinisterBudget': { command: 'RDOSetMinistryBudget', indexed: true },
    'electMinister': { command: 'RDOSitMinister' },
    'deposeMinister': { command: 'RDOBanMinister' },
  },
};

/**
 * townJobs — Town hall job settings
 * Voyager: TownHallJobsSheet.pas — min salary per worker class
 */
export const TOWN_JOBS_GROUP: PropertyGroup = {
  id: 'townJobs',
  name: 'Jobs',
  icon: 'J',
  order: 10,
  properties: [
    // Executives column
    { rdoName: 'hiWorkDemand', displayName: 'Executive Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'hiPrivateWorkDemand', displayName: 'Executive Private Vacancies', type: PropertyType.TEXT },
    { rdoName: 'hiSalary', displayName: 'Executive Average Wage', type: PropertyType.PERCENTAGE },
    { rdoName: 'hiSalaryValue', displayName: 'Executive Spending Power', type: PropertyType.PERCENTAGE },
    { rdoName: 'hiMinSalary', displayName: 'Executive Minimum Wage', type: PropertyType.SLIDER, editable: true, min: 0, max: 200, step: 1, unit: '%' },
    { rdoName: 'hiActualMinSalary', displayName: 'Executive World Minimum Wage', type: PropertyType.NUMBER },
    // Professionals column
    { rdoName: 'midWorkDemand', displayName: 'Professional Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'midPrivateWorkDemand', displayName: 'Professional Private Vacancies', type: PropertyType.TEXT },
    { rdoName: 'midSalary', displayName: 'Professional Average Wage', type: PropertyType.PERCENTAGE },
    { rdoName: 'midSalaryValue', displayName: 'Professional Spending Power', type: PropertyType.PERCENTAGE },
    { rdoName: 'midMinSalary', displayName: 'Professional Minimum Wage', type: PropertyType.SLIDER, editable: true, min: 0, max: 200, step: 1, unit: '%' },
    { rdoName: 'midActualMinSalary', displayName: 'Professional World Minimum Wage', type: PropertyType.NUMBER },
    // Workers column
    { rdoName: 'loWorkDemand', displayName: 'Worker Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'loPrivateWorkDemand', displayName: 'Worker Private Vacancies', type: PropertyType.TEXT },
    { rdoName: 'loSalary', displayName: 'Worker Average Wage', type: PropertyType.PERCENTAGE },
    { rdoName: 'loSalaryValue', displayName: 'Worker Spending Power', type: PropertyType.PERCENTAGE },
    { rdoName: 'loMinSalary', displayName: 'Worker Minimum Wage', type: PropertyType.SLIDER, editable: true, min: 0, max: 200, step: 1, unit: '%' },
    { rdoName: 'loActualMinSalary', displayName: 'Worker World Minimum Wage', type: PropertyType.NUMBER },
  ],
  rdoCommands: {
    'hiMinSalary': { command: 'RDOSetMinSalaryValue', params: { levelIndex: '0' } },
    'midMinSalary': { command: 'RDOSetMinSalaryValue', params: { levelIndex: '1' } },
    'loMinSalary': { command: 'RDOSetMinSalaryValue', params: { levelIndex: '2' } },
  },
};

/**
 * townRes — Town hall residential statistics
 * Voyager: TownHallResSheet.pas — uses FiveViewUtils (xfer_ prefixed controls)
 * Properties: 3 residential classes × (Demand, Quantity, Rent Price)
 */
export const TOWN_RES_GROUP: PropertyGroup = {
  id: 'townRes',
  name: 'Residentials',
  icon: 'R',
  order: 10,
  properties: [
    // High Class column
    { rdoName: 'hiResDemand', displayName: 'High Class Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'hiRentPrice', displayName: 'High Class Rent Price', type: PropertyType.PERCENTAGE },
    { rdoName: 'hiResQ', displayName: 'High Class Quality Index', type: PropertyType.PERCENTAGE },
    // Middle Class column
    { rdoName: 'midResDemand', displayName: 'Middle Class Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'midRentPrice', displayName: 'Middle Class Rent Price', type: PropertyType.PERCENTAGE },
    { rdoName: 'midResQ', displayName: 'Middle Class Quality Index', type: PropertyType.PERCENTAGE },
    // Low Class column
    { rdoName: 'loResDemand', displayName: 'Low Class Vacancies', type: PropertyType.NUMBER },
    { rdoName: 'loRentPrice', displayName: 'Low Class Rent Price', type: PropertyType.PERCENTAGE },
    { rdoName: 'loResQ', displayName: 'Low Class Quality Index', type: PropertyType.PERCENTAGE },
  ],
};

/**
 * townServices — Town services overview table
 * Voyager: TownProdxSheet.pas — registered as 'townServices'
 * Properties: srvCount (count), GQOS, then indexed svr* properties
 * Note: svrName uses .0 language suffix (svrName0.0), svrRatio is float 0-1 (multiply by 100 for %)
 */
export const TOWN_SERVICES_GROUP: PropertyGroup = {
  id: 'townServices',
  name: 'Services',
  icon: 'S',
  order: 10,
  properties: [
    { rdoName: 'GQOS', displayName: 'General Index', type: PropertyType.PERCENTAGE },
    {
      rdoName: 'svrName',
      displayName: 'Services',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'srvCount',
      columns: [
        { rdoSuffix: 'svrName', columnSuffix: '.0', label: 'Name', type: PropertyType.TEXT, width: '16%' },
        { rdoSuffix: 'svrDemand', label: 'Demand', type: PropertyType.NUMBER, width: '11%' },
        { rdoSuffix: 'svrOffer', label: 'Offer', type: PropertyType.NUMBER, width: '11%' },
        { rdoSuffix: 'svrCapacity', label: 'Capacity', type: PropertyType.NUMBER, width: '11%' },
        { rdoSuffix: 'svrRatio', label: 'Ratio', type: PropertyType.PERCENTAGE, width: '10%' },
        { rdoSuffix: 'svrMarketPrice', label: 'IFEL Price', type: PropertyType.CURRENCY, width: '11%' },
        { rdoSuffix: 'svrPrice', label: 'Avg Price', type: PropertyType.PERCENTAGE, width: '11%' },
        { rdoSuffix: 'svrQuality', label: 'Quality', type: PropertyType.PERCENTAGE, width: '11%' },
      ],
    },
  ],
};

/**
 * townProducts — Town products table (input/output gate summary)
 * Voyager: TownProdSheet.pas — registered as 'townProducts'
 * Properties: prdCount (count), then indexed prd* properties
 * Note: prdName uses MLS suffix (prdName{i}.{ActiveLanguage} e.g. prdName0.0)
 */
export const TOWN_PRODUCTS_GROUP: PropertyGroup = {
  id: 'townProducts',
  name: 'Products',
  icon: 'P',
  order: 15,
  properties: [
    {
      rdoName: 'prdName',
      displayName: 'Products',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'prdCount',
      columns: [
        { rdoSuffix: 'prdName', columnSuffix: '.0', label: 'Product', type: PropertyType.TEXT, width: '12%' },
        { rdoSuffix: 'prdOutputValue', label: 'Produced', type: PropertyType.NUMBER, width: '10%' },
        { rdoSuffix: 'prdInputValue', label: 'Consumed', type: PropertyType.NUMBER, width: '10%' },
        { rdoSuffix: 'prdOutputCapacity', label: 'Out Cap', type: PropertyType.NUMBER, width: '10%' },
        { rdoSuffix: 'prdInputCapacity', label: 'In Cap', type: PropertyType.NUMBER, width: '10%' },
        { rdoSuffix: 'prdOutputPrice', label: 'Out Price', type: PropertyType.CURRENCY, width: '10%' },
        { rdoSuffix: 'prdOutputQuality', label: 'Out Qual', type: PropertyType.PERCENTAGE, width: '9%' },
        { rdoSuffix: 'prdInputPrice', label: 'In Price', type: PropertyType.CURRENCY, width: '10%' },
        { rdoSuffix: 'prdInputQuality', label: 'In Qual', type: PropertyType.PERCENTAGE, width: '9%' },
        { rdoSuffix: 'prdInputMaxPrice', label: 'Max Price', type: PropertyType.CURRENCY, width: '10%' },
      ],
    },
  ],
};

/**
 * townTaxes — Town tax table (uses columnSuffix for mid-index pattern)
 * Voyager: TownTaxesSheet.pas — Tax{idx}Id, Tax{idx}Name{lang}, Tax{idx}Kind,
 *   Tax{idx}Percent, Tax{idx}LastYear
 * RDO: RDOSetTaxValue(TaxId, valueString) with BindTo(CurrBlock)
 *   Subsidize = negative value (e.g., '-10'), tkPercent=0, tkValue=1
 */
export const TOWN_TAXES_GROUP: PropertyGroup = {
  id: 'townTaxes',
  name: 'Taxes',
  icon: 'T',
  order: 10,
  properties: [
    {
      rdoName: 'Tax',
      displayName: 'Taxes',
      type: PropertyType.TABLE,
      indexed: true,
      countProperty: 'TaxCount',
      columns: [
        { rdoSuffix: 'Tax', columnSuffix: 'Id', label: 'ID', type: PropertyType.TEXT, width: '0%' },
        { rdoSuffix: 'Tax', columnSuffix: 'Name0', label: 'Tax', type: PropertyType.TEXT, width: '30%' },
        { rdoSuffix: 'Tax', columnSuffix: 'Kind', label: 'Kind', type: PropertyType.TEXT, width: '15%' },
        // 0..100, not -100..100. A subsidy is not a negative rate the player
        // dials in: Voyager sends the literal '-10' and hides the bar
        // (TownTaxesSheet.pas:336-338), and the server ignores the magnitude
        // entirely, refunding the whole loss whatever it is (BasicTaxes.pas:197-210).
        // A negative slider would offer a mechanic that does not exist.
        { rdoSuffix: 'Tax', columnSuffix: 'Percent', label: 'Rate', type: PropertyType.SLIDER, width: '25%', editable: true, min: 0, max: 100, step: 1 },
        { rdoSuffix: 'Tax', columnSuffix: 'LastYear', label: 'Last Year', type: PropertyType.CURRENCY, width: '30%' },
      ],
    },
  ],
  rdoCommands: {
    'TaxPercent': { command: 'RDOSetTaxValue', indexed: true },
  },
};

// =============================================================================
// UNUSED GROUPS (kept for potential direct use)
// =============================================================================

export const OVERVIEW_GROUP: PropertyGroup = {
  id: 'overview',
  name: 'Overview',
  icon: 'i',
  order: 0,
  properties: [
    { rdoName: 'Name', displayName: 'Building Name', type: PropertyType.TEXT },
    { rdoName: 'Creator', displayName: 'Owner', type: PropertyType.TEXT },
    { rdoName: 'Years', displayName: 'Age', type: PropertyType.NUMBER, unit: 'years' },
    { rdoName: 'Cost', displayName: 'Value', type: PropertyType.CURRENCY },
    { rdoName: 'ROI', displayName: 'Return on Investment', type: PropertyType.PERCENTAGE, colorCode: 'auto' },
  ],
};

export const TOWN_GROUP: PropertyGroup = {
  id: 'town',
  name: 'Location',
  icon: 'L',
  order: 60,
  special: 'town',
  properties: [
    { rdoName: 'Town', displayName: 'Town', type: PropertyType.TEXT },
    { rdoName: 'TownName', displayName: 'Town Name', type: PropertyType.TEXT, hideEmpty: true },
    { rdoName: 'ActualRuler', displayName: 'Mayor', type: PropertyType.TEXT },
    { rdoName: 'TownQOL', displayName: 'Quality of Life', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'QOL', displayName: 'QoL', type: PropertyType.PERCENTAGE, hideEmpty: true },
  ],
};

export const COVERAGE_GROUP: PropertyGroup = {
  id: 'coverage',
  name: 'Coverage',
  icon: 'C',
  order: 70,
  properties: [
    { rdoName: 'covValue0', displayName: 'Colleges', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue1', displayName: 'Garbage Disposal', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue2', displayName: 'Fire Coverage', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue3', displayName: 'Health Coverage', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue4', displayName: 'Jails', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue5', displayName: 'Museums', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue6', displayName: 'Police Coverage', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue7', displayName: 'School Coverage', type: PropertyType.PERCENTAGE, hideEmpty: true },
    { rdoName: 'covValue8', displayName: 'Recreation', type: PropertyType.PERCENTAGE, hideEmpty: true },
  ],
};

export const TRADE_GROUP: PropertyGroup = {
  id: 'trade',
  name: 'Trade',
  icon: 'T',
  order: 35,
  properties: [
    { rdoName: 'TradeRole', displayName: 'Trade Role', type: PropertyType.ENUM, enumLabels: { '0': 'Neutral', '1': 'Producer', '2': 'Distributor', '3': 'Buyer', '4': 'Importer', '5': 'Export', '6': 'Import' } },
    { rdoName: 'TradeLevel', displayName: 'Trade Level', type: PropertyType.ENUM, editable: true, enumLabels: { '0': 'Same Owner', '1': 'Subsidiaries', '2': 'Allies', '3': 'Anyone' } },
    { rdoName: 'GateMap', displayName: 'Gate Map', type: PropertyType.NUMBER, hideEmpty: true },
  ],
};

export const LOCAL_SERVICES_GROUP: PropertyGroup = {
  id: 'localServices',
  name: 'Services',
  icon: 'Q',
  order: 45,
  properties: [
    { rdoName: 'srvCount', displayName: 'Service Count', type: PropertyType.NUMBER },
    { rdoName: 'GQOS', displayName: 'Quality of Service', type: PropertyType.PERCENTAGE },
    {
      rdoName: 'svrName',
      displayName: 'Service',
      type: PropertyType.TABLE,
      indexed: true,
      indexSuffix: '.0',
      countProperty: 'srvCount',
      columns: [
        { rdoSuffix: 'svrName', label: 'Service', type: PropertyType.TEXT, width: '25%' },
        { rdoSuffix: 'svrDemand', label: 'Demand', type: PropertyType.NUMBER, width: '12%' },
        { rdoSuffix: 'svrOffer', label: 'Offer', type: PropertyType.NUMBER, width: '12%' },
        { rdoSuffix: 'svrCapacity', label: 'Capacity', type: PropertyType.NUMBER, width: '12%' },
        { rdoSuffix: 'svrRatio', label: 'Ratio', type: PropertyType.PERCENTAGE, width: '12%' },
        { rdoSuffix: 'svrMarketPrice', label: 'Market', type: PropertyType.CURRENCY, width: '12%' },
        { rdoSuffix: 'svrQuality', label: 'Quality', type: PropertyType.PERCENTAGE, width: '12%' },
      ],
    },
  ],
};

// =============================================================================
// GROUP LOOKUP BY ID (for client-side property rendering)
// =============================================================================

export const GROUP_BY_ID: Record<string, PropertyGroup> = {
  'overview': OVERVIEW_GROUP,
  'generic': GENERIC_GROUP,
  'unkGeneral': UNK_GENERAL_GROUP,
  'indGeneral': IND_GENERAL_GROUP,
  'srvGeneral': SRV_GENERAL_GROUP,
  'resGeneral': RES_GENERAL_GROUP,
  'hqGeneral': HQ_GENERAL_GROUP,
  'hqInventions': HQ_INVENTIONS_GROUP,
  'bankGeneral': BANK_GENERAL_GROUP,
  'whGeneral': WH_GENERAL_GROUP,
  'tvGeneral': TV_GENERAL_GROUP,
  'capitolGeneral': CAPITOL_GENERAL_GROUP,
  'townGeneral': TOWN_GENERAL_GROUP,
  'workforce': WORKFORCE_GROUP,
  'supplies': SUPPLIES_GROUP,
  'products': PRODUCTS_GROUP,
  'upgrade': UPGRADE_GROUP,
  'finances': FINANCES_GROUP,
  'advertisement': ADVERTISEMENT_GROUP,
  'ads': ADS_GROUP,
  'town': TOWN_GROUP,
  'coverage': COVERAGE_GROUP,
  'trade': TRADE_GROUP,
  'localServices': LOCAL_SERVICES_GROUP,
  'bankLoans': BANK_LOANS_GROUP,
  'antennas': ANTENNAS_GROUP,
  'films': FILMS_GROUP,
  'mausoleum': MAUSOLEUM_GROUP,
  'votes': VOTES_GROUP,
  'capitolTowns': CAPITOL_TOWNS_GROUP,
  'ministeries': MINISTERIES_GROUP,
  'townJobs': TOWN_JOBS_GROUP,
  'townRes': TOWN_RES_GROUP,
  'townServices': TOWN_SERVICES_GROUP,
  'townProducts': TOWN_PRODUCTS_GROUP,
  'townTaxes': TOWN_TAXES_GROUP,
};

/**
 * Look up a PropertyGroup by tab ID, handling handler-suffixed IDs.
 * E.g., "generic_Ministeries" → GENERIC_GROUP, "supplies" → SUPPLIES_GROUP
 */
export function getGroupById(tabId: string): PropertyGroup | undefined {
  if (GROUP_BY_ID[tabId]) return GROUP_BY_ID[tabId];
  const underscoreIdx = tabId.indexOf('_');
  if (underscoreIdx > 0) {
    const baseId = tabId.substring(0, underscoreIdx);
    return GROUP_BY_ID[baseId];
  }
  return undefined;
}

// =============================================================================
// HANDLER → GROUP MAPPING (CLASSES.BIN [InspectorInfo] TabHandler values)
// =============================================================================

/**
 * Maps CLASSES.BIN handler names → PropertyGroup objects.
 * Handler names come from [InspectorInfo] TabHandler{i} values in CLASSES.BIN.
 */
export const HANDLER_TO_GROUP: Record<string, PropertyGroup> = {
  // General tab variants — each has dedicated properties
  'unkGeneral': UNK_GENERAL_GROUP,
  'ResGeneral': RES_GENERAL_GROUP,
  'IndGeneral': IND_GENERAL_GROUP,
  'SrvGeneral': SRV_GENERAL_GROUP,
  'HqGeneral': HQ_GENERAL_GROUP,
  'hdqInventions': HQ_INVENTIONS_GROUP,
  'BankGeneral': BANK_GENERAL_GROUP,
  'WHGeneral': WH_GENERAL_GROUP,
  'TVGeneral': TV_GENERAL_GROUP,
  'capitolGeneral': CAPITOL_GENERAL_GROUP,
  'townGeneral': TOWN_GENERAL_GROUP,

  // Core handlers (existing, working)
  'Supplies': SUPPLIES_GROUP,
  'Products': PRODUCTS_GROUP,
  'compInputs': ADVERTISEMENT_GROUP,
  'Ads': ADS_GROUP,
  'Workforce': WORKFORCE_GROUP,
  'facManagement': UPGRADE_GROUP,
  'Chart': FINANCES_GROUP,

  // Specialized handlers (NEW)
  'BankLoans': BANK_LOANS_GROUP,
  'Antennas': ANTENNAS_GROUP,
  'Films': FILMS_GROUP,
  'Mausoleum': MAUSOLEUM_GROUP,
  'Votes': VOTES_GROUP,
  'CapitolTowns': CAPITOL_TOWNS_GROUP,
  'Ministeries': MINISTERIES_GROUP,
  'townJobs': TOWN_JOBS_GROUP,
  'townRes': TOWN_RES_GROUP,
  'townServices': TOWN_SERVICES_GROUP,
  'townProducts': TOWN_PRODUCTS_GROUP,
  'townTaxes': TOWN_TAXES_GROUP,
};
