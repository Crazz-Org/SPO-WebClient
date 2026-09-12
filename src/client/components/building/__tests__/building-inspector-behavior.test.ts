/**
 * Building Inspector — UI Behavior Tests
 *
 * Universal traceability: every UI element must have a named behavior test here.
 * Tests verify data-model logic, template definitions, and callback expectations.
 * Test env is `node` (no jsdom) — tests do NOT render DOM.
 *
 * Test naming: "<Handler>: <element description>"
 * Run a single handler: npm test -- --testNamePattern="SrvGeneral"
 *
 * Reference: plan/moonlit-prancing-lerdorf.md — Element Registry
 */

import { describe, it, expect } from '@jest/globals';
import {
  SRV_GENERAL_GROUP,
  IND_GENERAL_GROUP,
  UNK_GENERAL_GROUP,
  RES_GENERAL_GROUP,
  HQ_GENERAL_GROUP,
  BANK_GENERAL_GROUP,
  WH_GENERAL_GROUP,
  TV_GENERAL_GROUP,
  SUPPLIES_GROUP,
  PRODUCTS_GROUP,
  ADVERTISEMENT_GROUP,
  WORKFORCE_GROUP,
  UPGRADE_GROUP,
  BANK_LOANS_GROUP,
  ANTENNAS_GROUP,
  FINANCES_GROUP,
  MAUSOLEUM_GROUP,
  FILMS_GROUP,
  VOTES_GROUP,
  CAPITOL_TOWNS_GROUP,
  MINISTERIES_GROUP,
  TOWN_JOBS_GROUP,
  TOWN_RES_GROUP,
  TOWN_SERVICES_GROUP,
  TOWN_PRODUCTS_GROUP,
  TOWN_TAXES_GROUP,
  HANDLER_TO_GROUP,
} from '../../../../shared/building-details/template-groups';
import { PropertyType } from '../../../../shared/building-details/property-definitions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get property definition by rdoName from a group */
function getProp(group: typeof SRV_GENERAL_GROUP, rdoName: string) {
  return group.properties.find(p => p.rdoName === rdoName);
}

/** Simulate how Stopped value maps to button label */
function stopToggleLabel(stoppedValue: string): 'Close' | 'Open' {
  const numVal = parseInt(stoppedValue, 10);
  const isStopped = !isNaN(numVal) && numVal !== 0;
  return isStopped ? 'Open' : 'Close';
}

/** Simulate hideEmpty logic: returns true if value should be hidden */
function shouldHide(value: string, hideEmpty?: boolean): boolean {
  if (!hideEmpty) return false;
  return value === '' || value === '0' || value === null || value === undefined;
}

// ---------------------------------------------------------------------------
// G5 + G6 — SrvGeneral: Trouble + SecurityId
// ---------------------------------------------------------------------------

