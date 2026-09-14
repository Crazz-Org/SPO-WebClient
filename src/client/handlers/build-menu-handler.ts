/**
 * Build Menu Handler — extracted from StarpeaceClient.
 *
 * Handles build menu, facility loading, building placement flow,
 * Capitol placement, and facility dimensions.
 */

import {
  WsMessageType,
  WsReqGetBuildingCategories,
  WsRespBuildingCategories,
  WsReqGetBuildingFacilities,
  WsRespBuildingFacilities,
  WsReqPlaceBuilding,
  WsReqBuildCapitol,
  WsReqGetAllFacilityDimensions,
  WsRespAllFacilityDimensions,
  BuildingCategory,
  BuildingInfo,
  FacilityDimensions,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import { useUiStore } from '../store/ui-store';
import { useGameStore } from '../store/game-store';
import { getFacilityDimensionsCache } from '../facility-dimensions-cache';
import { registerCivicVisualClass } from '../../shared/building-details/civic-buildings';
import type { ClientHandlerContext } from './client-context';
import { enterZonesOverlayForMode, leaveZonesOverlayAfterMode } from './overlay-mode';
import { setupEscapeHandler } from './handler-utils';
import { showToast } from '../components/common/Toast';
import { formatMoney } from '../format-utils';

export async function openBuildMenu(ctx: ClientHandlerContext): Promise<void> {
  if (!ctx.currentCompanyName) {
    ClientBridge.log('Error', 'No company selected');
    return;
  }

  ClientBridge.log('Build', 'Opening build menu...');

  try {
    const req: WsReqGetBuildingCategories = {
      type: WsMessageType.REQ_GET_BUILDING_CATEGORIES,
      companyName: ctx.currentCompanyName
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingCategories;
    ctx.buildingCategories = response.categories;

    ClientBridge.setBuildMenuCategories(response.categories, response.capitolIconUrl);

    ClientBridge.log('Build', `Loaded ${response.categories.length} building categories`);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to load building categories: ${toErrorMessage(err)}`);
  }
}

async function loadBuildingFacilities(ctx: ClientHandlerContext, category: BuildingCategory): Promise<void> {
  // Session cache — the list of a category does not change while the player is logged in,
  // and every reopen used to cost a round trip (audit §1.2). Publish a fresh array so the
  // store subscribers re-render.
  const cacheKey = `${category.cluster}/${category.kind}`;
  const cached = ctx.buildingFacilitiesCache?.get(cacheKey);
  if (cached) {
    ctx.lastLoadedFacilities = cached;
    ClientBridge.setBuildMenuFacilities([...cached]);
    return;
  }

  ClientBridge.log('Build', `Loading facilities for ${category.kindName}...`);

  try {
    const req: WsReqGetBuildingFacilities = {
      type: WsMessageType.REQ_GET_BUILDING_FACILITIES,
      companyName: ctx.currentCompanyName,
      cluster: category.cluster,
      kind: category.kind,
      kindName: category.kindName,
      folder: category.folder,
      tycoonLevel: category.tycoonLevel
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingFacilities;

    const dimCache = getFacilityDimensionsCache();
    const enriched = response.facilities.map(f => {
      const dims = dimCache.getFacility(f.visualClassId);
      return dims ? { ...f, xsize: dims.xsize, ysize: dims.ysize } : f;
    });

    ctx.lastLoadedFacilities = enriched;
    ctx.buildingFacilitiesCache?.set(cacheKey, enriched);
    ClientBridge.setBuildMenuFacilities(enriched);

    ClientBridge.log('Build', `Loaded ${enriched.length} facilities`);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to load facilities: ${toErrorMessage(err)}`);
  }
}

export async function loadBuildingFacilitiesByKind(ctx: ClientHandlerContext, kind: string, cluster: string): Promise<void> {
  const category = ctx.buildingCategories.find(c => c.kind === kind && c.cluster === cluster);
  if (!category) {
    ClientBridge.log('Error', `Category not found: kind=${kind}, cluster=${cluster}`);
    return;
  }
  await loadBuildingFacilities(ctx, category);
}

export function placeBuildingFromMenu(ctx: ClientHandlerContext, facilityClass: string, visualClassId: string): void {
  const facility = ctx.lastLoadedFacilities.find(
    f => f.facilityClass === facilityClass && f.visualClassId === visualClassId
  );
  if (!facility) {
    ClientBridge.log('Error', `Facility not found: ${facilityClass}`);
    return;
  }
  startBuildingPlacement(ctx, facility);
}

export function openCapitolInspector(ctx: ClientHandlerContext): void {
  const coords = useGameStore.getState().capitolCoords;
  if (!coords) {
    ctx.showNotification('No Capitol found in this world', 'error');
    return;
  }
  ctx.focusBuilding(coords.x, coords.y);
}

export async function startCapitolPlacement(ctx: ClientHandlerContext): Promise<void> {
  ClientBridge.log('Build', 'Capitol placement mode — click on map to place.');

  const CAPITOL_VISUAL_CLASS_ID = '152';
  let xsize = 1;
  let ysize = 1;
  try {
    const dimensions = await getFacilityDimensions(CAPITOL_VISUAL_CLASS_ID);
    if (dimensions) {
      xsize = dimensions.xsize;
      ysize = dimensions.ysize;
    }
  } catch (err: unknown) {
    console.error('Failed to fetch Capitol dimensions:', err);
  }

  ctx.currentBuildingToPlace = {
    name: 'Capitol',
    facilityClass: 'Capitol',
    visualClassId: CAPITOL_VISUAL_CLASS_ID,
    cost: 0,
    area: xsize * ysize,
    description: 'Capitol building',
    zoneRequirement: '',
    iconPath: useUiStore.getState().capitolIconUrl,
    available: true,
  };
  ctx.currentBuildingXSize = xsize;
  ctx.currentBuildingYSize = ysize;

  ctx.showNotification('Capitol placement mode — Click map to place, ESC to cancel', 'info');

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setPlacementMode(
      true,
      'Capitol',
      0,
      xsize * ysize,
      '',
      xsize,
      ysize,
      CAPITOL_VISUAL_CLASS_ID
    );
    renderer.setPlacementConfirmCallback((x, y) => {
      placeCapitol(ctx, x, y);
    });
    renderer.setCancelPlacementCallback(() => {
      cancelBuildingPlacement(ctx);
    });
  }

  setupPlacementKeyboardHandler(ctx);
}

