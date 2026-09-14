/**
 * Tests for the renderer's pending-placement pass (drawPendingPlacements / greyTexture).
 * Same prototype `.call()` harness as renderer-losing-tint.test.ts — the monolith is too
 * heavy to instantiate in jsdom.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import { PendingPlacementLayer } from './pending-placements';
import type { MapBuilding } from '../../shared/types/domain-types';

type Ctx = {
  drawImage: jest.Mock;
  globalAlpha: number;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  allBuildings: MapBuilding[];
  gameObjectTextureCache: { getTextureSync: () => unknown };
  loadFallbackIcon: jest.Mock;
  greyTexture: jest.Mock;
  pendingPlacements: PendingPlacementLayer;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const TEX = { width: 64, height: 64 };
const GREYED = { greyed: true };
const FALLBACK = { width: 32, height: 32 };

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    ctx: { drawImage: jest.fn(), globalAlpha: 1 },
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: centeredMapToScreen,
    },
    allBuildings: [],
    gameObjectTextureCache: { getTextureSync: () => TEX },
    loadFallbackIcon: jest.fn(() => null),
    greyTexture: jest.fn(() => GREYED),
    pendingPlacements: new PendingPlacementLayer(),
    ...overrides,
  };
}

function drawPendingPlacements(host: Host): void {
  (proto.drawPendingPlacements as (this: Host) => void).call(host);
}

describe('drawPendingPlacements', () => {
  it('draws nothing for an empty layer', () => {
    const host = makeHost();
    drawPendingPlacements(host);
    expect(host.ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws exactly one greyed sprite at the south-corner anchor, at the pending alpha', () => {
    const host = makeHost();
    host.pendingPlacements.add({ x: 5, y: 5, visualClass: 'house', xsize: 1, ysize: 1, startedAt: Date.now() });

    drawPendingPlacements(host);

    expect(host.greyTexture).toHaveBeenCalledWith(TEX);
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.ctx.drawImage.mock.calls[0][0]).toBe(GREYED);
    expect(host.ctx.globalAlpha).toBe(1); // reset after drawing
  });

  it('drops and removes a pending entry whose tile a real building already covers', () => {
    const host = makeHost({
      allBuildings: [{ visualClass: 'house', tycoonId: 1, options: 0, x: 5, y: 5, level: 0, alert: false, attack: 0 }],
    });
    host.pendingPlacements.add({ x: 5, y: 5, visualClass: 'house', xsize: 1, ysize: 1, startedAt: Date.now() });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).not.toHaveBeenCalled();
    expect(host.pendingPlacements.size).toBe(0);
  });

  it('draws nothing when there is no texture and no fallback icon', () => {
    const host = makeHost({ gameObjectTextureCache: { getTextureSync: () => null } });
    host.pendingPlacements.add({ x: 5, y: 5, visualClass: 'house', xsize: 1, ysize: 1, startedAt: Date.now() });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws the fallback icon untinted when there is no texture', () => {
    const host = makeHost({
      gameObjectTextureCache: { getTextureSync: () => null },
      loadFallbackIcon: jest.fn(() => FALLBACK),
    });
    host.pendingPlacements.add({ x: 5, y: 5, visualClass: 'house', xsize: 1, ysize: 1, fallbackIconUrl: 'icon.png', startedAt: Date.now() });

    drawPendingPlacements(host);

    expect(host.greyTexture).not.toHaveBeenCalled();
    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.ctx.drawImage.mock.calls[0][0]).toBe(FALLBACK);
  });

  it.each([Rotation.NORTH, Rotation.EAST, Rotation.SOUTH, Rotation.WEST])(
    'draws the anchor for rotation %s without throwing',
    (rotation) => {
      const host = makeHost({
        terrainRenderer: {
          getZoomLevel: () => 3,
          getRotation: () => rotation,
          mapToScreen: centeredMapToScreen,
        },
      });
      host.pendingPlacements.add({ x: 5, y: 5, visualClass: 'house', xsize: 2, ysize: 3, startedAt: Date.now() });

      drawPendingPlacements(host);

      expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    },
  );
});

describe('addPendingPlacement / removePendingPlacement / getPendingPlacements', () => {
  function makeApiHost() {
    return {
      pendingPlacements: new PendingPlacementLayer(),
      requestRender: jest.fn(),
    };
  }

  it('addPendingPlacement stores the entry, requests a render, and returns its key', () => {
    const host = makeApiHost();
    const key = (proto.addPendingPlacement as (this: typeof host, p: unknown) => string).call(
      host,
      { x: 1, y: 2, visualClass: 'house', xsize: 1, ysize: 1, startedAt: Date.now() },
    );
    expect(key).toBe('1,2');
    expect(host.pendingPlacements.size).toBe(1);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('removePendingPlacement clears a known key and requests a render, and no-ops for an unknown one', () => {
    const host = makeApiHost();
    host.pendingPlacements.add({ x: 1, y: 2, visualClass: 'house', xsize: 1, ysize: 1, startedAt: Date.now() });
    host.requestRender.mockClear();

    const removed = (proto.removePendingPlacement as (this: typeof host, key: string) => boolean).call(host, '1,2');
    expect(removed).toBe(true);
    expect(host.pendingPlacements.size).toBe(0);
    expect(host.requestRender).toHaveBeenCalled();

    host.requestRender.mockClear();
    const removedAgain = (proto.removePendingPlacement as (this: typeof host, key: string) => boolean).call(host, '1,2');
    expect(removedAgain).toBe(false);
    expect(host.requestRender).not.toHaveBeenCalled();
  });

  it('getPendingPlacements reads through to the layer at the given time', () => {
    const host = makeApiHost();
    host.pendingPlacements.add({ x: 1, y: 2, visualClass: 'house', xsize: 1, ysize: 1, startedAt: 100 });
    const result = (proto.getPendingPlacements as (this: typeof host, now: number) => unknown[]).call(host, 100);
    expect(result).toHaveLength(1);
  });
});

describe('greyTexture', () => {
  type FakeCtx = {
    ops: Array<{ op: string; composite: string; fillStyle?: string }>;
    globalCompositeOperation: string;
    fillStyle: string;
    clearRect: jest.Mock;
    drawImage: jest.Mock;
    fillRect: jest.Mock;
  };

  function makeFakeSctx(): FakeCtx {
    const ops: FakeCtx['ops'] = [];
    const sctx: FakeCtx = {
      ops,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      clearRect: jest.fn(() => ops.push({ op: 'clearRect', composite: sctx.globalCompositeOperation })),
      drawImage: jest.fn(() => ops.push({ op: 'drawImage', composite: sctx.globalCompositeOperation })),
      fillRect: jest.fn(() =>
        ops.push({ op: 'fillRect', composite: sctx.globalCompositeOperation, fillStyle: sctx.fillStyle }),
      ),
    };
    return sctx;
  }

  function makeFakeCanvas(sctx: FakeCtx | null, width = 0, height = 0) {
    return {
      width,
      height,
      getContext: jest.fn(() => sctx),
    };
  }

  it('composes the tint under source-atop and returns the scratch canvas', () => {
    const sctx = makeFakeSctx();
    const fakeCanvas = makeFakeCanvas(sctx);
    const host = { pendingScratch: fakeCanvas };
    const texture = { width: 32, height: 48 } as unknown as ImageBitmap;

    const result = (proto.greyTexture as (this: unknown, t: ImageBitmap) => unknown).call(host, texture);

    expect(fakeCanvas.width).toBe(32);
    expect(fakeCanvas.height).toBe(48);
    expect(sctx.ops).toEqual([
      { op: 'clearRect', composite: 'source-over' },
      { op: 'drawImage', composite: 'source-over' },
      { op: 'fillRect', composite: 'source-atop', fillStyle: 'rgba(150, 150, 160, 0.55)' },
    ]);
    expect(sctx.globalCompositeOperation).toBe('source-over');
    expect(result).toBe(fakeCanvas);
  });

  it('returns the texture unchanged when no 2D context can be had', () => {
    const fakeCanvas = makeFakeCanvas(null);
    const host = { pendingScratch: fakeCanvas };
    const texture = { width: 10, height: 10 } as unknown as ImageBitmap;

    const result = (proto.greyTexture as (this: unknown, t: ImageBitmap) => unknown).call(host, texture);

    expect(result).toBe(texture);
  });

  it('lazily creates the scratch canvas on first use', () => {
    const sctx = makeFakeSctx();
    const fakeCanvas = makeFakeCanvas(sctx);
    const createElement = jest.fn((_tag: string) => fakeCanvas);
    const originalDocument = (globalThis as { document?: unknown }).document;
    Object.assign(globalThis, { document: { createElement } });
    try {
      const host: { pendingScratch: unknown } = { pendingScratch: null };
      const texture = { width: 16, height: 16 } as unknown as ImageBitmap;

      const result = (proto.greyTexture as (this: typeof host, t: ImageBitmap) => unknown).call(host, texture);

      expect(createElement).toHaveBeenCalledWith('canvas');
      expect(host.pendingScratch).toBe(fakeCanvas);
      expect(result).toBe(fakeCanvas);
    } finally {
      Object.assign(globalThis, { document: originalDocument });
    }
  });
});
