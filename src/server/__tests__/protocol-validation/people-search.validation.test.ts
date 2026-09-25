/**
 * Protocol Validation: People Search (searchPeople)
 *
 * Validates that searchPeople() sweeps Root/Users/<Letter>, never sends an
 * empty ValueNameList, and reads names from Alias<i> — issue #455. Scenario is
 * deliberately inline (single-purpose): the shared scenario-registry.ts and its
 * "all 10 scenarios" accounting are untouched by this change.
 *
 * Flow under test:
 *   idof DirectoryServer -> get RDOOpenSession -> per bucket:
 *     RDOSetCurrentKey "Root/Users/<Letter>" -> [if true] RDOSearchKey -> RDOEndSession
 */

// Must mock before any imports that use them
jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/// <reference path="../../__tests__/matchers/rdo-matchers.d.ts" />
import { describe, it, expect, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import { mergeVariables } from '../../../mock-server/scenarios/scenario-variables';

const vars = mergeVariables();

/** idof + RDOOpenSession, shared by every scenario below. */
function directoryOpenExchanges(): RdoScenario['exchanges'] {
  return [
    {
      id: 'people-search-idof',
      request: `C 0 idof "DirectoryServer"`,
      response: `A0 objid="${vars.directoryServerId}"`,
      matchKeys: { verb: 'idof', targetId: 'DirectoryServer' },
    },
    {
      id: 'people-search-open',
      request: `C 1 sel ${vars.directoryServerId} get RDOOpenSession`,
      response: `A1 RDOOpenSession="#${vars.directorySessionId}"`,
      matchKeys: { verb: 'sel', action: 'get', member: 'RDOOpenSession' },
    },
  ];
}

describe('Protocol Validation: searchPeople()', () => {
  let harness: ProtocolTestHarness;

  afterEach(() => {
    harness.cleanup();
  });

  it('returns a known alias found in its bucket, and covers all 26 buckets with RDOSetCurrentKey', async () => {
    // RDOSetCurrentKey carries no state the mock can see across calls, so the
    // answer per bucket has to come from the frame's own argument. RdoMock
    // answers an exchange only when every key it declares matches the frame
    // (a member-only exchange answers nothing without a `looseMatch` reason),
    // so one exchange per letter, matched on its own full argument list via
    // `keyFieldMatch`, is what keeps only bucket C true.
    const setKeyExchanges: RdoScenario['exchanges'] = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map(letter => ({
      id: `people-search-setkey-${letter}`,
      request: `C 2 sel ${vars.directorySessionId} call RDOSetCurrentKey "^" "%Root/Users/${letter}"`,
      response: `A2 res="${letter === 'C' ? '#-1' : '#0'}"`,
      matchKeys: { member: 'RDOSetCurrentKey', argsPattern: [`"%Root/Users/${letter}"`] },
    }));

    const scenario: RdoScenario = {
      name: 'people-search-known-alias',
      description: 'A multi-character search finds an alias in the Root/Users/C bucket',
      exchanges: [
        ...directoryOpenExchanges(),
        ...setKeyExchanges,
        {
          id: 'people-search-searchkey-c',
          request: `C 3 sel ${vars.directorySessionId} call RDOSearchKey "^" "%*Crazz*","%Alias\r\n"`,
          response: `A3 res="%Count=1\r\nKey0=crazz\r\nAlias0=Crazz\r\n"`,
          // RDOSearchKey(SearchPattern, ValueNameList) as login-handler.ts:366-370 emits it.
          matchKeys: { verb: 'sel', action: 'call', member: 'RDOSearchKey', argsPattern: ['"%*Crazz*"', '*'] },
        },
      ],
      variables: vars as unknown as Record<string, string>,
    };

    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [scenario] }],
    });

    const names = await harness.session.searchPeople('Crazz');
    expect(names).toEqual(['Crazz']);

    const commands = harness.getCapturedCommands(0);
    const setKeys = commands.filter(c => c.includes('RDOSetCurrentKey'));
    expect(setKeys).toHaveLength(26);
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(setKeys.some(c => c.includes(`"%Root/Users/${letter}"`))).toBe(true);
    }

    harness.assertNoViolations();
  });

  it('never emits RDOSearchKey with an empty ValueNameList, across a full 26-bucket sweep', async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [
        {
          rdoScenarios: [{ name: 'people-search-sweep', description: 'idof + open only', exchanges: directoryOpenExchanges(), variables: vars as unknown as Record<string, string> }],
          fallbackResponses: [
            { member: 'RDOSetCurrentKey', payload: 'res="#-1"' },
            { member: 'RDOSearchKey', payload: 'res="%"' },
          ],
        },
      ],
    });

    const names = await harness.session.searchPeople('nobody');
    expect(names).toEqual([]);

    const commands = harness.getAllCapturedCommands();
    const searches = commands.filter(c => c.includes('RDOSearchKey'));
    expect(searches).toHaveLength(26);
    for (const cmd of searches) {
      expect(cmd).toContain('"%Alias\r\n"');
      expect(cmd).not.toMatch(/RDOSearchKey "\^" "%\*nobody\*","%"/);
    }

    harness.assertNoViolations();
  });

  it('narrows a single-letter search to one bucket, pattern "*"', async () => {
    const scenario: RdoScenario = {
      name: 'people-search-single-letter',
      description: 'A single-letter search stays inside its own bucket',
      exchanges: [
        ...directoryOpenExchanges(),
        {
          id: 'people-search-setkey-single',
          request: `C 2 sel ${vars.directorySessionId} call RDOSetCurrentKey "^" "%Root/Users/C"`,
          response: `A2 res="#-1"`,
          matchKeys: { member: 'RDOSetCurrentKey', argsPattern: ['"%Root/Users/C"'] },
        },
        {
          id: 'people-search-searchkey-single',
          request: `C 3 sel ${vars.directorySessionId} call RDOSearchKey "^" "%*","%Alias\r\n"`,
          response: `A3 res="%Count=1\r\nKey0=crazz\r\nAlias0=Crazz\r\n"`,
          // Full two-arg list (pattern, ValueNameList) as login-handler.ts:366-370 emits it.
          matchKeys: { member: 'RDOSearchKey', argsPattern: ['"%*"', '*'] },
        },
      ],
      variables: vars as unknown as Record<string, string>,
    };

    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [scenario] }],
    });

    const names = await harness.session.searchPeople('c');
    expect(names).toEqual(['Crazz']);

    const commands = harness.getCapturedCommands(0);
    expect(commands.filter(c => c.includes('RDOSetCurrentKey'))).toHaveLength(1);
    expect(commands.filter(c => c.includes('RDOSearchKey'))).toHaveLength(1);

    harness.assertNoViolations();
  });
});
