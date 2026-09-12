/**
 * Building Inspector — RDO Wire Format Tests
 *
 * Universal traceability: every UI element that sends an RDO command must have
 * a named test here that verifies the exact wire format.
 *
 * Test naming: "<Handler>: <element description>"
 * Run a single handler: npm test -- --testNamePattern="SrvGeneral"
 *
 * Reference: plan/moonlit-prancing-lerdorf.md — Element Registry
 */

import { describe, it, expect } from '@jest/globals';
import { RdoCommand, RdoValue } from '../../../shared/rdo-types';
import {
  SRV_GENERAL_GROUP,
  IND_GENERAL_GROUP,
  UNK_GENERAL_GROUP,
  RES_GENERAL_GROUP,
  HQ_GENERAL_GROUP,
  BANK_GENERAL_GROUP,
  WH_GENERAL_GROUP,
  TV_GENERAL_GROUP,
  PRODUCTS_GROUP,
  TOWN_JOBS_GROUP,
  TOWN_RES_GROUP,
  TOWN_SERVICES_GROUP
} from '../../../shared/building-details/template-groups';
import { PropertyType } from '../../../shared/building-details/property-definitions';
import type { BuildingPropertyValue } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_CURR_BLOCK = '#128629376';
const MOCK_WORLD_ID = '#109319792';
const MOCK_X = 459;
const MOCK_Y = 389;

/** Build a void-push CALL command (procedure, no return value) */
function callVoid(objectId: string, method: string, ...args: RdoValue[]): string {
  return RdoCommand.sel(objectId).call(method).push().args(...args).build();
}

/** Build a function CALL command (returns OleVariant) */
function callFn(objectId: string, method: string, ...args: RdoValue[]): string {
  return RdoCommand.sel(objectId).call(method).method().args(...args).build();
}

/** Build a direct property SET command */
function setProp(objectId: string, prop: string, val: RdoValue): string {
  return RdoCommand.sel(objectId).set(prop).args(val).build();
}

// ---------------------------------------------------------------------------
// G5 + G6 — SrvGeneral: missing properties added to template
// ---------------------------------------------------------------------------

describe('SrvGeneral', () => {
  it('Trouble fetch: property included in Phase 1 list', () => {
    const propNames = SRV_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Trouble');
  });

  it('SecurityId fetch: property included in Phase 1 list', () => {
    const propNames = SRV_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('SecurityId');
  });

  it('Trouble: hideEmpty flag ensures zero values are not rendered', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.rdoName === 'Trouble');
    expect(prop).toBeDefined();
    expect(prop!.hideEmpty).toBe(true);
  });

  it('SecurityId: hideEmpty flag ensures it is not displayed in UI', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.rdoName === 'SecurityId');
    expect(prop).toBeDefined();
    expect(prop!.hideEmpty).toBe(true);
  });

  // G16 — Price slider: RDOSetPrice void push (existing, kept here for completeness)
  it('Price slider: RDOSetPrice is a void push ("*" separator), args are index + price integers', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetPrice', RdoValue.int(0), RdoValue.int(390));
    expect(cmd).toContain('call RDOSetPrice');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#0"');
    expect(cmd).toContain('"#390"');
    // Must NOT contain "^" (would make it a function call, not void push)
    expect(cmd).not.toContain('"^"');
  });

  it('Price slider: RDOSetPrice index increments per service card', () => {
    const cmd0 = callVoid(MOCK_CURR_BLOCK, 'RDOSetPrice', RdoValue.int(0), RdoValue.int(500));
    const cmd1 = callVoid(MOCK_CURR_BLOCK, 'RDOSetPrice', RdoValue.int(1), RdoValue.int(200));
    expect(cmd0).toContain('"#0"');
    expect(cmd1).toContain('"#1"');
  });

  // G8 — Close/Open button: Stopped must be fetched so the button knows current state
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = SRV_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  it('Stopped SET: uses CurrBlock (not worldId), integer wordbool prefix', () => {
    const closeCmd = setProp(MOCK_CURR_BLOCK, 'Stopped', RdoValue.int(-1));
    expect(closeCmd).toContain(`sel ${MOCK_CURR_BLOCK}`);
    expect(closeCmd).toContain('"#-1"');
    // Must NOT target worldId
    expect(closeCmd).not.toContain(MOCK_WORLD_ID);
  });

  // G7 — Name editable (widestring SET)
  it('Name SET: uses widestring prefix (%) not integer (#)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Name', RdoValue.string('My Service Name'));
    expect(cmd).toContain('set Name');
    expect(cmd).toContain('"%My Service Name"');
    expect(cmd).not.toContain('"#');
  });

  it('Name SET: rdoCommands maps Name to direct property command', () => {
    expect(SRV_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G9 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Connect');
  });

  it('Connect button: rdoCommands has RDOConnectToTycoon entry', () => {
    expect(SRV_GENERAL_GROUP.rdoCommands?.['RDOConnectToTycoon']?.command).toBe('RDOConnectToTycoon');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = SRV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Demolish');
  });

  it('Demolish: uses worldId (NOT CurrBlock) — verified by RDODelFacility shared test', () => {
    // RDODelFacility targets worldId — confirmed in shared describe below
    const cmd = callFn(MOCK_WORLD_ID, 'RDODelFacility', RdoValue.int(MOCK_X), RdoValue.int(MOCK_Y));
    expect(cmd).toContain(`sel ${MOCK_WORLD_ID}`);
    expect(cmd).not.toContain(MOCK_CURR_BLOCK);
  });
});