async function placeCapitol(ctx: ClientHandlerContext, x: number, y: number): Promise<void> {
  ClientBridge.log('Build', `Placing Capitol at (${x}, ${y})...`);

  try {
    const req: WsReqBuildCapitol = {
      type: WsMessageType.REQ_BUILD_CAPITOL,
      x, y
    };

    await ctx.sendRequest(req);

    ClientBridge.log('Build', 'Capitol built successfully!');
    ctx.showNotification('Capitol built successfully!', 'success');

    const buildingMargin = Math.max(ctx.currentBuildingXSize, ctx.currentBuildingYSize);
    ctx.loadAlignedMapArea(x, y, buildingMargin);

    cancelBuildingPlacement(ctx);
  } catch (err: unknown) {
    const errorMsg = toErrorMessage(err);
    ClientBridge.log('Error', `Failed to place Capitol: ${errorMsg}`);
    ctx.showNotification(`Failed to place Capitol: ${errorMsg}`, 'error');
  }
}

export async function preloadFacilityDimensions(ctx: ClientHandlerContext): Promise<void> {
  ClientBridge.log('Cache', 'Preloading facility dimensions...');

  try {
    const req: WsReqGetAllFacilityDimensions = {
      type: WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS
    };

    const response = await ctx.sendRequest(req) as WsRespAllFacilityDimensions;

    const cache = getFacilityDimensionsCache();
    cache.initialize(response.dimensions);

    if (response.civicVisualClassIds) {
      for (const id of response.civicVisualClassIds) {
        registerCivicVisualClass(id);
      }
    }

    ClientBridge.log('Cache', `Loaded ${cache.getSize()} facility dimensions`);
  } catch (err: unknown) {
    console.error('[Client] Failed to preload facility dimensions:', err);
    ClientBridge.log('Error', 'Failed to load facility dimensions. Building placement may not work correctly.');
  }
}

