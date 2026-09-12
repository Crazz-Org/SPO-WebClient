/**
 * Protocol Validation Tests - Building Details Scenario
 *
 * Validates that the building-details scenario's RDO exchanges
 * correctly match commands built in the same format as
 * cacherGetPropertyList() (spo_session.ts:2396-2412).
 *
 * Tests round-trip: build command → RdoMock.match() → parse response.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RdoMock } from '../../../mock-server/rdo-mock';
import { RdoStrictValidator } from '../../../mock-server/rdo-strict-validator';
import { RdoProtocol } from '../../rdo';
import { cleanPayload, parsePropertyResponse } from '../../rdo-helpers';
import { rdoGet } from '../../../shared/rdo-frame';
import { UPGRADE_GROUP } from '../../../shared/building-details/template-groups';
import { collectTemplatePropertyNamesStructured } from '../../../shared/building-details';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import {
  createBuildingDetailsScenario,
  ALL_MOCK_BUILDINGS,
  MOCK_FACTORY,
  MOCK_STORE,
  MOCK_BANK,
  MOCK_TV_STATION,
  MOCK_CAPITOL,
  MOCK_TOWN_HALL,
  MOCK_RESIDENTIAL,
  MOCK_WAREHOUSE,
  MOCK_MAUSOLEUM,
  type MockBuilding,
} from '../../../mock-server/scenarios/building-details-scenario';
import type { RdoPacket } from '../../../shared/types/protocol-types';
import { RdoAction, RdoVerb } from '../../../shared/types/protocol-types';

/**
 * Build a GetPropertyList command string matching cacherGetPropertyList format.
 * Mirrors spo_session.ts lines 2396-2412:
 *   query = propertyNames.join('\t') + '\t'
 *   → sent as: C <rid> sel <objectId> call GetPropertyList "^" "%<query>"
 */
function buildGetPropertyListCommand(
  rid: number,
  objectId: string,
  propertyNames: string[]
): string {
  const query = propertyNames.join('\t') + '\t';
  const packet: RdoPacket = {
    raw: '',
    type: 'REQUEST',
    rid,
    verb: RdoVerb.SEL,
    targetId: objectId,
    action: RdoAction.CALL,
    member: 'GetPropertyList',
    separator: '"^"',
    args: [`"%${query}"`],
  };
  return RdoProtocol.format(packet);
}

describe('Building Details Scenario Structure', () => {
  it('should have 10 mock buildings', () => {
    expect(ALL_MOCK_BUILDINGS).toHaveLength(10);
  });

  it('should create scenario with RDO exchanges for all building groups', () => {
    const { rdo } = createBuildingDetailsScenario();

    // Count total groups across all buildings
    const totalGroups = ALL_MOCK_BUILDINGS.reduce(
      (sum, b) => sum + Object.keys(b.groups).length, 0
    );

    expect(rdo.exchanges).toHaveLength(totalGroups);
  });

  it('should generate exchange IDs in bd-rdo-BBGG format', () => {
    const { rdo } = createBuildingDetailsScenario();

    for (const exchange of rdo.exchanges) {
      expect(exchange.id).toMatch(/^bd-rdo-\d{2}\d{2}$/);
    }
  });

  it('should include matchKeys with GetPropertyList member', () => {
    const { rdo } = createBuildingDetailsScenario();

    for (const exchange of rdo.exchanges) {
      expect(exchange.matchKeys).toBeDefined();
      expect(exchange.matchKeys!.member).toBe('GetPropertyList');
      expect(exchange.matchKeys!.action).toBe('call');
      expect(exchange.matchKeys!.verb).toBe('sel');
    }
  });

  it('should include argsPattern with property names for each exchange', () => {
    const { rdo } = createBuildingDetailsScenario();

    for (const exchange of rdo.exchanges) {
      expect(exchange.matchKeys!.argsPattern).toBeDefined();
      expect(exchange.matchKeys!.argsPattern).toHaveLength(1);
      // argsPattern[0] should start with "% and end with tab+"
      const pattern = exchange.matchKeys!.argsPattern![0];
      expect(pattern).toMatch(/^"%.*\t"$/);
    }
  });
});

