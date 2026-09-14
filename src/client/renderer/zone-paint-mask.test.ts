import { describe, it, expect } from '@jest/globals';
import { isZonePaintable, zonePaintableTiles, ZONE_ROAD_TOLERANCE } from './zone-paint-mask';

describe('isZonePaintable', () => {
  it('exports the road tolerance the server applies', () => {
    expect(ZONE_ROAD_TOLERANCE).toBe(7);
  });

  it('zone 0 (de-zone) is always paintable, regardless of the facts', () => {
    expect(isZonePaintable(0, { occupiedByBuilding: false, roadInReach: false })).toBe(true);
    expect(isZonePaintable(0, { occupiedByBuilding: true, roadInReach: false })).toBe(true);
    expect(isZonePaintable(0, { occupiedByBuilding: false, roadInReach: true })).toBe(true);
    expect(isZonePaintable(0, { occupiedByBuilding: true, roadInReach: true })).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('zone %i: paintable only when clear and in road reach', (zoneId) => {
    expect(isZonePaintable(zoneId, { occupiedByBuilding: false, roadInReach: true })).toBe(true);
    expect(isZonePaintable(zoneId, { occupiedByBuilding: true, roadInReach: true })).toBe(false);
    expect(isZonePaintable(zoneId, { occupiedByBuilding: false, roadInReach: false })).toBe(false);
    expect(isZonePaintable(zoneId, { occupiedByBuilding: true, roadInReach: false })).toBe(false);
  });
});

describe('zonePaintableTiles', () => {
  it('returns only the tiles the probe marks paintable, row-major', () => {
    const paintable = new Set(['1,1', '2,1']);
    const probe = (x: number, y: number) => ({
      occupiedByBuilding: !paintable.has(`${x},${y}`),
      roadInReach: true,
    });
    expect(zonePaintableTiles(3, 1, 1, 2, 2, probe)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  });

  it('handles the degenerate 1x1 rectangle', () => {
    const probe = () => ({ occupiedByBuilding: false, roadInReach: true });
    expect(zonePaintableTiles(3, 5, 5, 5, 5, probe)).toEqual([{ x: 5, y: 5 }]);
  });

  it('returns an empty array when nothing is paintable', () => {
    const probe = () => ({ occupiedByBuilding: true, roadInReach: false });
    expect(zonePaintableTiles(3, 0, 0, 2, 2, probe)).toEqual([]);
  });

  it('zone 0 takes every tile of the rectangle regardless of facts', () => {
    const probe = () => ({ occupiedByBuilding: true, roadInReach: false });
    expect(zonePaintableTiles(0, 0, 0, 1, 1, probe)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ]);
  });
});
