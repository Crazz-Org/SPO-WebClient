/**
 * Building Data Service - Manages building metadata from CLASSES.BIN
 *
 * Source: cache/BuildingClasses/CLASSES.BIN (863+ entries — the cache asset is
 * re-synced from the live server and its count grows over time)
 *
 * CLASSES.BIN is the SOLE AUTHORITATIVE source for VisualClass → texture mapping.
 * It contains 100% of building classes (construction + complete + all variants).
 *
 * Key features:
 * - Loads ALL building classes from CLASSES.BIN (covers every VisualClass ID)
 * - Backward-walk fallback for status-variant IDs (spec Section 7.4)
 * - Compatible with existing FacilityDimensions interface
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../shared/logger';
import { BuildingData, getConstructionTexture } from '../shared/types/building-data';
import { parseClassesBin, SOUND_SET_KIND } from './classes-bin-parser';
import { registerInspectorTabs } from '../shared/building-details/property-templates';
import type { Service } from './service-registry';
import { getCacheDir } from './paths';

const logger = createLogger('BuildingDataService');

/**
 * Backward-compatible interface with existing FacilityDimensions
 */
export interface FacilityDimensions {
  visualClass: string;
  name: string;
  facid: string;
  xsize: number;
  ysize: number;
  level: number;
  fidConstant?: number;
  textureFilename?: string;
  emptyTextureFilename?: string;
  constructionTextureFilename?: string;
  animated?: boolean;
  animArea?: { left: number; top: number; right: number; bottom: number };
  /** `[General] Zone` (`MapTypes.pas:157`) — the minimap's class colour, `Map.pas:7566-7576`. */
  zoneType?: number;
  /**
   * The class's ambience entry — `Sounds[0]` of the `[Sounds]` section, the entry Voyager's
   * TStaticBuildingSoundTarget voices (Map.pas:8389). Absent for a silent or
   * animation-driven class.
   */
  sound?: {
    waveFile: string;
    attenuation: number;
    priority: number;
    looped: boolean;
    probability: number;
    periodMs: number;
  };
}

/**
 * Building Data Service
 * Provides building metadata lookups for rendering and building placement
 */
export class BuildingDataService implements Service {
  public readonly name = 'buildings';

  /** Main cache: visualClass -> BuildingData */
  private cacheByVisualClass: Map<string, BuildingData> = new Map();

  /** Lookup by name */
  private cacheByName: Map<string, BuildingData> = new Map();

  private initialized: boolean = false;

  /**
   * Initialize the service by loading CLASSES.BIN
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('[BuildingDataService] Already initialized');
      return;
    }

    try {
      logger.info('[BuildingDataService] Initializing...');

      // Load CLASSES.BIN (sole authoritative source — all building classes)
      const classesBinPath = path.join(getCacheDir(), 'BuildingClasses/CLASSES.BIN');
      if (fs.existsSync(classesBinPath)) {
        this.loadFromClassesBin(classesBinPath);
      } else {
        logger.warn('[BuildingDataService] CLASSES.BIN not found — no building data available');
      }

      this.initialized = true;
      logger.info('[BuildingDataService] Initialization complete');
      this.logStats();
    } catch (error: unknown) {
      logger.error('[BuildingDataService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Load building data from CLASSES.BIN (spec Section 6.2)
   * This is the sole source for all VisualClass → texture filename mappings.
   */
  private loadFromClassesBin(filePath: string): void {
    const result = parseClassesBin(filePath);

    for (const cls of result.classes) {
      if (!cls.imagePath) continue; // Skip entries without textures

      const visualClass = String(cls.id);

      const building: BuildingData = {
        visualClass,
        name: cls.name || `Class${cls.id}`,
        xsize: cls.size,
        ysize: cls.size,
        textureFilename: cls.imagePath,
        baseVisualClass: visualClass, // CLASSES.BIN entries are self-contained
        visualStages: 0,
        constructionTextureFilename: cls.imagePath.startsWith('Construction')
          ? cls.imagePath
          : getConstructionTexture(cls.size, cls.size),
        // Full CLASSES.BIN properties (100% Delphi TBuildingClass parity)
        voidSquares: cls.voidSquares,
        hideColor: cls.hideColor,
        urban: cls.urban,
        accident: cls.accident,
        zoneType: cls.zoneType,
        facId: cls.facId,
        requires: cls.requires,
        selectable: cls.selectable,
        buildOpts: cls.buildOpts,
        animated: cls.animated,
        levelSignX: cls.levelSignX,
        levelSignY: cls.levelSignY,
        animArea: cls.animArea,
        soundData: cls.soundData,
        efxData: cls.efxData,
        inspectorTabs: cls.inspectorTabs,
      };

      this.cacheByVisualClass.set(visualClass, building);
      this.cacheByName.set(building.name, building);

      // Register inspector tabs for data-driven template selection
      if (cls.inspectorTabs.length > 0) {
        registerInspectorTabs(visualClass, cls.inspectorTabs, building.name);
      }
    }

    logger.info(`[BuildingDataService] Loaded ${this.cacheByVisualClass.size} classes from CLASSES.BIN`);
  }

  /** Maximum backward search distance for VisualClass fallback (spec Section 7.6) */
  private static readonly MAX_FALLBACK_SEARCH = 7;

  /** Fallback resolution cache: visualClass -> resolved visualClass (or '' for no match) */
  private fallbackCache: Map<string, string> = new Map();