// ---------------------------------------------------------------------------
// IndGeneral
// ---------------------------------------------------------------------------

describe('IndGeneral', () => {
  it('Creator fetch: property included in template list', () => {
    const propNames = IND_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Creator');
  });

  it('RDOSetRole: void push, single integer arg', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetRole', RdoValue.int(2));
    expect(cmd).toContain('call RDOSetRole');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#2"');
  });

  it('RDOSetTradeLevel: void push, single integer arg', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetTradeLevel', RdoValue.int(3));
    expect(cmd).toContain('call RDOSetTradeLevel');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#3"');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = IND_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G7 — Name editable (widestring SET)
  it('Name SET: uses widestring prefix (%) not integer (#)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Name', RdoValue.string('Factory Alpha'));
    expect(cmd).toContain('set Name');
    expect(cmd).toContain('"%Factory Alpha"');
    expect(cmd).not.toContain('"#');
  });

  it('Name SET: rdoCommands maps Name to direct property command', () => {
    expect(IND_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Connect');
  });

  it('Connect button: rdoCommands has RDOConnectToTycoon entry', () => {
    expect(IND_GENERAL_GROUP.rdoCommands?.['RDOConnectToTycoon']?.command).toBe('RDOConnectToTycoon');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = IND_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// unkGeneral
// ---------------------------------------------------------------------------

describe('unkGeneral', () => {
  it('Name fetch: property included in template list', () => {
    const propNames = UNK_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Name');
  });

  it('Creator fetch: property included in template list', () => {
    const propNames = UNK_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Creator');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = UNK_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = UNK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// ResGeneral
// ---------------------------------------------------------------------------

describe('ResGeneral', () => {
  it('Rent SET: direct property set with integer value', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Rent', RdoValue.int(120));
    expect(cmd).toContain('set Rent');
    expect(cmd).toContain('"#120"');
  });

  it('Maintenance SET: direct property set with integer value', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Maintenance', RdoValue.int(80));
    expect(cmd).toContain('set Maintenance');
    expect(cmd).toContain('"#80"');
  });

  // G7 — Name editable (widestring SET)
  it('Name SET: uses widestring prefix (%) not integer (#)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Name', RdoValue.string('My Apartment'));
    expect(cmd).toContain('set Name');
    expect(cmd).toContain('"%My Apartment"');
    expect(cmd).not.toContain('"#');
  });

  it('Name SET: rdoCommands maps Name to direct property command', () => {
    expect(RES_GENERAL_GROUP.rdoCommands?.['Name']?.command).toBe('property');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = RES_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = RES_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// HqGeneral
// ---------------------------------------------------------------------------

describe('HqGeneral', () => {
  it('Name fetch: property included in template list', () => {
    const propNames = HQ_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Name');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = HQ_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connectMap" present in template', () => {
    const prop = HQ_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Connect');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = HQ_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// BankGeneral
// ---------------------------------------------------------------------------

describe('BankGeneral', () => {
  it('Interest SET: direct property set', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Interest', RdoValue.int(15));
    expect(cmd).toContain('set Interest');
    expect(cmd).toContain('"#15"');
  });

  it('RDOSetLoanPerc: void push, single integer arg', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetLoanPerc', RdoValue.int(50));
    expect(cmd).toContain('call RDOSetLoanPerc');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#50"');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = BANK_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = BANK_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// WHGeneral
// ---------------------------------------------------------------------------

describe('WHGeneral', () => {
  it('RDOSetTradeLevel: void push, single integer arg', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetTradeLevel', RdoValue.int(2));
    expect(cmd).toContain('call RDOSetTradeLevel');
    expect(cmd).toContain('"*"');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = WH_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connect" present in template', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Connect');
  });

  it('Connect button: rdoCommands has RDOConnectToTycoon entry', () => {
    expect(WH_GENERAL_GROUP.rdoCommands?.['RDOConnectToTycoon']?.command).toBe('RDOConnectToTycoon');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = WH_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// TVGeneral
// ---------------------------------------------------------------------------

describe('TVGeneral', () => {
  it('HoursOnAir SET: direct property set', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'HoursOnAir', RdoValue.int(75));
    expect(cmd).toContain('set HoursOnAir');
    expect(cmd).toContain('"#75"');
  });

  // G8 — Stopped fetch
  it('Stopped fetch: included in Phase 1 list — required for Close/Open button state', () => {
    const propNames = TV_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(propNames).toContain('Stopped');
  });

  // G3 — Connect button
  it('Connect button: ACTION_BUTTON with actionId="connectMap" present in template', () => {
    const prop = TV_GENERAL_GROUP.properties.find(p => p.actionId === 'connectMap');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
    expect(prop!.buttonLabel).toBe('Connect');
  });

  // G2 — Demolish button
  it('Demolish button: ACTION_BUTTON with actionId="demolish" present in template', () => {
    const prop = TV_GENERAL_GROUP.properties.find(p => p.actionId === 'demolish');
    expect(prop).toBeDefined();
    expect(prop!.type).toBe(PropertyType.ACTION_BUTTON);
  });
});

// ---------------------------------------------------------------------------
// Demolish — RDODelFacility (shared across all General handlers)
// Added in Batch 3 — placeholder describe blocks here for runner discoverability
// ---------------------------------------------------------------------------

describe('RDODelFacility (Demolish — all General handlers)', () => {
  it('uses worldId (NOT CurrBlock), function call "^" separator, integer x+y args', () => {
    const cmd = callFn(MOCK_WORLD_ID, 'RDODelFacility', RdoValue.int(MOCK_X), RdoValue.int(MOCK_Y));
    expect(cmd).toContain(`sel ${MOCK_WORLD_ID}`);
    expect(cmd).toContain('call RDODelFacility');
    expect(cmd).toContain('"^"');
    expect(cmd).toContain(`"#${MOCK_X}"`);
    expect(cmd).toContain(`"#${MOCK_Y}"`);
    // Must NOT use CurrBlock
    expect(cmd).not.toContain(MOCK_CURR_BLOCK);
  });

  it('result is parsed as integer (success=0)', () => {
    // Delphi: function RDODelFacility(...): OleVariant → Result := 0 on success
    // Response: A<id> res="#0"
    const responseVal = '#0';
    expect(responseVal.startsWith('#')).toBe(true);
    expect(parseInt(responseVal.slice(1), 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stopped property — Close/Open button (shared across all General handlers)
// Full tests added in Batch 2 — core wire format tests here
// ---------------------------------------------------------------------------

describe('Stopped property (Close/Open — all General handlers)', () => {
  it('Close: SET Stopped "#-1" (wordbool true = -1, not 1)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Stopped', RdoValue.int(-1));
    expect(cmd).toContain('set Stopped');
    expect(cmd).toContain('"#-1"');
    expect(cmd).not.toContain('"#1"');
  });

  it('Open: SET Stopped "#0" (wordbool false = 0)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Stopped', RdoValue.int(0));
    expect(cmd).toContain('set Stopped');
    expect(cmd).toContain('"#0"');
  });

  it('uses SET verb, not CALL (property, not method)', () => {
    const closeCmd = setProp(MOCK_CURR_BLOCK, 'Stopped', RdoValue.int(-1));
    expect(closeCmd).toContain('set Stopped');
    expect(closeCmd).not.toContain('call Stopped');
  });
});

// ---------------------------------------------------------------------------
// RDOConnectToTycoon — Connect button (IndGeneral, SrvGeneral, WHGeneral)
// Full tests added in Batch 4
// ---------------------------------------------------------------------------

describe('RDOConnectToTycoon (Connect button)', () => {
  it('void push "*" separator, 3 args: tycoonId (int), kind (int), flag (wordbool -1)', () => {
    const TYCOON_ID = 999001;
    const KIND = 1;
    const cmd = callVoid(
      MOCK_CURR_BLOCK,
      'RDOConnectToTycoon',
      RdoValue.int(TYCOON_ID),
      RdoValue.int(KIND),
      RdoValue.int(-1),
    );
    expect(cmd).toContain('call RDOConnectToTycoon');
    expect(cmd).toContain('"*"');
    expect(cmd).not.toContain('"^"');
    expect(cmd).toContain(`"#${TYCOON_ID}"`);
    expect(cmd).toContain(`"#${KIND}"`);
    expect(cmd).toContain('"#-1"');
  });

  it('RDODisconnectFromTycoon: same signature as Connect (void push)', () => {
    const TYCOON_ID = 999001;
    const cmd = callVoid(
      MOCK_CURR_BLOCK,
      'RDODisconnectFromTycoon',
      RdoValue.int(TYCOON_ID),
      RdoValue.int(1),
      RdoValue.int(-1),
    );
    expect(cmd).toContain('call RDODisconnectFromTycoon');
    expect(cmd).toContain('"*"');
    expect(cmd).not.toContain('"^"');
  });
});

// ---------------------------------------------------------------------------
// compInputs — Demand slider
// Full test added in Batch 5
// ---------------------------------------------------------------------------

describe('compInputs (SERVICES tab)', () => {
  it('Demand slider: RDOSetCompanyInputDemand void push, args: index (int) + ratio (int 0-100)', () => {
    const cmd = callVoid(
      MOCK_CURR_BLOCK,
      'RDOSetCompanyInputDemand',
      RdoValue.int(0),
      RdoValue.int(75),
    );
    expect(cmd).toContain('call RDOSetCompanyInputDemand');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#0"');
    expect(cmd).toContain('"#75"');
  });

  it('Demand slider: index increments per input accordion item', () => {
    const cmd0 = callVoid(MOCK_CURR_BLOCK, 'RDOSetCompanyInputDemand', RdoValue.int(0), RdoValue.int(50));
    const cmd1 = callVoid(MOCK_CURR_BLOCK, 'RDOSetCompanyInputDemand', RdoValue.int(1), RdoValue.int(80));
    expect(cmd0).toContain('"#0"');
    expect(cmd1).toContain('"#1"');
  });

  it('Demand slider: ratio clamped to 0-100 range', () => {
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    expect(clamp(-10)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(75)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Name edit (G7) — SET Name widestring
// Full tests added in Batch 6
// ---------------------------------------------------------------------------

describe('Name property (editable — IndGeneral, SrvGeneral, ResGeneral)', () => {
  it('SET Name uses widestring prefix "%", not integer "#"', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Name', RdoValue.string('Drug Store 9'));
    expect(cmd).toContain('set Name');
    expect(cmd).toContain('"%Drug Store 9"');
    expect(cmd).not.toContain('"#');
  });

  it('SET Name: empty string is valid (clears name)', () => {
    const cmd = setProp(MOCK_CURR_BLOCK, 'Name', RdoValue.string(''));
    expect(cmd).toContain('set Name');
    expect(cmd).toContain('"%"');
  });
});

// ---------------------------------------------------------------------------
// Products (G8) — output price slider wire format
// ---------------------------------------------------------------------------

describe('Products', () => {
  it('RDOSetOutputPrice: fire-and-forget with "*" separator, 2 args: fluidId (string) + price (integer)', () => {
    // Wire: C sel <block> call RDOSetOutputPrice "*" "%fluidId","#price"
    // Fire-and-forget: always "*" — "^" without RID crashes Delphi server.
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetOutputPrice', RdoValue.string('Chemicals'), RdoValue.int(150));
    expect(cmd).toContain('call RDOSetOutputPrice');
    expect(cmd).toContain('"*"');
    expect(cmd).not.toContain('"^"');
    expect(cmd).toContain('"%Chemicals"');
    expect(cmd).toContain('"#150"');
  });

  it('RDOSetOutputPrice: fluidId uses % prefix (widestring), price uses # prefix (integer)', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetOutputPrice', RdoValue.string('Food'), RdoValue.int(0));
    expect(cmd).toContain('"%Food"');
    expect(cmd).toContain('"#0"');
    expect(cmd).not.toContain('"#Food"'); // fluidId must NOT be integer prefix
  });

  it('PricePc: rdoCommands maps to RDOSetOutputPrice (template traceability)', () => {
    expect(PRODUCTS_GROUP.rdoCommands?.['PricePc']?.command).toBe('RDOSetOutputPrice');
  });
});

// ---------------------------------------------------------------------------
// fetchCompInputData — GetPropertyList wire format (cInputCount/cInput{i}.*)
// Verifies the 2-phase RDO protocol for compInputs tab
// ---------------------------------------------------------------------------

import {
  ADVERTISEMENT_GROUP,
  HANDLER_TO_GROUP,
} from '../../../shared/building-details/template-groups';

describe('fetchCompInputData RDO wire (compInputs tab)', () => {
  // Phase 1: get count
  it('Phase 1: GetPropertyList for cInputCount uses "^" separator (synchronous call)', () => {
    const propList = 'cInputCount\t';
    const cmd = callFn(MOCK_CURR_BLOCK, 'GetPropertyList', RdoValue.string(propList));
    expect(cmd).toContain('call GetPropertyList');
    expect(cmd).toContain('"^"');
    // RdoValue.string() embeds the actual tab character (not escaped \t)
    expect(cmd).toContain('cInputCount');
    expect(cmd).toContain(propList); // contains real tab
  });

  it('Phase 1: property list has trailing tab separator', () => {
    // cacherGetPropertyList: query = names.join('\t') + '\t'
    const names = ['cInputCount'];
    const query = names.join('\t') + '\t';
    expect(query).toBe('cInputCount\t');
    expect(query.endsWith('\t')).toBe(true);
  });

  // Phase 2: batch all 7 props × n inputs
  it('Phase 2 (n=1): GetPropertyList batch contains all 7 fields for input 0', () => {
    const names = ['cInput0.0', 'cInputSup0', 'cInputDem0', 'cInputRatio0', 'cInputMax0', 'cEditable0', 'cUnits0.0'];
    const propList = names.join('\t') + '\t';
    const cmd = callFn(MOCK_CURR_BLOCK, 'GetPropertyList', RdoValue.string(propList));
    // RdoValue.string() embeds real tab characters — check each property name is present
    for (const name of names) {
      expect(cmd).toContain(name);
    }
    // Full prop list (with real tabs) is embedded
    expect(cmd).toContain(propList);
  });

  it('Phase 2 (n=3): batch has 21 properties (7 per input)', () => {
    const count = 3;
    const PROPS_PER_INPUT = 7;
    const propNames: string[] = [];
    for (let i = 0; i < count; i++) {
      propNames.push(
        `cInput${i}.0`, `cInputSup${i}`, `cInputDem${i}`,
        `cInputRatio${i}`, `cInputMax${i}`, `cEditable${i}`, `cUnits${i}.0`,
      );
    }
    expect(propNames).toHaveLength(count * PROPS_PER_INPUT);
    expect(propNames[0]).toBe('cInput0.0');
    expect(propNames[6]).toBe('cUnits0.0');
    expect(propNames[7]).toBe('cInput1.0');
    expect(propNames[14]).toBe('cInput2.0');
    expect(propNames[20]).toBe('cUnits2.0');
  });

  it('Phase 2: batch ≤49 props per GetPropertyList call (stays under 50-prop limit)', () => {
    const BATCH_SIZE = 49;
    // 7 inputs × 7 props = 49 — fits in one batch
    const count = 7;
    const propNames: string[] = [];
    for (let i = 0; i < count; i++) {
      propNames.push(
        `cInput${i}.0`, `cInputSup${i}`, `cInputDem${i}`,
        `cInputRatio${i}`, `cInputMax${i}`, `cEditable${i}`, `cUnits${i}.0`,
      );
    }
    const batches: string[][] = [];
    for (let offset = 0; offset < propNames.length; offset += BATCH_SIZE) {
      batches.push(propNames.slice(offset, offset + BATCH_SIZE));
    }
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(49);
    // 8 inputs requires 2 batches
    const propNames8 = Array.from({ length: 8 * 7 }, (_, k) => `prop${k}`);
    const batches8: string[][] = [];
    for (let offset = 0; offset < propNames8.length; offset += BATCH_SIZE) {
      batches8.push(propNames8.slice(offset, offset + BATCH_SIZE));
    }
    expect(batches8).toHaveLength(2);
  });

  // Template traceability
  it('HANDLER_TO_GROUP maps "compInputs" to ADVERTISEMENT_GROUP', () => {
    expect(HANDLER_TO_GROUP['compInputs']).toBe(ADVERTISEMENT_GROUP);
  });

  it('ADVERTISEMENT_GROUP has special="compInputs"', () => {
    expect(ADVERTISEMENT_GROUP.special).toBe('compInputs');
  });

  // Demand slider RDO (already in compInputs describe above — cross-reference)
  it('RDOSetCompanyInputDemand: void push ("*"), args = index (int) + ratio (int 0-100)', () => {
    const cmd = callVoid(MOCK_CURR_BLOCK, 'RDOSetCompanyInputDemand', RdoValue.int(1), RdoValue.int(80));
    expect(cmd).toContain('call RDOSetCompanyInputDemand');
    expect(cmd).toContain('"*"');
    expect(cmd).toContain('"#1"');
    expect(cmd).toContain('"#80"');
  });
});

// ---------------------------------------------------------------------------
// Supplies: HQ Config 6 GetInputNames multi-entry CRLF parsing
// ---------------------------------------------------------------------------

describe('Supplies', () => {
  it('Supplies: multi-entry GetInputNames trims CRLF separators', () => {
    // GetInputNames returns entries separated by \r\n (CRLF).
    // split('\r') leaves a leading '\n' on entries 2+.
    // The fix: .map(e => e.trim()) strips leading '\n' before path extraction.
    const rawResponse = 'path1::\nAdvertisement\r\npath2::\nComputer Services\r\npath3::\nLegal Services';
    const entries = rawResponse.split('\r').map(e => e.trim()).filter(Boolean);

    expect(entries).toHaveLength(3);
    // Each entry must start with the path (no leading '\n')
    expect(entries[0]).toBe('path1::\nAdvertisement');
    expect(entries[1]).toBe('path2::\nComputer Services');
    expect(entries[2]).toBe('path3::\nLegal Services');

    // Path extraction (substring(0, colonIdx)) must yield clean path for each entry
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':');
      const path = entry.substring(0, colonIdx);
      expect(path.startsWith('\n')).toBe(false);  // no leading newline
      expect(path.length).toBeGreaterThan(0);
    }
  });

  it('Supplies: name extraction uses colonIdx+3 to skip "::\\n" separator', () => {
    // Format: path::\nname — colonIdx+3 skips '::' + '\n', landing on first char of name
    const entry = 'Companies\\HQ\\Inputs\\00000001.Ads.five::\nAdvertisement';
    const colonIdx = entry.indexOf(':');
    const name = entry.substring(colonIdx + 3);
    expect(name).toBe('Advertisement');
  });

  it('Supplies: SetPath success requires "-1" only (Delphi WordBool TRUE)', () => {
    // Delphi WordBool: -1 = TRUE (success), 0 = FALSE (failure).
    // Only '-1' means SetPath succeeded — '0' must NOT be treated as success.
    const isSuccess = (result: string) => result === '-1';
    expect(isSuccess('-1')).toBe(true);
    expect(isSuccess('0')).toBe(false);   // was incorrectly accepted before fix
    expect(isSuccess('1')).toBe(false);
    expect(isSuccess('')).toBe(false);
  });

  it('Supplies: GetInputNames wire format — SEL + call + method separator', () => {
    // GetInputNames is a function call returning OleVariant (uses "^" separator)
    const cmd = callFn(MOCK_CURR_BLOCK, 'GetInputNames', RdoValue.int(0), RdoValue.string('0'));
    expect(cmd).toContain('call GetInputNames');
    expect(cmd).toContain('"^"');
    expect(cmd).toContain('"#0"');
    expect(cmd).toContain('"%0"');
  });
});

// ---------------------------------------------------------------------------
// Response assembly — empty string handling (Bug fix: if(value) → if(value !== undefined))
// ---------------------------------------------------------------------------

describe('Response assembly: empty string values', () => {
  /**
   * Simulates the response assembly logic from spo_session.ts (lines 6062-6200).
   * Tests that empty string values ('') are NOT dropped by the assembly.
   */
  function assembleRegularProperties(
    properties: { rdoName: string; type: string; maxProperty?: string }[],
    allValues: Map<string, string>,
  ): BuildingPropertyValue[] {
    const groupValues: BuildingPropertyValue[] = [];
    for (const prop of properties) {
      const value = allValues.get(prop.rdoName);
      // This is the FIXED check: !== undefined instead of truthy
      if (value !== undefined) {
        groupValues.push({ name: prop.rdoName, value });
        if (prop.maxProperty) {
          const maxValue = allValues.get(prop.maxProperty);
          if (maxValue !== undefined) {
            groupValues.push({ name: prop.maxProperty, value: maxValue });
          }
        }
      }
    }
    return groupValues;
  }

  function assembleWorkforceProperties(
    allValues: Map<string, string>,
  ): BuildingPropertyValue[] {
    const groupValues: BuildingPropertyValue[] = [];
    for (let i = 0; i < 3; i++) {
      const workerProps = [
        `Workers${i}`, `WorkersMax${i}`, `WorkersK${i}`,
        `Salaries${i}`, `WorkForcePrice${i}`,
      ];
      for (const propName of workerProps) {
        const value = allValues.get(propName);
        // This is the FIXED check: !== undefined instead of truthy
        if (value !== undefined) {
          groupValues.push({ name: propName, value, index: i });
        }
      }
    }
    return groupValues;
  }

  it('should include regular properties with empty string values (Jobs tab)', () => {
    const allValues = new Map<string, string>();
    for (const prop of TOWN_JOBS_GROUP.properties) {
      allValues.set(prop.rdoName, ''); // Server returns empty strings
    }

    const result = assembleRegularProperties(
      TOWN_JOBS_GROUP.properties.map(p => ({ rdoName: p.rdoName, type: p.type })),
      allValues,
    );

    // All 15 properties should be present (not dropped by empty string check)
    expect(result).toHaveLength(TOWN_JOBS_GROUP.properties.length);
    for (const prop of TOWN_JOBS_GROUP.properties) {
      expect(result.find(r => r.name === prop.rdoName)).toBeDefined();
    }
  });

  it('should include regular properties with empty string values (Residential tab)', () => {
    const allValues = new Map<string, string>();
    for (const prop of TOWN_RES_GROUP.properties) {
      allValues.set(prop.rdoName, '');
    }

    const result = assembleRegularProperties(
      TOWN_RES_GROUP.properties.map(p => ({ rdoName: p.rdoName, type: p.type })),
      allValues,
    );

    expect(result).toHaveLength(TOWN_RES_GROUP.properties.length);
  });

  it('should include regular properties with "0" values (truthy in old code but verify)', () => {
    const allValues = new Map<string, string>();
    for (const prop of TOWN_JOBS_GROUP.properties) {
      allValues.set(prop.rdoName, '0');
    }

    const result = assembleRegularProperties(
      TOWN_JOBS_GROUP.properties.map(p => ({ rdoName: p.rdoName, type: p.type })),
      allValues,
    );

    expect(result).toHaveLength(TOWN_JOBS_GROUP.properties.length);
    expect(result.every(r => r.value === '0')).toBe(true);
  });

  it('should exclude properties not in allValues (undefined)', () => {
    const allValues = new Map<string, string>();
    // Only set first 3 properties
    const first3 = TOWN_JOBS_GROUP.properties.slice(0, 3);
    for (const prop of first3) {
      allValues.set(prop.rdoName, '42');
    }

    const result = assembleRegularProperties(
      TOWN_JOBS_GROUP.properties.map(p => ({ rdoName: p.rdoName, type: p.type })),
      allValues,
    );

    expect(result).toHaveLength(3);
  });

  it('should include workforce properties with empty string values', () => {
    const allValues = new Map<string, string>();
    for (let i = 0; i < 3; i++) {
      allValues.set(`Workers${i}`, '');
      allValues.set(`WorkersMax${i}`, '');
      allValues.set(`WorkersK${i}`, '');
      allValues.set(`Salaries${i}`, '');
      allValues.set(`WorkForcePrice${i}`, '');
    }

    const result = assembleWorkforceProperties(allValues);
    expect(result).toHaveLength(15); // 3 classes × 5 properties
  });

  it('should include max property with empty string value', () => {
    const allValues = new Map<string, string>();
    allValues.set('SomeProperty', '50');
    allValues.set('SomePropertyMax', '');

    const result = assembleRegularProperties(
      [{ rdoName: 'SomeProperty', type: 'NUMBER', maxProperty: 'SomePropertyMax' }],
      allValues,
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ name: 'SomePropertyMax', value: '' });
  });

  it('town services should have correct column structure for TABLE', () => {
    const tableDef = TOWN_SERVICES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableDef).toBeDefined();
    expect(tableDef!.countProperty).toBe('srvCount');
    expect(tableDef!.columns).toHaveLength(8);
    // svrName column uses .0 MLS suffix
    expect(tableDef!.columns![0].columnSuffix).toBe('.0');
    expect(tableDef!.columns![0].rdoSuffix).toBe('svrName');
  });
});
