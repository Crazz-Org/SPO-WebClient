/**
 * MapSurface — the « Map » surface of the sheet (Carte lot, missing-features N1 / N2 / N3).
 *
 * A data map of the world, drawn from what the client already holds — no request is made:
 *  - the terrain colormap the docked minimap uses (`ui/minimap-colormap`),
 *  - every building loaded so far, coloured by its class's zone — own in full colour, foreign
 *    dimmed, an own building losing money in red (`MapBuilding.alert`) — plus roads and
 *    concrete, in Voyager's own priority order (`Map.pas:3732-3778`, `:6930-6950`,
 *    `map-surface-layer.ts`),
 *  - the selected tile, marked with a white footprint and a screen-space ring
 *    (`useBuildingStore().focusedBuilding`),
 *  - the rectangle of what the iso view shows.
 * Click = jump there. Wheel = zoom around the cursor (1× … 8×), drag = pan when zoomed.
 * Toolbar: Back / Next through the camera history (`map-store`); nearest Town Hall, usable
 * before the towns page has loaded — a click with no list asks for it (`onSearchMenuTowns`)
 * and jumps once it lands, through the selecting path (`onNavigateToBuilding`, the client's
 * `MoveAndSelect`), never a plain pan. Metric: Manhattan distance over the directory's town
 * list, a local approximation of the server's own answer (`@/shared/nearest-town`); reset zoom.
 * Bookmarks (N4, OB-33): the places the player keeps, in the server's own Favorites tree —
 * the same list the Empire panel shows, so a place kept here is there on any browser.
 * Add the current view, go, rename, delete; the writes go through `RDOFavoritesNewItem` /
 * `DelItem` / `RenameItem` (`Interface Server/InterfaceServer.pas:200-203`). Places kept in
 * this browser before the move are merged in once, by `handlers/favorites-handler`.
 *
 * The docked diamond stays available from the More menu; this surface is the large, readable
 * version the brief asked for (« bouton Carte »).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookmarkPlus, Landmark, Locate, Pencil, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useMapStore } from '../../store/map-store';
import { useEmpireStore } from '../../store/empire-store';
import { useGameStore } from '../../store/game-store';
import { useSearchStore } from '../../store/search-store';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { Button } from '../common';
import {
  buildTerrainColormap,
  colormapToTile,
  sampleAtlasColors,
  tileToColormap,
  type MinimapRendererAPI,
  type RGB,
  type TerrainColormap,
} from '../../ui/minimap-colormap';
import { buildDataLayer } from './map-surface-layer';
import type { TownInfo } from '@/shared/types';
import { nearestTown } from '@/shared/nearest-town';
import styles from './MapSurface.module.css';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
const REDRAW_MS = 1000;
const COS45 = Math.SQRT2 / 2;

interface View {
  zoom: number;
  /** Pan offset in screen pixels (applied before the rotation). */
  panX: number;
  panY: number;
}

