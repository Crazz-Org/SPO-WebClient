/**
 * `drawZonePaintingPreview` and `isWithinRoadReach` — the zone drag preview
 * does not tint a tile the server will skip (occupied by a building, or with
 * no road within reach), for zones 1..9; De-zone (0) always tints.
 *
 * Private methods are exercised via prototype `.call()` with a crafted `this`
 * (same pattern as renderer-input.test.ts / road-demolish-preview.test.ts).
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { ZOOM_LEVELS } from '../../shared/map-config';

const proto = IsometricMapRenderer.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

function createMockCtx() {
  return {
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 1,
    font: '',
    fillRect: jest.fn(),
    strokeText: jest.fn(),
    fillText: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
  };
}

interface FakeOptions {
  zoneType: number;
  isDrawing: boolean;
  startX?: number; startY?: number; endX?: number; endY?: number;
  mouseI?: number; mouseJ?: number;
  roadTiles?: Set<string>;
  buildingTiles?: Set<string>;
  zoomLevel?: number;
}

function buildFakeRenderer(opts: FakeOptions) {
  const mockCtx = createMockCtx();
  const zoomLevel = opts.zoomLevel ?? 2;
  const roadTiles = opts.roadTiles ?? new Set<string>();
  const buildingTiles = opts.buildingTiles ?? new Set<string>();

  const fakeThis = {
    zonePaintingMode: true,
    mouseHasEnteredCanvas: true,
    ctx: mockCtx,
    terrainRenderer: {
      getZoomLevel: () => zoomLevel,
      mapToScreen: (i: number, j: number) => ({ x: 400 + j * 10, y: 300 + i * 10 }),
    },
    zonePaintingType: opts.zoneType,
    zonePaintingState: {
      isDrawing: opts.isDrawing,
      startX: opts.startX ?? 0,
      startY: opts.startY ?? 0,
      endX: opts.endX ?? 0,
      endY: opts.endY ?? 0,
    },
    zonePreviewCache: null as { key: string; tiles: Array<{ x: number; y: number }> } | null,
    mouseMapI: opts.mouseI ?? 0,
    mouseMapJ: opts.mouseJ ?? 0,
    hasRoadAt: (x: number, y: number) => roadTiles.has(`${x},${y}`),
    isTileOccupiedByBuilding: (x: number, y: number) => buildingTiles.has(`${x},${y}`),
    isWithinRoadReach: proto.isWithinRoadReach,
    drawZonePaintingPreview: proto.drawZonePaintingPreview,
  };

  return { fakeThis, mockCtx };
}

describe('isWithinRoadReach', () => {
  it('a road exactly 7 tiles away (the tolerance) is in reach', () => {
    const { fakeThis } = buildFakeRenderer({ zoneType: 3, isDrawing: false, roadTiles: new Set(['7,0']) });
    expect(fakeThis.isWithinRoadReach.call(fakeThis, 0, 0)).toBe(true);
  });

  it('a road 8 tiles away is out of reach', () => {
    const { fakeThis } = buildFakeRenderer({ zoneType: 3, isDrawing: false, roadTiles: new Set(['8,0']) });
    expect(fakeThis.isWithinRoadReach.call(fakeThis, 0, 0)).toBe(false);
  });
});

describe('drawZonePaintingPreview — hover', () => {
  it('outlines but does not fill a zone-1..9 hover tile with no road in reach', () => {
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: false, mouseI: 0, mouseJ: 0,
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.stroke).toHaveBeenCalledTimes(1);
    expect(mockCtx.fill).not.toHaveBeenCalled();
  });

  it('fills a zone-1..9 hover tile that is clear and in road reach', () => {
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: false, mouseI: 0, mouseJ: 0, roadTiles: new Set(['0,0']),
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).toHaveBeenCalledTimes(1);
    expect(mockCtx.stroke).toHaveBeenCalledTimes(1);
  });

  it('does not fill a hover tile occupied by a building even with a road in reach', () => {
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: false, mouseI: 0, mouseJ: 0,
      roadTiles: new Set(['0,0']), buildingTiles: new Set(['0,0']),
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).not.toHaveBeenCalled();
  });

  it('zone 0 (de-zone) hover always fills, regardless of building/road facts', () => {
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 0, isDrawing: false, mouseI: 0, mouseJ: 0, buildingTiles: new Set(['0,0']),
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).toHaveBeenCalledTimes(1);
  });
});

describe('drawZonePaintingPreview — drag', () => {
  it('with no road anywhere near it, a zone 1..9 rectangle tints nothing', () => {
    // 3x3 rectangle (9 tiles), no roads at all — every tile fails the road-reach test.
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: true, startX: 0, startY: 0, endX: 2, endY: 2,
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).not.toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalledWith('0 tiles', expect.any(Number), expect.any(Number));
  });

  it('fill count equals the paintable-tile count, not the raw rectangle area', () => {
    // 3x3 rectangle (9 tiles) all within road reach of the one road tile, but
    // 8 of the 9 are occupied by a building — only the clear one is tinted.
    const buildingTiles = new Set(['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2']);
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: true, startX: 0, startY: 0, endX: 2, endY: 2,
      roadTiles: new Set(['1,1']), buildingTiles,
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).toHaveBeenCalledTimes(1);
    expect(mockCtx.fillText).toHaveBeenCalledWith('1 tiles', expect.any(Number), expect.any(Number));
  });

  it('zone 0 tints the whole rectangle', () => {
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 0, isDrawing: true, startX: 0, startY: 0, endX: 2, endY: 2,
      buildingTiles: new Set(['0,0', '1,1', '2,2']),
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(mockCtx.fill).toHaveBeenCalledTimes(9);
    expect(mockCtx.fillText).toHaveBeenCalledWith('9 tiles', expect.any(Number), expect.any(Number));
  });

  it('the cache is not recomputed when the key is unchanged', () => {
    // 2x2 rectangle, only (0,0) clear and in road reach — the other three occupied.
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 3, isDrawing: true, startX: 0, startY: 0, endX: 1, endY: 1,
      roadTiles: new Set(['0,0']),
      buildingTiles: new Set(['1,0', '0,1', '1,1']),
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    const firstCache = fakeThis.zonePreviewCache;
    expect(firstCache).not.toBeNull();

    mockCtx.fill.mockClear();
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    expect(fakeThis.zonePreviewCache).toBe(firstCache); // same object — not recomputed
    expect(mockCtx.fill).toHaveBeenCalledTimes(1); // still just (0,0)
  });

  it('draws diamonds at screen coordinates from mapToScreen(y, x)', () => {
    const zoomLevel = 2;
    const config = ZOOM_LEVELS[zoomLevel];
    const halfWidth = config.tileWidth / 2;
    const { fakeThis, mockCtx } = buildFakeRenderer({
      zoneType: 0, isDrawing: true, startX: 5, startY: 5, endX: 5, endY: 5, zoomLevel,
    });
    fakeThis.drawZonePaintingPreview.call(fakeThis);
    // mapToScreen(5, 5) => { x: 400 + 5*10, y: 300 + 5*10 } = { x: 450, y: 350 }
    expect(mockCtx.moveTo).toHaveBeenCalledWith(450, 350);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(450 - halfWidth, 350 + config.tileHeight / 2);
  });
});
