/**
 * Tests for ClientFacilityDimensionsCache
 * Tests the VisualClass matching algorithm (spec Section 7)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ClientFacilityDimensionsCache } from './facility-dimensions-cache';
import { FacilityDimensions } from '../shared/types';

// Mock logger to prevent console spam during tests; `warn` is routed through a lazy arrow so the
// file-level mock can be read without tripping the jest.mock hoisting TDZ.
const mockWarn = jest.fn();
jest.mock('../shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: (...a: unknown[]) => mockWarn(...a),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

/** Helper: create a FacilityDimensions entry */
function makeFacility(visualClass: string, name: string, textureFilename?: string): FacilityDimensions {
  return {
    visualClass,
    name,
    facid: '',
    xsize: 2,
    ysize: 2,
    level: 1,
    textureFilename: textureFilename !== undefined ? textureFilename : `Map${name}64x32x0.gif`,
    constructionTextureFilename: 'Construction64.gif',
  };
}

describe('ClientFacilityDimensionsCache', () => {
  let cache: ClientFacilityDimensionsCache;

  beforeEach(() => {
    cache = new ClientFacilityDimensionsCache();
  });

  describe('Basic operations', () => {
    it('should start uninitialized', () => {
      expect(cache.isInitialized()).toBe(false);
    });

    it('should return undefined when not initialized', () => {
      expect(cache.getFacility('100')).toBeUndefined();
    });

    it('should initialize with dimensions', () => {
      cache.initialize({ '100': makeFacility('100', 'TestBuilding') });
      expect(cache.isInitialized()).toBe(true);
      expect(cache.getSize()).toBe(1);
    });

    it('should find facility by exact visualClass', () => {
      cache.initialize({ '100': makeFacility('100', 'TestBuilding') });
      const facility = cache.getFacility('100');
      expect(facility).toBeDefined();
      expect(facility!.name).toBe('TestBuilding');
    });

    it('should return undefined for unknown visualClass', () => {
      cache.initialize({ '100': makeFacility('100', 'TestBuilding') });
      expect(cache.getFacility('999')).toBeUndefined();
    });

    it('should clear cache and fallback cache', () => {
      cache.initialize({ '100': makeFacility('100', 'TestBuilding') });
      cache.getFacility('105'); // Populate fallback cache
      cache.clear();
      expect(cache.isInitialized()).toBe(false);
      expect(cache.getSize()).toBe(0);
    });
  });

  describe('VisualClass fallback algorithm (spec Section 7.4)', () => {
    it('should resolve status-variant ID by walking backwards', () => {
      // Simulate: base=301, complete=304 (warehouse with 3 visual stages)
      // Server pre-populated intermediate IDs 301-304 all pointing to the complete entry
      cache.initialize({
        '301': makeFacility('304', 'UWColdStorage'),
        '302': makeFacility('304', 'UWColdStorage'),
        '303': makeFacility('304', 'UWColdStorage'),
        '304': makeFacility('304', 'UWColdStorage'),
      });

      // All IDs in range should resolve
      expect(cache.getFacility('301')!.name).toBe('UWColdStorage');
      expect(cache.getFacility('302')!.name).toBe('UWColdStorage');
      expect(cache.getFacility('303')!.name).toBe('UWColdStorage');
      expect(cache.getFacility('304')!.name).toBe('UWColdStorage');
    });

    it('should fallback walk when server did NOT pre-populate intermediates', () => {
      // Only the complete ID is in cache (no pre-population)
      cache.initialize({
        '304': makeFacility('304', 'UWColdStorage'),
      });

      // ID 305 (status variant above complete) should walk back to 304
      const result = cache.getFacility('305');
      expect(result).toBeDefined();
      expect(result!.name).toBe('UWColdStorage');
    });

    it('should walk backwards up to 7 steps (MAX_FALLBACK_SEARCH)', () => {
      cache.initialize({
        '100': makeFacility('100', 'LumberMill'),
      });

      // TLumberMillBlock can have offsets 0-6, so ID 107 = base + 7
      // Walk from 107 → 106 → 105 → 104 → 103 → 102 → 101 → 100 (found!)
      const result = cache.getFacility('107');
      expect(result).toBeDefined();
      expect(result!.name).toBe('LumberMill');
    });

    it('should NOT walk more than 7 steps', () => {
      cache.initialize({
        '100': makeFacility('100', 'LumberMill'),
      });

      // ID 108 = base + 8, walk would need 8 steps → should fail
      const result = cache.getFacility('108');
      expect(result).toBeUndefined();
    });

    it('should cache fallback resolution for subsequent lookups', () => {
      cache.initialize({
        '100': makeFacility('100', 'TestBuilding'),
      });

      // First call: walks backwards
      const result1 = cache.getFacility('103');
      expect(result1!.name).toBe('TestBuilding');

      // Second call: should use cached fallback (instant, same result)
      const result2 = cache.getFacility('103');
      expect(result2!.name).toBe('TestBuilding');
    });

    it('should cache negative results (no match sentinel)', () => {
      cache.initialize({
        '100': makeFacility('100', 'TestBuilding'),
      });

      // ID 200: too far from any entry → no match
      const result1 = cache.getFacility('200');
      expect(result1).toBeUndefined();

      // Second call should also return undefined (cached sentinel)
      const result2 = cache.getFacility('200');
      expect(result2).toBeUndefined();
    });

    it('should not walk below 0', () => {
      cache.initialize({
        '5': makeFacility('5', 'SmallBuilding'),
      });

      // ID 3 walks: 2→1→0→(stop, can't go below 0)
      // But 5 is at distance 2 from 3... wait, walk is from 3 backwards:
      // 3→ not found, try 2→1→0→-1 (stop). None found.
      // The walk goes DOWN from the requested ID, not UP to it.
      // So from ID 3: try 2, 1, 0 → none found (5 is ABOVE 3)
      expect(cache.getFacility('3')).toBeUndefined();
    });

    it('should skip entries without textureFilename', () => {
      cache.initialize({
        '99': makeFacility('99', 'EmptyEntry', ''),  // Empty texture
        '98': makeFacility('98', 'ValidEntry', 'MapValid64x32x0.gif'),
      });

      // ID 100 walks: 99 (skipped, empty texture) → 98 (found!)
      const result = cache.getFacility('100');
      expect(result).toBeDefined();
      expect(result!.name).toBe('ValidEntry');
    });
  });

  describe('Worked examples from spec', () => {
    it('should handle Small Residential (spec Section 5.5)', () => {
      // ID 100 → construction, ID 101 → inhabited-normal, ID 102 → inhabited-ugly
      cache.initialize({
        '100': makeFacility('100', 'SmallRes_Construction', 'Construction64.gif'),
        '101': makeFacility('101', 'SmallRes_Normal', 'SmallRes1.bmp'),
        '102': makeFacility('102', 'SmallRes_Ugly', 'SmallRes1_ugly.bmp'),
      });

      expect(cache.getFacility('100')!.textureFilename).toBe('Construction64.gif');
      expect(cache.getFacility('101')!.textureFilename).toBe('SmallRes1.bmp');
      expect(cache.getFacility('102')!.textureFilename).toBe('SmallRes1_ugly.bmp');
    });

    it('should fallback when ugly texture is missing (spec Section 5.5)', () => {
      // Only base (100) and normal (101) have entries — ugly (102) is missing
      cache.initialize({
        '100': makeFacility('100', 'SmallRes_Construction', 'Construction64.gif'),
        '101': makeFacility('101', 'SmallRes_Normal', 'SmallRes1.bmp'),
      });

      // ID 102 walks back to 101 (offset 1)
      const result = cache.getFacility('102');
      expect(result).toBeDefined();
      expect(result!.textureFilename).toBe('SmallRes1.bmp');
    });

    it('should handle TWarehouse with 3 visual stages', () => {
      // Warehouse: base=301, construction at 301, operational at 302-304
      cache.initialize({
        '301': makeFacility('301', 'WH_Construction', 'Construction256.gif'),
        '302': makeFacility('302', 'WH_Default', 'MapWarehouse64x32x0.gif'),
      });

      // ID 303 (export role) and 304 (import role) walk back to 302
      expect(cache.getFacility('303')!.textureFilename).toBe('MapWarehouse64x32x0.gif');
      expect(cache.getFacility('304')!.textureFilename).toBe('MapWarehouse64x32x0.gif');
    });
  });

  describe('isConstructionState()', () => {
    it('should return true for Construction texture', () => {
      cache.initialize({
        '100': makeFacility('100', 'SmallRes_Construction', 'Construction64.gif'),
      });
      expect(cache.isConstructionState('100')).toBe(true);
    });

    it('should return true for large Construction textures', () => {
      cache.initialize({
        '200': makeFacility('200', 'WH_Construction', 'Construction256.gif'),
      });
      expect(cache.isConstructionState('200')).toBe(true);
    });

    it('should return false for normal building textures', () => {
      cache.initialize({
        '101': makeFacility('101', 'FoodStore', 'MapPGIFoodStore64x32x0.gif'),
      });
      expect(cache.isConstructionState('101')).toBe(false);
    });

    it('should return false for empty texture', () => {
      cache.initialize({
        '102': makeFacility('102', 'Empty', ''),
      });
      expect(cache.isConstructionState('102')).toBe(false);
    });

    it('should return false for unknown visualClass', () => {
      cache.initialize({
        '100': makeFacility('100', 'Test'),
      });
      expect(cache.isConstructionState('999')).toBe(false);
    });

    it('should return false when cache is not initialized', () => {
      expect(cache.isConstructionState('100')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle non-numeric visualClass by name', () => {
      cache.initialize({
        'PGIFoodStore': makeFacility('4602', 'PGIFoodStore'),
      });

      // Name lookup (used for building placement)
      const result = cache.getFacility('PGIFoodStore');
      expect(result).toBeDefined();
      expect(result!.name).toBe('PGIFoodStore');
    });

    it('should not fallback for name lookups (non-numeric)', () => {
      cache.initialize({
        'PGIFoodStore': makeFacility('4602', 'PGIFoodStore'),
      });

      // Non-numeric string → parseInt returns NaN → no fallback walk
      expect(cache.getFacility('PGIFoodStoreX')).toBeUndefined();
    });

    it('should handle visualClass 0', () => {
      cache.initialize({
        '0': makeFacility('0', 'ZeroBuilding'),
      });

      expect(cache.getFacility('0')!.name).toBe('ZeroBuilding');
      // ID 1 walks back to 0
      expect(cache.getFacility('1')!.name).toBe('ZeroBuilding');
    });
  });
});

describe('ClientFacilityDimensionsCache — uninitialised warning', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('warns once, not once per lookup, on an uninitialised cache', () => {
    const cache = new ClientFacilityDimensionsCache();
    expect(cache.getFacility('1')).toBeUndefined();
    expect(cache.getFacility('2')).toBeUndefined();
    expect(cache.getFacility('3')).toBeUndefined();
    const notInit = mockWarn.mock.calls.filter(c => String(c[0]).includes('Cache not initialized'));
    expect(notInit).toHaveLength(1);
  });

  it('clear() re-arms the warning', () => {
    const cache = new ClientFacilityDimensionsCache();
    cache.getFacility('1');
    cache.getFacility('1');
    cache.clear();
    cache.getFacility('1');
    cache.getFacility('1');
    const notInit = mockWarn.mock.calls.filter(c => String(c[0]).includes('Cache not initialized'));
    expect(notInit).toHaveLength(2);
  });
});
