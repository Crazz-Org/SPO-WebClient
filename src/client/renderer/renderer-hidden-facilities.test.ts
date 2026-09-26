/**
 * Tests for the renderer's hidden-facility-kind filter (issue #598) —
 * drawBuildings / the demolition pass / getBuildingAt / setHiddenFacIds. Same harness pattern
 * as renderer-glass-buildings.test.ts in this directory: the monolith is too heavy to
 * instantiate in jsdom, so private/public methods are driven via prototype `.call()` against a
 * crafted host.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding } from '../../shared/types/domain-types';

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

type Dims = { xsize: number; ysize: number; facId?: number };

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
  buildingEffects: Map<string, { type: 'upgrade' | 'demolish'; startTime: number; building: MapBuilding }>;
  hasAnimatedBuildings: boolean;
  isOnWaterPlatform: () => boolean;
  footprintAnchor: (...args: unknown[]) => unknown;
  gameObjectTextureCache: {
    getTextureSync: () => { width: number; height: number };
    getAnimatedTexture: () => null;
  };
  glassForeignBuildings: boolean;
  ownTycoonId: number;
  hiddenFacIds: ReadonlySet<number>;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const ctx: Ctx = {
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
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
    footprintAnchor: proto.footprintAnchor,
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

describe('drawBuildings — hidden facility kinds', () => {
  it('skips exactly the buildings whose class maps to a hidden facId, leaves everything else drawn', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1), makeBuilding('mine', 2, 2)],
      facilityDimensionsCache: new Map<string, Dims>([
        ['farm', { xsize: 1, ysize: 1, facId: 10 }],
        ['mine', { xsize: 1, ysize: 1, facId: 20 }],
      ]),
      hiddenFacIds: new Set([10]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('never hides a building whose class is absent from the dimensions cache', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('unknown', 1, 1)],
      facilityDimensionsCache: new Map(),
      hiddenFacIds: new Set([10]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('never hides a class whose facId is 0, even when 0 is in the hidden set', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1)],
      facilityDimensionsCache: new Map<string, Dims>([['farm', { xsize: 1, ysize: 1, facId: 0 }]]),
      hiddenFacIds: new Set([0]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws both buildings when the hidden set is empty', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1), makeBuilding('mine', 2, 2)],
      facilityDimensionsCache: new Map<string, Dims>([
        ['farm', { xsize: 1, ysize: 1, facId: 10 }],
        ['mine', { xsize: 1, ysize: 1, facId: 20 }],
      ]),
      hiddenFacIds: new Set(),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it('does not draw a demolishing building of a hidden kind', () => {
    const demolishing = makeBuilding('farm', 1, 1);
    const host = makeHost({
      allBuildings: [],
      facilityDimensionsCache: new Map<string, Dims>([['farm', { xsize: 1, ysize: 1, facId: 10 }]]),
      hiddenFacIds: new Set([10]),
      buildingEffects: new Map([['k', { type: 'demolish', startTime: performance.now(), building: demolishing }]]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe('getBuildingAt', () => {
  function getBuildingAt(host: Host, x: number, y: number): MapBuilding | null {
    return (proto.getBuildingAt as (this: Host, x: number, y: number) => MapBuilding | null).call(host, x, y);
  }

  it('returns null for a hidden kind', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1)],
      facilityDimensionsCache: new Map<string, Dims>([['farm', { xsize: 1, ysize: 1, facId: 10 }]]),
      hiddenFacIds: new Set([10]),
    });
    expect(getBuildingAt(host, 1, 1)).toBeNull();
  });

  it('returns the building for a shown kind', () => {
    const building = makeBuilding('farm', 1, 1);
    const host = makeHost({
      allBuildings: [building],
      facilityDimensionsCache: new Map<string, Dims>([['farm', { xsize: 1, ysize: 1, facId: 10 }]]),
      hiddenFacIds: new Set([20]),
    });
    expect(getBuildingAt(host, 1, 1)).toBe(building);
  });
});

describe('setHiddenFacIds', () => {
  it('stores a Set and requests a render', () => {
    const host: { hiddenFacIds?: ReadonlySet<number>; requestRender: jest.Mock } = { requestRender: jest.fn() };
    (proto.setHiddenFacIds as (this: unknown, facIds: readonly number[]) => void).call(host, [10, 20]);
    expect(host.hiddenFacIds).toEqual(new Set([10, 20]));
    expect(host.requestRender).toHaveBeenCalled();
  });
});
