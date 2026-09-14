/**
 * build-menu-handler — the placement lifecycle publishes what is being placed (name, cost)
 * so the mode bar can show it, and clears it on cancel.
 */

import { placeBuildingFromMenu, cancelBuildingPlacement } from './build-menu-handler';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';

jest.mock('../bridge/client-bridge', () => {
  // setBuildMenuFacilities writes the store, as the real bridge does
  const { useUiStore } = jest.requireActual('../store/ui-store') as typeof import('../store/ui-store');
  return {
    ClientBridge: {
      log: jest.fn(),
      showNotification: jest.fn(),
      setBuildMenuFacilities: (facs: unknown[]) => useUiStore.getState().setBuildMenuFacilities(facs as never),
      setBuildMenuCategories: jest.fn(),
    },
  };
});
jest.mock('../facility-dimensions-cache', () => ({
  getFacilityDimensions: jest.fn().mockResolvedValue({ xsize: 2, ysize: 2 }),
  getFacilityDimensionsCache: () => ({ getFacility: () => ({ xsize: 2, ysize: 2 }) }),
}));

function makeCtx(): ClientHandlerContext {
  return {
    currentBuildingToPlace: null,
    currentBuildingXSize: 1,
    currentBuildingYSize: 1,
    lastLoadedFacilities: [{ name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123' }],
    showNotification: jest.fn(),
    getRenderer: () => null,
    activeOverlayType: null,
    toggleZoneOverlay: jest.fn(),
    isRoadBuildingMode: false,
    isRoadDemolishMode: false,
    isZonePaintingMode: false,
  } as unknown as ClientHandlerContext;
}

describe('placement lifecycle and the mode bar', () => {
  beforeEach(() => {
    useUiStore.setState({ isPlacingBuilding: false, placementValid: false, placingFacility: null });
  });

  it('publishes the facility being placed, then clears it on cancel', async () => {
    const ctx = makeCtx();
    placeBuildingFromMenu(ctx, 'TextileMill', '123');
    // startBuildingPlacement is async (dimensions lookup); let it settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(useUiStore.getState().isPlacingBuilding).toBe(true);
    expect(useUiStore.getState().placingFacility).toEqual({ name: 'Textile Mill', cost: 240000 });
    cancelBuildingPlacement(ctx);
    expect(useUiStore.getState().isPlacingBuilding).toBe(false);
    expect(useUiStore.getState().placingFacility).toBeNull();
  });

  it('an unknown facility is logged, not placed', () => {
    const ctx = makeCtx();
    placeBuildingFromMenu(ctx, 'Nope', '0');
    expect(useUiStore.getState().isPlacingBuilding).toBe(false);
  });
});

describe('placeBuilding asks before spending', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null });
    sessionStorage.clear();
  });

  it('raises a spend Dialog with cost and cash after, and sends only on confirm', async () => {
    const { placeBuilding } = await import('./build-menu-handler');
    const sendRequest = jest.fn().mockResolvedValue({});
    const ctx = {
      ...makeCtx(),
      currentBuildingToPlace: { name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123', area: 1, zoneRequirement: 'Industrial', iconPath: '' },
      currentBuildingXSize: 2,
      currentBuildingYSize: 2,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;
    const { useGameStore } = await import('../store/game-store');
    useGameStore.setState({ tycoonStats: { cash: '12480300', incomePerHour: '0', failureLevel: 0 } as never });

    const done = placeBuilding(ctx, 10, 20);
    const s = useUiStore.getState();
    expect(s.modal).toBe('confirm');
    expect(s.confirmPayload?.title).toBe('Build a Textile Mill?');
    expect(s.confirmPayload?.options?.kind).toBe('spend');
    expect(s.confirmPayload?.options?.rows?.map((r) => r.label)).toEqual(['Cost', 'Cash after']);
    expect(sendRequest).not.toHaveBeenCalled();

    s.confirmPayload?.onConfirm();
    await done;
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest.mock.calls[0][0]).toMatchObject({ facilityClass: 'TextileMill', x: 10, y: 20 });
  });

  it('skips the dialog when the player opted out for the session', async () => {
    sessionStorage.setItem('spo.dialog.dontAsk.build', '1');
    const { placeBuilding } = await import('./build-menu-handler');
    const sendRequest = jest.fn().mockResolvedValue({});
    const ctx = {
      ...makeCtx(),
      currentBuildingToPlace: { name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123', area: 1, zoneRequirement: '', iconPath: '' },
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;
    await placeBuilding(ctx, 1, 2);
    expect(useUiStore.getState().modal).toBeNull();
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });
});

describe('placeBuilding paints and clears an optimistic placeholder (#604)', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null });
    sessionStorage.setItem('spo.dialog.dontAsk.build', '1');
  });

  function makeRenderer() {
    return {
      addPendingPlacement: jest.fn().mockReturnValue('10,20'),
      removePendingPlacement: jest.fn(),
      setPlacementMode: jest.fn(),
    };
  }

  it('adds the placeholder before the answer and removes it on success', async () => {
    const { placeBuilding } = await import('./build-menu-handler');
    const renderer = makeRenderer();
    const sendRequest = jest.fn().mockResolvedValue({});
    const ctx = {
      ...makeCtx(),
      currentBuildingToPlace: { name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123', area: 1, zoneRequirement: '', iconPath: 'icon.gif' },
      currentBuildingXSize: 2,
      currentBuildingYSize: 2,
      getRenderer: () => renderer,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;

    await placeBuilding(ctx, 10, 20);

    expect(renderer.addPendingPlacement).toHaveBeenCalledWith(10, 20, 2, 2, '123', 'icon.gif');
    expect(renderer.removePendingPlacement).toHaveBeenCalledWith('10,20');
    expect(renderer.removePendingPlacement.mock.invocationCallOrder[0])
      .toBeGreaterThan(sendRequest.mock.invocationCallOrder[0]);
  });

  it('removes the placeholder when the request is rejected, leaving the map as it was', async () => {
    const { placeBuilding } = await import('./build-menu-handler');
    const renderer = makeRenderer();
    const sendRequest = jest.fn().mockRejectedValue(new Error('refused'));
    const ctx = {
      ...makeCtx(),
      currentBuildingToPlace: { name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123', area: 1, zoneRequirement: '', iconPath: '' },
      getRenderer: () => renderer,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;

    await placeBuilding(ctx, 10, 20);

    expect(renderer.addPendingPlacement).toHaveBeenCalledTimes(1);
    expect(renderer.removePendingPlacement).toHaveBeenCalledWith('10,20');
    expect(ctx.loadAlignedMapArea).not.toHaveBeenCalled();
  });

  it('a null renderer is a silent no-op, and the toast/notification still fire', async () => {
    const { placeBuilding } = await import('./build-menu-handler');
    const sendRequest = jest.fn().mockRejectedValue(new Error('refused'));
    const ctx = {
      ...makeCtx(),
      currentBuildingToPlace: { name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123', area: 1, zoneRequirement: '', iconPath: '' },
      getRenderer: () => null,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;

    await expect(placeBuilding(ctx, 10, 20)).resolves.toBeUndefined();
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('Failed to place building'), 'error');
  });
});

describe('facilities session cache', () => {
  it('serves a category from the cache without a second request, publishing a fresh array', async () => {
    const { loadBuildingFacilitiesByKind } = await import('./build-menu-handler');
    const category = { kind: 'store', cluster: 'c1', kindName: 'Commerce', folder: '', tycoonLevel: 0 };
    const sendRequest = jest.fn().mockResolvedValue({ facilities: [{ name: 'Small Store', facilityClass: 'SmallStore', visualClassId: '101', cost: 1 }] });
    const ctx = {
      ...makeCtx(),
      currentCompanyName: 'Co',
      buildingCategories: [category],
      buildingFacilitiesCache: new Map(),
      sendRequest,
    } as unknown as ClientHandlerContext;
    await loadBuildingFacilitiesByKind(ctx, 'store', 'c1');
    expect(sendRequest).toHaveBeenCalledTimes(1);
    const first = useUiStore.getState().buildMenuFacilities;
    await loadBuildingFacilitiesByKind(ctx, 'store', 'c1');
    expect(sendRequest).toHaveBeenCalledTimes(1);
    const second = useUiStore.getState().buildMenuFacilities;
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(ctx.lastLoadedFacilities[0].name).toBe('Small Store');
  });
});
