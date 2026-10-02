import { describe, it, expect } from '@jest/globals';
import {
  BACKUP_LABEL,
  contextSentence,
  cx,
  debtState,
  eventCaption,
  facilitiesLabel,
  formatCompactDate,
  formatTimeAgo,
  incomeTone,
  modeExitLabel,
  roleLabel,
  watchersLabel,
  worldLabel,
} from './topbar-model';
import type { TycoonStats } from '../../store/game-store';

function stats(overrides: Partial<TycoonStats> = {}): TycoonStats {
  return {
    username: 'SPO_test3',
    ranking: 12,
    cash: '12,480,300',
    incomePerHour: '184200',
    buildingCount: 14,
    maxBuildings: 50,
    failureLevel: 0,
    ...overrides,
  };
}

describe('topbar-model', () => {
  it('worldLabel upper-cases the world, OFFLINE before it is known', () => {
    expect(worldLabel('Planitia')).toBe('PLANITIA');
    expect(worldLabel('')).toBe('OFFLINE');
  });

  it('formatCompactDate writes "Mon d, yyyy", "..." before the first date push', () => {
    expect(formatCompactDate(new Date(2334, 2, 12))).toBe('Mar 12, 2334');
    expect(formatCompactDate(null)).toBe('...');
  });

  it('formatTimeAgo counts seconds, then minutes, and says nothing without a timestamp', () => {
    expect(formatTimeAgo(null, 1000)).toBe('');
    expect(formatTimeAgo(10_000, 10_000)).toBe('0s ago');
    expect(formatTimeAgo(10_000, 69_999)).toBe('59s ago');
    expect(formatTimeAgo(10_000, 70_000)).toBe('1m ago');
    expect(formatTimeAgo(10_000, 10_000 + 185_000)).toBe('3m ago');
    // A clock that went backwards never shows a negative age
    expect(formatTimeAgo(10_000, 5_000)).toBe('0s ago');
  });

  it('incomeTone follows the sign of the income, neutral when unknown', () => {
    expect(incomeTone(stats({ incomePerHour: '184200' }))).toBe('positive');
    expect(incomeTone(stats({ incomePerHour: '-1200' }))).toBe('negative');
    expect(incomeTone(stats({ incomePerHour: '0' }))).toBe('neutral');
    expect(incomeTone(null)).toBe('neutral');
  });

  it('debtState appears from failureLevel 1, critical from 2, and carries the level', () => {
    expect(debtState(null)).toBeNull();
    expect(debtState(stats({ failureLevel: 0 }))).toBeNull();
    expect(debtState(stats({ failureLevel: undefined }))).toBeNull();
    expect(debtState(stats({ failureLevel: 1 }))).toEqual({
      level: 1,
      critical: false,
      title: 'Debt — level 1. View facilities losing money.',
    });
    expect(debtState(stats({ failureLevel: 2 }))?.critical).toBe(true);
  });

  it('watchersLabel names everyone watching, null for nobody', () => {
    expect(watchersLabel([])).toBeNull();
    expect(watchersLabel(['Crazz', 'SPO_test3'])).toBe('Watching your area: Crazz, SPO_test3');
  });

  it('keeps v1\'s backup sentence', () => {
    expect(BACKUP_LABEL).toBe('Backup in progress — the world is saving; some actions may be slower');
  });

  it('facilitiesLabel is owned/cap', () => {
    expect(facilitiesLabel(stats())).toBe('14/50');
  });

  it('roleLabel names a visitor, else the public-office role', () => {
    expect(roleLabel('Mayor', false)).toBe('Mayor');
    expect(roleLabel('', false)).toBe('');
    expect(roleLabel('', true)).toBe('Visitor');
  });

  it('eventCaption joins date and text with an em dash and keeps the tile only when both coordinates came', () => {
    expect(eventCaption(null)).toBeNull();
    expect(eventCaption({ date: 'd', kind: 0, text: '   ' })).toBeNull();
    expect(eventCaption({ date: '18/02/2026', kind: 1, text: 'Farm built', x: 706, y: 436 })).toEqual({
      label: '18/02/2026 — Farm built',
      tile: { x: 706, y: 436 },
    });
    expect(eventCaption({ date: 'd', kind: 0, text: 'No tile', x: 5 })?.tile).toBeNull();
  });

  it('contextSentence treats a blank answer as "no town here"', () => {
    expect(contextSentence('   ')).toBeNull();
    expect(contextSentence('')).toBeNull();
    expect(contextSentence('Podan')).toBe('Podan');
  });

  it('modeExitLabel names the way out with the mode', () => {
    expect(modeExitLabel('Cancel', 'Connect')).toBe('Cancel — leave Connect mode');
  });

  it('cx drops falsy names', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });
});
