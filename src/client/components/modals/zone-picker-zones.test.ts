/**
 * `zonesForOffice` — the legacy `MayorOptions.asp` restriction, one case per
 * row of the office/ministry table.
 */

import { describe, it, expect } from '@jest/globals';
import type { PoliticalRoleInfo } from '@/shared/types';
import { zonesForOffice } from './zone-picker-zones';

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

function role(overrides: Partial<PoliticalRoleInfo>): PoliticalRoleInfo {
  return { ...baseRole, ...overrides };
}

function ids(role: PoliticalRoleInfo | undefined): number[] {
  return zonesForOffice(role).map((z) => z.id);
}

describe('zonesForOffice', () => {
  it('no role → empty list, no picker', () => {
    expect(zonesForOffice(undefined)).toEqual([]);
  });

  it('a cached role with no office flags set → empty list', () => {
    expect(ids(role({}))).toEqual([]);
  });

  it('president → 3,4,5,7,6,8,9,0', () => {
    expect(ids(role({ isPresident: true }))).toEqual([3, 4, 5, 7, 6, 8, 9, 0]);
  });

  it('capital mayor → same set as president', () => {
    expect(ids(role({ isCapitalMayor: true }))).toEqual([3, 4, 5, 7, 6, 8, 9, 0]);
  });

  it('mayor → same set as president', () => {
    expect(ids(role({ isMayor: true, town: 'Helartia' }))).toEqual([3, 4, 5, 7, 6, 8, 9, 0]);
  });

  it('Minister of Housing → 3,4,5,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Housing' }))).toEqual([3, 4, 5, 0]);
  });

  it('Minister of Commerce → 7,9,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Commerce' }))).toEqual([7, 9, 0]);
  });

  it('Minister of Heavy Industry → 6,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Heavy Industry' }))).toEqual([6, 0]);
  });

  it('Minister of Light Industry → 6,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Light Industry' }))).toEqual([6, 0]);
  });

  it('Minister of Agriculture → 6,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Agriculture' }))).toEqual([6, 0]);
  });

  it('Minister of Education → 8,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Education' }))).toEqual([8, 0]);
  });

  it('Minister of Health → 8,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Health' }))).toEqual([8, 0]);
  });

  it('Minister of Defense → 8,0', () => {
    expect(ids(role({ isMinister: true, ministry: 'Defense' }))).toEqual([8, 0]);
  });

  it('a minister with an unrecognised ministry name → De-zone only', () => {
    expect(ids(role({ isMinister: true, ministry: 'Sanitation' }))).toEqual([0]);
  });

  it('a minister with a differently-cased/padded ministry name still resolves', () => {
    expect(ids(role({ isMinister: true, ministry: '  housing  ' }))).toEqual([3, 4, 5, 0]);
  });

  it('ids 1 (Reserved) and 2 (Residential) never appear, for any input', () => {
    const roles: Array<PoliticalRoleInfo | undefined> = [
      undefined,
      role({}),
      role({ isPresident: true }),
      role({ isCapitalMayor: true }),
      role({ isMayor: true }),
      role({ isMinister: true, ministry: 'Housing' }),
      role({ isMinister: true, ministry: 'Commerce' }),
      role({ isMinister: true, ministry: 'Heavy Industry' }),
      role({ isMinister: true, ministry: 'Light Industry' }),
      role({ isMinister: true, ministry: 'Agriculture' }),
      role({ isMinister: true, ministry: 'Education' }),
      role({ isMinister: true, ministry: 'Health' }),
      role({ isMinister: true, ministry: 'Defense' }),
      role({ isMinister: true, ministry: 'Unknown' }),
      role({ isMinister: true, ministry: '' }),
    ];
    for (const r of roles) {
      const list = ids(r);
      expect(list).not.toContain(1);
      expect(list).not.toContain(2);
    }
  });
});
