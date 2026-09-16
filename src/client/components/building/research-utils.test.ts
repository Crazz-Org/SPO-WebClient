/**
 * Tests for research panel utility functions.
 */

import { describe, it, expect } from '@jest/globals';
import type { ResearchCategoryData } from '@/shared/types';
import {
  mergeAndSortInventions,
  groupInventionsByParent,
  isGroupResearchable,
  countAvailableEnabled,
  countByStatus,
  collectOngoingResearch,
  RESEARCH_PENDING_TTL_MS,
  type MergedInventionItem,
} from './research-utils';

const mockData: ResearchCategoryData = {
  categoryIndex: 0,
  available: [
    { inventionId: 'A1', name: 'Alpha', enabled: true, parent: 'Farms' },
    { inventionId: 'A2', name: 'Beta', enabled: false, parent: 'Farms' },
    { inventionId: 'A3', name: 'Gamma', enabled: true, parent: 'Oil' },
  ],
  developing: [
    { inventionId: 'D1', name: 'Delta', parent: 'Farms' },
  ],
  completed: [
    { inventionId: 'C1', name: 'Epsilon', cost: '$5M', parent: 'Oil' },
    { inventionId: 'C2', name: 'Zeta', cost: '$2M', parent: 'Farms' },
  ],
};

describe('mergeAndSortInventions', () => {
  it('merges all three sections and assigns correct status', () => {
    const merged = mergeAndSortInventions(mockData);
    expect(merged).toHaveLength(6);
    expect(merged.filter((i) => i.status === 'available')).toHaveLength(3);
    expect(merged.filter((i) => i.status === 'researching')).toHaveLength(1);
    expect(merged.filter((i) => i.status === 'developed')).toHaveLength(2);
  });

  it('sorts available+enabled before available+disabled', () => {
    const merged = mergeAndSortInventions(mockData);
    const availableItems = merged.filter((i) => i.status === 'available');
    // Enabled items come first
    expect(availableItems[0].enabled).not.toBe(false);
    expect(availableItems[1].enabled).not.toBe(false);
    expect(availableItems[2].enabled).toBe(false);
  });

  it('sorts available before researching before developed', () => {
    const merged = mergeAndSortInventions(mockData);
    const statuses = merged.map((i) => i.status);
    const firstResearching = statuses.indexOf('researching');
    const firstDeveloped = statuses.indexOf('developed');
    const lastAvailable = statuses.lastIndexOf('available');
    expect(lastAvailable).toBeLessThan(firstResearching);
    expect(firstResearching).toBeLessThan(firstDeveloped);
  });

  it('handles empty data', () => {
    const empty: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [],
      completed: [],
    };
    expect(mergeAndSortInventions(empty)).toEqual([]);
  });

  it('handles category with only completed items', () => {
    const completedOnly: ResearchCategoryData = {
      categoryIndex: 2,
      available: [],
      developing: [],
      completed: [{ inventionId: 'X1', name: 'X', cost: '$1M' }],
    };
    const merged = mergeAndSortInventions(completedOnly);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('developed');
  });
});

describe('groupInventionsByParent', () => {
  it('groups items by parent field', () => {
    const merged = mergeAndSortInventions(mockData);
    const groups = groupInventionsByParent(merged);
    expect(groups.size).toBe(2);
    expect(groups.has('Farms')).toBe(true);
    expect(groups.has('Oil')).toBe(true);
  });

  it('places items without parent under empty string key', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'X', name: 'X', status: 'available', enabled: true },
    ];
    const groups = groupInventionsByParent(items);
    expect(groups.has('')).toBe(true);
    expect(groups.get('')).toHaveLength(1);
  });

  it('preserves order within each group', () => {
    const merged = mergeAndSortInventions(mockData);
    const groups = groupInventionsByParent(merged);
    const farmItems = groups.get('Farms')!;
    // Available+enabled first, then disabled, then researching, then developed
    const statuses = farmItems.map((i) => i.status);
    expect(statuses.indexOf('available')).toBeLessThanOrEqual(statuses.indexOf('researching'));
  });

  it('returns empty map for empty input', () => {
    const groups = groupInventionsByParent([]);
    expect(groups.size).toBe(0);
  });
});

