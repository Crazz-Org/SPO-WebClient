/**
 * Protocol Validation: Company Creation (createCompany)
 *
 * Drives production `createCompany` (login-handler.ts) on a real
 * StarpeaceSession through the protocol harness, strict validation on, and
 * pins the frame it emits as a literal.
 *
 * The gateway calls InterfaceServer.NewCompany(name, cluster) — 2 params; the
 * IS fills in the username from the session and calls
 * World.RDONewCompany(username, name, cluster) itself.
 *
 * The answer is a widestring (the IS casts it):
 *   Success: res="%[CompanyName,CompanyId]"
 *   Error:   res="%<errorCode>"  (a string, not an integer)
 * An integer-typed `res="#<code>"` is handled as a fallback.
 *
 * The scenario is inline (single-purpose): its request is the literal frame
 * production emits, QueryId stripped.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';

function newCompanyScenario(answer: string): RdoScenario {
  return {
    name: 'create-company',
    description: 'NewCompany(name, cluster) on the world context',
    exchanges: [
      {
        id: 'cc-rdo-001',
        request: 'C sel 8161308 call NewCompany "^" "%My Company","%PGI"',
        response: `A1 ${answer}`,
        matchKeys: { verb: 'sel', action: 'call', member: 'NewCompany', argsPattern: ['"%My Company"', '"%PGI"'] },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: createCompany()', () => {
  let harness: ProtocolTestHarness;

  async function setup(answer: string): Promise<void> {
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [newCompanyScenario(answer)] }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    harness.session.setWorldContextId('8161308');
    harness.session.setCachedUsername('SPO_test3');
  }

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('parses a [Name,Id] answer and adds the company to the available list', async () => {
    await setup('res="%[My Company,4242]"');

    const result = await harness.session.createCompany('My Company', 'PGI');

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call NewCompany "^" "%My Company","%PGI"',
    ]);
    expect(result).toEqual({ success: true, companyName: 'My Company', companyId: '4242' });
    expect(harness.session.getAvailableCompanies().map(c => c.id)).toContain('4242');
    harness.assertNoViolations();
  });

  it('maps a string error code to its message', async () => {
    await setup('res="%11"');

    const result = await harness.session.createCompany('My Company', 'PGI');

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call NewCompany "^" "%My Company","%PGI"',
    ]);
    expect(result).toEqual({
      success: false, companyName: '', companyId: '', message: 'Company name already taken',
    });
    harness.assertNoViolations();
  });

  it('falls back to a generic message on an integer-typed error code', async () => {
    await setup('res="#11"');

    const result = await harness.session.createCompany('My Company', 'PGI');

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call NewCompany "^" "%My Company","%PGI"',
    ]);
    expect(result).toEqual({
      success: false, companyName: '', companyId: '', message: 'Failed with error code 11',
    });
    harness.assertNoViolations();
  });
});
