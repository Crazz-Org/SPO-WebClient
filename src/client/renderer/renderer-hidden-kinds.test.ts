/**
 * Tests for the renderer's hide-a-kind filter (drawBuildings pre-filter / setHiddenFacIds /
 * setFacilityKindsChangedCallback / publishFacilityKinds). Same prototype `.call()` pattern as
 * renderer-glass-buildings.test.ts — the monolith is too heavy to instantiate in jsdom.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding, FacilityKind } from '../../shared/types/domain-types';

type Dims = { xsize: number; ysize: number; facId?: number; textureFilename?: string };

type Ctx = {
  drawImage: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  scale: jest.Mock;
  fillRect: jest.Mock;
  fillStyle: string;
  globalAlpha: number;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, Dims>;
  hoveredBuilding: MapBuilding | null;
  selectedBuilding: MapBuilding | null;
  buildingEffects: Map<string, unknown>;
  hasAnimatedBuildings: boolean;
  isOnWaterPlatform: () => boolean;
  gameObjectTextureCache: {
    getTextureSync: () => { width: number; height: number };
    getAnimatedTexture: () => null;
  };
  glassForeignBuildings: boolean;
  ownTycoonId: number;
  hiddenFacIds: Set<number>;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const drawXLog: number[] = [];
  const ctx: Ctx = {
    drawImage: jest.fn((..._args: unknown[]) => { drawXLog.push(_args[1] as number); }),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
  (ctx as unknown as { drawXLog: number[] }).drawXLog = drawXLog;
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(visualClass: string, x: number, y: number): MapBuilding {
  return { visualClass, tycoonId: 1, options: 0, x, y, level: 0, alert: false, attack: 0 };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    ctx: makeCtx(),
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: centeredMapToScreen,
    },
    canvas: { width: 800, height: 600 },
    allBuildings: [],
    facilityDimensionsCache: new Map(),
    hoveredBuilding: null,
    selectedBuilding: null,
    buildingEffects: new Map(),
    hasAnimatedBuildings: false,
    isOnWaterPlatform: () => false,
    gameObjectTextureCache: {
      getTextureSync: () => ({ width: 64, height: 64 }),
      getAnimatedTexture: () => null,
    },
    glassForeignBuildings: false,
    ownTycoonId: 0,
    hiddenFacIds: new Set(),
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function drawXs(host: Host): number[] {
  return (host.ctx as unknown as { drawXLog: number[] }).drawXLog;
}

describe('drawBuildings — hidden kinds', () => {
  function makeWorld(): { cache: Map<string, Dims>; buildings: MapBuilding[] } {
    const cache = new Map<string, Dims>([
      ['house', { xsize: 1, ysize: 1, facId: 10 }],
      ['plant', { xsize: 1, ysize: 1, facId: 46 }],
      ['road', { xsize: 1, ysize: 1, facId: 0 }],
    ]);
    const buildings = [
      makeBuilding('house', 1, 1),
      makeBuilding('plant', 2, 2),
      makeBuilding('road', 3, 3),
      makeBuilding('mystery', 4, 4), // no cache entry
    ];
    return { cache, buildings };
  }

  it('skips the hidden kind and draws everything else', () => {
    const { cache, buildings } = makeWorld();
    const host = makeHost({ allBuildings: buildings, facilityDimensionsCache: cache, hiddenFacIds: new Set([10]) });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(3);
    expect(drawXs(host)).toEqual([
      400 + 2 * 10 - 32,
      400 + 3 * 10 - 32,
      400 + 4 * 10 - 32,
    ]);
  });

  it('skips multiple hidden kinds', () => {
    const { cache, buildings } = makeWorld();
    const host = makeHost({ allBuildings: buildings, facilityDimensionsCache: cache, hiddenFacIds: new Set([10, 46]) });
    drawBuildings(host);
    expect(drawXs(host)).toEqual([
      400 + 3 * 10 - 32,
      400 + 4 * 10 - 32,
    ]);
  });

  it('never hides facId 0', () => {
    const { cache, buildings } = makeWorld();
    const host = makeHost({ allBuildings: buildings, facilityDimensionsCache: cache, hiddenFacIds: new Set([0]) });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(4);
  });

  it('never hides an unknown class, even if its facId happens to be in the hidden set', () => {
    const { cache, buildings } = makeWorld();
    const host = makeHost({ allBuildings: buildings, facilityDimensionsCache: cache, hiddenFacIds: new Set([99]) });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(4);
  });

  it('draws everything when the hidden set is empty', () => {
    const { cache, buildings } = makeWorld();
    const host = makeHost({ allBuildings: buildings, facilityDimensionsCache: cache, hiddenFacIds: new Set() });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(4);
  });
});

describe('setHiddenFacIds', () => {
  function call(host: Partial<Host>, method: string, ...args: unknown[]): void {
    (proto[method] as (this: unknown, ...a: unknown[]) => void).apply(host, args);
  }

  it('stores a Set built from the array and requests a render', () => {
    const host: { hiddenFacIds?: Set<number>; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setHiddenFacIds', [10, 46]);
    expect(host.hiddenFacIds).toEqual(new Set([10, 46]));
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('maps a non-array value to an empty Set', () => {
    const host: { hiddenFacIds?: Set<number>; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setHiddenFacIds', undefined as unknown as number[]);
    expect(host.hiddenFacIds).toEqual(new Set());
  });
});

describe('publishFacilityKinds', () => {
  type PublishHost = {
    allBuildings: MapBuilding[];
    facilityDimensionsCache: Map<string, Dims>;
    onFacilityKindsChanged: jest.Mock<(kinds: FacilityKind[]) => void> | null;
    lastFacilityKindsKey: string;
  };

  function publish(host: PublishHost): void {
    (proto.publishFacilityKinds as (this: PublishHost) => void).call(host);
  }

  it('publishes the sorted kinds once', () => {
    const cache = new Map<string, Dims>([
      ['plant', { xsize: 1, ysize: 1, facId: 46, textureFilename: 'MapFarm64x32x0.gif' }],
      ['house', { xsize: 1, ysize: 1, facId: 10, textureFilename: 'MapHQ64x32x0.gif' }],
    ]);
    const host: PublishHost = {
      allBuildings: [makeBuilding('plant', 1, 1), makeBuilding('house', 2, 2)],
      facilityDimensionsCache: cache,
      onFacilityKindsChanged: jest.fn(),
      lastFacilityKindsKey: '',
    };
    publish(host);
    expect(host.onFacilityKindsChanged).toHaveBeenCalledTimes(1);
    expect(host.onFacilityKindsChanged).toHaveBeenCalledWith([
      { facId: 10, label: 'HQ' },
      { facId: 46, label: 'Farm' },
    ]);
  });

  it('does not publish again when the derived kinds have not changed', () => {
    const cache = new Map<string, Dims>([['house', { xsize: 1, ysize: 1, facId: 10, textureFilename: 'MapHQ64x32x0.gif' }]]);
    const host: PublishHost = {
      allBuildings: [makeBuilding('house', 2, 2)],
      facilityDimensionsCache: cache,
      onFacilityKindsChanged: jest.fn(),
      lastFacilityKindsKey: '',
    };
    publish(host);
    publish(host);
    expect(host.onFacilityKindsChanged).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no callback is registered', () => {
    const host: PublishHost = {
      allBuildings: [makeBuilding('house', 2, 2)],
      facilityDimensionsCache: new Map(),
      onFacilityKindsChanged: null,
      lastFacilityKindsKey: '',
    };
    expect(() => publish(host)).not.toThrow();
  });
});

describe('setFacilityKindsChangedCallback', () => {
  it('stores the callback', () => {
    const host: { onFacilityKindsChanged?: ((kinds: FacilityKind[]) => void) | null } = {};
    const callback = jest.fn();
    (proto.setFacilityKindsChangedCallback as (this: typeof host, cb: (kinds: FacilityKind[]) => void) => void).call(host, callback);
    expect(host.onFacilityKindsChanged).toBe(callback);
  });
});

describe('fetchDimensionsForBuildings — publishes facility kinds', () => {
  it('calls publishFacilityKinds after loading dimensions for the given buildings', async () => {
    const cache = new Map<string, Dims>([['house', { xsize: 1, ysize: 1, facId: 10, textureFilename: 'MapHQ64x32x0.gif' }]]);
    const buildings = [makeBuilding('house', 1, 1)];
    const publishFacilityKinds = jest.fn();
    const host = {
      onFetchFacilityDimensions: jest.fn(async () => null),
      facilityDimensionsCache: cache,
      cachedOccupiedTiles: null,
      rebuildConcreteSet: jest.fn(),
      preloadBuildingTextures: jest.fn(),
      publishFacilityKinds,
      allBuildings: buildings,
      requestRender: jest.fn(),
    };

    await (proto.fetchDimensionsForBuildings as (this: typeof host, b: MapBuilding[]) => Promise<void>).call(host, buildings);

    expect(publishFacilityKinds).toHaveBeenCalledTimes(1);
  });
});
