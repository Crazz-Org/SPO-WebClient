/**
 * Which ref a directory row opens, and what the legacy page printed above its list.
 */

import { describe, it, expect } from '@jest/globals';
import { childRef, facilityRef, directoryHeading } from './directory-refs';
import type { DirectoryRef, DirectoryFacilityRow } from '@/shared/types';

describe('childRef', () => {
  it('opens a facility kind from the town Facilities folder (InTownFacilities.asp:16)', () => {
    expect(childRef({ kind: 'town-facilities', town: 'Helartia' }, 'Residentials'))
      .toEqual({ kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' });
  });

  it('opens a company from the town Companies folder (InTownCompanies.asp:17)', () => {
    expect(childRef({ kind: 'town-companies', town: 'Helartia' }, 'Crazz Ltd'))
      .toEqual({ kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' });
  });

  it('opens that company\'s facility kind, carrying both names (InTownCompany.asp:22)', () => {
    expect(childRef({ kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' }, 'Farms'))
      .toEqual({ kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd', facKind: 'Farms' });
  });

  it('opens a company from a tycoon card (TycoonCompanies.asp:22)', () => {
    expect(childRef({ kind: 'tycoon-companies', tycoon: 'Crazz' }, 'Crazz Ltd'))
      .toEqual({ kind: 'tycoon-company', tycoon: 'Crazz', company: 'Crazz Ltd' });
  });

  it('opens that company\'s facility kind (TycoonCompany.asp:13)', () => {
    expect(childRef({ kind: 'tycoon-company', tycoon: 'Crazz', company: 'Crazz Ltd' }, 'Farms'))
      .toEqual({ kind: 'tycoon-facility-kind', tycoon: 'Crazz', company: 'Crazz Ltd', facKind: 'Farms' });
  });

  it('has no child for a page that is not a folder', () => {
    const leaves: DirectoryRef[] = [
      { kind: 'town', path: 'Towns\\Helartia.five', classId: '1' },
      { kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' },
      { kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd', facKind: 'Farms' },
      { kind: 'tycoon-facility-kind', tycoon: 'Crazz', company: 'Crazz Ltd', facKind: 'Farms' },
      { kind: 'facility', path: 'P', name: 'House' },
    ];

    for (const leaf of leaves) expect(childRef(leaf, 'anything')).toBeNull();
  });
});

describe('facilityRef', () => {
  it('carries the two OpenFacility.asp query values the row was given', () => {
    const row: DirectoryFacilityRow = {
      name: 'Cheap House 1',
      itemName: 'Cheap House 1',
      path: 'Towns\\Helartia.five\\Facilities\\Residentials',
      iconUrl: '',
      company: 'Crazz Ltd',
      x: 1,
      y: 2,
    };

    expect(facilityRef(row)).toEqual({
      kind: 'facility',
      path: 'Towns\\Helartia.five\\Facilities\\Residentials',
      name: 'Cheap House 1',
    });
  });
});

describe('directoryHeading', () => {
  it('stacks the headers each legacy page printed above its list', () => {
    expect(directoryHeading({ kind: 'town-facilities', town: 'Helartia' })).toBe('Helartia › Facilities');
    expect(directoryHeading({ kind: 'town-companies', town: 'Helartia' })).toBe('Helartia › Companies');
    expect(directoryHeading({ kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' }))
      .toBe('Helartia › Companies › Crazz Ltd');
    expect(directoryHeading({ kind: 'town-facility-kind', town: 'Helartia', facKind: 'Farms' }))
      .toBe('Helartia › Facilities › Farms');
    expect(directoryHeading({
      kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd', facKind: 'Farms',
    })).toBe('Helartia › Companies › Crazz Ltd › Farms');
    expect(directoryHeading({ kind: 'tycoon-companies', tycoon: 'Crazz' })).toBe('Crazz › Companies');
    expect(directoryHeading({ kind: 'tycoon-company', tycoon: 'Crazz', company: 'Crazz Ltd' }))
      .toBe('Crazz › Crazz Ltd');
    expect(directoryHeading({
      kind: 'tycoon-facility-kind', tycoon: 'Crazz', company: 'Crazz Ltd', facKind: 'Farms',
    })).toBe('Crazz › Crazz Ltd › Farms');
  });

  it('gives no heading to the two pages that print their own name', () => {
    expect(directoryHeading({ kind: 'town', path: 'Towns\\Helartia.five', classId: '1' })).toBe('');
    expect(directoryHeading({ kind: 'facility', path: 'P', name: 'House' })).toBe('');
  });
});
