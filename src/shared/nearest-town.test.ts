import { nearestTown } from './nearest-town';
import type { TownInfo } from './types/domain-types';

function town(name: string, x: number, y: number): TownInfo {
  return {
    name,
    iconUrl: '',
    mayor: null,
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x,
    y,
    path: '',
    classId: 'TownHall',
  };
}

describe('nearestTown', () => {
  it('returns null without towns', () => {
    expect(nearestTown(undefined, 12, 12)).toBeNull();
    expect(nearestTown([], 12, 12)).toBeNull();
  });

  it('picks Helartia from (12,12) and Faraway from (39,2)', () => {
    const towns = [town('Helartia', 10, 10), town('Faraway', 40, 0)];
    expect(nearestTown(towns, 12, 12)?.name).toBe('Helartia');
    expect(nearestTown(towns, 39, 2)?.name).toBe('Faraway');
  });

  it('breaks ties by keeping the first town, matching the server\'s strict "<" (World.pas:5922)', () => {
    const towns = [town('First', 0, 0), town('Second', 6, 0)];
    expect(nearestTown(towns, 3, 0)?.name).toBe('First');
  });

  it('pins the metric to Manhattan distance over a grid of points, brute force', () => {
    const towns = [town('A', 0, 0), town('B', 6, 6), town('C', 6, 0), town('D', 0, 6)];
    for (let x = -2; x <= 8; x += 1) {
      for (let y = -2; y <= 8; y += 1) {
        const expected = towns.reduce((best, t) => {
          const d = Math.abs(t.x - x) + Math.abs(t.y - y);
          const bestD = Math.abs(best.x - x) + Math.abs(best.y - y);
          return d < bestD ? t : best;
        });
        expect(nearestTown(towns, x, y)?.name).toBe(expected.name);
      }
    }
  });
});
