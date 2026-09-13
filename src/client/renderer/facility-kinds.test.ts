import { facilityKindLabel, collectFacilityKinds } from './facility-kinds';
import type { FacilityDimensions, MapBuilding } from '../../shared/types/domain-types';

function makeBuilding(visualClass: string): MapBuilding {
  return { visualClass, tycoonId: 1, options: 0, x: 0, y: 0, level: 0, alert: false, attack: 0 };
}

type Dims = Pick<FacilityDimensions, 'facId' | 'textureFilename'>;

describe('facilityKindLabel', () => {
  it('strips the Map prefix, size suffix and extension, and splits camel case', () => {
    expect(facilityKindLabel('MapUWColdStorage64x32x0.gif')).toBe('UWCold Storage');
  });

  it('handles a texture name with no size suffix', () => {
    expect(facilityKindLabel('MapPGIHQ1.gif')).toBe('PGIHQ1');
  });

  it('returns undefined for a construction texture', () => {
    expect(facilityKindLabel('Construction64x32x0.gif')).toBeUndefined();
  });

  it('returns undefined for an undefined texture', () => {
    expect(facilityKindLabel(undefined)).toBeUndefined();
  });
});

describe('collectFacilityKinds', () => {
  it('returns an empty list for no buildings', () => {
    expect(collectFacilityKinds([], () => undefined)).toEqual([]);
  });

  it('skips a building whose class is unknown to the dimensions cache', () => {
    const buildings = [makeBuilding('999')];
    expect(collectFacilityKinds(buildings, () => undefined)).toEqual([]);
  });

  it('skips facId 0 — no kind', () => {
    const cache = new Map<string, Dims>([['1', { facId: 0, textureFilename: 'MapRoad.gif' }]]);
    const buildings = [makeBuilding('1')];
    expect(collectFacilityKinds(buildings, (vc) => cache.get(vc))).toEqual([]);
  });

  it('lists the same kind once when seen on multiple buildings', () => {
    const cache = new Map<string, Dims>([['1', { facId: 10, textureFilename: 'MapHQ64x32x0.gif' }]]);
    const buildings = [makeBuilding('1'), makeBuilding('1')];
    expect(collectFacilityKinds(buildings, (vc) => cache.get(vc))).toEqual([{ facId: 10, label: 'HQ' }]);
  });

  it('sorts the result by facId', () => {
    const cache = new Map<string, Dims>([
      ['1', { facId: 46, textureFilename: 'MapFarm64x32x0.gif' }],
      ['2', { facId: 10, textureFilename: 'MapHQ64x32x0.gif' }],
    ]);
    const buildings = [makeBuilding('1'), makeBuilding('2')];
    expect(collectFacilityKinds(buildings, (vc) => cache.get(vc))).toEqual([
      { facId: 10, label: 'HQ' },
      { facId: 46, label: 'Farm' },
    ]);
  });

  it('falls back to "Kind <facId>" when the kind has only construction textures so far', () => {
    const cache = new Map<string, Dims>([['1', { facId: 10, textureFilename: 'Construction64x32x0.gif' }]]);
    const buildings = [makeBuilding('1')];
    expect(collectFacilityKinds(buildings, (vc) => cache.get(vc))).toEqual([{ facId: 10, label: 'Kind 10' }]);
  });

  it('takes the label from the first labelled building even when an unlabelled one came first', () => {
    const cache = new Map<string, Dims>([
      ['1', { facId: 10, textureFilename: 'Construction64x32x0.gif' }],
      ['2', { facId: 10, textureFilename: 'MapHQ64x32x0.gif' }],
    ]);
    const buildings = [makeBuilding('1'), makeBuilding('2')];
    expect(collectFacilityKinds(buildings, (vc) => cache.get(vc))).toEqual([{ facId: 10, label: 'HQ' }]);
  });
});
