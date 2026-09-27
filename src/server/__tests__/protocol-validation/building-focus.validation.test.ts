/**
 * Protocol Validation: Building Focus / SwitchFocusEx
 *
 * Drives production `focusBuilding` on a real StarpeaceSession through the
 * protocol harness, loaded with the switch-focus scenario, strict validation
 * on. The emitted SwitchFocusEx frames are pinned as literals, and the
 * BuildingFocusInfo production returns is asserted field by field.
 *
 * SwitchFocusEx carries the previously focused object id as its first
 * argument: `#0` on the first focus, then the id the last answer named — the
 * chaining the second test pins.
 *
 * The `Multi-line salesInfo parsing` block calls production
 * `parseBuildingFocusResponse` directly on the fixture payloads.
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
import {
  createSwitchFocusScenario,
  CAPTURED_FARM,
  CAPTURED_DRUG_STORE,
  CAPTURED_MARKET,
  buildFocusResponse,
} from '../../../mock-server/scenarios/switch-focus-scenario';
import { parseBuildingFocusResponse } from '../../../server/map-parsers';
import { DEFAULT_VARIABLES } from '../../../mock-server/scenarios/scenario-variables';

describe('Protocol Validation: focusBuilding() / SwitchFocusEx', () => {
  describe('focusBuilding (production) through the harness', () => {
    let harness: ProtocolTestHarness;

    beforeEach(async () => {
      harness = createProtocolTestHarness({
        socketConfigs: [{ rdoScenarios: [createSwitchFocusScenario().rdo] }],
      });
      await harness.session.createSocket('world', '127.0.0.1', 8000);
      harness.session.setWorldContextId(DEFAULT_VARIABLES.clientViewId);
    });

    afterEach(() => {
      harness.session.destroy();
      harness.cleanup();
    });

    it('focuses the farm with previous id #0 and returns its parsed details', async () => {
      const first = await harness.session.focusBuilding(472, 392);

      expect(harness.getCapturedCommands(0)).toEqual([
        'C 1000 sel 8161308 call SwitchFocusEx "^" "#0","#472","#392"',
      ]);
      expect(first.buildingId).toBe('127706280');
      expect(first.buildingName).toBe('Farm 10');
      expect(first.ownerName).toBe('Yellow Inc.');
      expect(first.x).toBe(472);
      expect(first.y).toBe(392);
      harness.assertNoViolations();
    });

    it('chains the farm id into the next SwitchFocusEx and returns the drug store', async () => {
      await harness.session.focusBuilding(472, 392);
      const second = await harness.session.focusBuilding(477, 392);

      expect(harness.getCapturedCommands(0)).toEqual([
        'C 1000 sel 8161308 call SwitchFocusEx "^" "#0","#472","#392"',
        'C 1001 sel 8161308 call SwitchFocusEx "^" "#127706280","#477","#392"',
      ]);
      expect(second.buildingId).toBe('127839460');
      expect(second.ownerName).toBe('Yellow Inc.');
      harness.assertNoViolations();
    });
  });

  describe('Multi-line salesInfo parsing', () => {
    it('should capture all sales lines from market building with multi-line salesInfo', () => {
      const responsePayload = buildFocusResponse(CAPTURED_MARKET);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 500, 400);

      expect(buildingInfo.buildingId).toBe(CAPTURED_MARKET.objectId);
      expect(buildingInfo.buildingName).toBe(CAPTURED_MARKET.name);
      expect(buildingInfo.ownerName).toBe(CAPTURED_MARKET.ownerCompany);
      expect(buildingInfo.salesInfo).toBe(
        'Fresh Food sales at 0%\nProcessed Food sales at 100%\nClothing and Footwear sales at 70%\nHousehold Appliances sales at 29%',
      );
    });

    it('should extract revenue correctly from market building (not a sales line)', () => {
      const responsePayload = buildFocusResponse(CAPTURED_MARKET);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 500, 400);

      expect(buildingInfo.revenue).toBe('$1,398/h');
    });

    it('should still parse single-line salesInfo from farm building', () => {
      const responsePayload = buildFocusResponse(CAPTURED_FARM);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 472, 392);

      expect(buildingInfo.salesInfo).toBe(CAPTURED_FARM.statusLine);
      expect(buildingInfo.revenue).toBe('-$29/h');
    });

    it('should still parse single-line salesInfo from drug store building', () => {
      const responsePayload = buildFocusResponse(CAPTURED_DRUG_STORE);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 477, 392);

      expect(buildingInfo.salesInfo).toBe(CAPTURED_DRUG_STORE.statusLine);
      expect(buildingInfo.revenue).toBe('-$36/h');
    });

    it('should extract detailsText from market building', () => {
      const responsePayload = buildFocusResponse(CAPTURED_MARKET);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 500, 400);

      expect(buildingInfo.detailsText).toBe(CAPTURED_MARKET.detailSections[0]);
    });

    it('should extract hintsText from market building', () => {
      const responsePayload = buildFocusResponse(CAPTURED_MARKET);
      const buildingInfo = parseBuildingFocusResponse(responsePayload, 500, 400);

      expect(buildingInfo.hintsText).toBe(CAPTURED_MARKET.detailSections[1]);
    });
  });
});
