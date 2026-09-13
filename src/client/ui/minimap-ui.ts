/**
 * MinimapUI — Top-down terrain colormap minimap with diamond frame.
 *
 * Uses terrain pixel data from the renderer to build a client-side colormap.
 * The terrain grid is drawn rotated 45° to match the isometric view orientation:
 *   - Top vertex    = tile (maxI, maxJ)
 *   - Right vertex  = tile (0, maxJ)
 *   - Bottom vertex = tile (0, 0)
 *   - Left vertex   = tile (maxI, 0)
 *
 * Interaction:
 *  - Click/tap inside → re-center main camera on that map position
 *
 * Layout:
 *  Desktop (≥ 1024 px): docked top-left, fixed 12 px inset — never moves for an
 *                      open surface (surfaces live in the right-edge Sheet)
 *  Mobile  (< 768 px): never docked — a floating diamond would sit on the
 *                      BottomSheet / BottomNav. The only mobile form is the
 *                      fullscreen overlay opened from MinimapToggleButton, and
 *                      it closes itself as soon as any menu opens.
 *
 * Size is controlled via Settings (Small / Medium / Large preset), or by dragging the
 * diamond's bottom-right edge; the mouse wheel zooms the docked view in/out. Both gestures
 * are desktop-docked only — ignored on mobile and in the fullscreen overlay.
 */

import { useUiStore } from '../store/ui-store';
import type { GameSettings, MinimapSize } from '../store/game-store';
import { buildTerrainColormap, sampleAtlasColors, type MinimapRendererAPI, type RGB } from './minimap-colormap';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Renderer interface — only the subset MinimapUI needs. */
export type { MinimapRendererAPI } from './minimap-colormap';

// ---------------------------------------------------------------------------
// Layout & interaction constants
// ---------------------------------------------------------------------------

const DESKTOP_PAD   = 12;   // px — screen-edge gap (desktop)
const MOBILE_SIZE   = 140;  // px — fixed diamond size (mobile)
const MIN_SIZE      = 120;  // px — minimum size
const MAX_SIZE      = 500;  // px — maximum size
/**
 * px — viewport width breakpoint. Must stay equal to `useResponsive`'s `tablet`
 * breakpoint and to the `max-width: 767px` guard every mobile stylesheet uses:
 * a lower value here left a band of widths (landscape phones, small tablets)
 * where the mobile shell was on screen *and* the docked minimap was floating
 * over it. Lot g moved the mobile shell's upper edge to the desktop
 * breakpoint (tablet joined the mobile model) — this constant follows it.
 */
const MOBILE_BP     = 1024;
const UPDATE_MS     = 500;  // ms — render interval

const ZOOM_MIN         = 1;     // matches the Map surface's own range — MapSurface.tsx:48-49
const ZOOM_MAX         = 8;
const ZOOM_IN_FACTOR   = 1.25;  // one wheel notch, same factors as the Map surface
const ZOOM_OUT_FACTOR  = 0.8;
const RESIZE_GRIP       = 14;   // px — width of the draggable band along the bottom-right edge

/** Fullscreen scrim stacking level — above the mobile sheet, below any modal. */
const FULLSCREEN_Z  = 'calc(var(--z-modal) - 1)';

/** Pixel sizes for each preset. */
const SIZE_MAP: Record<MinimapSize, number> = {
  small:  160,
  medium: 220,
  large:  320,
};

// CSS filter strings for the container's drop-shadow glow
const FILTER_BASE = 'drop-shadow(0 0 10px rgba(56,189,248,0.28)) drop-shadow(0 0 2px rgba(148,163,184,0.5)) drop-shadow(0 4px 12px rgba(0,0,0,0.70))';

/** Fraction of diamond size reserved as padding on each side. */
const DIAMOND_PAD = 0.06;

const COS45 = Math.SQRT2 / 2;

// ---------------------------------------------------------------------------
// MinimapUI class
// ---------------------------------------------------------------------------

export class MinimapUI {
  private wrapper: HTMLElement | null   = null;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private renderer: MinimapRendererAPI | null = null;

  private visible = false;
  private fullscreen = false;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  /** Current diamond bounding-box side (always square). */
  private currentSize: number = SIZE_MAP.medium;

