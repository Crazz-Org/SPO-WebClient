/**
 * IsometricMapRenderer
 *
 * Complete map renderer using isometric terrain with game objects (buildings, roads, overlays).
 *
 * Layers (back to front):
 * 1. Terrain base (IsometricTerrainRenderer) — flat only, no vegetation
 * 2. Vegetation overlay — special terrain tiles (trees, decorations)
 * 3. Concrete (pavement around buildings)
 * 4. Roads
 * 5. Buildings
 * 6. Zone overlay (colored zones)
 * 7. Fog (blocks never loaded, darkened)
 * 8. Placement preview
 * 9. Road drawing preview
 * 10. UI overlays
 */

import { priceRoadPath, roadPathTiles, type RoadTileFacts } from '../../shared/road-cost';
import { IsometricTerrainRenderer } from './isometric-terrain-renderer';
import { GameObjectTextureCache } from './game-object-texture-cache';
import { VegetationFlatMapper } from './vegetation-flat-mapper';
import { TouchHandler2D } from './touch-handler-2d';
import {
  Point,
  Rect,
  TileBounds,
  ZOOM_LEVELS,
  ZoomConfig,
  Rotation,
  Season,
  TerrainData
} from '../../shared/map-config';
import {
  MapBuilding,
  MapSegment,
  SurfaceData,
  FacilityDimensions,
  RoadDrawingState,
  ZONE_TYPES,
} from '../../shared/types';
import {
  RoadsRendering,
  RoadBlockClassManager,
  renderRoadSegment,
  RoadBlockId,
  roadBlockId,
  detectSmoothCorner,
  isJunctionTopology,
  rotateRoadBlockId,
  isBridge,
  isWater
} from './road-texture-system';
import { landTypeName, landClassName, decodeLandId, isSpecialTile, rotateLandId } from '../../shared/land-utils';
import {
  ConcreteBlockClassManager,
  loadConcreteBlockClassFromIni,
  getConcreteId,
  buildNeighborConfig,
  canReceiveConcrete,
  CONCRETE_NONE,
  CONCRETE_FULL,
  PLATFORM_IDS,
  PLATFORM_SHIFT,
  ConcreteMapData,
  ConcreteCfg
} from './concrete-texture-system';
// The painter's algorithm (i+j) sort is NORTH-only; we use screenY-based sort instead
import { CarClassManager } from './car-class-system';
import { VehicleAnimationSystem } from './vehicle-animation-system';
import { AircraftAnimationSystem } from './aircraft-animation-system';
import { validatePlacementZones } from './placement-validation';
import { ExploredBlocks, BLOCK_SIZE } from '../store/explored-blocks';

/** Alpha of a building owned by another tycoon when glassing is on — Voyager's cAlpha blend [INFERRED ≈ 50 %]. */
const FOREIGN_BUILDING_ALPHA = 0.5;
/** Red laid over a losing building's own pixels — legacy pfReddenPalette (Lander.pas:294-295), cLoosingColor = clRed (Map.pas:364); strength [INFERRED]. */
const LOSING_TINT = 'rgba(255, 0, 0, 0.45)';
/** Black laid over a block never loaded — Voyager halves the RGB (Map.pas:3777); reads the same over the iso tiles. */
const FOG_TINT = 'rgba(0, 0, 0, 0.55)';

interface CachedZone {
  x: number;
  y: number;
  w: number;
  h: number;
  buildings: MapBuilding[];
  segments: MapSegment[];
  lastLoadTime: number; // Timestamp when zone was loaded
  forceRefresh?: boolean; // Flag to force reload on next visibility check
}

interface CachedZoneSurface {
  x: number;       // Aligned zone origin X
  y: number;       // Aligned zone origin Y
  data: SurfaceData;
  lastLoadTime: number;
}

interface PlacementPreview {
  i: number;  // Map coordinate i
  j: number;  // Map coordinate j
  buildingName: string;
  cost: number;
  area: number;
  zoneRequirement: string;
  xsize: number;
  ysize: number;
  visualClass: string;  // For loading the building texture preview
  fallbackIconUrl?: string;  // Build menu icon URL when CLASSES.BIN has no entry
}

/**
 * Zone Request Manager
 *
 * Manages zone loading with:
 * - Movement-aware request delays (send when movement stops, not during)
 * - Zoom-based delay strategy (Z3 immediate, Z0 longest delay)
 * - Request queue with prioritization by distance to camera
 * - Server-safe concurrent request limit (max 3)
 * - Timeout handling and cleanup
 */
class ZoneRequestManager {
  // Queue of pending zone requests (sorted by priority)
  private zoneQueue: Array<{x: number, y: number, priority: number}> = [];

  // Currently loading zones with timestamps for timeout detection
  private loadingZones: Map<string, number> = new Map();

  // Movement state tracking
  private isMoving: boolean = false;
  private movementStopTimer: number | null = null;

  // Zoom-based delay configuration (milliseconds)
  private readonly ZOOM_DELAYS = {
    0: 500,  // Z0 (farthest) - wait for movement fully stops
    1: 300,  // Z1 - moderate delay
    2: 100,  // Z2 - short delay
    3: 0     // Z3 (closest) - immediate
  };

  // Server limit: max 3 concurrent requests
  private readonly MAX_CONCURRENT = 3;
  private readonly REQUEST_TIMEOUT = 15000; // 15s timeout

  // Zone staleness threshold (5 minutes)
  private readonly ZONE_EXPIRY_MS = 5 * 60 * 1000;

  constructor(
    private onLoadZone: (x: number, y: number, w: number, h: number) => void,
    private zoneSize: number = 64
  ) {}

  /**
   * Mark camera as moving (called during pan/zoom/rotate)
   */
  public markMoving(): void {
    this.isMoving = true;

    // Clear any pending movement stop timer
    if (this.movementStopTimer !== null) {
      clearTimeout(this.movementStopTimer);
      this.movementStopTimer = null;
    }
  }

  /**
   * Mark camera as stopped (called after pan/zoom/rotate ends)
   * Triggers delayed zone loading based on zoom level
   */
  public markStopped(currentZoom: number): void {
    this.isMoving = false;

    // Clear any pending timer
    if (this.movementStopTimer !== null) {
      clearTimeout(this.movementStopTimer);
    }

    // Use zoom-based delay
    const delay = this.ZOOM_DELAYS[currentZoom as keyof typeof this.ZOOM_DELAYS] || 500;

    this.movementStopTimer = window.setTimeout(() => {
      this.processQueue();
    }, delay);
  }

  /**
   * Request zones for visible area
   * Queues all needed zones and processes them based on movement state
   */
  public requestVisibleZones(
    visibleBounds: TileBounds,
    cachedZones: Map<string, CachedZone>,
    cameraPos: {i: number, j: number},
    currentZoom: number
  ): void {
    // Calculate zone boundaries (aligned to zoneSize grid)
    const minI = Math.min(visibleBounds.minI, visibleBounds.maxI);
    const maxI = Math.max(visibleBounds.minI, visibleBounds.maxI);
    const minJ = Math.min(visibleBounds.minJ, visibleBounds.maxJ);
    const maxJ = Math.max(visibleBounds.minJ, visibleBounds.maxJ);

    const startZoneX = Math.floor(minJ / this.zoneSize) * this.zoneSize;
    const endZoneX = Math.ceil(maxJ / this.zoneSize) * this.zoneSize;
    const startZoneY = Math.floor(minI / this.zoneSize) * this.zoneSize;
    const endZoneY = Math.ceil(maxI / this.zoneSize) * this.zoneSize;

    // Collect zones that need loading (new or stale)
    const zonesToAdd: Array<{x: number, y: number, priority: number}> = [];
    const now = Date.now();

    for (let zx = startZoneX; zx < endZoneX; zx += this.zoneSize) {
      for (let zy = startZoneY; zy < endZoneY; zy += this.zoneSize) {
        const key = `${zx},${zy}`;
        const cached = cachedZones.get(key);

        // Check if zone needs refresh
        let needsLoad = false;

        if (!cached) {
          // Zone not loaded yet
          needsLoad = true;
        } else {
          // Zone exists - check if stale or force refresh
          const age = now - cached.lastLoadTime;
          const isStale = age > this.ZONE_EXPIRY_MS;

          if (cached.forceRefresh || isStale) {
            // Remove stale zone from cache so it gets reloaded
            cachedZones.delete(key);
            needsLoad = true;

            if (isStale) {
              console.log(`[ZoneRequestManager] Zone ${key} is stale (${Math.floor(age / 1000)}s old), reloading`);
            } else {
              console.log(`[ZoneRequestManager] Zone ${key} marked for force refresh, reloading`);
            }
          }
        }

        if (!needsLoad) {
          continue;
        }

        // Skip if already loading
        if (this.loadingZones.has(key)) {
          continue;
        }

        // Skip if already in queue
        if (this.zoneQueue.some(z => z.x === zx && z.y === zy)) {
          continue;
        }

        // Calculate priority (distance to camera center)
        const centerX = zx + this.zoneSize / 2;
        const centerY = zy + this.zoneSize / 2;
        const distSq = (centerX - cameraPos.j) ** 2 + (centerY - cameraPos.i) ** 2;

        zonesToAdd.push({ x: zx, y: zy, priority: distSq });
      }
    }

    // Add new zones to queue and sort by priority (closest first)
    this.zoneQueue.push(...zonesToAdd);
    this.zoneQueue.sort((a, b) => a.priority - b.priority);

    // Process immediately when camera is stationary (all zoom levels)
    if (!this.isMoving) {
      this.processQueue();
    }
  }

  /**
   * Process zone queue - send requests up to concurrent limit
   */
  private processQueue(): void {
    // Clean up timed-out requests
    this.cleanupTimedOutRequests();

    // Calculate how many requests we can send
    const currentLoading = this.loadingZones.size;
    const slotsAvailable = this.MAX_CONCURRENT - currentLoading;

    if (slotsAvailable <= 0 || this.zoneQueue.length === 0) {
      return;
    }

    // Send up to slotsAvailable requests
    const zonesToRequest = this.zoneQueue.splice(0, slotsAvailable);

    for (const zone of zonesToRequest) {
      const key = `${zone.x},${zone.y}`;
      this.loadingZones.set(key, Date.now());
      this.onLoadZone(zone.x, zone.y, this.zoneSize, this.zoneSize);
    }
  }

  /**
   * Mark zone as loaded (called when response arrives)
   */
  public markZoneLoaded(x: number, y: number): void {
    // Align to zone grid
    const alignedX = Math.floor(x / this.zoneSize) * this.zoneSize;
    const alignedY = Math.floor(y / this.zoneSize) * this.zoneSize;
    const key = `${alignedX},${alignedY}`;

    this.loadingZones.delete(key);

    // Process more zones if queue not empty
    if (this.zoneQueue.length > 0 && !this.isMoving) {
      this.processQueue();
    }
  }

  /**
   * Clean up requests that have timed out
   */
  private cleanupTimedOutRequests(): void {
    const now = Date.now();
    const timedOut: string[] = [];

    this.loadingZones.forEach((timestamp, key) => {
      if (now - timestamp > this.REQUEST_TIMEOUT) {
        timedOut.push(key);
      }
    });

    timedOut.forEach(key => {
      console.warn(`[ZoneRequestManager] Zone ${key} request timed out`);
      this.loadingZones.delete(key);
    });
  }

  /**
   * Clear all pending requests and queue
   */
  public clear(): void {
    this.zoneQueue = [];
    this.loadingZones.clear();
    this.isMoving = false;

    if (this.movementStopTimer !== null) {
      clearTimeout(this.movementStopTimer);
      this.movementStopTimer = null;
    }
  }

  /**
   * Get current queue size (for debugging)
   */
  public getQueueSize(): number {
    return this.zoneQueue.length;
  }

  /**
   * Get current loading count (for debugging)
   */
  public getLoadingCount(): number {
    return this.loadingZones.size;
  }
}

