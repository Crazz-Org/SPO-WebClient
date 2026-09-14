/**
 * The tiles the legacy zone-painting drag preview promised, minus the ones the
 * server actually skips.
 *
 * `MapIsoHandler.pas:212-217` sets `exs := [axRoadAround, axBuilding]` for a
 * `ZoneId` in 1..9 and `[]` for anything else (0 = erase included) — that is why
 * erase always previews the full rectangle.
 *
 * `axRoadAround` excludes a tile when `IfNotRoadArround` is true
 * (`Map.pas:2704-2729`), which is true when **no** road tile exists anywhere in
 * `[x-7 .. x+7] x [y-7 .. y+7]` (`cRoadTolerance = 7`, `Map.pas:34`) — the
 * opposite of "bordering a road". The server enforces the same rule:
 * `Kernel/World.pas:4527` builds `GetReachMatrix(x1,y1,x2,y2,7)` and `:4543`
 * skips any tile whose matrix entry is `rchNone` for a non-zero zone.
 *
 * `axBuilding` excludes a tile a building occupies (`Map.pas:2491-2513`,
 * `CheckForBuilding`) — a Voyager-side preview courtesy; the server does not
 * skip a built tile, it re-zones the ground and reports the facility. We
 * reproduce it because the legacy preview did, and it is the honest signal.
 *
 * `Map.pas:1209-1220` shades an excluded tile `loRedded` instead of the zone
 * tint — reproduced by the caller, not this module.
 */

export const ZONE_ROAD_TOLERANCE = 7; // Map.pas:34 cRoadTolerance

export interface ZonePreviewRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ZoneBuildingFootprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function zoneExclusionMask(
  rect: ZonePreviewRect,
  zoneId: number,
  buildings: readonly ZoneBuildingFootprint[],
  hasRoadAt: (x: number, y: number) => boolean,
): boolean[] {
  const width = rect.maxX - rect.minX + 1;
  const height = rect.maxY - rect.minY + 1;
  const mask = new Array<boolean>(width * height).fill(false);

  if (zoneId < 1 || zoneId > 9) return mask;

  const t = ZONE_ROAD_TOLERANCE;
  const padMinX = rect.minX - t;
  const padMinY = rect.minY - t;
  const padWidth = width + 2 * t;
  const padHeight = height + 2 * t;

  // Integral image (1 row/col of padding at the top-left) over the padded 0/1 road grid,
  // so any tile's [x-7..x+7]x[y-7..y+7] window sum is four array reads.
  const sumWidth = padWidth + 1;
  const integral = new Array<number>(sumWidth * (padHeight + 1)).fill(0);
  for (let py = 0; py < padHeight; py++) {
    const worldY = padMinY + py;
    for (let px = 0; px < padWidth; px++) {
      const worldX = padMinX + px;
      const cell = hasRoadAt(worldX, worldY) ? 1 : 0;
      const above = integral[py * sumWidth + (px + 1)];
      const left = integral[(py + 1) * sumWidth + px];
      const aboveLeft = integral[py * sumWidth + px];
      integral[(py + 1) * sumWidth + (px + 1)] = cell + above + left - aboveLeft;
    }
  }

  const windowSum = (x: number, y: number): number => {
    const x0 = x - t - padMinX;
    const y0 = y - t - padMinY;
    const x1 = x + t - padMinX + 1;
    const y1 = y + t - padMinY + 1;
    return (
      integral[y1 * sumWidth + x1] -
      integral[y0 * sumWidth + x1] -
      integral[y1 * sumWidth + x0] +
      integral[y0 * sumWidth + x0]
    );
  };

  for (let y = rect.minY; y <= rect.maxY; y++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      if (windowSum(x, y) === 0) {
        mask[(y - rect.minY) * width + (x - rect.minX)] = true;
      }
    }
  }

  for (const b of buildings) {
    const startX = Math.max(rect.minX, b.x);
    const endX = Math.min(rect.maxX, b.x + b.w - 1);
    const startY = Math.max(rect.minY, b.y);
    const endY = Math.min(rect.maxY, b.y + b.h - 1);
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        mask[(y - rect.minY) * width + (x - rect.minX)] = true;
      }
    }
  }

  return mask;
}