  /** Preset side chosen in Settings — restored when the viewport grows back. */
  private desktopSize: number = SIZE_MAP.medium;

  /** Layout the DOM currently reflects — `null` until the DOM exists. */
  private mobileLayout: boolean | null = null;

  /** Bound resize/orientation handler, kept so destroy() can detach it. */
  private onViewportChange: (() => void) | null = null;

  private unsubPanel: (() => void) | null = null;
  private unsubFullscreen: (() => void) | null = null;

  /** Cached downsampled terrain colormap canvas. */
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainCacheKey = '';

  /** Atlas-sampled per-landId RGB colors (season-aware). */
  private atlasColorMap: Map<number, RGB> | null = null;
  private atlasColorKey = '';

  /** Docked-view magnification, 1..8 around the current camera view. */
  private zoom = 1;

  /** In-progress bottom-right-edge drag, or `null` when idle. */
  private resizeDrag: {
    startX: number;
    startY: number;
    startSize: number;
    onMove: (e: MouseEvent) => void;
    onUp: () => void;
  } | null = null;

  constructor(private readonly onSettingsChange: ((partial: Partial<GameSettings>) => void) | null = null) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public setRenderer(renderer: MinimapRendererAPI): void {
    this.renderer = renderer;
    this.show();
  }

  public show(): void {
    // On mobile, DOM is created but hidden — fullscreen store state controls visibility
    if (this.isMobile()) {
      this.ensureDOM();
      this.enterMobileLayout();
      return;
    }

    if (this.visible) return;
    this.visible = true;
    this.ensureDOM();
    // Re-apply the docked style rather than just flipping `display`: a previous
    // fullscreen session replaced the wrapper's whole style block, and showing
    // that again would put a full-viewport scrim over the UI.
    this.applyDockedStyle('block');
    this.startUpdating();
  }

  public hide(): void {
    if (!this.visible) return;
    this.visible = false;
    if (this.wrapper) this.wrapper.style.display = 'none';
    this.stopUpdating();
  }

  public toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * Apply a size preset from Settings, or a dragged pixel size when `customPx` is given.
   * Mobile has no docked minimap to size.
   */
  public setSize(preset: MinimapSize, customPx: number | null = null): void {
    const px = customPx ?? SIZE_MAP[preset] ?? SIZE_MAP.medium;
    this.desktopSize = px;
    if (this.isMobile()) return;
    this.applySize(px);
  }

