/**
 * Protocol Validation Tests - Building Details Scenario
 *
 * Drives production `cacherGetPropertyList` on a real StarpeaceSession through
 * the protocol harness, loaded with the building-details scenario, strict
 * validation on. Each test asserts the values production returns, and which
 * scenario exchange answered (`RdoMock.getConsumedIds()`); one test pins the
 * full emitted GetPropertyList frame as a literal. The bank's borrow box
 * (production `requestBankLoan`: the CurrBlock lookup, then `RDOAskLoan` on
 * that block) is driven the same way.
 *
 * Edge payloads — an all-empty answer (`res="%\t\t\t"` -> `['', '', '']`),
 * leading empties, untyped values, bodiless answers — are pinned on the same
 * production parser in `src/server/__tests__/spo-session-lifecycle.test.ts`,
 * describe `cacher object pool`; they are not repeated here.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, afterEach } from '@jest/globals';
import { RdoMock } from '../../../mock-server/rdo-mock';
import { RdoStrictValidator } from '../../../mock-server/rdo-strict-validator';
import { RdoProtocol } from '../../rdo';
import { parsePropertyResponse } from '../../rdo-helpers';
import { rdoGet } from '../../../shared/rdo-frame';
import { UPGRADE_GROUP } from '../../../shared/building-details/template-groups';
import { collectTemplatePropertyNamesStructured } from '../../../shared/building-details';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import { createBankLoanRequestScenario } from '../../../mock-server/scenarios/bank-loan-request-scenario';
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

/** The property names a mock building's group asks the cache for. */
function groupNames(building: MockBuilding, groupId: string): string[] {
  return (building.groups[groupId] || []).map(p => p.name);
}

let harness: ProtocolTestHarness | undefined;

/** A harness whose map socket answers from the building-details scenario. */
async function detailsHarness(): Promise<ProtocolTestHarness> {
  const h = createProtocolTestHarness({
    socketConfigs: [{ rdoScenarios: [createBuildingDetailsScenario().rdo] }],
  });
  harness = h;
  await h.session.createSocket('map', '127.0.0.1', 7000);
  return h;
}

afterEach(() => {
  harness?.session.destroy();
  harness?.cleanup();
  harness = undefined;
});

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
  it.each([
    ['Factory (IndGeneral)', MOCK_FACTORY, 'indGeneral', 'bd-rdo-0101'],
    ['Store (SrvGeneral)', MOCK_STORE, 'srvGeneral', 'bd-rdo-0201'],
    ['Bank (BankGeneral)', MOCK_BANK, 'bankGeneral', 'bd-rdo-0301'],
    ['TV Station (TVGeneral)', MOCK_TV_STATION, 'tvGeneral', 'bd-rdo-0401'],
    ['Capitol (capitolGeneral)', MOCK_CAPITOL, 'capitolGeneral', 'bd-rdo-0501'],
    ['Town Hall (townGeneral)', MOCK_TOWN_HALL, 'townGeneral', 'bd-rdo-0601'],
    ['Residential (ResGeneral)', MOCK_RESIDENTIAL, 'resGeneral', 'bd-rdo-0701'],
    ['Warehouse (WHGeneral)', MOCK_WAREHOUSE, 'whGeneral', 'bd-rdo-0801'],
    ['Mausoleum', MOCK_MAUSOLEUM, 'mausoleum', 'bd-rdo-0901'],
  ])('answers the GetPropertyList production sends for %s', async (_label, building, groupId, exchangeId) => {
    const h = await detailsHarness();
    const names = groupNames(building, groupId);

    const values = await h.session.cacherGetPropertyList('99999', names);

    expect(values).toHaveLength(names.length);
    expect([...h.getRdoMock(0)!.getConsumedIds()]).toEqual([exchangeId]);
    h.assertNoViolations();
  });

  it('emits the property names tab-joined, with a trailing tab, as one "%" argument', async () => {
    const h = await detailsHarness();

    await h.session.cacherGetPropertyList('99999', groupNames(MOCK_MAUSOLEUM, 'mausoleum'));

    expect(h.getCapturedCommands(0)).toEqual([
      'C 1000 sel 99999 call GetPropertyList "^" "%WordsOfWisdom\tOwnerName\tTranscended\t"',
    ]);
    h.assertNoViolations();
  });
});