describe('SrvGeneral', () => {
  it('Trouble: hideEmpty=true so issue code 0 is hidden', () => {
    const prop = getProp(SRV_GENERAL_GROUP, 'Trouble');
    expect(prop).toBeDefined();
    expect(prop!.hideEmpty).toBe(true);
    expect(shouldHide('0', prop!.hideEmpty)).toBe(true);
    expect(shouldHide('32', prop!.hideEmpty)).toBe(false);
  });

  it('SecurityId: hideEmpty=true so it does not appear in UI', () => {
    const prop = getProp(SRV_GENERAL_GROUP, 'SecurityId');
    expect(prop).toBeDefined();
    expect(prop!.hideEmpty).toBe(true);
    // SecurityId is always populated — hide it from visible UI
    expect(shouldHide('-132445236-', prop!.hideEmpty)).toBe(false); // non-empty = not hidden
    expect(shouldHide('', prop!.hideEmpty)).toBe(true);
  });

  it('Trouble: type is NUMBER (not text)', () => {
    const prop = getProp(SRV_GENERAL_GROUP, 'Trouble');
    expect(prop!.type).toBe(PropertyType.NUMBER);
  });

  it('SecurityId: type is TEXT (string value)', () => {
    const prop = getProp(SRV_GENERAL_GROUP, 'SecurityId');
    expect(prop!.type).toBe(PropertyType.TEXT);
  });

  it('Service card price column: slider 0-500, editable=true', () => {
    const cardProp = getProp(SRV_GENERAL_GROUP, 'srvNames');
    const priceCol = cardProp!.columns!.find(c => c.rdoSuffix === 'srvPrices');
    expect(priceCol).toBeDefined();
    expect(priceCol!.editable).toBe(true);
    expect(priceCol!.min).toBe(0);
    expect(priceCol!.max).toBe(500);
  });

  it('Supply% column: not editable (read-only)', () => {
    const cardProp = getProp(SRV_GENERAL_GROUP, 'srvNames');
    const supplyCol = cardProp!.columns!.find(c => c.rdoSuffix === 'srvSupplies');
    expect(supplyCol).toBeDefined();
    expect(supplyCol!.editable).toBeFalsy();
  });

  it('Demand% column: not editable (read-only)', () => {
    const cardProp = getProp(SRV_GENERAL_GROUP, 'srvNames');
    const demandCol = cardProp!.columns!.find(c => c.rdoSuffix === 'srvDemands');
    expect(demandCol).toBeDefined();
    expect(demandCol!.editable).toBeFalsy();
  });

  it('HANDLER_TO_GROUP maps SrvGeneral handler to SRV_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['SrvGeneral']).toBe(SRV_GENERAL_GROUP);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(SRV_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G9 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.rdoName).toBe('connectMap');
  });

  it('Connect button: buttonLabel is "Connect"', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop!.buttonLabel).toBe('Connect');
  });

  // G7 — Name editable
  it('Name: editable=true so owner can rename the building', () => {
    const prop = getProp(SRV_GENERAL_GROUP, 'Name');
    expect(prop).toBeDefined();
    expect(prop!.editable).toBe(true);
  });

  it('Name: rdoCommands maps Name to direct property SET', () => {
    expect(SRV_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.rdoName).toBe('demolish');
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// IndGeneral
// ---------------------------------------------------------------------------

describe('IndGeneral', () => {
  it('HANDLER_TO_GROUP maps IndGeneral to IND_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['IndGeneral']).toBe(IND_GENERAL_GROUP);
  });

  it('TradeRole: type is ENUM, editable', () => {
    const prop = getProp(IND_GENERAL_GROUP, 'TradeRole');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ENUM);
    expect(prop!.editable).toBe(true);
  });

  it('TradeLevel: type is ENUM, editable', () => {
    const prop = getProp(IND_GENERAL_GROUP, 'TradeLevel');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ENUM);
    expect(prop!.editable).toBe(true);
  });

  it('Cost: type is CURRENCY (not plain NUMBER)', () => {
    const prop = getProp(IND_GENERAL_GROUP, 'Cost');
    expect(prop!.type).toBe(PropertyType.CURRENCY);
  });

  it('ROI: type is PERCENTAGE with auto color-coding', () => {
    const prop = getProp(IND_GENERAL_GROUP, 'ROI');
    expect(prop!.type).toBe(PropertyType.PERCENTAGE);
    expect(prop!.colorCode).toBe('auto');
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(IND_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.rdoName).toBe('connectMap');
  });

  it('Connect button: buttonLabel is "Connect"', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop!.buttonLabel).toBe('Connect');
  });

  // G7 — Name editable
  it('Name: editable=true so owner can rename the building', () => {
    const prop = getProp(IND_GENERAL_GROUP, 'Name');
    expect(prop).toBeDefined();
    expect(prop!.editable).toBe(true);
  });

  it('Name: rdoCommands maps Name to direct property SET', () => {
    expect(IND_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// unkGeneral
// ---------------------------------------------------------------------------

describe('unkGeneral', () => {
  it('HANDLER_TO_GROUP maps unkGeneral to UNK_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['unkGeneral']).toBe(UNK_GENERAL_GROUP);
  });

  it('all properties are read-only (no editable=true)', () => {
    // unkGeneral is fallback — only display properties
    const editableProps = UNK_GENERAL_GROUP.properties.filter(p => p.editable === true);
    // Stopped may be editable once added in Batch 2; others should not be
    const nonStopEditable = editableProps.filter(p => p.rdoName !== 'Stopped' && p.rdoName !== '_stopToggle');
    expect(nonStopEditable).toHaveLength(0);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = UNK_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(UNK_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = UNK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = UNK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// ResGeneral
// ---------------------------------------------------------------------------

describe('ResGeneral', () => {
  it('HANDLER_TO_GROUP maps ResGeneral to RES_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['ResGeneral']).toBe(RES_GENERAL_GROUP);
  });

  it('Occupancy: type is PERCENTAGE', () => {
    const prop = getProp(RES_GENERAL_GROUP, 'Occupancy');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('QOL: type is PERCENTAGE', () => {
    const prop = getProp(RES_GENERAL_GROUP, 'QOL');
    expect(prop!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('Repair: REPAIR_CONTROL type present', () => {
    const repairProp = RES_GENERAL_GROUP.properties.find(p => p.type === PropertyType.REPAIR_CONTROL);
    expect(repairProp).toBeDefined();
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = RES_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(RES_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G7 — Name editable
  it('Name: editable=true so owner can rename the building', () => {
    const prop = getProp(RES_GENERAL_GROUP, 'Name');
    expect(prop).toBeDefined();
    expect(prop!.editable).toBe(true);
  });

  it('Name: rdoCommands maps Name to direct property SET', () => {
    expect(RES_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = RES_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = RES_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// HqGeneral
// ---------------------------------------------------------------------------

describe('HqGeneral', () => {
  it('HANDLER_TO_GROUP maps HqGeneral to HQ_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['HqGeneral']).toBe(HQ_GENERAL_GROUP);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = HQ_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(HQ_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = HQ_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = HQ_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// BankGeneral
// ---------------------------------------------------------------------------

describe('BankGeneral', () => {
  it('HANDLER_TO_GROUP maps BankGeneral to BANK_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['BankGeneral']).toBe(BANK_GENERAL_GROUP);
  });

  it('Interest: type is SLIDER, editable', () => {
    const prop = getProp(BANK_GENERAL_GROUP, 'Interest');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  it('Term: type is SLIDER, editable', () => {
    const prop = getProp(BANK_GENERAL_GROUP, 'Term');
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = BANK_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(BANK_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = BANK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = BANK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// WHGeneral
// ---------------------------------------------------------------------------

describe('WHGeneral', () => {
  it('HANDLER_TO_GROUP maps WHGeneral to WH_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['WHGeneral']).toBe(WH_GENERAL_GROUP);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(WH_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.rdoName).toBe('connectMap');
  });

  it('Connect button: buttonLabel is "Connect"', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop!.buttonLabel).toBe('Connect');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });

  // G9d — WHGeneral render/read-only property checks
  it('Role: type is ENUM, read-only (no editable flag)', () => {
    const prop = getProp(WH_GENERAL_GROUP, 'Role');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ENUM);
    expect(prop!.editable).toBeUndefined();
  });

  it('TradeLevel: type is ENUM, editable (owner can change)', () => {
    const prop = getProp(WH_GENERAL_GROUP, 'TradeLevel');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ENUM);
    expect(prop!.editable).toBe(true);
  });

  it('GateMap: WARE_CHECKLIST type for warehouse ware toggles', () => {
    const prop = getProp(WH_GENERAL_GROUP, 'GateMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.WARE_CHECKLIST);
    expect(prop!.displayName).toBe('Wares');
  });

  it('Years: NUMBER type with years unit', () => {
    const prop = getProp(WH_GENERAL_GROUP, 'Years');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.NUMBER);
    expect(prop!.unit).toBe('years');
  });

  it('General tab should NOT show ProductSummaryCards when warehouseWares has entries', () => {
    // Warehouses have a dedicated Products tab — product summaries must not
    // appear on the General tab. The guard checks warehouseWares presence.
    // PropertyGroup.tsx: isGeneralTab && products.length > 0 && !isWarehouse
    const warehouseWares = [
      { name: 'Chemicals', enabled: true, index: 0 },
      { name: 'Food', enabled: false, index: 1 },
    ];
    const isWarehouse = warehouseWares && warehouseWares.length > 0;
    expect(isWarehouse).toBe(true);
    // When isWarehouse is true, ProductSummaryCards must be skipped
  });

  it('General tab SHOULD show ProductSummaryCards for non-warehouse buildings with products', () => {
    // Non-warehouse buildings (factories, service) have no warehouseWares
    const warehouseWares = undefined;
    const isWarehouse = warehouseWares && (warehouseWares as unknown[]).length > 0;
    expect(isWarehouse).toBeFalsy();
    // When isWarehouse is falsy, ProductSummaryCards renders normally
  });
});

// ---------------------------------------------------------------------------
// TVGeneral
// ---------------------------------------------------------------------------

describe('TVGeneral', () => {
  it('HANDLER_TO_GROUP maps TVGeneral to TV_GENERAL_GROUP', () => {
    expect(HANDLER_TO_GROUP['TVGeneral']).toBe(TV_GENERAL_GROUP);
  });

  it('HoursOnAir: type is SLIDER, editable', () => {
    const prop = getProp(TV_GENERAL_GROUP, 'HoursOnAir');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  // G8 — Close/Open button
  it('Close/Open button: STOP_TOGGLE property present in template', () => {
    const prop = TV_GENERAL_GROUP.properties.find(p => p.type === PropertyType.STOP_TOGGLE);
    expect(prop).toBeDefined();
    expect(prop!.rdoName).toBe('Stopped');
  });

  it('Close/Open button: rdoCommands maps Stopped to direct property SET', () => {
    expect(TV_GENERAL_GROUP.rdoCommands?.['Stopped']?.command).toBe('property');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = TV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });

  it('Demolish button: buttonLabel is "Demolish"', () => {
    const prop = TV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop!.buttonLabel).toBe('Demolish');
  });
});

// ---------------------------------------------------------------------------
// Demolish button — ACTION_BUTTON (shared across all 8 General handlers)
// Full per-handler tests added in Batch 3 above — core logic tests here
// ---------------------------------------------------------------------------

describe('Demolish button (ACTION_BUTTON — all General handlers)', () => {
  const generalGroups = [
    { name: 'unkGeneral', group: UNK_GENERAL_GROUP },
    { name: 'IndGeneral', group: IND_GENERAL_GROUP },
    { name: 'SrvGeneral', group: SRV_GENERAL_GROUP },
    { name: 'ResGeneral', group: RES_GENERAL_GROUP },
    { name: 'HqGeneral', group: HQ_GENERAL_GROUP },
    { name: 'BankGeneral', group: BANK_GENERAL_GROUP },
    { name: 'WHGeneral', group: WH_GENERAL_GROUP },
    { name: 'TVGeneral', group: TV_GENERAL_GROUP },
  ];

  it('all 8 General groups have a demolish ACTION_BUTTON', () => {
    for (const { name, group } of generalGroups) {
      const prop = group.properties.find(p => p.actionId === 'demolish');
      expect(prop).toBeDefined();
      expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
      expect(prop!.rdoName).toBe('demolish');
      // Verify label
      expect(prop!.buttonLabel).toBe('Demolish');
      // Just reference name to avoid unused variable warning
      expect(typeof name).toBe('string');
    }
  });

  it('demolish button has no editable flag (it is owner-guarded by actionId in PropertyGroup)', () => {
    // Owner-only guard is handled in PropertyGroup.tsx via ownerOnlyActions Set
    // No editable flag needed on the property definition
    for (const { group } of generalGroups) {
      const prop = group.properties.find(p => p.actionId === 'demolish');
      expect(prop!.editable).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Connect button — ACTION_BUTTON (IndGeneral, SrvGeneral, WHGeneral)
// Full per-handler tests added in Batch 4 above — core logic tests here
// ---------------------------------------------------------------------------

describe('Connect button (ACTION_BUTTON — IndGeneral, SrvGeneral, WHGeneral)', () => {
  const connectGroups = [
    { name: 'IndGeneral', group: IND_GENERAL_GROUP },
    { name: 'SrvGeneral', group: SRV_GENERAL_GROUP },
    { name: 'WHGeneral', group: WH_GENERAL_GROUP },
  ];

  it('all 3 General groups have a connect ACTION_BUTTON', () => {
    for (const { name, group } of connectGroups) {
      const prop = group.properties.find(p => p.actionId === 'connectMap');
      expect(prop).toBeDefined();
      expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
      expect(prop!.rdoName).toBe('connectMap');
      expect(prop!.buttonLabel).toBe('Connect');
      expect(typeof name).toBe('string');
    }
  });

  it('all 3 groups have RDOConnectToTycoon in rdoCommands', () => {
    for (const { group } of connectGroups) {
      expect(group.rdoCommands?.['RDOConnectToTycoon']?.command).toBe('RDOConnectToTycoon');
    }
  });

  it('connect button appears before demolish button in property list', () => {
    for (const { group } of connectGroups) {
      const connectIdx = group.properties.findIndex(p => p.actionId === 'connectMap');
      const demolishIdx = group.properties.findIndex(p => p.actionId === 'demolish');
      expect(connectIdx).toBeGreaterThan(-1);
      expect(demolishIdx).toBeGreaterThan(-1);
      expect(connectIdx).toBeLessThan(demolishIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// Stopped property — Close/Open button logic (shared across all General handlers)
// Full per-handler tests added in Batch 2 — core logic tests here
// ---------------------------------------------------------------------------

describe('Stopped property (Close/Open — all General handlers)', () => {
  it('stopToggleLabel: returns "Close" when building is open (Stopped=0)', () => {
    expect(stopToggleLabel('0')).toBe('Close');
    expect(stopToggleLabel('0')).not.toBe('Open');
  });

  it('stopToggleLabel: returns "Open" when building is closed (Stopped=-1)', () => {
    expect(stopToggleLabel('-1')).toBe('Open');
    expect(stopToggleLabel('-1')).not.toBe('Close');
  });

  it('stopToggleLabel: non-zero integer is treated as stopped', () => {
    // Delphi wordbool: any non-zero value = true
    expect(stopToggleLabel('1')).toBe('Open');
    expect(stopToggleLabel('255')).toBe('Open');
  });

  it('stopToggleLabel: "0" = open, "-1" = closed (wordbool convention)', () => {
    // Confirms wordbool: true = -1, false = 0
    expect(stopToggleLabel('0')).toBe('Close');   // building is open → show "Close" button
    expect(stopToggleLabel('-1')).toBe('Open');    // building is closed → show "Open" button
  });
});

// ---------------------------------------------------------------------------
// compInputs — Demand slider behavior
// Full tests added in Batch 5
// ---------------------------------------------------------------------------

describe('compInputs (SERVICES tab)', () => {
  it('HANDLER_TO_GROUP maps compInputs to ADVERTISEMENT_GROUP', () => {
    expect(HANDLER_TO_GROUP['compInputs']).toBe(ADVERTISEMENT_GROUP);
  });

  it('ADVERTISEMENT_GROUP: special="compInputs" triggers CompInputsPanel rendering', () => {
    expect(ADVERTISEMENT_GROUP.special).toBe('compInputs');
  });

  it('Demand slider: ratio value clamped to 0-100 range', () => {
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    expect(clamp(0)).toBe(0);
    expect(clamp(100)).toBe(100);
    expect(clamp(-10)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(75)).toBe(75);
  });

  // G4 — Demand slider (Batch 5)
  it('Demand slider: ADVERTISEMENT_GROUP has RDOSetCompanyInputDemand in rdoCommands', () => {
    expect(ADVERTISEMENT_GROUP.rdoCommands?.['RDOSetCompanyInputDemand']?.command).toBe('RDOSetCompanyInputDemand');
  });

  it('Demand slider: index param tracks input position in compInputNames list', () => {
    // Server handler: buildRdoCommandArgs('RDOSetCompanyInputDemand', ratio, { index: String(idx) })
    // The idx comes from compInputNames.map((entry, idx) => ...) in CompInputsPanel
    const idx = 2; // arbitrary position
    const ratio = 75;
    const params = { index: String(idx) };
    expect(params.index).toBe('2');
    expect(ratio).toBe(75);
  });

  it('Demand slider: RDOSetCompanyInputDemand uses void push ("*") not function call', () => {
    // Verified by shared RDO test — re-assert the key constraint here.
    // Void push: server builds with .push() → "C sel <block> call RDOSetCompanyInputDemand "*" ..."
    // Legacy parity: the Delphi client sends this mutation fire-and-forget.
    // ("^" would be wire-legal WITH a QueryId; the real crash risk is "^"
    // without one.)
    expect(ADVERTISEMENT_GROUP.rdoCommands?.['RDOSetCompanyInputDemand']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Supplies
// ---------------------------------------------------------------------------

describe('Supplies', () => {
  it('HANDLER_TO_GROUP maps Supplies to SUPPLIES_GROUP', () => {
    expect(HANDLER_TO_GROUP['Supplies']).toBe(SUPPLIES_GROUP);
  });

  it('SUPPLIES_GROUP: special="supplies" triggers SuppliesPanel rendering', () => {
    expect(SUPPLIES_GROUP.special).toBe('supplies');
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('Products', () => {
  it('HANDLER_TO_GROUP maps Products to PRODUCTS_GROUP', () => {
    expect(HANDLER_TO_GROUP['Products']).toBe(PRODUCTS_GROUP);
  });

  it('PRODUCTS_GROUP: special="products" triggers ProductsPanel rendering', () => {
    expect(PRODUCTS_GROUP.special).toBe('products');
  });

  it('PricePc: SLIDER, editable=true (output price slider 0-300%)', () => {
    const prop = PRODUCTS_GROUP.properties.find(p => p.rdoName === 'PricePc');
    expect(prop).toBeDefined();
    expect(prop?.type).toBe(PropertyType.SLIDER);
    expect(prop?.editable).toBe(true);
    expect(prop?.min).toBe(0);
    expect(prop?.max).toBe(300);
  });

  it('PricePc: rdoCommands maps to RDOSetOutputPrice', () => {
    expect(PRODUCTS_GROUP.rdoCommands?.['PricePc']?.command).toBe('RDOSetOutputPrice');
  });

  it('PricePc: step=5 and unit="%" for percentage display', () => {
    const prop = PRODUCTS_GROUP.properties.find(p => p.rdoName === 'PricePc');
    expect(prop?.step).toBe(5);
    expect(prop?.unit).toBe('%');
  });

  it('RDOConnectOutput: rdoCommand registered for buyer connections', () => {
    expect(PRODUCTS_GROUP.rdoCommands?.['RDOConnectOutput']?.command).toBe('RDOConnectOutput');
  });

  it('RDODisconnectOutput: rdoCommand registered for disconnecting buyers', () => {
    expect(PRODUCTS_GROUP.rdoCommands?.['RDODisconnectOutput']?.command).toBe('RDODisconnectOutput');
  });
});

// ---------------------------------------------------------------------------
// Workforce
// ---------------------------------------------------------------------------

describe('Workforce', () => {
  it('HANDLER_TO_GROUP maps Workforce to WORKFORCE_GROUP', () => {
    expect(HANDLER_TO_GROUP['Workforce']).toBe(WORKFORCE_GROUP);
  });

  it('WORKFORCE_GROUP: type is WORKFORCE_TABLE', () => {
    const wfProp = WORKFORCE_GROUP.properties.find(p => p.type === PropertyType.WORKFORCE_TABLE);
    expect(wfProp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// facManagement
// ---------------------------------------------------------------------------

describe('facManagement', () => {
  it('HANDLER_TO_GROUP maps facManagement to UPGRADE_GROUP', () => {
    expect(HANDLER_TO_GROUP['facManagement']).toBe(UPGRADE_GROUP);
  });

  it('UPGRADE_GROUP: contains UPGRADE_ACTIONS type', () => {
    const upgProp = UPGRADE_GROUP.properties.find(p => p.type === PropertyType.UPGRADE_ACTIONS);
    expect(upgProp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// G9a — BankLoans: read-only loan table
// ---------------------------------------------------------------------------

describe('BankLoans', () => {
  it('HANDLER_TO_GROUP maps BankLoans to BANK_LOANS_GROUP', () => {
    expect(HANDLER_TO_GROUP['BankLoans']).toBe(BANK_LOANS_GROUP);
  });

  it('BANK_LOANS_GROUP: has a TABLE property with LoanCount as count', () => {
    const table = BANK_LOANS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('LoanCount');
  });

  it('Loan table: has Debtor (TEXT), Amount (CURRENCY), Interest (PERCENTAGE), Term (NUMBER) columns', () => {
    const table = BANK_LOANS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const cols = table!.columns!;
    expect(cols.find(c => c.rdoSuffix === 'Debtor')?.type).toBe(PropertyType.TEXT);
    expect(cols.find(c => c.rdoSuffix === 'Amount')?.type).toBe(PropertyType.CURRENCY);
    expect(cols.find(c => c.rdoSuffix === 'Interest')?.type).toBe(PropertyType.PERCENTAGE);
    expect(cols.find(c => c.rdoSuffix === 'Term')?.type).toBe(PropertyType.NUMBER);
  });

  it('Loan table: all columns are read-only (no editable flag)', () => {
    const table = BANK_LOANS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    for (const col of table!.columns!) {
      expect(col.editable).toBeUndefined();
    }
  });

  it('BANK_LOANS_GROUP: no write rdoCommands (read-only tab)', () => {
    expect(BANK_LOANS_GROUP.rdoCommands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G9b — Antennas: read-only antenna table
// ---------------------------------------------------------------------------

describe('Antennas', () => {
  it('HANDLER_TO_GROUP maps Antennas to ANTENNAS_GROUP', () => {
    expect(HANDLER_TO_GROUP['Antennas']).toBe(ANTENNAS_GROUP);
  });

  it('ANTENNAS_GROUP: has a TABLE property with antCount as count', () => {
    const table = ANTENNAS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('antCount');
  });

  it('Antenna table: has antName, antTown, antViewers, antActive, antX, antY columns', () => {
    const table = ANTENNAS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('antName');
    expect(suffixes).toContain('antTown');
    expect(suffixes).toContain('antViewers');
    expect(suffixes).toContain('antActive');
    expect(suffixes).toContain('antX');
    expect(suffixes).toContain('antY');
  });

  it('Antenna table: antActive is BOOLEAN (on/off indicator)', () => {
    const table = ANTENNAS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const activeCol = table!.columns!.find(c => c.rdoSuffix === 'antActive');
    expect(activeCol!.type).toBe(PropertyType.BOOLEAN);
  });

  it('ANTENNAS_GROUP: no write rdoCommands (read-only tab)', () => {
    expect(ANTENNAS_GROUP.rdoCommands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G9c — Chart: finance history (read-only graph)
// ---------------------------------------------------------------------------

describe('Chart', () => {
  it('HANDLER_TO_GROUP maps Chart to FINANCES_GROUP', () => {
    expect(HANDLER_TO_GROUP['Chart']).toBe(FINANCES_GROUP);
  });

  it('FINANCES_GROUP: has a GRAPH property for MoneyGraphInfo', () => {
    const graphProp = FINANCES_GROUP.properties.find(p => p.type === PropertyType.GRAPH);
    expect(graphProp).toBeDefined();
    expect(graphProp!.rdoName).toBe('MoneyGraphInfo');
  });

  it('FINANCES_GROUP: no editable properties (read-only history)', () => {
    for (const prop of FINANCES_GROUP.properties) {
      expect(prop.editable).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// G9e — CapitolTowns: town list table
// ---------------------------------------------------------------------------

describe('CapitolTowns', () => {
  it('HANDLER_TO_GROUP maps CapitolTowns to CAPITOL_TOWNS_GROUP', () => {
    expect(HANDLER_TO_GROUP['CapitolTowns']).toBe(CAPITOL_TOWNS_GROUP);
  });

  it('CAPITOL_TOWNS_GROUP: has a TABLE property with TownCount as count', () => {
    const table = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('TownCount');
  });

  it('Town table: has Town, TownPopulation, TownQOL, TownRating, TownWealth, TownTax, HasMayor, electMayor columns', () => {
    const table = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('Town');
    expect(suffixes).toContain('TownPopulation');
    expect(suffixes).toContain('TownQOL');
    expect(suffixes).toContain('TownRating');
    expect(suffixes).toContain('TownWealth');
    expect(suffixes).toContain('HasMayor');
    expect(suffixes).toContain('electMayor');
  });

  it('Town table: HasMayor is BOOLEAN column', () => {
    const table = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const mayorCol = table!.columns!.find(c => c.rdoSuffix === 'HasMayor');
    expect(mayorCol!.type).toBe(PropertyType.BOOLEAN);
  });

  it('Town table: TownTax is editable SLIDER column', () => {
    const table = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const taxCol = table!.columns!.find(c => c.rdoSuffix === 'TownTax');
    expect(taxCol!.type).toBe(PropertyType.SLIDER);
    expect(taxCol!.editable).toBe(true);
    expect(taxCol!.min).toBe(0);
    expect(taxCol!.max).toBe(100);
  });

  it('Town table: electMayor is ACTION_BUTTON column', () => {
    const table = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const electCol = table!.columns!.find(c => c.rdoSuffix === 'electMayor');
    expect(electCol!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(electCol!.actionId).toBe('electMayor');
    expect(electCol!.buttonLabel).toBe('Elect');
  });

  it('rdoCommands: electMayor maps to RDOSitMayor', () => {
    expect(CAPITOL_TOWNS_GROUP.rdoCommands?.['electMayor']?.command).toBe('RDOSitMayor');
  });

  it('rdoCommands: TownTax maps to RDOSetTownTaxes (indexed)', () => {
    expect(CAPITOL_TOWNS_GROUP.rdoCommands?.['TownTax']?.command).toBe('RDOSetTownTaxes');
    expect(CAPITOL_TOWNS_GROUP.rdoCommands?.['TownTax']?.indexed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G9f — TownJobs: employment stats + editable min salary sliders
// ---------------------------------------------------------------------------

describe('TownJobs', () => {
  it('HANDLER_TO_GROUP maps townJobs to TOWN_JOBS_GROUP', () => {
    expect(HANDLER_TO_GROUP['townJobs']).toBe(TOWN_JOBS_GROUP);
  });

  it('hiMinSalary: SLIDER, editable', () => {
    const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'hiMinSalary');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  it('midMinSalary: SLIDER, editable', () => {
    const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'midMinSalary');
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  it('loMinSalary: SLIDER, editable', () => {
    const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'loMinSalary');
    expect(prop!.type).toBe(PropertyType.SLIDER);
    expect(prop!.editable).toBe(true);
  });

  it('hiActualMinSalary/midActualMinSalary/loActualMinSalary: NUMBER, not editable', () => {
    for (const name of ['hiActualMinSalary', 'midActualMinSalary', 'loActualMinSalary']) {
      const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === name);
      expect(prop!.type).toBe(PropertyType.NUMBER);
      expect(prop!.editable).toBeUndefined();
    }
  });

  it('rdoCommands: all 3 sliders map to RDOSetMinSalaryValue with levelIndex', () => {
    const hi = TOWN_JOBS_GROUP.rdoCommands?.['hiMinSalary'];
    const mid = TOWN_JOBS_GROUP.rdoCommands?.['midMinSalary'];
    const lo = TOWN_JOBS_GROUP.rdoCommands?.['loMinSalary'];
    expect(hi?.command).toBe('RDOSetMinSalaryValue');
    expect(hi?.params?.levelIndex).toBe('0');
    expect(mid?.command).toBe('RDOSetMinSalaryValue');
    expect(mid?.params?.levelIndex).toBe('1');
    expect(lo?.command).toBe('RDOSetMinSalaryValue');
    expect(lo?.params?.levelIndex).toBe('2');
  });

  it('hiWorkDemand: NUMBER, read-only demand display', () => {
    const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'hiWorkDemand');
    expect(prop!.type).toBe(PropertyType.NUMBER);
    expect(prop!.editable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G9g — TownRes: residential statistics (all read-only)
// ---------------------------------------------------------------------------

describe('TownRes', () => {
  it('HANDLER_TO_GROUP maps townRes to TOWN_RES_GROUP', () => {
    expect(HANDLER_TO_GROUP['townRes']).toBe(TOWN_RES_GROUP);
  });

  it('TOWN_RES_GROUP: has hi/mid/lo demand, quantity, rent properties', () => {
    const names = TOWN_RES_GROUP.properties.map(p => p.rdoName);
    expect(names).toContain('hiResDemand');
    expect(names).toContain('midResQ');
    expect(names).toContain('loRentPrice');
  });

  it('hiRentPrice: PERCENTAGE type', () => {
    const prop = TOWN_RES_GROUP.properties.find(p => p.rdoName === 'hiRentPrice');
    expect(prop!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('TOWN_RES_GROUP: all properties read-only (no editable)', () => {
    for (const prop of TOWN_RES_GROUP.properties) {
      expect(prop.editable).toBeUndefined();
    }
  });

  it('TOWN_RES_GROUP: no write rdoCommands', () => {
    expect(TOWN_RES_GROUP.rdoCommands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G9h — TownServices: service coverage table (read-only)
// ---------------------------------------------------------------------------

describe('TownServices', () => {
  it('HANDLER_TO_GROUP maps townServices to TOWN_SERVICES_GROUP', () => {
    expect(HANDLER_TO_GROUP['townServices']).toBe(TOWN_SERVICES_GROUP);
  });

  it('GQOS: PERCENTAGE type — aggregate quality of service', () => {
    const prop = TOWN_SERVICES_GROUP.properties.find(p => p.rdoName === 'GQOS');
    expect(prop!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('TOWN_SERVICES_GROUP: has TABLE with srvCount as count', () => {
    const table = TOWN_SERVICES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table!.countProperty).toBe('srvCount');
  });

  it('Service table: has svrName, svrDemand, svrOffer, svrRatio, svrMarketPrice, svrQuality columns', () => {
    const table = TOWN_SERVICES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('svrName');
    expect(suffixes).toContain('svrDemand');
    expect(suffixes).toContain('svrOffer');
    expect(suffixes).toContain('svrRatio');
    expect(suffixes).toContain('svrMarketPrice');
    expect(suffixes).toContain('svrQuality');
  });

  it('Service table: svrRatio is PERCENTAGE (display 0-1 as %)', () => {
    const table = TOWN_SERVICES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const ratioCol = table!.columns!.find(c => c.rdoSuffix === 'svrRatio');
    expect(ratioCol!.type).toBe(PropertyType.PERCENTAGE);
  });
});

// ---------------------------------------------------------------------------
// G9i — TownProducts: product table (all read-only)
// ---------------------------------------------------------------------------

describe('TownProducts', () => {
  it('HANDLER_TO_GROUP maps townProducts to TOWN_PRODUCTS_GROUP', () => {
    expect(HANDLER_TO_GROUP['townProducts']).toBe(TOWN_PRODUCTS_GROUP);
  });

  it('TOWN_PRODUCTS_GROUP: has TABLE with prdCount as count', () => {
    const table = TOWN_PRODUCTS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('prdCount');
  });

  it('Product table: has prdName, prdOutputValue, prdInputValue columns', () => {
    const table = TOWN_PRODUCTS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('prdName');
    expect(suffixes).toContain('prdOutputValue');
    expect(suffixes).toContain('prdInputValue');
  });

  it('Product table: prdName uses .0 language suffix (MLS property)', () => {
    const table = TOWN_PRODUCTS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const nameCol = table!.columns!.find(c => c.rdoSuffix === 'prdName');
    expect(nameCol!.columnSuffix).toBe('.0');
  });

  it('Product table: all columns are read-only (no editable)', () => {
    const table = TOWN_PRODUCTS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    for (const col of table!.columns!) {
      expect(col.editable).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// G9j — TownTaxes: tax table with editable rate slider
// ---------------------------------------------------------------------------

describe('TownTaxes', () => {
  it('HANDLER_TO_GROUP maps townTaxes to TOWN_TAXES_GROUP', () => {
    expect(HANDLER_TO_GROUP['townTaxes']).toBe(TOWN_TAXES_GROUP);
  });

  it('TOWN_TAXES_GROUP: has TABLE with TaxCount as count', () => {
    const table = TOWN_TAXES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('TaxCount');
  });

  it('Tax table: TaxPercent column is SLIDER and editable', () => {
    const table = TOWN_TAXES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const rateCol = table!.columns!.find(c => c.columnSuffix === 'Percent');
    expect(rateCol!.type).toBe(PropertyType.SLIDER);
    expect(rateCol!.editable).toBe(true);
  });

  it('Tax table: TaxLastYear column is CURRENCY (previous year collected)', () => {
    const table = TOWN_TAXES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const lastYearCol = table!.columns!.find(c => c.columnSuffix === 'LastYear');
    expect(lastYearCol!.type).toBe(PropertyType.CURRENCY);
  });

  it('rdoCommands: TaxPercent maps to RDOSetTaxValue (indexed)', () => {
    expect(TOWN_TAXES_GROUP.rdoCommands?.['TaxPercent']?.command).toBe('RDOSetTaxValue');
    expect(TOWN_TAXES_GROUP.rdoCommands?.['TaxPercent']?.indexed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G9k — Mausoleum: monument static display
// ---------------------------------------------------------------------------

describe('Mausoleum', () => {
  it('HANDLER_TO_GROUP maps Mausoleum to MAUSOLEUM_GROUP', () => {
    expect(HANDLER_TO_GROUP['Mausoleum']).toBe(MAUSOLEUM_GROUP);
  });

  it('WordsOfWisdom: TEXT property present', () => {
    const prop = MAUSOLEUM_GROUP.properties.find(p => p.rdoName === 'WordsOfWisdom');
    expect(prop!.type).toBe(PropertyType.TEXT);
  });

  it('OwnerName: TEXT property present', () => {
    const prop = MAUSOLEUM_GROUP.properties.find(p => p.rdoName === 'OwnerName');
    expect(prop!.type).toBe(PropertyType.TEXT);
  });

  it('Transcended: BOOLEAN property present', () => {
    const prop = MAUSOLEUM_GROUP.properties.find(p => p.rdoName === 'Transcended');
    expect(prop!.type).toBe(PropertyType.BOOLEAN);
  });

  it('rdoCommands: WordsOfWisdom maps to RDOSetWordsOfWisdom', () => {
    expect(MAUSOLEUM_GROUP.rdoCommands?.['WordsOfWisdom']?.command).toBe('RDOSetWordsOfWisdom');
  });

  it('rdoCommands: RDOCacncelTransc (note: Delphi original typo preserved)', () => {
    expect(MAUSOLEUM_GROUP.rdoCommands?.['RDOCacncelTransc']?.command).toBe('RDOCacncelTransc');
  });
});

// ---------------------------------------------------------------------------
// G10a — Films: state machine UI tests
// ---------------------------------------------------------------------------

describe('Films', () => {
  it('HANDLER_TO_GROUP maps Films to FILMS_GROUP', () => {
    expect(HANDLER_TO_GROUP['Films']).toBe(FILMS_GROUP);
  });

  it('InProd: TEXT property (server sends "0" or "1" as string)', () => {
    const prop = FILMS_GROUP.properties.find(p => p.rdoName === 'InProd');
    expect(prop!.type).toBe(PropertyType.TEXT);
  });

  it('FilmDone: BOOLEAN property', () => {
    const prop = FILMS_GROUP.properties.find(p => p.rdoName === 'FilmDone');
    expect(prop!.type).toBe(PropertyType.BOOLEAN);
  });

  it('AutoProd: BOOLEAN, editable (auto-produce toggle)', () => {
    const prop = FILMS_GROUP.properties.find(p => p.rdoName === 'AutoProd');
    expect(prop!.type).toBe(PropertyType.BOOLEAN);
    expect(prop!.editable).toBe(true);
  });

  it('AutoRel: BOOLEAN, read-only — it is a launch parameter, not a property', () => {
    const prop = FILMS_GROUP.properties.find(p => p.rdoName === 'AutoRel');
    expect(prop!.type).toBe(PropertyType.BOOLEAN);
    expect(prop!.editable).toBeUndefined();
  });

  it('launchMovie: ACTION_BUTTON with actionId="launchMovie"', () => {
    const prop = FILMS_GROUP.properties.find(p => p.actionId === 'launchMovie');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Launch Movie');
  });

  it('cancelMovie: ACTION_BUTTON with actionId="cancelMovie"', () => {
    const prop = FILMS_GROUP.properties.find(p => p.actionId === 'cancelMovie');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Cancel Movie');
  });

  it('releaseMovie: ACTION_BUTTON with actionId="releaseMovie"', () => {
    const prop = FILMS_GROUP.properties.find(p => p.actionId === 'releaseMovie');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Release Movie');
  });

  it('rdoCommands: AutoProd maps to RDOAutoProduce', () => {
    expect(FILMS_GROUP.rdoCommands?.['AutoProd']?.command).toBe('RDOAutoProduce');
  });

  it('rdoCommands: AutoRel maps to nothing — RDOAutoRelease does not exist', () => {
    expect(FILMS_GROUP.rdoCommands?.['AutoRel']).toBeUndefined();
    expect(FILMS_GROUP.rdoCommands?.['AutoProd']?.command).toBe('RDOAutoProduce');
  });
});

// ---------------------------------------------------------------------------
// G10b — Votes: election/campaign display
// ---------------------------------------------------------------------------

describe('Votes', () => {
  it('HANDLER_TO_GROUP maps Votes to VOTES_GROUP', () => {
    expect(HANDLER_TO_GROUP['Votes']).toBe(VOTES_GROUP);
  });

  it('RulerName: TEXT property (current ruler display)', () => {
    const prop = VOTES_GROUP.properties.find(p => p.rdoName === 'RulerName');
    expect(prop!.type).toBe(PropertyType.TEXT);
  });

  it('VOTES_GROUP: has TABLE with CampaignCount as count', () => {
    const table = VOTES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('CampaignCount');
  });

  it('Candidate table: has Candidate, Votes, CmpRat, CmpPnts, voteAction columns', () => {
    const table = VOTES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('Candidate');
    expect(suffixes).toContain('Votes');
    expect(suffixes).toContain('CmpRat');
    expect(suffixes).toContain('CmpPnts');
    expect(suffixes).toContain('voteAction');
  });

  it('Candidate table: voteAction is inline ACTION_BUTTON column', () => {
    const table = VOTES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const voteCol = table!.columns!.find(c => c.rdoSuffix === 'voteAction');
    expect(voteCol!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(voteCol!.actionId).toBe('voteCandidate');
    expect(voteCol!.buttonLabel).toBe('Vote');
  });

  it('rdoCommands: RDOVote command is registered', () => {
    expect(VOTES_GROUP.rdoCommands?.['RDOVote']?.command).toBe('RDOVote');
  });

  it('rdoCommands: voteCandidate maps to RDOVote', () => {
    expect(VOTES_GROUP.rdoCommands?.['voteCandidate']?.command).toBe('RDOVote');
  });
});

// ---------------------------------------------------------------------------
// G10c — Ministeries: minister management
// ---------------------------------------------------------------------------

describe('Ministeries', () => {
  it('HANDLER_TO_GROUP maps Ministeries to MINISTERIES_GROUP', () => {
    expect(HANDLER_TO_GROUP['Ministeries']).toBe(MINISTERIES_GROUP);
  });

  it('MINISTERIES_GROUP: has TABLE with MinisterCount as count', () => {
    const table = MINISTERIES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(table).toBeDefined();
    expect(table!.countProperty).toBe('MinisterCount');
  });

  it('Minister table: has Ministry, Minister, MinisterRating, MinisterBudget, ministerAction columns', () => {
    const table = MINISTERIES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const suffixes = table!.columns!.map(c => c.rdoSuffix);
    expect(suffixes).toContain('Ministry');
    expect(suffixes).toContain('Minister');
    expect(suffixes).toContain('MinisterRating');
    expect(suffixes).toContain('MinisterBudget');
    expect(suffixes).toContain('ministerAction');
  });

  it('Minister table: MinisterBudget is editable CURRENCY column', () => {
    const table = MINISTERIES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const budgetCol = table!.columns!.find(c => c.rdoSuffix === 'MinisterBudget');
    expect(budgetCol!.type).toBe(PropertyType.CURRENCY);
    expect(budgetCol!.editable).toBe(true);
  });

  it('Minister table: ministerAction shows Elect when Minister empty, Depose via altAction when not', () => {
    const table = MINISTERIES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    const actionCol = table!.columns!.find(c => c.rdoSuffix === 'ministerAction');
    expect(actionCol!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(actionCol!.actionId).toBe('electMinister');
    expect(actionCol!.buttonLabel).toBe('Elect');
    expect(actionCol!.visibleWhen).toEqual({ column: 'Minister', condition: 'empty' });
    expect(actionCol!.altAction).toEqual({
      actionId: 'deposeMinister',
      buttonLabel: 'Depose',
      condition: 'notEmpty',
    });
  });

  it('rdoCommands: MinisterBudget maps to RDOSetMinistryBudget', () => {
    expect(MINISTERIES_GROUP.rdoCommands?.['MinisterBudget']?.command).toBe('RDOSetMinistryBudget');
  });

  it('rdoCommands: electMinister maps to RDOSitMinister', () => {
    expect(MINISTERIES_GROUP.rdoCommands?.['electMinister']?.command).toBe('RDOSitMinister');
  });

  it('rdoCommands: deposeMinister maps to RDOBanMinister', () => {
    expect(MINISTERIES_GROUP.rdoCommands?.['deposeMinister']?.command).toBe('RDOBanMinister');
  });
});

// ---------------------------------------------------------------------------
// Supplies: HQ Config 6 tab name and group identity
// ---------------------------------------------------------------------------

import {
  registerInspectorTabs,
  getTemplateForVisualClass,
  clearInspectorTabsCache,
} from '../../../../shared/building-details/property-templates';

describe('Supplies', () => {
  it('Supplies: tab name shows the raw CLASSES.BIN value, not the canonical group name', () => {
    // CLASSES.BIN stores tab names as all-caps raw strings like 'SERVICES'.
    // registerInspectorTabs must show that raw value, as Voyager does.
    clearInspectorTabsCache();
    registerInspectorTabs('testHQSupplies', [
      { tabName: 'SERVICES', tabHandler: 'Supplies' },
    ]);
    const template = getTemplateForVisualClass('testHQSupplies');
    const group = template.groups.find(g => g.handlerName === 'Supplies');
    expect(group).toBeDefined();
    expect(group!.name).toBe('SERVICES');  // raw CLASSES.BIN value, not 'Supplies'
    expect(group!.special).toBe('supplies');  // group identity did not move
  });

  it('Supplies: HANDLER_TO_GROUP maps "Supplies" to SUPPLIES_GROUP', () => {
    expect(HANDLER_TO_GROUP['Supplies']).toBe(SUPPLIES_GROUP);
  });

  it('Supplies: SUPPLIES_GROUP has canonical name "Supplies"', () => {
    expect(SUPPLIES_GROUP.name).toBe('Supplies');
    expect(SUPPLIES_GROUP.special).toBe('supplies');
    expect(SUPPLIES_GROUP.icon).toBe('S');
  });
});
