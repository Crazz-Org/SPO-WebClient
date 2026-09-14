/**
 * Tests for the three minimap layer getters added for issue #601
 * (`getRoadTileCoords` / `getConcreteTileCoords` / `getSelectedBuilding`). Same prototype-`.call()`
 * harness as `renderer-fog.test.ts`.
 */

import { describe, it, expect } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { MapBuilding } from '@/shared/types';

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function call<T>(name: string, host: unknown): T {
  return (proto[name] as (this: unknown) => T).call(host);
}

describe('minimap layer getters', () => {
  it('decodes the road tiles map', () => {
    const host = { roadTilesMap: new Map([['3,4', true], ['5,6', true]]) };
    expect(call<Array<{ x: number; y: number }>>('getRoadTileCoords', host)).toEqual([
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it('an empty road set yields []', () => {
    const host = { roadTilesMap: new Map() };
    expect(call<Array<{ x: number; y: number }>>('getRoadTileCoords', host)).toEqual([]);
  });

  it('decodes the concrete tiles set', () => {
    const host = { concreteTilesSet: new Set(['1,2', '7,8']) };
    expect(call<Array<{ x: number; y: number }>>('getConcreteTileCoords', host)).toEqual([
      { x: 1, y: 2 },
      { x: 7, y: 8 },
    ]);
  });

  it('an empty concrete set yields []', () => {
    const host = { concreteTilesSet: new Set() };
    expect(call<Array<{ x: number; y: number }>>('getConcreteTileCoords', host)).toEqual([]);
  });

  it('returns the selected building', () => {
    const b: MapBuilding = { visualClass: '1', tycoonId: 1, options: 0, x: 5, y: 5, level: 0, alert: false, attack: 0 };
    const host = { selectedBuilding: b };
    expect(call<MapBuilding | null>('getSelectedBuilding', host)).toBe(b);
  });

  it('returns null when nothing is selected', () => {
    const host = { selectedBuilding: null };
    expect(call<MapBuilding | null>('getSelectedBuilding', host)).toBeNull();
  });
});
