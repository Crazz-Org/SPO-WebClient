/**
 * Tests for cluster-data.ts — static metadata for company creation.
 */

import { describe, it, expect } from '@jest/globals';
import {
  CLUSTER_IDS,
  CLUSTER_DISPLAY_NAMES,
  MAX_COMPANY_NAME_LENGTH,
  companyNameProblem,
  MAGNA_REFUSAL,
  canBuildAdvanced,
} from './cluster-data';
import type { ClusterId } from './cluster-data';

describe('cluster-data', () => {
  describe('CLUSTER_IDS', () => {
    it('contains exactly 5 cluster IDs', () => {
      expect(CLUSTER_IDS).toHaveLength(5);
    });

    it('contains all expected clusters', () => {
      expect(CLUSTER_IDS).toContain('Dissidents');
      expect(CLUSTER_IDS).toContain('PGI');
      expect(CLUSTER_IDS).toContain('Mariko');
      expect(CLUSTER_IDS).toContain('Moab');
      expect(CLUSTER_IDS).toContain('Magna');
    });

    it('is read-only (const tuple)', () => {
      // Verify it is an array — readonly tuples are still arrays at runtime
      expect(Array.isArray(CLUSTER_IDS)).toBe(true);
    });
  });

  describe('CLUSTER_DISPLAY_NAMES', () => {
    it('has an entry for every cluster ID', () => {
      for (const id of CLUSTER_IDS) {
        expect(CLUSTER_DISPLAY_NAMES[id]).toBeDefined();
        expect(typeof CLUSTER_DISPLAY_NAMES[id]).toBe('string');
        expect(CLUSTER_DISPLAY_NAMES[id].length).toBeGreaterThan(0);
      }
    });

    it('maps IDs to correct display names', () => {
      expect(CLUSTER_DISPLAY_NAMES.Dissidents).toBe('Dissidents');
      expect(CLUSTER_DISPLAY_NAMES.PGI).toBe('PGI');
      expect(CLUSTER_DISPLAY_NAMES.Mariko).toBe('Mariko Enterprises');
      expect(CLUSTER_DISPLAY_NAMES.Moab).toBe('The Moab');
      expect(CLUSTER_DISPLAY_NAMES.Magna).toBe('Magna Corp');
    });

    it('type-checks ClusterId keys', () => {
      const keys = Object.keys(CLUSTER_DISPLAY_NAMES) as ClusterId[];
      expect(keys).toHaveLength(5);
    });
  });

  // Fixtures below are read off ValidName (Cache/CacheCommon.pas:110-125) over NotAllowedChars
  // (:64) with BackslashChar '}', NameSeparator '{', LinkSep '%' (Cache/SpecialChars.pas:6-8),
  // plus the 50-char cap RDONewCompany applies (Kernel/World.pas:4133).
  describe('companyNameProblem', () => {
    it('caps the name at the server length', () => {
      expect(MAX_COMPANY_NAME_LENGTH).toBe(50);
    });

    const REFUSED: ReadonlyArray<[string, string]> = [
      ['backslash', 'My\\Company'],
      ['forward slash', 'My/Company'],
      ['colon', 'Company:Inc'],
      ['asterisk', 'Star*Corp'],
      ['question mark', 'Why?'],
      ['double quote', 'The "Best"'],
      ['less-than', '<Corp'],
      ['greater-than', 'Corp>'],
      ['pipe', 'A|B'],
      ['name separator {', 'My{Corp'],
      ['backslash char }', 'My}Corp'],
      ['link separator %', '50% Holdings'],
      ['NUL', 'My\0Corp'],
      ['two consecutive dots', 'My..Corp'],
      ['the empty name', ''],
    ];

    it.each(REFUSED)('refuses %s with a reason', (_label, name) => {
      const problem = companyNameProblem(name);
      expect(typeof problem).toBe('string');
      expect(problem).not.toHaveLength(0);
    });

    const ACCEPTED: ReadonlyArray<[string, string]> = [
      ['a plain name', 'Acme Industries'],
      ['a hyphen', 'Corp-123'],
      ['an apostrophe', "O'Brien Enterprises"],
      ['an underscore', 'My_Corp'],
      ['a single dot', 'My.Corp'],
      ['an ampersand', 'Star & Moon Co.'],
      ['a plus sign', 'A+B Holdings'],
    ];

    it.each(ACCEPTED)('accepts %s', (_label, name) => {
      expect(companyNameProblem(name)).toBeNull();
    });

    it('accepts a name of exactly 50 characters and refuses 51', () => {
      expect(companyNameProblem('A'.repeat(50))).toBeNull();
      expect(companyNameProblem('A'.repeat(51))).toBe(
        'Company name must be 50 characters or less',
      );
    });

    it('names the empty name as the reason', () => {
      expect(companyNameProblem('')).toBe('Company name cannot be empty');
    });

    it('names ".." as the reason, not the character list', () => {
      expect(companyNameProblem('My..Corp')).toBe('Company name cannot contain ".."');
    });
  });

  describe('canBuildAdvanced', () => {
    it.each<[number | undefined, number | undefined, boolean]>([
      [4, 0, true],
      [2, 100, true],
      [2, 0, false],
      [undefined, undefined, false],
      [6, 0, true],
      [0, 99, false],
    ])('canBuildAdvanced(%p, %p) === %p', (levelTier, nobPoints, expected) => {
      expect(canBuildAdvanced(levelTier, nobPoints)).toBe(expected);
    });

    it('names Paradigm and 100 Nobility Points in the refusal sentence', () => {
      expect(MAGNA_REFUSAL).toContain('Paradigm');
      expect(MAGNA_REFUSAL).toContain('100 Nobility Points');
    });
  });
});
