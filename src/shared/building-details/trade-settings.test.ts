import { describe, it, expect } from '@jest/globals';
import {
  TRADE_MODES,
  TRADE_MODE_VALUES,
  TRADE_LEVEL_VALUES,
  isTradeModeValue,
  tradeModeLabel,
  tradeLevelOptions,
  tradeLevelToOption,
  tradeLevelLabel,
} from './trade-settings';

describe('trade mode (RDOSetRole)', () => {
  it('offers exactly the three roles cbMode carried', () => {
    expect(TRADE_MODE_VALUES).toEqual([2, 5, 6]);
    expect(TRADE_MODES.map(m => m.label))
      .toEqual(['Company Warehouse', 'Exporter', 'Importer']);
  });

  it('recognises a role the combo is shown for', () => {
    for (const value of TRADE_MODE_VALUES) {
      expect(isTradeModeValue(String(value))).toBe(true);
    }
  });

  /** 0/1/3/4 are the roles Voyager hides the combo for — no control, no write. */
  it('rejects every other role, and anything that does not parse', () => {
    for (const raw of ['0', '1', '3', '4', '7', '', 'x']) {
      expect(isTradeModeValue(raw)).toBe(false);
    }
  });

  it('names a legal role and echoes an illegal one', () => {
    expect(tradeModeLabel('5')).toBe('Exporter');
    expect(tradeModeLabel('1')).toBe('1');
  });
});

describe('trade level (RDOSetTradeLevel)', () => {
  it('offers 0, 2 and 3 — never 1', () => {
    expect(TRADE_LEVEL_VALUES).toEqual([0, 2, 3]);
    expect(TRADE_LEVEL_VALUES).not.toContain(1);
  });

  it('labels item 0 with the owner, the other two with their captions', () => {
    expect(tradeLevelOptions('Bob')).toEqual([
      { value: 0, label: 'Only Bob' },
      { value: 2, label: 'Allies only' },
      { value: 3, label: 'Anyone' },
    ]);
  });

  /** tlvPupil (1) has no item of its own: Voyager selects item 0 for it. */
  it('reads a stored 1 as item 0', () => {
    expect(tradeLevelToOption('1')).toBe(0);
    expect(tradeLevelLabel('1', 'Bob')).toBe('Only Bob');
  });

  it('reads the three legal levels as themselves', () => {
    expect(tradeLevelToOption('0')).toBe(0);
    expect(tradeLevelToOption('2')).toBe(2);
    expect(tradeLevelToOption('3')).toBe(3);
    expect(tradeLevelLabel('2', 'Bob')).toBe('Allies only');
    expect(tradeLevelLabel('3', 'Bob')).toBe('Anyone');
  });

  it('falls back to the raw value for a level it cannot place', () => {
    expect(tradeLevelToOption('7')).toBeUndefined();
    expect(tradeLevelToOption('x')).toBeUndefined();
    expect(tradeLevelLabel('7', 'Bob')).toBe('7');
    expect(tradeLevelLabel('', 'Bob')).toBe('');
  });
});
