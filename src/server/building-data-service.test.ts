/**
 * Unit Tests for Building Data Service
 * Tests for BuildingDataService with CLASSES.BIN as sole data source
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { BuildingDataService } from './building-data-service';
import { SOUND_SET_KIND } from './classes-bin-parser';
import type { BuildingData } from '../shared/types/building-data';

// Mock logger to prevent console spam during tests
jest.mock('../shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const CLASSES_BIN_PATH = path.join(__dirname, '../../cache/BuildingClasses/CLASSES.BIN');
const binExists = fs.existsSync(CLASSES_BIN_PATH);

// Skip all tests if CLASSES.BIN doesn't exist
(binExists ? describe : describe.skip)('BuildingDataService', () => {
  let service: BuildingDataService;

  beforeAll(async () => {
    service = new BuildingDataService();
    await service.initialize();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(service.isInitialized()).toBe(true);
    });

    it('should be healthy after initialization', () => {
      expect(service.isHealthy()).toBe(true);
    });

    it('should load all 863 classes from CLASSES.BIN', () => {
      const stats = service.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(862);
    });

    it('should not re-initialize if already initialized', async () => {
      const service2 = new BuildingDataService();
      await service2.initialize();
      await service2.initialize(); // Should not throw
      expect(service2.isInitialized()).toBe(true);
    });
  });

  describe('getBuilding() - Direct lookup', () => {
    it('should find building by exact visualClass', () => {
      const building = service.getBuilding('602');
      expect(building).toBeDefined();
      expect(building!.textureFilename).toBe('MapPGIHQ1.gif');
    });

    it('should return undefined for unknown visualClass', () => {
      const building = service.getBuilding('99999');
      expect(building).toBeUndefined();
    });

    it('should find previously-invisible buildings from CLASSES.BIN', () => {
      // Previously-invisible buildings found via CLASSES.BIN
      const targets = [
        { id: '602', texture: 'MapPGIHQ1.gif' },
        { id: '8022', texture: 'MapIFELTennis64x32.gif' },
        { id: '8062', texture: 'MapIFELAlienParkB64x32x0.gif' },
        { id: '4722', texture: 'MapPGIMarketA64x32x0.gif' },
        { id: '8072', texture: 'MapIFELAlienParkC64x32x0.gif' },
        { id: '7282', texture: 'MapMKOComputerStore64x32x0.gif' },
      ];

      for (const target of targets) {
        const building = service.getBuilding(target.id);
        expect(building).toBeDefined();
        expect(building!.textureFilename).toBe(target.texture);
      }
    });
  });

  describe('getBuildingByName()', () => {
    it('should find building by name', () => {
      // PGI HQ has name from CLASSES.BIN General section
      const building = service.getBuilding('602');
      expect(building).toBeDefined();
      const byName = service.getBuildingByName(building!.name);
      expect(byName).toBeDefined();
      expect(byName!.visualClass).toBe('602');
    });

    it('should return undefined for unknown name', () => {
      const building = service.getBuildingByName('NonExistentBuilding');
      expect(building).toBeUndefined();
    });
  });

  describe('getTextureFilename()', () => {
    it('should return texture filename for known building', () => {
      const texture = service.getTextureFilename('602');
      expect(texture).toBe('MapPGIHQ1.gif');
    });

    it('should return construction texture for construction entry', () => {
      // ID 601 is construction for PGI HQ
      const texture = service.getTextureFilename('601');
      expect(texture).toBe('Construction192.gif');
    });

    it('should return undefined for unknown visualClass', () => {
      const texture = service.getTextureFilename('99999');
      expect(texture).toBeUndefined();
    });
  });

  describe('isConstructionState()', () => {
    it('should return true for construction entries', () => {
      // ID 601 has imagePath=Construction192.gif
      expect(service.isConstructionState('601')).toBe(true);
    });

    it('should return false for complete building entries', () => {
      // ID 602 has imagePath=MapPGIHQ1.gif
      expect(service.isConstructionState('602')).toBe(false);
    });

    it('should return false for unknown visualClass', () => {
      expect(service.isConstructionState('99999')).toBe(false);
    });
  });

  describe('isEmptyState()', () => {
    it('should always return false (CLASSES.BIN has no empty state info)', () => {
      expect(service.isEmptyState('601')).toBe(false);
      expect(service.isEmptyState('602')).toBe(false);
      expect(service.isEmptyState('99999')).toBe(false);
    });
  });

  describe('getFacility() - Backward compatibility', () => {
    it('should return FacilityDimensions for valid visualClass', () => {
      const facility = service.getFacility('602');
      expect(facility).toBeDefined();
      expect(facility!.visualClass).toBe('602');
      expect(facility!.xsize).toBeGreaterThan(0);
      expect(facility!.ysize).toBeGreaterThan(0);
    });

    it('should include texture filenames in FacilityDimensions', () => {
      const facility = service.getFacility('602');
      expect(facility).toBeDefined();
      expect(facility!.textureFilename).toBe('MapPGIHQ1.gif');
    });

    it('should return undefined for unknown visualClass', () => {
      const facility = service.getFacility('99999');
      expect(facility).toBeUndefined();
    });

    it('should have required FacilityDimensions properties', () => {
      const facility = service.getFacility('602');
      expect(facility).toBeDefined();

      // Check all required properties exist
      expect(typeof facility!.visualClass).toBe('string');
      expect(typeof facility!.name).toBe('string');
      expect(typeof facility!.facid).toBe('string');
      expect(typeof facility!.xsize).toBe('number');
      expect(typeof facility!.ysize).toBe('number');
      expect(typeof facility!.level).toBe('number');
    });
  });

  describe('getAllBuildings()', () => {
    it('should return array of all 863 buildings', () => {
      const buildings = service.getAllBuildings();
      expect(Array.isArray(buildings)).toBe(true);
      expect(buildings.length).toBeGreaterThanOrEqual(862);
    });

    it('should return buildings with all required properties', () => {
      const buildings = service.getAllBuildings();
      const building = buildings[0];

      expect(building.visualClass).toBeDefined();
      expect(building.name).toBeDefined();
      expect(building.xsize).toBeDefined();
      expect(building.ysize).toBeDefined();
      expect(building.textureFilename).toBeDefined();
    });
  });

  describe('getCache() and getAllBuildingsAsObject()', () => {
    it('should return Map from getCache()', () => {
      const cache = service.getCache();
      expect(cache).toBeInstanceOf(Map);
      expect(cache.size).toBeGreaterThanOrEqual(862);
    });

    it('should return plain object from getAllBuildingsAsObject()', () => {
      const obj = service.getAllBuildingsAsObject();
      expect(typeof obj).toBe('object');
      expect(Object.keys(obj).length).toBeGreaterThanOrEqual(862);
    });

    it('should have same number of entries in both', () => {
      const cache = service.getCache();
      const obj = service.getAllBuildingsAsObject();
      expect(cache.size).toBe(Object.keys(obj).length);
    });
  });

  describe('Building data integrity', () => {
    it('should have valid xsize and ysize for all buildings', () => {
      const buildings = service.getAllBuildings();
      for (const building of buildings) {
        expect(building.xsize).toBeGreaterThanOrEqual(0);
        expect(building.ysize).toBeGreaterThanOrEqual(0);
      }
    });

    it('should have valid texture filenames ending in .gif', () => {
      const buildings = service.getAllBuildings();
      for (const building of buildings) {
        expect(building.textureFilename).toMatch(/\.gif$/i);
      }
    });

    it('should have construction textures for non-construction entries', () => {
      const buildings = service.getAllBuildings();
      const nonConstruction = buildings.filter(b => !b.textureFilename.startsWith('Construction'));
      for (const building of nonConstruction) {
        expect(building.constructionTextureFilename).toMatch(/Construction\d+\.gif$/i);
      }
    });
  });

  describe('VisualClass fallback algorithm (spec Section 7.4)', () => {
    it('should resolve status-variant ID by walking backwards', () => {
      // If CLASSES.BIN has entries at e.g., 602 (PGI HQ) but not 603,
      // ID 603 should walk back to 602
      const building602 = service.getBuilding('602');
      expect(building602).toBeDefined();

      // 603 may or may not exist directly — if not, fallback walks to 602
      const building603 = service.getBuilding('603');
      expect(building603).toBeDefined();
    });

    it('should cache fallback results for performance', () => {
      // First call does the walk
      const building1 = service.getBuilding('603');
      expect(building1).toBeDefined();

      // Second call should use fallback cache (same result)
      const building2 = service.getBuilding('603');
      expect(building2).toBeDefined();
      expect(building2!.name).toBe(building1!.name);
    });

    it('should return undefined for IDs far from any building', () => {
      // 99999 is far from any known building
      expect(service.getBuilding('99999')).toBeUndefined();
    });

    it('should return texture via getTextureFilename for fallback IDs', () => {
      // A status-variant ID that resolves via fallback should get a texture
      const texture = service.getTextureFilename('603');
      expect(texture).toBeDefined();
    });

    it('should return FacilityDimensions via getFacility for fallback IDs', () => {
      const facility = service.getFacility('603');
      expect(facility).toBeDefined();
      expect(facility!.textureFilename).toBeDefined();
    });
  });

  describe('Construction and building texture pairs', () => {
    it('should have construction entry at 601 and building at 602', () => {
      const construction = service.getBuilding('601');
      const building = service.getBuilding('602');
      expect(construction).toBeDefined();
      expect(building).toBeDefined();
      expect(construction!.textureFilename).toBe('Construction192.gif');
      expect(building!.textureFilename).toBe('MapPGIHQ1.gif');
    });

    it('should identify construction entries correctly', () => {
      const buildings = service.getAllBuildings();
      const constructionEntries = buildings.filter(b =>
        b.textureFilename.startsWith('Construction')
      );
      expect(constructionEntries.length).toBeGreaterThan(0);

      for (const entry of constructionEntries) {
        expect(service.isConstructionState(entry.visualClass)).toBe(true);
      }
    });
  });

  describe('Building sizes', () => {
    it('should have various building sizes', () => {
      const buildings = service.getAllBuildings();
      const sizes = new Set<string>();

      for (const building of buildings) {
        sizes.add(`${building.xsize}x${building.ysize}`);
      }

      // Should have multiple different sizes
      expect(sizes.size).toBeGreaterThan(1);
    });

    it('should have PGI HQ at size 3', () => {
      const building = service.getBuilding('602');
      expect(building).toBeDefined();
      expect(building!.xsize).toBe(3);
      expect(building!.ysize).toBe(3);
    });
  });

  describe('ID range', () => {
    it('should have IDs starting at 151', () => {
      const buildings = service.getAllBuildings();
      const ids = buildings.map(b => parseInt(b.visualClass, 10)).sort((a, b) => a - b);
      expect(ids[0]).toBe(151);
    });

    it('should have IDs up to 8542', () => {
      const buildings = service.getAllBuildings();
      const ids = buildings.map(b => parseInt(b.visualClass, 10)).sort((a, b) => a - b);
      expect(ids[ids.length - 1]).toBe(8542);
    });
  });
});

/**
 * The ambience projection — the `[Sounds]` entry getFacility() puts on the wire.
 * Seeded straight into the cache so the check does not depend on CLASSES.BIN being present.
 */
