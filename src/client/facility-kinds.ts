/**
 * Facility KINDS derived from the world's own class catalogue (issue #598) — never a
 * hard-coded table like Voyager's 58-id `HideFacilities` list.
 */

import { FacilityDimensions } from '../shared/types';

export interface FacilityKind {
  facId: number;
  label: string;
}

/**
 * The kinds THIS world's class catalogue actually declares.
 *
 * `dimensions` is keyed by both visual class and name (`facility-dimensions-cache.ts`), so
 * every facility appears twice — grouping by `facId` makes the duplication harmless. An entry
 * whose `facId` is `undefined` or `0` (the parser's "absent" default, `classes-bin-parser.ts:344`)
 * is skipped, which is what keeps an unknown class from ever being hidden by accident.
 */
export function facilityKindsFrom(dimensions: Record<string, FacilityDimensions>): FacilityKind[] {
  const byFacId = new Map<number, FacilityDimensions>();

  for (const entry of Object.values(dimensions)) {
    const facId = entry.facId;
    if (!facId) continue;

    const current = byFacId.get(facId);
    if (!current || parseInt(entry.visualClass, 10) < parseInt(current.visualClass, 10)) {
      byFacId.set(facId, entry);
    }
  }

  const kinds: FacilityKind[] = [];
  for (const [facId, entry] of byFacId) {
    kinds.push({ facId, label: entry.name || `Facility ${facId}` });
  }

  return kinds.sort((a, b) => a.label.localeCompare(b.label) || a.facId - b.facId);
}

/** True only when the class resolves to a facId that is explicitly hidden. */
export function isFacilityKindHidden(
  hiddenFacIds: ReadonlySet<number>,
  dims: { facId?: number } | undefined,
): boolean {
  if (hiddenFacIds.size === 0) return false;
  if (!dims?.facId) return false;
  return hiddenFacIds.has(dims.facId);
}
