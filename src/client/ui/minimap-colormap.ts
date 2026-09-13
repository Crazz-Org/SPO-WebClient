/**
 * Minimap colormap — the downsampled terrain picture and its coordinate transforms, shared by
 * the docked diamond (`MinimapUI`) and the Map surface (`components/map/MapSurface`).
 *
 * The colormap's axes are swapped and flipped on purpose: column = i (flipped), row = j
 * (flipped), so that a 45° rotation of the picture lines its corners up with the isometric
 * view. `tileToColormap` / `colormapToTile` hide that from callers.
 */

import type { AtlasManifest } from '../renderer/texture-atlas-cache';
import type { MapBuilding } from '@/shared/types';

/** What a colormap needs from the renderer (the docked minimap's contract, plus buildings). */
export interface MinimapRendererAPI {
  getCameraPosition(): { x: number; y: number };
  centerOn(x: number, y: number): void;
  getMapDimensions(): { width: number; height: number };
  getMapName(): string;
  getSeason(): number;
  getTerrainType(): string;
  getVisibleTileBounds(): { minI: number; maxI: number; minJ: number; maxJ: number };
  getTerrainPixelData(): { pixelData: Uint8Array; width: number; height: number } | null;
  /** Atlas image + manifest for season-aware color sampling (optional). */
  getAtlasData?(): { atlas: ImageBitmap; manifest: AtlasManifest } | null;
  /** Every building the client has loaded so far (optional — the docked minimap does not draw them). */
  getAllBuildings?(): MapBuilding[];
  /** False when the block holding tile (x, y) was never loaded by this player (optional — the docked minimap does not fog). */
  isTileExplored?(x: number, y: number): boolean;
}

/** Max colormap resolution (tiles per side). */
export const COLORMAP_MAX = 128;

/**
 * LandClass → RGB fallback color for the minimap (used when atlas is unavailable).
 * Index: 0=ZoneA (Grass), 1=ZoneB (MidGrass), 2=ZoneC (DryGround), 3=ZoneD (Water)
 */
export const FALLBACK_COLORS: [number, number, number][] = [
  [74, 140, 82],    // Grass — green
  [128, 140, 68],   // MidGrass — olive
  [180, 148, 90],   // DryGround — sandy brown
  [24, 56, 90],     // Water — deep blue
];

export type RGB = [number, number, number];

/**
 * Sample representative RGB colors from atlas tiles: a landId → [r,g,b] map read from the
 * center pixel of each atlas tile. Returns null when the atlas cannot be read.
 */
export function sampleAtlasColors(atlas: ImageBitmap, manifest: AtlasManifest): Map<number, RGB> | null {
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = atlas.width;
  sampleCanvas.height = atlas.height;
  const sampleCtx = sampleCanvas.getContext('2d');
  if (!sampleCtx) return null;
  sampleCtx.drawImage(atlas, 0, 0);
  const pixels = sampleCtx.getImageData(0, 0, atlas.width, atlas.height).data;

  const out = new Map<number, RGB>();
  for (const [idStr, tile] of Object.entries(manifest.tiles)) {
    const landId = Number(idStr);
    const cx = Math.floor(tile.x + tile.width / 2);
    const cy = Math.floor(tile.y + tile.height / 2);
    const idx = (cy * atlas.width + cx) * 4;
    out.set(landId, [pixels[idx], pixels[idx + 1], pixels[idx + 2]]);
  }
  return out;
}

/** RGB for a land id — atlas-sampled if known, else the land-class fallback. */
export function landColor(landId: number, atlasColors: Map<number, RGB> | null): RGB {
  const c = atlasColors?.get(landId);
  if (c) return c;
  return FALLBACK_COLORS[(landId >> 6) & 3];
}

export interface TerrainColormap {
  canvas: HTMLCanvasElement;
  /** Colormap pixel size. */
  width: number;
  height: number;
  /** Map size in tiles (width = j extent, height = i extent). */
  mapWidth: number;
  mapHeight: number;
}

/**
 * Build the downsampled terrain picture. `width`/`height` are the map's tile extents;
 * `pixelData[i * width + j]` is the land id of tile (i, j). Returns null when no 2D context
 * is available (tests without canvas).
 */
export function buildTerrainColormap(
  pixelData: Uint8Array,
  width: number,
  height: number,
  atlasColors: Map<number, RGB> | null,
): TerrainColormap | null {
  const ds = Math.max(1, Math.ceil(Math.max(width, height) / COLORMAP_MAX));
  const cw = Math.ceil(height / ds);
  const ch = Math.ceil(width / ds);

  const offscreen = document.createElement('canvas');
  offscreen.width = cw;
  offscreen.height = ch;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return null;

  const imgData = offCtx.createImageData(cw, ch);
  const px = imgData.data;
  for (let dy = 0; dy < ch; dy++) {
    for (let dx = 0; dx < cw; dx++) {
      const i = height - 1 - Math.min(dx * ds, height - 1);
      const j = width - 1 - Math.min(dy * ds, width - 1);
      const [r, g, b] = landColor(pixelData[i * width + j], atlasColors);
      const idx = (dy * cw + dx) * 4;
      px[idx] = r;
      px[idx + 1] = g;
      px[idx + 2] = b;
      px[idx + 3] = 255;
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  return { canvas: offscreen, width: cw, height: ch, mapWidth: width, mapHeight: height };
}

/** Tile (x = j, y = i) → colormap pixel (origin top-left of the colormap). */
export function tileToColormap(cm: Pick<TerrainColormap, 'width' | 'height' | 'mapWidth' | 'mapHeight'>, x: number, y: number): { cx: number; cy: number } {
  return {
    cx: (cm.mapHeight - y) * (cm.width / cm.mapHeight),
    cy: (cm.mapWidth - x) * (cm.height / cm.mapWidth),
  };
}

/** Colormap pixel → tile (x = j, y = i), clamped to the map. */
export function colormapToTile(cm: Pick<TerrainColormap, 'width' | 'height' | 'mapWidth' | 'mapHeight'>, cx: number, cy: number): { x: number; y: number } {
  const tileI = (1 - cx / cm.width) * cm.mapHeight;
  const tileJ = (1 - cy / cm.height) * cm.mapWidth;
  return {
    x: Math.max(0, Math.min(cm.mapWidth - 1, Math.round(tileJ))),
    y: Math.max(0, Math.min(cm.mapHeight - 1, Math.round(tileI))),
  };
}