describe('getFacility() — ambience projection', () => {
  const ENTRY = {
    waveFile: 'farm.wav',
    attenuation: 0.5,
    priority: 3,
    looped: true,
    probability: 0.25,
    period: 4000,
  };

  function serviceWith(soundData: BuildingData['soundData']): BuildingDataService {
    const service = new BuildingDataService();
    const cache = (service as unknown as { cacheByVisualClass: Map<string, BuildingData> })
      .cacheByVisualClass;
    cache.set('700', {
      visualClass: '700',
      name: 'Farm',
      xsize: 2,
      ysize: 2,
      textureFilename: 'MapFarm.gif',
      baseVisualClass: '700',
      visualStages: 0,
      constructionTextureFilename: 'Construction128.gif',
      soundData,
    });
    return service;
  }

  it('projects a stochastic entry, renaming period to periodMs', () => {
    const facility = serviceWith({ kind: SOUND_SET_KIND.STOCHASTIC, sounds: [ENTRY] })
      .getFacility('700');

    expect(facility!.sound).toEqual({
      waveFile: 'farm.wav',
      attenuation: 0.5,
      priority: 3,
      looped: true,
      probability: 0.25,
      periodMs: 4000,
    });
  });

  it('projects only the first entry — the one Voyager voices', () => {
    const facility = serviceWith({
      kind: SOUND_SET_KIND.STOCHASTIC,
      sounds: [ENTRY, { ...ENTRY, waveFile: 'mine.wav' }],
    }).getFacility('700');

    expect(facility!.sound!.waveFile).toBe('farm.wav');
  });

  it('omits the entry for a class with no sound set', () => {
    expect(serviceWith(undefined).getFacility('700')!.sound).toBeUndefined();
  });

  it('omits the entry for a NONE sound set', () => {
    const facility = serviceWith({ kind: SOUND_SET_KIND.NONE, sounds: [ENTRY] }).getFacility('700');
    expect(facility!.sound).toBeUndefined();
  });

  it('omits the entry for an animation-driven sound set', () => {
    const facility = serviceWith({ kind: SOUND_SET_KIND.ANIM_DRIVEN, sounds: [ENTRY] })
      .getFacility('700');
    expect(facility!.sound).toBeUndefined();
  });

  it('omits the entry when the set is stochastic but empty', () => {
    const facility = serviceWith({ kind: SOUND_SET_KIND.STOCHASTIC, sounds: [] }).getFacility('700');
    expect(facility!.sound).toBeUndefined();
  });

  it('omits the entry when the wave filename is blank', () => {
    const facility = serviceWith({
      kind: SOUND_SET_KIND.STOCHASTIC,
      sounds: [{ ...ENTRY, waveFile: '' }],
    }).getFacility('700');
    expect(facility!.sound).toBeUndefined();
  });
});

