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
  type ResearchPendingEntry,
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

  it('returns [] for an empty inventory map', () => {
    expect(collectOngoingResearch(new Map(), new Map(), NOW)).toEqual([]);
  });

  it('emits developing items of one loaded category with isPending false', () => {
    const cat0: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'D1', name: 'Delta', parent: 'Farms' }],
      completed: [],
    };
    const result = collectOngoingResearch(new Map([[0, cat0]]), new Map(), NOW);
    expect(result).toEqual([
      { inventionId: 'D1', name: 'Delta', parent: 'Farms', status: 'researching', categoryIndex: 0, isPending: false },
    ]);
  });

  it('emits items from two loaded categories in ascending category order', () => {
    const cat3: ResearchCategoryData = {
      categoryIndex: 3,
      available: [],
      developing: [{ inventionId: 'D3', name: 'FromCat3' }],
      completed: [],
    };
    const cat1: ResearchCategoryData = {
      categoryIndex: 1,
      available: [],
      developing: [{ inventionId: 'D1', name: 'FromCat1' }],
      completed: [],
    };
    // Inserted out of numeric order — the map preserves insertion order, the
    // helper must sort by category index regardless.
    const result = collectOngoingResearch(new Map([[3, cat3], [1, cat1]]), new Map(), NOW);
    expect(result.map((i) => i.categoryIndex)).toEqual([1, 3]);
  });

  it('a live "queue" op promotes an available item as pending', () => {
    const cat0: ResearchCategoryData = {
      categoryIndex: 0,
      available: [{ inventionId: 'A1', name: 'Alpha', enabled: true }],
      developing: [],
      completed: [],
    };
    const pendingOps = new Map<string, ResearchPendingEntry>([
      ['A1', { op: 'queue', timestamp: NOW }],
    ]);
    const result = collectOngoingResearch(new Map([[0, cat0]]), pendingOps, NOW);
    expect(result).toEqual([
      { inventionId: 'A1', name: 'Alpha', enabled: true, status: 'researching', categoryIndex: 0, isPending: true },
    ]);
  });

  it('a live "cancel" op removes a developing item', () => {
    const cat0: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'D1', name: 'Delta' }],
      completed: [],
    };
    const pendingOps = new Map<string, ResearchPendingEntry>([
      ['D1', { op: 'cancel', timestamp: NOW }],
    ]);
    expect(collectOngoingResearch(new Map([[0, cat0]]), pendingOps, NOW)).toEqual([]);
  });

  it('ignores a pending entry older than RESEARCH_PENDING_TTL_MS on both sides', () => {
    const staleTimestamp = NOW - RESEARCH_PENDING_TTL_MS;

    // Stale 'queue' op does not promote an available item.
    const catAvail: ResearchCategoryData = {
      categoryIndex: 0,
      available: [{ inventionId: 'A1', name: 'Alpha' }],
      developing: [],
      completed: [],
    };
    const stalePending = new Map<string, ResearchPendingEntry>([
      ['A1', { op: 'queue', timestamp: staleTimestamp }],
    ]);
    expect(collectOngoingResearch(new Map([[0, catAvail]]), stalePending, NOW)).toEqual([]);

    // Stale 'cancel' op no longer suppresses a developing item — it reappears.
    const catDev: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'D1', name: 'Delta' }],
      completed: [],
    };
    const staleCancel = new Map<string, ResearchPendingEntry>([
      ['D1', { op: 'cancel', timestamp: staleTimestamp }],
    ]);
    const result = collectOngoingResearch(new Map([[0, catDev]]), staleCancel, NOW);
    expect(result).toEqual([
      { inventionId: 'D1', name: 'Delta', status: 'researching', categoryIndex: 0, isPending: false },
    ]);
  });

  it('emits an id present in one category developing and another category available only once', () => {
    const cat0: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'X1', name: 'X' }],
      completed: [],
    };
    const cat1: ResearchCategoryData = {
      categoryIndex: 1,
      available: [{ inventionId: 'X1', name: 'X' }],
      developing: [],
      completed: [],
    };
    const pendingOps = new Map<string, ResearchPendingEntry>([
      ['X1', { op: 'queue', timestamp: NOW }],
    ]);
    const result = collectOngoingResearch(new Map([[0, cat0], [1, cat1]]), pendingOps, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].categoryIndex).toBe(0);
  });
});
