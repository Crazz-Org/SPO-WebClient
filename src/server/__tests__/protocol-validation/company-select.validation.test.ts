/**
 * Protocol Validation: Select Company
 *
 * Drives production `selectCompany` (login-handler.ts) on a real
 * StarpeaceSession through the protocol harness, loaded with the
 * select-company scenario, strict validation on. The session is brought to the
 * state `loginWorld` would leave it in through its public setters (world
 * context, tycoon id, available companies), then every frame it emits is
 * pinned as a literal.
 *
 * Flow under test:
 *   1. sel <worldContextId> set EnableEvents="#-1"
 *   2. sel <worldContextId> call PickEvent "^" "#22"
 *   3. sel <worldContextId> call GetTycoonCookie "^" "#22","%LastY.0"  -> res="%395"
 *   4. sel <worldContextId> call GetTycoonCookie "^" "#22","%LastX.0"  -> res="%467"
 *   5. sel <worldContextId> call GetTycoonCookie "^" "#22","%"         -> full cookie
 *   6. sel <worldContextId> call ClientAware "*"                       (void, no QueryId)
 *   7. sel <worldContextId> call PickEvent "^" "#22"
 *   8. sel <worldContextId> call ClientAware "*"                       (void, no QueryId)
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import { createSelectCompanyScenario } from '../../../mock-server/scenarios/select-company-scenario';
import { DEFAULT_VARIABLES } from '../../../mock-server/scenarios/scenario-variables';
import { SessionPhase } from '../../../shared/types';

const EXPECTED_FRAMES = [
  'C 1000 sel 8161308 set EnableEvents="#-1"',
  'C 1001 sel 8161308 call PickEvent "^" "#22"',
  'C 1002 sel 8161308 call GetTycoonCookie "^" "#22","%LastY.0"',
  'C 1003 sel 8161308 call GetTycoonCookie "^" "#22","%LastX.0"',
  'C 1004 sel 8161308 call GetTycoonCookie "^" "#22","%"',
  'C sel 8161308 call ClientAware "*"',
  'C 1005 sel 8161308 call PickEvent "^" "#22"',
  'C sel 8161308 call ClientAware "*"',
];

describe('Protocol Validation: selectCompany()', () => {
  let harness: ProtocolTestHarness;

  beforeEach(async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [createSelectCompanyScenario().rdo] }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    harness.session.setWorldContextId(DEFAULT_VARIABLES.clientViewId);
    harness.session.setTycoonId('22');
    harness.session.setAvailableCompanies([{ id: '28', name: 'Yellow Inc.', ownerRole: 'SPO_test3' }]);
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('emits the eight-frame selection sequence and reads the position from the cookies', async () => {
    await harness.session.selectCompany('28');

    expect(harness.getCapturedCommands(0)).toEqual(EXPECTED_FRAMES);
    expect(harness.session.getPlayerPosition()).toEqual({ x: 467, y: 395 });
    expect(harness.session.getPhase()).toBe(SessionPhase.WORLD_CONNECTED);
    expect(harness.session.currentCompany?.id).toBe('28');
    harness.assertNoViolations();
  });

  it('sends the same sequence for the visitor visa (company 0)', async () => {
    await harness.session.selectCompany('0');

    expect(harness.getCapturedCommands(0)).toEqual(EXPECTED_FRAMES);
    expect(harness.session.getPhase()).toBe(SessionPhase.WORLD_CONNECTED);
    harness.assertNoViolations();
  });
});
