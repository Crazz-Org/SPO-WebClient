/**
 * Minimap paint — the one place a minimap colour is decided, ported from Voyager's
 * `TWorldMap.GetColor` priority chain (`~/SPO-Original/Voyager/Components/MapIsoView/Map.pas:3855-3918`,
 * constants `:405-413`): selected tile > own losing building > building class/zone colour
 * (dimmed for another company) > road > concrete > leave the terrain alone.
 *
 * Three departures from the bare Delphi, each explained where it applies below:
 *  1. `HideColor` is not read — the shipped CLASSES.BIN carries no `HideColor=` entry at all,
 *     so the class-colour branch is always the zone branch for this world.
 *  2. Zone 8 / 9 (Civics / Offices) take their `ZONE_TYPES` colour, past the legacy's
 *     eight-entry `array [znNone..znCommercial]`.
 *  3. No `fShowLoosing` gate; the loss colour still compares the tycoon, not the company —
 *     the surface's existing, unchanged approximation.
 */

import { ZONE_TYPES, ZoneType, type MapBuilding } from '@/shared/types';
import { tileToColormap, type TerrainColormap } from './minimap-colormap';

export const MINIMAP_SELECTED_COLOR = '#ffffff'; // cSelectedColor, Map.pas:409
export const MINIMAP_LOSING_COLOR = '#ef4444'; // cLoosingColor is clRed (:413); the surface's own red
export const MINIMAP_ROAD_COLOR = '#3f3f3f'; // cRoadsColor, :410
export const MINIMAP_CONCRETE_COLOR = '#5f5f5f'; // cConcretesColor, :412

const ZONE_COLOR_BY_ID = new Map(ZONE_TYPES.map((z) => [z.id, z.color]));

/**
 * The class's colour: its zone colour, or the Commercial one when it has no zone (:7580-7583).
 * `ZoneType.NONE` (0) is the zone-tool's "Erase" entry, not a building zone a class ever
 * carries — an absent or zero `Zone=` both mean "no zone", so both fall to Commercial.
 */
export function zoneColor(zoneType: number | undefined): string {
  if (zoneType) {
    const c = ZONE_COLOR_BY_ID.get(zoneType);
    if (c) return c;
  }
  return ZONE_COLOR_BY_ID.get(ZoneType.COMMERCIAL) as string;
}

/** DimColor, Map.pas:3818-3828 — R-30, G-59, B-11, clamped at 0 where Delphi let a byte wrap. */
export function dimColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 59);
  const b = Math.max(0, (n & 0xff) - 11);
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface MinimapCell {
  building?: Pick<MapBuilding, 'alert' | 'tycoonId'> | null;
  /** The building class's `[General] Zone`, when the dimensions cache knows it. */
  zoneType?: number;
  selected?: boolean;
  hasRoad?: boolean;
  hasConcrete?: boolean;
}

/** The legacy chain above. `null` = leave the pixel to the terrain (:3912-3917). */
export function minimapCellColor(cell: MinimapCell, myTycoonId: number): string | null {
  if (cell.selected) return MINIMAP_SELECTED_COLOR;
  const b = cell.building;
  if (b) {
    const own = myTycoonId !== 0 && b.tycoonId === myTycoonId;
    if (own && b.alert) return MINIMAP_LOSING_COLOR;
    const color = zoneColor(cell.zoneType);
    return own ? color : dimColor(color);
  }
  if (cell.hasRoad) return MINIMAP_ROAD_COLOR;
  if (cell.hasConcrete) return MINIMAP_CONCRETE_COLOR;
  return null;
}

export interface MinimapOverlaySource {
  buildings: MapBuilding[];
  roads: Iterable<{ x: number; y: number }>;
  concrete: Iterable<{ x: number; y: number }>;
  selected: { x: number; y: number } | null;
  myTycoonId: number;
  /** visualClass → `[General] Zone`, from the client's facility dimensions cache. */
  zoneOf: (visualClass: string) => number | undefined;
}

/**
 * Concrete, then roads, then buildings, onto a colormap-sized canvas — later layer wins the
 * pixel, which is the chain's order read bottom-up. `null` with no 2D context (tests).
 */
export function buildMinimapOverlay(cm: TerrainColormap, src: MinimapOverlaySource): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = cm.width;
  canvas.height = cm.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const isSelected = (x: number, y: number) => !!src.selected && src.selected.x === x && src.selected.y === y;

  const paint = (x: number, y: number, cell: MinimapCell) => {
    const color = minimapCellColor(cell, src.myTycoonId);
    if (!color) return;
    const { cx, cy } = tileToColormap(cm, x, y);
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(cx), Math.floor(cy), 1, 1);
  };

  for (const { x, y } of src.concrete) {
    paint(x, y, { hasConcrete: true, selected: isSelected(x, y) });
  }
  for (const { x, y } of src.roads) {
    paint(x, y, { hasRoad: true, selected: isSelected(x, y) });
  }
  for (const b of src.buildings) {
    paint(b.x, b.y, { building: b, zoneType: src.zoneOf(b.visualClass), selected: isSelected(b.x, b.y) });
  }

  return canvas;
}
