import { describe, it, expect } from '@jest/globals';
import { facilityKindsFrom, isFacilityKindHidden } from './facility-kinds';
import { FacilityDimensions } from '../shared/types';

function dims(overrides: Partial<FacilityDimensions>): FacilityDimensions {
  return {
    visualClass: '1',
    name: 'Farm',
    facid: '',
    xsize: 1,
    ysize: 1,
    level: 0,
    ...overrides,
  };
}

describe('facilityKindsFrom', () => {
  it('returns [] for empty input', () => {
    expect(facilityKindsFrom({})).toEqual([]);
  });

  it('groups the double-keyed record by facId, deduping', () => {
    const farm = dims({ visualClass: '1', name: 'Farm', facId: 10 });
    const result = facilityKindsFrom({ '1': farm, 'Farm': farm });
    expect(result).toEqual([{ facId: 10, label: 'Farm' }]);
  });

  it('excludes entries with facId 0', () => {
    const result = facilityKindsFrom({ '1': dims({ visualClass: '1', facId: 0 }) });
    expect(result).toEqual([]);
  });

  it('excludes entries with missing facId', () => {
    const result = facilityKindsFrom({ '1': dims({ visualClass: '1', facId: undefined }) });
    expect(result).toEqual([]);
  });

  it('labels a kind from the entry with the numerically smallest visualClass', () => {
    const result = facilityKindsFrom({
      '5': dims({ visualClass: '5', name: 'FarmLevel2', facId: 10 }),
      '1': dims({ visualClass: '1', name: 'Farm', facId: 10 }),
    });
    expect(result).toEqual([{ facId: 10, label: 'Farm' }]);
  });

  it('falls back to `Facility <facId>` when the base entry has an empty name', () => {
    const result = facilityKindsFrom({ '1': dims({ visualClass: '1', name: '', facId: 10 }) });
    expect(result).toEqual([{ facId: 10, label: 'Facility 10' }]);
  });

  it('sorts by label, then by facId', () => {
    const result = facilityKindsFrom({
      '1': dims({ visualClass: '1', name: 'Zoo', facId: 2 }),
      '2': dims({ visualClass: '2', name: 'Farm', facId: 1 }),
    });
    expect(result).toEqual([
      { facId: 1, label: 'Farm' },
      { facId: 2, label: 'Zoo' },
    ]);
  });
});

describe('isFacilityKindHidden', () => {
  it('returns false immediately when the hidden set is empty', () => {
    expect(isFacilityKindHidden(new Set(), { facId: 10 })).toBe(false);
  });

  it('returns false when dims is undefined', () => {
    expect(isFacilityKindHidden(new Set([10]), undefined)).toBe(false);
  });

  it('returns false when facId is undefined', () => {
    expect(isFacilityKindHidden(new Set([10]), { facId: undefined })).toBe(false);
  });

  it('returns false when facId is 0', () => {
    expect(isFacilityKindHidden(new Set([0]), { facId: 0 })).toBe(false);
  });

  it('returns true when facId is in the hidden set', () => {
    expect(isFacilityKindHidden(new Set([10]), { facId: 10 })).toBe(true);
  });

  it('returns false when facId is not in the hidden set', () => {
    expect(isFacilityKindHidden(new Set([10]), { facId: 20 })).toBe(false);
  });
});
