/**
 * The Map surface's data layer — the single place that decides a tile's colour, and the
 * transparent canvas painted from it. Ports Voyager's data map (`~/SPO-Original/Voyager/Map.pas`,
 * `:3732-3778` for the priority order, `:6930-6950` for `GetBuildingColor`, `:3678-3688` for
 * `DimColor`). Pure, no React — `MapSurface.tsx` calls `buildDataLayer` from its draw effect.
 */

import type { MapBuilding, MapSegment } from '@/shared/types';
import { tileToColormapPixel, type RGB, type TerrainColormap } from '../../ui/minimap-colormap';

export const SELECTED_RGB: RGB = [255, 255, 255];     // Map.pas:360
export const LOSING_RGB: RGB = [255, 0, 0];           // Map.pas:364 (clRed)
export const ROAD_RGB: RGB = [63, 63, 63];            // Map.pas:361
export const CONCRETE_RGB: RGB = [95, 95, 95];        // Map.pas:363
export const UNKNOWN_OWN_RGB: RGB = [127, 127, 127];  // Map.pas:358 cBuildingsColor
export const UNKNOWN_FOREIGN_RGB: RGB = [95, 95, 95]; // Map.pas:359 cGlassedColor

/** Zone → colour, Map.pas:6932-6942 (TColor $00BBGGRR → [R,G,B]); 8 and 9 are WebClient choices [INFERRED]. */
export const ZONE_RGB: Record<number, RGB> = {
  1: [128, 0, 0],
  2: [0, 128, 128],
  3: [192, 255, 187],
  4: [79, 163, 67],
  5: [35, 72, 30],
  6: [215, 217, 136],
  7: [73, 116, 216],
  8: [240, 128, 255],
  9: [120, 200, 255],
};
export const COMMERCIAL_ZONE = 7; // the fallback for znNone, Map.pas:6949

export interface TileFacts {
  building?: MapBuilding;   // the building sitting on the tile
  zoneType?: number;        // its class's zone when the class is known, undefined otherwise
  hasRoad?: boolean;
  hasConcrete?: boolean;
  selected?: boolean;       // the tile belongs to the selected building
}

/** DimColor, Map.pas:3678-3688 — clamped at 0 instead of byte-wrapping. */
export function dimColor([r, g, b]: RGB): RGB {
  return [Math.max(0, r - 30), Math.max(0, g - 59), Math.max(0, b - 11)];
}

/** The legacy's priority order, Map.pas:3732-3778. `null` = bare ground, the terrain shows through. */
export function tileColor(f: TileFacts, myTycoonId: number): RGB | null {
  if (f.selected) return SELECTED_RGB;

  const building = f.building;
  if (building) {
    const own = myTycoonId !== 0 && building.tycoonId === myTycoonId;
    if (building.alert && own) return LOSING_RGB;

    if (f.zoneType === undefined) return own ? UNKNOWN_OWN_RGB : UNKNOWN_FOREIGN_RGB;
    const colour = ZONE_RGB[f.zoneType || COMMERCIAL_ZONE] ?? ZONE_RGB[COMMERCIAL_ZONE];
    return own ? colour : dimColor(colour);
  }

  if (f.hasRoad) return ROAD_RGB;
  if (f.hasConcrete) return CONCRETE_RGB;
  return null;
}

export interface DataLayerInput {
  buildings: MapBuilding[];
  segments: MapSegment[];
  concreteTiles: Iterable<string>;                     // "x,y"
  zoneOf: (visualClass: string) => number | undefined;
  myTycoonId: number;
  selection: { x: number; y: number; xsize: number; ysize: number } | null;
}

function writePixel(px: Uint8ClampedArray, cw: number, p: { px: number; py: number }, [r, g, b]: RGB): void {
  const idx = (p.py * cw + p.px) * 4;
  px[idx] = r;
  px[idx + 1] = g;
  px[idx + 2] = b;
  px[idx + 3] = 255;
}

/** A transparent colormap-sized canvas holding everything but the terrain; null without a 2D context. */
export function buildDataLayer(cm: TerrainColormap, input: DataLayerInput): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = cm.width;
  canvas.height = cm.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imgData = ctx.createImageData(cm.width, cm.height);
  const px = imgData.data;

  // Ascending priority: concrete, then roads, then buildings, then the selection footprint —
  // the later write wins, so each pixel ends up with the colour `tileColor` would give the
  // richest fact set for that tile.
  for (const key of input.concreteTiles) {
    const [x, y] = key.split(',').map(Number);
    const colour = tileColor({ hasConcrete: true }, input.myTycoonId);
    if (colour) writePixel(px, cm.width, tileToColormapPixel(cm, x, y), colour);
  }

  for (const seg of input.segments) {
    const minX = Math.min(seg.x1, seg.x2);
    const maxX = Math.max(seg.x1, seg.x2);
    const minY = Math.min(seg.y1, seg.y2);
    const maxY = Math.max(seg.y1, seg.y2);
    const colour = tileColor({ hasRoad: true }, input.myTycoonId);
    if (!colour) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        writePixel(px, cm.width, tileToColormapPixel(cm, x, y), colour);
      }
    }
  }

  for (const building of input.buildings) {
    const colour = tileColor({ building, zoneType: input.zoneOf(building.visualClass) }, input.myTycoonId);
    if (colour) writePixel(px, cm.width, tileToColormapPixel(cm, building.x, building.y), colour);
  }

  if (input.selection) {
    const { x, y, xsize, ysize } = input.selection;
    const colour = tileColor({ selected: true }, input.myTycoonId) as RGB;
    for (let dy = 0; dy < ysize; dy++) {
      for (let dx = 0; dx < xsize; dx++) {
        writePixel(px, cm.width, tileToColormapPixel(cm, x + dx, y + dy), colour);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
