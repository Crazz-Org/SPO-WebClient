/**
 * build-menu-handler — the placement lifecycle publishes what is being placed (name, cost)
 * so the mode bar can show it, and clears it on cancel.
 */

import { placeBuildingFromMenu, cancelBuildingPlacement, sendPlaceBuilding } from './build-menu-handler';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';
import { PendingPlacementLayer } from '../renderer/pending-placements';

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

describe('the pending placeholder', () => {
  function makeFakeRenderer(layer: PendingPlacementLayer) {
    return {
      addPendingPlacement: (p: Parameters<PendingPlacementLayer['add']>[0]) => layer.add(p),
      removePendingPlacement: (key: string) => layer.remove(key),
      setPlacementMode: jest.fn(),
    };
  }

  const building = {
    name: 'Textile Mill', cost: 240000, facilityClass: 'TextileMill', visualClassId: '123',
    area: 1, zoneRequirement: '', iconPath: 'icon.png', description: '', available: true,
  };

  it('paints the placeholder after the call and before the deferred settles', async () => {
    const layer = new PendingPlacementLayer();
    const renderer = makeFakeRenderer(layer);
    let resolveReq!: (v: unknown) => void;
    const sendRequest = jest.fn(() => new Promise((resolve) => { resolveReq = resolve; }));
    const ctx = {
      ...makeCtx(),
      currentBuildingXSize: 2,
      currentBuildingYSize: 2,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    const done = sendPlaceBuilding(ctx, building, 10, 20);
    expect(layer.size).toBe(1);
    expect(layer.list(0)[0]).toMatchObject({ x: 10, y: 20, visualClass: '123' });

    resolveReq({});
    await done;
    expect(layer.size).toBe(0);
    expect(ctx.loadAlignedMapArea).toHaveBeenCalledWith(10, 20, 2);
  });

  it('a refusal removes the placeholder without reloading the area', async () => {
    const layer = new PendingPlacementLayer();
    const renderer = makeFakeRenderer(layer);
    const err = new Error('Zone mismatch') as Error & { code: number };
    err.code = 28;
    const sendRequest = jest.fn().mockRejectedValue(err);
    const ctx = {
      ...makeCtx(),
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      showNotification: jest.fn(),
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    await sendPlaceBuilding(ctx, building, 10, 20);
    expect(layer.size).toBe(0);
    expect(ctx.loadAlignedMapArea).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringContaining('Failed to place building'), 'error');
  });

  it('a timeout removes the placeholder', async () => {
    const layer = new PendingPlacementLayer();
    const renderer = makeFakeRenderer(layer);
    const sendRequest = jest.fn().mockRejectedValue(new Error('Request Timeout'));
    const ctx = {
      ...makeCtx(),
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      showNotification: jest.fn(),
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    await sendPlaceBuilding(ctx, building, 10, 20);
    expect(layer.size).toBe(0);
  });

  it('places normally when there is no renderer', async () => {
    const sendRequest = jest.fn().mockResolvedValue({});
    const ctx = {
      ...makeCtx(),
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
      getRenderer: () => null,
    } as unknown as ClientHandlerContext;

    await expect(sendPlaceBuilding(ctx, building, 10, 20)).resolves.toBeUndefined();
    expect(ctx.loadAlignedMapArea).toHaveBeenCalledWith(10, 20, 1);
  });
});

describe('the Capitol pending placeholder', () => {
  function makeFakeRenderer(layer: PendingPlacementLayer) {
    return {
      addPendingPlacement: (p: Parameters<PendingPlacementLayer['add']>[0]) => layer.add(p),
      removePendingPlacement: (key: string) => layer.remove(key),
      setPlacementMode: jest.fn(),
      setPlacementConfirmCallback: jest.fn(),
      setCancelPlacementCallback: jest.fn(),
    };
  }

  it('paints the placeholder on confirm and clears it once the build succeeds', async () => {
    const { startCapitolPlacement } = await import('./build-menu-handler');
    const layer = new PendingPlacementLayer();
    const renderer = makeFakeRenderer(layer);
    let resolveReq!: (v: unknown) => void;
    const sendRequest = jest.fn(() => new Promise((resolve) => { resolveReq = resolve; }));
    const ctx = {
      ...makeCtx(),
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    await startCapitolPlacement(ctx);
    const confirm = renderer.setPlacementConfirmCallback.mock.calls[0][0] as (x: number, y: number) => void;

    confirm(5, 6);
    expect(layer.size).toBe(1);
    expect(layer.list(0)[0]).toMatchObject({ x: 5, y: 6 });

    resolveReq({});
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(layer.size).toBe(0);
    expect(ctx.loadAlignedMapArea).toHaveBeenCalledWith(5, 6, 1);
  });

  it('a refused Capitol placement clears the placeholder without reloading', async () => {
    const { startCapitolPlacement } = await import('./build-menu-handler');
    const layer = new PendingPlacementLayer();
    const renderer = makeFakeRenderer(layer);
    const sendRequest = jest.fn().mockRejectedValue(new Error('Access denied'));
    const ctx = {
      ...makeCtx(),
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      getRenderer: () => renderer,
    } as unknown as ClientHandlerContext;

    await startCapitolPlacement(ctx);
    const confirm = renderer.setPlacementConfirmCallback.mock.calls[0][0] as (x: number, y: number) => void;

    confirm(5, 6);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(layer.size).toBe(0);
    expect(ctx.loadAlignedMapArea).not.toHaveBeenCalled();
  });
});
