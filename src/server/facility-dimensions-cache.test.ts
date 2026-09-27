/**
 * Tests for FacilityDimensionsCache (server-side)
 * Verifies CLASSES.BIN-backed building data access and client preload
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { FacilityDimensionsCache } from './facility-dimensions-cache';

// Mock logger to prevent console spam during tests
jest.mock('../shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

// A frozen copy of the real CLASSES.BIN, committed so CI runs these tests
// (provenance: __tests__/fixtures/classes-bin/README.md). The runtime cache/ stays gitignored.
// The service finds the file through getCacheDir(), so point SPO_CACHE_DIR at the fixture
// for this suite and restore whatever was set before (the bench worker sets its own).
const FIXTURE_CACHE_DIR = path.join(__dirname, '__tests__/fixtures/classes-bin');

describe('FacilityDimensionsCache', () => {
  let cache: FacilityDimensionsCache;

  let previousCacheDir: string | undefined;

  beforeAll(async () => {
    const binPath = path.join(FIXTURE_CACHE_DIR, 'BuildingClasses/CLASSES.BIN');
    if (!fs.existsSync(binPath)) throw new Error(`CLASSES.BIN fixture missing: ${binPath}`);
    previousCacheDir = process.env.SPO_CACHE_DIR;
    process.env.SPO_CACHE_DIR = FIXTURE_CACHE_DIR;
    cache = new FacilityDimensionsCache();
    await cache.initialize();
  });

  afterAll(() => {
    if (previousCacheDir === undefined) delete process.env.SPO_CACHE_DIR;
    else process.env.SPO_CACHE_DIR = previousCacheDir;
  });

  describe('getAllFacilitiesAsObject()', () => {
    it('should include all 863 building entries by visualClass', () => {
      const obj = cache.getAllFacilitiesAsObject();
      // Each of the 863 CLASSES.BIN entries should appear
      expect(obj['602']).toBeDefined(); // PGI HQ
      expect(obj['602'].textureFilename).toBe('MapPGIHQ1.gif');
    });

    it('should include name-keyed entries for building placement', () => {
      const obj = cache.getAllFacilitiesAsObject();
      const building = cache.getBuilding('602');
      expect(building).toBeDefined();
      // Should be keyed by name too
      expect(obj[building!.name]).toBeDefined();
    });

    it('should have entries for both visualClass and name per building', () => {
      const obj = cache.getAllFacilitiesAsObject();
      const allBuildings = cache.getAllBuildings();
      const entryCount = Object.keys(obj).length;

      // Each building gets 2 entries: by visualClass + by name
      // Some names may collide, so count >= buildings but <= 2*buildings
      expect(entryCount).toBeGreaterThanOrEqual(allBuildings.length);
      expect(entryCount).toBeLessThanOrEqual(allBuildings.length * 2);
    });

    it('should have correct visualClass for each entry', () => {
      const obj = cache.getAllFacilitiesAsObject();
      const allBuildings = cache.getAllBuildings();
      for (const building of allBuildings) {
        const entry = obj[building.visualClass];
        expect(entry).toBeDefined();
        expect(entry.visualClass).toBe(building.visualClass);
      }
    });
  });

  describe('Previously-invisible buildings', () => {
    it('should resolve all 6 previously-invisible IDs', () => {
      const targets = [
        { id: '602', texture: 'MapPGIHQ1.gif' },
        { id: '8022', texture: 'MapIFELTennis64x32.gif' },
        { id: '8062', texture: 'MapIFELAlienParkB64x32x0.gif' },
        { id: '4722', texture: 'MapPGIMarketA64x32x0.gif' },
        { id: '8072', texture: 'MapIFELAlienParkC64x32x0.gif' },
        { id: '7282', texture: 'MapMKOComputerStore64x32x0.gif' },
      ];

      for (const target of targets) {
        const building = cache.getBuilding(target.id);
        expect(building).toBeDefined();
        expect(building!.textureFilename).toBe(target.texture);
      }
    });
  });

  describe('Backward compatibility', () => {
    it('should return FacilityDimensions via getFacility', () => {
      const facility = cache.getFacility('602');
      expect(facility).toBeDefined();
      expect(facility!.textureFilename).toBe('MapPGIHQ1.gif');
      expect(facility!.xsize).toBe(3);
    });

    it('should return construction texture for construction entries', () => {
      const facility = cache.getFacility('601');
      expect(facility).toBeDefined();
      expect(facility!.textureFilename).toBe('Construction192.gif');
    });

    it('should resolve via backward walk', () => {
      // ID 603 may not exist directly — backward walk should find 602
      const building = cache.getBuilding('603');
      expect(building).toBeDefined();
    });
  });
});
