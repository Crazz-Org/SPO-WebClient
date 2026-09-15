/**
 * Dedicated test for the `facId` field on `getFacility()` — the wire-facing carrier of
 * CLASSES.BIN's [General] FacId (task 598). Kept separate from `building-data-service.test.ts`,
 * which is wrapped in `(binExists ? describe : describe.skip)` and skips entirely wherever
 * `cache/BuildingClasses/CLASSES.BIN` is absent (this worktree, and CI).
 */

import { describe, it, expect } from '@jest/globals';
import { BuildingDataService } from './building-data-service';
import type { BuildingData } from '../shared/types/building-data';

function seedBuilding(overrides: Partial<BuildingData> = {}): BuildingData {
  return {
    visualClass: '100',
    name: 'TestBuilding',
    xsize: 1,
    ysize: 1,
    textureFilename: 'Test.gif',
    baseVisualClass: '100',
    visualStages: 0,
    constructionTextureFilename: 'Construction32.gif',
    ...overrides,
  };
}

describe('BuildingDataService.getFacility — facId', () => {
  it('carries facId through when the seeded BuildingData has one', () => {
    const service = new BuildingDataService();
    service.getCache().set('100', seedBuilding({ visualClass: '100', facId: 75 }));

    expect(service.getFacility('100')?.facId).toBe(75);
  });

  it('leaves facId undefined when the seeded BuildingData has none', () => {
    const service = new BuildingDataService();
    service.getCache().set('200', seedBuilding({ visualClass: '200' }));

    expect(service.getFacility('200')?.facId).toBeUndefined();
  });
});
