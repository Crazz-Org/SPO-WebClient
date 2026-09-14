/**
 * The tiles a zoning drag would actually take, mirroring the one condition
 * `TWorld.RDODefineZone` applies per tile (`World.pas:4546`):
 *
 *   if (fZones[y, x] <> TZoneType(ZoneId)) and
 *      ((TZoneType(ZoneId) = znNone) or (RchMatrix[x - x1, y - y1] <> rchNone)) and
 *      (zRole or ZonerHasAccess( x, y ))
 *
 * A de-zone (`ZoneId = 0`) is exempt from the road test — it only needs
 * authority, which this pure module does not model (the server is the only
 * filter on the request itself; see `zone-handler.ts`). For zones 1..9 the
 * legacy client greyed out a tile occupied by a building or with no road
 * within reach — `[axRoadAround, axBuilding]`, `MapIsoHandler.pas:214-216`,
 * `IfNotRoadArround` at `Map.pas:2704-2727`.
 */

/** Road reach the server applies to a zoning rectangle — `World.pas:4527-4529`, tolerance from `Map.pas:34`. */
export const ZONE_ROAD_TOLERANCE = 7;

export interface ZoneTileFacts {
  occupiedByBuilding: boolean;
  roadInReach: boolean;
}

/** De-zone (0) is exempt from both tests — `World.pas:4546`. */
export function isZonePaintable(zoneId: number, facts: ZoneTileFacts): boolean {
  if (zoneId === 0) return true;
  return !facts.occupiedByBuilding && facts.roadInReach;
}

/** The tiles of a rectangle that would take the zone, in row-major order. */
export function zonePaintableTiles(
  zoneId: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  probe: (x: number, y: number) => ZoneTileFacts,
): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isZonePaintable(zoneId, probe(x, y))) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}
