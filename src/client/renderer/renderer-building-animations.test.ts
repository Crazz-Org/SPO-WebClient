/**
 * Tests for the renderer's building-animation gate (drawBuildings frame selection /
 * setBuildingAnimationsEnabled). The monolith is too heavy to instantiate in jsdom, so these
 * private/public methods are exercised via prototype `.call()` with a crafted host — same
 * pattern as renderer-glass-buildings.test.ts in this directory.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding } from '../../shared/types/domain-types';

type Bitmap = { width: number; height: number; tag: string };

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
  footprintAnchor: (...args: unknown[]) => unknown;
  gameObjectTextureCache: {
    getTextureSync: jest.Mock;
    getAnimatedTexture: jest.Mock;
    getAnimatedFrame: jest.Mock;
  };
  glassForeignBuildings: boolean;
  signalLosingFacilities: boolean;
  buildingAnimations: boolean;
  hiddenFacIds: ReadonlySet<number>;
  ownTycoonId: number;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const STATIC_BITMAP: Bitmap = { width: 64, height: 64, tag: 'static' };
const ANIMATED_FRAME: Bitmap = { width: 64, height: 64, tag: 'frame2' };

function makeCtx(): Ctx {
  return {
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(): MapBuilding {
  return { visualClass: 'house', tycoonId: 0, options: 0, x: 1, y: 1, level: 0, alert: false, attack: 0 };
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
    allBuildings: [makeBuilding()],
    facilityDimensionsCache: new Map(),
    hoveredBuilding: null,
    selectedBuilding: null,
    buildingEffects: new Map(),
    hasAnimatedBuildings: false,
    isOnWaterPlatform: () => false,
    footprintAnchor: proto.footprintAnchor,
    gameObjectTextureCache: {
      getTextureSync: jest.fn(() => STATIC_BITMAP),
      getAnimatedTexture: jest.fn(() => ({ frames: [], totalDuration: 100 })),
      getAnimatedFrame: jest.fn(() => ANIMATED_FRAME),
    },
    glassForeignBuildings: true,
    signalLosingFacilities: false,
    buildingAnimations: true,
    hiddenFacIds: new Set(),
    ownTycoonId: 0,
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

describe('drawBuildings — buildingAnimations gate', () => {
  it('draws the static frame and never calls getAnimatedFrame when animations are off', () => {
    const host = makeHost({ buildingAnimations: false });
    drawBuildings(host);

    expect(host.ctx.drawImage).toHaveBeenCalled();
    const sprite = (host.ctx.drawImage.mock.calls[0] as unknown[])[0];
    expect(sprite).toBe(STATIC_BITMAP);
    expect(host.gameObjectTextureCache.getAnimatedFrame).not.toHaveBeenCalled();
    expect(host.hasAnimatedBuildings).toBe(false);
  });

  it('draws the animated frame and sets hasAnimatedBuildings when animations are on', () => {
    const host = makeHost({ buildingAnimations: true });
    drawBuildings(host);

    expect(host.ctx.drawImage).toHaveBeenCalled();
    const sprite = (host.ctx.drawImage.mock.calls[0] as unknown[])[0];
    expect(sprite).toBe(ANIMATED_FRAME);
    expect(host.gameObjectTextureCache.getAnimatedFrame).toHaveBeenCalled();
    expect(host.hasAnimatedBuildings).toBe(true);
  });
});

describe('setBuildingAnimationsEnabled', () => {
  it('stores the flag and requests a render', () => {
    const host: { buildingAnimations?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    (proto.setBuildingAnimationsEnabled as (this: unknown, enabled: boolean) => void).call(host, false);
    expect(host.buildingAnimations).toBe(false);
    expect(host.requestRender).toHaveBeenCalled();
  });
});
