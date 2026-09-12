/**
 * Game Store — Central reactive state for connection, tycoon stats, and settings.
 * Panel navigation is now in ui-store.ts.
 */

import { create } from 'zustand';
import type { CompanyInfo, WorldInfo, ClusterInfo, ClusterFacilityPreview, LoginPageOutcome, WorldAdmission } from '@/shared/types';
import { SurfaceType } from '@/shared/types/domain-types';

/* ---- Utilities ---- */

/** Delphi TDateTime epoch: Dec 30, 1899. TDateTime is days since epoch as a float. */
const DELPHI_EPOCH_MS = new Date(1899, 11, 30).getTime();

export function delphiTDateTimeToJsDate(dDate: number): Date {
  return new Date(DELPHI_EPOCH_MS + dDate * 86_400_000);
}

/* ---- Types ---- */

export interface TycoonStats {
  username: string;
  cash: string;
  incomePerHour: string;
  ranking: number;
  buildingCount: number;
  maxBuildings: number;
  prestige?: number;
  levelName?: string;
  levelTier?: number;
  nobPoints?: number;
  area?: number;
  /** 0 = nominal, 1 = warning (debt), 2 = alert (near bankruptcy) */
  failureLevel?: number;
}

export type MinimapSize = 'small' | 'medium' | 'large';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'connected';

export type DisconnectReason = 'connection_lost' | 'session_expired' | null;

export type ServiceStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ServerStartupState {
  ready: boolean;
  progress: number;
  message: string;
  services: Array<{ name: string; status: ServiceStatus; progress: number; subStep?: string }>;
  cacheSteps?: Array<{ name: string; label: string; status: 'pending' | 'running' | 'complete' }>;
}

export interface MapLoadingState {
  active: boolean;
  progress: number;
  message: string;
}

export interface GameSettings {
  isVegetationHiddenOnMove: boolean;
  vehicleAnimations: boolean;
  isSoundEnabled: boolean;
  soundVolume: number;
  isDebugOverlay: boolean;
  minimapSize: MinimapSize;
}

const DEFAULT_SETTINGS: GameSettings = {
  isVegetationHiddenOnMove: false,
  vehicleAnimations: true,
  isSoundEnabled: true,
  soundVolume: 0.5,
  isDebugOverlay: false,
  minimapSize: 'medium',
};

/* ---- Store ---- */

interface GameState {
  // Connection
  status: ConnectionStatus;
  disconnectReason: DisconnectReason;
  username: string;
  /**
   * The player's own tycoon id, decimal, from `WsRespLoginSuccess.tycoonId`.
   *
   * This is what Voyager calls the client's SecurityId — `getSecurityId` is
   * literally `IntToStr(integer(fTycoonId))`
   * (`Voyager/URLHandlers/ServerCnxHandler.pas:2524-2527`). It is the requester
   * half of `grantAccess`, which is how a civic control decides whether the
   * player governs *this* facility rather than merely holding office somewhere.
   */
  tycoonId: string;
  worldName: string;
  companyName: string;
  companyId: string;
  reconnectAttempt: number;

  // World data
  companies: CompanyInfo[];

  // Tycoon stats (updated by EVENT_TYCOON_UPDATE)
  tycoonStats: TycoonStats | null;

  // Timestamp of the last tycoonStats update from the server (epoch ms)
  lastStatsUpdate: number | null;

  // Cash history for sparkline (last 12 values)
  cashHistory: number[];

  // Game date (from server RefreshDate push)
  gameDate: Date | null;

  // Company switching
  isSwitchingCompany: boolean;

  // Tool modes
  isRoadBuildingMode: boolean;
  isRoadDemolishMode: boolean;
  isZonePaintingMode: boolean;
  selectedZoneType: number;
  isPublicOfficeRole: boolean;
  ownerRole: string;

  // Overlays
  isCityZonesEnabled: boolean;
  /** What a map mode (placement, zone painting) hid to show Zones — null outside a mode or when Zones was already on (T8). */
  overlayBeforeMode: { type: 'zones' | 'overlay' | 'none'; overlay?: SurfaceType } | null;
  activeOverlay: SurfaceType | null;

  // Login flow
  loginWorlds: WorldInfo[];
  loginStage: 'auth' | 'zones' | 'worlds' | 'companies';
  loginLoading: boolean;
  authError: { code: number; message: string } | null;
  /** Set when logonComplete.asp redirected to logonNoAccess.asp / logonError.asp instead of the company list. */
  loginPage: LoginPageOutcome | null;
  /** Set when CanJoinWorldEx said this player may not found a company in this world. */
  loginAdmission: WorldAdmission | null;