/**
 * The `[General] Zone` projection — the minimap's class colour (issue #601). Seeded straight
 * into the cache, same as the ambience block above, so the check does not depend on
 * CLASSES.BIN being present.
 */
describe('getFacility() — zone projection', () => {
  function serviceWithZone(zoneType: number | undefined): BuildingDataService {
    const service = new BuildingDataService();
    const cache = (service as unknown as { cacheByVisualClass: Map<string, BuildingData> })
      .cacheByVisualClass;
    cache.set('700', {
      visualClass: '700',
      name: 'Farm',
      xsize: 2,
      ysize: 2,
      textureFilename: 'MapFarm.gif',
      baseVisualClass: '700',
      visualStages: 0,
      constructionTextureFilename: 'Construction128.gif',
      zoneType,
    });
    return service;
  }

  it('carries the zone type through to FacilityDimensions', () => {
    expect(serviceWithZone(6).getFacility('700')!.zoneType).toBe(6);
  });

  it('leaves zoneType undefined when the class has none', () => {
    expect(serviceWithZone(undefined).getFacility('700')!.zoneType).toBeUndefined();
  });
});

/**
 * The numeric `facId` projection (issue #598) — carried alongside the pre-existing `facid`
 * category slug string, never replacing it. Seeded straight into the cache, same as the
 * ambience/zone blocks above, so the check does not depend on CLASSES.BIN being present.
 */
describe('getFacility() — facId projection', () => {
  function serviceWithFacId(facId: number | undefined): BuildingDataService {
    const service = new BuildingDataService();
    const cache = (service as unknown as { cacheByVisualClass: Map<string, BuildingData> })
      .cacheByVisualClass;
    cache.set('700', {
      visualClass: '700',
      name: 'Farm',
      xsize: 2,
      ysize: 2,
      textureFilename: 'MapFarm.gif',
      baseVisualClass: '700',
      visualStages: 0,
      constructionTextureFilename: 'Construction128.gif',
      category: 'agriculture',
      facId,
    });
    return service;
  }

  it('carries the numeric facId through from the parsed class', () => {
    const facility = serviceWithFacId(42).getFacility('700');
    expect(facility!.facId).toBe(42);
    expect(typeof facility!.facid).toBe('string');
    expect(facility!.facid).toBe('agriculture');
  });

  it('leaves facId undefined when the class declares none', () => {
    expect(serviceWithFacId(undefined).getFacility('700')!.facId).toBeUndefined();
  });
});
