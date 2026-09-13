/**
 * Tests for IsometricMapRenderer.getAmbienceSnapshot().
 *
 * The monolith is too heavy to instantiate, so the method is exercised via prototype
 * `.call()` with a crafted `this` covering only the fields it reads — the same pattern
 * renderer-input.test.ts and renderer-e2e-probe.test.ts use.
 */

import { describe, it, expect } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { AmbienceSnapshot } from '../audio/map-ambience';
import type { FacilityDimensions, MapBuilding } from '../../shared/types';
import type { TileBounds } from '../../shared/map-config';

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

type SnapshotHost = {
  canvas: { width: number; height: number };
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, FacilityDimensions>;
  terrainRenderer: {
    screenToMap: (x: number, y: number) => { x: number; y: number };
    mapToScreen: (i: number, j: number) => { x: number; y: number };
    getZoomLevel: () => number;
  };
  getVisibleTileBounds: () => TileBounds;
};

const SOUND = {
  waveFile: 'farm.wav',
  attenuation: 0.5,
  priority: 4,
  looped: true,
  probability: 0.25,
  periodMs: 3000,
};

function building(x: number, y: number, visualClass: string): MapBuilding {
  return { visualClass, tycoonId: 1, options: 0, x, y, level: 0, alert: false, attack: 0 };
}

function dims(visualClass: string, extra: Partial<FacilityDimensions> = {}): FacilityDimensions {
  return {
    visualClass,
    name: `class-${visualClass}`,
    facid: '',
    xsize: 1,
    ysize: 1,
    level: 0,
    ...extra,
  };
}

function makeHost(opts: {
  buildings: MapBuilding[];
  classes: Array<[string, FacilityDimensions]>;
  bounds?: TileBounds;
  /** The tile under the canvas centre, as {i, j}. */
  listener?: { i: number; j: number };
  zoomLevel?: number;
  canvasWidth?: number;
}): SnapshotHost {
  const listener = opts.listener ?? { i: 0, j: 0 };
  return {
    canvas: { width: opts.canvasWidth ?? 1024, height: 768 },
    allBuildings: opts.buildings,
    facilityDimensionsCache: new Map(opts.classes),
    terrainRenderer: {
      screenToMap: () => ({ x: listener.i, y: listener.j }),
      // Distinguishable from the argument order: 1000*i + j.
      mapToScreen: (i: number, j: number) => ({ x: 1000 * i + j, y: 0 }),
      getZoomLevel: () => opts.zoomLevel ?? 2,
    },
    getVisibleTileBounds: () => opts.bounds ?? { minI: 0, maxI: 100, minJ: 0, maxJ: 100 },
  };
}

const snapshotOf = (host: SnapshotHost) =>
  (proto.getAmbienceSnapshot as (this: SnapshotHost) => AmbienceSnapshot).call(host);

describe('getAmbienceSnapshot', () => {
  it('reports the canvas width and zoom level the mixer needs', () => {
    const host = makeHost({ buildings: [], classes: [], zoomLevel: 3, canvasWidth: 800 });
    const snapshot = snapshotOf(host);

    expect(snapshot.canvasWidth).toBe(800);
    expect(snapshot.zoomLevel).toBe(3);
    expect(snapshot.sources).toEqual([]);
  });

  it('carries the class ambience entry through verbatim', () => {
    const host = makeHost({
      buildings: [building(5, 7, '100')],
      classes: [['100', dims('100', { sound: SOUND })]],
    });
    const [source] = snapshotOf(host).sources;

    expect(source.key).toBe('5,7');
    expect(source.waveFile).toBe('farm.wav');
    expect(source.attenuation).toBe(0.5);
    expect(source.priority).toBe(4);
    expect(source.looped).toBe(true);
    expect(source.probability).toBe(0.25);
    expect(source.periodMs).toBe(3000);
  });

  it('skips a class with no ambience entry, and one with no dimensions at all', () => {
    const host = makeHost({
      buildings: [building(1, 1, 'silent'), building(2, 2, 'unknown'), building(3, 3, 'loud')],
      classes: [
        ['silent', dims('silent')],
        ['loud', dims('loud', { sound: SOUND })],
      ],
    });
    const snapshot = snapshotOf(host);

    expect(snapshot.sources.map(s => s.key)).toEqual(['3,3']);
  });

  it('excludes buildings outside the visible bounds, with no margin', () => {
    const host = makeHost({
      buildings: [building(10, 10, '100'), building(60, 10, '100'), building(10, 60, '100')],
      classes: [['100', dims('100', { sound: SOUND })]],
      bounds: { minI: 0, maxI: 50, minJ: 0, maxJ: 50 },
    });
    const snapshot = snapshotOf(host);

    expect(snapshot.sources.map(s => s.key)).toEqual(['10,10']);
  });

  it('keeps a large building whose footprint reaches into the view', () => {
    const host = makeHost({
      // x is the column: this one starts one tile left of the view and is 4 wide.
      buildings: [building(-1, 10, 'big')],
      classes: [['big', dims('big', { xsize: 4, ysize: 4, sound: SOUND })]],
      bounds: { minI: 0, maxI: 50, minJ: 0, maxJ: 50 },
    });

    expect(snapshotOf(host).sources.map(s => s.key)).toEqual(['-1,10']);
  });

  it('measures distance from the canvas-centre tile to the building centre', () => {
    const host = makeHost({
      // x = column j = 13, y = row i = 24; a 3x3 building centres at i=25, j=14.
      buildings: [building(13, 24, 'big')],
      classes: [['big', dims('big', { xsize: 3, ysize: 3, sound: SOUND })]],
      listener: { i: 22, j: 10 },
    });
    const [source] = snapshotOf(host).sources;

    expect(source.distance).toBeCloseTo(Math.hypot(22 - 25, 10 - 14), 10);
  });

  it('takes the pan anchor from mapToScreen(row, column), not the other way round', () => {
    const host = makeHost({
      buildings: [building(7, 3, '100')],
      classes: [['100', dims('100', { sound: SOUND })]],
    });
    const [source] = snapshotOf(host).sources;

    // mapToScreen is stubbed as 1000*i + j, so row 3 / column 7 gives 3007.
    expect(source.screenX).toBe(3007);
  });

  it('treats a zero-sized class as a single tile', () => {
    const host = makeHost({
      buildings: [building(4, 4, 'zero')],
      classes: [['zero', dims('zero', { xsize: 0, ysize: 0, sound: SOUND })]],
      listener: { i: 4, j: 4 },
      bounds: { minI: 0, maxI: 50, minJ: 0, maxJ: 50 },
    });
    const [source] = snapshotOf(host).sources;

    expect(source.distance).toBe(0);
  });
});
