/**
 * ClientHandlerContext — Narrow interface for extracted client handler modules.
 *
 * StarpeaceClient implements this interface so that handler functions
 * can access state and methods without importing the full class.
 */

import type {
  WsMessage,
  CompanyInfo,
  BuildingFocusInfo,
  BuildingCategory,
  BuildingInfo,
  BuildingDetailsResponse,
  SurfaceType,
} from '../../shared/types';
import type { IsometricMapRenderer as IsometricRenderer } from '../renderer/isometric-map-renderer';
import type { MapNavigationUI } from '../ui/map-navigation-ui';
import type { SoundManager } from '../audio/sound-manager';

export interface ClientHandlerContext {
  // ── WebSocket Transport ──────────────────────────────────────────────────
  sendRequest<T extends WsMessage>(msg: T, timeoutMs?: number): Promise<WsMessage>;
  sendMessage<T extends WsMessage>(msg: T): void;
  rawSend(msg: WsMessage): void;

  // ── Generation Counters ──────────────────────────────────────────────────
  nextGeneration(category: string): number;
  isCurrentGeneration(category: string, gen: number): boolean;

  // ── UI / Notification ────────────────────────────────────────────────────
  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  readonly soundManager: SoundManager;

  // ── Renderer Access ──────────────────────────────────────────────────────
  getRenderer(): IsometricRenderer | null;
  getMapNavigationUI(): MapNavigationUI | null;

  // ── Session State (read/write) ───────────────────────────────────────────
  storedUsername: string;
  storedPassword: string;
  availableCompanies: CompanyInfo[];
  currentCompanyName: string;
  currentWorldName: string;
  currentZonePath: string;
  worldXSize: number | null;
  worldYSize: number | null;
  worldSeason: number | null;
  savedPlayerX: number | undefined;
  savedPlayerY: number | undefined;

  // ── Building Focus State ─────────────────────────────────────────────────
  currentFocusedBuilding: BuildingFocusInfo | null;
  currentFocusedVisualClass: string | null;
  currentTycoonData: {
    cash: string;
    incomePerHour: string;
    ranking: number;
    buildingCount: number;
    maxBuildings: number;
  } | null;

  // ── Building Construction State ──────────────────────────────────────────
  buildingCategories: BuildingCategory[];
  lastLoadedFacilities: BuildingInfo[];
  /** Session cache of the build menu lists, keyed by `${cluster}/${kind}` (T1: one read per category). */
  buildingFacilitiesCache: Map<string, BuildingInfo[]>;
  currentBuildingToPlace: BuildingInfo | null;
  currentBuildingXSize: number;
  currentBuildingYSize: number;
  overlayBeforePlacement: { type: 'zones' | 'overlay' | 'none'; overlay?: SurfaceType };

  // ── Double-click Prevention ──────────────────────────────────────────────
  isFocusingBuilding: boolean;
  isSendingChatMessage: boolean;
  isJoiningChannel: boolean;
  /** Last typing state announced to the server — keeps the notice to transitions. */
  isTypingInChat: boolean;
  isSelectingCompany: boolean;

  // ── Road Building State ──────────────────────────────────────────────────
  isRoadBuildingMode: boolean;
  isBuildingRoad: boolean;
  isRoadDemolishMode: boolean;

  // ── Zone Painting State ──────────────────────────────────────────────────
  isZonePaintingMode: boolean;
  selectedZoneType: number;

  // ── Overlay State ────────────────────────────────────────────────────────
  isCityZonesEnabled: boolean;
  activeOverlayType: SurfaceType | null;

  // ── Speculative Prefetch ─────────────────────────────────────────────────
  speculativeBuildingDetails: Map<string, Promise<BuildingDetailsResponse | null>>;
  speculativeBuildingResolved: Map<string, BuildingDetailsResponse | null>;

  // ── Connect Mode ─────────────────────────────────────────────────────────
  isConnectMode: boolean;
  /** The source of the pending connection — the inspected building, or the picker's. */
  connectSourceBuilding: { x: number; y: number } | null;
  connectKeyboardHandler: ((e: KeyboardEvent) => void) | null;

  // ── Logout ───────────────────────────────────────────────────────────────
  isLoggingOut: boolean;

  // ── In-flight Dedup ──────────────────────────────────────────────────────
  inFlightBuildingDetails: Map<string, Promise<BuildingDetailsResponse | null>>;
  inFlightSetProperty: Map<string, Promise<boolean>>;

  // ── Cross-handler Methods ────────────────────────────────────────────────
  requestBuildingDetails(x: number, y: number, visualClass: string): Promise<BuildingDetailsResponse | null>;
  refreshBuildingDetails(x: number, y: number): Promise<void>;
  setBuildingProperty(x: number, y: number, propertyName: string, value: string, additionalParams?: Record<string, string>): Promise<boolean>;
  loadMapArea(x?: number, y?: number, w?: number, h?: number): void;
  loadAlignedMapArea(x: number, y: number, margin?: number): void;
  loadAlignedMapAreaForRect(x1: number, y1: number, x2: number, y2: number): void;
  fetchSurfaceForArea(surfaceType: SurfaceType, x1: number, y1: number, x2: number, y2: number): Promise<void>;
  toggleZoneOverlay(enabled: boolean, surfaceType: SurfaceType): void;
  cancelBuildingPlacement(): void;
  cancelRoadBuildingMode(): void;
  cancelRoadDemolishMode(): void;
  cancelZonePaintingMode(): void;
  requestUserList(): Promise<void>;
  focusBuilding(x: number, y: number, visualClass?: string): Promise<void>;
  loadResearchInventory(buildingX: number, buildingY: number, categoryIndex: number): void;

  // ── Game View Initialization ─────────────────────────────────────────────
  switchToGameView(): Promise<void>;
  preloadFacilityDimensions(): Promise<void>;
  connectMailService(): Promise<void>;
  getProfile(): Promise<void>;
  initChatChannels(): Promise<void>;
  sendCameraPositionNow(): void;
}
