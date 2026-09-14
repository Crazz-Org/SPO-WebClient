/**
 * zonePickerOptions — the legacy MayorOptions.asp zone set, per office.
 */

import { describe, it, expect } from '@jest/globals';
import { ZoneType } from '@/shared/types';
import type { PoliticalRoleInfo } from '@/shared/types';
import { zonePickerOptions } from './zone-picker-options';

const baseRole: PoliticalRoleInfo = {
  tycoonName: 'spo_test3',
  isMayor: false,
  town: '',
  isCapitalMayor: false,
  isPresident: false,
  isMinister: false,
  ministry: '',
  queriedAt: 0,
};

function ids(role: PoliticalRoleInfo | undefined): number[] {
  return zonePickerOptions(role).map((z) => z.id);
}

const MAYOR_IDS = [3, 4, 5, 7, 6, 8, 9, 0];

describe('zonePickerOptions', () => {
  it('no role at all -> no picker', () => {
    expect(zonePickerOptions(undefined)).toEqual([]);
  });

  it('a role with every office flag false -> no picker', () => {
    expect(ids({ ...baseRole })).toEqual([]);
  });

  it('mayor -> the seven zones plus De-zone, in legacy order', () => {
    expect(ids({ ...baseRole, isMayor: true, town: 'Helartia' })).toEqual(MAYOR_IDS);
  });

  it('president -> the same set as mayor', () => {
    expect(ids({ ...baseRole, isPresident: true })).toEqual(MAYOR_IDS);
  });

  it('capital mayor -> the same set as mayor', () => {
    expect(ids({ ...baseRole, isCapitalMayor: true })).toEqual(MAYOR_IDS);
  });

  it('president and mayor together -> the mayor set, no duplicates', () => {
    expect(ids({ ...baseRole, isPresident: true, isMayor: true, town: 'Helartia' })).toEqual(MAYOR_IDS);
  });

  it('minister of Housing -> 3,4,5 plus De-zone', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: 'Housing' })).toEqual([3, 4, 5, 0]);
  });

  it('minister of Commerce -> 7,9 plus De-zone', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: 'Commerce' })).toEqual([7, 9, 0]);
  });

  it.each(['Heavy Industry', 'Light Industry', 'Agriculture'])('minister of %s -> 6 plus De-zone', (ministry) => {
    expect(ids({ ...baseRole, isMinister: true, ministry })).toEqual([6, 0]);
  });

  it.each(['Education', 'Health', 'Defense'])('minister of %s -> 8 plus De-zone', (ministry) => {
    expect(ids({ ...baseRole, isMinister: true, ministry })).toEqual([8, 0]);
  });

  it('unknown ministry -> only De-zone', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: 'Tourism' })).toEqual([0]);
  });

  it('empty ministry string -> only De-zone', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: '' })).toEqual([0]);
  });

  it('"Ministry of Housing" normalises the same as "Housing"', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: 'Ministry of Housing' })).toEqual([3, 4, 5, 0]);
  });

  it('"  HOUSING  " normalises the same as "Housing"', () => {
    expect(ids({ ...baseRole, isMinister: true, ministry: '  HOUSING  ' })).toEqual([3, 4, 5, 0]);
  });

  it('never returns Reserved or Residential, across every branch', () => {
    const roles: PoliticalRoleInfo[] = [
      { ...baseRole, isMayor: true },
      { ...baseRole, isPresident: true },
      { ...baseRole, isCapitalMayor: true },
      { ...baseRole, isMinister: true, ministry: 'Housing' },
      { ...baseRole, isMinister: true, ministry: 'Commerce' },
      { ...baseRole, isMinister: true, ministry: 'Heavy Industry' },
      { ...baseRole, isMinister: true, ministry: 'Education' },
      { ...baseRole, isMinister: true, ministry: 'Unknown' },
    ];
    for (const role of roles) {
      expect(ids(role)).not.toContain(ZoneType.RESERVED);
      expect(ids(role)).not.toContain(ZoneType.RESIDENTIAL);
    }
  });
});