export function MapSurface() {
  const source = useMapStore((s) => s.source);
  const history = useMapStore((s) => s.history);
  const historyIndex = useMapStore((s) => s.historyIndex);
  const goBack = useMapStore((s) => s.goBack);
  const goNext = useMapStore((s) => s.goNext);
  const recordPosition = useMapStore((s) => s.recordPosition);
  const towns = useSearchStore((s) => s.townsData?.towns);
  const bookmarks = useEmpireStore((s) => s.facilities);
  const tycoonIdRaw = useGameStore((s) => s.tycoonId);
  const myTycoonId = parseInt(tycoonIdRaw || '0', 10) || 0;
  const focused = useBuildingStore((s) => s.focusedBuilding);
  const selection = focused
    ? { x: focused.x, y: focused.y, xsize: Math.max(1, focused.xsize), ysize: Math.max(1, focused.ysize) }
    : null;
  const client = useClient();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(320);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const colormapRef = useRef<{ key: string; cm: TerrainColormap; atlas: Map<number, RGB> | null } | null>(null);
  const layerRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const [tick, setTick] = useState(0);
  const [townHallPending, setTownHallPending] = useState(false);

  // Towns: one directory read, once per session, shared with Search / Government.
  useEffect(() => {
    if (!towns) client.onSearchMenuTowns();
  }, [client, towns]);

  // The bookmarks are the server's Favorites tree — ask for it when the surface opens.
  useEffect(() => {
    client.onRequestFacilities();
  }, [client]);

  // Fit the square canvas to the surface width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize(Math.max(200, Math.floor(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw on an interval (the camera and the loaded buildings move without events).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REDRAW_MS);
    return () => clearInterval(t);
  }, []);

  const colormap = useCallback((src: MinimapRendererAPI): TerrainColormap | null => {
    const data = src.getTerrainPixelData();
    if (!data) return null;
    const key = `${src.getMapName()}:${src.getTerrainType()}:${src.getSeason()}:${data.width}:${data.height}`;
    if (colormapRef.current?.key === key) return colormapRef.current.cm;
    const atlasData = src.getAtlasData?.();
    const atlas = atlasData ? sampleAtlasColors(atlasData.atlas, atlasData.manifest) : null;
    const cm = buildTerrainColormap(data.pixelData, data.width, data.height, atlas);
    if (!cm) return null;
    colormapRef.current = { key, cm, atlas };
    return cm;
  }, []);

  /** Screen pixel → colormap pixel, through the current pan / zoom / rotation. */
  const screenToColormap = useCallback((cm: TerrainColormap, px: number, py: number) => {
    const base = (size * 0.88) / Math.sqrt(cm.width * cm.width + cm.height * cm.height);
    const scale = base * view.zoom;
    const dx = px - size / 2 - view.panX;
    const dy = py - size / 2 - view.panY;
    const rx = dx * COS45 + dy * COS45;
    const ry = -dx * COS45 + dy * COS45;
    return { cx: rx / scale + cm.width / 2, cy: ry / scale + cm.height / 2, scale };
  }, [size, view]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cm = colormap(source);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    if (!cm) return;
    const dims = source.getMapDimensions();
    const base = (size * 0.88) / Math.sqrt(cm.width * cm.width + cm.height * cm.height);
    const scale = base * view.zoom;

    ctx.save();
    ctx.translate(size / 2 + view.panX, size / 2 + view.panY);
    ctx.rotate(Math.PI / 4);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cm.canvas, -cm.width / 2, -cm.height / 2);

    // The data layer — buildings, roads, concrete and the selection footprint — rebuilt only
    // when what it depends on changes, not on every render (hover moves, drags, ...).
    const key = `${colormapRef.current?.key}|${tick}|${myTycoonId}|${selection ? `${selection.x},${selection.y},${selection.xsize},${selection.ysize}` : '-'}`;
    if (layerRef.current?.key !== key) {
      const layer = buildDataLayer(cm, {
        buildings: source.getAllBuildings?.() ?? [],
        segments: source.getAllSegments?.() ?? [],
        concreteTiles: source.getConcreteTiles?.() ?? [],
        zoneOf: (vc) => source.getFacilityZone?.(vc),
        myTycoonId,
        selection,
      });
      layerRef.current = layer ? { key, canvas: layer } : null;
    }
    if (layerRef.current) {
      ctx.drawImage(layerRef.current.canvas, -cm.width / 2, -cm.height / 2);
    }

    // Viewport rectangle.
    if (dims.width > 0 && dims.height > 0) {
      const bounds = source.getVisibleTileBounds();
      const a = tileToColormap(cm, bounds.maxJ, bounds.maxI);
      const b = tileToColormap(cm, bounds.minJ, bounds.minI);
      const x1 = Math.min(a.cx, b.cx) - cm.width / 2;
      const y1 = Math.min(a.cy, b.cy) - cm.height / 2;
      ctx.fillStyle = 'rgba(245,158,11,0.12)';
      ctx.fillRect(x1, y1, Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy));
      ctx.strokeStyle = 'rgba(245,158,11,0.9)';
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeRect(x1, y1, Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy));
    }

    // The selected tile — a screen-space ring so it stays visible at 1× zoom, where the
    // layer's own footprint pixel is a single pixel.
    if (selection) {
      const p = tileToColormap(cm, selection.x, selection.y);
      const r = 3 / scale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeRect(p.cx - cm.width / 2 - r, p.cy - cm.height / 2 - r, 2 * r, 2 * r);
    }
    ctx.restore();
  });

  const jumpTo = useCallback((x: number, y: number) => {
    if (!source) return;
    source.centerOn(x, y);
    recordPosition(x, y);
  }, [source, recordPosition]);

  // The Town Hall button's arrival path — selecting, like Voyager's `MoveAndSelect`, not a
  // plain pan: `onNavigateToBuilding` centres the renderer itself and opens the inspector
  // (`client.ts:346` -> `building-focus-handler.ts:205-217`).
  const goToTownHall = useCallback((t: TownInfo) => {
    client.onNavigateToBuilding(t.x, t.y);
    recordPosition(t.x, t.y);
  }, [client, recordPosition]);

  // A click with no towns loaded yet asks for the directory page, then jumps once it lands.
  useEffect(() => {
    if (!townHallPending || !towns) return;
    setTownHallPending(false);
    const camera = source?.getCameraPosition();
    if (!camera) return;
    const t = nearestTown(towns, camera.x, camera.y);
    if (t) goToTownHall(t);
  }, [townHallPending, towns, source, goToTownHall]);

  const tileAt = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !colormapRef.current) return null;
    const rect = canvas.getBoundingClientRect();
    const cm = colormapRef.current.cm;
    const { cx, cy } = screenToColormap(cm, e.clientX - rect.left, e.clientY - rect.top);
    if (cx < 0 || cy < 0 || cx > cm.width || cy > cm.height) return null;
    return colormapToTile(cm, cx, cy);
  }, [source, screenToColormap]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d && view.zoom > 1) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) setView((v) => ({ ...v, panX: d.panX + dx, panY: d.panY + dy }));
    }
    setHover(tileAt(e));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const t = tileAt(e);
    if (t) jumpTo(t.x, t.y);
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    setView((v) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor));
      if (zoom === v.zoom) return v;
      // Keep the point under the cursor still: pan scales with the zoom ratio.
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const mx = rect ? e.clientX - rect.left - size / 2 : 0;
      const my = rect ? e.clientY - rect.top - size / 2 : 0;
      const r = zoom / v.zoom;
      const panX = zoom === 1 ? 0 : mx - (mx - v.panX) * r;
      const panY = zoom === 1 ? 0 : my - (my - v.panY) * r;
      return { zoom, panX, panY };
    });
  };
  const zoomBy = (factor: number) => setView((v) => {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor));
    return zoom === 1 ? { zoom: 1, panX: 0, panY: 0 } : { ...v, zoom };
  });

  const onAddBookmark = () => {
    if (!camera) return;
    const x = Math.round(camera.x);
    const y = Math.round(camera.y);
    useUiStore.getState().requestPrompt('Bookmark this place', `The view is at (${x}, ${y}). Name it:`, (name) => { client.onAddFavorite(name.trim() || `(${x}, ${y})`, x, y); }, { placeholder: 'e.g. Cotton farms', defaultValue: `(${x}, ${y})` });
  };
  const onRenameBookmark = (path: string, current: string) => {
    useUiStore.getState().requestPrompt('Rename bookmark', 'New name:', (name) => { const t = name.trim(); if (t) client.onRenameFavorite(path, t); }, { defaultValue: current });
  };

  const camera = source?.getCameraPosition();
  const nearest = useMemo(() => (camera ? nearestTown(towns, camera.x, camera.y) : null), [towns, camera?.x, camera?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const canBack = historyIndex > 0;
  const canNext = historyIndex < history.length - 1;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar} role="toolbar" aria-label="Map tools">
        <Button size="sm" variant="secondary" aria-label="Back" iconLeft={<ArrowLeft size={14} />} disabled={!canBack} onClick={() => { const p = goBack(); if (p && source) source.centerOn(p.x, p.y); }} title="Back to the previous place" />
        <Button size="sm" variant="secondary" aria-label="Next" iconLeft={<ArrowRight size={14} />} disabled={!canNext} onClick={() => { const p = goNext(); if (p && source) source.centerOn(p.x, p.y); }} title="Forward again" />
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Landmark size={14} />}
          disabled={!camera}
          onClick={() => {
            if (nearest) { goToTownHall(nearest); return; }
            setTownHallPending(true);
            client.onSearchMenuTowns();
          }}
          title={nearest ? `Town Hall of ${nearest.name}` : 'Nearest Town Hall — asks for the town list first'}
        >
          Nearest Town Hall
        </Button>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" aria-label="Zoom out" iconLeft={<ZoomOut size={14} />} disabled={view.zoom <= ZOOM_MIN} onClick={() => zoomBy(0.8)} />
        <span className={styles.zoom} aria-live="polite">{Math.round(view.zoom * 100)}%</span>
        <Button size="sm" variant="ghost" aria-label="Zoom in" iconLeft={<ZoomIn size={14} />} disabled={view.zoom >= ZOOM_MAX} onClick={() => zoomBy(1.25)} />
        <Button size="sm" variant="ghost" aria-label="Reset zoom" iconLeft={<Locate size={14} />} disabled={view.zoom === 1} onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })} />
      </div>

      <div ref={wrapRef} className={styles.canvasWrap}>
        {source ? (
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className={styles.canvas}
            role="img"
            aria-label="World map — click to go there, wheel to zoom"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { drag.current = null; setHover(null); }}
            onWheel={onWheel}
          />
        ) : (
          <p className={styles.empty}>The map is not ready yet.</p>
        )}
      </div>

      <section className={styles.bookmarks} aria-labelledby="map-bookmarks">
        <div className={styles.bookmarksHead}>
          <h3 id="map-bookmarks" className={styles.bookmarksTitle}><Bookmark size={14} aria-hidden="true" /> Bookmarks</h3>
          <Button size="sm" variant="secondary" iconLeft={<BookmarkPlus size={14} />} disabled={!camera} onClick={onAddBookmark}>
            Bookmark this place
          </Button>
        </div>
        {bookmarks.length === 0 ? (
          <p className={styles.bookmarksEmpty}>No bookmarks yet — keep a place and it follows you to any browser.</p>
        ) : (
          <ul className={styles.bookmarkList} role="list">
            {bookmarks.map((b) => (
              <li key={b.path} className={styles.bookmarkRow}>
                <button type="button" className={styles.bookmarkGo} onClick={() => jumpTo(b.x, b.y)} aria-label={`Go to ${b.name} (${b.x}, ${b.y})`}>
                  <span className={styles.bookmarkName}>{b.name}</span>
                  <span className={styles.bookmarkCoords}>({b.x}, {b.y})</span>
                </button>
                <Button size="sm" variant="ghost" aria-label={`Rename ${b.name}`} iconLeft={<Pencil size={14} />} onClick={() => onRenameBookmark(b.path, b.name)} />
                <Button size="sm" variant="ghost" aria-label={`Delete ${b.name}`} iconLeft={<Trash2 size={14} />} onClick={() => client.onRemoveFavorite(b.path, b.name)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.footer}>
        <span className={styles.legend}>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.residential}`} aria-hidden="true" />Residential</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.industrial}`} aria-hidden="true" />Industrial</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.commercial}`} aria-hidden="true" />Commercial</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.civics}`} aria-hidden="true" />Civics</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.offices}`} aria-hidden="true" />Offices</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.losing}`} aria-hidden="true" />Losing money</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.road}`} aria-hidden="true" />Road</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.concrete}`} aria-hidden="true" />Concrete</span>
          <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.selected}`} aria-hidden="true" />Selected</span>
          <span className={styles.legendNote}>yours bright, others dimmed</span>
        </span>
        <span className={styles.coords}>
          {hover ? `(${hover.x}, ${hover.y})` : camera ? `View at (${Math.round(camera.x)}, ${Math.round(camera.y)})` : ''}
        </span>
      </div>
    </div>
  );
}