async function getFacilityDimensions(visualClass: string): Promise<FacilityDimensions | null> {
  const cache = getFacilityDimensionsCache();

  if (!cache.isInitialized()) {
    console.warn('[Client] Facility cache not initialized yet');
    return null;
  }

  return cache.getFacility(visualClass) || null;
}

async function startBuildingPlacement(ctx: ClientHandlerContext, building: BuildingInfo): Promise<void> {
  ctx.currentBuildingToPlace = building;
  ClientBridge.log('Build', `Placing ${building.name}. Click on map to build.`);

  let xsize = 1;
  let ysize = 1;
  try {
    const dimensions = await getFacilityDimensions(building.visualClassId);
    if (dimensions) {
      xsize = dimensions.xsize;
      ysize = dimensions.ysize;
    }
  } catch (err: unknown) {
    console.error('Failed to fetch facility dimensions:', err);
  }
  ctx.currentBuildingXSize = xsize;
  ctx.currentBuildingYSize = ysize;

  // Under the desktop breakpoint the touch shell runs (lot g: tablet included)
  const isTouchShell = window.innerWidth < 1024;
  const notifText = isTouchShell
    ? `${building.name} — Pan map to position, tap to place`
    : `${building.name} placement mode — Click map to place, ESC to cancel`;
  ctx.showNotification(notifText, 'info');

  useUiStore.getState().setIsPlacingBuilding(true);
  useUiStore.getState().setPlacementValid(true);
  useUiStore.getState().setPlacingFacility({ name: building.name, cost: building.cost });

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setPlacementValidityCallback((valid) => {
      useUiStore.getState().setPlacementValid(valid);
    });
    renderer.setPlacementMode(
      true,
      building.name,
      building.cost,
      building.area,
      building.zoneRequirement,
      xsize,
      ysize,
      building.visualClassId,
      building.iconPath
    );
  }

  const callbackRenderer = ctx.getRenderer();
  if (callbackRenderer) {
    callbackRenderer.setPlacementConfirmCallback((x, y) => {
      placeBuilding(ctx, x, y);
    });
    callbackRenderer.setCancelPlacementCallback(() => {
      cancelBuildingPlacement(ctx);
    });
  }

  setupPlacementKeyboardHandler(ctx);
  enterZonesOverlayForMode(ctx);
}

function setupPlacementKeyboardHandler(ctx: ClientHandlerContext): void {
  setupEscapeHandler(
    () => !!(ctx.currentBuildingToPlace || ctx.isRoadBuildingMode || ctx.isRoadDemolishMode || ctx.isZonePaintingMode),
    () => {
      if (ctx.currentBuildingToPlace) cancelBuildingPlacement(ctx);
      else if (ctx.isRoadBuildingMode) ctx.cancelRoadBuildingMode();
      else if (ctx.isRoadDemolishMode) ctx.cancelRoadDemolishMode();
      else if (ctx.isZonePaintingMode) ctx.cancelZonePaintingMode();
    },
  );
}

/**
 * A map click in placement mode. The spend is CONFIRMED first (T1 handoff, B5): a Dialog with
 * the cost and the cash after; the player can opt out for the session ("Don't ask again"),
 * in which case requestConfirm calls straight through. Only then does the request leave.
 */
