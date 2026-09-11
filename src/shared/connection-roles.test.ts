/**
 * The Role bitmask, checked against the two reference forms.
 *
 * 54 and 78 are not chosen numbers: 54 is the `#54` of the captured
 * FindSuppliers trace (`src/server/__tests__/rdo/connection-search.test.ts:9`),
 * and 78 is what `InputSearchHandlerViewer.pas:313-327` produces with every box
 * ticked. A table that starts at rolProducer = 1 gives 27 and 15 instead —
 * every checkbox filtering on its neighbour's member.
 */

import { describe, it, expect } from '@jest/globals';
import {
  ROL_NEUTRAL, ROL_PRODUCER, ROL_DISTRIBUTER, ROL_BUYER,
  ROL_IMPORTER, ROL_COMP_EXPORT, ROL_COMP_INPORT,
  ALL_CONNECTION_ROLES, rolesToMask,
  type ConnectionRoleFlags,
} from './connection-roles';

const NONE: ConnectionRoleFlags = {
  producer: false, distributer: false, importer: false,
  exporter: false, buyer: false, compImporter: false,
};

describe('TFacilityRole bit values', () => {
  it('gives every member the bit of its ordinal, rolNeutral first', () => {
    expect([
      ROL_NEUTRAL, ROL_PRODUCER, ROL_DISTRIBUTER, ROL_BUYER,
      ROL_IMPORTER, ROL_COMP_EXPORT, ROL_COMP_INPORT,
    ]).toEqual([1, 2, 4, 8, 16, 32, 64]);
  });
});

describe('rolesToMask', () => {
  it('all boxes ticked on a supplier search is 54', () => {
    // rolProducer(2) | rolDistributer(4) | rolImporter(16) | rolCompExport(32)
    expect(rolesToMask('input', ALL_CONNECTION_ROLES)).toBe(54);
  });

  it('all boxes ticked on a customer search is 78', () => {
    // rolProducer(2) | rolDistributer(4) | rolBuyer(8) | rolCompInport(64)
    expect(rolesToMask('output', ALL_CONNECTION_ROLES)).toBe(78);
  });

  it('Factories alone is rolProducer in either direction', () => {
    const factoriesOnly = { ...NONE, producer: true };
    expect(rolesToMask('input', factoriesOnly)).toBe(2);
    expect(rolesToMask('output', factoriesOnly)).toBe(2);
  });

  it('nothing ticked is 0 — byte([]), with no fallback', () => {
    expect(rolesToMask('input', NONE)).toBe(0);
    expect(rolesToMask('output', NONE)).toBe(0);
  });

  it('a flag the direction does not show never contributes', () => {
    // The two dialogs remember their filters; without this the boxes of the
    // other direction would keep filtering invisibly.
    expect(rolesToMask('input', { ...NONE, buyer: true, compImporter: true })).toBe(0);
    expect(rolesToMask('output', { ...NONE, importer: true, exporter: true })).toBe(0);
  });

  it('each remaining box contributes exactly the member its caption names', () => {
    expect(rolesToMask('input', { ...NONE, distributer: true })).toBe(ROL_DISTRIBUTER);
    expect(rolesToMask('input', { ...NONE, importer: true })).toBe(ROL_IMPORTER);
    expect(rolesToMask('input', { ...NONE, exporter: true })).toBe(ROL_COMP_EXPORT);
    expect(rolesToMask('output', { ...NONE, distributer: true })).toBe(ROL_DISTRIBUTER);
    expect(rolesToMask('output', { ...NONE, buyer: true })).toBe(ROL_BUYER);
    expect(rolesToMask('output', { ...NONE, compImporter: true })).toBe(ROL_COMP_INPORT);
  });

  it('ALL_CONNECTION_ROLES has every box ticked', () => {
    expect(Object.values(ALL_CONNECTION_ROLES).every(Boolean)).toBe(true);
  });
});