describe('isGroupResearchable', () => {
  it('returns true if at least one available+enabled item exists', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'A', name: 'A', status: 'available', enabled: true, parent: 'X' },
      { inventionId: 'B', name: 'B', status: 'developed', parent: 'X' },
    ];
    expect(isGroupResearchable(items)).toBe(true);
  });

  it('returns false when all available items are disabled', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'A', name: 'A', status: 'available', enabled: false, parent: 'X' },
      { inventionId: 'B', name: 'B', status: 'developed', parent: 'X' },
    ];
    expect(isGroupResearchable(items)).toBe(false);
  });

  it('returns false when no available items exist', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'A', name: 'A', status: 'researching', parent: 'X' },
      { inventionId: 'B', name: 'B', status: 'developed', parent: 'X' },
    ];
    expect(isGroupResearchable(items)).toBe(false);
  });

  it('returns false for empty group', () => {
    expect(isGroupResearchable([])).toBe(false);
  });
});

describe('countAvailableEnabled', () => {
  it('counts only enabled available items', () => {
    expect(countAvailableEnabled(mockData)).toBe(2);
  });

  it('returns 0 when all available are disabled', () => {
    const data: ResearchCategoryData = {
      categoryIndex: 0,
      available: [
        { inventionId: 'A', name: 'A', enabled: false },
      ],
      developing: [],
      completed: [],
    };
    expect(countAvailableEnabled(data)).toBe(0);
  });

  it('returns 0 for empty category', () => {
    const data: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [],
      completed: [],
    };
    expect(countAvailableEnabled(data)).toBe(0);
  });
});

describe('countByStatus', () => {
  it('counts mixed statuses correctly', () => {
    const merged = mergeAndSortInventions(mockData);
    const counts = countByStatus(merged);
    expect(counts.avail).toBe(2);  // A1 (enabled) + A3 (enabled), A2 is locked
    expect(counts.dev).toBe(1);    // D1
    expect(counts.has).toBe(2);    // C1 + C2
  });

  it('returns all zeros for empty array', () => {
    const counts = countByStatus([]);
    expect(counts).toEqual({ avail: 0, dev: 0, has: 0 });
  });

  it('excludes locked available items from avail count', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'A', name: 'A', status: 'available', enabled: false, parent: 'X' },
      { inventionId: 'B', name: 'B', status: 'available', enabled: true, parent: 'X' },
    ];
    const counts = countByStatus(items);
    expect(counts.avail).toBe(1);
  });

  it('counts only developed items in has', () => {
    const items: MergedInventionItem[] = [
      { inventionId: 'A', name: 'A', status: 'developed', cost: '$5M', parent: 'X' },
      { inventionId: 'B', name: 'B', status: 'developed', cost: '$2M', parent: 'X' },
      { inventionId: 'C', name: 'C', status: 'researching', parent: 'X' },
    ];
    const counts = countByStatus(items);
    expect(counts.has).toBe(2);
    expect(counts.dev).toBe(1);
    expect(counts.avail).toBe(0);
  });
});