export class IsometricMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Core terrain renderer
  private terrainRenderer: IsometricTerrainRenderer;

  // Vegetation→flat mapping near dynamic content
  private vegetationMapper: VegetationFlatMapper;

  // Game object texture cache (roads, buildings, etc.)
  private gameObjectTextureCache: GameObjectTextureCache;

  // Game objects
  private cachedZones: Map<string, CachedZone> = new Map();
  private allBuildings: MapBuilding[] = [];
  private allSegments: MapSegment[] = [];

  // Road tiles map for texture type detection
  private roadTilesMap: Map<string, boolean> = new Map();

  // Pre-computed concrete adjacency tiles (tiles within 1 tile of any building)
  private concreteTilesSet: Set<string> = new Set();

  // Pre-computed building occupation map — invalidated on zone change, reused across frame
  private cachedOccupiedTiles: Set<string> | null = null;

  // Road texture system
  private roadBlockClassManager: RoadBlockClassManager;
  private roadsRendering: RoadsRendering | null = null;
  private roadBlockClassesLoaded: boolean = false;

  // Concrete texture system
  private concreteBlockClassManager: ConcreteBlockClassManager;
  private concreteBlockClassesLoaded: boolean = false;

  // Building dimensions cache
  private facilityDimensionsCache: Map<string, FacilityDimensions> = new Map();

  // Mouse state
  private isDragging: boolean = false;
  private rightClickDragged: boolean = false;
  // Left-button click-or-pan arbitration, Voyager-style (GameControl.pas:533-597):
  // the button press is recorded, a drag begins once |dx| + |dy| exceeds
  // MIN_DRAG_MANHATTAN_PX, and a release without drag performs the click.
  private leftButtonDown: boolean = false;
  private leftClickDragged: boolean = false;
  private pressX: number = 0;
  private pressY: number = 0;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private hoveredBuilding: MapBuilding | null = null;
  private selectedBuilding: MapBuilding | null = null;
  private selectedBuildingDrawnTop: { x: number; y: number; textureHeight: number } | null = null;
  private selectionPulseTime: number = 0;
  // One-shot expanding ring drawn when a building is first selected
  private selectionBurstStartTime: number = 0;
  private mouseMapI: number = 0;
  private mouseMapJ: number = 0;
  private mouseHasEnteredCanvas: boolean = false;

  // Keyboard pan (arrow keys) — velocity in screen pixels applied by a rAF loop,
  // independent of the OS key-repeat rate
  private heldPanKeys: Set<string> = new Set();
  private keyboardPanRunning: boolean = false;
  private lastKeyboardPanTime: number = 0;

  // Zone loading - managed by ZoneRequestManager
  private zoneRequestManager: ZoneRequestManager | null = null;

  // Callbacks
  private onLoadZone: ((x: number, y: number, w: number, h: number) => void) | null = null;
  private onBuildingClick: ((x: number, y: number, visualClass?: string) => void) | null = null;
  private onCancelPlacement: (() => void) | null = null;
  private onPlacementConfirm: ((x: number, y: number) => void) | null = null;
  private onPlacementValidityChange: ((valid: boolean) => void) | null = null;
  private prevPlacementInvalid: boolean = false;
  private onFetchFacilityDimensions: ((visualClass: string) => Promise<FacilityDimensions | null>) | null = null;
  private onRoadSegmentComplete: ((x1: number, y1: number, x2: number, y2: number) => void) | null = null;
  private onCancelRoadDrawing: (() => void) | null = null;
  private onRoadDemolishClick: ((x: number, y: number) => void) | null = null;
  private onCancelRoadDemolish: (() => void) | null = null;
  private onEmptyMapClick: (() => void) | null = null;
  private onViewportChanged: (() => void) | null = null;
  private onMapContextMenu: ((clientX: number, clientY: number, tileX: number, tileY: number) => void) | null = null;

  // Zone overlay
  private zoneOverlayEnabled: boolean = false;
  private overlayIsHeatmap: boolean = false;
  private overlayIsTowns: boolean = false;
  private cachedZoneSurfaces: Map<string, CachedZoneSurface> = new Map();

  // Placement preview
  private placementPreview: PlacementPreview | null = null;
  private placementMode: boolean = false;
  private placementInvalid: boolean = false;
  private fallbackIconImages: Map<string, HTMLImageElement | null> = new Map();
  // 0 = fully valid (green), 1 = fully invalid (red) — lerped each frame
  private placementColorT: number = 0;
  private placementColorTLastMs: number = 0;

  // Per-building visual effects: upgrade flash/scale-pop and demolition shrink/fade
  private buildingEffects: Map<string, { type: 'upgrade' | 'demolish'; startTime: number; building: MapBuilding }> = new Map();

  /** Portal facilities (6031/6032) are non-interactive map decorations.
   *  Base visual class 6031; Delphi GetVisualClassId returns 0 or 1
   *  based on population flow, so the server alternates between 6031 and 6032. */
  private static isPortal(building: MapBuilding): boolean {
    return building.visualClass === '6031' || building.visualClass === '6032';
  }

  /** Voyager cMinDrag (GameControl.pas:543): |dx| + |dy| above this is a drag, not a click */
  private static readonly MIN_DRAG_MANHATTAN_PX = 8;
  /** Arrow-key pan speed — half a viewport per second, in screen pixels */
  private static readonly KEYBOARD_PAN_VIEWPORTS_PER_S = 0.5;
  private static readonly ARROW_KEYS: ReadonlySet<string> =
    new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  // Road drawing
  private roadDrawingMode: boolean = false;
  private roadDrawingState: RoadDrawingState = {
    isDrawing: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isMouseDown: false,
    mouseDownTime: 0
  };

  // Connect mode (map-click to connect two buildings)
  private connectMode: boolean = false;
  private onConnectModeClick: ((x: number, y: number) => void) | null = null;

  // Zone painting
  private zonePaintingMode: boolean = false;
  private zonePaintingType: number = 2;
  private zonePaintingState = { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 };
  private onZoneAreaComplete: ((x1: number, y1: number, x2: number, y2: number) => void) | null = null;
  private onCancelZonePainting: (() => void) | null = null;

  // Road demolish drag selection
  private roadDemolishDragState = { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 };
  private onRoadDemolishAreaComplete: ((x1: number, y1: number, x2: number, y2: number) => void) | null = null;

  // Map loaded flag
  private mapLoaded: boolean = false;
  private mapName: string = '';

  // Debug mode
  private debugMode: boolean = false;
  private debugShowTileInfo: boolean = true;
  private debugShowBuildingInfo: boolean = true;
  private debugShowConcreteInfo: boolean = true;
  private debugShowRoadInfo: boolean = false;
  private debugShowWaterGrid: boolean = false;

  // Debug: track why each concrete tile was added (building buffer / junction 3×3)
  private debugConcreteSourceMap: Map<string, 'building' | 'junction'> = new Map();

  // Touch handler for mobile
  private touchHandler: TouchHandler2D | null = null;

  // Vegetation display control
  private vegetationEnabled: boolean = true;
  private isVegetationHiddenOnMove: boolean = false;
  private isCameraMoving: boolean = false;
  private cameraStopTimer: number | null = null;
  private readonly CAMERA_STOP_DEBOUNCE_MS = 200;

  // Render debouncing (RAF-based, prevents redundant renders per frame)
  private pendingRender: number | null = null;

  // Ground layer cache (OffscreenCanvas bakes terrain+veg+concrete+roads at Z2/Z3)
  private groundCanvas: OffscreenCanvas | null = null;
  private groundCtx: OffscreenCanvasRenderingContext2D | null = null;
  private groundCacheValid: boolean = false;
  private groundCacheZoom: number = -1;
  private groundCacheRotation: Rotation = Rotation.NORTH;
  private groundCacheOriginX: number = 0;
  private groundCacheOriginY: number = 0;
  // Extra frustum culling padding during ground cache rebuild (extends viewport clip)
  private cullingPadding: number = 0;

  // Vehicle animation system
  private carClassManager: CarClassManager = new CarClassManager();
  private vehicleSystem: VehicleAnimationSystem | null = null;
  private vehicleSystemReady: boolean = false;
  private aircraftSystem: AircraftAnimationSystem = new AircraftAnimationSystem();
  /** Legacy 'UseTransparency' (Map.pas:1415-1416): draw buildings of other tycoons translucent. */
  private glassForeignBuildings: boolean = true;
  /** The player's own tycoon id, 0 until login supplies one — 0 glasses nothing. */
  private ownTycoonId: number = 0;
  /** Legacy 'Signal losing facilities' (Map.pas:1323-1324): shade my own alerting buildings red. */
  private signalLosingFacilities: boolean = false;
  /** Facility kinds (FacIds) the player chose to hide — empty means nothing is hidden. */
  private hiddenFacIds: Set<number> = new Set();
  /** Scratch canvas the red shade is composed on; created on first use, never while the option is off. */
  private losingScratch: HTMLCanvasElement | null = null;
  /** Blocks this player has loaded in this world; null = fog off (no set attached). */
  private exploredBlocks: ExploredBlocks | null = null;
  private animationLoopRunning: boolean = false;
  private hasAnimatedBuildings: boolean = false;
  private lastRenderTime: number = 0;
  private lastPulseRenderTime: number = 0;
  private lastPlacementRenderTime: number = 0;
  private lastVehicleFrameTime: number = 0;
  // Bound event handlers for proper cleanup
  private boundMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private boundMouseUp = (e: MouseEvent) => this.onMouseUp(e);
  private boundMouseLeave = () => this.onMouseLeave();
  private boundWheel = (e: WheelEvent) => this.onWheel(e);
  private boundContextMenu = (e: MouseEvent) => e.preventDefault();
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundWindowBlur: (() => void) | null = null;

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas with id "${canvasId}" not found`);
    }

    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;

    // Create terrain renderer (shares canvas, mouse controls handled by this class)
    this.terrainRenderer = new IsometricTerrainRenderer(canvas, { disableMouseControls: true });

    // Create vegetation→flat mapper (replaces vegetation textures near buildings/roads)
    this.vegetationMapper = new VegetationFlatMapper(2);

    // Disable terrain renderer's debug info - this renderer handles its own overlay at the end
    this.terrainRenderer.setShowDebugInfo(false);

    // Wire up render delegation: when terrain chunks become ready, rebuild ground cache
    // and trigger a full-pipeline render (prevents blinking where buildings/roads disappear)
    this.terrainRenderer.setOnRenderNeeded(() => {
      // Invalidate content (new chunks available) but keep position valid
      this.groundCacheValid = false;
      this.requestRender();
    });

    // Create game object texture cache (roads, buildings, etc.)
    this.gameObjectTextureCache = new GameObjectTextureCache();

    // Setup callback to re-render when textures are loaded
    this.gameObjectTextureCache.setOnTextureLoaded((category, name) => {
      if (category === 'BuildingImages' || category === 'RoadBlockImages' || category === 'ConcreteImages' || category === 'CarImages') {
        // Re-render when textures become available (debounced)
        this.requestRender();
      }
    });

    // Load road, concrete, and car atlases in parallel (single render when all done)
    Promise.all([
      this.gameObjectTextureCache.loadObjectAtlas('road'),
      this.gameObjectTextureCache.loadObjectAtlas('concrete'),
      this.gameObjectTextureCache.loadObjectAtlas('car'),
    ]).then(() => this.requestRender());

    // Initialize road block class manager
    this.roadBlockClassManager = new RoadBlockClassManager();
    this.roadBlockClassManager.setBasePath('/cache/');

    // Load road block classes asynchronously
    this.loadRoadBlockClasses();

    // Initialize concrete block class manager
    this.concreteBlockClassManager = new ConcreteBlockClassManager();
    this.concreteBlockClassManager.setBasePath('/cache/');

    // Load concrete block classes asynchronously
    this.loadConcreteBlockClasses();

    // Load car classes and initialize vehicle animation system
    this.loadCarClasses();

    // Setup event handlers
    this.setupMouseControls();
    this.setupKeyboardControls();
    this.setupTouchControls();

    // Initial render
    this.render();
  }

  /**
   * Setup keyboard controls for map rotation, zoom, and debug overlays.
   * Skips when focus is in a text input or when a UI modal/panel is active
   * (those keys are handled by useKeyboardShortcuts).
   */
  private setupKeyboardControls() {
    this.boundKeyDown = (e: KeyboardEvent) => this.handleMapKeyDown(e);
    this.boundKeyUp = (e: KeyboardEvent) => this.handleMapKeyUp(e);
    this.boundWindowBlur = () => this.cancelKeyboardPan();
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundWindowBlur);
  }

  /** True when the event target owns the keyboard (form fields, ARIA text widgets). */
  private static targetOwnsKeyboard(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
    return role === 'textbox' || role === 'combobox' || role === 'searchbox';
  }

  /**
   * Map-owned keys: arrows (pan), + / − (zoom), 1–5 (debug sub-overlays).
   * Rotation (Q / W) belongs to useKeyboardShortcuts — one owner per key.
   */
  private handleMapKeyDown(e: KeyboardEvent): void {
    if (IsometricMapRenderer.targetOwnsKeyboard(e)) return;
    if (e.isComposing) return;
    // Modifier chords belong to the browser (Ctrl+− is page zoom, not map zoom)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (IsometricMapRenderer.ARROW_KEYS.has(e.key)) {
      e.preventDefault();
      this.heldPanKeys.add(e.key);
      this.startKeyboardPan();
      return;
    }
    // '+' or '=' zooms in
    if (e.key === '+' || e.key === '=') {
      this.zoomIn();
    }
    // '-' zooms out
    if (e.key === '-') {
      this.zoomOut();
    }
    // Debug sub-overlays (only active when debug mode is on)
    if (e.key === '1' && this.debugMode) {
      this.debugShowTileInfo = !this.debugShowTileInfo;
      this.requestRender();
    }
    if (e.key === '2' && this.debugMode) {
      this.debugShowBuildingInfo = !this.debugShowBuildingInfo;
      this.requestRender();
    }
    if (e.key === '3' && this.debugMode) {
      this.debugShowConcreteInfo = !this.debugShowConcreteInfo;
      this.requestRender();
    }
    if (e.key === '4' && this.debugMode) {
      this.debugShowWaterGrid = !this.debugShowWaterGrid;
      this.requestRender();
    }
    if (e.key === '5' && this.debugMode) {
      this.debugShowRoadInfo = !this.debugShowRoadInfo;
      this.requestRender();
    }
  }

  private handleMapKeyUp(e: KeyboardEvent): void {
    if (this.heldPanKeys.delete(e.key) && this.heldPanKeys.size === 0) {
      this.stopKeyboardPan();
    }
  }

  /** Drive the arrow-key pan from a rAF loop so speed is frame-rate-independent. */
  private startKeyboardPan(): void {
    if (this.keyboardPanRunning) return;
    this.keyboardPanRunning = true;
    this.lastKeyboardPanTime = performance.now();
    const step = () => {
      if (!this.keyboardPanRunning) return;
      const now = performance.now();
      // Clamp: a throttled tab can stall rAF for seconds — don't teleport on resume
      const dt = Math.min((now - this.lastKeyboardPanTime) / 1000, 0.1);
      this.lastKeyboardPanTime = now;
      this.keyboardPanStep(dt);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** One frame of arrow-key pan. Direction is in view terms: ArrowRight moves the view east. */
  private keyboardPanStep(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    const keys = this.heldPanKeys;
    // Moving the view right means dragging the map content left — hence the sign flip
    const dirX = (keys.has('ArrowLeft') ? 1 : 0) + (keys.has('ArrowRight') ? -1 : 0);
    const dirY = (keys.has('ArrowUp') ? 1 : 0) + (keys.has('ArrowDown') ? -1 : 0);
    if (dirX === 0 && dirY === 0) return;

    const speed = IsometricMapRenderer.KEYBOARD_PAN_VIEWPORTS_PER_S;
    const dx = dirX * this.canvas.clientWidth * speed * dtSeconds;
    const dy = dirY * this.canvas.clientHeight * speed * dtSeconds;
    const { deltaI, deltaJ } = this.screenDeltaToMapDelta(dx, dy);
    this.terrainRenderer.pan(deltaI, deltaJ);

    this.markCameraMoving();
    if (this.zoneRequestManager) {
      this.zoneRequestManager.markMoving();
    }
    this.requestRender();
  }

  private stopKeyboardPan(): void {
    if (!this.keyboardPanRunning) return;
    this.keyboardPanRunning = false;
    if (this.zoneRequestManager) {
      this.zoneRequestManager.markStopped(this.terrainRenderer.getZoomLevel());
    }
    this.checkVisibleZones();
  }

  /** Window blur while an arrow is held would leave the camera drifting — drop everything. */
  private cancelKeyboardPan(): void {
    this.heldPanKeys.clear();
    this.stopKeyboardPan();
  }

  /**
   * Rotate view clockwise (Q: NORTH→EAST→SOUTH→WEST→NORTH)
   */
  private rotateClockwise(): void {
    const current = this.terrainRenderer.getRotation();
    const next = (current + 1) % 4 as Rotation;
    this.terrainRenderer.setRotation(next);
    this.markCameraMoving();

    // Clear vehicles on rotation change (CarPaths are in tile-local coords)
    if (this.vehicleSystem) this.vehicleSystem.clear();

    // Mark zone request manager and trigger delayed zone load
    if (this.zoneRequestManager) {
      const currentZoom = this.terrainRenderer.getZoomLevel();
      this.zoneRequestManager.markMoving();
      this.zoneRequestManager.markStopped(currentZoom);
    }
    this.checkVisibleZones();

    console.log(`[IsometricMapRenderer] Rotation: ${Rotation[next]}`);
    this.requestRender();
  }

  /**
   * Rotate view counter-clockwise (E: NORTH→WEST→SOUTH→EAST→NORTH)
   */
  private rotateCounterClockwise(): void {
    const current = this.terrainRenderer.getRotation();
    const next = (current + 3) % 4 as Rotation; // +3 is equivalent to -1 mod 4
    this.terrainRenderer.setRotation(next);
    this.markCameraMoving();

    // Clear vehicles on rotation change (CarPaths are in tile-local coords)
    if (this.vehicleSystem) this.vehicleSystem.clear();

    // Mark zone request manager and trigger delayed zone load
    if (this.zoneRequestManager) {
      const currentZoom = this.terrainRenderer.getZoomLevel();
      this.zoneRequestManager.markMoving();
      this.zoneRequestManager.markStopped(currentZoom);
    }
    this.checkVisibleZones();

    console.log(`[IsometricMapRenderer] Rotation: ${Rotation[next]}`);
    this.requestRender();
  }

  public zoomIn(): void {
    this.terrainRenderer.setZoomLevel(this.terrainRenderer.getZoomLevel() + 1);
    if (this.zoneRequestManager) {
      this.zoneRequestManager.markStopped(this.terrainRenderer.getZoomLevel());
    }
    this.requestRender();
  }

  public zoomOut(): void {
    this.terrainRenderer.setZoomLevel(this.terrainRenderer.getZoomLevel() - 1);
    if (this.zoneRequestManager) {
      this.zoneRequestManager.markStopped(this.terrainRenderer.getZoomLevel());
    }
    this.requestRender();
  }

  public rotateCW(): void {
    this.rotateClockwise();
  }

  public rotateCCW(): void {
    this.rotateCounterClockwise();
  }

  /**
   * Setup touch controls for mobile (pan, pinch-zoom, rotation snap, double-tap)
   */
  private setupTouchControls(): void {
    this.touchHandler = new TouchHandler2D(this.canvas, {
      onPan: (dx, dy) => {
        // Convert screen delta to map delta (rotation-aware, same logic as mouse drag)
        const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
        const u = config.u;
        const a = (dx + 2 * dy) / (4 * u);
        const b = (2 * dy - dx) / (4 * u);

        let deltaI: number;
        let deltaJ: number;
        switch (this.terrainRenderer.getRotation()) {
          case Rotation.NORTH: deltaI = a;  deltaJ = b;  break;
          case Rotation.EAST:  deltaI = -b; deltaJ = a;  break;
          case Rotation.SOUTH: deltaI = -a; deltaJ = -b; break;
          case Rotation.WEST:  deltaI = b;  deltaJ = -a; break;
          default:             deltaI = a;  deltaJ = b;
        }
        this.terrainRenderer.pan(deltaI, deltaJ);
        this.markCameraMoving();

        // Mark zone request manager as moving
        if (this.zoneRequestManager) {
          this.zoneRequestManager.markMoving();
        }

        // In placement mode: keep ghost at screen center as map pans beneath it
        if (this.placementMode && this.placementPreview) {
          const cx = this.canvas.width / 2;
          const cy = this.canvas.height / 2;
          const raw = this.terrainRenderer.screenToMap(cx, cy);
          this.placementPreview.i = Math.floor(raw.x); // row
          this.placementPreview.j = Math.floor(raw.y); // col
        }

        this.requestRender();
      },
      onPanEnd: () => {
        // Mark movement stopped and trigger delayed zone loading
        if (this.zoneRequestManager) {
          const currentZoom = this.terrainRenderer.getZoomLevel();
          this.zoneRequestManager.markStopped(currentZoom);
        }

        // Also request immediately (manager will handle delay internally)
        this.checkVisibleZones();
      },
      onZoom: (delta) => {
        const current = this.terrainRenderer.getZoomLevel();
        const newZoom = current + delta;
        this.terrainRenderer.setZoomLevel(newZoom);
        this.terrainRenderer.clearDistantZoomCaches(newZoom);

        // Clear vehicles when zooming out of Z2/Z3
        if (current >= 2 && newZoom < 2 && this.vehicleSystem) {
          this.vehicleSystem.clear();
          this.animationLoopRunning = false;
        }
        if (current >= 2 && newZoom < 2) {
          this.aircraftSystem.clear();
        }
        if (current < 2 && newZoom >= 2) {
          this.startAnimationLoop();
        }

        // Mark as moving then stopped (triggers delayed zone load based on new zoom)
        if (this.zoneRequestManager) {
          this.zoneRequestManager.markMoving();
          this.zoneRequestManager.markStopped(newZoom);
        }

        this.checkVisibleZones();
        this.requestRender();
      },
      onRotate: (direction) => {
        if (direction === 'cw') {
          this.rotateClockwise();
        } else {
          this.rotateCounterClockwise();
        }
      },
      onDoubleTap: (x, y) => {
        // Center camera on tapped location
        const mapPos = this.terrainRenderer.screenToMap(x, y);
        this.terrainRenderer.centerOn(mapPos.x, mapPos.y);
        this.requestRender();
      },
      onSingleTap: (x, y) => {
        if (this.placementMode && this.placementPreview) {
          // In placement mode on mobile: ignore taps — user confirms via PlacementHUD button only.
          // Pan to position the centered preview, then tap the green check.
          return;
        } else {
          // Normal map tap: building selection (same logic as mouse left-click)
          const raw = this.terrainRenderer.screenToMap(x, y);
          const mapI = Math.floor(raw.x); // row
          const mapJ = Math.floor(raw.y); // col
          const building = this.getBuildingAt(mapJ, mapI);
          if (building && !IsometricMapRenderer.isPortal(building) && this.onBuildingClick) {
            this.onBuildingClick(building.x, building.y, building.visualClass);
          } else if (!building && this.onEmptyMapClick) {
            this.onEmptyMapClick();
          }
        }
      },
    });
  }

  // =========================================================================
  // MAP LOADING
  // =========================================================================

  /**
   * Load terrain for a map
   */
  public async loadMap(mapName: string): Promise<TerrainData> {
    this.mapName = mapName;

    const terrainData = await this.terrainRenderer.loadMap(mapName);
    this.mapLoaded = true;

    // Clear cached zones and zone surfaces when loading new map
    this.cachedZones.clear();
    this.cachedZoneSurfaces.clear();
    if (this.zoneRequestManager) {
      this.zoneRequestManager.clear();
    }
    this.allBuildings = [];
    this.allSegments = [];

    this.render();

    // NOTE: Do NOT call checkVisibleZones() here - let the callback be set first
    // Zone loading will be triggered via triggerZoneCheck() when setOnLoadZone() is called
    // (See map-navigation-ui.ts setOnLoadZone method which calls triggerZoneCheck)

    return terrainData;
  }

  /**
   * Check if map is loaded
   */
  isLoaded(): boolean {
    return this.mapLoaded && this.terrainRenderer.isLoaded();
  }

  /**
   * Load road block class configurations from the server
   */
  private async loadRoadBlockClasses(): Promise<void> {
    try {
      const response = await fetch('/api/road-block-classes');
      if (!response.ok) {
        console.error('[IsometricMapRenderer] Failed to load road block classes:', response.status);
        return;
      }

      const data = await response.json();
      const files: Array<{ filename: string; content: string }> = data.files || [];

      console.log(`[IsometricMapRenderer] Loading ${files.length} road block classes...`);

      for (const file of files) {
        this.roadBlockClassManager.loadFromIni(file.content);
      }

      this.roadBlockClassesLoaded = true;
      console.log(`[IsometricMapRenderer] Road block classes loaded successfully`);

      // Re-render to show road textures
      this.requestRender();
    } catch (error: unknown) {
      console.error('[IsometricMapRenderer] Error loading road block classes:', error);
    }
  }

  /**
   * Load concrete block class configurations from the server
   */
  private async loadConcreteBlockClasses(): Promise<void> {
    try {
      const response = await fetch('/api/concrete-block-classes');
      if (!response.ok) {
        console.error('[IsometricMapRenderer] Failed to load concrete block classes:', response.status);
        return;
      }

      const data = await response.json();
      const files: Array<{ filename: string; content: string }> = data.files || [];

      console.log(`[IsometricMapRenderer] Loading ${files.length} concrete block classes...`);

      for (const file of files) {
        const config = loadConcreteBlockClassFromIni(file.content);
        console.log(`[ConcreteINI] ${file.filename}: ID=${config.id} (0x${config.id.toString(16)}) -> ${config.imagePath}`);
        this.concreteBlockClassManager.loadFromIni(file.content);
      }

      this.concreteBlockClassesLoaded = true;
      console.log(`[IsometricMapRenderer] Concrete block classes loaded successfully (${this.concreteBlockClassManager.getClassCount()} classes)`);

      // Debug: Check if platform IDs are loaded
      const platformIds = [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88];
      console.log('[ConcreteDebug] === PLATFORM ID CHECK ===');
      for (const id of platformIds) {
        const hasClass = this.concreteBlockClassManager.hasClass(id);
        const filename = this.concreteBlockClassManager.getImageFilename(id);
        console.log(`[ConcreteDebug] Platform ID 0x${id.toString(16)} (${id}): loaded=${hasClass}, texture=${filename}`);
      }

      // List all loaded IDs
      const allIds = this.concreteBlockClassManager.getAllIds();
      console.log(`[ConcreteDebug] All ${allIds.length} loaded IDs:`, allIds.map(id => `0x${id.toString(16)}(${id})`).join(', '));

      // Re-render to show concrete textures
      this.requestRender();
    } catch (error: unknown) {
      console.error('[IsometricMapRenderer] Error loading concrete block classes:', error);
    }
  }

  /**
   * Load car class configurations from the server and initialize the vehicle animation system
   */
  private async loadCarClasses(): Promise<void> {
    try {
      const response = await fetch('/api/car-classes');
      if (!response.ok) {
        console.error('[IsometricMapRenderer] Failed to load car classes:', response.status);
        return;
      }

      const data = await response.json();
      const files: Array<{ filename: string; content: string }> = data.files || [];

      console.log(`[IsometricMapRenderer] Loading ${files.length} car classes...`);

      for (const file of files) {
        this.carClassManager.loadFromIni(file.content);
      }

      console.log(`[IsometricMapRenderer] Car classes loaded: ${this.carClassManager.getClassCount()} classes`);

      // Initialize vehicle animation system
      this.vehicleSystem = new VehicleAnimationSystem();
      this.vehicleSystem.setCarClassManager(this.carClassManager);
      this.vehicleSystem.setRoadBlockClassManager(this.roadBlockClassManager);
      this.vehicleSystem.setGameObjectTextureCache(this.gameObjectTextureCache);
      this.vehicleSystemReady = true;
    } catch (error: unknown) {
      console.error('[IsometricMapRenderer] Error loading car classes:', error);
    }
  }

  /**
   * Start the continuous animation loop for vehicles.
   * Only runs when vehicles are active (Z2/Z3 + vehicles exist).
   */
  private startAnimationLoop(): void {
    if (this.animationLoopRunning) return;
    this.animationLoopRunning = true;
    this.lastRenderTime = performance.now();

    const loop = () => {
      if (!this.animationLoopRunning) return;

      const zoom = this.terrainRenderer.getZoomLevel();
      // Only animate at Z2 and Z3, throttled to 30fps (33ms between frames)
      if (zoom >= 2 && ((this.vehicleSystemReady && this.vehicleSystem) || this.aircraftSystem.isActive())) {
        const now = performance.now();
        if (now - this.lastVehicleFrameTime >= 33) {
          this.lastVehicleFrameTime = now;
          this.requestRender();
        }
        requestAnimationFrame(loop);
      } else {
        this.animationLoopRunning = false;
      }
    };

    requestAnimationFrame(loop);
  }

  /**
   * Draw animated vehicles on roads (layer between buildings and zone overlay).
   * Active only at Z2 and Z3 zoom levels.
   */
  private drawVehicles(bounds: TileBounds, deltaTime: number, occupiedTiles: Set<string>): void {
    const zoom = this.terrainRenderer.getZoomLevel();
    if (zoom < 2) return;
    if (!this.vehicleSystemReady || !this.vehicleSystem) return;

    // Update road data dependencies for the vehicle system
    this.vehicleSystem.setRoadData(
      this.roadTilesMap,
      this.roadsRendering,
      (col, row) => {
        const terrainLoader = this.terrainRenderer.getTerrainLoader();
        return terrainLoader.getLandId(col, row);
      },
      (col, row) => this.hasConcrete(col, row)
    );

    // Update vehicle positions and spawn new vehicles
    this.vehicleSystem.update(deltaTime, bounds);

    // Render visible vehicles
    const config = ZOOM_LEVELS[zoom];
    this.vehicleSystem.render(
      this.ctx,
      (i: number, j: number) => this.terrainRenderer.mapToScreen(i, j),
      config,
      this.canvas.width,
      this.canvas.height,
      (col: number, row: number) => this.isOnWaterPlatform(col, row)
    );

    // Start animation loop if vehicles are active
    if (this.vehicleSystem.isActive() || this.vehicleSystem.getVehicleCount() === 0) {
      this.startAnimationLoop();
    }
  }

  /** Draw aircraft above buildings and zones (sky layer). Active only at Z2 and Z3, like vehicles. */
  private drawAircraft(bounds: TileBounds, deltaTime: number): void {
    const zoom = this.terrainRenderer.getZoomLevel();
    if (zoom < 2) return;
    this.aircraftSystem.update(deltaTime, bounds);
    this.aircraftSystem.render(
      this.ctx,
      (i: number, j: number) => this.terrainRenderer.mapToScreen(i, j),
      ZOOM_LEVELS[zoom],
      this.canvas.width,
      this.canvas.height
    );
    if (this.aircraftSystem.isActive()) this.startAnimationLoop();
  }

  // =========================================================================
  // ZONE MANAGEMENT
  // =========================================================================

  /**
   * Add a cached zone with buildings and segments
   * Note: Cache key is aligned to zone grid (64-tile boundaries) for consistency
   */
  public addCachedZone(
    x: number,
    y: number,
    w: number,
    h: number,
    buildings: MapBuilding[],
    segments: MapSegment[]
  ) {
    // Align coordinates to zone grid for consistent cache keys
    const zoneSize = 64;
    const alignedX = Math.floor(x / zoneSize) * zoneSize;
    const alignedY = Math.floor(y / zoneSize) * zoneSize;
    const key = `${alignedX},${alignedY}`;

    // Clip buildings to query bounds — matches Delphi client's post-filter on ObjectsInArea.
    // The game server's GetObjectsInArea (Kernel/World.pas) uses inclusive Delphi for-loops
    // that can return buildings slightly outside the requested rectangle. The legacy client
    // clips with: if (obj.r >= imin) and (obj.r <= imax) and (obj.c >= jmin) and (obj.c <= jmax)
    const clipped = buildings.filter(b =>
      b.x >= alignedX && b.x < alignedX + w &&
      b.y >= alignedY && b.y < alignedY + h
    );

    // Check if zone data actually changed (avoid redundant ground cache rebuilds)
    const existing = this.cachedZones.get(key);
    const segmentsChanged = !existing ||
      existing.segments.length !== segments.length ||
      existing.buildings.length !== clipped.length;

    this.cachedZones.set(key, {
      x: alignedX,
      y: alignedY,
      w,
      h,
      buildings: clipped,
      segments,
      lastLoadTime: Date.now(),
      forceRefresh: false
    });

    // Notify zone request manager that zone is loaded
    if (this.zoneRequestManager) {
      this.zoneRequestManager.markZoneLoaded(alignedX, alignedY);
    }

    this.exploredBlocks?.mark(alignedX, alignedY);

    // Rebuild aggregated lists
    this.rebuildAggregatedData();

    // Fetch dimensions for new buildings
    this.fetchDimensionsForBuildings(clipped);

    // Only invalidate ground cache if zone content actually changed
    if (segmentsChanged) {
      this.invalidateGroundCache();
    }
    this.requestRender();
  }

  /**
   * Rebuild all buildings and segments from cached zones
   */
  private rebuildAggregatedData() {
    // Snapshot previous buildings before clearing (for upgrade/demolition detection)
    const prevByKey = new Map<string, MapBuilding>();
    for (const b of this.allBuildings) {
      prevByKey.set(`${b.x},${b.y}`, b);
    }

    this.allBuildings = [];
    this.allSegments = [];
    this.roadTilesMap.clear();
    this.cachedOccupiedTiles = null; // Invalidate occupation cache

    this.cachedZones.forEach(zone => {
      this.allBuildings.push(...zone.buildings);
      this.allSegments.push(...zone.segments);
    });

    // Build road tiles map for connectivity detection
    this.allSegments.forEach(seg => {
      const minX = Math.min(seg.x1, seg.x2);
      const maxX = Math.max(seg.x1, seg.x2);
      const minY = Math.min(seg.y1, seg.y2);
      const maxY = Math.max(seg.y1, seg.y2);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          this.roadTilesMap.set(`${x},${y}`, true);
        }
      }
    });

    // Rebuild road topology FIRST — needed to identify junctions for concrete placement
    this.rebuildRoadsRendering();

    // Pre-compute concrete adjacency tiles:
    // 1. Tiles within 1 tile of any building
    // 2. Water road junctions (corners, T, crossroads) + their adjacent connected road tiles
    // On water (ZoneD), only place concrete on deep water (Center) tiles — skip edges/corners
    this.concreteTilesSet.clear();
    this.debugConcreteSourceMap.clear();
    const terrainLoaderForConcrete = this.terrainRenderer.getTerrainLoader();
    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const bw = dims?.xsize || 1;
      const bh = dims?.ysize || 1;

      // Expand building bounds by 1 tile in each direction
      for (let y = building.y - 1; y < building.y + bh + 1; y++) {
        for (let x = building.x - 1; x < building.x + bw + 1; x++) {
          // Filter out water edge/corner tiles — only ldtCenter accepts concrete
          if (terrainLoaderForConcrete) {
            const landId = terrainLoaderForConcrete.getLandId(x, y);
            if (!canReceiveConcrete(landId)) continue;
          }
          const key = `${x},${y}`;
          this.concreteTilesSet.add(key);
          this.debugConcreteSourceMap.set(key, 'building');
        }
      }
    }

    // Add concrete platforms around water road junctions (corners, T, crossroads)
    // Bridge textures don't support these topologies, so they need a concrete platform
    // with regular road textures. Also adds concrete to the one adjacent tile in each
    // connected direction (transition from bridge to platform road).
    this.addWaterRoadJunctionConcrete(terrainLoaderForConcrete);

    // Update vegetation→flat zones (used by drawVegetation to hide vegetation near buildings/roads)
    this.vegetationMapper.updateDynamicContent(
      this.allBuildings,
      this.allSegments,
      this.facilityDimensionsCache
    );

    // Detect upgrade (visualClass changed) and demolition (building removed).
    // Skip on first load (prevByKey is empty — no real changes to animate).
    if (prevByKey.size > 0) {
      const now = performance.now();
      const newByKey = new Map<string, MapBuilding>();
      for (const b of this.allBuildings) {
        newByKey.set(`${b.x},${b.y}`, b);
      }

      // Upgrades: same position, different visualClass
      for (const [key, newB] of newByKey) {
        const prev = prevByKey.get(key);
        if (prev && prev.visualClass !== newB.visualClass && !IsometricMapRenderer.isPortal(newB)) {
          this.buildingEffects.set(key, { type: 'upgrade', startTime: now, building: newB });
        }
      }

      // Demolitions: building present before but gone now
      for (const [key, prevB] of prevByKey) {
        if (!newByKey.has(key) && !IsometricMapRenderer.isPortal(prevB) && this.buildingEffects.get(key)?.type !== 'demolish') {
          this.buildingEffects.set(key, { type: 'demolish', startTime: now, building: prevB });
        }
      }
    }

    // Expire finished effects
    const expireNow = performance.now();
    for (const [key, effect] of this.buildingEffects) {
      const duration = effect.type === 'upgrade' ? 450 : 500;
      if (expireNow - effect.startTime > duration) {
        this.buildingEffects.delete(key);
      }
    }
  }

  /**
   * Rebuild the RoadsRendering buffer from all segments
   * This computes the topology (shape) of each road tile
   */
  private rebuildRoadsRendering() {
    if (this.allSegments.length === 0) {
      this.roadsRendering = null;
      return;
    }

    // Calculate bounds of all road segments
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const seg of this.allSegments) {
      minX = Math.min(minX, seg.x1, seg.x2);
      maxX = Math.max(maxX, seg.x1, seg.x2);
      minY = Math.min(minY, seg.y1, seg.y2);
      maxY = Math.max(maxY, seg.y1, seg.y2);
    }

    // Add padding for edge cases
    const padding = 1;
    const left = minX - padding;
    const top = minY - padding;
    const width = maxX - minX + 1 + 2 * padding;
    const height = maxY - minY + 1 + 2 * padding;

    // Create rendering buffer
    this.roadsRendering = new RoadsRendering(top, left, width, height);

    // Render all segments into the buffer
    for (const seg of this.allSegments) {
      renderRoadSegment(this.roadsRendering, {
        x1: seg.x1,
        y1: seg.y1,
        x2: seg.x2,
        y2: seg.y2
      });
    }
  }

  /**
   * Check if a road tile exists at the given coordinates
   */
  private hasRoadAt(x: number, y: number): boolean {
    return this.roadTilesMap.has(`${x},${y}`);
  }

  /**
   * What the world says about one tile, in the terms the road price is made of
   * (`@/shared/road-cost`). The renderer is the only half that holds all three layers —
   * terrain, roads and concrete — so this is where the facts come from.
   *
   * `isVoid` stays false: the WebClient models no reserved-plot layer (`IsVoidSquare`,
   * `Voyager/Components/MapIsoView/Map.pas:2605`).
   */
  private getRoadTileFacts(x: number, y: number): RoadTileFacts {
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const onWater = terrainLoader ? decodeLandId(terrainLoader.getLandId(x, y)).isWater : false;
    return {
      hasRoad: this.hasRoadAt(x, y),
      isBridge: onWater && !this.hasConcrete(x, y),
      isVoid: false,
    };
  }

  /**
   * The per-tile facts for a whole drag, in path order — what the client attests to the
   * gateway so both halves price the same road (issue #99).
   */
  public getRoadPathFacts(x1: number, y1: number, x2: number, y2: number): RoadTileFacts[] {
    return roadPathTiles(x1, y1, x2, y2).map(t => this.getRoadTileFacts(t.x, t.y));
  }

  /**
   * E2E probe (read-only): sample of known road tile world coordinates.
   * Used by window.__spoDebug to let test drivers find existing roads.
   */
  public getRoadTiles(limit = 500): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    for (const key of this.roadTilesMap.keys()) {
      const [x, y] = key.split(',').map(Number);
      tiles.push({ x, y });
      if (tiles.length >= limit) break;
    }
    return tiles;
  }

  /**
   * E2E probe (read-only): terrain/occupancy facts for one tile so test
   * drivers can verify a tile is zonable/buildable BEFORE interacting.
   */
  public getTileProbe(x: number, y: number): {
    hasRoad: boolean;
    adjacentToRoad: boolean;
    hasConcrete: boolean;
    landClass: string;
    isWater: boolean;
  } {
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const landId = terrainLoader ? terrainLoader.getLandId(x, y) : 0;
    const decoded = decodeLandId(landId);
    return {
      hasRoad: this.hasRoadAt(x, y),
      adjacentToRoad: this.isAdjacentToRoad(x, y),
      hasConcrete: this.concreteTilesSet.has(`${x},${y}`),
      landClass: ['G', 'M', 'D', 'W'][decoded.landClass] ?? '?',
      isWater: decoded.isWater,
    };
  }

  /**
   * Bug-report probe (read-only): what sits under a screen point, in map terms.
   *
   * Half the screen is this renderer, and `document.elementFromPoint` returns only "canvas"
   * there — so a report anchored on the map needs the hit-test the gestures already use.
   * This composes the existing private `screenToMap` and `getBuildingAt` with the road and
   * concrete sets; it decides nothing new.
   *
   * Note the axis swap, which the tap handler does too: `screenToMap` yields row `i` and
   * column `j`, while buildings, roads and concrete are all keyed `x,y` = column,row.
   *
   * `buildingId` is left unset on purpose: `MapBuilding` (ObjectsInArea) carries no building
   * id — only its origin, owner and visual class. The tile plus the class identify it.
   */
  public getCanvasAnchorAt(clientX: number, clientY: number): {
    tileX: number;
    tileY: number;
    visualClass?: string;
    layer: 'building' | 'road' | 'concrete' | 'terrain';
  } {
    const { i: row, j: column } = this.screenToMap(clientX, clientY);
    const building = this.getBuildingAt(column, row);
    if (building) {
      return { tileX: column, tileY: row, visualClass: building.visualClass, layer: 'building' };
    }
    const key = `${column},${row}`;
    if (this.roadTilesMap.has(key)) return { tileX: column, tileY: row, layer: 'road' };
    if (this.concreteTilesSet.has(key)) return { tileX: column, tileY: row, layer: 'concrete' };
    return { tileX: column, tileY: row, layer: 'terrain' };
  }

  /**
   * Check if a tile is adjacent to an existing road (including diagonal adjacency)
   * Returns true if any of the 8 surrounding tiles has a road
   */
  private isAdjacentToRoad(x: number, y: number): boolean {
    const neighbors = [
      { x: x - 1, y: y },     // West
      { x: x + 1, y: y },     // East
      { x: x, y: y - 1 },     // North
      { x: x, y: y + 1 },     // South
      { x: x - 1, y: y - 1 }, // NW
      { x: x + 1, y: y - 1 }, // NE
      { x: x - 1, y: y + 1 }, // SW
      { x: x + 1, y: y + 1 }  // SE
    ];

    return neighbors.some(n => this.hasRoadAt(n.x, n.y));
  }

  /**
   * Check if a road path connects to existing roads
   * Returns true if:
   * - Any tile of the path is adjacent to an existing road, OR
   * - No roads exist yet (first road on map)
   */
  public checkRoadPathConnectsToExisting(pathTiles: Point[]): boolean {
    // If no roads exist, any road can be built (first road)
    if (this.roadTilesMap.size === 0) {
      return true;
    }

    // Check if any tile of the path connects to existing roads
    for (const tile of pathTiles) {
      // Check if this tile is adjacent to an existing road
      if (this.isAdjacentToRoad(tile.x, tile.y)) {
        return true;
      }
      // Also check if the tile itself overlaps with an existing road (extending from endpoint)
      if (this.hasRoadAt(tile.x, tile.y)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the number of existing road tiles (for checking if any roads exist)
   */
  public getRoadTileCount(): number {
    return this.roadTilesMap.size;
  }

  /**
   * Fetch facility dimensions for buildings and preload their textures
   */
  private async fetchDimensionsForBuildings(buildings: MapBuilding[]) {
    if (!this.onFetchFacilityDimensions) return;

    const uniqueClasses = new Set<string>();
    buildings.forEach(b => {
      if (!this.facilityDimensionsCache.has(b.visualClass)) {
        uniqueClasses.add(b.visualClass);
      }
    });

    for (const visualClass of uniqueClasses) {
      const dims = await this.onFetchFacilityDimensions(visualClass);
      if (dims) {
        this.facilityDimensionsCache.set(visualClass, dims);
      }
    }

    // Rebuild concrete set and invalidate occupation cache with accurate dimensions
    this.cachedOccupiedTiles = null;
    this.rebuildConcreteSet();

    // Preload building textures for all unique visual classes
    this.preloadBuildingTextures(buildings);

    this.requestRender();
  }

  /**
   * Rebuild the pre-computed concrete adjacency set from all buildings.
   * Called when building dimensions change (after fetching from server).
   */
  private rebuildConcreteSet(): void {
    this.concreteTilesSet.clear();
    this.debugConcreteSourceMap.clear();
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const bw = dims?.xsize || 1;
      const bh = dims?.ysize || 1;

      for (let y = building.y - 1; y < building.y + bh + 1; y++) {
        for (let x = building.x - 1; x < building.x + bw + 1; x++) {
          // Filter out water edge/corner tiles — only ldtCenter accepts concrete
          if (terrainLoader) {
            const landId = terrainLoader.getLandId(x, y);
            if (!canReceiveConcrete(landId)) continue;
          }
          const key = `${x},${y}`;
          this.concreteTilesSet.add(key);
          this.debugConcreteSourceMap.set(key, 'building');
        }
      }
    }
    // Also add concrete around water road junctions
    this.addWaterRoadJunctionConcrete(terrainLoader);
  }

  /**
   * Add concrete platforms around road junctions on water.
   *
   * Bridge textures only support straight segments (NS/WE roads and their start/end caps).
   * Corners, T-intersections, and crossroads CANNOT use bridge textures — they need
   * a concrete platform with regular urban road textures.
   *
   * For each junction tile on water, add a 3×3 concrete area:
   * - The junction tile itself
   * - All 8 neighbors (includes connected road tiles at +1 AND border tiles)
   * Roads at +2 and beyond remain bridges (outside the 3×3).
   */
  private addWaterRoadJunctionConcrete(terrainLoader: ReturnType<typeof this.terrainRenderer.getTerrainLoader>): void {
    if (!this.roadsRendering || !terrainLoader) return;

    for (const [key] of this.roadTilesMap) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);

      const topology = this.roadsRendering.get(y, x);
      if (topology === RoadBlockId.None) continue;
      if (!isJunctionTopology(topology)) continue;

      const landId = terrainLoader.getLandId(x, y);
      if (!isWater(landId)) continue;

      // Add 3×3 area around junction (junction + 8 neighbors)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const nLandId = terrainLoader.getLandId(nx, ny);
          if (canReceiveConcrete(nLandId)) {
            const nKey = `${nx},${ny}`;
            this.concreteTilesSet.add(nKey);
            // Only set source if not already set (building has priority)
            if (!this.debugConcreteSourceMap.has(nKey)) {
              this.debugConcreteSourceMap.set(nKey, 'junction');
            }
          }
        }
      }
    }
  }

  /**
   * Preload building textures for faster rendering
   */
  private preloadBuildingTextures(buildings: MapBuilding[]): void {
    const uniqueClasses = new Set<string>();
    buildings.forEach(b => uniqueClasses.add(b.visualClass));

    const textureFilenames = Array.from(uniqueClasses).map(
      visualClass => GameObjectTextureCache.getBuildingTextureFilename(visualClass)
    );

    this.gameObjectTextureCache.preload('BuildingImages', textureFilenames);
  }

  /**
   * Update map data with buildings and road segments for a zone
   */
  public updateMapData(mapData: { x: number; y: number; w: number; h: number; buildings: MapBuilding[]; segments: MapSegment[] }) {
    this.addCachedZone(mapData.x, mapData.y, mapData.w, mapData.h, mapData.buildings, mapData.segments);
  }

  /**
   * Invalidate a specific zone, forcing it to reload on next visibility check
   * Use this when the server notifies that a specific area has changed
   */
  public invalidateZone(x: number, y: number): void {
    const zoneSize = 64;
    const alignedX = Math.floor(x / zoneSize) * zoneSize;
    const alignedY = Math.floor(y / zoneSize) * zoneSize;
    const key = `${alignedX},${alignedY}`;

    const cached = this.cachedZones.get(key);
    if (cached) {
      cached.forceRefresh = true;
      console.log(`[IsometricMapRenderer] Zone ${key} marked for refresh`);
    }
  }

  /**
   * Invalidate all cached zones, forcing full reload
   * Use this when reconnecting or after major game state changes
   */
  public invalidateAllZones(): void {
    let count = 0;
    this.cachedZones.forEach(zone => {
      zone.forceRefresh = true;
      count++;
    });
    console.log(`[IsometricMapRenderer] Marked ${count} zones for refresh`);
  }

  /**
   * Invalidate zones within a rectangular area
   * Use this when the server notifies that a region has changed
   */
  public invalidateArea(x1: number, y1: number, x2: number, y2: number): void {
    const zoneSize = 64;
    const startX = Math.floor(Math.min(x1, x2) / zoneSize) * zoneSize;
    const endX = Math.ceil(Math.max(x1, x2) / zoneSize) * zoneSize;
    const startY = Math.floor(Math.min(y1, y2) / zoneSize) * zoneSize;
    const endY = Math.ceil(Math.max(y1, y2) / zoneSize) * zoneSize;

    let count = 0;
    for (let x = startX; x < endX; x += zoneSize) {
      for (let y = startY; y < endY; y += zoneSize) {
        const key = `${x},${y}`;
        const cached = this.cachedZones.get(key);
        if (cached) {
          cached.forceRefresh = true;
          count++;
        }
      }
    }
    console.log(`[IsometricMapRenderer] Marked ${count} zones in area for refresh`);
  }

  // =========================================================================
  // CALLBACKS
  // =========================================================================

  public setLoadZoneCallback(callback: (x: number, y: number, w: number, h: number) => void) {
    this.onLoadZone = callback;

    // Initialize zone request manager now that we have the callback
    this.zoneRequestManager = new ZoneRequestManager(callback, 64);
  }

  /**
   * Manually trigger zone checking (useful after callbacks are set up)
   */
  public triggerZoneCheck() {
    this.checkVisibleZones();
  }

  public setBuildingClickCallback(callback: (x: number, y: number, visualClass?: string) => void) {
    this.onBuildingClick = callback;
  }

  public setEmptyMapClickCallback(callback: () => void) {
    this.onEmptyMapClick = callback;
  }

  public setMapContextMenuCallback(callback: ((clientX: number, clientY: number, tileX: number, tileY: number) => void) | null) {
    this.onMapContextMenu = callback;
  }

  public setViewportChangedCallback(callback: () => void) {
    this.onViewportChanged = callback;
  }

  /** Convert world coordinates to screen pixel position. */
  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return this.terrainRenderer.mapToScreen(worldY, worldX);
  }

  /**
   * Convert a building footprint center to screen position, plus its texture height.
   * Used by StatusOverlay for centered positioning with dynamic vertical offset.
   */
  public worldToScreenCentered(
    worldX: number, worldY: number,
    xsize: number, ysize: number
  ): { x: number; y: number; textureHeight: number } {
    // Prefer the pixel-exact position recorded during drawBuildings().
    // This guarantees the overlay aligns with the actual drawn texture.
    if (this.selectedBuildingDrawnTop) {
      return this.selectedBuildingDrawnTop;
    }

    // Fallback: compute from south-corner anchor (same formula as drawBuildings).
    // Used on the first frame before the renderer has drawn the selected building.
    const rotation = this.terrainRenderer.getRotation();
    let anchorI: number, anchorJ: number;
    switch (rotation) {
      case Rotation.NORTH: anchorI = worldY;              anchorJ = worldX;              break;
      case Rotation.EAST:  anchorI = worldY + ysize - 1;  anchorJ = worldX;              break;
      case Rotation.SOUTH: anchorI = worldY + ysize - 1;  anchorJ = worldX + xsize - 1;  break;
      case Rotation.WEST:  anchorI = worldY;              anchorJ = worldX + xsize - 1;  break;
      default:             anchorI = worldY;              anchorJ = worldX;              break;
    }
    const southCornerScreenPos = this.terrainRenderer.mapToScreen(anchorI, anchorJ);

    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const scaleFactor = config.tileWidth / 64;
    let scaledHeight = 80 * scaleFactor; // fallback

    const building = this.getBuildingAt(worldX, worldY);
    if (building) {
      const textureFilename = GameObjectTextureCache.getBuildingTextureFilename(building.visualClass);
      const texture = this.gameObjectTextureCache.getTextureSync('BuildingImages', textureFilename);
      if (texture) {
        scaledHeight = texture.height * scaleFactor;
      }
    }

    let textureTopY = southCornerScreenPos.y + config.tileHeight - scaledHeight;

    if (this.isOnWaterPlatform(anchorJ, anchorI)) {
      textureTopY -= Math.round(PLATFORM_SHIFT * scaleFactor);
    }

    return { x: southCornerScreenPos.x, y: textureTopY, textureHeight: scaledHeight };
  }

  /** Mark a building as selected (focused) — shows gold pulsing footprint + entry burst ring. */
  public setSelectedBuilding(x: number, y: number): void {
    this.selectedBuilding = this.getBuildingAt(x, y);
    const now = performance.now();
    this.selectionPulseTime = now;
    this.selectionBurstStartTime = now;
    this.requestRender();
  }

  /** Clear building selection. */
  public clearSelectedBuilding(): void {
    this.selectedBuilding = null;
    this.selectedBuildingDrawnTop = null;
    this.requestRender();
  }

  public setCancelPlacementCallback(callback: () => void) {
    this.onCancelPlacement = callback;
  }

  public setPlacementConfirmCallback(callback: (x: number, y: number) => void) {
    this.onPlacementConfirm = callback;
  }

  public setPlacementValidityCallback(callback: (valid: boolean) => void) {
    this.onPlacementValidityChange = callback;
  }

  /** Confirm placement at the current preview position (used by mobile PlacementHUD). */
  public confirmCurrentPlacement(): void {
    if (this.placementMode && this.placementPreview && !this.placementInvalid && this.onPlacementConfirm) {
      const p = this.placementPreview;
      const { nwI, nwJ } = this.placementNWCorner(p.i, p.j, p.xsize, p.ysize);
      this.onPlacementConfirm(nwJ, nwI); // j=x (col), i=y (row)
    }
  }

  public setFetchFacilityDimensionsCallback(callback: (visualClass: string) => Promise<FacilityDimensions | null>) {
    this.onFetchFacilityDimensions = callback;
  }

  public setRoadSegmentCompleteCallback(callback: (x1: number, y1: number, x2: number, y2: number) => void) {
    this.onRoadSegmentComplete = callback;
  }

  public setCancelRoadDrawingCallback(callback: () => void) {
    this.onCancelRoadDrawing = callback;
  }

  public setRoadDemolishClickCallback(callback: ((x: number, y: number) => void) | null) {
    this.onRoadDemolishClick = callback;
    // Reset drag state when entering/exiting demolish mode
    this.roadDemolishDragState.isDrawing = false;
  }

  public setCancelRoadDemolishCallback(callback: (() => void) | null) {
    this.onCancelRoadDemolish = callback;
  }

  public setRoadDemolishAreaCompleteCallback(callback: ((x1: number, y1: number, x2: number, y2: number) => void) | null) {
    this.onRoadDemolishAreaComplete = callback;
  }

  // =========================================================================
  // CAMERA CONTROL
  // =========================================================================

  /**
   * Center camera on specific coordinates (in original map coordinates x, y)
   */
  public centerOn(x: number, y: number) {
    // Convert from original coordinate system (x, y) to isometric (i, j)
    // In the original system, x was column and y was row
    // In isometric, i is row and j is column
    this.terrainRenderer.centerOn(y, x);
    this.checkVisibleZones();
  }

  /**
   * Get current camera position
   */
  public getCameraPosition(): { x: number; y: number } {
    const pos = this.terrainRenderer.getCameraPosition();
    // Convert back: j = x (column), i = y (row)
    return { x: pos.j, y: pos.i };
  }

  /**
   * Set zoom level (0-3)
   */
  public setZoom(level: number) {
    const previousZoom = this.terrainRenderer.getZoomLevel();
    this.terrainRenderer.setZoomLevel(level);
    this.terrainRenderer.clearDistantZoomCaches(level);

    // Clear vehicles when zooming out of Z2/Z3 range
    if (previousZoom >= 2 && level < 2 && this.vehicleSystem) {
      this.vehicleSystem.clear();
      this.animationLoopRunning = false;
    }
    if (previousZoom >= 2 && level < 2) {
      this.aircraftSystem.clear();
    }
    // Start animation loop when zooming into Z2/Z3 range
    if (previousZoom < 2 && level >= 2) {
      this.startAnimationLoop();
    }

    this.checkVisibleZones();
    this.requestRender();
  }

  /**
   * Get current zoom level
   */
  public getZoom(): number {
    return this.terrainRenderer.getZoomLevel();
  }

  /**
   * Get all loaded buildings (for minimap rendering)
   */
  public getAllBuildings(): MapBuilding[] {
    return this.allBuildings;
  }

  /**
   * Get all loaded road segments (for minimap rendering)
   */
  public getAllSegments(): MapSegment[] {
    return this.allSegments;
  }

  /**
   * Get map dimensions in tiles (for minimap scaling)
   */
  public getMapDimensions(): { width: number; height: number } {
    return this.terrainRenderer.getTerrainLoader().getDimensions();
  }

  /**
   * Get current map rotation (for minimap orientation sync)
   */
  public getRotation(): number {
    return this.terrainRenderer.getRotation() as number;
  }

  /**
   * Get raw terrain pixel data for minimap background rendering.
   * Returns null if terrain data is not yet loaded.
   */
  public getTerrainPixelData(): { pixelData: Uint8Array; width: number; height: number } | null {
    const loader = this.terrainRenderer.getTerrainLoader();
    if (!loader.isLoaded()) return null;
    const dims = loader.getDimensions();
    if (dims.width === 0 || dims.height === 0) return null;
    return {
      pixelData: loader.getPixelData(),
      width: dims.width,
      height: dims.height,
    };
  }

  /**
   * Get visible tile bounds (for minimap viewport rectangle)
   */
  public getVisibleTileBounds(): TileBounds {
    const viewport: Rect = {
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height,
    };
    const origin = this.terrainRenderer.getOrigin();
    return this.terrainRenderer.getCoordinateMapper().getVisibleBounds(
      viewport,
      this.terrainRenderer.getZoomLevel(),
      this.terrainRenderer.getRotation(),
      origin
    );
  }

  /**
   * Get current map name (for minimap preview URL).
   */
  public getMapName(): string {
    return this.mapName;
  }

  /**
   * Get current season (for minimap preview URL).
   */
  public getSeason(): number {
    return this.terrainRenderer.getSeason();
  }

  /**
   * Get terrain type (from map INI, for minimap preview URL).
   */
  public getTerrainType(): string {
    return this.terrainRenderer.getTerrainType();
  }

  /**
   * Get atlas image + manifest for minimap color sampling.
   */
  public getAtlasData(): { atlas: ImageBitmap; manifest: import('./texture-atlas-cache').AtlasManifest } | null {
    const cache = this.terrainRenderer.getAtlasCache();
    if (!cache.isReady()) return null;
    const atlas = cache.getAtlas();
    const manifest = cache.getManifest();
    if (!atlas || !manifest) return null;
    return { atlas, manifest };
  }

  /**
   * Get the ChunkCache instance (for awaiting viewport readiness).
   */
  public getChunkCache(): import('./chunk-cache').ChunkCache | null {
    return this.terrainRenderer.getChunkCache();
  }

  /**
   * Get an array of chunk coordinates currently visible in the viewport.
   * Used to wait for all viewport chunks to be ready before dismissing the loading screen.
   */
  public getVisibleChunkCoords(zoomLevel: number): Array<{ i: number; j: number }> {
    const chunkCache = this.terrainRenderer.getChunkCache();
    if (!chunkCache) return [];

    const tileBounds = this.getVisibleTileBounds();
    const { minChunkI, maxChunkI, minChunkJ, maxChunkJ } = chunkCache.getVisibleChunksFromBounds(tileBounds);

    const coords: Array<{ i: number; j: number }> = [];
    for (let ci = minChunkI; ci <= maxChunkI; ci++) {
      for (let cj = minChunkJ; cj <= maxChunkJ; cj++) {
        coords.push({ i: ci, j: cj });
      }
    }
    return coords;
  }

  /**
   * Set terrain season from server WorldSeason property
   */
  public setSeason(season: Season): void {
    this.terrainRenderer.setSeason(season);
    this.requestRender();
  }

  // =========================================================================
  // ZONE OVERLAY
  // =========================================================================

  public setZoneOverlay(enabled: boolean, data?: SurfaceData, x1?: number, y1?: number, heatmap?: boolean, towns?: boolean) {
    this.zoneOverlayEnabled = enabled;
    if (heatmap !== undefined) this.overlayIsHeatmap = heatmap;
    if (towns !== undefined) this.overlayIsTowns = towns;
    if (!enabled) {
      this.cachedZoneSurfaces.clear();
      this.overlayIsHeatmap = false;
      this.overlayIsTowns = false;
    } else if (data && x1 !== undefined && y1 !== undefined) {
      const zoneSize = 64;
      const alignedX = Math.floor(x1 / zoneSize) * zoneSize;
      const alignedY = Math.floor(y1 / zoneSize) * zoneSize;
      const key = `${alignedX},${alignedY}`;
      this.cachedZoneSurfaces.set(key, {
        x: alignedX,
        y: alignedY,
        data,
        lastLoadTime: Date.now(),
      });
    }
    this.requestRender();
  }

  /**
   * Get keys of all currently loaded map zones (for populating zone overlay on enable)
   */
  public getLoadedZoneKeys(): string[] {
    return Array.from(this.cachedZones.keys());
  }

  // =========================================================================
  // PLACEMENT MODE
  // =========================================================================

  public setPlacementMode(
    enabled: boolean,
    buildingName: string = '',
    cost: number = 0,
    area: number = 0,
    zoneRequirement: string = '',
    xsize: number = 1,
    ysize: number = 1,
    visualClass: string = '',
    fallbackIconUrl: string = ''
  ) {
    this.placementMode = enabled;
    if (enabled && buildingName) {
      // On mobile (no mouse), initialize preview at screen center instead of (0,0)
      let initI = this.mouseMapI;
      let initJ = this.mouseMapJ;
      if (!this.mouseHasEnteredCanvas) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const raw = this.terrainRenderer.screenToMap(cx, cy);
        initI = Math.floor(raw.x);
        initJ = Math.floor(raw.y);
        // Allow preview to render on touch-only devices
        this.mouseHasEnteredCanvas = true;
      }
      this.placementPreview = {
        i: initI,
        j: initJ,
        buildingName,
        cost,
        area,
        zoneRequirement,
        xsize,
        ysize,
        visualClass,
        fallbackIconUrl: fallbackIconUrl || undefined
      };
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.placementPreview = null;
      this.canvas.style.cursor = 'grab';
    }
    this.requestRender();
  }

  public getPlacementCoordinates(): { x: number; y: number } | null {
    if (!this.placementPreview) return null;
    return { x: this.placementPreview.j, y: this.placementPreview.i };
  }

  // =========================================================================
  // CONNECT MODE (map-click to connect two buildings)
  // =========================================================================

  public setConnectMode(enabled: boolean): void {
    this.connectMode = enabled;
    this.canvas.style.cursor = enabled ? 'crosshair' : 'grab';
    this.requestRender();
  }

  public setConnectModeCallback(callback: ((x: number, y: number) => void) | null): void {
    this.onConnectModeClick = callback;
  }

  // =========================================================================
  // ROAD DRAWING MODE
  // =========================================================================

  public setRoadDrawingMode(enabled: boolean) {
    this.roadDrawingMode = enabled;
    this.roadDrawingState = {
      isDrawing: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      isMouseDown: false,
      mouseDownTime: 0
    };
    this.canvas.style.cursor = enabled ? 'crosshair' : 'grab';
    this.requestRender();
  }

  public isRoadDrawingModeActive(): boolean {
    return this.roadDrawingMode;
  }

  public setOnRoadSegmentComplete(callback: (x1: number, y1: number, x2: number, y2: number) => void) {
    this.onRoadSegmentComplete = callback;
  }

  public setOnRoadDrawingCancel(callback: () => void) {
    this.onCancelRoadDrawing = callback;
  }

  // =========================================================================
  // ZONE PAINTING MODE
  // =========================================================================

  public setZonePaintingMode(enabled: boolean, zoneType?: number) {
    this.zonePaintingMode = enabled;
    if (zoneType !== undefined) {
      this.zonePaintingType = zoneType;
    }
    this.zonePaintingState = { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 };
    this.canvas.style.cursor = enabled ? 'crosshair' : 'grab';
    this.requestRender();
  }

  public isZonePaintingModeActive(): boolean {
    return this.zonePaintingMode;
  }

  public setZoneAreaCompleteCallback(callback: ((x1: number, y1: number, x2: number, y2: number) => void) | null) {
    this.onZoneAreaComplete = callback;
  }

  public setCancelZonePaintingCallback(callback: (() => void) | null) {
    this.onCancelZonePainting = callback;
  }

  /**
   * Validate if a road can be built between two points
   * Returns an object with valid flag and optional error message
   */
  public validateRoadPath(x1: number, y1: number, x2: number, y2: number): { valid: boolean; error?: string } {
    // Generate the staircase path
    const pathTiles = this.generateStaircasePath(x1, y1, x2, y2);

    // Check for building collisions
    for (const tile of pathTiles) {
      for (const building of this.allBuildings) {
        const dims = this.facilityDimensionsCache.get(building.visualClass);
        const bw = dims?.xsize || 1;
        const bh = dims?.ysize || 1;

        if (tile.x >= building.x && tile.x < building.x + bw &&
            tile.y >= building.y && tile.y < building.y + bh) {
          return { valid: false, error: 'Road blocked by building' };
        }
      }
    }

    // Check if road connects to existing roads
    if (!this.checkRoadPathConnectsToExisting(pathTiles)) {
      return { valid: false, error: 'Road must connect to existing road network' };
    }

    return { valid: true };
  }

  // =========================================================================
  // GROUND LAYER CACHE
  // =========================================================================

  /**
   * Get zoom-dependent ground margin (pixels of overscan around viewport).
   * Larger margins = fewer rebuilds during pan, at the cost of more memory.
   */
  private getGroundMargin(): number {
    const zoom = this.terrainRenderer.getZoomLevel();
    // Z1: 16×8 tiles, need large margin to avoid frequent rebuilds
    // Z2: 32×16 tiles, moderate margin
    // Z3: 64×32 tiles, smaller margin (fewer tiles = less rebuild cost)
    if (zoom >= 3) return 512;
    if (zoom >= 2) return 768;
    return 1024; // Z1
  }

  /**
   * Mark the ground cache as needing rebuild on next render.
   */
  private invalidateGroundCache(): void {
    this.groundCacheValid = false;
  }

  /**
   * Create or resize the ground cache OffscreenCanvas to match viewport + margins.
   */
  private ensureGroundCanvas(): void {
    const margin = this.getGroundMargin();
    const w = this.canvas.width + 2 * margin;
    const h = this.canvas.height + 2 * margin;

    if (!this.groundCanvas || this.groundCanvas.width !== w || this.groundCanvas.height !== h) {
      this.groundCanvas = new OffscreenCanvas(w, h);
      this.groundCtx = this.groundCanvas.getContext('2d');
      this.groundCacheValid = false;
    }
  }

  /**
   * Check if the ground cache can be reused (same zoom/rotation, pan within margin).
   */
  private canReuseGroundCache(): boolean {
    if (!this.groundCacheValid || !this.groundCanvas) return false;

    const zoom = this.terrainRenderer.getZoomLevel();
    const rotation = this.terrainRenderer.getRotation();
    if (zoom !== this.groundCacheZoom || rotation !== this.groundCacheRotation) return false;

    const margin = this.getGroundMargin();
    const origin = this.terrainRenderer.getOrigin();
    const dx = Math.abs(origin.x - this.groundCacheOriginX);
    const dy = Math.abs(origin.y - this.groundCacheOriginY);

    return dx < margin && dy < margin;
  }

  /**
   * Get extended tile bounds that include the ground cache margin area.
   * Used during ground cache rebuild to render tiles beyond the viewport.
   */
  private getExtendedBounds(margin: number): TileBounds {
    const origin = this.terrainRenderer.getOrigin();
    const zoom = this.terrainRenderer.getZoomLevel();
    const rotation = this.terrainRenderer.getRotation();

    // Viewport extended by margin on all sides
    const extViewport: Rect = {
      x: -margin,
      y: -margin,
      width: this.canvas.width + 2 * margin,
      height: this.canvas.height + 2 * margin
    };

    return this.terrainRenderer.getCoordinateMapper().getVisibleBounds(
      extViewport, zoom, rotation, origin
    );
  }

  /**
   * Rebuild the ground cache: render terrain + vegetation + concrete + roads
   * to an OffscreenCanvas sized viewport + 2*margin.
   * Uses ctx-swap technique so draw methods render to the cache instead of main canvas.
   */
  private rebuildGroundCache(): void {
    this.ensureGroundCanvas();
    if (!this.groundCtx) return;

    const margin = this.getGroundMargin();
    const origin = this.terrainRenderer.getOrigin();
    const zoom = this.terrainRenderer.getZoomLevel();
    const rotation = this.terrainRenderer.getRotation();
    const chunkCache = this.terrainRenderer.getChunkCache();

    // Clear ground cache
    this.groundCtx.clearRect(0, 0, this.groundCanvas!.width, this.groundCanvas!.height);

    // === Render terrain to ground cache ===
    if (chunkCache && rotation === Rotation.NORTH) {
      // NORTH rotation: use pre-rendered chunks (fast path)
      const extBounds = this.getExtendedBounds(margin);
      const visibleChunks = chunkCache.getVisibleChunksFromBounds(extBounds);

      this.groundCtx.imageSmoothingEnabled = false;
      this.groundCtx.save();
      this.groundCtx.translate(margin, margin);

      for (let ci = visibleChunks.minChunkI; ci <= visibleChunks.maxChunkI; ci++) {
        for (let cj = visibleChunks.minChunkJ; cj <= visibleChunks.maxChunkJ; cj++) {
          // Draw only already-cached chunks (no async trigger — prevents eviction loops)
          chunkCache.drawChunkIfReady(
            this.groundCtx as unknown as CanvasRenderingContext2D,
            ci, cj, zoom, origin
          );
        }
      }

      this.groundCtx.restore();
    } else {
      // Non-NORTH rotations: render terrain tiles directly (chunks are NORTH-only)
      this.renderTerrainTilesToGroundCache(margin);
    }

    // === Ctx-swap: render vegetation, concrete, roads to ground cache ===
    const savedCtx = this.ctx;
    this.ctx = this.groundCtx as unknown as CanvasRenderingContext2D;
    this.ctx.save();
    this.ctx.translate(margin, margin);
    this.cullingPadding = margin;

    const extBounds = this.getExtendedBounds(margin);
    const occupiedTiles = this.buildTileOccupationMap();

    this.drawVegetation(extBounds);
    this.drawConcrete(extBounds);
    this.drawRoads(extBounds, occupiedTiles);

    this.ctx.restore();
    this.cullingPadding = 0;
    this.ctx = savedCtx;

    // Store cache state
    this.groundCacheValid = true;
    this.groundCacheZoom = zoom;
    this.groundCacheRotation = rotation;
    this.groundCacheOriginX = origin.x;
    this.groundCacheOriginY = origin.y;
  }

  /**
   * Render terrain tiles directly to the ground cache (for non-NORTH rotations).
   * Chunks are pre-rendered at NORTH positions, so at other rotations we fall back
   * to tile-by-tile rendering using the rotation-aware coordinate mapper.
   */
  private renderTerrainTilesToGroundCache(margin: number): void {
    if (!this.groundCtx) return;

    const FLAT_MASK = 0xC0;
    const extBounds = this.getExtendedBounds(margin);
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const textureCache = this.terrainRenderer.getTextureCache();
    const ctx = this.groundCtx as unknown as CanvasRenderingContext2D;

    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(margin, margin);

    const rotation = this.terrainRenderer.getRotation() as number;

    for (let i = extBounds.minI; i <= extBounds.maxI; i++) {
      for (let j = extBounds.minJ; j <= extBounds.maxJ; j++) {
        let textureId = terrainLoader.getTextureId(j, i);
        if (isSpecialTile(textureId)) {
          textureId = textureId & FLAT_MASK;
        }
        // Rotate directional border textures so edges align with the rotated view
        if (rotation !== 0) {
          textureId = rotateLandId(textureId, rotation);
        }

        const screenPos = this.terrainRenderer.mapToScreen(i, j);
        const sx = Math.round(screenPos.x);
        const sy = Math.round(screenPos.y);

        // Cull if off-screen (with ground cache padding)
        if (sx < -config.tileWidth - margin || sx > this.canvas.width + config.tileWidth + margin ||
            sy < -config.tileHeight - margin || sy > this.canvas.height + config.tileHeight + margin) {
          continue;
        }

        const texture = textureCache.getTextureSync(textureId);
        if (texture) {
          ctx.drawImage(texture, sx - halfWidth, sy, config.tileWidth, config.tileHeight);
        } else {
          // Diamond fallback color
          const color = textureCache.getFallbackColor(textureId);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + halfWidth, sy + config.tileHeight / 2);
          ctx.lineTo(sx, sy + config.tileHeight);
          ctx.lineTo(sx - halfWidth, sy + config.tileHeight / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  /**
   * Blit the ground cache to the main canvas at the current pan offset.
   * Fast path: one drawImage call instead of rendering thousands of tiles.
   */
  private blitGroundCache(): void {
    if (!this.groundCanvas || !this.groundCacheValid) return;

    const margin = this.getGroundMargin();
    const origin = this.terrainRenderer.getOrigin();

    // Pan offset since cache was built
    const dx = origin.x - this.groundCacheOriginX;
    const dy = origin.y - this.groundCacheOriginY;

    // Source rectangle: viewport-sized portion offset by margin + pan delta
    const srcX = margin + dx;
    const srcY = margin + dy;

    this.ctx.drawImage(
      this.groundCanvas,
      srcX, srcY, this.canvas.width, this.canvas.height,
      0, 0, this.canvas.width, this.canvas.height
    );
  }

  // =========================================================================
  // RENDERING
  // =========================================================================

  /**
   * Schedule a render on the next animation frame (debounced).
   * Multiple calls within the same frame are coalesced into one render.
   * Use this for event-driven updates (mouse move, texture loaded, chunk ready).
   */
  private requestRender(): void {
    if (this.pendingRender !== null) return;
    this.pendingRender = requestAnimationFrame(() => {
      this.pendingRender = null;
      this.render();
    });
  }

  /**
   * Main render loop
   */
  public render() {
    // Calculate deltaTime for animations
    const now = performance.now();
    const deltaTime = this.lastRenderTime > 0 ? (now - this.lastRenderTime) / 1000 : 0;
    this.lastRenderTime = now;

    const zoom = this.terrainRenderer.getZoomLevel();

    if (zoom >= 1) {
      // === Z1/Z2/Z3: Ground cache path ===
      // Bake terrain+vegetation+concrete+roads into OffscreenCanvas.
      // Pan within margin = fast blit. Pan beyond margin = rebuild.
      // Always call terrain renderer to trigger chunk loading + update origin
      this.terrainRenderer.render();

      const canReuse = this.canReuseGroundCache();
      if (canReuse) {
        this.ctx.fillStyle = '#0a0a0f';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.blitGroundCache();
      } else {
        this.rebuildGroundCache();
        this.ctx.fillStyle = '#0a0a0f';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.blitGroundCache();
      }
    } else {
      // === Z0: Direct rendering (no ground cache) ===
      // Terrain renderer handles its own clear + terrain chunks + preview backdrop
      // Skip vegetation (too small), concrete (early return), roads (8×4px invisible)
      this.terrainRenderer.render();
    }

    if (!this.mapLoaded) return;

    // === Dynamic layers (always drawn directly) ===
    const bounds = this.getVisibleBounds();
    const occupiedTiles = this.buildTileOccupationMap();

    this.hasAnimatedBuildings = false;
    this.drawBuildings(bounds);
    this.drawVehicles(bounds, deltaTime, occupiedTiles);
    this.drawZoneOverlay(bounds);
    this.drawAircraft(bounds, deltaTime);
    this.drawFog(bounds);
    this.drawPlacementPreview();
    this.drawRoadDrawingPreview();
    this.drawRoadDemolishPreview();
    this.drawZonePaintingPreview();

    // Draw debug overlay if enabled
    if (this.debugMode) {
      this.drawDebugOverlay(bounds);
    }

    // Game info overlay removed — stats available via debug mode (D key)

    // Keep rendering while any time-based animation is active.
    // Priority order: animated building textures (full fps) > active effects (full fps)
    //   > selection burst (full fps for 350ms) > placement breathing (throttled 20fps)
    //   > selection pulse (throttled to 15fps — slow sine wave)
    const burstActive = this.selectedBuilding !== null &&
      (performance.now() - this.selectionBurstStartTime) < 350;
    const hasActiveEffects = this.buildingEffects.size > 0;

    if (this.hasAnimatedBuildings || hasActiveEffects || burstActive) {
      this.requestRender();
    } else if (this.placementMode) {
      // Breathing animation only needs ~20fps — throttle to 50ms intervals
      const now = performance.now();
      const delay = 50 - (now - this.lastPlacementRenderTime);
      if (delay <= 0) {
        this.lastPlacementRenderTime = now;
        this.requestRender();
      } else {
        setTimeout(() => { this.lastPlacementRenderTime = performance.now(); this.requestRender(); }, delay);
      }
    } else if (this.selectedBuilding) {
      const now = performance.now();
      if (now - this.lastPulseRenderTime >= 66) {
        this.lastPulseRenderTime = now;
        this.requestRender();
      } else {
        // Schedule next pulse frame at the right time
        setTimeout(() => this.requestRender(), 66 - (now - this.lastPulseRenderTime));
      }
    }
  }

  /**
   * Get visible tile bounds
   */
  private getVisibleBounds(): TileBounds {
    const viewport: Rect = {
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height
    };

    // Get the actual origin from terrain renderer (camera position in screen coords)
    const origin = this.terrainRenderer.getOrigin();

    return this.terrainRenderer.getCoordinateMapper().getVisibleBounds(
      viewport,
      this.terrainRenderer.getZoomLevel(),
      this.terrainRenderer.getRotation(),
      origin
    );
  }

  /**
   * Build occupied tiles map (buildings have priority over roads).
   * Cached and reused across frame — invalidated when zones change.
   */
  private buildTileOccupationMap(): Set<string> {
    if (this.cachedOccupiedTiles) return this.cachedOccupiedTiles;

    const occupied = new Set<string>();

    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const xsize = dims?.xsize || 1;
      const ysize = dims?.ysize || 1;

      for (let dy = 0; dy < ysize; dy++) {
        for (let dx = 0; dx < xsize; dx++) {
          occupied.add(`${building.x + dx},${building.y + dy}`);
        }
      }
    }

    this.cachedOccupiedTiles = occupied;
    return occupied;
  }

  /**
   * Check if a tile has concrete (building adjacency approach)
   * Uses pre-computed Set for O(1) lookup instead of scanning all buildings
   */
  private hasConcrete(x: number, y: number): boolean {
    return this.concreteTilesSet.has(`${x},${y}`);
  }

  /**
   * Check if a tile is on a water platform (has concrete AND is on water).
   * Used for applying platform Y-shift to concrete, roads, and buildings.
   */
  private isOnWaterPlatform(x: number, y: number): boolean {
    if (!this.hasConcrete(x, y)) return false;
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    if (!terrainLoader) return false;
    return isWater(terrainLoader.getLandId(x, y));
  }

  /**
   * Check if a building occupies a specific tile.
   * Uses pre-computed occupation map for O(1) lookup.
   */
  private isTileOccupiedByBuilding(x: number, y: number): boolean {
    return this.buildTileOccupationMap().has(`${x},${y}`);
  }

  /**
   * Get building at a specific tile position
   * Returns the building object if found, undefined otherwise
   */
  private getBuildingAtTile(x: number, y: number): MapBuilding | undefined {
    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const bw = dims?.xsize || 1;
      const bh = dims?.ysize || 1;

      if (x >= building.x && x < building.x + bw &&
          y >= building.y && y < building.y + bh) {
        return building;
      }
    }
    return undefined;
  }

  /**
   * Draw concrete tiles around buildings
   * Concrete appears on tiles adjacent to buildings to create paved areas
   */
  private drawConcrete(bounds: TileBounds): void {
    if (!this.concreteBlockClassesLoaded) return;
    // Skip concrete at far zoom levels — tiles are too small (8×4 or 16×8 px) to see concrete detail
    if (this.terrainRenderer.getZoomLevel() <= 1) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const terrainLoader = this.terrainRenderer.getTerrainLoader();

    // Create map data adapter for concrete calculations
    const mapData: ConcreteMapData = {
      getLandId: (row, col) => {
        if (!terrainLoader) return 0;
        return terrainLoader.getLandId(col, row);
      },
      hasConcrete: (row, col) => this.hasConcrete(col, row),
      hasRoad: (row, col) => this.roadTilesMap.has(`${col},${row}`),
      hasBuilding: (row, col) => this.isTileOccupiedByBuilding(col, row)
    };

    // Collect concrete tiles for painter's algorithm sorting
    const concreteTiles: Array<{
      i: number;
      j: number;
      concreteId: number;
      screenX: number;
      screenY: number;
    }> = [];

    // Iterate visible tiles and collect concrete tiles
    for (let i = bounds.minI; i <= bounds.maxI; i++) {
      for (let j = bounds.minJ; j <= bounds.maxJ; j++) {
        // Skip tiles without concrete
        if (!mapData.hasConcrete(i, j)) continue;

        // Calculate concrete ID with rotation-aware neighbor config
        const concreteRotation = this.terrainRenderer.getRotation() as number;
        const concreteId = getConcreteId(i, j, mapData, concreteRotation);
        if (concreteId === CONCRETE_NONE) continue;

        // Get screen position
        const screenPos = this.terrainRenderer.mapToScreen(i, j);
        concreteTiles.push({
          i,
          j,
          concreteId,
          screenX: screenPos.x,
          screenY: screenPos.y
        });
      }
    }

    // Painter's algorithm: lower screen Y (farther from viewer) drawn first.
    // Using screenY instead of (i+j) makes sorting correct at all rotations.
    concreteTiles.sort((a, b) => a.screenY - b.screenY);

    const scaleFactor = config.tileWidth / 64;

    // Debug: collect texture bounding boxes for overlay
    const debugBoxes: Array<{
      drawX: number; drawY: number; w: number; h: number;
      screenX: number; screenY: number;
      concreteId: number; texW: number; texH: number;
      isPlatform: boolean;
    }> = [];
    const collectDebug = this.debugMode && this.debugShowWaterGrid;

    // Draw sorted concrete tiles
    for (const tile of concreteTiles) {
      const isWaterPlatform = (tile.concreteId & 0x80) !== 0;

      // Get texture filename from class manager
      const filename = this.concreteBlockClassManager.getImageFilename(tile.concreteId);
      if (filename) {
        // Resolve texture dimensions from atlas or individual texture
        let texW = 0, texH = 0;
        const atlasRect = this.gameObjectTextureCache.getAtlasRect('ConcreteImages', filename);
        if (atlasRect) {
          texW = atlasRect.sw;
          texH = atlasRect.sh;
        } else {
          const texture = this.gameObjectTextureCache.getTextureSync('ConcreteImages', filename);
          if (texture) {
            texW = texture.width;
            texH = texture.height;
          }
        }

        if (texW > 0) {
          // Scale to current zoom and center horizontally on tile top vertex
          const scaledWidth = Math.round(texW * scaleFactor);
          const scaledHeight = Math.round(texH * scaleFactor);
          const drawX = tile.screenX - scaledWidth / 2;

          // Position texture so its isometric diamond aligns with the tile.
          // Standard 32px textures: diamond at row 0 → drawY = screenY (no offset).
          // Platform 80px textures: diamond top vertex at row 30 (constant across
          // all platform textures — verified from platC/N/S/E/W/NE/NW/SE/SW BMPs).
          // Edge textures (N/E/W) have wall content starting at row 24 that extends
          // above the diamond; foundation extends below from row 62.
          const PLATFORM_DIAMOND_TOP = 30;
          const yOffset = isWaterPlatform && scaledHeight > config.tileHeight
            ? Math.round(PLATFORM_DIAMOND_TOP * scaleFactor)
            : (scaledHeight - config.tileHeight);
          const drawY = tile.screenY - yOffset;

          if (atlasRect) {
            ctx.drawImage(
              atlasRect.atlas,
              atlasRect.sx, atlasRect.sy, atlasRect.sw, atlasRect.sh,
              drawX, drawY,
              scaledWidth, scaledHeight
            );
          } else {
            const texture = this.gameObjectTextureCache.getTextureSync('ConcreteImages', filename)!;
            ctx.drawImage(texture, drawX, drawY, scaledWidth, scaledHeight);
          }

          if (collectDebug) {
            debugBoxes.push({ drawX, drawY, w: scaledWidth, h: scaledHeight,
              screenX: tile.screenX, screenY: tile.screenY,
              concreteId: tile.concreteId, texW, texH,
              isPlatform: isWaterPlatform });
          }
          continue;
        }
      }

      // Fallback: draw debug colored tile if texture not available
      this.drawDebugConcreteTile(ctx, tile.screenX, tile.screenY, tile.concreteId, config);
    }

    // Debug overlay: draw texture bounding boxes on top of concrete
    if (collectDebug && debugBoxes.length > 0) {
      ctx.save();
      ctx.lineWidth = 1;
      const zoomLevel = this.terrainRenderer.getZoomLevel();
      const showLabels = zoomLevel >= 2;

      for (const box of debugBoxes) {
        // Bounding box outline: magenta for platform, cyan for land
        ctx.strokeStyle = box.isPlatform ? '#ff00ff' : '#00ffff';
        ctx.strokeRect(box.drawX, box.drawY, box.w, box.h);

        // Crosshair at tile screen center (where mapToScreen points)
        ctx.strokeStyle = '#ff0000';
        ctx.beginPath();
        ctx.moveTo(box.screenX - 3, box.screenY);
        ctx.lineTo(box.screenX + 3, box.screenY);
        ctx.moveTo(box.screenX, box.screenY - 3);
        ctx.lineTo(box.screenX, box.screenY + 3);
        ctx.stroke();

        // Label: concrete ID + original texture dims
        if (showLabels) {
          const label = `$${box.concreteId.toString(16).toUpperCase()} ${box.texW}x${box.texH}`;
          ctx.font = '9px monospace';
          ctx.fillStyle = box.isPlatform ? '#ff00ff' : '#00ffff';
          ctx.fillText(label, box.drawX + 1, box.drawY + 9);
        }
      }
      ctx.restore();
    }
  }

  /**
   * Draw a debug colored tile for concrete (when texture not available)
   */
  private drawDebugConcreteTile(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    concreteId: number,
    config: ZoomConfig
  ): void {
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;

    // Choose color based on concrete type
    let color: string;
    if ((concreteId & 0x80) !== 0) {
      // Water platform - blue-gray
      color = 'rgba(100, 120, 140, 0.7)';
    } else if ((concreteId & 0x10) !== 0) {
      // Road concrete - dark gray
      color = 'rgba(80, 80, 80, 0.7)';
    } else if (concreteId === 15) {
      // Special decorative - light pattern
      color = 'rgba(160, 160, 160, 0.7)';
    } else if (concreteId === 12) {
      // Full concrete - medium gray
      color = 'rgba(140, 140, 140, 0.7)';
    } else {
      // Edge/corner concrete - slightly lighter
      color = 'rgba(130, 130, 130, 0.7)';
    }

    // Draw isometric diamond
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + halfWidth, sy + halfHeight);
    ctx.lineTo(sx, sy + config.tileHeight);
    ctx.lineTo(sx - halfWidth, sy + halfHeight);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * Draw road segments as isometric tiles with textures
   * Uses the road texture system to determine correct textures based on topology
   *
   * Two-pass rendering (same as terrain special textures):
   * - Pass 1: Standard road tiles (texture height <= 32)
   * - Pass 2: Tall road tiles (bridges) sorted by (i+j) ascending for painter's algorithm
   */
  private drawRoads(bounds: TileBounds, occupiedTiles: Set<string>) {
    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const terrainLoader = this.terrainRenderer.getTerrainLoader();

    // Standard tile height at base resolution (64×32)
    const BASE_TILE_HEIGHT = 32;

    // Platform elevation for roads on water platforms
    const scaleFactor = config.tileWidth / 64;
    const platformYShift = Math.round(PLATFORM_SHIFT * scaleFactor);

    // Collect all road tiles into a single array for unified painter's algorithm sorting.
    // Bridges and standard tiles are interleaved so bridges don't render on top of closer roads.
    const allRoadTiles: Array<{
      x: number;
      y: number;
      sx: number;
      sy: number;
      topology: RoadBlockId;
      texture: ImageBitmap | null;
      atlasRect: { atlas: ImageBitmap; sx: number; sy: number; sw: number; sh: number } | null;
      onWaterPlatform: boolean;
      isTall: boolean;
      textureHeight: number;
      roadBlockId: number;
    }> = [];

    for (const [key] of this.roadTilesMap) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);

      // Skip if occupied by building
      if (occupiedTiles.has(key)) continue;

      // Viewport culling
      if (x < bounds.minJ || x > bounds.maxJ || y < bounds.minI || y > bounds.maxI) {
        continue;
      }

      // Convert to isometric coordinates (x = j, y = i)
      const screenPos = this.terrainRenderer.mapToScreen(y, x);

      // Cull if off-screen (extra margin for tall textures + ground cache padding)
      if (screenPos.x < -config.tileWidth - this.cullingPadding ||
          screenPos.x > this.canvas.width + config.tileWidth + this.cullingPadding ||
          screenPos.y < -config.tileHeight * 2 - this.cullingPadding ||
          screenPos.y > this.canvas.height + config.tileHeight * 2 + this.cullingPadding) {
        continue;
      }

      // Round coordinates for pixel-perfect rendering
      const sx = Math.round(screenPos.x);
      const sy = Math.round(screenPos.y);

      let topology = RoadBlockId.None;
      let texture: ImageBitmap | null = null;
      let atlasRect: { atlas: ImageBitmap; sx: number; sy: number; sw: number; sh: number } | null = null;
      let textureHeight = 0;
      let fullRoadBlockId = 0;

      if (this.roadBlockClassesLoaded && this.roadsRendering) {
        topology = this.roadsRendering.get(y, x);

        if (topology !== RoadBlockId.None) {
          const landId = terrainLoader.getLandId(x, y);
          const onConcrete = this.hasConcrete(x, y);

          // Check for smooth corner: angles use smooth textures,
          // diagonals (adjacent opposite corners) keep regular "oblique" textures
          const smoothResult = detectSmoothCorner(
            y, x, this.roadsRendering,
            (_r, c) => this.hasConcrete(c, _r)
          );

          fullRoadBlockId = smoothResult.isSmooth
            ? smoothResult.roadBlock
            : roadBlockId(topology, landId, onConcrete, false, false);

          // Rotate road texture to match current view rotation.
          // rotateRoadBlockId uses road-texture-system's Rotation enum (same numeric values)
          const viewRotation = this.terrainRenderer.getRotation() as number;
          if (viewRotation !== 0) {
            fullRoadBlockId = rotateRoadBlockId(fullRoadBlockId, viewRotation);
          }

          const texturePath = this.roadBlockClassManager.getImagePath(fullRoadBlockId);
          if (texturePath) {
            const filename = texturePath.split('/').pop() || '';

            // Try atlas first
            const rect = this.gameObjectTextureCache.getAtlasRect('RoadBlockImages', filename);
            if (rect) {
              atlasRect = rect;
              textureHeight = rect.sh;
            } else {
              // Fallback: individual texture
              texture = this.gameObjectTextureCache.getTextureSync('RoadBlockImages', filename);
              if (texture) textureHeight = texture.height;
            }
          }
        }
      }

      // Check if this road is on a water platform (concrete + water = elevated urban road)
      const onWaterPlatform = this.isOnWaterPlatform(x, y);
      const isTall = (texture !== null || atlasRect !== null) && textureHeight > BASE_TILE_HEIGHT;

      allRoadTiles.push({
        x, y, sx, sy, topology, texture, atlasRect,
        onWaterPlatform, isTall, textureHeight,
        roadBlockId: fullRoadBlockId
      });
    }

    // Unified painter's algorithm: sort by screen Y ascending (rotation-aware back-to-front)
    allRoadTiles.sort((a, b) => a.sy - b.sy);

    const scale = config.tileWidth / 64;

    // Single pass: render each tile according to its type, in painter's order.
    // Bridge base + cover textures are drawn together so they respect depth ordering
    // relative to standard road tiles.
    for (const tile of allRoadTiles) {
      if (tile.isTall) {
        // Tall tile (bridge): draw base texture bottom-aligned
        const scaledHeight = tile.textureHeight * scale;
        const yOffset = scaledHeight - config.tileHeight;

        if (tile.atlasRect) {
          const r = tile.atlasRect;
          ctx.drawImage(r.atlas, r.sx, r.sy, r.sw, r.sh, tile.sx - halfWidth, tile.sy - yOffset, config.tileWidth, scaledHeight);
        } else if (tile.texture) {
          ctx.drawImage(tile.texture, tile.sx - halfWidth, tile.sy - yOffset, config.tileWidth, scaledHeight);
        }

        // Draw bridge cover/railing texture immediately on top of base
        if (isBridge(tile.roadBlockId)) {
          const railingPath = this.roadBlockClassManager.getRailingImagePath(tile.roadBlockId);
          if (railingPath) {
            const railingFilename = railingPath.split('/').pop() || '';
            const railingRect = this.gameObjectTextureCache.getAtlasRect('RoadBlockImages', railingFilename);

            if (railingRect) {
              const rScaledHeight = railingRect.sh * scale;
              const rYOffset = rScaledHeight - config.tileHeight;
              ctx.drawImage(
                railingRect.atlas,
                railingRect.sx, railingRect.sy, railingRect.sw, railingRect.sh,
                tile.sx - halfWidth, tile.sy - rYOffset,
                config.tileWidth, rScaledHeight
              );
            } else {
              const railingTex = this.gameObjectTextureCache.getTextureSync('RoadBlockImages', railingFilename);
              if (railingTex) {
                const rScaledHeight = railingTex.height * scale;
                const rYOffset = rScaledHeight - config.tileHeight;
                ctx.drawImage(railingTex, tile.sx - halfWidth, tile.sy - rYOffset, config.tileWidth, rScaledHeight);
              }
            }
          }
        }
      } else {
        // Standard tile: draw at tile size, elevated if on water platform
        const drawSy = tile.onWaterPlatform ? tile.sy - platformYShift : tile.sy;
        if (tile.atlasRect) {
          const r = tile.atlasRect;
          ctx.drawImage(r.atlas, r.sx, r.sy, r.sw, r.sh, tile.sx - halfWidth, drawSy, config.tileWidth, config.tileHeight);
        } else if (tile.texture) {
          ctx.drawImage(tile.texture, tile.sx - halfWidth, drawSy, config.tileWidth, config.tileHeight);
        } else {
          // Fallback: draw colored diamond
          ctx.beginPath();
          ctx.moveTo(tile.sx, drawSy);
          ctx.lineTo(tile.sx - halfWidth, drawSy + halfHeight);
          ctx.lineTo(tile.sx, drawSy + config.tileHeight);
          ctx.lineTo(tile.sx + halfWidth, drawSy + halfHeight);
          ctx.closePath();
          ctx.fillStyle = this.getDebugColorForTopology(tile.topology);
          ctx.fill();
        }
      }
    }
  }

  /**
   * Draw vegetation overlay (special terrain tiles: trees, decorations)
   * Rendered on top of flat terrain base, below concrete/roads/buildings.
   * Vegetation within 2 tiles of buildings/roads is automatically hidden.
   * Can be disabled during camera movement for performance.
   * Uses painter's algorithm: lower tiles (closer to viewer) drawn last.
   */
  private drawVegetation(bounds: TileBounds): void {
    // Skip if vegetation is globally disabled
    if (!this.vegetationEnabled) return;
    // Skip entirely at the farthest zoom level — vegetation is too small to see
    const currentZoom = this.terrainRenderer.getZoomLevel();
    if (currentZoom === 0) return;
    // At z1, auto-enable hide-on-move behavior for performance.
    // At z3 (closest zoom), always show vegetation — detail is important at this level.
    if (currentZoom !== 3 && (this.isVegetationHiddenOnMove || currentZoom === 1) && this.isCameraMoving) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const textureCache = this.terrainRenderer.getTextureCache();
    const atlasCache = this.terrainRenderer.getAtlasCache();
    const useAtlas = atlasCache.isReady();

    const BASE_TILE_HEIGHT = 32;

    // Collect vegetation tiles
    const vegTiles: Array<{
      i: number;
      j: number;
      sx: number;
      sy: number;
      textureId: number;
    }> = [];

    // Extend bounds by 2 tiles to catch tall textures that visually overlap into the viewport
    for (let i = bounds.minI - 2; i <= bounds.maxI + 2; i++) {
      for (let j = bounds.minJ - 2; j <= bounds.maxJ + 2; j++) {
        const textureId = terrainLoader.getTextureId(j, i);

        // Only render special tiles (vegetation/decorations)
        if (!isSpecialTile(textureId)) continue;

        // Skip tiles near buildings/roads (flattened in base terrain)
        if (this.vegetationMapper.shouldFlatten(i, j, textureId)) continue;

        const screenPos = this.terrainRenderer.mapToScreen(i, j);

        // Frustum cull with extra margin for tall textures + ground cache padding
        if (screenPos.x < -config.tileWidth * 2 - this.cullingPadding ||
            screenPos.x > this.canvas.width + config.tileWidth * 2 + this.cullingPadding ||
            screenPos.y < -config.tileHeight * 4 - this.cullingPadding ||
            screenPos.y > this.canvas.height + config.tileHeight * 2 + this.cullingPadding) {
          continue;
        }

        vegTiles.push({
          i, j,
          sx: Math.round(screenPos.x),
          sy: Math.round(screenPos.y),
          textureId,
        });
      }
    }

    // Sort by screen Y ascending for painter's algorithm (rotation-aware back-to-front)
    vegTiles.sort((a, b) => a.sy - b.sy);

    // Draw vegetation tiles
    if (useAtlas) {
      const atlasImg = atlasCache.getAtlas()!;

      for (const tile of vegTiles) {
        const rect = atlasCache.getTileRect(tile.textureId);
        if (!rect) continue;

        if (rect.sh > BASE_TILE_HEIGHT) {
          // Tall texture: draw at full height with upward offset
          const scale = config.tileWidth / 64;
          const scaledHeight = rect.sh * scale;
          const yOffset = scaledHeight - config.tileHeight;

          ctx.drawImage(
            atlasImg,
            rect.sx, rect.sy, rect.sw, rect.sh,
            tile.sx - halfWidth, tile.sy - yOffset,
            config.tileWidth, scaledHeight
          );
        } else {
          // Standard height special texture
          ctx.drawImage(
            atlasImg,
            rect.sx, rect.sy, rect.sw, rect.sh,
            tile.sx - halfWidth, tile.sy,
            config.tileWidth, config.tileHeight
          );
        }
      }
    } else {
      // Fallback: individual textures
      for (const tile of vegTiles) {
        const texture = textureCache.getTextureSync(tile.textureId);
        if (!texture) continue;

        if (texture.height > BASE_TILE_HEIGHT) {
          const scale = config.tileWidth / 64;
          const scaledHeight = texture.height * scale;
          const yOffset = scaledHeight - config.tileHeight;

          ctx.drawImage(
            texture,
            tile.sx - halfWidth, tile.sy - yOffset,
            config.tileWidth, scaledHeight
          );
        } else {
          ctx.drawImage(
            texture,
            tile.sx - halfWidth, tile.sy,
            config.tileWidth, config.tileHeight
          );
        }
      }
    }
  }

  /**
   * Check if a tile is on concrete (urban area)
   * Simple heuristic: check if adjacent to an urban building
   */
  private isOnConcrete(x: number, y: number): boolean {
    const checkRadius = 2;

    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const xsize = dims?.xsize || 1;
      const ysize = dims?.ysize || 1;

      // Check if road tile is within radius of building
      const nearX = x >= building.x - checkRadius && x < building.x + xsize + checkRadius;
      const nearY = y >= building.y - checkRadius && y < building.y + ysize + checkRadius;

      if (nearX && nearY) {
        // Check if building is urban (simplified check)
        const name = dims?.name?.toLowerCase() || '';
        if (this.isUrbanBuilding(name)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a building name suggests it's an urban building
   */
  private isUrbanBuilding(name: string): boolean {
    const urbanKeywords = [
      'office', 'store', 'shop', 'mall', 'bank', 'hotel',
      'hospital', 'clinic', 'school', 'university',
      'restaurant', 'bar', 'club', 'theater', 'cinema',
      'apartment', 'condo', 'tower', 'headquarters'
    ];

    return urbanKeywords.some(keyword => name.includes(keyword));
  }

  /**
   * Get debug color for road topology (used when texture not available)
   */
  private getDebugColorForTopology(topology: RoadBlockId): string {
    switch (topology) {
      case RoadBlockId.NSRoad:
      case RoadBlockId.NSRoadStart:
      case RoadBlockId.NSRoadEnd:
        return '#777'; // Vertical roads - lighter gray

      case RoadBlockId.WERoad:
      case RoadBlockId.WERoadStart:
      case RoadBlockId.WERoadEnd:
        return '#555'; // Horizontal roads - darker gray

      case RoadBlockId.CornerN:
      case RoadBlockId.CornerE:
      case RoadBlockId.CornerS:
      case RoadBlockId.CornerW:
        return '#886'; // Corners - brownish

      case RoadBlockId.LeftPlug:
      case RoadBlockId.RightPlug:
      case RoadBlockId.TopPlug:
      case RoadBlockId.BottomPlug:
        return '#868'; // T-junctions - purplish

      case RoadBlockId.CrossRoads:
        return '#688'; // Crossroads - teal

      default:
        return '#666'; // Default gray
    }
  }

  /**
   * The sprite with its own pixels shaded red — legacy loReddened (Map.pas:1323-1324 →
   * Lander.pas:294-295). Composed on a scratch canvas: 'source-atop' keeps the fill inside
   * the sprite's alpha, so the terrain under the bounding box is untouched. Returns the
   * untinted texture if no 2D context can be had.
   */
  private reddenTexture(texture: ImageBitmap): CanvasImageSource {
    if (!this.losingScratch) this.losingScratch = document.createElement('canvas');
    const scratch = this.losingScratch;
    const sctx = scratch.getContext('2d');
    if (!sctx) return texture;
    if (scratch.width !== texture.width || scratch.height !== texture.height) {
      scratch.width = texture.width;
      scratch.height = texture.height;
    }
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(texture, 0, 0);
    sctx.globalCompositeOperation = 'source-atop';
    sctx.fillStyle = LOSING_TINT;
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = 'source-over';
    return scratch;
  }

  /**
   * Draw buildings as isometric tiles with textures
   * Uses Painter's algorithm: sort by depth (y + x) so buildings closer to viewer are drawn last
   */
  /** A building is hidden only when its class resolves to a POSITIVE FacId the player hid.
   *  An unresolved class (dims undefined) or FacId 0 is never hidden — FID_None is not a kind. */
  private isFacilityKindHidden(visualClass: string): boolean {
    if (this.hiddenFacIds.size === 0) return false;
    const facId = this.facilityDimensionsCache.get(visualClass)?.facId;
    return typeof facId === 'number' && facId > 0 && this.hiddenFacIds.has(facId);
  }

  private drawBuildings(bounds: TileBounds) {
    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;

    // Pre-filter buildings by visible bounds (with margin for multi-tile buildings)
    const margin = 10; // Generous margin for large buildings
    const visibleBuildings = this.allBuildings.filter(b => {
      if (this.isFacilityKindHidden(b.visualClass)) return false;
      const dims = this.facilityDimensionsCache.get(b.visualClass);
      const bw = dims?.xsize || 1;
      const bh = dims?.ysize || 1;
      return b.x + bw > bounds.minJ - margin && b.x < bounds.maxJ + margin &&
             b.y + bh > bounds.minI - margin && b.y < bounds.maxI + margin;
    });

    // Painter's algorithm: sort by screen Y ascending (rotation-aware).
    // Lower screen Y = farther from viewer = draw FIRST (behind).
    const sortedBuildings = visibleBuildings.sort((a, b) => {
      const aScreen = this.terrainRenderer.mapToScreen(a.y, a.x);
      const bScreen = this.terrainRenderer.mapToScreen(b.y, b.x);
      return aScreen.y - bScreen.y;
    });

    sortedBuildings.forEach(building => {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const xsize = dims?.xsize || 1;
      const ysize = dims?.ysize || 1;

      const isHovered = this.hoveredBuilding === building;

      // Try to get building texture
      const textureFilename = GameObjectTextureCache.getBuildingTextureFilename(building.visualClass);
      let texture = this.gameObjectTextureCache.getTextureSync('BuildingImages', textureFilename);

      // Check for animated texture and pick current frame
      const animatedTexture = this.gameObjectTextureCache.getAnimatedTexture('BuildingImages', textureFilename);
      if (animatedTexture && texture) {
        texture = this.gameObjectTextureCache.getAnimatedFrame(animatedTexture, performance.now());
        this.hasAnimatedBuildings = true;
      }

      if (texture) {
        // Calculate zoom scale factor
        // Building textures are designed for 64x32 tile size (zoom level 3)
        // Scale proportionally to current zoom level
        const scaleFactor = config.tileWidth / 64;
        const scaledWidth = texture.width * scaleFactor;
        const scaledHeight = texture.height * scaleFactor;

        // Calculate the anchor point: the SOUTH corner of the building footprint.
        // The south corner (closest to viewer, highest screen Y) changes with rotation:
        //   NORTH: (y, x)  EAST: (y+h-1, x)  SOUTH: (y+h-1, x+w-1)  WEST: (y, x+w-1)
        const rotation = this.terrainRenderer.getRotation();
        let anchorI: number, anchorJ: number;
        switch (rotation) {
          case Rotation.NORTH: anchorI = building.y;              anchorJ = building.x;              break;
          case Rotation.EAST:  anchorI = building.y + ysize - 1;  anchorJ = building.x;              break;
          case Rotation.SOUTH: anchorI = building.y + ysize - 1;  anchorJ = building.x + xsize - 1;  break;
          case Rotation.WEST:  anchorI = building.y;              anchorJ = building.x + xsize - 1;  break;
          default:             anchorI = building.y;              anchorJ = building.x;              break;
        }
        const southCornerScreenPos = this.terrainRenderer.mapToScreen(anchorI, anchorJ);

        // The texture bottom-center should align with the south vertex of the south corner tile
        // South vertex is at screenPos.y + tileHeight
        const drawX = Math.round(southCornerScreenPos.x - scaledWidth / 2);
        let drawY = Math.round(southCornerScreenPos.y + config.tileHeight - scaledHeight);

        // Buildings on water platforms are elevated to match the platform
        if (this.isOnWaterPlatform(anchorJ, anchorI)) {
          const platformYShift = Math.round(PLATFORM_SHIFT * scaleFactor);
          drawY -= platformYShift;
        }

        // Cull if completely off-screen
        if (drawX + scaledWidth < 0 ||
            drawX > this.canvas.width ||
            drawY + scaledHeight < 0 ||
            drawY > this.canvas.height) {
          return;
        }

        // Upgrade flash + scale pop: briefly scale the sprite up then back on visualClass change
        const effectKey = `${building.x},${building.y}`;
        const effect = this.buildingEffects.get(effectKey);
        const isUpgrading = effect?.type === 'upgrade';

        const glassed = this.glassForeignBuildings && this.ownTycoonId !== 0 && building.tycoonId !== this.ownTycoonId;
        ctx.globalAlpha = glassed ? FOREIGN_BUILDING_ALPHA : 1;
        // Legacy Map.pas:1323-1324 — only MY alerting buildings, only when the option is on.
        const reddened = this.signalLosingFacilities && building.alert && this.ownTycoonId !== 0 && building.tycoonId === this.ownTycoonId;
        const sprite: CanvasImageSource = reddened ? this.reddenTexture(texture) : texture;

        if (isUpgrading && effect) {
          const t = Math.min(1, (performance.now() - effect.startTime) / 450);
          // Scale: 1.0 → 1.08 → 1.0 using a sine arc peaking at t=0.4
          const scaleBoost = 1 + 0.08 * Math.sin(t * Math.PI);
          const cx = drawX + scaledWidth / 2;
          const cy = drawY + scaledHeight / 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(scaleBoost, scaleBoost);
          ctx.drawImage(sprite, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
          // White flash overlay fading from 0.75 → 0
          ctx.globalAlpha = 0.75 * Math.max(0, 1 - t * 2.5);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(-scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
          ctx.restore();
        } else {
          // Draw texture scaled to match current zoom level
          ctx.drawImage(sprite, drawX, drawY, scaledWidth, scaledHeight);
        }
        ctx.globalAlpha = 1;

        // Draw hover/selection effect ON TOP of texture (visible for tall buildings)
        const isSelected = this.selectedBuilding === building;
        if (isSelected) {
          // Record exact drawn position for StatusOverlay positioning
          this.selectedBuildingDrawnTop = {
            x: southCornerScreenPos.x,
            y: drawY,
            textureHeight: scaledHeight,
          };
        }
        if (isHovered || isSelected) {
          this.drawBuildingSelectionEffect(
            building, xsize, ysize, config, halfWidth, halfHeight,
            isSelected, isHovered
          );
        }
        if (isSelected) {
          this.drawSelectionBurst(building, xsize, ysize, config);
        }


      } else {
        // Texture not loaded yet — skip (will render once texture arrives via onTextureLoaded callback)
        return;
      }
    });

    // Demolition pass: render buildings that were removed from the map with a shrink+fade effect.
    // These buildings no longer exist in allBuildings so they must be drawn separately.
    for (const [, effect] of this.buildingEffects) {
      if (effect.type !== 'demolish') continue;
      const DURATION = 500;
      const t = Math.min(1, (performance.now() - effect.startTime) / DURATION);
      if (t >= 1) continue;

      const demolishing = effect.building;
      if (this.isFacilityKindHidden(demolishing.visualClass)) continue;
      const dims = this.facilityDimensionsCache.get(demolishing.visualClass);
      const xsize = dims?.xsize || 1;
      const ysize = dims?.ysize || 1;

      const textureFilename = GameObjectTextureCache.getBuildingTextureFilename(demolishing.visualClass);
      const texture = this.gameObjectTextureCache.getTextureSync('BuildingImages', textureFilename);
      if (!texture) continue;

      const scaleFactor = config.tileWidth / 64;
      const scaledWidth = texture.width * scaleFactor;
      const scaledHeight = texture.height * scaleFactor;

      const rotation = this.terrainRenderer.getRotation();
      let anchorI: number, anchorJ: number;
      switch (rotation) {
        case Rotation.NORTH: anchorI = demolishing.y;              anchorJ = demolishing.x;              break;
        case Rotation.EAST:  anchorI = demolishing.y + ysize - 1;  anchorJ = demolishing.x;              break;
        case Rotation.SOUTH: anchorI = demolishing.y + ysize - 1;  anchorJ = demolishing.x + xsize - 1;  break;
        case Rotation.WEST:  anchorI = demolishing.y;              anchorJ = demolishing.x + xsize - 1;  break;
        default:             anchorI = demolishing.y;              anchorJ = demolishing.x;              break;
      }
      const southCorner = this.terrainRenderer.mapToScreen(anchorI, anchorJ);
      const baseX = Math.round(southCorner.x - scaledWidth / 2);
      const baseY = Math.round(southCorner.y + config.tileHeight - scaledHeight);

      // Shrink toward south corner: scale 1.0 → 0.2, alpha 1.0 → 0
      const shrink = 1 - t * 0.8;
      const cx = baseX + scaledWidth / 2;
      const cy = baseY + scaledHeight;

      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.translate(cx, cy);
      ctx.scale(shrink, shrink);
      ctx.drawImage(texture, -scaledWidth / 2, -scaledHeight, scaledWidth, scaledHeight);
      ctx.restore();
    }
  }

  /**
   * Draw construction indicator below a building under construction.
   * Shows an orange "BUILDING" label. Skipped at zoom levels 0-1.
   */
  private drawConstructionIndicator(x: number, y: number, buildingWidth: number): void {
    if (this.terrainRenderer.getZoomLevel() <= 1) return;

    const ctx = this.ctx;
    const label = 'BUILDING';
    ctx.font = '9px monospace';
    const metrics = ctx.measureText(label);
    const padding = 3;
    const barWidth = Math.max(metrics.width + padding * 2, buildingWidth * 0.5);
    const barHeight = 13;

    // Position below the building center
    const bx = Math.round(x - barWidth / 2);
    const by = Math.round(y + 4);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(bx, by, barWidth, barHeight);

    // Orange border top
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(bx, by, barWidth, 2);

    // Label text
    ctx.fillStyle = '#F59E0B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, Math.round(x), Math.round(by + barHeight / 2 + 1));
  }

  /**
   * Draw only the exterior-facing edge of each footprint tile.
   * For a rectangular building this produces the full perimeter; corner tiles get
   * 2 edges, edge tiles 1, interior tiles none.
   *
   * All subpaths are batched into a single beginPath → stroke() call so that
   * shadowBlur triggers only ONE GPU compositing pass regardless of building size.
   * (N separate stroke() calls with shadowBlur = N shadow passes — very expensive.)
   * lineCap = 'round' still applies per-segment: each moveTo starts a new subpath.
   * ctx stroke state (style, width, shadow) must be set before calling.
   */
  private drawExteriorTileEdges(
    building: MapBuilding,
    xsize: number,
    ysize: number,
    config: ZoomConfig,
    halfWidth: number,
    halfHeight: number
  ): void {
    const ctx = this.ctx;
    const pos = this.terrainRenderer.mapToScreen(building.y, building.x);
    const sx = Math.round(pos.x);
    const sy = Math.round(pos.y);

    // In this renderer, increasing row/col moves tiles UP on screen, so
    // (building.y, building.x) is the visual FRONT (south/bottom) corner.
    // mapToScreen gives the top-center of that tile's bounding box; the actual
    // south vertex is one tileHeight lower.  All other perimeter vertices are
    // derived by stepping outward from that south vertex.
    //
    // Drawing as a single closed path gives clean lineJoin corners (no double
    // round-caps at tile boundaries from separate moveTo subpaths).
    const sy0 = sy + config.tileHeight; // south vertex of the front tile
    ctx.beginPath();
    ctx.moveTo(sx,                               sy0);                                      // bottom (south, front)
    ctx.lineTo(sx + xsize * halfWidth,           sy0 - xsize * halfHeight);                // right
    ctx.lineTo(sx + (xsize - ysize) * halfWidth, sy0 - (xsize + ysize) * halfHeight);      // top (north, back)
    ctx.lineTo(sx - ysize * halfWidth,           sy0 - ysize * halfHeight);                // left
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Draw building footprint as individual tile diamonds (fill only).
   */
  private drawBuildingFootprint(
    building: MapBuilding,
    xsize: number,
    ysize: number,
    config: ZoomConfig,
    halfWidth: number,
    halfHeight: number
  ): void {
    const ctx = this.ctx;

    for (let dy = 0; dy < ysize; dy++) {
      for (let dx = 0; dx < xsize; dx++) {
        const screenPos = this.terrainRenderer.mapToScreen(building.y + dy, building.x + dx);
        const sx = Math.round(screenPos.x);
        const sy = Math.round(screenPos.y);

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - halfWidth, sy + halfHeight);
        ctx.lineTo(sx, sy + config.tileHeight);
        ctx.lineTo(sx + halfWidth, sy + halfHeight);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * Draw selection/hover effect on top of a building texture.
   * - Selected: gold pulsing outline + corner bracket markers
   * - Hover: green outline + corner brackets (no fill)
   */
  private drawBuildingSelectionEffect(
    building: MapBuilding,
    xsize: number,
    ysize: number,
    config: ZoomConfig,
    halfWidth: number,
    halfHeight: number,
    isSelected: boolean,
    _isHovered: boolean
  ): void {
    const ctx = this.ctx;
    const now = performance.now();

    // Pulsing alpha for selected buildings (0.5 to 0.9 over ~1.5s cycle)
    const pulseAlpha = isSelected
      ? 0.5 + 0.4 * (0.5 + 0.5 * Math.sin((now - this.selectionPulseTime) * 0.004))
      : 0.55;

    const color = isSelected ? '#D4A853' : '#10B981';

    // Per-tile exterior edges — each tile's outward-facing sides drawn individually
    ctx.save();
    ctx.globalAlpha = pulseAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected ? 6 : 3;
    this.drawExteriorTileEdges(building, xsize, ysize, config, halfWidth, halfHeight);
    ctx.restore();
  }

  /**
   * Draw small L-shaped bracket markers at the 4 outer corners of a building footprint.
   * N/E/S/W vertices — each bracket has two short arms along the adjacent footprint edges.
   * Much less visual noise than a solid tile fill while still communicating the exact footprint.
   */
  private drawCornerBrackets(
    building: MapBuilding,
    xsize: number,
    ysize: number,
    config: ZoomConfig,
    halfWidth: number,
    halfHeight: number,
    color: string,
    alpha: number
  ): void {
    const ctx = this.ctx;

    // Diagonal length of a single tile edge
    const diag = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);
    // Arm length: at least 8px, scales with tile size (~45% of one tile edge)
    const armLen = Math.max(8, diag * 0.45);

    // Normalised direction components shared by all 4 isometric diagonals
    const dx = halfWidth / diag;
    const dy = halfHeight / diag;

    // 4 outer corner vertices of the footprint in screen space
    const sN = this.terrainRenderer.mapToScreen(building.y,              building.x);
    const sE = this.terrainRenderer.mapToScreen(building.y,              building.x + xsize - 1);
    const sS = this.terrainRenderer.mapToScreen(building.y + ysize - 1,  building.x + xsize - 1);
    const sW = this.terrainRenderer.mapToScreen(building.y + ysize - 1,  building.x);

    const N = { x: sN.x,              y: sN.y };
    const E = { x: sE.x + halfWidth,  y: sE.y + halfHeight };
    const S = { x: sS.x,              y: sS.y + config.tileHeight };
    const W = { x: sW.x - halfWidth,  y: sW.y + halfHeight };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;

    const arm = (fx: number, fy: number, dirX: number, dirY: number) => {
      ctx.beginPath();
      ctx.moveTo(Math.round(fx), Math.round(fy));
      ctx.lineTo(Math.round(fx + dirX * armLen), Math.round(fy + dirY * armLen));
      ctx.stroke();
    };

    // N corner: one arm toward E (+dx,+dy), one toward W (−dx,+dy)
    arm(N.x, N.y, +dx, +dy);
    arm(N.x, N.y, -dx, +dy);

    // E corner: one arm toward N (−dx,−dy), one toward S (−dx,+dy)
    arm(E.x, E.y, -dx, -dy);
    arm(E.x, E.y, -dx, +dy);

    // S corner: one arm toward E (+dx,−dy), one toward W (−dx,−dy)
    arm(S.x, S.y, +dx, -dy);
    arm(S.x, S.y, -dx, -dy);

    // W corner: one arm toward S (+dx,+dy), one toward N (+dx,−dy)
    arm(W.x, W.y, +dx, +dy);
    arm(W.x, W.y, +dx, -dy);

    ctx.restore();
  }

  /**
   * One-shot expanding ellipse ring drawn the moment a building is selected.
   * Fades out over 350ms — gives tactile "click confirmed" feedback.
   */
  private drawSelectionBurst(building: MapBuilding, xsize: number, ysize: number, config: ZoomConfig): void {
    const DURATION = 350;
    const elapsed = performance.now() - this.selectionBurstStartTime;
    if (elapsed >= DURATION) return;

    const t = elapsed / DURATION; // 0 → 1

    // Screen centre: midpoint between NW and SE corners, shifted down by half tile
    const screenNW = this.terrainRenderer.mapToScreen(building.y, building.x);
    const screenSE = this.terrainRenderer.mapToScreen(building.y + ysize - 1, building.x + xsize - 1);
    const cx = (screenNW.x + screenSE.x) / 2;
    const cy = (screenNW.y + screenSE.y) / 2 + config.tileHeight / 2;

    // Ellipse radii expand outward; Y-radius halved to match isometric foreshortening
    const maxRx = (xsize + ysize) * config.tileWidth * 0.35;
    const rx = maxRx * t;
    const ry = rx * 0.5;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.75 * (1 - t);
    ctx.strokeStyle = '#D4A853';
    ctx.lineWidth = 2.5 - t * 1.5; // starts thick, thins as it expands
    ctx.shadowColor = '#D4A853';
    ctx.shadowBlur = 10 * (1 - t);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the outer outline of a building footprint as a single isometric polygon.
   * Traces the 4 edges of the footprint: NE → SE → SW → NW.
   */
  private drawFootprintOutline(
    building: MapBuilding,
    xsize: number,
    ysize: number,
    config: ZoomConfig,
    halfWidth: number,
    halfHeight: number
  ): void {
    const ctx = this.ctx;

    ctx.beginPath();

    // North vertex: top of tile (y, x)
    const topTile = this.terrainRenderer.mapToScreen(building.y, building.x);
    ctx.moveTo(Math.round(topTile.x), Math.round(topTile.y));

    // Trace NE edge: right vertices of tiles along x-axis
    for (let dx = 0; dx < xsize; dx++) {
      const pos = this.terrainRenderer.mapToScreen(building.y, building.x + dx);
      ctx.lineTo(Math.round(pos.x + halfWidth), Math.round(pos.y + halfHeight));
    }

    // Trace SE edge: bottom vertices of tiles along y-axis at x=xsize-1
    for (let dy = 0; dy < ysize; dy++) {
      const pos = this.terrainRenderer.mapToScreen(building.y + dy, building.x + xsize - 1);
      ctx.lineTo(Math.round(pos.x), Math.round(pos.y + config.tileHeight));
    }

    // Trace SW edge: left vertices of tiles along x-axis (reverse) at y=ysize-1
    for (let dx = xsize - 1; dx >= 0; dx--) {
      const pos = this.terrainRenderer.mapToScreen(building.y + ysize - 1, building.x + dx);
      ctx.lineTo(Math.round(pos.x - halfWidth), Math.round(pos.y + halfHeight));
    }

    // Trace NW edge: top vertices back to start along y-axis (reverse) at x=0
    for (let dy = ysize - 1; dy >= 0; dy--) {
      const pos = this.terrainRenderer.mapToScreen(building.y + dy, building.x);
      ctx.lineTo(Math.round(pos.x), Math.round(pos.y));
    }

    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Draw zone/heatmap overlay as semi-transparent isometric tiles.
   * Zone mode: discrete colors from ZONE_OVERLAY_COLORS.
   * Heatmap mode: linear RGB interpolation between color scale points (matching Delphi Map.pas).
   */
  private drawZoneOverlay(bounds: TileBounds) {
    if (!this.zoneOverlayEnabled || this.cachedZoneSurfaces.size === 0) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const isHeatmap = this.overlayIsHeatmap;

    // Zone colors from ZONE_TYPES (single source of truth from domain-types.ts)
    const zoneColors = IsometricMapRenderer.ZONE_OVERLAY_COLORS;

    // Zone surfaces are fetched for (x, y, x+64, y+64) but the Delphi server uses
    // inclusive bounds, returning 65×65 tiles. Without capping, adjacent zone surfaces
    // overlap by 1 tile at each boundary — double-rendering semi-transparent fills
    // creates visible bold lines at every 64-tile interval.
    const zoneSize = 64;

    for (const cached of this.cachedZoneSurfaces.values()) {
      const data = cached.data;
      const maxRows = Math.min(data.rows.length, zoneSize);
      for (let row = 0; row < maxRows; row++) {
        const rowData = data.rows[row];
        const maxCols = Math.min(rowData.length, zoneSize);
        for (let col = 0; col < maxCols; col++) {
          const value = rowData[col];
          if (value === 0 && !isHeatmap) continue;

          const worldX = cached.x + col;
          const worldY = cached.y + row;

          // Convert to isometric (x = j, y = i)
          const screenPos = this.terrainRenderer.mapToScreen(worldY, worldX);

          // Cull if off-screen
          if (screenPos.x < -config.tileWidth || screenPos.x > this.canvas.width + config.tileWidth ||
              screenPos.y < -config.tileHeight || screenPos.y > this.canvas.height + config.tileHeight) {
            continue;
          }

          let color: string;
          if (isHeatmap) {
            color = IsometricMapRenderer.heatmapColor(value);
            // Skip near-transparent values (near-zero produces near-black with low alpha)
            if (Math.abs(value) < 0.001) continue;
          } else if (this.overlayIsTowns) {
            if (value === 0) continue; // no town
            const townId = Math.round(value);
            const idx = ((townId - 1) % IsometricMapRenderer.TOWN_COLORS.length + IsometricMapRenderer.TOWN_COLORS.length) % IsometricMapRenderer.TOWN_COLORS.length;
            color = IsometricMapRenderer.TOWN_COLORS[idx];
          } else {
            color = zoneColors[value] || 'rgba(136, 136, 136, 0.3)';
          }

          ctx.beginPath();
          ctx.moveTo(screenPos.x, screenPos.y);
          ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
          ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
          ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
          ctx.closePath();

          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    }
  }

  /**
   * Darken every 64-tile block this player has never loaded — the fog-of-war layer.
   * One polygon per unexplored block intersecting bounds, not per tile.
   */
  private drawFog(bounds: TileBounds): void {
    if (!this.exploredBlocks) return;
    const dims = this.getMapDimensions();
    const ctx = this.ctx;
    ctx.fillStyle = FOG_TINT;
    const b0x = Math.max(0, Math.floor(bounds.minJ / BLOCK_SIZE) * BLOCK_SIZE);
    const b0y = Math.max(0, Math.floor(bounds.minI / BLOCK_SIZE) * BLOCK_SIZE);
    for (let by = b0y; by <= bounds.maxI && by < dims.height; by += BLOCK_SIZE) {
      for (let bx = b0x; bx <= bounds.maxJ && bx < dims.width; bx += BLOCK_SIZE) {
        if (this.exploredBlocks.has(bx, by)) continue;
        const x2 = Math.min(bx + BLOCK_SIZE, dims.width);
        const y2 = Math.min(by + BLOCK_SIZE, dims.height);
        // (i, j) order, as drawZoneOverlay: mapToScreen(i, j) is the top vertex of tile (i, j),
        // and the top vertex of (i, j+1) is (i, j)'s right vertex, so the four corner tiles'
        // top vertices bound the block exactly under any rotation (the mapping is affine).
        const p0 = this.terrainRenderer.mapToScreen(by, bx);
        const p1 = this.terrainRenderer.mapToScreen(by, x2);
        const p2 = this.terrainRenderer.mapToScreen(y2, x2);
        const p3 = this.terrainRenderer.mapToScreen(y2, bx);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * Convert a heatmap value to an RGBA color string.
   * Negative values → blue/green (good), positive → red (bad), zero → transparent.
   * Matches the general Delphi color scale pattern: negative=cool, positive=warm.
   */
  private static heatmapColor(value: number): string {
    const alpha = 0.4;
    const absVal = Math.abs(value);
    // Clamp intensity to [0, 1] — values beyond 1 are saturated
    const t = Math.min(absVal, 1);

    if (value > 0) {
      // Positive: black → red (crime, pollution increase)
      const r = Math.round(255 * t);
      const g = Math.round(40 * (1 - t));
      const b = Math.round(40 * (1 - t));
      return `rgba(${r},${g},${b},${alpha})`;
    } else {
      // Negative: black → cyan/teal (beauty, supply, population)
      const r = Math.round(40 * (1 - t));
      const g = Math.round(200 * t);
      const b = Math.round(255 * t);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }

  // Town overlay colors — distinct colors per town ID (cycles for >12 towns)
  private static readonly TOWN_COLORS: string[] = [
    'rgba(255, 99, 71, 0.35)',   // tomato
    'rgba(30, 144, 255, 0.35)',  // dodger blue
    'rgba(50, 205, 50, 0.35)',   // lime green
    'rgba(255, 215, 0, 0.35)',   // gold
    'rgba(186, 85, 211, 0.35)',  // medium orchid
    'rgba(0, 206, 209, 0.35)',   // dark turquoise
    'rgba(255, 140, 0, 0.35)',   // dark orange
    'rgba(70, 130, 180, 0.35)',  // steel blue
    'rgba(220, 20, 60, 0.35)',   // crimson
    'rgba(154, 205, 50, 0.35)',  // yellow green
    'rgba(255, 105, 180, 0.35)', // hot pink
    'rgba(0, 128, 128, 0.35)',   // teal
  ];

  // Zone overlay colors — built from ZONE_TYPES (single source of truth)
  private static readonly ZONE_OVERLAY_COLORS: Record<number, string> = Object.fromEntries(
    ZONE_TYPES.map(z => [z.id, z.id === 0 ? 'transparent' : z.overlayColor])
  );

  // Zone painting preview colors — overlay colors with higher alpha for emphasis
  private static readonly ZONE_PAINTING_COLORS: Record<number, string> = Object.fromEntries(
    ZONE_TYPES.map(z => [z.id, z.overlayColor.replace('0.3)', '0.4)')])
  );

  // Zone color word → Delphi TZoneType value (Protocol.pas)
  private static readonly ZONE_COLOR_MAP: Record<string, number> = {
    red: 2,        // znResidential
    blue: 7,       // znCommercial
    yellow: 6,     // znIndustrial
    green: 8,      // znCivics
    orange: 9,     // znOffices
    purple: 1,     // znReserved
  };

  // Zone color word → display name mapping
  private static readonly ZONE_NAME_MAP: Record<string, string> = {
    red: 'RESIDENTIAL',
    blue: 'COMMERCIAL',
    yellow: 'INDUSTRIAL',
    green: 'CIVICS',
    orange: 'OFFICES',
    purple: 'RESERVED',
  };

  /**
   * Parse zone requirement text into a zone overlay value.
   * Input: "Building must be located in blue zone or no zone at all."
   * Output: 7 (znCommercial), or 0 if no zone requirement
   */
  private parseZoneRequirementValue(zoneRequirement: string): number {
    if (!zoneRequirement) return 0;
    const match = /(red|blue|yellow|green|orange|purple)\s+zone/i.exec(zoneRequirement);
    if (!match) return 0;
    return IsometricMapRenderer.ZONE_COLOR_MAP[match[1].toLowerCase()] || 0;
  }

  /**
   * Parse zone requirement text into a clean display name.
   * Input: "Building must be located in blue zone or no zone at all."
   * Output: "COMMERCE", or null if no zone requirement
   */
  private parseZoneDisplayName(zoneRequirement: string): string | null {
    if (!zoneRequirement) return null;
    const match = /(red|blue|yellow|green|orange|purple)\s+zone/i.exec(zoneRequirement);
    if (!match) return null;
    return IsometricMapRenderer.ZONE_NAME_MAP[match[1].toLowerCase()] || null;
  }

  /**
   * Compute the canonical NW corner (min x, min y) from the cursor tile.
   * The cursor is always the visual "top" corner of the footprint; the server
   * expects the NW corner regardless of rotation.
   *
   * Derived from Delphi Voyager: Map.pas MouseClick coordinate adjustment.
   */
  private placementNWCorner(
    cursorI: number, cursorJ: number, xsize: number, ysize: number
  ): { nwI: number; nwJ: number } {
    const rotation = this.terrainRenderer.getRotation();
    switch (rotation) {
      case Rotation.NORTH: return { nwI: cursorI,                nwJ: cursorJ };
      case Rotation.EAST:  return { nwI: cursorI - (ysize - 1),  nwJ: cursorJ };
      case Rotation.SOUTH: return { nwI: cursorI - (ysize - 1),  nwJ: cursorJ - (xsize - 1) };
      case Rotation.WEST:  return { nwI: cursorI,                nwJ: cursorJ - (xsize - 1) };
      default:             return { nwI: cursorI,                nwJ: cursorJ };
    }
  }

  /**
   * Return all footprint tiles for a building placed at the cursor tile,
   * accounting for the current view rotation.
   *
   * Uses the Delphi iinc/jinc pattern (Map.pas BuildCheck):
   *   NORTH: i++ j++    EAST: i-- j++    SOUTH: i-- j--    WEST: i++ j--
   *
   * The cursor tile is the visual "top" corner. The footprint extends
   * xsize tiles along the iinc axis and ysize tiles along the jinc axis.
   */
  private getFootprintTiles(
    cursorI: number, cursorJ: number, xsize: number, ysize: number
  ): Array<{ tileI: number; tileJ: number }> {
    const rotation = this.terrainRenderer.getRotation();
    let iinc: number, jinc: number;
    switch (rotation) {
      case Rotation.NORTH: iinc = 1;  jinc = 1;  break;
      case Rotation.EAST:  iinc = -1; jinc = 1;  break;
      case Rotation.SOUTH: iinc = -1; jinc = -1; break;
      case Rotation.WEST:  iinc = 1;  jinc = -1; break;
      default:             iinc = 1;  jinc = 1;  break;
    }

    const tiles: Array<{ tileI: number; tileJ: number }> = [];
    for (let dy = 0; dy < ysize; dy++) {
      for (let dx = 0; dx < xsize; dx++) {
        tiles.push({
          tileI: cursorI + dy * iinc,
          tileJ: cursorJ + dx * jinc,
        });
      }
    }
    return tiles;
  }

  /**
   * Load a fallback icon image (build menu icon) for placement preview.
   * Returns the image if loaded, null if loading or unavailable.
   */
  private loadFallbackIcon(url?: string): HTMLImageElement | null {
    if (!url) return null;

    const cached = this.fallbackIconImages.get(url);
    if (cached !== undefined) return cached;

    // Start loading — store null as sentinel until loaded
    this.fallbackIconImages.set(url, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.fallbackIconImages.set(url, img);
    };
    img.onerror = () => {
      // Keep null sentinel — won't retry
    };
    img.src = url;
    return null;
  }

  /**
   * Draw building placement preview
   */
  private drawPlacementPreview() {
    if (!this.placementMode || !this.placementPreview) return;
    // Don't draw until mouse has entered the canvas (avoids (0,0) ghost preview)
    if (!this.mouseHasEnteredCanvas) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const preview = this.placementPreview;

    // Get rotation-aware footprint tiles (cursor = visual top corner)
    const footprint = this.getFootprintTiles(preview.i, preview.j, preview.xsize, preview.ysize);

    // Check for collisions, zone requirements, and reserved zones
    let hasCollision = false;

    // Parse required zone value from zone requirement text
    // Text format: "Building must be located in blue zone or no zone at all."
    const requiredZoneValue = this.parseZoneRequirementValue(preview.zoneRequirement);

    // Collect zone values for each tile
    const tileZones: { zoneValue: number | undefined }[] = [];

    for (const tile of footprint) {
      if (hasCollision) break;
      const checkX = tile.tileJ;
      const checkY = tile.tileI;

      // Check building collision (any single tile = blocked)
      for (const building of this.allBuildings) {
        const dims = this.facilityDimensionsCache.get(building.visualClass);
        const bw = dims?.xsize || 1;
        const bh = dims?.ysize || 1;

        if (checkX >= building.x && checkX < building.x + bw &&
            checkY >= building.y && checkY < building.y + bh) {
          hasCollision = true;
          break;
        }
      }

      // Check road collision (any single tile = blocked)
      if (!hasCollision) {
        for (const seg of this.allSegments) {
          const minX = Math.min(seg.x1, seg.x2);
          const maxX = Math.max(seg.x1, seg.x2);
          const minY = Math.min(seg.y1, seg.y2);
          const maxY = Math.max(seg.y1, seg.y2);

          if (checkX >= minX && checkX <= maxX &&
              checkY >= minY && checkY <= maxY) {
            hasCollision = true;
            break;
          }
        }
      }

      // Collect zone value for this tile
      let zoneValue: number | undefined;
      if (this.cachedZoneSurfaces.size > 0) {
        const zoneSize = 64;
        const zoneKey = `${Math.floor(checkX / zoneSize) * zoneSize},${Math.floor(checkY / zoneSize) * zoneSize}`;
        const cachedSurface = this.cachedZoneSurfaces.get(zoneKey);
        if (cachedSurface) {
          const row = checkY - cachedSurface.y;
          const col = checkX - cachedSurface.x;
          if (row >= 0 && row < cachedSurface.data.rows.length &&
              col >= 0 && col < cachedSurface.data.rows[row].length) {
            zoneValue = cachedSurface.data.rows[row][col];
          }
        }
      }
      tileZones.push({ zoneValue });
    }

    // Validate zone requirements and reserved zone using extracted logic
    const validation = validatePlacementZones(tileZones, requiredZoneValue, hasCollision);
    const isInvalid = validation.isInvalid;
    this.placementInvalid = isInvalid;
    if (isInvalid !== this.prevPlacementInvalid) {
      this.prevPlacementInvalid = isInvalid;
      this.onPlacementValidityChange?.(!isInvalid);
    }

    // Lerp placement color smoothly between valid (green) and invalid (red) — ~120ms crossfade
    const now = performance.now();
    const dtMs = this.placementColorTLastMs > 0 ? now - this.placementColorTLastMs : 0;
    this.placementColorTLastMs = now;
    const targetT = isInvalid ? 1 : 0;
    const lerpSpeed = 0.0085; // full crossfade in ~118ms
    this.placementColorT += (targetT - this.placementColorT) * Math.min(1, dtMs * lerpSpeed);
    const ct = this.placementColorT;

    const rStroke = Math.round(68 + 187 * ct);
    const gStroke = Math.round(255 - 187 * ct);
    const strokeColor = `rgb(${rStroke}, ${gStroke}, 68)`;

    // Per-tile exterior edges for placement footprint
    const { nwI, nwJ } = this.placementNWCorner(preview.i, preview.j, preview.xsize, preview.ysize);
    const previewBuilding = { x: nwJ, y: nwI, visualClass: preview.visualClass } as MapBuilding;

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.9;
    this.drawExteriorTileEdges(previewBuilding, preview.xsize, preview.ysize, config, halfWidth, halfHeight);
    ctx.restore();

    // Draw building sprite preview (semi-transparent) on top of diamonds
    if (preview.visualClass) {
      const textureFilename = GameObjectTextureCache.getBuildingTextureFilename(preview.visualClass);
      const texture = this.gameObjectTextureCache.getTextureSync('BuildingImages', textureFilename);

      // Use primary texture from CLASSES.BIN, or fall back to build menu icon
      const drawImage = texture ?? this.loadFallbackIcon(preview.fallbackIconUrl);

      if (drawImage) {
        const scaleFactor = config.tileWidth / 64;
        const scaledWidth = drawImage.width * scaleFactor;
        const scaledHeight = drawImage.height * scaleFactor;

        // Anchor at the south corner of the NW-based footprint (same as drawBuildings).
        // Compute NW corner from cursor, then apply the standard anchor logic.
        const { nwI, nwJ } = this.placementNWCorner(preview.i, preview.j, preview.xsize, preview.ysize);
        const rotation = this.terrainRenderer.getRotation();
        let anchorI: number, anchorJ: number;
        switch (rotation) {
          case Rotation.NORTH: anchorI = nwI;                       anchorJ = nwJ;                       break;
          case Rotation.EAST:  anchorI = nwI + preview.ysize - 1;   anchorJ = nwJ;                       break;
          case Rotation.SOUTH: anchorI = nwI + preview.ysize - 1;   anchorJ = nwJ + preview.xsize - 1;   break;
          case Rotation.WEST:  anchorI = nwI;                       anchorJ = nwJ + preview.xsize - 1;   break;
          default:             anchorI = nwI;                       anchorJ = nwJ;                       break;
        }
        const southCorner = this.terrainRenderer.mapToScreen(anchorI, anchorJ);

        const drawX = Math.round(southCorner.x - scaledWidth / 2);
        const drawY = Math.round(southCorner.y + config.tileHeight - scaledHeight);

        // Breathing pulse: ghost alpha oscillates gently so it feels alive
        const breathe = 0.08 * (0.5 + 0.5 * Math.sin(performance.now() * 0.002));
        ctx.globalAlpha = isInvalid ? 0.3 + breathe * 0.6 : 0.62 + breathe;
        ctx.drawImage(drawImage, drawX, drawY, scaledWidth, scaledHeight);
        ctx.globalAlpha = 1.0;
      }
    }

    // Styled tooltip following the cursor
    const cursorScreen = this.terrainRenderer.mapToScreen(preview.i, preview.j);
    this.drawPlacementTooltip(preview, cursorScreen, ct);
  }

  /**
   * Draw the placement tooltip in the game's glass-panel design language.
   * Dark teal background, green border, gold/red accent, Inter font.
   */
  private drawPlacementTooltip(
    preview: PlacementPreview,
    cursor: { x: number; y: number },
    ct: number  // placementColorT: 0=valid (gold), 1=invalid (red)
  ): void {
    const ctx = this.ctx;

    // Accent colour interpolated from gold → red
    const aR = Math.round(212 + (239 - 212) * ct);
    const aG = Math.round(168 + ( 68 - 168) * ct);
    const aB = Math.round( 83 + ( 68 -  83) * ct);
    const accent = `rgb(${aR},${aG},${aB})`;

    const titleFont  = 'bold 13px Inter, system-ui, sans-serif';
    const detailFont = '11px Inter, system-ui, sans-serif';
    const lineH   = 18;
    const padX    = 13;
    const padTop  = 10;
    const padBot  = 10;
    const divGap  = 6;
    const accentBarW = 3;

    const zoneName = this.parseZoneDisplayName(preview.zoneRequirement);
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Cost', value: `$${preview.cost.toLocaleString()}` },
      { label: 'Size', value: `${preview.xsize} × ${preview.ysize}` },
      ...(zoneName ? [{ label: 'Zone', value: zoneName }] : []),
    ];

    // Measure content widths
    ctx.font = titleFont;
    const titleW = ctx.measureText(preview.buildingName).width;
    ctx.font = detailFont;
    const labelW = Math.max(...rows.map(r => ctx.measureText(r.label).width));
    const valueW = Math.max(...rows.map(r => ctx.measureText(r.value).width));

    const contentW = Math.max(titleW, labelW + 24 + valueW, 120);
    const w = Math.round(contentW + padX * 2 + accentBarW);
    const h = Math.round(padTop + lineH + divGap * 2 + 1 + rows.length * lineH + padBot);

    // Position above-right of cursor, flip when near canvas edges
    let tx = Math.round(cursor.x + 18);
    let ty = Math.round(cursor.y - h - 14);
    if (tx + w > this.canvas.width  - 10) tx = Math.round(cursor.x - w - 18);
    if (ty < 10)                          ty = Math.round(cursor.y + 26);

    ctx.save();

    // Background
    ctx.fillStyle = 'rgba(10, 26, 26, 0.95)';
    const r = 7;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(tx, ty, w, h, r);
    } else {
      ctx.rect(tx, ty, w, h);
    }
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Left accent bar
    ctx.fillStyle = accent;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(tx, ty, accentBarW, h, [r, 0, 0, r]);
    } else {
      ctx.fillRect(tx, ty, accentBarW, h);
    }
    ctx.fill();

    const textX = tx + accentBarW + padX;

    // Title
    ctx.font = titleFont;
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(preview.buildingName, textX, ty + padTop + lineH / 2);

    // Divider
    const divY = Math.round(ty + padTop + lineH + divGap);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx + 10, divY);
    ctx.lineTo(tx + w - 10, divY);
    ctx.stroke();

    // Detail rows
    ctx.font = detailFont;
    rows.forEach((row, i) => {
      const rowY = Math.round(ty + padTop + lineH + divGap * 2 + 1 + i * lineH + lineH / 2);
      ctx.fillStyle = '#6EE7B7';
      ctx.textAlign = 'left';
      ctx.fillText(row.label, textX, rowY);
      ctx.fillStyle = '#F0FDF4';
      ctx.textAlign = 'right';
      ctx.fillText(row.value, tx + w - padX, rowY);
    });

    ctx.restore();
  }

  /**
   * Draw road drawing preview
   * Shows either:
   * - A hover indicator for the current tile (when not drawing)
   * - The full path preview (when drawing/dragging)
   */
  private drawRoadDrawingPreview() {
    if (!this.roadDrawingMode) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const state = this.roadDrawingState;

    // If not drawing, show hover preview for current mouse tile
    if (!state.isDrawing) {
      this.drawRoadHoverIndicator(ctx, config, halfWidth, halfHeight);
      return;
    }

    // Generate staircase path
    const pathTiles = this.generateStaircasePath(
      state.startX, state.startY,
      state.endX, state.endY
    );

    // Check for collisions along path (buildings)
    let hasBuildingCollision = false;
    for (const tile of pathTiles) {
      for (const building of this.allBuildings) {
        const dims = this.facilityDimensionsCache.get(building.visualClass);
        const bw = dims?.xsize || 1;
        const bh = dims?.ysize || 1;

        if (tile.x >= building.x && tile.x < building.x + bw &&
            tile.y >= building.y && tile.y < building.y + bh) {
          hasBuildingCollision = true;
          break;
        }
      }
      if (hasBuildingCollision) break;
    }

    // Check if road connects to existing roads (or is first road)
    const connectsToRoad = this.checkRoadPathConnectsToExisting(pathTiles);
    const hasConnectionError = !connectsToRoad;

    // Determine colors based on validation
    const hasError = hasBuildingCollision || hasConnectionError;
    const fillColor = hasError ? 'rgba(255, 100, 100, 0.5)' : 'rgba(100, 200, 100, 0.5)';
    const strokeColor = hasError ? '#ff4444' : '#88ff88';

    // Draw path tiles
    for (const tile of pathTiles) {
      const screenPos = this.terrainRenderer.mapToScreen(tile.y, tile.x);

      ctx.beginPath();
      ctx.moveTo(screenPos.x, screenPos.y);
      ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
      ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
      ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
      ctx.closePath();

      ctx.fillStyle = fillColor;
      ctx.fill();

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw cost tooltip (expanded to show connection status)
    const endPos = this.terrainRenderer.mapToScreen(state.endY, state.endX);
    const tileCount = pathTiles.length;
    const cost = priceRoadPath(pathTiles.map(t => this.getRoadTileFacts(t.x, t.y)));

    // Determine error message
    let errorMessage = '';
    if (hasBuildingCollision) {
      errorMessage = 'Blocked by building';
    } else if (hasConnectionError) {
      errorMessage = 'Must connect to road';
    }

    const tooltipHeight = errorMessage ? 55 : 40;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(endPos.x + 10, endPos.y - 30, 160, tooltipHeight);

    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Tiles: ${tileCount}`, endPos.x + 20, endPos.y - 12);
    ctx.fillText(`Cost: $${cost.toLocaleString()}`, endPos.x + 20, endPos.y + 4);

    if (errorMessage) {
      ctx.fillStyle = '#ff6666';
      ctx.fillText(`⚠ ${errorMessage}`, endPos.x + 20, endPos.y + 20);
    }
  }

  /**
   * Draw hover indicator for road drawing start point
   * Shows a highlighted tile where the road will start when user clicks
   */
  private drawRoadHoverIndicator(
    ctx: CanvasRenderingContext2D,
    config: { tileWidth: number; tileHeight: number },
    halfWidth: number,
    halfHeight: number
  ) {
    const x = this.mouseMapJ;
    const y = this.mouseMapI;

    // Check if this tile connects to existing roads (or is first road)
    const connectsToRoad = this.checkRoadPathConnectsToExisting([{ x, y }]);
    const hasExistingRoad = this.hasRoadAt(x, y);

    // Check for building collision at this tile
    let hasBuildingCollision = false;
    for (const building of this.allBuildings) {
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const bw = dims?.xsize || 1;
      const bh = dims?.ysize || 1;

      if (x >= building.x && x < building.x + bw &&
          y >= building.y && y < building.y + bh) {
        hasBuildingCollision = true;
        break;
      }
    }

    // Determine color based on validity
    const isValid = !hasBuildingCollision && (connectsToRoad || hasExistingRoad);
    const fillColor = isValid ? 'rgba(100, 200, 255, 0.4)' : 'rgba(255, 150, 100, 0.4)';
    const strokeColor = isValid ? '#66ccff' : '#ff9966';

    // Draw the tile
    const screenPos = this.terrainRenderer.mapToScreen(y, x);

    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
    ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
    ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw tooltip with info
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(screenPos.x + 15, screenPos.y - 25, 180, 45);

    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Tile: (${x}, ${y})`, screenPos.x + 25, screenPos.y - 8);

    // Show status
    const roadTileCount = this.roadTilesMap.size;
    if (hasBuildingCollision) {
      ctx.fillStyle = '#ff6666';
      ctx.fillText('Blocked by building', screenPos.x + 25, screenPos.y + 8);
    } else if (roadTileCount === 0) {
      ctx.fillStyle = '#66ff66';
      ctx.fillText('Click to start first road', screenPos.x + 25, screenPos.y + 8);
    } else if (connectsToRoad || hasExistingRoad) {
      ctx.fillStyle = '#66ff66';
      ctx.fillText('Click to start drawing', screenPos.x + 25, screenPos.y + 8);
    } else {
      ctx.fillStyle = '#ff6666';
      ctx.fillText(`Must connect to road (${roadTileCount} tiles)`, screenPos.x + 25, screenPos.y + 8);
    }
  }

  /**
   * Draw demolish preview — single tile hover or drag rectangle.
   * Red for tiles with roads, gray for empty tiles.
   */
  private drawRoadDemolishPreview() {
    if (!this.onRoadDemolishClick) return;
    if (!this.mouseHasEnteredCanvas) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const state = this.roadDemolishDragState;

    if (!state.isDrawing) {
      // Single tile hover indicator
      const x = this.mouseMapJ;
      const y = this.mouseMapI;
      const hasRoad = this.hasRoadAt(x, y);
      const fillColor = hasRoad ? 'rgba(255, 50, 50, 0.5)' : 'rgba(150, 150, 150, 0.3)';
      const strokeColor = hasRoad ? '#ff3333' : '#999999';

      const screenPos = this.terrainRenderer.mapToScreen(y, x);
      ctx.beginPath();
      ctx.moveTo(screenPos.x, screenPos.y);
      ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
      ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
      ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    // Drag rectangle — highlight all tiles, red if road, gray if empty
    const minX = Math.min(state.startX, state.endX);
    const maxX = Math.max(state.startX, state.endX);
    const minY = Math.min(state.startY, state.endY);
    const maxY = Math.max(state.startY, state.endY);

    let roadCount = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const hasRoad = this.hasRoadAt(x, y);
        if (hasRoad) roadCount++;

        const screenPos = this.terrainRenderer.mapToScreen(y, x);
        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y);
        ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
        ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
        ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
        ctx.closePath();
        ctx.fillStyle = hasRoad ? 'rgba(255, 50, 50, 0.5)' : 'rgba(150, 150, 150, 0.2)';
        ctx.fill();
      }
    }

    // Tooltip with road tile count
    const endPos = this.terrainRenderer.mapToScreen(state.endY, state.endX);
    ctx.font = '12px monospace';
    ctx.fillStyle = roadCount > 0 ? '#ff6666' : '#cccccc';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    const label = roadCount > 0 ? `${roadCount} road tiles` : 'No roads';
    ctx.strokeText(label, endPos.x + 15, endPos.y - 5);
    ctx.fillText(label, endPos.x + 15, endPos.y - 5);
  }

  /**
   * Draw zone painting preview — hover indicator or drag rectangle.
   */
  private drawZonePaintingPreview() {
    if (!this.zonePaintingMode) return;
    if (!this.mouseHasEnteredCanvas) return;

    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const state = this.zonePaintingState;

    // Zone painting preview colors — from ZONE_TYPES with higher alpha for painting emphasis
    const fillColor = IsometricMapRenderer.ZONE_PAINTING_COLORS[this.zonePaintingType] || 'rgba(136,136,136,0.4)';

    if (!state.isDrawing) {
      // Single tile hover indicator
      const screenPos = this.terrainRenderer.mapToScreen(this.mouseMapI, this.mouseMapJ);
      ctx.beginPath();
      ctx.moveTo(screenPos.x, screenPos.y);
      ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
      ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
      ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    // Fill all tiles in the rectangle
    const minX = Math.min(state.startX, state.endX);
    const maxX = Math.max(state.startX, state.endX);
    const minY = Math.min(state.startY, state.endY);
    const maxY = Math.max(state.startY, state.endY);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const screenPos = this.terrainRenderer.mapToScreen(y, x);
        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y);
        ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
        ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
        ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
    }

    // Draw tile count tooltip
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    const endPos = this.terrainRenderer.mapToScreen(state.endY, state.endX);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(`${tileCount} tiles`, endPos.x + 15, endPos.y - 5);
    ctx.fillText(`${tileCount} tiles`, endPos.x + 15, endPos.y - 5);
  }

  /**
   * Generate staircase path between two points (for diagonal roads)
   */
  private generateStaircasePath(x1: number, y1: number, x2: number, y2: number): Point[] {
    // One path for the whole codebase: the preview, the validation and the gateway's
    // segment split must walk the same tiles, or the priced tiles are not the paved ones.
    return roadPathTiles(x1, y1, x2, y2);
  }

  /**
   * Draw water concrete debug grid overlay.
   * Shows isometric diamond outlines for every concrete tile on water, color-coded by source:
   *   Green  = building buffer (+1 around buildings)
   *   Blue   = junction 3×3 (corners, T, crossroads on water)
   * Road tiles on water with concrete get an orange outline.
   * Labels show (x,y) coordinates and concreteId hex.
   */
  private drawWaterConcreteGrid(bounds: TileBounds) {
    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const scaleFactor = config.tileWidth / 64;
    const platformYShift = Math.round(PLATFORM_SHIFT * scaleFactor);

    const mapData: ConcreteMapData = {
      getLandId: (row, col) => terrainLoader ? terrainLoader.getLandId(col, row) : 0,
      hasConcrete: (row, col) => this.hasConcrete(col, row),
      hasRoad: (row, col) => this.roadTilesMap.has(`${col},${row}`),
      hasBuilding: (row, col) => this.isTileOccupiedByBuilding(col, row)
    };

    const sourceColors: Record<string, string> = {
      building: '#00ff00',   // Green
      junction: '#4488ff',   // Blue
    };

    const sourceFills: Record<string, string> = {
      building: 'rgba(0, 255, 0, 0.15)',
      junction: 'rgba(68, 136, 255, 0.15)',
    };

    ctx.save();

    for (let i = bounds.minI; i <= bounds.maxI; i++) {
      for (let j = bounds.minJ; j <= bounds.maxJ; j++) {
        const key = `${j},${i}`;
        if (!this.concreteTilesSet.has(key)) continue;

        // Only show water tiles in this grid
        const landId = terrainLoader ? terrainLoader.getLandId(j, i) : 0;
        if (!isWater(landId)) continue;

        const screenPos = this.terrainRenderer.mapToScreen(i, j);

        // Skip if off-screen
        if (screenPos.x < -50 || screenPos.x > this.canvas.width + 50 ||
            screenPos.y < -50 || screenPos.y > this.canvas.height + 50) {
          continue;
        }

        const isRoadTile = this.roadTilesMap.has(key);
        const source = this.debugConcreteSourceMap.get(key) || 'junction';

        // Apply platform Y shift (same as drawConcrete)
        const drawY = screenPos.y - platformYShift;

        // Draw isometric diamond outline
        ctx.beginPath();
        ctx.moveTo(screenPos.x, drawY);                              // top
        ctx.lineTo(screenPos.x - halfWidth, drawY + halfHeight);     // left
        ctx.lineTo(screenPos.x, drawY + config.tileHeight);          // bottom
        ctx.lineTo(screenPos.x + halfWidth, drawY + halfHeight);     // right
        ctx.closePath();

        // Fill with semi-transparent source color
        if (isRoadTile) {
          ctx.fillStyle = 'rgba(255, 136, 0, 0.12)';
        } else {
          ctx.fillStyle = sourceFills[source] || 'rgba(255, 255, 255, 0.1)';
        }
        ctx.fill();

        // Stroke outline
        if (isRoadTile) {
          ctx.strokeStyle = '#ff8800';  // Orange for road tiles
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = sourceColors[source] || '#ffffff';
          ctx.lineWidth = 1.5;
        }
        ctx.stroke();

        // Label: coordinates + concrete ID (only at Z2+ for readability)
        if (config.tileWidth >= 32) {
          const concreteId = getConcreteId(i, j, mapData);
          const idHex = concreteId !== CONCRETE_NONE
            ? concreteId.toString(16).toUpperCase().padStart(2, '0')
            : '--';

          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = isRoadTile ? '#ff8800' : (sourceColors[source] || '#ffffff');
          ctx.fillText(`${j},${i}`, screenPos.x, drawY + halfHeight - 2);
          ctx.fillText(`$${idHex}`, screenPos.x, drawY + halfHeight + 8);

          // Mark road tiles with 'R' and bridges with 'X'
          if (isRoadTile) {
            const topology = this.roadsRendering ? this.roadsRendering.get(i, j) : RoadBlockId.None;
            const fullRbId = roadBlockId(topology, landId, this.hasConcrete(j, i), false, false);
            const bridgeFlag = isBridge(fullRbId);
            ctx.fillStyle = bridgeFlag ? '#ff4444' : '#ff8800';
            ctx.fillText(bridgeFlag ? 'X' : 'R', screenPos.x, drawY + halfHeight + 18);
          }
        }
      }
    }

    ctx.restore();
  }

  /**
   * Draw debug overlay showing tile metadata across the full screen.
   * Optimized for screenshot analysis by sub-agents:
   * - Every visible tile gets labeled (no mouse-radius limitation)
   * - Compact labels: land type + concrete ID + road status per tile
   * - High-contrast colors on dark backgrounds for OCR readability
   * - Static legend (no mouse-dependent data that changes between captures)
   */
  private drawDebugOverlay(bounds: TileBounds) {
    const ctx = this.ctx;
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const halfWidth = config.tileWidth / 2;
    const halfHeight = config.tileHeight / 2;
    const scaleFactor = config.tileWidth / 64;
    const platformYShift = Math.round(PLATFORM_SHIFT * scaleFactor);

    // Draw water concrete grid overlay (color-coded diamonds)
    if (this.debugShowWaterGrid) {
      this.drawWaterConcreteGrid(bounds);
    }

    // Build mapData adapter once for the whole pass
    const mapData: ConcreteMapData = {
      getLandId: (row, col) => terrainLoader ? terrainLoader.getLandId(col, row) : 0,
      hasConcrete: (row, col) => this.hasConcrete(col, row),
      hasRoad: (row, col) => this.roadTilesMap.has(`${col},${row}`),
      hasBuilding: (row, col) => this.isTileOccupiedByBuilding(col, row)
    };

    // Full-screen tile labels
    const showLabels = this.debugShowTileInfo || this.debugShowRoadInfo || this.debugShowConcreteInfo;
    if (showLabels) {
      ctx.save();
      ctx.font = config.tileWidth >= 32 ? '8px monospace' : '6px monospace';
      ctx.textAlign = 'center';

      for (let i = bounds.minI; i <= bounds.maxI; i++) {
        for (let j = bounds.minJ; j <= bounds.maxJ; j++) {
          const screenPos = this.terrainRenderer.mapToScreen(i, j);

          // Skip if off-screen
          if (screenPos.x < -50 || screenPos.x > this.canvas.width + 50 ||
              screenPos.y < -50 || screenPos.y > this.canvas.height + 50) {
            continue;
          }

          const key = `${j},${i}`;
          const landId = terrainLoader ? terrainLoader.getLandId(j, i) : 0;
          const decoded = decodeLandId(landId);
          const hasRoad = this.roadTilesMap.has(key);
          const hasConcrete = this.concreteTilesSet.has(key);
          const onWater = decoded.isWater;

          // Skip empty tiles (no road, no concrete, no water) to reduce clutter
          if (!hasRoad && !hasConcrete && !onWater && this.debugShowConcreteInfo) continue;

          // Y position: shift up for water platforms
          const isWaterPlatform = hasConcrete && onWater;
          const baseY = isWaterPlatform ? screenPos.y - platformYShift : screenPos.y;
          const labelY = baseY + halfHeight;

          // Line 1: tile coordinates (always shown when debugShowTileInfo)
          if (this.debugShowTileInfo) {
            const landClassChar = ['G', 'M', 'D', 'W'][decoded.landClass] || '?';
            ctx.fillStyle = onWater ? '#00ffff' : 'rgba(255,255,255,0.6)';
            ctx.fillText(`${j},${i} ${landClassChar}`, screenPos.x, labelY - 4);
          }

          // Line 2: concrete ID (when tile has concrete and debugShowConcreteInfo)
          if (this.debugShowConcreteInfo && hasConcrete) {
            const concreteId = getConcreteId(i, j, mapData);
            if (concreteId !== CONCRETE_NONE) {
              const isPlatform = (concreteId & 0x80) !== 0;
              ctx.fillStyle = isPlatform ? '#00ccff' : '#cc88ff';
              ctx.fillText(`$${concreteId.toString(16).toUpperCase().padStart(2, '0')}`, screenPos.x, labelY + 6);
            }
          }

          // Line 3: road info (when tile has road and debugShowRoadInfo)
          if (this.debugShowRoadInfo && hasRoad && this.roadsRendering) {
            const topology = this.roadsRendering.get(i, j);
            const fullRbId = roadBlockId(topology, landId, this.isOnConcrete(j, i), false, false);
            const bridgeFlag = isBridge(fullRbId);
            ctx.fillStyle = bridgeFlag ? '#ff4444' : '#ff8800';
            ctx.fillText(bridgeFlag ? `X:${fullRbId.toString(16).toUpperCase()}` : `R:${fullRbId.toString(16).toUpperCase()}`, screenPos.x, labelY + 16);
          }
        }
      }
      ctx.restore();
    }

    // Highlight mouse tile with yellow diamond
    {
      const screenPos = this.terrainRenderer.mapToScreen(this.mouseMapI, this.mouseMapJ);
      ctx.beginPath();
      ctx.moveTo(screenPos.x, screenPos.y);
      ctx.lineTo(screenPos.x - halfWidth, screenPos.y + halfHeight);
      ctx.lineTo(screenPos.x, screenPos.y + config.tileHeight);
      ctx.lineTo(screenPos.x + halfWidth, screenPos.y + halfHeight);
      ctx.closePath();
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw static legend + mouse-tile detail panel
    this.drawDebugPanel(ctx);
  }

  /**
   * Draw debug info panel
   */
  private drawDebugPanel(ctx: CanvasRenderingContext2D) {
    const terrainLoader = this.terrainRenderer.getTerrainLoader();
    const x = this.mouseMapJ;
    const y = this.mouseMapI;

    const landId = terrainLoader ? terrainLoader.getLandId(x, y) : 0;
    const decoded = decodeLandId(landId);
    const hasConcrete = this.hasConcrete(x, y);
    const hasRoad = this.roadTilesMap.has(`${x},${y}`);

    // --- Top-left: static legend (always visible, useful in screenshots) ---
    const legendLines: Array<{ text: string; color: string }> = [];
    legendLines.push({ text: 'DEBUG [D=off 1=tile 2=bldg 3=conc 4=wgrid 5=road]', color: '#ffff00' });

    // Active toggles indicator
    const toggles = [
      this.debugShowTileInfo ? '1:ON' : '1:off',
      this.debugShowBuildingInfo ? '2:ON' : '2:off',
      this.debugShowConcreteInfo ? '3:ON' : '3:off',
      this.debugShowWaterGrid ? '4:ON' : '4:off',
      this.debugShowRoadInfo ? '5:ON' : '5:off',
    ].join(' ');
    legendLines.push({ text: toggles, color: '#aaaaaa' });

    // Water grid legend (compact, always present when active)
    if (this.debugShowWaterGrid) {
      legendLines.push({ text: 'WATER GRID:', color: '#00ccff' });
      legendLines.push({ text: ' Green=bldg  Blue=junc  Orange=road', color: '#cccccc' });
    }

    // Tile label legend
    if (this.debugShowTileInfo || this.debugShowConcreteInfo || this.debugShowRoadInfo) {
      legendLines.push({ text: 'TILE LABELS:', color: '#ffff00' });
      const parts: string[] = [];
      if (this.debugShowTileInfo) parts.push('j,i+land');
      if (this.debugShowConcreteInfo) parts.push('$XX=concId');
      if (this.debugShowRoadInfo) parts.push('R/X:rbId');
      legendLines.push({ text: ' ' + parts.join('  '), color: '#cccccc' });
    }

    const legendH = 14 + legendLines.length * 14;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(8, 8, 390, legendH);
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let li = 0; li < legendLines.length; li++) {
      ctx.fillStyle = legendLines[li].color;
      ctx.fillText(legendLines[li].text, 14, 22 + li * 14);
    }

    // --- Bottom-left: mouse-tile detail panel (live use, not critical for screenshots) ---
    const detailLines: Array<{ text: string; color: string }> = [];
    detailLines.push({ text: `Tile (${x},${y}) LandId:0x${landId.toString(16).toUpperCase().padStart(2,'0')}`, color: '#ffffff' });
    detailLines.push({ text: `${landClassName(decoded.landClass)} | ${landTypeName(decoded.landType)} | Var:${decoded.landVar}`, color: '#ffffff' });

    if (decoded.isWater) {
      const wtype = decoded.isDeepWater ? 'Deep(Center)' : decoded.isWaterEdge ? 'Edge' : 'Water';
      detailLines.push({ text: `WATER: ${wtype}`, color: '#00ffff' });
    }

    if (hasRoad && this.roadsRendering) {
      const topology = this.roadsRendering.get(y, x);
      const fullRbId = roadBlockId(topology, landId, this.isOnConcrete(x, y), false, false);
      const bridgeFlag = isBridge(fullRbId);
      detailLines.push({ text: `Road: ${bridgeFlag ? 'BRIDGE' : 'ROAD'} rbId=0x${fullRbId.toString(16).toUpperCase()}`, color: bridgeFlag ? '#ff4444' : '#ff8800' });
    }

    if (hasConcrete) {
      const concreteKey = `${x},${y}`;
      const source = this.debugConcreteSourceMap.get(concreteKey) || '?';
      const mapDataLocal: ConcreteMapData = {
        getLandId: (row, col) => terrainLoader ? terrainLoader.getLandId(col, row) : 0,
        hasConcrete: (row, col) => this.hasConcrete(col, row),
        hasRoad: (row, col) => this.roadTilesMap.has(`${col},${row}`),
        hasBuilding: (row, col) => this.isTileOccupiedByBuilding(col, row)
      };
      const concreteId = getConcreteId(y, x, mapDataLocal);
      const cfg = buildNeighborConfig(y, x, mapDataLocal);
      const isPlatform = (concreteId & 0x80) !== 0;
      const neighborStr = this.formatNeighborConfig(cfg);
      let idType: string;
      if (isPlatform) {
        idType = this.getPlatformIdName(concreteId);
      } else if ((concreteId & 0x10) !== 0) {
        idType = `ROAD_CONC`;
      } else if (concreteId === CONCRETE_FULL) {
        idType = 'FULL';
      } else {
        idType = `EDGE(${concreteId & 0x0F})`;
      }
      detailLines.push({ text: `Concrete: $${concreteId.toString(16).toUpperCase().padStart(2,'0')} ${idType} src:${source}`, color: isPlatform ? '#00ccff' : '#cc88ff' });
      detailLines.push({ text: `Neighbors: ${neighborStr}`, color: '#ffffff' });
      const texPath = this.concreteBlockClassManager.getImageFilename(concreteId);
      detailLines.push({ text: texPath ? `Tex: ${texPath}` : `Tex: MISSING id=${concreteId}`, color: texPath ? '#00ff00' : '#ff0000' });
    }

    // Building info (compact)
    if (this.debugShowBuildingInfo) {
      const buildingAtMouse = this.getBuildingAtTile(x, y);
      if (buildingAtMouse) {
        const dims = this.facilityDimensionsCache.get(buildingAtMouse.visualClass);
        detailLines.push({ text: `Bldg: ${buildingAtMouse.visualClass} at(${buildingAtMouse.x},${buildingAtMouse.y}) ${dims ? dims.xsize + 'x' + dims.ysize : 'NO DIMS'}`, color: '#ff8800' });
      }
    }

    const detailH = 10 + detailLines.length * 14;
    const detailY = this.canvas.height - detailH - 55;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(8, detailY, 420, detailH);
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let li = 0; li < detailLines.length; li++) {
      ctx.fillStyle = detailLines[li].color;
      ctx.fillText(detailLines[li].text, 14, detailY + 14 + li * 14);
    }
  }

  /**
   * Format neighbor configuration as visual string
   * Shows [TL T TR / L X R / BL B BR]
   */
  private formatNeighborConfig(cfg: ConcreteCfg): string {
    const c = (b: boolean) => b ? '■' : '□';
    return `${c(cfg[0])}${c(cfg[1])}${c(cfg[2])} ${c(cfg[3])}X${c(cfg[4])} ${c(cfg[5])}${c(cfg[6])}${c(cfg[7])}`;
  }

  /**
   * Get platform ID name for debug display
   */
  private getPlatformIdName(concreteId: number): string {
    switch (concreteId) {
      case PLATFORM_IDS.CENTER: return 'PLATFORM_CENTER ($80)';
      case PLATFORM_IDS.E: return 'PLATFORM_E ($81)';
      case PLATFORM_IDS.N: return 'PLATFORM_N ($82)';
      case PLATFORM_IDS.NE: return 'PLATFORM_NE ($83)';
      case PLATFORM_IDS.NW: return 'PLATFORM_NW ($84)';
      case PLATFORM_IDS.S: return 'PLATFORM_S ($85)';
      case PLATFORM_IDS.SE: return 'PLATFORM_SE ($86)';
      case PLATFORM_IDS.SW: return 'PLATFORM_SW ($87)';
      case PLATFORM_IDS.W: return 'PLATFORM_W ($88)';
      default: return `PLATFORM_??? ($${concreteId.toString(16)})`;
    }
  }


  // =========================================================================
  // MOUSE CONTROLS
  // =========================================================================

  // =========================================================================
  // VEGETATION CONTROL
  // =========================================================================

  /**
   * Mark camera as moving (resets debounce timer).
   * When the timer expires, vegetation is re-rendered.
   */
  private markCameraMoving(): void {
    this.isCameraMoving = true;

    // Reset debounce timer
    if (this.cameraStopTimer !== null) {
      clearTimeout(this.cameraStopTimer);
    }

    this.cameraStopTimer = window.setTimeout(() => {
      this.isCameraMoving = false;
      this.cameraStopTimer = null;
      // Invalidate ground cache so vegetation gets baked in on next render.
      // The cache was built while isCameraMoving was true (vegetation skipped).
      this.invalidateGroundCache();
      this.requestRender();
    }, this.CAMERA_STOP_DEBOUNCE_MS);
  }

  /**
   * Enable/disable vegetation rendering globally
   */
  public setVegetationEnabled(enabled: boolean): void {
    if (this.vegetationEnabled !== enabled) {
      this.vegetationEnabled = enabled;
      this.requestRender();
    }
  }

  /**
   * Check if vegetation rendering is enabled
   */
  public isVegetationEnabled(): boolean {
    return this.vegetationEnabled;
  }

  /**
   * Enable/disable hiding vegetation during camera movement
   */
  public setHideVegetationOnMove(enabled: boolean): void {
    this.isVegetationHiddenOnMove = enabled;
  }

  /**
   * Check if hide-vegetation-on-move is enabled
   */
  public isHideVegetationOnMove(): boolean {
    return this.isVegetationHiddenOnMove;
  }

  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.requestRender();
  }

  public toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    this.requestRender();
  }

  public setVehicleAnimationsEnabled(enabled: boolean): void {
    if (this.vehicleSystem) {
      this.vehicleSystem.setEnabled(enabled);
      if (!enabled) {
        this.requestRender();
      }
    }
  }

  public setAircraftAnimationsEnabled(enabled: boolean): void {
    this.aircraftSystem.setEnabled(enabled);
    this.requestRender();
  }

  public setGlassForeignBuildings(enabled: boolean): void {
    this.glassForeignBuildings = enabled;
    this.requestRender();
  }

  public setSignalLosingFacilities(enabled: boolean): void {
    this.signalLosingFacilities = enabled;
    this.requestRender();
  }

  /** The hidden facility kinds (FacIds). A non-array (an old/corrupt persisted blob) hides nothing. */
  public setHiddenFacIds(facIds: number[] | undefined): void {
    this.hiddenFacIds = new Set(Array.isArray(facIds) ? facIds : []);
    this.requestRender();
  }

  /** The game store's decimal tycoon id; '' / undefined / unparsable means "unknown" and glasses nothing. */
  public setOwnTycoonId(tycoonId: string | undefined): void {
    this.ownTycoonId = parseInt(tycoonId || '0', 10) || 0;
    this.requestRender();
  }

  /** Attach the seen-set for the current world + player (null detaches → no fog). */
  public setExploredBlocks(blocks: ExploredBlocks | null): void {
    this.exploredBlocks = blocks;
    this.requestRender();
  }

  /** True when the block holding tile (x, y) has been loaded, or when no set is attached. */
  public isTileExplored(x: number, y: number): boolean {
    return !this.exploredBlocks || this.exploredBlocks.has(x, y);
  }

  // =========================================================================
  // MOUSE CONTROLS
  // =========================================================================

  /** Convert screen pixel deltas to rotation-aware map deltas (Jacobian inverse) */
  private screenDeltaToMapDelta(screenDx: number, screenDy: number): { deltaI: number; deltaJ: number } {
    const config = ZOOM_LEVELS[this.terrainRenderer.getZoomLevel()];
    const u = config.u;
    const a = (screenDx + 2 * screenDy) / (2 * u);
    const b = (2 * screenDy - screenDx) / (2 * u);

    switch (this.terrainRenderer.getRotation()) {
      case Rotation.NORTH: return { deltaI: a,  deltaJ: b };
      case Rotation.EAST:  return { deltaI: -b, deltaJ: a };
      case Rotation.SOUTH: return { deltaI: -a, deltaJ: -b };
      case Rotation.WEST:  return { deltaI: b,  deltaJ: -a };
      default:             return { deltaI: a,  deltaJ: b };
    }
  }

  private setupMouseControls() {
    // Disable terrain renderer's built-in mouse controls (we'll handle them)
    // The terrain renderer has its own pan/zoom which we need to coordinate with

    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('mouseleave', this.boundMouseLeave);
    this.canvas.addEventListener('wheel', this.boundWheel);
    this.canvas.addEventListener('contextmenu', this.boundContextMenu);

  }

  private onMouseDown(e: MouseEvent) {
    const mapPos = this.screenToMap(e.clientX, e.clientY);
    this.mouseMapI = mapPos.i;
    this.mouseMapJ = mapPos.j;

    if (e.button === 2) { // Right click
      e.preventDefault();

      if (this.roadDrawingMode && this.onCancelRoadDrawing) {
        this.onCancelRoadDrawing();
        return;
      }

      if (this.zonePaintingMode && this.onCancelZonePainting) {
        this.onCancelZonePainting();
        return;
      }

      if (this.onRoadDemolishClick && this.onCancelRoadDemolish) {
        this.onCancelRoadDemolish();
        return;
      }

      // Start drag (even in placement mode — cancel only on release without drag)
      this.isDragging = true;
      this.rightClickDragged = false;
      this.pressX = e.clientX;
      this.pressY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    }

    if (e.button === 0) { // Left click
      if (this.zonePaintingMode) {
        this.zonePaintingState.isDrawing = true;
        this.zonePaintingState.startX = mapPos.j;
        this.zonePaintingState.startY = mapPos.i;
        this.zonePaintingState.endX = mapPos.j;
        this.zonePaintingState.endY = mapPos.i;
        this.requestRender();
      } else if (this.roadDrawingMode) {
        this.roadDrawingState.isDrawing = true;
        this.roadDrawingState.startX = mapPos.j;
        this.roadDrawingState.startY = mapPos.i;
        this.roadDrawingState.endX = mapPos.j;
        this.roadDrawingState.endY = mapPos.i;
        this.requestRender();
      } else if (!this.placementMode && !this.connectMode && this.onRoadDemolishClick) {
        // Road demolish mode — start drag selection
        this.roadDemolishDragState.isDrawing = true;
        this.roadDemolishDragState.startX = mapPos.j;
        this.roadDemolishDragState.startY = mapPos.i;
        this.roadDemolishDragState.endX = mapPos.j;
        this.roadDemolishDragState.endY = mapPos.i;
        this.requestRender();
      } else {
        // Placement, connect and plain-map clicks act on RELEASE, so the same
        // button can pan (Voyager GameControl.pas:533-597)
        this.beginLeftClickPending(e);
      }
    }
  }

  /** Record a left-button press whose meaning (click or pan) is decided later. */
  private beginLeftClickPending(e: MouseEvent): void {
    this.leftButtonDown = true;
    this.leftClickDragged = false;
    this.pressX = e.clientX;
    this.pressY = e.clientY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  /** The click half of the arbitration — runs on release without drag. */
  private performLeftClick(e: MouseEvent): void {
    const mapPos = this.screenToMap(e.clientX, e.clientY);
    if (this.placementMode && this.placementPreview) {
      // Confirm building placement — normalize cursor to NW corner for the server.
      // Server always expects (x=col, y=row) of the NW corner (min coords).
      // Block placement if position is invalid (collision, reserved zone, or all tiles in wrong zone)
      if (this.onPlacementConfirm && !this.placementInvalid) {
        const p = this.placementPreview;
        const { nwI, nwJ } = this.placementNWCorner(p.i, p.j, p.xsize, p.ysize);
        this.onPlacementConfirm(nwJ, nwI); // j=x (col), i=y (row)
      }
    } else if (this.connectMode) {
      // Connect mode — click on a building to connect it to the source
      const building = this.getBuildingAt(mapPos.j, mapPos.i);
      if (building && this.onConnectModeClick) {
        this.onConnectModeClick(building.x, building.y);
      }
    } else {
      // Check building click
      const building = this.getBuildingAt(mapPos.j, mapPos.i);
      if (building && !IsometricMapRenderer.isPortal(building) && this.onBuildingClick) {
        this.onBuildingClick(building.x, building.y, building.visualClass);
      } else if (!building && this.onEmptyMapClick) {
        this.onEmptyMapClick();
      }
    }
  }

  private onMouseMove(e: MouseEvent) {
    const mapPos = this.screenToMap(e.clientX, e.clientY);
    this.mouseMapI = mapPos.i;
    this.mouseMapJ = mapPos.j;
    this.mouseHasEnteredCanvas = true;

    // Pending left click: past the Manhattan threshold it becomes a pan
    if (this.leftButtonDown && !this.leftClickDragged) {
      const totalDx = Math.abs(e.clientX - this.pressX);
      const totalDy = Math.abs(e.clientY - this.pressY);
      if (totalDx + totalDy > IsometricMapRenderer.MIN_DRAG_MANHATTAN_PX) {
        this.leftClickDragged = true;
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
      }
    }

    if (this.isDragging) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;

      // Mark as actual drag once the total travel crosses the same threshold
      const totalDx = Math.abs(e.clientX - this.pressX);
      const totalDy = Math.abs(e.clientY - this.pressY);
      if (totalDx + totalDy > IsometricMapRenderer.MIN_DRAG_MANHATTAN_PX) {
        this.rightClickDragged = true;
      }

      const { deltaI, deltaJ } = this.screenDeltaToMapDelta(dx, dy);
      this.terrainRenderer.pan(deltaI, deltaJ);

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      // Mark camera as moving (for vegetation hide-on-move option)
      this.markCameraMoving();

      // Mark zone request manager as moving (prevents zone requests during drag)
      if (this.zoneRequestManager) {
        this.zoneRequestManager.markMoving();
      }
    }

    if (this.roadDrawingMode && this.roadDrawingState.isDrawing) {
      this.roadDrawingState.endX = mapPos.j;
      this.roadDrawingState.endY = mapPos.i;
    }

    if (this.zonePaintingMode && this.zonePaintingState.isDrawing) {
      this.zonePaintingState.endX = mapPos.j;
      this.zonePaintingState.endY = mapPos.i;
    }

    if (this.onRoadDemolishClick && this.roadDemolishDragState.isDrawing) {
      this.roadDemolishDragState.endX = mapPos.j;
      this.roadDemolishDragState.endY = mapPos.i;
    }

    if (this.placementMode && this.placementPreview) {
      this.placementPreview.i = mapPos.i;
      this.placementPreview.j = mapPos.j;
    }

    // Update hover state (Portal facilities are non-interactive)
    const candidate = this.getBuildingAt(mapPos.j, mapPos.i);
    this.hoveredBuilding = (candidate && IsometricMapRenderer.isPortal(candidate)) ? null : candidate;
    this.updateCursor();

    this.requestRender();
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 2 && this.isDragging) {
      this.isDragging = false;
      this.updateCursor();

      // Right-click release without drag in placement mode → cancel placement
      if (!this.rightClickDragged && this.placementMode && this.onCancelPlacement) {
        this.onCancelPlacement();
        return;
      }

      // Right-click release without drag → context menu at the pointer (x = column j, y = row i)
      if (!this.rightClickDragged && this.onMapContextMenu) {
        const pos = this.screenToMap(e.clientX, e.clientY);
        this.onMapContextMenu(e.clientX, e.clientY, pos.j, pos.i);
      }

      // Mark movement stopped and trigger delayed zone loading
      if (this.zoneRequestManager) {
        const currentZoom = this.terrainRenderer.getZoomLevel();
        this.zoneRequestManager.markStopped(currentZoom);
      }

      // Also request immediately (manager will handle delay internally)
      this.checkVisibleZones();
    }

    if (e.button === 0 && this.roadDrawingMode && this.roadDrawingState.isDrawing) {
      this.roadDrawingState.isDrawing = false;

      if (this.onRoadSegmentComplete) {
        this.onRoadSegmentComplete(
          this.roadDrawingState.startX,
          this.roadDrawingState.startY,
          this.roadDrawingState.endX,
          this.roadDrawingState.endY
        );
      }
    }

    if (e.button === 0 && this.zonePaintingMode && this.zonePaintingState.isDrawing) {
      this.zonePaintingState.isDrawing = false;

      if (this.onZoneAreaComplete) {
        this.onZoneAreaComplete(
          this.zonePaintingState.startX,
          this.zonePaintingState.startY,
          this.zonePaintingState.endX,
          this.zonePaintingState.endY
        );
      }
    }

    if (e.button === 0 && this.onRoadDemolishClick && this.roadDemolishDragState.isDrawing) {
      this.roadDemolishDragState.isDrawing = false;

      const { startX, startY, endX, endY } = this.roadDemolishDragState;
      if (startX === endX && startY === endY) {
        // Single click — demolish single tile (backward compat)
        const key = `${startX},${startY}`;
        if (this.roadTilesMap.has(key)) {
          this.onRoadDemolishClick(startX, startY);
        }
      } else if (this.onRoadDemolishAreaComplete) {
        // Drag — demolish area
        this.onRoadDemolishAreaComplete(startX, startY, endX, endY);
      }
      this.requestRender();
    }

    if (e.button === 0 && this.leftButtonDown) {
      this.leftButtonDown = false;
      if (this.leftClickDragged) {
        // End of a left-button pan
        this.leftClickDragged = false;
        this.isDragging = false;
        this.updateCursor();
        if (this.zoneRequestManager) {
          this.zoneRequestManager.markStopped(this.terrainRenderer.getZoomLevel());
        }
        this.checkVisibleZones();
        return;
      }
      // Release without drag — the click acts now (Voyager GameControl.pas:595)
      this.performLeftClick(e);
    }
  }

  private onMouseLeave() {
    // A pending left click can't complete once the pointer left the canvas
    this.leftButtonDown = false;
    this.leftClickDragged = false;
    if (this.isDragging) {
      this.isDragging = false;
      this.updateCursor();

      // Mark movement stopped and trigger delayed zone loading
      if (this.zoneRequestManager) {
        const currentZoom = this.terrainRenderer.getZoomLevel();
        this.zoneRequestManager.markStopped(currentZoom);
      }

      // Also request immediately (manager will handle delay internally)
      this.checkVisibleZones();
    }

  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();

    const oldZoom = this.terrainRenderer.getZoomLevel();
    const newZoom = e.deltaY > 0
      ? Math.max(0, oldZoom - 1)
      : Math.min(3, oldZoom + 1);

    if (newZoom !== oldZoom) {
      // Zoom-to-cursor: record map position under mouse at old zoom
      const rect = this.canvas.getBoundingClientRect();
      const mouseScreenX = e.clientX - rect.left;
      const mouseScreenY = e.clientY - rect.top;
      const mapPosBefore = this.terrainRenderer.screenToMap(mouseScreenX, mouseScreenY);

      // Change zoom (this recalculates origin for the same camera position)
      this.terrainRenderer.setZoomLevel(newZoom);
      this.terrainRenderer.clearDistantZoomCaches(newZoom);

      // Where does that same map position appear on screen at the new zoom?
      const screenPosAfter = this.terrainRenderer.mapToScreen(mapPosBefore.x, mapPosBefore.y);

      // Pan to compensate: move the camera so the map point stays under the mouse
      const screenDx = screenPosAfter.x - mouseScreenX;
      const screenDy = screenPosAfter.y - mouseScreenY;
      if (Math.abs(screenDx) > 0.5 || Math.abs(screenDy) > 0.5) {
        const { deltaI, deltaJ } = this.screenDeltaToMapDelta(screenDx, screenDy);
        this.terrainRenderer.pan(deltaI, deltaJ);
      }

      // Mark as moving then stopped (triggers delayed zone load based on new zoom)
      if (this.zoneRequestManager) {
        this.zoneRequestManager.markMoving();
        this.zoneRequestManager.markStopped(newZoom);
      }

      this.checkVisibleZones();
      this.requestRender();
    }
  }

  private updateCursor() {
    // An active pan wins over every mode — the hand is holding the map
    if (this.isDragging) {
      this.canvas.style.cursor = 'grabbing';
    } else if (this.placementMode || this.roadDrawingMode || this.onRoadDemolishClick || this.zonePaintingMode || this.connectMode) {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.hoveredBuilding) {
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'grab';
    }
  }

  /**
   * Convert screen coordinates to map coordinates
   */
  private screenToMap(clientX: number, clientY: number): { i: number; j: number } {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const mapPos = this.terrainRenderer.screenToMap(screenX, screenY);
    // mapPos.x = row (i), mapPos.y = column (j) from coordinate-mapper
    return { i: Math.floor(mapPos.x), j: Math.floor(mapPos.y) };
  }

  /**
   * Get the visual class of a building at its origin coordinates.
   * Uses exact match on building origin (x, y) — no collision check needed.
   */
  public getVisualClassAt(x: number, y: number): string | null {
    for (const building of this.allBuildings) {
      if (building.x === x && building.y === y) {
        return building.visualClass;
      }
    }
    return null;
  }

  /**
   * Get building at map coordinates
   */
  private getBuildingAt(x: number, y: number): MapBuilding | null {
    for (const building of this.allBuildings) {
      if (this.isFacilityKindHidden(building.visualClass)) continue;
      const dims = this.facilityDimensionsCache.get(building.visualClass);
      const xsize = dims?.xsize || 1;
      const ysize = dims?.ysize || 1;

      if (x >= building.x && x < building.x + xsize &&
          y >= building.y && y < building.y + ysize) {
        return building;
      }
    }
    return null;
  }

  /**
   * Check and load zones for visible area
   */
  private checkVisibleZones() {
    if (!this.zoneRequestManager) {
      return;
    }

    const bounds = this.getVisibleBounds();
    const cameraPos = this.terrainRenderer.getCameraPosition();
    const currentZoom = this.terrainRenderer.getZoomLevel();

    // Request visible zones (manager handles queuing, prioritization, and delays)
    this.zoneRequestManager.requestVisibleZones(
      bounds,
      this.cachedZones,
      cameraPos,
      currentZoom
    );

    // Notify listener that the viewport changed (used to send SetViewedArea to game server)
    if (this.onViewportChanged) this.onViewportChanged();
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  public destroy() {
    // Cancel pending render
    if (this.pendingRender !== null) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }

    // Cancel camera stop timer
    if (this.cameraStopTimer !== null) {
      clearTimeout(this.cameraStopTimer);
      this.cameraStopTimer = null;
    }

    // Remove event listeners
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    this.canvas.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mouseup', this.boundMouseUp);
    this.canvas.removeEventListener('mouseleave', this.boundMouseLeave);
    this.canvas.removeEventListener('wheel', this.boundWheel);
    this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
    this.cancelKeyboardPan();
    if (this.boundKeyUp) {
      document.removeEventListener('keyup', this.boundKeyUp);
      this.boundKeyUp = null;
    }
    if (this.boundWindowBlur) {
      window.removeEventListener('blur', this.boundWindowBlur);
      this.boundWindowBlur = null;
    }
    if (this.boundKeyDown) {
      document.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Destroy touch handler
    if (this.touchHandler) {
      this.touchHandler.destroy();
      this.touchHandler = null;
    }

    // Destroy terrain renderer (cancels its own RAF, clears caches)
    this.terrainRenderer.destroy();

    // Clear game object cache
    this.gameObjectTextureCache.clear();

    // Clear data
    this.cachedZones.clear();
    this.cachedZoneSurfaces.clear();
    this.allBuildings = [];
    this.allSegments = [];
    this.roadTilesMap.clear();
    this.concreteTilesSet.clear();
    this.facilityDimensionsCache.clear();
    this.selectedBuilding = null;
    this.hoveredBuilding = null;

    // Clear zone request manager
    if (this.zoneRequestManager) {
      this.zoneRequestManager.clear();
      this.zoneRequestManager = null;
    }

    // Null out callbacks
    this.onLoadZone = null;
    this.onBuildingClick = null;
    this.onEmptyMapClick = null;
    this.onViewportChanged = null;
    this.onCancelPlacement = null;
    this.onPlacementConfirm = null;
    this.onFetchFacilityDimensions = null;
    this.onRoadSegmentComplete = null;
    this.onCancelRoadDrawing = null;
    this.onRoadDemolishClick = null;
    this.onZoneAreaComplete = null;
    this.onCancelZonePainting = null;
  }
}
