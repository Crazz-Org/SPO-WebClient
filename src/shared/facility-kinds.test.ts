import { describe, it, expect } from '@jest/globals';
import { facilityKindLabel, deriveFacilityKinds } from './facility-kinds';
import type { FacilityDimensions } from './types/domain-types';

function dims(overrides: Partial<FacilityDimensions> = {}): FacilityDimensions {
  return {
    visualClass: 'v1',
    name: 'n1',
    facid: '',
    xsize: 1,
    ysize: 1,
    level: 0,
    ...overrides,
  };
}

describe('facilityKindLabel', () => {
  it('returns the FacIds.pas name for a known id', () => {
    expect(facilityKindLabel(75)).toBe('Supermarket');
  });

  it('returns "Kind <n>" for an id FacIds.pas does not know (e.g. the Portals, 151)', () => {
    expect(facilityKindLabel(151)).toBe('Kind 151');
  });
});

describe('deriveFacilityKinds', () => {
  it('dedupes a record keyed twice (visualClass and name) for the same class', () => {
    const kinds = deriveFacilityKinds({
      classA: dims({ visualClass: 'classA', facId: 75 }),
      'Supermarket Name': dims({ visualClass: 'classA', facId: 75 }),
    });
    expect(kinds).toEqual([{ facId: 75, label: 'Supermarket' }]);
  });

  it('drops facId: 0 (FID_None is not a kind)', () => {
    const kinds = deriveFacilityKinds({ a: dims({ facId: 0 }) });
    expect(kinds).toEqual([]);
  });

  it('drops entries with no facId at all', () => {
    const kinds = deriveFacilityKinds({ a: dims() });
    expect(kinds).toEqual([]);
  });

  it('sorts by label, with facId as tie-break', () => {
    const kinds = deriveFacilityKinds({
      a: dims({ visualClass: 'a', facId: 151 }), // "Kind 151"
      b: dims({ visualClass: 'b', facId: 75 }), // "Supermarket"
      c: dims({ visualClass: 'c', facId: 40 }), // "Farm"
    });
    expect(kinds.map((k) => k.facId)).toEqual([40, 151, 75]);
  });
});
