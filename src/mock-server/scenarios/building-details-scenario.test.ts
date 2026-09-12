/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `building-details` — the class picture on the wire.
 *
 * Part 1 fixes the fixture facts: every known class's `RESP_BUILDING_DETAILS`
 * carries `iconUrl` under `/cache/BuildingImages/`, and `MOCK_UNKNOWN_CLASS` —
 * the one class the cache holds no texture for — carries no `iconUrl` key at
 * all. Part 2 drives the real `handleBuildingDetails` against a fake
 * `WsHandlerContext` and holds it to the canned response, frame for frame.
 */

import { jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import type { WsMessage } from '@/shared/types/message-types';
import type { BuildingDetailsResponse } from '@/shared/types/domain-types';
import { handleBuildingDetails } from '@/server/ws-handlers/building-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { ALL_MOCK_BUILDINGS, MOCK_UNKNOWN_CLASS, createBuildingDetailsScenario } from './building-details-scenario';

const { ws, rdo } = createBuildingDetailsScenario();

describe('building-details scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('every known class carries iconUrl; the unknown class carries none', () => {
    for (const exchange of ws.exchanges) {
      const details = exchange.responses[0] as unknown as { details: BuildingDetailsResponse };
      const building = ALL_MOCK_BUILDINGS.find((b) => b.visualClass === details.details.visualClass);

      if (building === MOCK_UNKNOWN_CLASS) {
        expect('iconUrl' in details.details).toBe(false);
      } else {
        expect(details.details.iconUrl).toMatch(/^\/cache\/BuildingImages\/Map.*64x32x0\.gif$/);
      }
    }
  });
});

describe('building-details scenario — the drive', () => {
  it('holds the real handler to the canned response for every fixture', async () => {
    for (const exchange of ws.exchanges) {
      const response = exchange.responses[0] as unknown as { details: BuildingDetailsResponse };
      const canned = response.details;
      const { iconUrl: _iconUrl, ...stripped } = canned;

      const sent: Array<Record<string, unknown>> = [];
      const wsMock = {
        send(payload: string): void {
          sent.push(JSON.parse(payload) as Record<string, unknown>);
        },
      } as unknown as WebSocket;

      const getBuildingBasicDetails = jest.fn(async () => stripped);
      const getTextureFilename = jest.fn((visualClass: string) =>
        ALL_MOCK_BUILDINGS.find((b) => b.visualClass === visualClass)?.imagePath,
      );

      const ctx = {
        ws: wsMock,
        session: { getBuildingBasicDetails },
        facilityDimensionsCache: () => ({ getTextureFilename }),
      } as unknown as WsHandlerContext;

      await handleBuildingDetails(ctx, exchange.request as WsMessage);

      expect(sent[0]).toEqual(exchange.responses[0]);
      expect(getBuildingBasicDetails).toHaveBeenCalledWith(
        (exchange.request as unknown as { x: number }).x,
        (exchange.request as unknown as { y: number }).y,
        (exchange.request as unknown as { visualClass: string }).visualClass,
      );
      expect(getTextureFilename).toHaveBeenCalledWith(canned.visualClass);

      if (canned.visualClass === MOCK_UNKNOWN_CLASS.visualClass) {
        expect('iconUrl' in (sent[0].details as object)).toBe(false);
      }
    }
  });
});
