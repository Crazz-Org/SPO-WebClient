import { describe, it, expect } from '@jest/globals';
import { zoneExclusionMask, ZONE_ROAD_TOLERANCE } from './zone-preview-exclusions';
import type { ZonePreviewRect, ZoneBuildingFootprint } from './zone-preview-exclusions';

const noRoad = () => false;

describe('zoneExclusionMask', () => {
  it('zone 0 (erase) -> every entry false, regardless of roads or buildings', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const mask = zoneExclusionMask(rect, 0, [{ x: 0, y: 0, w: 1, h: 1 }], noRoad);
    expect(mask).toEqual(new Array(9).fill(false));
  });

  it('zone 10 (out of range) -> every entry false', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const mask = zoneExclusionMask(rect, 10, [], noRoad);
    expect(mask).toEqual([false, false, false, false]);
  });

  it('a 1x1 rect with a road on the tile itself -> not excluded', () => {
    const rect: ZonePreviewRect = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    const mask = zoneExclusionMask(rect, 6, [], (x, y) => x === 5 && y === 5);
    expect(mask).toEqual([false]);
  });

  it(`a road exactly ${ZONE_ROAD_TOLERANCE} tiles away on each axis, and the diagonal corner -> not excluded`, () => {
    const rect: ZonePreviewRect = { minX: 50, minY: 50, maxX: 50, maxY: 50 };
    const cases: Array<[number, number]> = [
      [50 + ZONE_ROAD_TOLERANCE, 50],
      [50 - ZONE_ROAD_TOLERANCE, 50],
      [50, 50 + ZONE_ROAD_TOLERANCE],
      [50, 50 - ZONE_ROAD_TOLERANCE],
      [50 + ZONE_ROAD_TOLERANCE, 50 + ZONE_ROAD_TOLERANCE],
    ];
    for (const [rx, ry] of cases) {
      const mask = zoneExclusionMask(rect, 6, [], (x, y) => x === rx && y === ry);
      expect(mask).toEqual([false]);
    }
  });

  it(`a road ${ZONE_ROAD_TOLERANCE + 1} tiles away -> excluded`, () => {
    const rect: ZonePreviewRect = { minX: 50, minY: 50, maxX: 50, maxY: 50 };
    const mask = zoneExclusionMask(rect, 6, [], (x, y) => x === 50 + ZONE_ROAD_TOLERANCE + 1 && y === 50);
    expect(mask).toEqual([true]);
  });

  it('no road anywhere -> every tile excluded', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    const mask = zoneExclusionMask(rect, 6, [], noRoad);
    expect(mask).toEqual(new Array(6).fill(true));
  });

  it('a 2x3 building footprint excludes exactly its six tiles, leaves neighbours alone', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const roadEverywhere = () => true;
    const building: ZoneBuildingFootprint = { x: 1, y: 1, w: 2, h: 3 };
    const mask = zoneExclusionMask(rect, 6, [building], roadEverywhere);
    const width = 5;
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 4; x++) {
        const expected = x >= 1 && x < 3 && y >= 1 && y < 4;
        expect(mask[(y - 0) * width + (x - 0)]).toBe(expected);
      }
    }
  });

  it('a footprint straddling the rect edge -> only the overlapping tiles marked', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const roadEverywhere = () => true;
    const building: ZoneBuildingFootprint = { x: -1, y: -1, w: 2, h: 2 };
    const mask = zoneExclusionMask(rect, 6, [building], roadEverywhere);
    // only (0,0) falls inside both the rect and the footprint
    expect(mask).toEqual([true, false, false, false]);
  });

  it('a tile both built on and road-served -> excluded', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const roadEverywhere = () => true;
    const mask = zoneExclusionMask(rect, 6, [{ x: 0, y: 0, w: 1, h: 1 }], roadEverywhere);
    expect(mask).toEqual([true]);
  });

  it('index order is (y-minY)*width + (x-minX) — a non-square rect fails on transposition', () => {
    const rect: ZonePreviewRect = { minX: 0, minY: 0, maxX: 3, maxY: 1 }; // width 4, height 2
    const roadEverywhere = () => true;
    // building only at x=3,y=1 — the last column, second row
    const mask = zoneExclusionMask(rect, 6, [{ x: 3, y: 1, w: 1, h: 1 }], roadEverywhere);
    const expected = new Array(8).fill(false);
    expected[1 * 4 + 3] = true; // (y=1,x=3) -> index 7
    expect(mask).toEqual(expected);
  });
});