describe('collectOngoingResearch', () => {
  const NOW = 1_000_000;

  /** `name` defaults to the id — the enrichment step does the same when research.0.dat has no entry. */
  function cat(
    categoryIndex: number,
    available: { inventionId: string; name?: string }[],
    developing: { inventionId: string; name?: string }[],
    completed: { inventionId: string; name?: string }[] = [],
  ): ResearchCategoryData {
    const fill = (items: { inventionId: string; name?: string }[]) =>
      items.map((i) => ({ inventionId: i.inventionId, name: i.name ?? i.inventionId }));
    return {
      categoryIndex,
      available: fill(available),
      developing: fill(developing),
      completed: fill(completed),
    };
  }

  it('returns an empty list for an empty inventory', () => {
    expect(collectOngoingResearch(new Map(), new Map(), NOW)).toEqual([]);
  });

  it('returns an empty list when nothing is developing and nothing is pending', () => {
    const inv = new Map([[0, cat(0, [{ inventionId: 'A1', name: 'Alpha' }], [])]]);
    expect(collectOngoingResearch(inv, new Map(), NOW)).toEqual([]);
  });

  it('emits developing items with their category index and no pending mark', () => {
    const inv = new Map([[2, cat(2, [], [{ inventionId: 'D1', name: 'Delta' }])]]);

    const out = collectOngoingResearch(inv, new Map(), NOW);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      inventionId: 'D1',
      name: 'Delta',
      status: 'researching',
      categoryIndex: 2,
      isPending: false,
    });
  });

  it('walks categories in ascending index order, not load order', () => {
    const inv = new Map([
      [3, cat(3, [], [{ inventionId: 'Z' }])],
      [1, cat(1, [], [{ inventionId: 'A' }])],
    ]);

    expect(collectOngoingResearch(inv, new Map(), NOW).map((i) => i.inventionId)).toEqual(['A', 'Z']);
  });

  it('aggregates developing items across every cached category', () => {
    const inv = new Map([
      [0, cat(0, [], [{ inventionId: 'C0' }])],
      [4, cat(4, [], [{ inventionId: 'C4' }])],
    ]);

    expect(collectOngoingResearch(inv, new Map(), NOW).map((i) => i.inventionId)).toEqual(['C0', 'C4']);
  });

  it("promotes an available item carrying a live 'queue' mark", () => {
    const inv = new Map([[0, cat(0, [{ inventionId: 'A1', name: 'Alpha' }], [])]]);
    const pending = new Map([['A1', { op: 'queue' as const, timestamp: NOW }]]);

    const out = collectOngoingResearch(inv, pending, NOW);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ inventionId: 'A1', status: 'researching', isPending: true });
  });

  it("drops a developing item carrying a live 'cancel' mark", () => {
    const inv = new Map([[0, cat(0, [], [{ inventionId: 'D1' }, { inventionId: 'D2' }])]]);
    const pending = new Map([['D1', { op: 'cancel' as const, timestamp: NOW }]]);

    expect(collectOngoingResearch(inv, pending, NOW).map((i) => i.inventionId)).toEqual(['D2']);
  });

  it('marks a developing item pending while its own queue mark is unsettled', () => {
    const inv = new Map([[0, cat(0, [], [{ inventionId: 'D1' }])]]);
    const pending = new Map([['D1', { op: 'queue' as const, timestamp: NOW }]]);

    expect(collectOngoingResearch(inv, pending, NOW)[0].isPending).toBe(true);
  });

  it('ignores a mark older than the TTL, in both directions', () => {
    const stale = NOW - RESEARCH_PENDING_TTL_MS;
    const queueInv = new Map([[0, cat(0, [{ inventionId: 'A1' }], [{ inventionId: 'D1' }])]]);
    const pending = new Map([
      ['A1', { op: 'queue' as const, timestamp: stale }],
      ['D1', { op: 'cancel' as const, timestamp: stale }],
    ]);

    const out = collectOngoingResearch(queueInv, pending, NOW);

    // The stale queue no longer promotes A1; the stale cancel no longer hides D1.
    expect(out.map((i) => i.inventionId)).toEqual(['D1']);
    expect(out[0].isPending).toBe(false);
  });

  it('emits an id once when it appears in two categories', () => {
    const inv = new Map([
      [0, cat(0, [], [{ inventionId: 'DUP', name: 'First' }])],
      [1, cat(1, [{ inventionId: 'DUP', name: 'Second' }], [])],
    ]);
    const pending = new Map([['DUP', { op: 'queue' as const, timestamp: NOW }]]);

    const out = collectOngoingResearch(inv, pending, NOW);

    expect(out).toHaveLength(1);
    expect(out[0].categoryIndex).toBe(0);
  });

  it('falls back to Date.now() when no clock is passed', () => {
    const inv = new Map([[0, cat(0, [{ inventionId: 'A1' }], [])]]);
    const pending = new Map([['A1', { op: 'queue' as const, timestamp: Date.now() }]]);

    expect(collectOngoingResearch(inv, pending)).toHaveLength(1);
  });
});