  /** Set the docked-view zoom directly, clamped to `[ZOOM_MIN, ZOOM_MAX]`. Never fires the callback. */
  public setZoom(z: number): void {
    const safe = Number.isFinite(z) ? z : 1;
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, safe));
    if (!this.isMobile() && !this.fullscreen && this.visible) this.render();
  }

  /** Zoom by a wheel-notch factor and report the result. No-op on mobile or in fullscreen. */
  public zoomBy(factor: number): void {
    if (this.isMobile() || this.fullscreen) return;
    this.setZoom(this.zoom * factor);
    this.onSettingsChange?.({ minimapZoom: this.zoom });
  }

  /** Largest side the docked diamond may take without covering the map viewport. */
  private maxDockedSize(): number {
    let max = MAX_SIZE;
    if (typeof window !== 'undefined') {
      if (window.innerWidth > 0)  max = Math.min(max, window.innerWidth - 2 * DESKTOP_PAD);
      if (window.innerHeight > 0) max = Math.min(max, window.innerHeight - 2 * DESKTOP_PAD);
    }
    return Math.max(MIN_SIZE, max);
  }

  public destroy(): void {
    this.visible = false;
    this.fullscreen = false;
    this.stopUpdating();
    if (this.unsubPanel) { this.unsubPanel(); this.unsubPanel = null; }
    if (this.unsubFullscreen) { this.unsubFullscreen(); this.unsubFullscreen = null; }
    if (this.resizeDrag) {
      document.removeEventListener('mousemove', this.resizeDrag.onMove);
      document.removeEventListener('mouseup', this.resizeDrag.onUp);
      this.resizeDrag = null;
    }
    this.detachViewportListener();
    this.mobileLayout = null;
    if (this.wrapper?.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.terrainCanvas = null;
    this.terrainCacheKey = '';
    this.atlasColorMap = null;
    this.atlasColorKey = '';
  }

  // ---------------------------------------------------------------------------
  // Viewport helpers
  // ---------------------------------------------------------------------------

  private isMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < MOBILE_BP;
  }

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  private applyPositioning(): void {
    if (!this.wrapper) return;
    // Docked minimap is desktop-only, so there is a single anchor: top-left,
    // fixed inset — no surface ever moves it.
    this.wrapper.style.bottom = '';
    this.wrapper.style.top    = `${DESKTOP_PAD}px`;
    this.wrapper.style.left   = `${DESKTOP_PAD}px`;
  }

  /**
   * Write the docked wrapper/container style from scratch.
   *
   * Both fullscreen entry and exit rewrite these elements wholesale, so every
   * path back to the docked form goes through here — that is what guarantees a
   * later `show()` can never resurrect the fullscreen scrim.
   */
  private applyDockedStyle(display: 'block' | 'none'): void {
    if (!this.wrapper || !this.container) return;

    this.wrapper.onclick = null;
    this.wrapper.style.cssText = `
      position: fixed;
      top: ${DESKTOP_PAD}px;
      left: ${DESKTOP_PAD}px;
      width: ${this.currentSize}px;
      height: ${this.currentSize}px;
      overflow: visible;
      z-index: var(--z-dropdown, 100);
      pointer-events: none;
      display: ${display};
    `;

    this.container.style.position  = 'absolute';
    this.container.style.inset     = '0';
    this.container.style.width     = '';
    this.container.style.height    = '';
    this.container.style.top       = '';
    this.container.style.left      = '';
    this.container.style.transform = '';

    this.applyPositioning();
  }

  // ---------------------------------------------------------------------------
  // Layout mode — the docked minimap exists on desktop only
  // ---------------------------------------------------------------------------

  /** Tear the docked minimap down: hidden, idle, and never over the mobile UI. */
  private enterMobileLayout(): void {
    this.visible = false;
    this.stopUpdating();
    if (useUiStore.getState().minimapFullscreen) {
      useUiStore.getState().setMinimapFullscreen(false);
    }
    this.fullscreen = false;
    this.currentSize = MOBILE_SIZE;
    this.applyDockedStyle('none');
    this.subscribeFullscreen();
  }

  /** Bring the docked minimap back at its Settings size. */
  private leaveMobileLayout(): void {
    if (useUiStore.getState().minimapFullscreen) {
      useUiStore.getState().setMinimapFullscreen(false);
    }
    this.fullscreen = false;
    this.visible = true;
    this.applySize(this.desktopSize);
    this.applyDockedStyle('block');
    this.startUpdating();
  }

  private attachViewportListener(): void {
    if (this.onViewportChange) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this.onViewportChange = () => this.handleViewportChange();
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('orientationchange', this.onViewportChange);
  }

  private detachViewportListener(): void {
    if (!this.onViewportChange) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.onViewportChange);
      window.removeEventListener('orientationchange', this.onViewportChange);
    }
    this.onViewportChange = null;
  }

  /**
   * A rotation crosses the breakpoint far more often than a window drag does —
   * without this the minimap kept whichever layout it was built with, which is
   * how a desktop-sized diamond ended up floating over the mobile shell.
   */
  private handleViewportChange(): void {
    if (!this.wrapper) return;
    const mobile = this.isMobile();

    if (mobile !== this.mobileLayout) {
      this.mobileLayout = mobile;
      mobile ? this.enterMobileLayout() : this.leaveMobileLayout();
      return;
    }

    // Same layout — a fullscreen diamond still has to follow the new viewport.
    if (this.fullscreen) this.enterFullscreen();
  }

  /**
   * Any surface the fullscreen minimap must not sit on top of. The scrim covers
   * the whole viewport, so leaving it up over a menu blocks every control
   * underneath it.
   */
  private isMenuOpen(): boolean {
    const s = useUiStore.getState();
    return s.modal !== null
      || s.commandPaletteOpen
      || s.rightPanel !== null
      || s.leftPanel !== null
      || s.mobileTab !== 'map'
      || s.isPlacingBuilding;
  }

  /** Re-anchor on panel changes, and never let the scrim outlive a menu opening. */
  private onUiStateChange(): void {
    this.applyPositioning();
    if (useUiStore.getState().minimapFullscreen && this.isMenuOpen()) {
      useUiStore.getState().setMinimapFullscreen(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Fullscreen mode (mobile)
  // ---------------------------------------------------------------------------

  private subscribeFullscreen(): void {
    if (this.unsubFullscreen) return;
    let prev = useUiStore.getState().minimapFullscreen;
    this.unsubFullscreen = useUiStore.subscribe(() => {
      const next = useUiStore.getState().minimapFullscreen;
      if (next !== prev) {
        prev = next;
        next ? this.enterFullscreen() : this.exitFullscreen();
      }
    });
  }

  private enterFullscreen(): void {
    if (!this.wrapper || !this.container || !this.canvas) return;
    this.fullscreen = true;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fsSize = Math.min(vw, vh);
    this.currentSize = fsSize;

    // Wrapper: fill viewport as scrim
    this.wrapper.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: ${FULLSCREEN_Z};
      pointer-events: auto;
      background: rgba(0,0,0,0.6);
    `;

    // Scrim tap → close (diamond stopPropagation prevents conflict)
    this.wrapper.onclick = () => {
      useUiStore.getState().setMinimapFullscreen(false);
    };

    // Container: centered diamond
    this.container.style.position = 'absolute';
    this.container.style.inset = '';
    this.container.style.width = `${fsSize}px`;
    this.container.style.height = `${fsSize}px`;
    this.container.style.top = '50%';
    this.container.style.left = '50%';
    this.container.style.transform = 'translate(-50%, -50%)';

    // Canvas
    this.canvas.width = fsSize;
    this.canvas.height = fsSize;

    this.wrapper.style.display = 'block';
    this.startUpdating();
  }

  private exitFullscreen(): void {
    this.fullscreen = false;
    if (!this.wrapper || !this.container) return;

    this.stopUpdating();

    // Back to the docked geometry — on mobile that means hidden, on desktop the
    // Settings preset. Leaving the fullscreen style behind is what used to make
    // the minimap reappear as a viewport-wide scrim over the menus.
    this.currentSize = this.isMobile() ? MOBILE_SIZE : this.desktopSize;
    if (this.canvas) {
      this.canvas.width  = this.currentSize;
      this.canvas.height = this.currentSize;
    }
    this.applyDockedStyle(this.visible ? 'block' : 'none');
  }

  // ---------------------------------------------------------------------------
  // DOM setup
  // ---------------------------------------------------------------------------

  private ensureDOM(): void {
    if (this.canvas) return;

    if (this.isMobile()) this.currentSize = MOBILE_SIZE;

    // ── Outer wrapper ─────────────────────────────────────────────────────────
    this.wrapper = document.createElement('div');
    this.wrapper.id = 'minimap-wrapper';

    // ── Inner diamond container ────────────────────────────────────────────────
    this.container = document.createElement('div');
    this.container.id = 'minimap-container';
    this.container.style.cssText = `
      position: absolute;
      inset: 0;
      overflow: hidden;
      cursor: crosshair;
      background: #0f172a;
      clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
      filter: ${FILTER_BASE};
      pointer-events: auto;
      transition: filter 200ms;
    `;

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width  = this.currentSize;
    this.canvas.height = this.currentSize;
    this.canvas.style.cssText = 'display: block; width: 100%; height: 100%;';
    this.ctx = this.canvas.getContext('2d');

    this.container.appendChild(this.canvas);
    this.wrapper.appendChild(this.container);

    // ── Interaction: click-to-navigate ───────────────────────────────────────
    this.attachInteractionListeners();

    // ── Style + position + subscriptions ─────────────────────────────────────
    this.applyDockedStyle('none');
    this.unsubPanel = useUiStore.subscribe(() => this.onUiStateChange());
    this.mobileLayout = this.isMobile();
    this.attachViewportListener();

    document.body.appendChild(this.wrapper);
  }

  // ---------------------------------------------------------------------------
  // Interaction: click navigate
  // ---------------------------------------------------------------------------

  private attachInteractionListeners(): void {
    if (!this.container) return;

    // ── Mouse: click → navigate, or drag the bottom-right edge → resize ────
    this.container.onmousedown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.isMobile() && !this.fullscreen && this.isOnResizeGrip(e.offsetX, e.offsetY)) {
        this.startResize(e.clientX, e.clientY);
        return;
      }
      this.handleClick(e.offsetX, e.offsetY);
    };

    this.container.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.container || this.isMobile() || this.fullscreen) return;
      this.container.style.cursor = this.isOnResizeGrip(e.offsetX, e.offsetY) ? 'nwse-resize' : 'crosshair';
    });

    // ── Wheel: zoom the docked view in/out ──────────────────────────────────
    this.container.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoomBy(e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR);
    }, { passive: false });

    // ── Touch: tap → navigate ───────────────────────────────────────────────
    this.container.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.changedTouches.length === 0) return;
      const touch = e.changedTouches[0];
      const rect = (this.container as HTMLElement & { getBoundingClientRect?(): DOMRect }).getBoundingClientRect?.();
      const ox = rect ? touch.clientX - rect.left : touch.clientX;
      const oy = rect ? touch.clientY - rect.top  : touch.clientY;
      this.handleClick(ox, oy);
    }, { passive: false });
  }

  /** True inside the `RESIZE_GRIP`-wide band along the diamond's bottom-right edge. */
  private isOnResizeGrip(x: number, y: number): boolean {
    const s = this.currentSize;
    const d = (1.5 * s - (x + y)) / Math.SQRT2;
    return x >= s / 2 && y >= s / 2 && d >= 0 && d <= RESIZE_GRIP;
  }

  /** Begin a bottom-right-edge drag; live-resizes until `mouseup`. */
  private startResize(clientX: number, clientY: number): void {
    const startSize = this.currentSize;
    const onMove = (e: MouseEvent): void => {
      this.applySize(startSize + ((e.clientX - clientX) + (e.clientY - clientY)) / 2);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.desktopSize = this.currentSize;
      this.resizeDrag = null;
      this.onSettingsChange?.({ minimapPixelSize: this.currentSize });
    };
    this.resizeDrag = { startX: clientX, startY: clientY, startSize, onMove, onUp };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---------------------------------------------------------------------------
  // Size helpers
  // ---------------------------------------------------------------------------

  private applySize(newSize: number): void {
    const clamped = Math.max(MIN_SIZE, Math.min(this.maxDockedSize(), newSize));
    this.currentSize = clamped;
    if (this.wrapper) {
      this.wrapper.style.width  = `${clamped}px`;
      this.wrapper.style.height = `${clamped}px`;
    }
    if (this.container) {
      this.container.style.width  = `${clamped}px`;
      this.container.style.height = `${clamped}px`;
    }
    if (this.canvas) {
      this.canvas.width  = clamped;
      this.canvas.height = clamped;
    }
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Periodic rendering
  // ---------------------------------------------------------------------------

  private startUpdating(): void {
    this.stopUpdating();
    this.render();
    this.updateTimer = setInterval(() => this.render(), UPDATE_MS);
  }

  private stopUpdating(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Terrain colormap — built from pixel data, cached until map changes
  // ---------------------------------------------------------------------------

  /** Sample atlas colors once per terrain/season (null → land-class fallbacks). */
  private buildAtlasColorMap(): void {
    if (!this.renderer?.getAtlasData) return;
    const atlasData = this.renderer.getAtlasData();
    if (!atlasData) return;
    const key = `${this.renderer.getTerrainType()}:${this.renderer.getSeason()}`;
    if (this.atlasColorKey === key && this.atlasColorMap && this.atlasColorMap.size > 0) return;
    this.atlasColorMap = sampleAtlasColors(atlasData.atlas, atlasData.manifest);
    this.atlasColorKey = key;
  }

  private buildTerrainColormap(): void {
    if (!this.renderer) return;
    const data = this.renderer.getTerrainPixelData();
    if (!data) return;

    const { pixelData, width, height } = data;
    const key = `${this.renderer.getMapName()}:${this.renderer.getTerrainType()}:${this.renderer.getSeason()}:${width}:${height}`;
    if (this.terrainCacheKey === key && this.terrainCanvas) return;

    this.buildAtlasColorMap();
    const cm = buildTerrainColormap(pixelData, width, height, this.atlasColorMap);
    if (!cm) return;
    this.terrainCanvas = cm.canvas;
    this.terrainCacheKey = key;
  }

  // ---------------------------------------------------------------------------
  // Transform helpers
  // ---------------------------------------------------------------------------

  /** Scale factor for terrain canvas → minimap canvas (with rotation and padding). */
  private getTerrainScale(): number {
    if (!this.terrainCanvas) return 1;
    const tW = this.terrainCanvas.width;
    const tH = this.terrainCanvas.height;
    const diagonal = Math.sqrt(tW * tW + tH * tH);
    const padPx = this.currentSize * DIAMOND_PAD;
    return (this.currentSize - 2 * padPx) / diagonal;
  }

  /**
   * Terrain-canvas point the zoomed view centers on — the middle of the visible tile
   * bounds, mapped with the same axis swap/flip `drawViewportInGrid` uses. `{0,0}` at
   * zoom 1 (or with no terrain/zero map dims), so the unzoomed view is untouched.
   */
  private viewFocus(zoom: number): { x: number; y: number } {
    if (zoom === 1 || !this.terrainCanvas || !this.renderer) return { x: 0, y: 0 };
    const dims = this.renderer.getMapDimensions();
    if (dims.width === 0 || dims.height === 0) return { x: 0, y: 0 };

    const bounds = this.renderer.getVisibleTileBounds();
    const tW = this.terrainCanvas.width;
    const tH = this.terrainCanvas.height;

    const x = (dims.height - (bounds.minI + bounds.maxI) / 2) * (tW / dims.height) - tW / 2;
    const y = (dims.width  - (bounds.minJ + bounds.maxJ) / 2) * (tH / dims.width)  - tH / 2;
    return { x, y };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  private render(): void {
    if (!this.ctx || !this.renderer) return;

    const mapName = this.renderer.getMapName();
    if (!mapName) return;

    // Build terrain colormap (rebuilds on map/season/terrain changes via cache key)
    this.buildTerrainColormap();

    const ctx = this.ctx;
    const s = this.currentSize;

    // Clear
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, s, s);

    if (this.terrainCanvas) {
      const tW = this.terrainCanvas.width;
      const tH = this.terrainCanvas.height;
      const zoom = this.fullscreen ? 1 : this.zoom;
      const scale = this.getTerrainScale() * zoom;
      const focus = this.viewFocus(zoom);

      // Draw terrain rotated 45° so the grid diamond aligns with the clip-path diamond
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate(Math.PI / 4);
      ctx.scale(scale, scale);
      ctx.translate(-focus.x, -focus.y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.terrainCanvas, -tW / 2, -tH / 2);

      // Viewport indicator — drawn in the same rotated/scaled terrain space
      this.drawViewportInGrid(ctx, scale);

      ctx.restore();
    }

    // Screen-space diamond border (drawn after restore, in screen coords)
    this.drawDiamondBorder(ctx);
  }

  // ---------------------------------------------------------------------------
  // Draw helpers
  // ---------------------------------------------------------------------------

  /**
   * Draw the viewport indicator rectangle in terrain grid space.
   * Since the context is already transformed (translate + rotate + scale),
   * we can draw in terrain-canvas coordinates directly.
   */
  private drawViewportInGrid(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.renderer || !this.terrainCanvas) return;
    const dims = this.renderer.getMapDimensions();
    if (dims.width === 0 || dims.height === 0) return;

    const bounds = this.renderer.getVisibleTileBounds();
    const tW = this.terrainCanvas.width;
    const tH = this.terrainCanvas.height;

    // Map tile bounds → colormap coordinates (centered at origin since canvas is shifted by -tW/2,-tH/2)
    // Colormap axes are swapped+flipped: dx → i (flipped), dy → j (flipped)
    // So tile i maps to colormap x = (maxI - i) * scaleI, tile j maps to colormap y = (maxJ - j) * scaleJ
    const scaleI = tW / dims.height;
    const scaleJ = tH / dims.width;

    const x1 = (dims.height - bounds.maxI) * scaleI - tW / 2;
    const y1 = (dims.width - bounds.maxJ) * scaleJ - tH / 2;
    const w  = (bounds.maxI - bounds.minI) * scaleI;
    const h  = (bounds.maxJ - bounds.minJ) * scaleJ;

    ctx.fillStyle = 'rgba(245,158,11,0.12)';
    ctx.fillRect(x1, y1, w, h);

    // Adjust lineWidth for current scale so it appears ~1.5px on screen
    ctx.strokeStyle = 'rgba(245,158,11,0.85)';
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(x1, y1, w, h);
  }

  /**
   * Diamond border drawn in screen space.
   *
   * Two layers for visual polish:
   *  1. Outer glow  — wide soft stroke in sky-blue
   *  2. Main edge   — crisp 2 px gradient stroke
   */
  private drawDiamondBorder(ctx: CanvasRenderingContext2D): void {
    const s  = this.currentSize;
    const cx = s / 2;
    const cy = s / 2;

    ctx.save();

    // Diamond path (inset 1 px so stroke doesn't clip)
    const drawPath = () => {
      ctx.beginPath();
      ctx.moveTo(cx,     1);
      ctx.lineTo(s - 1,  cy);
      ctx.lineTo(cx,     s - 1);
      ctx.lineTo(1,      cy);
      ctx.closePath();
    };

    // Layer 1: outer glow
    drawPath();
    ctx.strokeStyle = 'rgba(56,189,248,0.20)';
    ctx.lineWidth   = 8;
    ctx.lineJoin    = 'miter';
    ctx.stroke();

    // Layer 2: crisp gradient edge
    drawPath();
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0,   'rgba(56,189,248,0.80)');
    grad.addColorStop(0.5, 'rgba(148,163,184,0.45)');
    grad.addColorStop(1,   'rgba(56,189,248,0.80)');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Grip mark — short brighter segment centered on the bottom-right edge midpoint,
    // where isOnResizeGrip() accepts a drag.
    const gripMidX = (cx + (s - 1)) / 2;
    const gripMidY = (cy + (s - 1)) / 2;
    const gripHalf = 6;
    ctx.beginPath();
    ctx.moveTo(gripMidX - gripHalf, gripMidY + gripHalf);
    ctx.lineTo(gripMidX + gripHalf, gripMidY - gripHalf);
    ctx.strokeStyle = 'rgba(226,232,240,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Click → navigate
  // ---------------------------------------------------------------------------

  private handleClick(pixelX: number, pixelY: number): void {
    // Read the size first, then close: closing resets currentSize, and the
    // reverse transform below needs the size the tap was made against.
    const s = this.currentSize;

    // Close before the guards — a tap must never leave the scrim over the UI,
    // not even when the colormap is not ready and navigation is impossible.
    if (this.fullscreen) {
      useUiStore.getState().setMinimapFullscreen(false);
    }

    if (!this.renderer || !this.terrainCanvas) return;
    const dims = this.renderer.getMapDimensions();
    if (dims.width === 0 || dims.height === 0) return;
    const tW = this.terrainCanvas.width;
    const tH = this.terrainCanvas.height;
    const zoom = this.fullscreen ? 1 : this.zoom;
    const scale = this.getTerrainScale() * zoom;
    const focus = this.viewFocus(zoom);

    // Reverse transform: minimap pixel → terrain grid coordinate
    // 1. Undo translate (center of canvas)
    const dx = pixelX - s / 2;
    const dy = pixelY - s / 2;

    // 2. Undo rotate (-45°): cos(-45°) = cos45, sin(-45°) = -cos45
    const rx =  dx * COS45 + dy * COS45;
    const ry = -dx * COS45 + dy * COS45;

    // 3. Undo scale + centering offset
    const terrainX = rx / scale + focus.x + tW / 2;
    const terrainY = ry / scale + focus.y + tH / 2;

    // 4. Scale from colormap coords to tile coords (axes are swapped+flipped)
    // Colormap x → i (flipped): tileI = maxI - (terrainX / tW) * maxI = maxI * (1 - terrainX/tW)
    // Colormap y → j (flipped): tileJ = maxJ - (terrainY / tH) * maxJ = maxJ * (1 - terrainY/tH)
    const tileI = (1 - terrainX / tW) * dims.height;
    const tileJ = (1 - terrainY / tH) * dims.width;

    this.renderer.centerOn(
      Math.max(0, Math.min(dims.width  - 1, Math.round(tileJ))),
      Math.max(0, Math.min(dims.height - 1, Math.round(tileI))),
    );
  }
}
