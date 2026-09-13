/**
 * Explored blocks — the fog-of-war seen-set.
 *
 * Voyager tracked this per 64-tile block (`cBlockBits = 6`, `Map.pas:119`) and darkened the
 * ground of a block whose `fSeen` was false (`Map.pas:1065-1066`). This module is the WebClient's
 * equivalent record: which 64x64 blocks this player has ever had loaded from the server, in this
 * world. Persisted to `localStorage` — decision stated in the card, not an accident — using the
 * same `storage()` guard and try/catch discipline as `remembered-session.ts:25-31`.
 */

export const BLOCK_SIZE = 64;
export const EXPLORED_KEY_PREFIX = 'spo.explored.';

/** The key the seen-set is written under — one per world and player. */
export function exploredKey(world: string, player: string): string {
  return `${EXPLORED_KEY_PREFIX}${world || 'world'}.${player || 'player'}`;
}

/** The `"x,y"` key of the 64x64 block holding tile (x, y). */
export function blockKey(x: number, y: number): string {
  const bx = Math.floor(x / BLOCK_SIZE) * BLOCK_SIZE;
  const by = Math.floor(y / BLOCK_SIZE) * BLOCK_SIZE;
  return `${bx},${by}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const BLOCK_KEY_RE = /^\d+,\d+$/;

/** The set of blocks a player has ever loaded, in one world. */
export class ExploredBlocks {
  private readonly keys: Set<string>;

  constructor(private readonly storageKey: string, keys: Iterable<string> = []) {
    this.keys = new Set(keys);
  }

  /** Read the persisted set for this world+player; unreadable/corrupt → empty set. */
  static load(world: string, player: string): ExploredBlocks {
    const key = exploredKey(world, player);
    try {
      const raw = storage()?.getItem(key);
      if (!raw) return new ExploredBlocks(key);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new ExploredBlocks(key);
      const kept = parsed.filter((k): k is string => typeof k === 'string' && BLOCK_KEY_RE.test(k));
      return new ExploredBlocks(key, kept);
    } catch {
      return new ExploredBlocks(key);
    }
  }

  /** True iff the block holding tile (x, y) has been loaded at least once. */
  has(x: number, y: number): boolean {
    return this.keys.has(blockKey(x, y));
  }

  /** Mark the block holding (x, y). Returns true when it was not seen before; persists on change. */
  mark(x: number, y: number): boolean {
    const key = blockKey(x, y);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    try {
      storage()?.setItem(this.storageKey, JSON.stringify([...this.keys]));
    } catch {
      /* private mode or a storage that throws — the mark stays in memory for this session */
    }
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
