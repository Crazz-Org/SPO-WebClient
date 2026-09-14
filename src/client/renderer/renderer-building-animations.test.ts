/**
 * Tests for the renderer's building-animation switch (drawBuildings animated-frame pick /
 * setBuildingAnimationsEnabled). The monolith is too heavy to instantiate in jsdom, so these
 * private/public methods are exercised via prototype `.call()` with a crafted host — same
 * pattern as renderer-glass-buildings.test.ts in this directory.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding } from '../../shared/types/domain-types';
import type { AnimatedTexture } from './game-object-texture-cache';

type Bitmap = { width: number; height: number };

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
  facilityDimensionsCache: Map<string, { xsize: number; ysize: number }>;
  hoveredBuilding: MapBuilding | null;
  selectedBuilding: MapBuilding | null;
  buildingEffects: Map<string, unknown>;
  hasAnimatedBuildings: boolean;
  isOnWaterPlatform: () => boolean;
  gameObjectTextureCache: {
    getTextureSync: jest.Mock<(category: string, name: string) => Bitmap | null>;
    getAnimatedTexture: jest.Mock<(category: string, name: string) => AnimatedTexture | null>;
    getAnimatedFrame: jest.Mock<(animatedTexture: AnimatedTexture, elapsedMs: number) => Bitmap>;
  };
  glassForeignBuildings: boolean;
  ownTycoonId: number;
  buildingAnimations: boolean;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const staticFrame: Bitmap = { width: 64, height: 64 };
const animFrame: Bitmap = { width: 64, height: 64 };
const animatedTexture = { totalDuration: 1000 } as unknown as AnimatedTexture;

function makeCtx(): Ctx {
  const drawn: Bitmap[] = [];
  const ctx: Ctx = {
    drawImage: jest.fn((img: unknown) => { drawn.push(img as Bitmap); }),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
  (ctx as unknown as { drawn: Bitmap[] }).drawn = drawn;
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(tycoonId: number, x: number, y: number): MapBuilding {
  return { visualClass: 'house', tycoonId, options: 0, x, y, level: 0, alert: false, attack: 0 };
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
      getTextureSync: jest.fn(() => staticFrame),
      getAnimatedTexture: jest.fn(() => animatedTexture),
      getAnimatedFrame: jest.fn(() => animFrame),
    },
    glassForeignBuildings: false,
    ownTycoonId: 0,
    buildingAnimations: true,
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function drawn(host: Host): Bitmap[] {
  return (host.ctx as unknown as { drawn: Bitmap[] }).drawn;
}

describe('drawBuildings — building animation switch', () => {
  it('draws the animated frame and raises hasAnimatedBuildings when the option is on', () => {
    const host = makeHost({
      allBuildings: [makeBuilding(1, 1, 1)],
      buildingAnimations: true,
    });
    drawBuildings(host);
    expect(host.gameObjectTextureCache.getAnimatedFrame).toHaveBeenCalledWith(animatedTexture, expect.any(Number));
    expect(drawn(host)).toEqual([animFrame]);
    expect(host.hasAnimatedBuildings).toBe(true);
  });

  it('draws the static frame and leaves hasAnimatedBuildings false when the option is off', () => {
    const host = makeHost({
      allBuildings: [makeBuilding(1, 1, 1)],
      buildingAnimations: false,
    });
    drawBuildings(host);
    expect(host.gameObjectTextureCache.getAnimatedFrame).not.toHaveBeenCalled();
    expect(drawn(host)).toEqual([staticFrame]);
    expect(host.hasAnimatedBuildings).toBe(false);
  });
});

describe('setBuildingAnimationsEnabled', () => {
  function call(host: Partial<Host>, method: string, ...args: unknown[]): void {
    (proto[method] as (this: unknown, ...a: unknown[]) => void).apply(host, args);
  }

  it('turns off, then back on, each time requesting a render', () => {
    const host: { buildingAnimations?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setBuildingAnimationsEnabled', false);
    expect(host.buildingAnimations).toBe(false);
    expect(host.requestRender).toHaveBeenCalledTimes(1);

    call(host as unknown as Partial<Host>, 'setBuildingAnimationsEnabled', true);
    expect(host.buildingAnimations).toBe(true);
    expect(host.requestRender).toHaveBeenCalledTimes(2);
  });
});
