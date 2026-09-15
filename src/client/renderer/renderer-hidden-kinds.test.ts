/**
 * L0 unit test for task 598: the renderer skips exactly the buildings whose class maps to a
 * hidden `facId`, and never hides an unknown class by accident. Same prototype `.call()` harness
 * as renderer-glass-buildings.test.ts — the monolith is too heavy for jsdom.
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

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, { xsize: number; ysize: number; facId?: number }>;
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
  /** `drawBuildings`/`getBuildingAt` call `this.isFacilityKindHidden(...)`; a plain host
   *  object needs its own copy, forwarded to the real prototype method under test. */
  isFacilityKindHidden: (visualClass: string) => boolean;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const drawnClasses: string[] = [];
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
  (ctx as unknown as { drawnClasses: string[] }).drawnClasses = drawnClasses;
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(visualClass: string, x: number, y: number): MapBuilding {
  return { visualClass, tycoonId: 1, options: 0, x, y, level: 0, alert: false, attack: 0 };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  const host: Host = {
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
    isFacilityKindHidden: () => false,
    requestRender: jest.fn(),
    ...overrides,
  };
  host.isFacilityKindHidden = (visualClass) =>
    (proto.isFacilityKindHidden as (this: Host, vc: string) => boolean).call(host, visualClass);
  return host;
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function isFacilityKindHidden(host: Host, visualClass: string): boolean {
  return (proto.isFacilityKindHidden as (this: Host, visualClass: string) => boolean).call(host, visualClass);
}

describe('drawBuildings — hidden facility kinds', () => {
  it('skips exactly the building whose class maps to a hidden facId', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1), makeBuilding('bank', 2, 2)],
      facilityDimensionsCache: new Map([
        ['farm', { xsize: 1, ysize: 1, facId: 40 }],
        ['bank', { xsize: 1, ysize: 1, facId: 110 }],
      ]),
      hiddenFacIds: new Set([40]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws a building whose class is absent from facilityDimensionsCache, whatever is hidden', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('unknown-class', 1, 1)],
      facilityDimensionsCache: new Map(),
      hiddenFacIds: new Set([40, 110]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws a building whose facId is 0 (FID_None is not a kind)', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('none-kind', 1, 1)],
      facilityDimensionsCache: new Map([['none-kind', { xsize: 1, ysize: 1, facId: 0 }]]),
      hiddenFacIds: new Set([0]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws a building whose facId is undefined', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('no-facid', 1, 1)],
      facilityDimensionsCache: new Map([['no-facid', { xsize: 1, ysize: 1 }]]),
      hiddenFacIds: new Set([40]),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws both buildings when the hidden set is empty (the no-op default)', () => {
    const host = makeHost({
      allBuildings: [makeBuilding('farm', 1, 1), makeBuilding('bank', 2, 2)],
      facilityDimensionsCache: new Map([
        ['farm', { xsize: 1, ysize: 1, facId: 40 }],
        ['bank', { xsize: 1, ysize: 1, facId: 110 }],
      ]),
      hiddenFacIds: new Set(),
    });
    drawBuildings(host);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(2);
  });
});

describe('isFacilityKindHidden', () => {
  it('is false for every visualClass when the hidden set is empty', () => {
    const host = makeHost({ hiddenFacIds: new Set() });
    expect(isFacilityKindHidden(host, 'farm')).toBe(false);
  });

  it('is true only for a class whose facId is in the hidden set', () => {
    const host = makeHost({
      facilityDimensionsCache: new Map([['farm', { xsize: 1, ysize: 1, facId: 40 }]]),
      hiddenFacIds: new Set([40]),
    });
    expect(isFacilityKindHidden(host, 'farm')).toBe(true);
    expect(isFacilityKindHidden(host, 'unknown')).toBe(false);
  });
});

describe('setHiddenFacIds', () => {
  function call(host: Partial<Host>, ...args: unknown[]): void {
    (proto.setHiddenFacIds as (this: unknown, ...a: unknown[]) => void).apply(host, args);
  }

  it('stores the hidden set and requests a render', () => {
    const host: { hiddenFacIds?: Set<number>; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, [40, 42]);
    expect(host.hiddenFacIds).toEqual(new Set([40, 42]));
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('maps a non-array (old/corrupt persisted blob) to an empty set', () => {
    const host: { hiddenFacIds?: Set<number>; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, undefined);
    expect(host.hiddenFacIds).toEqual(new Set());
  });
});