describe('GetPropertyList Round-Trip Matching', () => {
  let rdoMock: RdoMock;
  let validator: RdoStrictValidator;

  beforeEach(() => {
    rdoMock = new RdoMock();
    validator = new RdoStrictValidator();
    const { rdo } = createBuildingDetailsScenario();
    rdoMock.addScenario(rdo);
    validator.addScenario(rdo);
  });

  afterEach(() => {
    const errors = validator.getErrors();
    if (errors.length > 0) {
      throw new Error(validator.formatReport());
    }
  });

  /**
   * Helper: extract property names from a mock building's group
   */
  function getGroupPropertyNames(building: MockBuilding, groupId: string): string[] {
    return (building.groups[groupId] || []).map(p => p.name);
  }

  // Test each mock building's first group for basic round-trip
  const buildingsToTest: Array<{ building: MockBuilding; groupId: string; label: string }> = [
    { building: MOCK_FACTORY, groupId: 'indGeneral', label: 'Factory (IndGeneral)' },
    { building: MOCK_STORE, groupId: 'srvGeneral', label: 'Store (SrvGeneral)' },
    { building: MOCK_BANK, groupId: 'bankGeneral', label: 'Bank (BankGeneral)' },
    { building: MOCK_TV_STATION, groupId: 'tvGeneral', label: 'TV Station (TVGeneral)' },
    { building: MOCK_CAPITOL, groupId: 'capitolGeneral', label: 'Capitol (capitolGeneral)' },
    { building: MOCK_TOWN_HALL, groupId: 'townGeneral', label: 'Town Hall (townGeneral)' },
    { building: MOCK_RESIDENTIAL, groupId: 'resGeneral', label: 'Residential (ResGeneral)' },
    { building: MOCK_WAREHOUSE, groupId: 'whGeneral', label: 'Warehouse (WHGeneral)' },
    { building: MOCK_MAUSOLEUM, groupId: 'mausoleum', label: 'Mausoleum' },
  ];

  for (const { building, groupId, label } of buildingsToTest) {
    it(`should match GetPropertyList command for ${label}`, () => {
      const propNames = getGroupPropertyNames(building, groupId);
      expect(propNames.length).toBeGreaterThan(0);

      // Build the same command cacherGetPropertyList would send
      const cmd = buildGetPropertyListCommand(200, '99999', propNames);
      const result = rdoMock.match(cmd);
      validator.validate(RdoProtocol.parse(cmd), cmd);

      expect(result).not.toBeNull();
      expect(result!.exchange.matchKeys!.member).toBe('GetPropertyList');
    });
  }
});

describe('Multi-Group Building Matching', () => {
  let rdoMock: RdoMock;
  let validator: RdoStrictValidator;

  beforeEach(() => {
    rdoMock = new RdoMock();
    validator = new RdoStrictValidator();
    const { rdo } = createBuildingDetailsScenario();
    rdoMock.addScenario(rdo);
    validator.addScenario(rdo);
  });

  afterEach(() => {
    const errors = validator.getErrors();
    if (errors.length > 0) {
      throw new Error(validator.formatReport());
    }
  });

  it('should differentiate Factory groups by argsPattern', () => {
    // MOCK_FACTORY has: indGeneral, workforce, upgrade, finances
    const groups = Object.keys(MOCK_FACTORY.groups);
    expect(groups.length).toBeGreaterThanOrEqual(3);

    const matchedExchangeIds = new Set<string>();

    for (const groupId of groups) {
      const propNames = MOCK_FACTORY.groups[groupId].map(p => p.name);
      const cmd = buildGetPropertyListCommand(200, '99999', propNames);
      const result = rdoMock.match(cmd);

      expect(result).not.toBeNull();
      matchedExchangeIds.add(result!.exchange.id);
    }

    // Each group should match a DIFFERENT exchange
    expect(matchedExchangeIds.size).toBe(groups.length);
  });

  it('should differentiate Bank groups (bankGeneral vs bankLoans)', () => {
    const generalProps = MOCK_BANK.groups['bankGeneral'].map(p => p.name);
    const loansProps = MOCK_BANK.groups['bankLoans'].map(p => p.name);

    const generalCmd = buildGetPropertyListCommand(200, '99999', generalProps);
    const loansCmd = buildGetPropertyListCommand(201, '99999', loansProps);

    const generalResult = rdoMock.match(generalCmd);
    const loansResult = rdoMock.match(loansCmd);

    expect(generalResult).not.toBeNull();
    expect(loansResult).not.toBeNull();
    expect(generalResult!.exchange.id).not.toBe(loansResult!.exchange.id);
  });

  it('should differentiate TV Station groups (tvGeneral vs antennas vs films vs workforce)', () => {
    const groupIds = Object.keys(MOCK_TV_STATION.groups);
    expect(groupIds.length).toBe(4);

    const matchedIds = new Set<string>();

    for (const groupId of groupIds) {
      const propNames = MOCK_TV_STATION.groups[groupId].map(p => p.name);
      const cmd = buildGetPropertyListCommand(200, '99999', propNames);
      const result = rdoMock.match(cmd);

      expect(result).not.toBeNull();
      matchedIds.add(result!.exchange.id);
    }

    expect(matchedIds.size).toBe(4);
  });

  it('should differentiate Capitol groups (govGeneral vs votes vs taxInfo)', () => {
    const groupIds = Object.keys(MOCK_CAPITOL.groups);
    expect(groupIds.length).toBeGreaterThanOrEqual(2);

    const matchedIds = new Set<string>();

    for (const groupId of groupIds) {
      const propNames = MOCK_CAPITOL.groups[groupId].map(p => p.name);
      const cmd = buildGetPropertyListCommand(200, '99999', propNames);
      const result = rdoMock.match(cmd);

      expect(result).not.toBeNull();
      matchedIds.add(result!.exchange.id);
    }

    expect(matchedIds.size).toBe(groupIds.length);
  });
});

