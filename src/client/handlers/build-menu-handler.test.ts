/**
 * Covers the one line task 598 added to preloadFacilityDimensions: the world's facility-kind
 * roster (deriveFacilityKinds over the preloaded dimensions table) lands in useUiStore so the
 * FacilityFilterMenu panel can render it.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { preloadFacilityDimensions } from './build-menu-handler';
import { useUiStore } from '../store/ui-store';
import { getFacilityDimensionsCache } from '../facility-dimensions-cache';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import type { FacilityDimensions } from '../../shared/types';

function makeCtx(dimensions: Record<string, FacilityDimensions>): ClientHandlerContext {
  return {
    sendRequest: async () => ({
      type: WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
      dimensions,
      civicVisualClassIds: [],
    }),
  } as unknown as ClientHandlerContext;
}

describe('preloadFacilityDimensions', () => {
  beforeEach(() => {
    getFacilityDimensionsCache().clear();
    useUiStore.setState({ facilityKinds: [] });
  });

  it('derives the facility-kind roster from the preloaded dimensions and stores it', async () => {
    const ctx = makeCtx({
      farmA: { visualClass: 'farmA', name: 'Farm A', facid: '', facId: 40, xsize: 1, ysize: 1, level: 0 },
      bankA: { visualClass: 'bankA', name: 'Bank A', facid: '', facId: 110, xsize: 1, ysize: 1, level: 0 },
    });

    await preloadFacilityDimensions(ctx);

    expect(useUiStore.getState().facilityKinds).toEqual([
      { facId: 110, label: 'Bank' },
      { facId: 40, label: 'Farm' },
    ]);
  });

  it('stores an empty roster when no dimension carries a positive facId', async () => {
    const ctx = makeCtx({
      x: { visualClass: 'x', name: 'X', facid: '', xsize: 1, ysize: 1, level: 0 },
    });

    await preloadFacilityDimensions(ctx);

    expect(useUiStore.getState().facilityKinds).toEqual([]);
  });
});
