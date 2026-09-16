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

  it('emits developing items of one loaded category with categoryIndex and isPending false', () => {
    const inv = new Map([[0, mockData]]);
    const result = collectOngoingResearch(inv, new Map(), NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ inventionId: 'D1', categoryIndex: 0, isPending: false, status: 'researching' });
  });

  it('iterates loaded categories in ascending numeric order regardless of insertion order', () => {
    const cat0: ResearchCategoryData = { categoryIndex: 0, available: [], developing: [{ inventionId: 'D0', name: 'D0' }], completed: [] };
    const cat3: ResearchCategoryData = { categoryIndex: 3, available: [], developing: [{ inventionId: 'D3', name: 'D3' }], completed: [] };
    // Insert out of order — Map iteration is insertion order.
    const inv = new Map([[3, cat3], [0, cat0]]);
    const result = collectOngoingResearch(inv, new Map(), NOW);
    expect(result.map((i) => i.inventionId)).toEqual(['D0', 'D3']);
  });

  it('a live queue op promotes an available item, marked isPending true', () => {
    const cat: ResearchCategoryData = {
      categoryIndex: 1,
      available: [{ inventionId: 'A1', name: 'Alpha', enabled: true }],
      developing: [],
      completed: [],
    };
    const pending = new Map<string, ResearchPendingEntry>([['A1', { op: 'queue', timestamp: NOW }]]);
    const result = collectOngoingResearch(new Map([[1, cat]]), pending, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ inventionId: 'A1', status: 'researching', isPending: true, categoryIndex: 1 });
  });

  it('a live cancel op removes a developing item from the block', () => {
    const cat: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'D1', name: 'Delta' }],
      completed: [],
    };
    const pending = new Map<string, ResearchPendingEntry>([['D1', { op: 'cancel', timestamp: NOW }]]);
    const result = collectOngoingResearch(new Map([[0, cat]]), pending, NOW);
    expect(result).toEqual([]);
  });

  it('a stale entry (past the TTL) is ignored in both directions', () => {
    const staleTs = NOW - 60_000; // exactly TTL — not < TTL, so already stale
    const catDeveloping: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'D1', name: 'Delta' }],
      completed: [],
    };
    const staleCancel = new Map<string, ResearchPendingEntry>([['D1', { op: 'cancel', timestamp: staleTs }]]);
    // Stale cancel should NOT hide the developing item.
    expect(collectOngoingResearch(new Map([[0, catDeveloping]]), staleCancel, NOW)).toHaveLength(1);

    const catAvailable: ResearchCategoryData = {
      categoryIndex: 0,
      available: [{ inventionId: 'A1', name: 'Alpha', enabled: true }],
      developing: [],
      completed: [],
    };
    const staleQueue = new Map<string, ResearchPendingEntry>([['A1', { op: 'queue', timestamp: staleTs }]]);
    // Stale queue should NOT promote the available item.
    expect(collectOngoingResearch(new Map([[0, catAvailable]]), staleQueue, NOW)).toEqual([]);
  });

  it('an id present in one category developing and another category available is emitted once', () => {
    const cat0: ResearchCategoryData = {
      categoryIndex: 0,
      available: [],
      developing: [{ inventionId: 'Shared', name: 'Shared Item' }],
      completed: [],
    };
    const cat1: ResearchCategoryData = {
      categoryIndex: 1,
      available: [{ inventionId: 'Shared', name: 'Shared Item', enabled: true }],
      developing: [],
      completed: [],
    };
    const pending = new Map<string, ResearchPendingEntry>([['Shared', { op: 'queue', timestamp: NOW }]]);
    const result = collectOngoingResearch(new Map([[0, cat0], [1, cat1]]), pending, NOW);
    expect(result.filter((i) => i.inventionId === 'Shared')).toHaveLength(1);
    expect(result[0].categoryIndex).toBe(0);
  });

  it('empty developing and no pending ops yields []', () => {
    const cat: ResearchCategoryData = {
      categoryIndex: 0,
      available: [{ inventionId: 'A1', name: 'Alpha', enabled: true }],
      developing: [],
      completed: [{ inventionId: 'C1', name: 'Charlie' }],
    };
    expect(collectOngoingResearch(new Map([[0, cat]]), new Map(), NOW)).toEqual([]);
  });
});
