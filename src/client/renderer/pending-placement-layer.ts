/**
 * State holder for optimistic building placement (#604).
 *
 * Extracted from IsometricMapRenderer for testability, in the spirit of
 * placement-validation.ts. Holds one entry per in-flight REQ_PLACE_BUILDING,
 * keyed by target tile, so the response that eventually settles it can find
 * it again.
 */

export interface PendingPlacement {
  x: number; // NW-corner column, exactly what was sent to the server
  y: number; // NW-corner row
  xsize: number;
  ysize: number;
  visualClass: string; // BuildingInfo.visualClassId
  fallbackIconUrl?: string; // BuildingInfo.iconPath — the build-menu icon
}

/**
 * Sized just past the client's own request deadline (client.ts:629, 200 s), so the
 * safety net can never kill a request that is still legitimately in flight.
 */
export const PENDING_PLACEMENT_TTL_MS = 210_000;

export function pendingPlacementKey(x: number, y: number): string {
  return `${x},${y}`;
}

export class PendingPlacementLayer {
  private readonly entriesByKey = new Map<string, PendingPlacement>();
  private readonly timersByKey = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onChange: () => void,
    private readonly ttlMs: number = PENDING_PLACEMENT_TTL_MS,
  ) {}

  add(p: PendingPlacement): string {
    const key = pendingPlacementKey(p.x, p.y);
    const existingTimer = this.timersByKey.get(key);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }
    this.entriesByKey.set(key, p);
    this.timersByKey.set(
      key,
      setTimeout(() => this.remove(key), this.ttlMs),
    );
    this.onChange();
    return key;
  }

  remove(key: string): boolean {
    const timer = this.timersByKey.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timersByKey.delete(key);
    }
    const removed = this.entriesByKey.delete(key);
    if (removed) {
      this.onChange();
    }
    return removed;
  }

  dropWhere(pred: (p: PendingPlacement) => boolean): boolean {
    let dropped = false;
    for (const [key, p] of this.entriesByKey) {
      if (pred(p)) {
        // Inline removal so a single onChange fires for the whole batch below.
        const timer = this.timersByKey.get(key);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.timersByKey.delete(key);
        }
        this.entriesByKey.delete(key);
        dropped = true;
      }
    }
    if (dropped) {
      this.onChange();
    }
    return dropped;
  }

  has(key: string): boolean {
    return this.entriesByKey.has(key);
  }

  get size(): number {
    return this.entriesByKey.size;
  }

  entries(): PendingPlacement[] {
    return Array.from(this.entriesByKey.values());
  }

  clear(): void {
    if (this.entriesByKey.size === 0) return;
    for (const timer of this.timersByKey.values()) {
      clearTimeout(timer);
    }
    this.timersByKey.clear();
    this.entriesByKey.clear();
    this.onChange();
  }
}
