/**
 * preloadFacilityDimensions also derives the world's facility KIND catalogue (issue #598) and
 * stores it on the game store — this covers that one new line.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { preloadFacilityDimensions } from './build-menu-handler';
import { useGameStore } from '../store/game-store';
import { getFacilityDimensionsCache } from '../facility-dimensions-cache';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import type { WsRespAllFacilityDimensions } from '../../shared/types/message-types';

describe('preloadFacilityDimensions — facility kinds', () => {
  beforeEach(() => {
    getFacilityDimensionsCache().clear();
    useGameStore.getState().setFacilityKinds([]);
  });

  it('derives facilityKinds from the preloaded dimensions and stores them', async () => {
    const response: WsRespAllFacilityDimensions = {
      type: WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
      dimensions: {
        '1': { visualClass: '1', name: 'Farm', facid: '', xsize: 1, ysize: 1, level: 0, facId: 10 },
        '2': { visualClass: '2', name: 'Mine', facid: '', xsize: 1, ysize: 1, level: 0, facId: 20 },
      },
      civicVisualClassIds: [],
    };
    const ctx = {
      sendRequest: jest.fn(async () => response),
    } as unknown as ClientHandlerContext;

    await preloadFacilityDimensions(ctx);

    expect(useGameStore.getState().facilityKinds).toEqual([
      { facId: 10, label: 'Farm' },
      { facId: 20, label: 'Mine' },
    ]);
  });
});
