/**
 * Protocol Validation: buildRoad() + placeBuilding()
 *
 * Drives production `buildRoad` (road-handler.ts) and `placeBuilding`
 * (building-templates-handler.ts) on a real StarpeaceSession through the
 * protocol harness, strict validation on, and pins every emitted frame as a
 * literal. Both operations target the world context id (NOT the
 * interfaceServerId), which the literals show.
 *
 * buildRoad() flow:
 *   sel <worldContextId> call CreateCircuitSeg "^" "#1","#<ownerId>","#x1","#y1","#x2","#y2","#cost"
 *   -> res="#0" (success)
 *
 * placeBuilding() flow:
 *   sel <worldContextId> call NewFacility "^" "%<facilityClass>","#<companyId>","#<x>","#<y>"
 *   -> res="#0" (success) or res="#33" (refused)
 *
 * How the gateway maps CreateCircuitSeg answers — error codes, partial builds,
 * stopping at the first refused segment — is covered on the real handler in
 * `src/server/session/road-handler.test.ts` (describe `buildRoad — server answers`).
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
import { createBuildRoadsScenario } from '../../../mock-server/scenarios/build-roads-scenario';
import { createBuildMenuScenario } from '../../../mock-server/scenarios/build-menu-scenario';

function refusedFacilityScenario(): RdoScenario {
  return {
    name: 'build-refused',
    description: 'NewFacility refused with ERROR_TooManyFacilities (33)',
    exchanges: [
      {
        id: 'build-refused-001',
        request: 'C sel 8161308 call NewFacility "^" "%PGIGeneralHeadquarterSTA","#28","#465","#388"',
        response: 'A1 res="#33"',
        matchKeys: {
          verb: 'sel', action: 'call', member: 'NewFacility',
          argsPattern: ['"%PGIGeneralHeadquarterSTA"', '"#28"', '"#465"', '"#388"'],
        },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: buildRoad() + placeBuilding()', () => {
  let harness: ProtocolTestHarness | undefined;

  async function setup(scenario: RdoScenario): Promise<ProtocolTestHarness> {
    const h = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [scenario] }],
    });
    harness = h;
    await h.session.createSocket('world', '127.0.0.1', 8000);
    h.session.setWorldContextId('8161308');
    return h;
  }

  afterEach(() => {
    harness?.session.destroy();
    harness?.cleanup();
    harness = undefined;
  });

  describe('CreateCircuitSeg (buildRoad)', () => {
    it('emits one segment for a straight path, owned by the proxy id, and reports the cost', async () => {
      const h = await setup(createBuildRoadsScenario().rdo);
      h.session.setFTycoonProxyId(248041616);

      const result = await h.session.buildRoad(462, 403, 464, 403);

      expect(h.getCapturedCommands(0)).toEqual([
        'C 1000 sel 8161308 call CreateCircuitSeg "^" "#1","#248041616","#462","#403","#464","#403","#6000000"',
      ]);
      expect(result).toEqual({
        success: true,
        partial: false,
        cost: 6000000,
        tileCount: 2,
        message: 'Road built successfully: 2 tiles',
      });
      h.assertNoViolations();
    });
  });

  describe('NewFacility (placeBuilding)', () => {
    it('emits NewFacility with the current company id and reports success', async () => {
      const h = await setup(createBuildMenuScenario().rdo);
      h.session.setCurrentCompany({ id: '28', name: 'Yellow Inc.', ownerRole: 'SPO_test3' });

      const result = await h.session.placeBuilding('PGISupermarketC', 618, 117);

      expect(h.getCapturedCommands(0)).toEqual([
        'C 1000 sel 8161308 call NewFacility "^" "%PGISupermarketC","#28","#618","#117"',
      ]);
      expect(result).toEqual({ success: true, buildingId: null });
      h.assertNoViolations();
    });

    it('reports the refusal code (33) the server answers', async () => {
      // Inline: the build-menu fixture's refusal exchange (bm-rdo-002) declares a
      // one-position argsPattern, so RdoMock never lets it answer a four-argument
      // NewFacility frame — its success exchange would answer instead.
      const h = await setup(refusedFacilityScenario());
      h.session.setCurrentCompany({ id: '28', name: 'Yellow Inc.', ownerRole: 'SPO_test3' });

      const result = await h.session.placeBuilding('PGIGeneralHeadquarterSTA', 465, 388);

      expect(h.getCapturedCommands(0)).toEqual([
        'C 1000 sel 8161308 call NewFacility "^" "%PGIGeneralHeadquarterSTA","#28","#465","#388"',
      ]);
      expect(result).toEqual({ success: false, buildingId: null, errorCode: 33 });
      h.assertNoViolations();
    });
  });
});