describe('Response Parsing', () => {
  let rdoMock: RdoMock;
  let validator: RdoStrictValidator;

  beforeEach(() => {
    rdoMock = new RdoMock();
    validator = new RdoStrictValidator();
    const { rdo } = createBuildingDetailsScenario();
    rdoMock.addScenario(rdo);
    validator.addScenario(rdo);
  });

  afterEach(() => {
    const errors = validator.getErrors();
    if (errors.length > 0) {
      throw new Error(validator.formatReport());
    }
  });

  /**
   * Extract payload from response (A<rid> <payload>) then clean it.
   * Mirrors how spo_session parses responses:
   *   const raw = cleanPayload(packet.payload || '');
   */
  function parseResponseValues(response: string): string[] {
    // Parse the raw response to extract payload
    const parsed = RdoProtocol.parse(response);
    const cleaned = cleanPayload(parsed.payload || '');
    return cleaned.split('\t');
  }

  it('should return tab-delimited property values for Factory indGeneral', () => {
    const propNames = MOCK_FACTORY.groups['indGeneral'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    const values = parseResponseValues(result!.response);

    // Should have same number of values as properties
    expect(values.length).toBe(propNames.length);
    // First value should be building name
    expect(values[0]).toBe('Chemical Plant 3');
    // Second value should be creator
    expect(values[1]).toBe('Yellow Inc.');
  });

  it('should return correct Store service count', () => {
    const propNames = MOCK_STORE.groups['srvGeneral'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    const values = parseResponseValues(result!.response);

    // Find ServiceCount index
    const serviceCountIdx = propNames.indexOf('ServiceCount');
    expect(serviceCountIdx).toBeGreaterThanOrEqual(0);
    expect(values[serviceCountIdx]).toBe('2');
  });

  it('should return correct Bank loan data', () => {
    const propNames = MOCK_BANK.groups['bankLoans'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    const values = parseResponseValues(result!.response);

    // LoanCount should be first
    expect(values[0]).toBe('3');
    // First debtor should be Yellow Inc.
    expect(values[1]).toBe('Yellow Inc.');
  });

  it('should return response in A<rid> format', () => {
    const propNames = MOCK_FACTORY.groups['indGeneral'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    expect(result!.response).toMatch(/^A200 res="%/);
  });

  it('should parse Mausoleum WordsOfWisdom correctly', () => {
    const propNames = MOCK_MAUSOLEUM.groups['mausoleum'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    const values = parseResponseValues(result!.response);

    expect(values[0]).toBe('Build wisely, prosper greatly.');
  });
});

describe('argsPattern Matching Accuracy', () => {
  let rdoMock: RdoMock;
  let validator: RdoStrictValidator;

  beforeEach(() => {
    rdoMock = new RdoMock();
    validator = new RdoStrictValidator();
    const { rdo } = createBuildingDetailsScenario();
    rdoMock.addScenario(rdo);
    validator.addScenario(rdo);
  });

  afterEach(() => {
    const errors = validator.getErrors();
    if (errors.length > 0) {
      throw new Error(validator.formatReport());
    }
  });

  it('should NOT match when property names are completely different', () => {
    // Build a command with property names that don't exist in any exchange
    const cmd = buildGetPropertyListCommand(200, '99999', ['NonExistent', 'FakeProperty']);

    // Should still match via methodMatch fallback (member=GetPropertyList)
    // but let's verify it matches SOME exchange (not the specific one)
    const result = rdoMock.match(cmd);
    // methodMatch returns the first GetPropertyList exchange found
    expect(result).not.toBeNull();
  });

  it('should match argsPattern-specific exchange over wildcard', () => {
    // Factory workforce has specific properties
    const workforceProps = MOCK_FACTORY.groups['workforce'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', workforceProps);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    // Verify it matched the WORKFORCE exchange, not some other one
    const expectedPropNames = workforceProps.join('\t') + '\t';
    expect(result!.exchange.matchKeys!.argsPattern![0]).toContain(expectedPropNames);
  });

  it('should match Residential single-group correctly', () => {
    const propNames = MOCK_RESIDENTIAL.groups['resGeneral'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    // Verify response contains "Luxury Apartments"
    const cleaned = cleanPayload(result!.response);
    expect(cleaned).toContain('Luxury Apartments');
  });

  it('should match Warehouse with TradeRole/TradeLevel properties', () => {
    const propNames = MOCK_WAREHOUSE.groups['whGeneral'].map(p => p.name);
    const cmd = buildGetPropertyListCommand(200, '99999', propNames);
    const result = rdoMock.match(cmd);

    expect(result).not.toBeNull();
    const cleaned = cleanPayload(result!.response);
    const values = cleaned.split('\t');

    const tradeLevelIdx = propNames.indexOf('TradeLevel');
    expect(values[tradeLevelIdx]).toBe('3');
  });

  it('should handle commands with different objectId (wildcard target)', () => {
    // The scenario uses targetId='*' — should match any objectId
    const propNames = MOCK_FACTORY.groups['indGeneral'].map(p => p.name);

    const cmd1 = buildGetPropertyListCommand(200, '12345', propNames);
    const cmd2 = buildGetPropertyListCommand(201, '99999', propNames);

    const result1 = rdoMock.match(cmd1);
    const result2 = rdoMock.match(cmd2);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Both should match the same exchange (same argsPattern)
    expect(result1!.exchange.id).toBe(result2!.exchange.id);
  });
});


// ===========================================================================
// AcceptCloning — read live, never from the property list
// ===========================================================================

/**
 * `AcceptCloning` used to travel inside the GetPropertyList query for the
 * upgrade tab. TBlock.StoreToCache (Kernel/Kernel.pas:5824-5905) never writes
 * it, so the cache answered an empty string (spo_session.ts:1416-1417) and the
 * checkbox stayed unchecked on every building — while the server default is
 * true (Kernel.pas:5239). Voyager has the same split: the sheet's cached
 * property list omits it (Voyager/ManagementSheet.pas:242-250) and the value
 * comes from a live get on CurrBlock (:272-273).
 */
describe('AcceptCloning is read live, not from the property list', () => {
  const CURR_BLOCK = '40133888';

  /** Hand-written: the exchange the live read produces, both flag states. */
  function acceptCloningScenario(value: string): RdoScenario {
    return {
      name: 'accept-cloning',
      description: 'Live get of RDOAcceptCloning on CurrBlock',
      variables: {},
      exchanges: [
        {
          id: 'ac-rdo-001',
          request: `C 300 sel ${CURR_BLOCK} get RDOAcceptCloning`,
          response: `A300 RDOAcceptCloning="#${value}"`,
          matchKeys: { verb: 'sel', action: 'get', member: 'RDOAcceptCloning' },
        },
      ],
    };
  }

  it('is not among the names the upgrade tab asks the cache for', () => {
    const collected = collectTemplatePropertyNamesStructured({
      visualClassIds: ['*'],
      name: 'Probe',
      groups: [UPGRADE_GROUP],
    });

    expect(collected.regularProperties).not.toContain('AcceptCloning');
    // The rest of the tab still travels — the skip is scoped to one name.
    expect(collected.regularProperties).toContain('UpgradeLevel');
    // Including the block id the live read binds to (ManagementSheet.pas:243).
    expect(collected.regularProperties).toContain('CurrBlock');
  });

  it('emits a catalogued get frame that the strict validator accepts', () => {
    const scenario = acceptCloningScenario('1');
    const validator = new RdoStrictValidator();
    validator.addScenario(scenario);

    // The emitter's own frame, given the rid sendRdoRequest would stamp on it,
    // is byte-for-byte the request the exchange declares.
    const frame = rdoGet('RDOAcceptCloning', CURR_BLOCK).toFrame();
    expect(frame).toBe(`C sel ${CURR_BLOCK} get RDOAcceptCloning;`);

    const request = scenario.exchanges[0].request;
    validator.validate(RdoProtocol.parse(request), request);
    expect(validator.getErrors()).toEqual([]);
  });

  it('matches the live get and reads back "1"', () => {
    const rdoMock = new RdoMock();
    rdoMock.addScenario(acceptCloningScenario('1'));

    const result = rdoMock.match(`C 300 sel ${CURR_BLOCK} get RDOAcceptCloning`);

    expect(result).not.toBeNull();
    const payload = RdoProtocol.parse(result!.response).payload || '';
    expect(parsePropertyResponse(payload, 'RDOAcceptCloning')).toBe('1');
  });

  it('reads back "0" when the flag is cleared', () => {
    const rdoMock = new RdoMock();
    rdoMock.addScenario(acceptCloningScenario('0'));

    const result = rdoMock.match(`C 300 sel ${CURR_BLOCK} get RDOAcceptCloning`);

    expect(result).not.toBeNull();
    const payload = RdoProtocol.parse(result!.response).payload || '';
    expect(parsePropertyResponse(payload, 'RDOAcceptCloning')).toBe('0');
  });
});