  /**
   * Get building data by visualClass (the runtime VisualClass from ObjectsInArea)
   *
   * Implements the VisualClass matching algorithm (spec Section 7.7):
   * 1. Direct lookup by exact ID
   * 2. Fallback: walk backwards up to MAX_FALLBACK_SEARCH=7 steps
   */
  getBuilding(visualClass: string): BuildingData | undefined {
    // Step 1: Direct lookup
    const building = this.cacheByVisualClass.get(visualClass);
    if (building) {
      return building;
    }

    // Step 2: Check fallback cache
    const cached = this.fallbackCache.get(visualClass);
    if (cached !== undefined) {
      return cached === '' ? undefined : this.cacheByVisualClass.get(cached);
    }

    // Step 3: Backward walk fallback (spec Section 7.4)
    const id = parseInt(visualClass, 10);
    if (!isNaN(id)) {
      for (let offset = 1; offset <= BuildingDataService.MAX_FALLBACK_SEARCH; offset++) {
        const candidateId = id - offset;
        if (candidateId < 0) break;

        const candidateKey = String(candidateId);
        const candidate = this.cacheByVisualClass.get(candidateKey);
        if (candidate && candidate.textureFilename) {
          this.fallbackCache.set(visualClass, candidate.visualClass);
          return candidate;
        }
      }
    }

    // No match — cache sentinel
    this.fallbackCache.set(visualClass, '');
    return undefined;
  }

  /**
   * Get building by name
   */
  getBuildingByName(name: string): BuildingData | undefined {
    return this.cacheByName.get(name);
  }

  /**
   * Get texture filename for a visualClass
   * Since CLASSES.BIN has all entries (construction + complete), just return the texture directly.
   */
  getTextureFilename(visualClass: string): string | undefined {
    const building = this.getBuilding(visualClass);
    return building?.textureFilename;
  }

  /**
   * Check if a visualClass represents a construction state
   * In CLASSES.BIN, construction entries have imagePath starting with "Construction"
   */
  isConstructionState(visualClass: string): boolean {
    const building = this.cacheByVisualClass.get(visualClass);
    if (!building) return false;
    return building.textureFilename.startsWith('Construction');
  }

  /**
   * Check if a visualClass represents an empty residential state
   * CLASSES.BIN does not distinguish empty states — always returns false
   */
  isEmptyState(_visualClass: string): boolean {
    return false;
  }

  /**
   * Get backward-compatible FacilityDimensions object
   */
  getFacility(visualClass: string): FacilityDimensions | undefined {
    const building = this.getBuilding(visualClass);
    if (!building) {
      return undefined;
    }

    return {
      visualClass: building.visualClass,
      name: building.name,
      facid: building.category || '',
      xsize: building.xsize,
      ysize: building.ysize,
      level: building.visualStages,
      textureFilename: building.textureFilename,
      emptyTextureFilename: building.emptyTextureFilename,
      constructionTextureFilename: building.constructionTextureFilename,
      animated: building.animated,
      animArea: building.animArea,
      zoneType: building.zoneType,
      sound: BuildingDataService.projectAmbience(building.soundData),
    };
  }

  /**
   * Project the class's `[Sounds]` section down to the single entry the client voices.
   *
   * Voyager's building ambience target reads `Sounds[0]` and nothing else (Map.pas:8389),
   * and only a stochastic set is ambience at all — an `ssAnimDriven` array is indexed by
   * animation frame, not played as a continuous voice.
   */
  private static projectAmbience(
    soundData: BuildingData['soundData']
  ): FacilityDimensions['sound'] {
    if (!soundData || soundData.kind !== SOUND_SET_KIND.STOCHASTIC) return undefined;
    const entry = soundData.sounds[0];
    if (!entry || !entry.waveFile) return undefined;
    return {
      waveFile: entry.waveFile,
      attenuation: entry.attenuation,
      priority: entry.priority,
      looped: entry.looped,
      probability: entry.probability,
      periodMs: entry.period,
    };
  }

  /**
   * Get all buildings
   */
  getAllBuildings(): BuildingData[] {
    return Array.from(this.cacheByVisualClass.values());
  }

  /**
   * Get buildings by cluster
   */
  getBuildingsByCluster(cluster: string): BuildingData[] {
    return this.getAllBuildings().filter(b => b.cluster === cluster);
  }

  /**
   * Get buildings by category
   */
  getBuildingsByCategory(category: string): BuildingData[] {
    return this.getAllBuildings().filter(b => b.category === category);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    return this.initialized && this.cacheByVisualClass.size > 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; clusters: Record<string, number>; categories: Record<string, number> } {
    const clusters: Record<string, number> = {};
    const categories: Record<string, number> = {};

    for (const building of this.cacheByVisualClass.values()) {
      const cluster = building.cluster || 'unknown';
      const category = building.category || 'unknown';

      clusters[cluster] = (clusters[cluster] || 0) + 1;
      categories[category] = (categories[category] || 0) + 1;
    }

    return {
      total: this.cacheByVisualClass.size,
      clusters,
      categories
    };
  }

  /**
   * Log cache statistics
   */
  private logStats(): void {
    const stats = this.getStats();
    logger.info(`[BuildingDataService] Total buildings: ${stats.total}`);
  }

  /**
   * Get all buildings as a plain object (for client preload)
   */
  getAllBuildingsAsObject(): Record<string, BuildingData> {
    const result: Record<string, BuildingData> = {};
    for (const [key, value] of this.cacheByVisualClass) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Graceful shutdown: clear in-memory caches.
   */
  async shutdown(): Promise<void> {
    logger.info('[BuildingDataService] Shutting down...');
    this.cacheByVisualClass.clear();
    this.cacheByName.clear();
    this.fallbackCache.clear();
    this.initialized = false;
    logger.info('[BuildingDataService] Shutdown complete');
  }

  /**
   * Get the main cache
   */
  getCache(): Map<string, BuildingData> {
    return this.cacheByVisualClass;
  }
}
