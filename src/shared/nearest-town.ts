import type { TownInfo } from './types/domain-types';

/**
 * The town whose hall is closest to (x, y), or null without towns.
 *
 * LOCAL APPROXIMATION of the server's `TWorld.NearestTown` (`Kernel/World.pas:5905-5933`),
 * which `RDOGetNearestTownHall` wraps (`Kernel/World.pas:4824-4838`) and Voyager's
 * Town Hall button called before `MoveAndSelect` (`MapIsoView.pas:1186-1188`, `:996-1005`).
 * The server has two branches: with a town map it returns the town that OWNS the tile
 * (`TownMap[x, y]`, `:5928-5929`); without one it takes the town minimising the Manhattan
 * distance `abs(xPos - x) + abs(yPos - y)` (`:5921-5924`). This helper implements the
 * second branch over the directory's town list, so near a town border it can disagree
 * with the first — it is not the server's answer, and the client never asks for one.
 */
export function nearestTown(towns: TownInfo[] | undefined, x: number, y: number): TownInfo | null {
  let best: TownInfo | null = null;
  let bestD = Infinity;
  for (const t of towns ?? []) {
    const d = Math.abs(t.x - x) + Math.abs(t.y - y);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}