  // Server switch overlay (browse regions/worlds while in-game)
  serverSwitchMode: boolean;
  serverSwitchOriginWorld: string;

  // Company creation / cluster browsing
  companyCreationClusters: string[];
  clusterInfo: ClusterInfo | null;
  clusterInfoLoading: boolean;
  clusterFacilities: ClusterFacilityPreview[];
  clusterFacilitiesLoading: boolean;

  // Capitol location (from DirectoryMain.asp)
  capitolCoords: { x: number; y: number } | null;

  // Server startup progress (SSE-driven)
  serverStartup: ServerStartupState;

  // Map loading progress (company select → playable)
  mapLoading: MapLoadingState;

  // Settings
  settings: GameSettings;

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setDisconnectReason: (reason: DisconnectReason) => void;
  setReconnectAttempt: (attempt: number) => void;
  setCredentials: (username: string, tycoonId?: string) => void;
  setWorld: (worldName: string) => void;
  setCompany: (name: string, id: string) => void;
  setCompanies: (companies: CompanyInfo[]) => void;
  setSwitchingCompany: (switching: boolean) => void;
  setTycoonStats: (stats: TycoonStats) => void;
  setGameDate: (date: Date) => void;
  setRoadBuildingMode: (active: boolean) => void;
  setRoadDemolishMode: (active: boolean) => void;
  setZonePaintingMode: (active: boolean) => void;
  setSelectedZoneType: (zoneType: number) => void;
  setPublicOfficeRole: (isPublicOffice: boolean, role?: string) => void;
  setCityZonesEnabled: (enabled: boolean) => void;
  setOverlayBeforeMode: (v: { type: 'zones' | 'overlay' | 'none'; overlay?: SurfaceType } | null) => void;
  setActiveOverlay: (overlay: SurfaceType | null) => void;
  setLoginWorlds: (worlds: WorldInfo[]) => void;
  setLoginCompanies: (companies: CompanyInfo[], admission?: WorldAdmission | null) => void;
  setLoginStage: (stage: 'auth' | 'zones' | 'worlds' | 'companies') => void;
  setLoginLoading: (loading: boolean) => void;
  setAuthError: (error: { code: number; message: string } | null) => void;
  setLoginPage: (page: LoginPageOutcome | null) => void;
  setCompanyCreationClusters: (clusters: string[]) => void;
  setClusterInfo: (info: ClusterInfo | null) => void;
  setClusterInfoLoading: (loading: boolean) => void;
  setClusterFacilities: (facilities: ClusterFacilityPreview[]) => void;
  setClusterFacilitiesLoading: (loading: boolean) => void;
  setCapitolCoords: (coords: { x: number; y: number } | null) => void;
  setServerStartup: (partial: Partial<ServerStartupState>) => void;
  setMapLoading: (partial: Partial<MapLoadingState>) => void;
  updateSettings: (partial: Partial<GameSettings>) => void;
  enterServerSwitch: () => void;
  cancelServerSwitch: () => void;
  completeServerSwitch: () => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  // Initial state
  status: 'disconnected',
  disconnectReason: null,
  username: '',
  tycoonId: '',
  worldName: '',
  companyName: '',
  companyId: '',
  reconnectAttempt: 0,
  companies: [],
  tycoonStats: null,
  lastStatsUpdate: null,
  cashHistory: [],
  gameDate: null,
  isSwitchingCompany: false,
  isRoadBuildingMode: false,
  isRoadDemolishMode: false,
  isZonePaintingMode: false,
  selectedZoneType: 2,
  isPublicOfficeRole: false,
  ownerRole: '',
  isCityZonesEnabled: false,
  overlayBeforeMode: null,
  activeOverlay: null,
  loginWorlds: [],
  loginStage: 'auth',
  loginLoading: false,
  authError: null,
  loginPage: null,
  loginAdmission: null,
  serverSwitchMode: false,
  serverSwitchOriginWorld: '',
  companyCreationClusters: [],
  clusterInfo: null,
  clusterInfoLoading: false,
  clusterFacilities: [],
  clusterFacilitiesLoading: false,
  capitolCoords: null,
  settings: { ...DEFAULT_SETTINGS },
  serverStartup: { ready: false, progress: 0, message: 'Connecting...', services: [] },
  mapLoading: { active: false, progress: 0, message: '' },
  // Actions
  setStatus: (status) => set({ status, ...(status === 'connected' ? { disconnectReason: null } : {}) }),
  setDisconnectReason: (reason) => set({ disconnectReason: reason }),
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  setCredentials: (username, tycoonId) =>
    set(tycoonId === undefined ? { username } : { username, tycoonId }),
  setWorld: (worldName) => set({ worldName }),
  setCompany: (name, id) => set({ companyName: name, companyId: id }),
  setCompanies: (companies) => set({ companies }),
  setSwitchingCompany: (switching) => set({ isSwitchingCompany: switching }),

