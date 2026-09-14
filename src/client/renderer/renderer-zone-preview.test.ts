/**
 * Tests for drawZonePaintingPreview's per-tile exclusion fill and honest tooltip.
 * Same prototype `.call()` harness as renderer-losing-tint.test.ts — the monolith
 * is too heavy to instantiate in jsdom.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { MapBuilding } from '../../shared/types/domain-types';

type Ctx = {
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  closePath: jest.Mock;
  fill: jest.Mock;
  stroke: jest.Mock;
  strokeText: jest.Mock;
  fillText: jest.Mock;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  zonePaintingMode: boolean;
  zonePaintingType: number;
  zonePaintingState: { isDrawing: boolean; startX: number; startY: number; endX: number; endY: number };
  mouseHasEnteredCanvas: boolean;
  mouseMapI: number;
  mouseMapJ: number;
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, { xsize: number; ysize: number }>;
  roadTilesMap: Map<string, boolean>;
  hasRoadAt: (x: number, y: number) => boolean;
  zoneBuildingFootprints: () => Array<{ x: number; y: number; w: number; h: number }>;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(fillStyleLog: string[]): Ctx {
  const ctx: Ctx = {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(() => fillStyleLog.push(ctx.fillStyle)),
    stroke: jest.fn(),
    strokeText: jest.fn(),
    fillText: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
  };
  return ctx;
}

function makeHost(fillStyleLog: string[], overrides: Partial<Host> = {}): Host {
  const host: Host = {
    ctx: makeCtx(fillStyleLog),
    terrainRenderer: {
      getZoomLevel: () => 2,
      mapToScreen: (i: number, j: number) => ({ x: 400 + j * 10, y: 300 + i * 10 }),
    },
    zonePaintingMode: true,
    zonePaintingType: 6, // Industrial — inside 1..9, subject to exclusions
    zonePaintingState: { isDrawing: true, startX: 0, startY: 0, endX: 1, endY: 0 },
    mouseHasEnteredCanvas: true,
    mouseMapI: 0,
    mouseMapJ: 0,
    allBuildings: [],
    facilityDimensionsCache: new Map(),
    roadTilesMap: new Map(),
    hasRoadAt: (x, y) => host.roadTilesMap.has(`${x},${y}`),
    // The real prototype method, not a re-implementation — keeps its own lines covered.
    zoneBuildingFootprints: () =>
      (proto.zoneBuildingFootprints as (this: Host) => Array<{ x: number; y: number; w: number; h: number }>).call(
        host,
      ),
    ...overrides,
  };
  return host;
}

function draw(host: Host): void {
  (proto.drawZonePaintingPreview as (this: Host) => void).call(host);
}

const ZONE_TINT = 'rgba(215,217,136,0.4)'; // Industrial overlay at painting alpha
const EXCLUDED = 'rgba(200,40,40,0.45)';

describe('drawZonePaintingPreview — drag rectangle exclusions', () => {
  it('tints a road-served empty tile with the zone color', () => {
    const fillStyleLog: string[] = [];
    const roadTilesMap = new Map<string, boolean>();
    roadTilesMap.set('0,0', true);
    roadTilesMap.set('1,0', true);
    const host = makeHost(fillStyleLog, { roadTilesMap });
    draw(host);
    expect(fillStyleLog).toEqual([ZONE_TINT, ZONE_TINT]);
  });

  it('marks a built tile red instead of the zone tint', () => {
    const fillStyleLog: string[] = [];
    const roadTilesMap = new Map<string, boolean>();
    roadTilesMap.set('0,0', true);
    roadTilesMap.set('1,0', true);
    const host = makeHost(fillStyleLog, {
      roadTilesMap,
      allBuildings: [{ visualClass: 'house', tycoonId: 1, options: 0, x: 1, y: 0, level: 0, alert: false, attack: 0 }],
      facilityDimensionsCache: new Map([['house', { xsize: 1, ysize: 1 }]]),
    });
    draw(host);
    expect(fillStyleLog).toEqual([ZONE_TINT, EXCLUDED]);
  });

  it('marks a road-starved tile red instead of the zone tint', () => {
    const fillStyleLog: string[] = [];
    const host = makeHost(fillStyleLog, { roadTilesMap: new Map() });
    draw(host);
    expect(fillStyleLog).toEqual([EXCLUDED, EXCLUDED]);
  });

  it('a zone-0 (erase) drag tints every tile regardless of roads or buildings', () => {
    const fillStyleLog: string[] = [];
    const host = makeHost(fillStyleLog, {
      zonePaintingType: 0,
      roadTilesMap: new Map(),
      allBuildings: [{ visualClass: 'house', tycoonId: 1, options: 0, x: 0, y: 0, level: 0, alert: false, attack: 0 }],
      facilityDimensionsCache: new Map([['house', { xsize: 1, ysize: 1 }]]),
    });
    draw(host);
    const eraseTint = 'rgba(89,89,89,0.4)';
    expect(fillStyleLog).toEqual([eraseTint, eraseTint]);
  });

  it('tooltip reports "N of M tiles" when something is excluded', () => {
    const fillStyleLog: string[] = [];
    const host = makeHost(fillStyleLog, { roadTilesMap: new Map() });
    draw(host);
    expect(host.ctx.fillText).toHaveBeenCalledWith('0 of 2 tiles', expect.any(Number), expect.any(Number));
  });

  it('tooltip reports "M tiles" when nothing is excluded', () => {
    const fillStyleLog: string[] = [];
    const roadTilesMap = new Map<string, boolean>();
    roadTilesMap.set('0,0', true);
    roadTilesMap.set('1,0', true);
    const host = makeHost(fillStyleLog, { roadTilesMap });
    draw(host);
    expect(host.ctx.fillText).toHaveBeenCalledWith('2 tiles', expect.any(Number), expect.any(Number));
  });

  it('the hover branch (not drawing) is unchanged — no exclusion mask, no tooltip', () => {
    const fillStyleLog: string[] = [];
    const host = makeHost(fillStyleLog, {
      zonePaintingState: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 },
      roadTilesMap: new Map(),
    });
    draw(host);
    expect(fillStyleLog).toEqual(['rgba(215,217,136,0.4)']);
    expect(host.ctx.stroke).toHaveBeenCalled();
    expect(host.ctx.fillText).not.toHaveBeenCalled();
  });
});
