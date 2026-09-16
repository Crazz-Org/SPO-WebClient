/**
 * Research panel utility functions — pure helpers for grouping, sorting,
 * and status detection of invention items across categories.
 */

import type { ResearchInventionItem, ResearchCategoryData } from '@/shared/types';

/** Invention item with a resolved status from its source section. */
export interface MergedInventionItem extends ResearchInventionItem {
  status: 'available' | 'researching' | 'developed';
}

/**
 * Merge available/developing/completed arrays into one list, sorted by status:
 *   1. available + enabled
 *   2. available + disabled (locked)
 *   3. researching
 *   4. developed
 */
export function mergeAndSortInventions(data: ResearchCategoryData): MergedInventionItem[] {
  const merged: MergedInventionItem[] = [];

  for (const item of data.available) {
    merged.push({ ...item, status: 'available' });
  }
  for (const item of data.developing) {
    merged.push({ ...item, status: 'researching' });
  }
  for (const item of data.completed) {
    merged.push({ ...item, status: 'developed' });
  }

  merged.sort((a, b) => statusOrder(a) - statusOrder(b));
  return merged;
}

/** Sort key: available+enabled=0, available+disabled=1, researching=2, developed=3. */
function statusOrder(item: MergedInventionItem): number {
  if (item.status === 'available') return item.enabled !== false ? 0 : 1;
  if (item.status === 'researching') return 2;
  return 3;
}

/**
 * Group merged items by their `parent` field.
 * Returns entries in insertion order (first-seen parent first).
 * Items without a parent go under the empty string key.
 */
export function groupInventionsByParent(
  items: MergedInventionItem[],
): Map<string, MergedInventionItem[]> {
  const map = new Map<string, MergedInventionItem[]>();
  for (const item of items) {
    const key = item.parent ?? '';
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * True if at least one item in the group is available and enabled
 * (determines green vs grey accordion header).
 */
export function isGroupResearchable(items: MergedInventionItem[]): boolean {
  return items.some((i) => i.status === 'available' && i.enabled !== false);
}

/**
 * Count total available (enabled) inventions for a category.
 */
export function countAvailableEnabled(data: ResearchCategoryData): number {
  return data.available.filter((i) => i.enabled !== false).length;
}

/**
 * Count merged items by status for group header badges.
 * Available counts only enabled (unlocked) items.
 */
export function countByStatus(items: MergedInventionItem[]): { avail: number; dev: number; has: number } {
  let avail = 0, dev = 0, has = 0;
  for (const item of items) {
    if (item.status === 'available' && item.enabled !== false) avail++;
    else if (item.status === 'researching') dev++;
    else if (item.status === 'developed') has++;
  }
  return { avail, dev, has };
}

// =============================================================================
// ONGOING RESEARCH BLOCK (#888)
// =============================================================================

export type ResearchPendingOp = 'queue' | 'cancel';

export interface ResearchPendingEntry {
  op: ResearchPendingOp;
  timestamp: number;
}

/** An unsettled optimistic mark older than this is ignored (the server's view wins). */
export const RESEARCH_PENDING_TTL_MS = 60_000;

export interface OngoingResearchItem extends MergedInventionItem {
  /** Which category tab this item came from. */
  categoryIndex: number;
  /** True while the write that put it here has not been agreed by a server read. */
  isPending: boolean;
}

/**
 * Aggregate every `developing` item across all loaded categories, plus any
 * `available` item with a live 'queue' op, into one honestly-ordered list
 * for the "In research queue" block (#888).
 */
export function collectOngoingResearch(
  inventoryByCategory: ReadonlyMap<number, ResearchCategoryData>,
  pendingOps: ReadonlyMap<string, ResearchPendingEntry>,
  now: number = Date.now(),
): OngoingResearchItem[] {
  const isLive = (inventionId: string): boolean => {
    const entry = pendingOps.get(inventionId);
    return !!entry && now - entry.timestamp < RESEARCH_PENDING_TTL_MS;
  };

  const result: OngoingResearchItem[] = [];
  const emitted = new Set<string>();
  const categoryIndices = Array.from(inventoryByCategory.keys()).sort((a, b) => a - b);

  for (const categoryIndex of categoryIndices) {
    const data = inventoryByCategory.get(categoryIndex);
    if (!data) continue;

    for (const item of data.developing) {
      if (emitted.has(item.inventionId)) continue;
      const entry = pendingOps.get(item.inventionId);
      if (entry && entry.op === 'cancel' && isLive(item.inventionId)) continue;
      emitted.add(item.inventionId);
      result.push({ ...item, status: 'researching', categoryIndex, isPending: isLive(item.inventionId) });
    }

    for (const item of data.available) {
      if (emitted.has(item.inventionId)) continue;
      const entry = pendingOps.get(item.inventionId);
      if (!entry || entry.op !== 'queue' || !isLive(item.inventionId)) continue;
      emitted.add(item.inventionId);
      result.push({ ...item, status: 'researching', categoryIndex, isPending: true });
    }
  }

  return result;
}
