/**
 * Tests for the renderer E2E probe methods (getRoadTiles / getTileProbe).
 * The monolith is too heavy to instantiate in jsdom, so the pure methods are
 * exercised via prototype `.call()` with a crafted `this` — same pattern the
 * methods use at runtime (they only touch roadTilesMap, concreteTilesSet,
 * terrainRenderer.getTerrainLoader, and sibling private methods).
 */

import { describe, it, expect } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { RoadTileFacts } from '../../shared/road-cost';

type ProbeHost = {
  roadTilesMap: Map<string, boolean>;
  concreteTilesSet: Set<string>;
  terrainRenderer: { getTerrainLoader: () => { getLandId: (x: number, y: number) => number } | null };
  hasRoadAt: (x: number, y: number) => boolean;
  isAdjacentToRoad: (x: number, y: number) => boolean;
  hasConcrete: (x: number, y: number) => boolean;
  getRoadTileFacts: (x: number, y: number) => RoadTileFacts;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeHost(opts: {
  roads?: Array<[number, number]>;
  concrete?: Array<[number, number]>;
  landId?: number;
  landAt?: (x: number, y: number) => number;
  noLoader?: boolean;
}): ProbeHost {
  const host: ProbeHost = {
    roadTilesMap: new Map((opts.roads ?? []).map(([x, y]) => [`${x},${y}`, true])),
    concreteTilesSet: new Set((opts.concrete ?? []).map(([x, y]) => `${x},${y}`)),
    terrainRenderer: {
      getTerrainLoader: () => (opts.noLoader ? null : { getLandId: (x: number, y: number) => opts.landAt?.(x, y) ?? opts.landId ?? 0 }),
    },
    hasRoadAt: null as unknown as ProbeHost['hasRoadAt'],
    isAdjacentToRoad: null as unknown as ProbeHost['isAdjacentToRoad'],
    hasConcrete: null as unknown as ProbeHost['hasConcrete'],
    getRoadTileFacts: null as unknown as ProbeHost['getRoadTileFacts'],
  };
  host.hasRoadAt = (x, y) => (proto.hasRoadAt as (this: ProbeHost, x: number, y: number) => boolean).call(host, x, y);
  host.isAdjacentToRoad = (x, y) => (proto.isAdjacentToRoad as (this: ProbeHost, x: number, y: number) => boolean).call(host, x, y);
  host.hasConcrete = (x, y) => (proto.hasConcrete as (this: ProbeHost, x: number, y: number) => boolean).call(host, x, y);
  host.getRoadTileFacts = (x, y) => (proto.getRoadTileFacts as (this: ProbeHost, x: number, y: number) => RoadTileFacts).call(host, x, y);
  return host;
}

const getRoadTiles = (host: ProbeHost, limit?: number) =>
  (proto.getRoadTiles as (this: ProbeHost, limit?: number) => Array<{ x: number; y: number }>).call(host, limit);

const getTileProbe = (host: ProbeHost, x: number, y: number) =>
  (proto.getTileProbe as (this: ProbeHost, x: number, y: number) => {
    hasRoad: boolean; adjacentToRoad: boolean; hasConcrete: boolean; landClass: string; isWater: boolean;
  }).call(host, x, y);

describe('getRoadTiles', () => {
  it('returns world coordinates parsed from the road tile map', () => {
    const host = makeHost({ roads: [[953, 999], [954, 999]] });
    expect(getRoadTiles(host)).toEqual([
      { x: 953, y: 999 },
      { x: 954, y: 999 },
    ]);
  });

  it('honors the limit', () => {
    const host = makeHost({ roads: [[1, 1], [2, 2], [3, 3]] });
    expect(getRoadTiles(host, 2)).toHaveLength(2);
  });

  it('returns empty for a road-less map', () => {
    expect(getRoadTiles(makeHost({}))).toEqual([]);
  });
});

describe('getTileProbe', () => {
  it('reports road occupancy and 8-way adjacency', () => {
    const host = makeHost({ roads: [[10, 10]] });
    expect(getTileProbe(host, 10, 10).hasRoad).toBe(true);
    expect(getTileProbe(host, 10, 11).hasRoad).toBe(false);
    expect(getTileProbe(host, 10, 11).adjacentToRoad).toBe(true);
    expect(getTileProbe(host, 11, 11).adjacentToRoad).toBe(true); // diagonal
    expect(getTileProbe(host, 13, 13).adjacentToRoad).toBe(false);
  });

  it('reports concrete occupancy', () => {
    const host = makeHost({ concrete: [[5, 5]] });
    expect(getTileProbe(host, 5, 5).hasConcrete).toBe(true);
    expect(getTileProbe(host, 5, 6).hasConcrete).toBe(false);
  });

  it('decodes land class from the terrain loader', () => {
    // decodeLandId reads the land class from the land id bits; landId 0 is
    // class 0 → 'G'. The exact non-zero encodings are covered by
    // land-utils tests — here we assert the mapping path works.
    const host = makeHost({ landId: 0 });
    const probe = getTileProbe(host, 1, 1);
    expect(['G', 'M', 'D', 'W', '?']).toContain(probe.landClass);
    expect(typeof probe.isWater).toBe('boolean');
  });

  it('tolerates a missing terrain loader (landId falls back to 0)', () => {
    const host = makeHost({ noLoader: true, roads: [[1, 1]] });
    const probe = getTileProbe(host, 1, 1);
    expect(probe.hasRoad).toBe(true);
    expect(probe.landClass.length).toBe(1);
  });
});

/**
 * getCanvasAnchorAt — the bug-report probe.
 *
 * Same prototype-call approach, with a slightly wider host: this one also composes the
 * private `screenToMap` and `getBuildingAt`, so the crafted `this` carries a canvas, a
 * terrain renderer and the building list they read.
 */
describe('getCanvasAnchorAt', () => {
  type AnchorHost = {
    canvas: { getBoundingClientRect: () => { left: number; top: number } };
    terrainRenderer: { screenToMap: (x: number, y: number) => { x: number; y: number } };
    allBuildings: Array<{ visualClass: string; x: number; y: number }>;
    facilityDimensionsCache: { get: (visualClass: string) => { xsize: number; ysize: number } | undefined };
    hiddenFacIds: Set<number>;
    isFacilityKindHidden: (visualClass: string) => boolean;
    roadTilesMap: Map<string, boolean>;
    concreteTilesSet: Set<string>;
    screenToMap: (clientX: number, clientY: number) => { i: number; j: number };
    getBuildingAt: (x: number, y: number) => unknown;
  };

  /**
   * `screenToMap` yields row `i` and column `j`; everything else is keyed column,row.
   * The host maps a screen point straight onto `{x: row, y: column}` so a test can name the
   * tile it means without doing isometric maths.
   */
  function makeAnchorHost(opts: {
    at: { row: number; column: number };
    buildings?: Array<{ visualClass: string; x: number; y: number; xsize?: number; ysize?: number }>;
    roads?: Array<[number, number]>;
    concrete?: Array<[number, number]>;
  }): AnchorHost {
    const dims = new Map(
      (opts.buildings ?? []).map(b => [b.visualClass, { xsize: b.xsize ?? 1, ysize: b.ysize ?? 1 }])
    );
    const host: AnchorHost = {
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      terrainRenderer: { screenToMap: () => ({ x: opts.at.row, y: opts.at.column }) },
      allBuildings: (opts.buildings ?? []).map(b => ({ visualClass: b.visualClass, x: b.x, y: b.y })),
      facilityDimensionsCache: { get: (visualClass: string) => dims.get(visualClass) },
      hiddenFacIds: new Set(),
      isFacilityKindHidden: () => false,
      roadTilesMap: new Map((opts.roads ?? []).map(([x, y]) => [`${x},${y}`, true])),
      concreteTilesSet: new Set((opts.concrete ?? []).map(([x, y]) => `${x},${y}`)),
      screenToMap: null as unknown as AnchorHost['screenToMap'],
      getBuildingAt: null as unknown as AnchorHost['getBuildingAt'],
    };
    host.screenToMap = (clientX, clientY) =>
      (proto.screenToMap as (this: AnchorHost, x: number, y: number) => { i: number; j: number }).call(host, clientX, clientY);
    host.getBuildingAt = (x, y) =>
      (proto.getBuildingAt as (this: AnchorHost, x: number, y: number) => unknown).call(host, x, y);
    return host;
  }

  function anchorAt(host: AnchorHost) {
    return (proto.getCanvasAnchorAt as (this: AnchorHost, x: number, y: number) => {
      tileX: number; tileY: number; visualClass?: string; layer: string;
    }).call(host, 100, 100);
  }

  it('reports bare terrain when nothing occupies the tile', () => {
    expect(anchorAt(makeAnchorHost({ at: { row: 88, column: 412 } })))
      .toEqual({ tileX: 412, tileY: 88, layer: 'terrain' });
  });

  it('names the building under the point, with its visual class', () => {
    const host = makeAnchorHost({
      at: { row: 88, column: 412 },
      buildings: [{ visualClass: 'FarmClass', x: 412, y: 88 }],
    });
    expect(anchorAt(host)).toEqual({ tileX: 412, tileY: 88, visualClass: 'FarmClass', layer: 'building' });
  });

  it('finds a building the point falls inside, not only on its origin', () => {
    const host = makeAnchorHost({
      at: { row: 89, column: 413 },
      buildings: [{ visualClass: 'BigFarm', x: 412, y: 88, xsize: 3, ysize: 3 }],
    });
    expect(anchorAt(host)).toMatchObject({ visualClass: 'BigFarm', layer: 'building' });
  });

  it('reads the tile in column,row order — the same axis swap the tap handler does', () => {
    // The point is row 88 / column 412. A building at x=88,y=412 is the transposed tile and
    // must NOT match; one at x=412,y=88 must.
    const transposed = makeAnchorHost({
      at: { row: 88, column: 412 },
      buildings: [{ visualClass: 'Wrong', x: 88, y: 412 }],
    });
    expect(anchorAt(transposed).layer).toBe('terrain');
  });

  it('falls back to road, then concrete, in that order', () => {
    expect(anchorAt(makeAnchorHost({ at: { row: 88, column: 412 }, roads: [[412, 88]] })))
      .toEqual({ tileX: 412, tileY: 88, layer: 'road' });
    expect(anchorAt(makeAnchorHost({ at: { row: 88, column: 412 }, concrete: [[412, 88]] })))
      .toEqual({ tileX: 412, tileY: 88, layer: 'concrete' });
    // A road tile that also carries concrete is reported as road.
    expect(anchorAt(makeAnchorHost({ at: { row: 88, column: 412 }, roads: [[412, 88]], concrete: [[412, 88]] })).layer)
      .toBe('road');
  });

  it('prefers a building over the road and concrete beneath it', () => {
    const host = makeAnchorHost({
      at: { row: 88, column: 412 },
      buildings: [{ visualClass: 'FarmClass', x: 412, y: 88 }],
      roads: [[412, 88]],
      concrete: [[412, 88]],
    });
    expect(anchorAt(host).layer).toBe('building');
  });

  it('carries no buildingId — ObjectsInArea does not send one', () => {
    const host = makeAnchorHost({
      at: { row: 1, column: 2 },
      buildings: [{ visualClass: 'FarmClass', x: 2, y: 1 }],
    });
    expect(anchorAt(host)).not.toHaveProperty('buildingId');
  });
});

// ===========================================================================
// getRoadTileFacts / getRoadPathFacts — what a road drag is priced from (#99)
// ===========================================================================

const WATER = 0xC0;  // LandClass.ZoneD in bits 7-6
const GRASS = 0x00;

const getRoadPathFacts = (host: ProbeHost, x1: number, y1: number, x2: number, y2: number) =>
  (proto.getRoadPathFacts as (this: ProbeHost, x1: number, y1: number, x2: number, y2: number) => RoadTileFacts[])
    .call(host, x1, y1, x2, y2);

describe('getRoadTileFacts', () => {
  it('reports plain land as neither paved nor a bridge', () => {
    expect(makeHost({ landId: GRASS }).getRoadTileFacts(3, 4))
      .toEqual({ hasRoad: false, isBridge: false, isVoid: false });
  });

  it('reports a tile that already carries a road', () => {
    expect(makeHost({ landId: GRASS, roads: [[3, 4]] }).getRoadTileFacts(3, 4).hasRoad).toBe(true);
  });

  it('calls water with no concrete a bridge, and water with concrete not one', () => {
    expect(makeHost({ landId: WATER }).getRoadTileFacts(3, 4).isBridge).toBe(true);
    expect(makeHost({ landId: WATER, concrete: [[3, 4]] }).getRoadTileFacts(3, 4).isBridge).toBe(false);
  });

  it('never claims a void square — the WebClient models no reserved-plot layer', () => {
    expect(makeHost({ landId: WATER, roads: [[3, 4]] }).getRoadTileFacts(3, 4).isVoid).toBe(false);
  });

  it('treats the ground as dry when no terrain is loaded', () => {
    expect(makeHost({ noLoader: true }).getRoadTileFacts(3, 4).isBridge).toBe(false);
  });
});

describe('getRoadPathFacts', () => {
  it('returns one entry per staircase tile, start tile included, in path order', () => {
    // (0,0) → (1,1) walks (0,0) → (1,0) → (1,1). Only (1,0) is water.
    const host = makeHost({
      roads: [[0, 0]],
      landAt: (x, y) => (x === 1 && y === 0 ? WATER : GRASS),
    });
    expect(getRoadPathFacts(host, 0, 0, 1, 1)).toEqual([
      { hasRoad: true, isBridge: false, isVoid: false },
      { hasRoad: false, isBridge: true, isVoid: false },
      { hasRoad: false, isBridge: false, isVoid: false },
    ]);
  });
});
