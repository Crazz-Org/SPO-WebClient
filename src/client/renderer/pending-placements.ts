/**
 * Pending placements — the greyed sprites drawn for building placements whose
 * server answer has not come back yet.
 *
 * One entry per in-flight placement, keyed by the target tile the same way
 * `buildingEffects` keys its own entries (`${x},${y}`,
 * isometric-map-renderer.ts). An entry is removed when the request settles;
 * success, refusal, timeout and disconnect all land in the same `finally` in
 * build-menu-handler.ts. The TTL below is only a leak stop: it is deliberately
 * LONGER than the client's own 200 s request deadline (client.ts:638), so the
 * request's own rejection is always what clears a placeholder and this can
 * never fire while a request is genuinely still in flight.
 */
export const PENDING_PLACEMENT_TTL_MS = 210_000;

export interface PendingPlacement {
  /** NW-corner tile column (world x) — the coordinate the request carries. */
  x: number;
  /** NW-corner tile row (world y). */
  y: number;
  visualClass: string;
  xsize: number;
  ysize: number;
  /** Build-menu icon, used when CLASSES.BIN holds no sprite for the class. */
  fallbackIconUrl?: string;
  /** `Date.now()` when the request left. */
  startedAt: number;
}

export function pendingPlacementKey(x: number, y: number): string {
  return `${x},${y}`;
}

export class PendingPlacementLayer {
  private readonly entries = new Map<string, PendingPlacement>();

  constructor(private readonly ttlMs: number = PENDING_PLACEMENT_TTL_MS) {}

  /** Record one in-flight placement; returns the key its answer must clear. */
  add(placement: PendingPlacement): string {
    const key = pendingPlacementKey(placement.x, placement.y);
    this.entries.set(key, placement);
    return key;
  }

  /** Clear one entry. Returns false when the key held nothing. */
  remove(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Entries still worth drawing at `now`, pruning any past its TTL. */
  list(now: number): PendingPlacement[] {
    for (const [key, placement] of this.entries) {
      if (now - placement.startedAt >= this.ttlMs) {
        this.entries.delete(key);
      }
    }
    return Array.from(this.entries.values());
  }

  get size(): number {
    return this.entries.size;
  }

  /** When the oldest entry's TTL runs out (epoch ms), or null when nothing is pending. */
  nextExpiry(): number | null {
    let oldest: number | null = null;
    for (const placement of this.entries.values()) {
      if (oldest === null || placement.startedAt < oldest) oldest = placement.startedAt;
    }
    return oldest === null ? null : oldest + this.ttlMs;
  }

  clear(): void {
    this.entries.clear();
  }
}