describe('Multi-Group Building Matching', () => {
  async function consumedFor(building: MockBuilding): Promise<string[]> {
    const h = await detailsHarness();
    for (const groupId of Object.keys(building.groups)) {
      await h.session.cacherGetPropertyList('99999', groupNames(building, groupId));
    }
    h.assertNoViolations();
    return [...h.getRdoMock(0)!.getConsumedIds()].sort();
  }

  it('differentiates Factory groups by argsPattern', async () => {
    expect(await consumedFor(MOCK_FACTORY)).toEqual(['bd-rdo-0101', 'bd-rdo-0102', 'bd-rdo-0103', 'bd-rdo-0104']);
  });

  it('differentiates Bank groups (bankGeneral vs bankLoans)', async () => {
    expect(await consumedFor(MOCK_BANK)).toEqual(['bd-rdo-0301', 'bd-rdo-0302']);
  });

  it('differentiates TV Station groups (tvGeneral vs antennas vs films vs workforce)', async () => {
    // The TV workforce group asks for the same names as the Factory's, so the
    // first exchange declaring that list (the Factory's, bd-rdo-0102) answers it.
    expect(await consumedFor(MOCK_TV_STATION)).toEqual(['bd-rdo-0102', 'bd-rdo-0401', 'bd-rdo-0402', 'bd-rdo-0403']);
  });

  it('differentiates Capitol groups', async () => {
    expect(await consumedFor(MOCK_CAPITOL)).toEqual(['bd-rdo-0501', 'bd-rdo-0502', 'bd-rdo-0503', 'bd-rdo-0504']);
  });
});

describe('Response Parsing', () => {
  it('returns the Factory indGeneral values in property order', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_FACTORY, 'indGeneral'));

    expect(values[0]).toBe('Chemical Plant 3');
    expect(values[1]).toBe('Yellow Inc.');
    h.assertNoViolations();
  });

  it('returns the Store service count', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_STORE, 'srvGeneral'));

    // ServiceCount is the seventh name of the srvGeneral group.
    expect(values[6]).toBe('2');
    h.assertNoViolations();
  });

  it('returns the Bank loan data', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_BANK, 'bankLoans'));

    expect(values[0]).toBe('3');
    expect(values[1]).toBe('Yellow Inc.');
    h.assertNoViolations();
  });

  it('returns the Mausoleum WordsOfWisdom', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_MAUSOLEUM, 'mausoleum'));

    expect(values[0]).toBe('Build wisely, prosper greatly.');
    h.assertNoViolations();
  });
});

