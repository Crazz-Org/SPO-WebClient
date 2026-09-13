/**
 * Tests for the fog-of-war layer (drawFog / isTileExplored / setExploredBlocks / the mark on
 * addCachedZone). Same prototype-`.call()` harness as renderer-losing-tint.test.ts.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { ExploredBlocks } from '../store/explored-blocks';
import type { TileBounds } from '../../shared/map-config';

type Ctx = {
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  closePath: jest.Mock;
  fill: jest.Mock;
  fillStyle: string;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  return {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    fillStyle: '',
  };
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: j * 10, y: i * 10 };
}

function drawFog(host: unknown, bounds: TileBounds): void {
  (proto.drawFog as (this: unknown, b: TileBounds) => void).call(host, bounds);
}

const BOUNDS: TileBounds = { minI: 0, maxI: 127, minJ: 0, maxJ: 127 };

describe('drawFog', () => {
  it('fills one polygon per unexplored 64-tile block over 128x128 bounds', () => {
    const ctx = makeCtx();
    const host = {
      ctx,
      exploredBlocks: new ExploredBlocks('k'),
      terrainRenderer: { mapToScreen: centeredMapToScreen },
      getMapDimensions: () => ({ width: 256, height: 256 }),
    };
    drawFog(host, BOUNDS);
    expect(ctx.fill).toHaveBeenCalledTimes(4);
    expect(ctx.fillStyle).toBe('rgba(0, 0, 0, 0.55)');
  });

  it('stops fogging a block once addCachedZone marks it', () => {
    const ctx = makeCtx();
    const host: Record<string, unknown> = {
      ctx,
      exploredBlocks: new ExploredBlocks('k'),
      terrainRenderer: { mapToScreen: centeredMapToScreen },
      getMapDimensions: () => ({ width: 256, height: 256 }),
      cachedZones: new Map(),
      zoneRequestManager: null,
      rebuildAggregatedData: jest.fn(),
      fetchDimensionsForBuildings: jest.fn(),
      invalidateGroundCache: jest.fn(),
      requestRender: jest.fn(),
    };

    expect((proto.isTileExplored as (this: unknown, x: number, y: number) => boolean).call(host, 70, 70)).toBe(false);

    (proto.addCachedZone as (this: unknown, x: number, y: number, w: number, h: number, b: unknown[], s: unknown[]) => void)
      .call(host, 64, 64, 64, 64, [], []);

    expect((proto.isTileExplored as (this: unknown, x: number, y: number) => boolean).call(host, 70, 70)).toBe(true);
    expect((host.exploredBlocks as ExploredBlocks).size).toBe(1);

    drawFog(host, BOUNDS);
    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it('fogs nothing when no set is attached', () => {
    const ctx = makeCtx();
    const host = {
      ctx,
      exploredBlocks: null,
      terrainRenderer: { mapToScreen: centeredMapToScreen },
      getMapDimensions: () => ({ width: 256, height: 256 }),
    };
    drawFog(host, BOUNDS);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect((proto.isTileExplored as (this: unknown, x: number, y: number) => boolean).call(host, 70, 70)).toBe(true);
  });

  it('clips a block on the map edge to the map dimensions', () => {
    const ctx = makeCtx();
    const calls: Array<[number, number]> = [];
    const host = {
      ctx,
      exploredBlocks: new ExploredBlocks('k'),
      terrainRenderer: {
        mapToScreen: (i: number, j: number) => {
          calls.push([i, j]);
          return centeredMapToScreen(i, j);
        },
      },
      getMapDimensions: () => ({ width: 256, height: 256 }),
    };
    drawFog(host, { minI: 0, maxI: 320, minJ: 0, maxJ: 320 });
    for (const [i, j] of calls) {
      expect(i).toBeLessThanOrEqual(256);
      expect(j).toBeLessThanOrEqual(256);
    }
  });
});

describe('setExploredBlocks', () => {
  it('attaches the set and requests a render', () => {
    const host: { exploredBlocks?: ExploredBlocks | null; requestRender: jest.Mock } = { requestRender: jest.fn() };
    const blocks = new ExploredBlocks('k');
    (proto.setExploredBlocks as (this: unknown, b: ExploredBlocks | null) => void).call(host, blocks);
    expect(host.exploredBlocks).toBe(blocks);
    expect(host.requestRender).toHaveBeenCalled();
  });
});
