/**
 * Tests for CLASSES.BIN parser
 * Verifies correct parsing of the binary building class archive (spec Section 6.2)
 */

import { describe, it, expect } from '@jest/globals';
import * as path from 'path';
import { parseClassesBin, type BuildingClassEntry } from './classes-bin-parser';

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
const CLASSES_BIN_PATH = path.join(__dirname, '__tests__/fixtures/classes-bin/BuildingClasses/CLASSES.BIN');

describe('ClassesBinParser', () => {
  let result: ReturnType<typeof parseClassesBin>;

  beforeAll(() => {
    result = parseClassesBin(CLASSES_BIN_PATH);
  });

  describe('String table', () => {
    it('should parse string table with known section names', () => {
      expect(result.stringCount).toBeGreaterThan(0);
    });
  });

  describe('Class count', () => {
    it('should parse all classes', () => {
      expect(result.classCount).toBeGreaterThan(0);
      expect(result.classes.length).toBe(result.classCount);
    });

    it('should have at least 863 classes', () => {
      // CLASSES.BIN is a gitignored cache asset re-synced from the live server;
      // the count only grows (863 -> 866 in the 2026-07 sync)
      expect(result.classes.length).toBeGreaterThanOrEqual(863);
    });

    it('should have all classes with imagePath', () => {
      // Every entry in CLASSES.BIN has a texture
      const withImages = result.classes.filter(c => c.imagePath);
      expect(withImages.length).toBe(result.classes.length);
    });
  });

  describe('ID lookup', () => {
    it('should provide O(1) lookup by ID', () => {
      const entry = result.byId.get(602);
      expect(entry).toBeDefined();
      expect(entry!.imagePath).toBe('MapPGIHQ1.gif');
    });

    it('should have correct ID range', () => {
      const ids = result.classes.map(c => c.id).sort((a, b) => a - b);
      expect(ids[0]).toBe(151);
      expect(ids[ids.length - 1]).toBe(8542);
    });
  });

  describe('Previously-invisible buildings', () => {
    it('should contain ID 602 (PGI HQ)', () => {
      const entry = result.byId.get(602);
      expect(entry).toBeDefined();
      expect(entry!.imagePath).toBe('MapPGIHQ1.gif');
      expect(entry!.size).toBe(3);
    });

    it('should contain ID 8022 (IFEL Tennis)', () => {
      const entry = result.byId.get(8022);
      expect(entry).toBeDefined();
      expect(entry!.imagePath).toBe('MapIFELTennis64x32.gif');
      expect(entry!.size).toBe(3);
    });

    it('should contain ID 8062 (IFEL AlienParkB)', () => {
      const entry = result.byId.get(8062);
      expect(entry).toBeDefined();
      expect(entry!.imagePath).toBe('MapIFELAlienParkB64x32x0.gif');
    });

    it('should contain ID 4722 with correct texture name', () => {
      const entry = result.byId.get(4722);
      expect(entry).toBeDefined();
      // CLASSES.BIN has the correct name: MapPGIMarketA, NOT MapPGISupermarketA
      expect(entry!.imagePath).toBe('MapPGIMarketA64x32x0.gif');
    });

    it('should contain ID 8072 (IFEL AlienParkC)', () => {
      const entry = result.byId.get(8072);
      expect(entry).toBeDefined();
      expect(entry!.imagePath).toBe('MapIFELAlienParkC64x32x0.gif');
    });

    it('should contain ID 7282 with correct texture (no typo)', () => {
      const entry = result.byId.get(7282);
      expect(entry).toBeDefined();
      // CLASSES.BIN has correct: ComputerStore (no 's'), not ComputersStore
      expect(entry!.imagePath).toBe('MapMKOComputerStore64x32x0.gif');
    });
  });

  describe('Property extraction (spec Section 6.3)', () => {
    it('should extract xSize from General section', () => {
      // ID 602 (PGI HQ) has xSize=3
      const entry = result.byId.get(602);
      expect(entry!.size).toBe(3);
    });

    it('should extract urban flag', () => {
      // ID 602 is urban
      const entry = result.byId.get(602);
      expect(entry!.urban).toBe(true);
    });

    it('should extract imagePath from MapImages section', () => {
      const entry = result.byId.get(602);
      expect(entry!.imagePath).toBe('MapPGIHQ1.gif');
    });

    it('should have selectable default to true', () => {
      // Most buildings should be selectable
      const selectableCount = result.classes.filter(c => c.selectable).length;
      expect(selectableCount).toBeGreaterThan(result.classes.length / 2);
    });
  });

  describe('New [General] properties', () => {
    it('should default voidSquares to 0', () => {
      const entry = result.byId.get(602);
      expect(entry!.voidSquares).toBe(0);
    });

    it('should default hideColor to 0 (clBlack)', () => {
      const entry = result.byId.get(602);
      expect(entry!.hideColor).toBe(0);
    });
  });

  describe('[Animations] section', () => {
    it('should parse animArea for animated buildings', () => {
      // ID 1113 (MoabFarm) has animated=true with non-zero animArea
      const entry = result.byId.get(1113);
      expect(entry).toBeDefined();
      expect(entry!.animated).toBe(true);
      expect(entry!.animArea).toEqual({ left: 75, top: 17, right: 180, bottom: 112 });
    });

    it('should default animArea to zero rect for non-animated buildings', () => {
      const entry = result.byId.get(602);
      expect(entry!.animArea).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    });
  });

  describe('[Sounds] section', () => {
    it('should parse sound data with kind=Stochastic', () => {
      // ID 151 has kind=2 (Stochastic) with one sound
      const entry = result.byId.get(151);
      expect(entry).toBeDefined();
      expect(entry!.soundData.kind).toBe(2); // Stochastic
      expect(entry!.soundData.sounds).toHaveLength(1);
      expect(entry!.soundData.sounds[0].waveFile).toBe('jackhammer.wav');
    });

    it('should parse sound data with kind=AnimDriven', () => {
      // ID 1123 has kind=1 (AnimDriven)
      const entry = result.byId.get(1123);
      expect(entry).toBeDefined();
      expect(entry!.soundData.kind).toBe(1); // AnimDriven
      expect(entry!.soundData.sounds).toHaveLength(1);
      expect(entry!.soundData.sounds[0].waveFile).toBe('steammine.wav');
    });

    it('should default to kind=0 and empty sounds for entries without [Sounds]', () => {
      const entry = result.byId.get(602);
      expect(entry!.soundData.kind).toBe(0); // None
      expect(entry!.soundData.sounds).toHaveLength(0);
    });

    it('should have at least 406 entries with sounds', () => {
      const withSounds = result.classes.filter(c => c.soundData.sounds.length > 0);
      expect(withSounds.length).toBeGreaterThanOrEqual(406);
    });
  });

  describe('[Effects] section', () => {
    it('should parse single effect entry', () => {
      // ID 303 (UWColdStorage) has 1 effect
      const entry = result.byId.get(303);
      expect(entry).toBeDefined();
      expect(entry!.efxData).toHaveLength(1);
      expect(entry!.efxData[0]).toEqual({
        id: -1, x: 235, y: 114, animated: false, glassed: false,
      });
    });

    it('should parse multiple effects with glassed flag', () => {
      // ID 1243 has 2 effects, second one is glassed
      const entry = result.byId.get(1243);
      expect(entry).toBeDefined();
      expect(entry!.efxData).toHaveLength(2);
      expect(entry!.efxData[0].glassed).toBe(false);
      expect(entry!.efxData[1].glassed).toBe(true);
    });

    it('should default to empty effects array', () => {
      const entry = result.byId.get(602);
      expect(entry!.efxData).toHaveLength(0);
    });

    it('should have 82 entries with effects', () => {
      const withEfx = result.classes.filter(c => c.efxData.length > 0);
      expect(withEfx.length).toBe(82);
    });
  });

  describe('Coverage statistics', () => {
    it('should have 27 animated buildings with non-zero animArea', () => {
      const withAnim = result.classes.filter(c => c.animated && c.animArea.right > 0);
      expect(withAnim.length).toBe(27);
    });

    it('should have 5 entries with AnimDriven sound kind', () => {
      const animDriven = result.classes.filter(c => c.soundData.kind === 1);
      expect(animDriven.length).toBe(5);
    });

    it('should have 4 entries with glassed effects', () => {
      const glassed = result.classes.filter(c => c.efxData.some(e => e.glassed));
      expect(glassed.length).toBe(4);
    });
  });

  describe('[InspectorInfo] section', () => {
    it('should parse inspectorTabs for all classes', () => {
      // Every class in CLASSES.BIN has an [InspectorInfo] section
      const withTabs = result.classes.filter(c => c.inspectorTabs.length > 0);
      expect(withTabs.length).toBe(result.classes.length);
    });

    it('should have at least 20 unique tab configurations', () => {
      const configKeys = new Set(
        result.classes.map(c =>
          c.inspectorTabs.map(t => `${t.tabHandler}`).join(',')
        )
      );
      expect(configKeys.size).toBeGreaterThanOrEqual(20);
    });

    it('should parse Config 1 — unkGeneral + Supplies (2 tabs, most common config)', () => {
      // Found dynamically: a class can move to another config when the asset is
      // re-synced (ID 151 gained town tabs in the 2026-07 sync)
      const config1 = result.classes.filter(c =>
        c.inspectorTabs.length === 2 &&
        c.inspectorTabs[0].tabHandler === 'unkGeneral' &&
        c.inspectorTabs[1].tabHandler === 'Supplies'
      );
      expect(config1.length).toBeGreaterThan(100);
      expect(config1[0].inspectorTabs[0]).toEqual({ tabName: 'GENERAL', tabHandler: 'unkGeneral' });
      expect(config1[0].inspectorTabs[1]).toEqual({ tabName: 'SUPPLIES', tabHandler: 'Supplies' });
    });

    it('should parse Config 2 — Residential (3 tabs)', () => {
      // ID 1302 is residential
      const entry = result.byId.get(1302);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(3);
      expect(entry!.inspectorTabs[0].tabHandler).toBe('ResGeneral');
      expect(entry!.inspectorTabs[1].tabHandler).toBe('facManagement');
      expect(entry!.inspectorTabs[2].tabHandler).toBe('Chart');
    });

    it('should parse Config 3 — Industry (7 tabs)', () => {
      // ID 1113 is an industry facility
      const entry = result.byId.get(1113);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(7);
      expect(entry!.inspectorTabs.map(t => t.tabHandler)).toEqual([
        'IndGeneral', 'Products', 'Supplies', 'compInputs', 'Workforce', 'facManagement', 'Chart',
      ]);
      expect(entry!.inspectorTabs.map(t => t.tabName)).toEqual([
        'GENERAL', 'PRODUCTS', 'SUPPLIES', 'SERVICES', 'JOBS', 'MANAGEMENT', 'HISTORY',
      ]);
    });

    it('should parse Config 13 — Minimal fallback (1 tab)', () => {
      // ID 6012 has only 1 tab
      const entry = result.byId.get(6012);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(1);
      expect(entry!.inspectorTabs[0]).toEqual({ tabName: 'GENERAL', tabHandler: 'unkGeneral' });
    });

    it('should parse Config 16 — Capitol (7 tabs)', () => {
      // ID 152 is the Capitol
      const entry = result.byId.get(152);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(7);
      expect(entry!.inspectorTabs.map(t => t.tabHandler)).toEqual([
        'capitolGeneral', 'Ministeries', 'CapitolTowns', 'townServices', 'townJobs', 'townRes', 'Votes',
      ]);
    });

    it('should parse Config 19 — Bank (5 tabs)', () => {
      // ID 2262 is the Bank
      const entry = result.byId.get(2262);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(5);
      expect(entry!.inspectorTabs[0].tabHandler).toBe('BankGeneral');
      expect(entry!.inspectorTabs[1]).toEqual({ tabName: 'LOANS', tabHandler: 'BankLoans' });
    });

    it('should parse Config 20 — Movie Studio (8 tabs, maximum)', () => {
      // ID 5242 is the Movie Studio (most tabs of any building)
      const entry = result.byId.get(5242);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(8);
      expect(entry!.inspectorTabs.map(t => t.tabHandler)).toEqual([
        'IndGeneral', 'Films', 'Products', 'Supplies', 'compInputs', 'Workforce', 'facManagement', 'Chart',
      ]);
    });

    it('should parse Config 6 — HQ with SERVICES tab name but Supplies handler', () => {
      // ID 602 (PGI HQ) — note tab name "SERVICES" but handler "Supplies"
      const entry = result.byId.get(602);
      expect(entry).toBeDefined();
      expect(entry!.inspectorTabs).toHaveLength(5);
      expect(entry!.inspectorTabs[1]).toEqual({ tabName: 'SERVICES', tabHandler: 'Supplies' });
    });

    it('should have at least 27 unique handler names across all classes', () => {
      const handlers = new Set<string>();
      for (const cls of result.classes) {
        for (const tab of cls.inspectorTabs) {
          handlers.add(tab.tabHandler);
        }
      }
      expect(handlers.size).toBeGreaterThanOrEqual(27);
    });
  });

  describe('Construction textures', () => {
    it('should have construction entries (imagePath starts with Construction)', () => {
      const constructionEntries = result.classes.filter(c =>
        c.imagePath.startsWith('Construction')
      );
      expect(constructionEntries.length).toBeGreaterThan(0);
    });

    it('construction entries should be followed by building entries', () => {
      // ID 601 is construction for PGI HQ, ID 602 is the building
      const construction = result.byId.get(601);
      const building = result.byId.get(602);
      expect(construction!.imagePath).toBe('Construction192.gif');
      expect(building!.imagePath).toBe('MapPGIHQ1.gif');
    });
  });
});
