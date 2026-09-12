/**
 * MapNavigationUI - Handles map display and interactions
 *
 * Uses Canvas 2D isometric renderer with:
 * - Vegetation→flat texture mapping near dynamic content
 * - 90° snap rotation (Q/E keys, 2-finger gesture)
 * - Mobile touch support (pan, pinch zoom, rotation, double-tap)
 */

import { IsometricMapRenderer } from '../renderer/isometric-map-renderer';
import { FacilityDimensions } from '../../shared/types';

export class MapNavigationUI {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: IsometricMapRenderer | null = null;

  // Callbacks
  private onLoadZone: ((x: number, y: number, w: number, h: number) => void) | null = null;
  private onBuildingClick: ((x: number, y: number, visualClass?: string) => void) | null = null;
  private onEmptyMapClick: (() => void) | null = null;
  private onFetchFacilityDimensions: ((visualClass: string) => Promise<FacilityDimensions | null>) | null = null;
  private onViewportChanged: (() => void) | null = null;
  private onMapContextMenu: ((clientX: number, clientY: number, tileX: number, tileY: number) => void) | null = null;

  constructor(private gamePanel: HTMLElement, private worldName: string = 'Shamba') {}

  /**
   * Set callback for loading new zones
   */
  public setOnLoadZone(callback: (x: number, y: number, w: number, h: number) => void) {
    this.onLoadZone = callback;
    console.log('[MapNavigationUI] onLoadZone callback set');

    // Trigger initial zone loading now that callback is set
    if (this.renderer) {
      console.log('[MapNavigationUI] Triggering initial zone load');
      this.renderer.triggerZoneCheck();
    }
  }

  /**
   * Set callback for building clicks
   */
  public setOnBuildingClick(callback: (x: number, y: number, visualClass?: string) => void) {
    this.onBuildingClick = callback;
  }

  /**
   * Set callback for empty map clicks (no building at click location)
   */
  public setOnEmptyMapClick(callback: () => void) {
    this.onEmptyMapClick = callback;
  }

  /**
   * Set callback for fetching facility dimensions
   */
  public setOnFetchFacilityDimensions(callback: (visualClass: string) => Promise<FacilityDimensions | null>) {
    this.onFetchFacilityDimensions = callback;
  }

  /**
   * Set callback for viewport changes (pan-end, zoom, rotation).
   * Used to send SetViewedArea to the game server so it pushes facility updates.
   */
  public setOnViewportChanged(callback: () => void) {
    this.onViewportChanged = callback;
  }

  /**
   * Set callback for the right-click map context menu (release without drag)
   */
  public setOnMapContextMenu(callback: (clientX: number, clientY: number, tileX: number, tileY: number) => void) {
    this.onMapContextMenu = callback;
  }

  /**
   * Initialize the canvas and renderer.
   * Resolves after terrain data is loaded so callers can safely use centerOn().
   */
  public async init(): Promise<void> {
    // Remove placeholder
    const placeholder = this.gamePanel.querySelector('div');
    if (placeholder) {
      placeholder.remove();
    }

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.backgroundColor = '#111';
    this.canvas.style.touchAction = 'none'; // prevent browser scroll/zoom intercepting touch
    this.gamePanel.appendChild(this.canvas);

    // Initialize Canvas 2D isometric renderer
    console.log('[MapNavigationUI] Initializing Canvas 2D isometric renderer');

    this.renderer = new IsometricMapRenderer('game-canvas');
    this.setupRendererCallbacks();

    // Load map — await so callers know terrain dimensions are available
    await this.renderer.loadMap(this.worldName);
    console.log('[MapNavigationUI] Terrain loaded successfully');
  }

  /**
   * Setup renderer callbacks
   */
  private setupRendererCallbacks() {
    if (!this.renderer) return;

    this.renderer.setLoadZoneCallback((x, y, w, h) => {
      console.log(`[MapNavigationUI] Zone callback triggered: (${x}, ${y}) ${w}x${h}, onLoadZone=${!!this.onLoadZone}`);
      if (this.onLoadZone) {
        this.onLoadZone(x, y, w, h);
      } else {
        console.warn('[MapNavigationUI] onLoadZone callback not set yet!');
      }
    });

    this.renderer.setBuildingClickCallback((x, y, visualClass) => {
      if (this.onBuildingClick) this.onBuildingClick(x, y, visualClass);
    });

    this.renderer.setEmptyMapClickCallback(() => {
      if (this.onEmptyMapClick) this.onEmptyMapClick();
    });

    this.renderer.setFetchFacilityDimensionsCallback(async (visualClass) => {
      if (this.onFetchFacilityDimensions) {
        return await this.onFetchFacilityDimensions(visualClass);
      }
      return null;
    });

    this.renderer.setViewportChangedCallback(() => {
      if (this.onViewportChanged) this.onViewportChanged();
    });

    this.renderer.setMapContextMenuCallback((clientX, clientY, tileX, tileY) => {
      if (this.onMapContextMenu) this.onMapContextMenu(clientX, clientY, tileX, tileY);
    });
  }

  /**
   * Get the renderer (for map data operations)
   */
  public getRenderer(): IsometricMapRenderer | null {
    return this.renderer;
  }

  /**
   * Destroy renderer and cleanup
   */
  public destroy() {
    this.renderer?.destroy();
    this.renderer = null;
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }
}
