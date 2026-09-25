/**
 * Protocol Validation: buildRoad() + placeBuilding()
 *
 * Validates that buildRoad() produces correct CreateCircuitSeg commands and
 * placeBuilding() produces correct NewFacility commands matching captured
 * protocol exchanges. Both operations target worldContextId (NOT interfaceServerId).
 *
 * Approach: Build commands with RdoProtocol.format() (same as spo_session),
 * feed through RdoMock.match() loaded with the appropriate scenario, and verify
 * both matching success and response content.
 *
 * buildRoad() flow:
 *   sel <worldContextId> call CreateCircuitSeg "^" "#1","#<ownerId>","#x1","#y1","#x2","#y2","#cost"
 *   -> res="#0" (success) or res="#33" (duplicate)
 *
 * placeBuilding() flow:
 *   sel <worldContextId> call NewFacility "^" "%<facilityClass>","#28","#<x>","#<y>"
 *   -> res="#0" (success) or res="#33" (duplicate)
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/// <reference path="../../__tests__/matchers/rdo-matchers.d.ts" />
import { describe, it, expect, beforeEach } from '@jest/globals';
import { RdoMock } from '../../../mock-server/rdo-mock';
import { RdoStrictValidator } from '../../../mock-server/rdo-strict-validator';
import { RdoProtocol } from '../../../server/rdo';
import { RdoVerb, RdoAction } from '../../../shared/types/protocol-types';
import { RdoParser, RdoTypePrefix } from '../../../shared/rdo-types';
import {
  createBuildRoadsScenario,
  CAPTURED_ROAD_BUILD,
} from '../../../mock-server/scenarios/build-roads-scenario';
import {
  createBuildMenuScenario,
  CAPTURED_BUILD_SUCCESS,
  CAPTURED_BUILD_DUPLICATE,
} from '../../../mock-server/scenarios/build-menu-scenario';
import { DEFAULT_VARIABLES } from '../../../mock-server/scenarios/scenario-variables';

describe('Protocol Validation: buildRoad() + placeBuilding()', () => {
  const worldContextId = DEFAULT_VARIABLES.clientViewId; // '8161308'

  describe('CreateCircuitSeg command format', () => {
    let rdoMock: RdoMock;
    let validator: RdoStrictValidator;
    const roadScenario = createBuildRoadsScenario();

    beforeEach(() => {
      rdoMock = new RdoMock();
      validator = new RdoStrictValidator();
      rdoMock.addScenario(roadScenario.rdo);
      validator.addScenario(roadScenario.rdo);
    });

    afterEach(() => {
      const errors = validator.getErrors();
      if (errors.length > 0) {
        throw new Error(validator.formatReport());
      }
    });

    /**
     * Build a CreateCircuitSeg command string the same way spo_session.buildRoad() does.
     * See spo_session.ts lines 1816-1920.
     */
    function buildRoadCommand(
      circuitId: number,
      ownerId: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      cost: number,
      rid: number = 505,
    ): string {
      return RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid,
        verb: RdoVerb.SEL,
        targetId: worldContextId,
        action: RdoAction.CALL,
        member: 'CreateCircuitSeg',
        separator: '"^"',
        args: [
          `#${circuitId}`,
          `#${ownerId}`,
          `#${x1}`,
          `#${y1}`,
          `#${x2}`,
          `#${y2}`,
          `#${cost}`,
        ],
      });
    }

    it('should match CreateCircuitSeg scenario when formatted correctly', () => {
      const command = buildRoadCommand(
        CAPTURED_ROAD_BUILD.circuitType,
        CAPTURED_ROAD_BUILD.ownerId,
        CAPTURED_ROAD_BUILD.x1,
        CAPTURED_ROAD_BUILD.y1,
        CAPTURED_ROAD_BUILD.x2,
        CAPTURED_ROAD_BUILD.y2,
        CAPTURED_ROAD_BUILD.cost,
      );

      const result = rdoMock.match(command);
      validator.validate(RdoProtocol.parse(command), command);

      expect(result).not.toBeNull();
      expect(result!.exchange.id).toBe('br-rdo-001');
    });

    it('should use "^" method separator', () => {
      const command = buildRoadCommand(
        CAPTURED_ROAD_BUILD.circuitType,
        CAPTURED_ROAD_BUILD.ownerId,
        CAPTURED_ROAD_BUILD.x1,
        CAPTURED_ROAD_BUILD.y1,
        CAPTURED_ROAD_BUILD.x2,
        CAPTURED_ROAD_BUILD.y2,
        CAPTURED_ROAD_BUILD.cost,
      );

      // The formatted command must contain the "^" method separator
      expect(command).toContain('"^"');
      // Must NOT contain push separator "*"
      expect(command).not.toContain('"*"');
    });

    it('should pass all 7 arguments as #int type', () => {
      const command = buildRoadCommand(
        CAPTURED_ROAD_BUILD.circuitType,
        CAPTURED_ROAD_BUILD.ownerId,
        CAPTURED_ROAD_BUILD.x1,
        CAPTURED_ROAD_BUILD.y1,
        CAPTURED_ROAD_BUILD.x2,
        CAPTURED_ROAD_BUILD.y2,
        CAPTURED_ROAD_BUILD.cost,
      );

      // Parse the command and verify all args have INTEGER prefix
      const parsed = RdoProtocol.parse(command);
      expect(parsed.args).toBeDefined();
      expect(parsed.args!.length).toBe(7);

      for (const arg of parsed.args!) {
        const extracted = RdoParser.extract(arg);
        expect(extracted.prefix).toBe(RdoTypePrefix.INTEGER);
      }
    });

    it('should target worldContextId for road commands', () => {
      const command = buildRoadCommand(
        CAPTURED_ROAD_BUILD.circuitType,
        CAPTURED_ROAD_BUILD.ownerId,
        CAPTURED_ROAD_BUILD.x1,
        CAPTURED_ROAD_BUILD.y1,
        CAPTURED_ROAD_BUILD.x2,
        CAPTURED_ROAD_BUILD.y2,
        CAPTURED_ROAD_BUILD.cost,
      );

      // Command should target the world context (clientViewId)
      expect(command).toContain(`sel ${worldContextId}`);

      // Parse and verify
      const parsed = RdoProtocol.parse(command);
      expect(parsed.verb).toBe(RdoVerb.SEL);
      expect(parsed.targetId).toBe(worldContextId);
    });

    it('should return result code #0 for successful build', () => {
      const command = buildRoadCommand(
        CAPTURED_ROAD_BUILD.circuitType,
        CAPTURED_ROAD_BUILD.ownerId,
        CAPTURED_ROAD_BUILD.x1,
        CAPTURED_ROAD_BUILD.y1,
        CAPTURED_ROAD_BUILD.x2,
        CAPTURED_ROAD_BUILD.y2,
        CAPTURED_ROAD_BUILD.cost,
      );

      const result = rdoMock.match(command);
      expect(result).not.toBeNull();

      // Response should contain res="#0" indicating success
      expect(result!.response).toContain('res="#0"');

      // Verify the result code value matches captured data
      const resMatch = result!.response.match(/res="(#[^"]*)"/);
      expect(resMatch).not.toBeNull();

      const extracted = RdoParser.extract(resMatch![1]);
      expect(extracted.prefix).toBe(RdoTypePrefix.INTEGER);
      expect(extracted.value).toBe(String(CAPTURED_ROAD_BUILD.result));
    });
  });

  describe('NewFacility command format', () => {
    let rdoMock: RdoMock;
    let validator: RdoStrictValidator;
    const buildMenuScenario = createBuildMenuScenario();

    beforeEach(() => {
      rdoMock = new RdoMock();
      validator = new RdoStrictValidator();
      rdoMock.addScenario(buildMenuScenario.rdo);
      validator.addScenario(buildMenuScenario.rdo);
    });

    afterEach(() => {
      const errors = validator.getErrors();
      if (errors.length > 0) {
        throw new Error(validator.formatReport());
      }
    });

    /**
     * Build a NewFacility command string the same way spo_session.placeBuilding() does.
     * See spo_session.ts lines 3202-3242.
     */
    function buildPlaceBuildingCommand(
      facilityClass: string,
      companyId: string,
      x: number,
      y: number,
      rid: number = 147,
    ): string {
      return RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid,
        verb: RdoVerb.SEL,
        targetId: worldContextId,
        action: RdoAction.CALL,
        member: 'NewFacility',
        separator: '"^"',
        args: [`%${facilityClass}`, `#${companyId}`, `#${x}`, `#${y}`],
      });
    }

    it('should match NewFacility scenario for successful build', () => {
      const command = buildPlaceBuildingCommand(
        CAPTURED_BUILD_SUCCESS.facilityClass,
        CAPTURED_BUILD_SUCCESS.companyId,
        CAPTURED_BUILD_SUCCESS.x,
        CAPTURED_BUILD_SUCCESS.y,
      );

      const result = rdoMock.match(command);
      validator.validate(RdoProtocol.parse(command), command);

      expect(result).not.toBeNull();
      expect(result!.exchange.id).toBe('bm-rdo-001');
    });

    it('should use "^" method separator for NewFacility', () => {
      const command = buildPlaceBuildingCommand(
        CAPTURED_BUILD_SUCCESS.facilityClass,
        CAPTURED_BUILD_SUCCESS.companyId,
        CAPTURED_BUILD_SUCCESS.x,
        CAPTURED_BUILD_SUCCESS.y,
      );

      // The formatted command must contain the "^" method separator
      expect(command).toContain('"^"');
      // Must NOT contain push separator "*"
      expect(command).not.toContain('"*"');
    });

    it('should pass facilityClass as %string and coordinates as #int', () => {
      const command = buildPlaceBuildingCommand(
        CAPTURED_BUILD_SUCCESS.facilityClass,
        CAPTURED_BUILD_SUCCESS.companyId,
        CAPTURED_BUILD_SUCCESS.x,
        CAPTURED_BUILD_SUCCESS.y,
      );

      // Parse the command and verify argument types
      const parsed = RdoProtocol.parse(command);
      expect(parsed.args).toBeDefined();
      expect(parsed.args!.length).toBe(4);

      // First arg: facilityClass should be %string (OLESTRING)
      const facilityArg = RdoParser.extract(parsed.args![0]);
      expect(facilityArg.prefix).toBe(RdoTypePrefix.OLESTRING);
      expect(facilityArg.value).toBe(CAPTURED_BUILD_SUCCESS.facilityClass);

      // Remaining args: companyId, x, y should all be #int (INTEGER)
      for (let i = 1; i < parsed.args!.length; i++) {
        const extracted = RdoParser.extract(parsed.args![i]);
        expect(extracted.prefix).toBe(RdoTypePrefix.INTEGER);
      }
    });

    it('should return result code #0 for successful placement', () => {
      const command = buildPlaceBuildingCommand(
        CAPTURED_BUILD_SUCCESS.facilityClass,
        CAPTURED_BUILD_SUCCESS.companyId,
        CAPTURED_BUILD_SUCCESS.x,
        CAPTURED_BUILD_SUCCESS.y,
      );

      const result = rdoMock.match(command);
      expect(result).not.toBeNull();

      // Response should contain res="#0" indicating success
      expect(result!.response).toContain('res="#0"');

      // Verify the result code value matches captured data
      const resMatch = result!.response.match(/res="(#[^"]*)"/);
      expect(resMatch).not.toBeNull();

      const extracted = RdoParser.extract(resMatch![1]);
      expect(extracted.prefix).toBe(RdoTypePrefix.INTEGER);
      expect(extracted.value).toBe(String(CAPTURED_BUILD_SUCCESS.result));
    });

    it('should return result code #33 (ERROR_TooManyFacilities) for a refused build', () => {
      // #33 is ERROR_TooManyFacilities (Protocol/Protocol.pas:62), NOT a
      // "duplicate building" — the fixture name predates that identification.
      const duplicateExchange = createBuildMenuScenario().rdo.exchanges.find(
        e => e.id === 'bm-rdo-002'
      );
      expect(duplicateExchange).toBeDefined();

      // The refusal response should contain res="#33"
      expect(duplicateExchange!.response).toContain('res="#33"');

      // Verify the result code value matches captured data
      const resMatch = duplicateExchange!.response.match(/res="(#[^"]*)"/);
      expect(resMatch).not.toBeNull();

      const extracted = RdoParser.extract(resMatch![1]);
      expect(extracted.prefix).toBe(RdoTypePrefix.INTEGER);
      expect(extracted.value).toBe(String(CAPTURED_BUILD_DUPLICATE.result));
    });
  });

  describe('Command targeting', () => {
    it('should target worldContextId (NOT interfaceServerId) for both road and building', () => {
      // Build a CreateCircuitSeg command
      const roadCommand = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 505,
        verb: RdoVerb.SEL,
        targetId: worldContextId,
        action: RdoAction.CALL,
        member: 'CreateCircuitSeg',
        separator: '"^"',
        args: [
          `#${CAPTURED_ROAD_BUILD.circuitType}`,
          `#${CAPTURED_ROAD_BUILD.ownerId}`,
          `#${CAPTURED_ROAD_BUILD.x1}`,
          `#${CAPTURED_ROAD_BUILD.y1}`,
          `#${CAPTURED_ROAD_BUILD.x2}`,
          `#${CAPTURED_ROAD_BUILD.y2}`,
          `#${CAPTURED_ROAD_BUILD.cost}`,
        ],
      });

      // Build a NewFacility command
      const buildingCommand = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 147,
        verb: RdoVerb.SEL,
        targetId: worldContextId,
        action: RdoAction.CALL,
        member: 'NewFacility',
        separator: '"^"',
        args: [
          `%${CAPTURED_BUILD_SUCCESS.facilityClass}`,
          `#${CAPTURED_BUILD_SUCCESS.companyId}`,
          `#${CAPTURED_BUILD_SUCCESS.x}`,
          `#${CAPTURED_BUILD_SUCCESS.y}`,
        ],
      });

      // Both commands must target worldContextId
      for (const command of [roadCommand, buildingCommand]) {
        const parsed = RdoProtocol.parse(command);
        expect(parsed.verb).toBe(RdoVerb.SEL);
        expect(parsed.targetId).toBe(worldContextId);
        expect(command).toContain(`sel ${worldContextId}`);
      }

      // Verify neither uses interfaceServerId (which would be a different ID)
      // worldContextId is used for world operations (map focus, building placement, road building)
      const parsedRoad = RdoProtocol.parse(roadCommand);
      const parsedBuilding = RdoProtocol.parse(buildingCommand);
      expect(parsedRoad.targetId).toBe(parsedBuilding.targetId);
    });
  });

  describe('NewFacility company ID requirement', () => {
    it('should include company ID as second argument (not hardcoded)', () => {
      // The Delphi server expects: NewFacility(%FacilityId, #CompanyId, #x, #y)
      // CompanyId must match the current company — a hardcoded value would fail
      // for any user whose company ID differs.
      const testCompanyId = '42';
      const command = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 200,
        verb: RdoVerb.SEL,
        targetId: DEFAULT_VARIABLES.clientViewId,
        action: RdoAction.CALL,
        member: 'NewFacility',
        separator: '"^"',
        args: [`%${CAPTURED_BUILD_SUCCESS.facilityClass}`, `#${testCompanyId}`, `#${CAPTURED_BUILD_SUCCESS.x}`, `#${CAPTURED_BUILD_SUCCESS.y}`],
      });

      expect(command).toContain(`#${testCompanyId}`);
      expect(command).not.toContain('#28');
    });

    it('should format company ID with integer prefix', () => {
      const command = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 300,
        verb: RdoVerb.SEL,
        targetId: DEFAULT_VARIABLES.clientViewId,
        action: RdoAction.CALL,
        member: 'NewFacility',
        separator: '"^"',
        args: ['%PGIFoodStore', '#55', '#100', '#200'],
      });
      const parsed = RdoProtocol.parse(command);
      expect(parsed.args).toContain('#55');
    });
  });

  describe('buildRoad response error codes', () => {
    // This regex is the same one used in spo_session.ts:buildRoad()
    const parseResultCode = (payload: string): number => {
      const match = /res="#(-?\d+)"/.exec(payload);
      return match ? parseInt(match[1], 10) : -1;
    };

    // Error message map matching the errorMessages map in buildRoad (road-handler.ts)
    const errorMessages: Record<number, string> = {
      1: 'Road construction failed — please try a different location',
      2: 'Invalid road segment — check your coordinates',
      3: 'Permission denied — you may not have sufficient funds or rights to build here',
      4: 'Insufficient funds to build this road segment',
      5: 'Your company was not recognized — please reconnect',
      21: 'Unsupported road type',
      22: 'Cannot build a road at this location — area may be occupied or restricted',
      23: 'Cannot modify an existing road segment here',
    };

    it('should parse result code 0 as success', () => {
      expect(parseResultCode('A505 res="#0"')).toBe(0);
    });

    it('should parse result code 22 (CannotCreateSeg)', () => {
      expect(parseResultCode('A1589 res="#22"')).toBe(22);
    });

    it('should parse negative result codes', () => {
      expect(parseResultCode('A100 res="#-1"')).toBe(-1);
    });

    it('should return -1 for unparseable responses', () => {
      expect(parseResultCode('A100 err="timeout"')).toBe(-1);
      expect(parseResultCode('')).toBe(-1);
    });

    it('should map error code 22 to location-restricted message', () => {
      expect(errorMessages[22]).toBe(
        'Cannot build a road at this location — area may be occupied or restricted'
      );
    });

    it('should map all Delphi circuit error codes (21-23)', () => {
      expect(errorMessages[21]).toBeDefined(); // ERROR_UnknownCircuit
      expect(errorMessages[22]).toBeDefined(); // ERROR_CannotCreateSeg
      expect(errorMessages[23]).toBeDefined(); // ERROR_CannotBreakSeg
    });

    it('should fall back to generic message for unknown error codes', () => {
      const unknownCode = 99;
      const message = errorMessages[unknownCode] || `Failed with code ${unknownCode}`;
      expect(message).toBe('Failed with code 99');
    });

    describe('partial build result aggregation', () => {
      // Simulates the buildRoad() aggregation logic from buildRoad in road-handler.ts
      function aggregateResults(
        segmentResults: number[]
      ): { success: boolean; partial?: boolean; totalTiles: number } {
        let totalTiles = 0;
        let failedSegment = false;

        for (const code of segmentResults) {
          if (code === 0) {
            totalTiles += 1; // Each diagonal segment = 1 tile
          } else {
            failedSegment = true;
          }
        }

        if (totalTiles > 0) {
          return { success: true, partial: failedSegment, totalTiles };
        }
        return { success: false, totalTiles: 0 };
      }

      it('should return success with no partial flag when all segments succeed', () => {
        const result = aggregateResults([0, 0, 0]);
        expect(result.success).toBe(true);
        expect(result.partial).toBe(false);
        expect(result.totalTiles).toBe(3);
      });

      it('should return partial: true when some segments fail', () => {
        const result = aggregateResults([0, 22, 0]);
        expect(result.success).toBe(true);
        expect(result.partial).toBe(true);
        expect(result.totalTiles).toBe(2);
      });

      it('should return success: false when all segments fail', () => {
        const result = aggregateResults([22, 22, 22]);
        expect(result.success).toBe(false);
        expect(result.totalTiles).toBe(0);
      });

      it('should return partial: true even if only one segment succeeds', () => {
        const result = aggregateResults([22, 0, 22, 22]);
        expect(result.success).toBe(true);
        expect(result.partial).toBe(true);
        expect(result.totalTiles).toBe(1);
      });
    });
  });
});