export function placeBuilding(ctx: ClientHandlerContext, x: number, y: number): Promise<void> {
  if (!ctx.currentBuildingToPlace) return Promise.resolve();
  const building = ctx.currentBuildingToPlace;
  const cashRaw = useGameStore.getState().tycoonStats?.cash;
  const cashNum = cashRaw ? parseFloat(String(cashRaw).replace(/,/g, '')) : NaN;
  const rows = [{ label: 'Cost', value: formatMoney(building.cost), tone: 'gold' as const }];
  if (!Number.isNaN(cashNum)) {
    const after = cashNum - building.cost;
    rows.push({ label: 'Cash after', value: formatMoney(after), tone: (after < 0 ? 'negative' : 'positive') as never });
  }
  return new Promise<void>((resolve) => {
    useUiStore.getState().requestConfirm(
      `Build a ${building.name}?`,
      `At (${x}, ${y})${building.zoneRequirement ? `, ${building.zoneRequirement} zone` : ''}.`,
      () => {
        void sendPlaceBuilding(ctx, building, x, y).then(resolve);
      },
      { kind: 'spend', confirmLabel: 'Build', typeToConfirm: null, rows, dontAskAgainKey: 'build' },
    );
  });
}

async function sendPlaceBuilding(ctx: ClientHandlerContext, building: BuildingInfo, x: number, y: number): Promise<void> {
  ClientBridge.log('Build', `Placing ${building.name} at (${x}, ${y})...`);

  const renderer = ctx.getRenderer();
  // Painted before the request goes out, so the click never looks lost while the
  // answer is still in flight (#604). A null renderer (headless tests, pre-mount)
  // is a silent no-op via the optional chain below.
  const pendingKey = renderer?.addPendingPlacement(
    x, y, ctx.currentBuildingXSize, ctx.currentBuildingYSize,
    building.visualClassId, building.iconPath,
  ) ?? null;

  try {
    const req: WsReqPlaceBuilding = {
      type: WsMessageType.REQ_PLACE_BUILDING,
      facilityClass: building.facilityClass,
      x, y
    };

    await ctx.sendRequest(req);
    if (pendingKey) renderer?.removePendingPlacement(pendingKey);

    ClientBridge.log('Build', `Successfully placed ${building.name}!`);
    showToast(`${building.name} placed.`, 'success', {
      title: 'Built',
      action: { label: 'View', onClick: () => { void ctx.focusBuilding(x, y); } },
    });

    const buildingMargin = Math.max(ctx.currentBuildingXSize, ctx.currentBuildingYSize);
    ctx.loadAlignedMapArea(x, y, buildingMargin);

    // Keep placement mode active so the user can place the same building again.
    // Callbacks, keyboard handler, and zone overlay are already set up — just
    // reset the renderer preview so the ghost reappears on the next mouse move.
    if (renderer) {
      renderer.setPlacementMode(
        true,
        building.name,
        building.cost,
        building.area,
        building.zoneRequirement,
        ctx.currentBuildingXSize,
        ctx.currentBuildingYSize,
        building.visualClassId,
        building.iconPath
      );
    }
  } catch (err: unknown) {
    if (pendingKey) renderer?.removePendingPlacement(pendingKey);
    const errorMsg = toErrorMessage(err);
    ClientBridge.log('Error', `Failed to place ${building.name}: ${errorMsg}`);
    ctx.showNotification(`Failed to place building: ${errorMsg}`, 'error');
  }
}

export function cancelBuildingPlacement(ctx: ClientHandlerContext): void {
  ctx.currentBuildingToPlace = null;

  useUiStore.getState().setIsPlacingBuilding(false);
  useUiStore.getState().setPlacementValid(false);
  useUiStore.getState().setPlacingFacility(null);

  const notification = document.getElementById('placement-notification');
  if (notification) notification.remove();

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setPlacementMode(false);
  }

  leaveZonesOverlayAfterMode(ctx);
}
