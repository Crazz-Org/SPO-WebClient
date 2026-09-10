import { describe, it, expect } from '@jest/globals';
import {
  FACILITY_ROLE,
  ALL_CONNECTION_ROLES,
  rolesToMask,
  type ConnectionRoleFlags,
} from './connection-roles';

/** Everything off — a base to tick exactly one box on. */
const NONE: ConnectionRoleFlags = {
  producer: false, distributer: false, importer: false,
  buyer: false, compExport: false, compInport: false,
};

describe('FACILITY_ROLE', () => {
  it('is the TFacilityRoleSet byte, bit n = enum ordinal n (CacheCommon.pas:53)', () => {
    expect(FACILITY_ROLE).toEqual({
      neutral: 1, producer: 2, distributer: 4, buyer: 8,
      importer: 16, compExport: 32, compInport: 64,
    });
  });
});

describe('rolesToMask', () => {
  it('sends 54 for a supplier search with every box ticked', () => {
    // rolCompExport 32 | rolDistributer 4 | rolImporter 16 | rolProducer 2 — the value of the
    // captured trace (connection-search.test.ts:9).
    expect(rolesToMask('input', ALL_CONNECTION_ROLES)).toBe(54);
  });

  it('sends 78 for a customer search with every box ticked', () => {
    // rolCompInport 64 | rolDistributer 4 | rolBuyer 8 | rolProducer 2.
    expect(rolesToMask('output', ALL_CONNECTION_ROLES)).toBe(78);
  });

  it('sends rolProducer (2), not rolNeutral (1), for Factories alone', () => {
    const factoriesOnly = { ...NONE, producer: true };
    expect(rolesToMask('input', factoriesOnly)).toBe(2);
    expect(rolesToMask('output', factoriesOnly)).toBe(2);
  });

  it('reaches rolCompExport (32) from the supplier form only', () => {
    const box = { ...NONE, compExport: true };
    expect(rolesToMask('input', box)).toBe(32);
    expect(rolesToMask('output', box)).toBe(0);
  });

  it('reaches rolCompInport (64) from the customer form only', () => {
    const box = { ...NONE, compInport: true };
    expect(rolesToMask('output', box)).toBe(64);
    expect(rolesToMask('input', box)).toBe(0);
  });

  it('keeps Trade Centers out of a customer search and Stores out of a supplier search', () => {
    // Voyager's customer form has no Trade Centers box, and its supplier form no Stores box —
    // which is why 78 excludes bit 16 and 54 excludes bit 8.
    expect(rolesToMask('output', { ...NONE, importer: true })).toBe(0);
    expect(rolesToMask('input', { ...NONE, buyer: true })).toBe(0);
  });

  it('sends 0 when no box is ticked, exactly as Voyager sends byte([])', () => {
    expect(rolesToMask('input', NONE)).toBe(0);
    expect(rolesToMask('output', NONE)).toBe(0);
  });

  it('never sets rolNeutral — no checkbox names it', () => {
    for (const direction of ['input', 'output'] as const) {
      expect(rolesToMask(direction, ALL_CONNECTION_ROLES) & FACILITY_ROLE.neutral).toBe(0);
    }
  });
});