  setTycoonStats: (stats) => set((state) => {
    const cashNum = parseFloat(stats.cash.replace(/[^0-9.-]/g, ''));
    const prev = state.cashHistory;
    const next = Number.isFinite(cashNum)
      ? [...prev.slice(-(12 - 1)), cashNum]
      : prev;
    return { tycoonStats: stats, lastStatsUpdate: Date.now(), cashHistory: next };
  }),
  setGameDate: (date) => set({ gameDate: date }),

  setRoadBuildingMode: (active) => set({ isRoadBuildingMode: active }),
  setRoadDemolishMode: (active) => set({ isRoadDemolishMode: active }),
  setZonePaintingMode: (active) => set({ isZonePaintingMode: active }),
  setSelectedZoneType: (zoneType) => set({ selectedZoneType: zoneType }),
  setPublicOfficeRole: (isPublicOffice, role) => set({ isPublicOfficeRole: isPublicOffice, ownerRole: role ?? '' }),
  setCityZonesEnabled: (enabled) => set({ isCityZonesEnabled: enabled }),
  setOverlayBeforeMode: (v) => set({ overlayBeforeMode: v }),
  setActiveOverlay: (overlay) => set({ activeOverlay: overlay }),

  setLoginWorlds: (worlds) => set({ loginWorlds: worlds, loginStage: 'worlds', loginLoading: false }),
  setLoginCompanies: (companies, admission) => set({ companies, loginStage: 'companies', loginLoading: false, loginPage: null, loginAdmission: admission ?? null }),
  setLoginStage: (stage) => set({ loginStage: stage }),
  setLoginLoading: (loading) => set({ loginLoading: loading }),
  setAuthError: (error) => set({ authError: error }),
  setLoginPage: (page) => set({ loginPage: page, companies: [], loginStage: 'companies', loginLoading: false, loginAdmission: null }),

  setCompanyCreationClusters: (clusters) => set({ companyCreationClusters: clusters }),
  setClusterInfo: (info) => set({ clusterInfo: info, clusterInfoLoading: false }),
  setClusterInfoLoading: (loading) => set({ clusterInfoLoading: loading }),
  setClusterFacilities: (facilities) => set({ clusterFacilities: facilities, clusterFacilitiesLoading: false }),
  setClusterFacilitiesLoading: (loading) => set({ clusterFacilitiesLoading: loading }),

  setCapitolCoords: (coords) => set({ capitolCoords: coords }),

  setServerStartup: (partial) =>
    set((state) => ({ serverStartup: { ...state.serverStartup, ...partial } })),

  setMapLoading: (partial) =>
    set((state) => ({ mapLoading: { ...state.mapLoading, ...partial } })),

  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  enterServerSwitch: () =>
    set((state) => ({
      serverSwitchMode: true,
      serverSwitchOriginWorld: state.worldName,
      loginStage: 'zones' as const,
      loginLoading: false,
    })),

  cancelServerSwitch: () =>
    set({
      serverSwitchMode: false,
      serverSwitchOriginWorld: '',
      loginStage: 'auth' as const,
    }),

  completeServerSwitch: () =>
    set({
      serverSwitchMode: false,
      serverSwitchOriginWorld: '',
    }),

  reset: () =>
    set({
      status: 'disconnected',
      disconnectReason: null,
      username: '',
      tycoonId: '',
      worldName: '',
      companyName: '',
      companyId: '',
      reconnectAttempt: 0,
      companies: [],
      tycoonStats: null,
      lastStatsUpdate: null,
      cashHistory: [],
      gameDate: null,
      isSwitchingCompany: false,
      isRoadBuildingMode: false,
      isRoadDemolishMode: false,
      isZonePaintingMode: false,
      selectedZoneType: 2,
      isPublicOfficeRole: false,
      ownerRole: '',
      isCityZonesEnabled: false,
  overlayBeforeMode: null,
      loginWorlds: [],
      loginStage: 'auth',
      loginLoading: false,
      authError: null,
      loginPage: null,
      loginAdmission: null,
      serverSwitchMode: false,
      serverSwitchOriginWorld: '',
      companyCreationClusters: [],
      clusterInfo: null,
      clusterInfoLoading: false,
      capitolCoords: null,
      clusterFacilities: [],
      clusterFacilitiesLoading: false,
    }),
}));