describe('argsPattern Matching Accuracy', () => {
  it('does NOT match when the property names are completely different', () => {
    // Driven on RdoMock directly: production would wait out its timeout on a
    // frame no exchange answers. Every GetPropertyList exchange pins its full
    // argsPattern and none carries a `looseMatch` reason.
    const rdoMock = new RdoMock();
    rdoMock.addScenario(createBuildingDetailsScenario().rdo);

    expect(rdoMock.match('C 200 sel 99999 call GetPropertyList "^" "%NonExistent\tFakeProperty\t"')).toBeNull();
  });

  it('answers the Factory workforce group from its own exchange', async () => {
    const h = await detailsHarness();

    await h.session.cacherGetPropertyList('99999', groupNames(MOCK_FACTORY, 'workforce'));

    expect([...h.getRdoMock(0)!.getConsumedIds()]).toEqual(['bd-rdo-0102']);
    h.assertNoViolations();
  });

  it('returns the Residential values', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_RESIDENTIAL, 'resGeneral'));

    expect(values).toContain('Luxury Apartments');
    h.assertNoViolations();
  });

  it('returns the Warehouse TradeLevel', async () => {
    const h = await detailsHarness();

    const values = await h.session.cacherGetPropertyList('99999', groupNames(MOCK_WAREHOUSE, 'whGeneral'));

    // TradeLevel is the eighth name of the whGeneral group.
    expect(values[7]).toBe('3');
    h.assertNoViolations();
  });

  it('answers the same exchange whatever the target object id', async () => {
    const h = await detailsHarness();
    const names = groupNames(MOCK_FACTORY, 'indGeneral');

    await h.session.cacherGetPropertyList('12345', names);
    await h.session.cacherGetPropertyList('99999', names);

    expect(h.getCapturedCommands(0)).toEqual([
      'C 1000 sel 12345 call GetPropertyList "^" "%Name\tCreator\tCost\tROI\tYears\tTrouble\tRole\tTradeRole\tTradeLevel\t"',
      'C 1001 sel 99999 call GetPropertyList "^" "%Name\tCreator\tCost\tROI\tYears\tTrouble\tRole\tTradeRole\tTradeLevel\t"',
    ]);
    expect([...h.getRdoMock(0)!.getConsumedIds()]).toEqual(['bd-rdo-0101']);
    h.assertNoViolations();
  });
});


// ===========================================================================
// The bank borrow box — RDOAskLoan on the bank's CurrBlock
// ===========================================================================

/** The cacher reads requestBankLoan makes to find the bank's block (inline, literal requests). */
const bankBlockLookup: RdoScenario = {
  name: 'bank-block-lookup',
  description: 'CreateObject / SetObject / GetPropertyList(CurrBlock) on the cacher',
  variables: {},
  exchanges: [
    {
      id: 'bb-rdo-create',
      request: 'C sel 40133496 call CreateObject "^" "%Shamba"',
      response: 'A1 res="%7"',
      matchKeys: { verb: 'sel', action: 'call', member: 'CreateObject', argsPattern: ['"%Shamba"'] },
    },
    {
      id: 'bb-rdo-set',
      request: 'C sel 7 call SetObject "^" "#118","#226"',
      response: 'A1 res="#-1"',
      matchKeys: { verb: 'sel', action: 'call', member: 'SetObject', argsPattern: ['"#118"', '"#226"'] },
    },
    {
      id: 'bb-rdo-currblock',
      request: 'C sel 7 call GetPropertyList "^" "%CurrBlock\t"',
      response: 'A1 res="%130200101\t"',
      matchKeys: { verb: 'sel', action: 'call', member: 'GetPropertyList', argsPattern: ['"%CurrBlock\t"'] },
    },
  ],
};

describe('Bank borrow box (requestBankLoan)', () => {
  it('reads the bank block from the cache, then asks it for the loan with the proxy id', async () => {
    const h = createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [bankBlockLookup] },
        { rdoScenarios: [createBankLoanRequestScenario().rdo] },
      ],
    });
    harness = h;
    await h.session.createSocket('map', '127.0.0.1', 7000);
    await h.session.createSocket('construction', '127.0.0.1', 7001);
    h.session.setCacherId('40133496');
    h.session.setCurrentWorldInfo({ name: 'Shamba', url: 'http://158.69.153.134/Five/', ip: '158.69.153.134', port: 8000 });
    h.session.setFTycoonProxyId(30440112);

    const answer = await h.session.requestBankLoan(118, 226, '$5,000,000');

    expect(h.getCapturedCommands(0)).toEqual([
      'C 1000 sel 40133496 call CreateObject "^" "%Shamba"',
      'C 1001 sel 7 call SetObject "^" "#118","#226"',
      'C 1002 sel 7 call GetPropertyList "^" "%CurrBlock\t"',
      'C sel 40133496 call CloseObject "*" "#7"',
    ]);
    expect(h.getCapturedCommands(1)).toEqual([
      'C 1003 sel 130200101 call RDOAskLoan "^" "#30440112","%5000000"',
    ]);
    expect(answer).toEqual({ result: 0 });
    h.assertNoViolations();
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
