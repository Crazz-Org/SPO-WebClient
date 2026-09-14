/**
 * Tests for the renderer's optimistic pending-placement placeholders (#604):
 * addPendingPlacement/removePendingPlacement delegation and the drawPendingPlacements
 * draw pass. Same prototype `.call()` harness as renderer-losing-tint.test.ts — the
 * monolith is too heavy to instantiate in jsdom.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import { PendingPlacementLayer } from './pending-placement-layer';

// Fake timers so every layer's 210s TTL setTimeout is disposed of at teardown
// instead of leaking a real timer past the end of the test.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

type Ctx = {
  drawImage: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  closePath: jest.Mock;
  stroke: jest.Mock;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  globalAlpha: number;
  filter: string;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  pendingPlacements: PendingPlacementLayer;
  gameObjectTextureCache: { getTextureSync: jest.Mock };
  loadFallbackIcon: jest.Mock;
  drawExteriorTileEdges: jest.Mock;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const TEX = { width: 64, height: 64 };

function makeCtx(): Ctx {
  return {
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    globalAlpha: 1,
    filter: 'none',
  };
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
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
    pendingPlacements: new PendingPlacementLayer(jest.fn()),
    gameObjectTextureCache: { getTextureSync: jest.fn(() => TEX) },
    loadFallbackIcon: jest.fn(() => null),
    drawExteriorTileEdges: jest.fn(),
    requestRender: jest.fn(),
    ...overrides,
  };
}

function drawPendingPlacements(host: Host): void {
  (proto.drawPendingPlacements as (this: Host) => void).call(host);
}

describe('addPendingPlacement / removePendingPlacement', () => {
  it('delegates to the layer, returns its key, and repaints', () => {
    const host = { pendingPlacements: new PendingPlacementLayer(jest.fn()) };
    const key = (proto.addPendingPlacement as (
      this: typeof host, x: number, y: number, xsize: number, ysize: number, visualClass: string, fallbackIconUrl?: string
    ) => string).call(host, 10, 20, 2, 2, '123', 'icon.gif');
    expect(key).toBe('10,20');
    expect(host.pendingPlacements.has(key)).toBe(true);
  });

  it('remove delegates to the layer', () => {
    const layer = new PendingPlacementLayer(jest.fn());
    const key = layer.add({ x: 1, y: 1, xsize: 1, ysize: 1, visualClass: '1' });
    const host = { pendingPlacements: layer };
    (proto.removePendingPlacement as (this: typeof host, key: string) => void).call(host, key);
    expect(layer.has(key)).toBe(false);
  });
});

describe('drawPendingPlacements', () => {
  it('does nothing when there are no pending placements', () => {
    const host = makeHost();
    drawPendingPlacements(host);
    expect(host.ctx.drawImage).not.toHaveBeenCalled();
    expect(host.drawExteriorTileEdges).not.toHaveBeenCalled();
  });

  it('draws one greyed drawImage per entry, sets and restores filter/alpha, and strokes the footprint', () => {
    const host = makeHost();
    host.pendingPlacements.add({ x: 5, y: 5, xsize: 2, ysize: 2, visualClass: '123' });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(host.ctx.drawImage).toHaveBeenCalledWith(TEX, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
    // filter/alpha are set inside a save/restore bracket, and restored back afterward
    // save/restore bracket the filter/alpha changes so they never leak into later draw calls
    expect(host.ctx.save).toHaveBeenCalled();
    expect(host.ctx.restore).toHaveBeenCalled();
    expect(host.ctx.save.mock.calls.length).toBe(host.ctx.restore.mock.calls.length);
    expect(host.drawExteriorTileEdges).toHaveBeenCalledTimes(1);
    expect(host.drawExteriorTileEdges).toHaveBeenCalledWith(
      expect.objectContaining({ x: 5, y: 5, visualClass: '123' }),
      2, 2, expect.anything(), expect.any(Number), expect.any(Number),
    );
  });

  it('uses the fallback icon when no CLASSES.BIN texture is loaded', () => {
    const host = makeHost({ gameObjectTextureCache: { getTextureSync: jest.fn(() => null) } });
    const FALLBACK = { width: 32, height: 32 };
    host.loadFallbackIcon = jest.fn(() => FALLBACK) as unknown as jest.Mock;
    host.pendingPlacements.add({ x: 1, y: 1, xsize: 1, ysize: 1, visualClass: 'nope', fallbackIconUrl: 'icon.gif' });

    drawPendingPlacements(host);

    expect(host.loadFallbackIcon).toHaveBeenCalledWith('icon.gif');
    expect(host.ctx.drawImage).toHaveBeenCalledWith(FALLBACK, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });

  it('still strokes the footprint when neither texture nor fallback icon is available', () => {
    const host = makeHost({ gameObjectTextureCache: { getTextureSync: jest.fn(() => null) } });
    host.pendingPlacements.add({ x: 1, y: 1, xsize: 1, ysize: 1, visualClass: 'nope' });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).not.toHaveBeenCalled();
    expect(host.drawExteriorTileEdges).toHaveBeenCalledTimes(1);
  });

  it('culls an entry that is fully off-canvas', () => {
    const host = makeHost({
      terrainRenderer: {
        getZoomLevel: () => 3,
        getRotation: () => Rotation.NORTH,
        mapToScreen: () => ({ x: -10000, y: -10000 }),
      },
    });
    host.pendingPlacements.add({ x: 9, y: 9, xsize: 1, ysize: 1, visualClass: '123' });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).not.toHaveBeenCalled();
    // The footprint stroke still runs — it is a cheap outline, not gated by the texture cull.
    expect(host.drawExteriorTileEdges).toHaveBeenCalledTimes(1);
  });

  it('draws every entry in insertion order for multiple pending placements', () => {
    const host = makeHost();
    host.pendingPlacements.add({ x: 1, y: 1, xsize: 1, ysize: 1, visualClass: 'a' });
    host.pendingPlacements.add({ x: 2, y: 2, xsize: 1, ysize: 1, visualClass: 'b' });

    drawPendingPlacements(host);

    expect(host.ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(host.drawExteriorTileEdges).toHaveBeenCalledTimes(2);
  });

  it.each([Rotation.EAST, Rotation.SOUTH, Rotation.WEST])(
    'anchors correctly under rotation %s, same switch as drawBuildings',
    (rotation) => {
      const host = makeHost({
        terrainRenderer: { getZoomLevel: () => 3, getRotation: () => rotation, mapToScreen: centeredMapToScreen },
      });
      host.pendingPlacements.add({ x: 3, y: 4, xsize: 2, ysize: 2, visualClass: '123' });

      drawPendingPlacements(host);

      expect(host.ctx.drawImage).toHaveBeenCalledTimes(1);
      expect(host.drawExteriorTileEdges).toHaveBeenCalledTimes(1);
    },
  );
});
