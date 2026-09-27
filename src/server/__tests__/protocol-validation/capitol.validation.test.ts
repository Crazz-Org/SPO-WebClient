/**
 * Protocol Validation: placeCapitol()
 *
 * Drives production `placeCapitol` and `placeBuilding`
 * (building-templates-handler.ts) on a real StarpeaceSession through the
 * protocol harness, strict validation on, and pins the emitted frames as
 * literals.
 *
 * The Capitol is a NewFacility call with the class hardcoded to "Capitol" and
 * the company id hardcoded to 1:
 *   sel <worldContextId> call NewFacility "^" "%Capitol","#1","#x","#y"
 *   -> res="#0" (success; NewFacility never returns the new object's id)
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
import { createBuildMenuScenario } from '../../../mock-server/scenarios/build-menu-scenario';
import { DEFAULT_VARIABLES } from '../../../mock-server/scenarios/scenario-variables';

describe('Protocol Validation: placeCapitol()', () => {
  let harness: ProtocolTestHarness;

  beforeEach(async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [createBuildMenuScenario().rdo] }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    harness.session.setWorldContextId(DEFAULT_VARIABLES.clientViewId);
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('emits NewFacility with class Capitol and company #1, and reports success', async () => {
    const result = await harness.session.placeCapitol(797, 822);

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call NewFacility "^" "%Capitol","#1","#797","#822"',
    ]);
    expect(result).toEqual({ success: true, buildingId: null });
    harness.assertNoViolations();
  });

  it('differs from a regular placeBuilding only in class and company id', async () => {
    harness.session.setCurrentCompany({ id: '28', name: 'Yellow Inc.', ownerRole: 'SPO_test3' });

    await harness.session.placeBuilding('PGIFoodStore', 100, 200);
    await harness.session.placeCapitol(100, 200);

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call NewFacility "^" "%PGIFoodStore","#28","#100","#200"',
      'C 1001 sel 8161308 call NewFacility "^" "%Capitol","#1","#100","#200"',
    ]);
    harness.assertNoViolations();
  });
});
