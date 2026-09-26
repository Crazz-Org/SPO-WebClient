/**
 * Client-side Facility Dimensions Cache
 * Stores all building dimensions in memory for instant lookup
 *
 * Implements the VisualClass matching algorithm from the spec:
 * 1. Direct O(1) lookup by VisualClass ID
 * 2. Fallback: walk backwards up to MAX_FALLBACK_SEARCH steps
 *    (handles status-variant IDs that don't have dedicated entries)
 */

import { FacilityDimensions } from '../shared/types';
import { createLogger } from '../shared/logger';

const logger = createLogger('FacilityDimensionsCache[Client]');

/**
 * Maximum backward search distance for VisualClass fallback.
 * Equals the largest VisualStages across all block types (TLumberMillBlock: 7).
 * See spec Section 7.6.
 */
const MAX_FALLBACK_SEARCH = 7;

/**
 * Client-side cache for facility dimensions
 * Preloaded once on startup, no network requests after that
 */
export class ClientFacilityDimensionsCache {
  private cache: Map<string, FacilityDimensions> = new Map();
  private initialized: boolean = false;
  /** The uninitialised-lookup warning fires once, not once per call; clear() re-arms it. */
  private warnedUninitialized = false;

  /** Fallback resolution cache: maps unresolved IDs to resolved IDs (or '' for no match) */
  private fallbackCache: Map<string, string> = new Map();

  /**
   * Initialize cache with all facility dimensions
   */
  initialize(dimensions: Record<string, FacilityDimensions>): void {
    if (this.initialized) {
      logger.warn('[ClientFacilityDimensionsCache] Already initialized, skipping');
      return;
    }

    // Convert plain object to Map
    for (const [visualClass, facility] of Object.entries(dimensions)) {
      this.cache.set(visualClass, facility);
    }

    this.initialized = true;
    logger.info(`[ClientFacilityDimensionsCache] Initialized with ${this.cache.size} facilities`);
  }

  /**
   * Get facility dimensions by visualClass.
   *
   * Uses the VisualClass matching algorithm (spec Section 7.7):
   * 1. Direct lookup by exact ID
   * 2. Fallback: walk backwards up to MAX_FALLBACK_SEARCH=7 steps
   *    to find the nearest base entry
   *
   * Results are cached so subsequent lookups for the same ID skip the walk.
   */
  getFacility(visualClass: string): FacilityDimensions | undefined {
    if (!this.initialized) {
      if (!this.warnedUninitialized) {
        logger.warn('[ClientFacilityDimensionsCache] Cache not initialized, returning undefined');
        this.warnedUninitialized = true;
      }
      return undefined;
    }

    // Step 1: Direct lookup (O(1))
    const direct = this.cache.get(visualClass);
    if (direct) {
      return direct;
    }

    // Step 2: Check fallback cache
    const cached = this.fallbackCache.get(visualClass);
    if (cached !== undefined) {
      // '' sentinel means "no match found"
      return cached === '' ? undefined : this.cache.get(cached);
    }

    // Step 3: Backward walk (spec Section 7.4)
    const id = parseInt(visualClass, 10);
    if (isNaN(id)) {
      return undefined;
    }

    for (let offset = 1; offset <= MAX_FALLBACK_SEARCH; offset++) {
      const candidateId = id - offset;
      if (candidateId < 0) break;

      const candidateKey = String(candidateId);
      const candidate = this.cache.get(candidateKey);
      if (candidate && candidate.textureFilename) {
        // Cache the resolution for future lookups
        this.fallbackCache.set(visualClass, candidateKey);
        return candidate;
      }
    }

    // No match — cache as sentinel to avoid repeated walks
    this.fallbackCache.set(visualClass, '');
    return undefined;
  }

  /**
   * Check if cache is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get cache size
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * Check if a visualClass represents a construction state.
   * Construction entries have textureFilename starting with "Construction".
   */
  isConstructionState(visualClass: string): boolean {
    const facility = this.getFacility(visualClass);
    if (!facility?.textureFilename) return false;
    return facility.textureFilename.startsWith('Construction');
  }

  /**
   * Clear cache (for testing)
   */
  clear(): void {
    this.cache.clear();
    this.fallbackCache.clear();
    this.initialized = false;
    this.warnedUninitialized = false;
    logger.info('[ClientFacilityDimensionsCache] Cache cleared');
  }
}

// Singleton instance
let cacheInstance: ClientFacilityDimensionsCache | null = null;

/**
 * Get singleton cache instance
 */
export function getFacilityDimensionsCache(): ClientFacilityDimensionsCache {
  if (!cacheInstance) {
    cacheInstance = new ClientFacilityDimensionsCache();
  }
  return cacheInstance;
}
