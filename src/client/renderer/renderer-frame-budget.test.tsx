/**
 * Frame-budget assertions for the renderer — the first in the suite: work that must happen
 * once, not once per frame. Runs in jsdom (component project) so the tint scratch canvases
 * are real <canvas> elements, created by the production code itself; only getContext is
 * stubbed, so each canvas's drawImage calls can be counted.
 *
 * Same prototype `.call()` harness as renderer-losing-tint.test.ts — the monolith is too
 * heavy to instantiate here.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding } from '../../shared/types/domain-types';

type FakeCtx2D = {
  drawImage: jest.Mock;
  clearRect: jest.Mock;
  fillRect: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  scale: jest.Mock;
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: string;
};

function makeCtx(): FakeCtx2D {
  return {
    drawImage: jest.fn(),
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
}

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function makeBuilding(x: number, y: number, visualClass = 'house'): MapBuilding {
  return { visualClass, tycoonId: 7, options: 0, x, y, level: 0, alert: true, attack: 0 };
}

function makeHost(buildings: MapBuilding[], textureFor: (file: string) => unknown) {
  return {
    ctx: makeCtx(),
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: (i: number, j: number) => ({ x: 400 + j * 10, y: 300 + i * 10 }),
    },
    canvas: { width: 800, height: 600 },
    allBuildings: buildings,
    facilityDimensionsCache: new Map(),
    hoveredBuilding: null,
    selectedBuilding: null,
    buildingEffects: new Map(),
    hasAnimatedBuildings: false,
    isOnWaterPlatform: () => false,
    gameObjectTextureCache: {
      getTextureSync: (_kind: string, file: string) => textureFor(file),
      getAnimatedTexture: () => null,
    },
    glassForeignBuildings: false,
    buildingAnimations: true,
    ownTycoonId: 7,
    signalLosingFacilities: true,
    hiddenFacIds: new Set<number>(),
    reddenTexture: proto.reddenTexture,
    footprintAnchor: proto.footprintAnchor,
    losingScratch: null,
    requestRender: jest.fn(),
  };
}

type Host = ReturnType<typeof makeHost>;

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

describe('renderer frame budget — losing-facility tint', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  let tintCtxs: Map<HTMLCanvasElement, FakeCtx2D>;

  const tintDrawImageCount = () =>
    Array.from(tintCtxs.values()).reduce((n, c) => n + c.drawImage.mock.calls.length, 0);

  beforeEach(() => {
    tintCtxs = new Map();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      let c = tintCtxs.get(this);
      if (!c) {
        c = makeCtx();
        tintCtxs.set(this, c);
      }
      return c;
    } as never;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  it('composes the red tint once: 0 tint drawImage calls on the second frame, the main canvas still draws every frame', () => {
    const texture = { width: 64, height: 64 };
    const host = makeHost([makeBuilding(1, 1)], () => texture);

    drawBuildings(host);
    expect(tintDrawImageCount()).toBe(1);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    const firstSprite = host.ctx.drawImage.mock.calls[0][0];
    expect(firstSprite).toBeInstanceOf(HTMLCanvasElement);
    expect(firstSprite).not.toBe(texture);

    tintCtxs.forEach(c => c.drawImage.mockClear());
    host.ctx.drawImage.mockClear();

    drawBuildings(host);
    expect(tintDrawImageCount()).toBe(0);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.ctx.drawImage.mock.calls[0][0]).toBe(firstSprite);
  });

  it('keeps one tinted canvas per source texture — two textures never alias', () => {
    const texA = { width: 64, height: 64 };
    const texB = { width: 32, height: 48 };
    // The first texture file asked for gets texA, any other gets texB — whatever the filename scheme.
    const files: string[] = [];
    const host = makeHost([makeBuilding(1, 1, '100'), makeBuilding(3, 3, '200')], (file) => {
      if (!files.includes(file)) files.push(file);
      return files.indexOf(file) === 0 ? texA : texB;
    });

    drawBuildings(host);
    const sprites = host.ctx.drawImage.mock.calls.map(c => c[0]);
    expect(sprites).toHaveLength(2);
    expect(sprites[0]).not.toBe(sprites[1]);
    expect(tintCtxs.size).toBe(2);
    expect(tintDrawImageCount()).toBe(2);
    // each tinted canvas holds its own source texture
    const drawnSources = Array.from(tintCtxs.values()).map(c => c.drawImage.mock.calls[0][0]);
    expect(new Set(drawnSources)).toEqual(new Set([texA, texB]));

    tintCtxs.forEach(c => c.drawImage.mockClear());
    host.ctx.drawImage.mockClear();
    drawBuildings(host);
    expect(tintDrawImageCount()).toBe(0);
    expect(host.ctx.drawImage.mock.calls.map(c => c[0])).toEqual(sprites);
  });
});
