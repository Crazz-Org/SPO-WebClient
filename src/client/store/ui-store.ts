/**
 * UI Store — Panel visibility, modal state, command palette, and mobile navigation.
 * Controls what UI surfaces are visible at any moment.
 */

import { create } from 'zustand';
import type { BuildingCategory, BuildingInfo } from '@/shared/types';
import { ALL_CONNECTION_ROLES, type ConnectionRoleFlags } from '@/shared/connection-roles';
import { useBuildingStore } from './building-store';
import { useGameStore } from './game-store';
import type { SnapPoint } from '../hooks/useSheetGesture';
import { isDialogSuppressed, type DialogKind, type DialogRow } from '../components/common/Dialog';

/**
 * How a confirmation is asked. `kind` picks the initial focus (safe action for a
 * destruction, primary for a spend) and the danger styling; `typeToConfirm` keeps the typed
 * guard the demolish flow uses; `rows` show cost / cash-after lines; `dontAskAgainKey` lets a
 * repeated spend opt out for the session (never honoured for a destructive dialog).
 */
export interface ConfirmOptions {
  kind?: DialogKind;
  rows?: DialogRow[];
  confirmLabel?: string;
  cancelLabel?: string;
  typeToConfirm?: string | null;
  dontAskAgainKey?: string;
}

export type RightPanelType = 'building' | 'mail' | 'politics' | 'search';
export type LeftPanelType = 'empire' | 'facilities' | 'overlays';

/**
 * The universal sheet (doc/ux/handoff/00-socle.md §3) shows ONE stack of surfaces. Pushing
 * never destroys what is underneath — that is the whole point: opening a supplier search
 * from a building, or a town hall from the politics page, stacks a chip the player can
 * return to. `rightPanel` / `leftPanel` are kept as DERIVED read-only views of the top of
 * the stack so the components written against them keep working while they migrate.
 */
export type SurfaceKind = RightPanelType | LeftPanelType | 'build' | 'supplierSearch' | 'map';

/** Remembered supplier-search filters (T3, B4): a player usually searches several fluids in a row. */
export interface ConnectionFilters {
  company: string;
  town: string;
  maxResults: string;
  roles: ConnectionRoleFlags;
}
export const DEFAULT_CONNECTION_FILTERS: ConnectionFilters = {
  company: '', town: '', maxResults: '50',
  roles: ALL_CONNECTION_ROLES,
};
export interface Surface {
  kind: SurfaceKind;
  /** Free-form parameters the content reads (e.g. a tab to open, a fluid id). */
  params?: Record<string, unknown>;
}

const RIGHT_KINDS: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['building', 'mail', 'politics', 'search']);
const LEFT_KINDS: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['empire', 'facilities', 'overlays']);
// 'build' is neither a legacy right nor left panel; it only lives in the stack.

/** The legacy panel fields, derived from the top of the stack. */
function legacyView(stack: Surface[]): { rightPanel: RightPanelType | null; leftPanel: LeftPanelType | null } {
  const top = stack[stack.length - 1];
  if (!top) return { rightPanel: null, leftPanel: null };
  return {
    rightPanel: RIGHT_KINDS.has(top.kind) ? (top.kind as RightPanelType) : null,
    leftPanel: LEFT_KINDS.has(top.kind) ? (top.kind as LeftPanelType) : null,
  };
}
export type ModalType = 'buildMenu' | 'settings' | 'confirm' | 'prompt' | 'createCompany' | 'connectionPicker' | 'zonePicker' | 'supplierSearch' | 'buildingInspector' | 'newspaper' | 'changelog';
export type MobileTab = 'map' | 'chat' | 'build' | 'more';

interface UiState {
  // Surfaces — the universal sheet's stack (source of truth)
  stack: Surface[];
  /** When pinned, clicking another building on the map stacks it instead of replacing the root. */
  pinned: boolean;

  // Panels — DERIVED from `stack` (top surface); read-only for callers
  rightPanel: RightPanelType | null;
  leftPanel: LeftPanelType | null;

  // Modals (overlay everything)
  modal: ModalType | null;
  /**
   * The modal a prompt or a confirm was opened *over*, restored when it closes.
   *
   * `modal` holds one value, so asking the president for a name used to replace
   * the civic inspector outright: it unmounted, and closing the prompt left no
   * inspector at all. Naming three ministers meant three trips back through the
   * map. Only `requestPrompt` / `requestConfirm` stack — they are the only
   * modals raised from inside another one.
   */
  modalBeneath: ModalType | null;
  /** Payload for confirmation dialogs */
  confirmPayload: { title: string; message: string; onConfirm: () => void; options?: ConfirmOptions } | null;
  /** Payload for text-input prompt dialogs */
  promptPayload: { title: string; message: string; placeholder?: string; defaultValue?: string; onSubmit: (value: string) => void } | null;

  // Build menu data
  buildMenuCategories: BuildingCategory[];
  buildMenuFacilities: BuildingInfo[];
  capitolIconUrl: string;

  // Command palette
  commandPaletteOpen: boolean;

  // Mobile
  mobileTab: MobileTab;
  mobileSheetSnap: SnapPoint;

  // Minimap fullscreen (mobile)
  minimapFullscreen: boolean;

  // Placement mode (building placement on map)
  isPlacingBuilding: boolean;
  placementValid: boolean;
  /** What is being placed — the mode bar shows its name and cost (handoff 00 §4.2). */
  placingFacility: { name: string; cost: number } | null;
  connectionFilters: ConnectionFilters;

  /**
   * Connect mode (N10) — the map is picking a building to connect. While it
   * runs the sheet stack is HIDDEN, never destroyed: the picker (and the
   * inspector under it) come back exactly as they were when the mode ends.
   * `subject` is what the pick is for (a fluid name, or the source building).
   */
  connectMode: { active: boolean; subject: string };

  // Actions — Surfaces
  /** Push a surface on top (never replaces). No-op if the top already is that kind+params. */
  pushSurface: (surface: Surface) => void;
  /** Remove the top surface. */
  popSurface: () => void;
  /** Return to the surface at index i (chips in the sheet header). */
  popToSurface: (index: number) => void;
  /** Replace the whole stack with one surface (a fresh open from the HUD). */
  setRootSurface: (surface: Surface) => void;
  /** Replace only the top surface (same place in the stack). */
  replaceTopSurface: (surface: Surface) => void;
  clearSurfaces: () => void;
  setPinned: (pinned: boolean) => void;
  /** Open the building surface the way the sheet wants it: fresh root, or stacked when pinned. */
  openBuildingSurface: () => void;
  /** Open (or close when already shown) the Build surface. */
  toggleBuildSurface: () => void;
  /** The Map surface (Carte): M / the Map tile — close if on top, else open as root. */
  toggleMapSurface: () => void;

  // Actions — Panels (legacy wrappers over the stack; kept for existing callers)
  openRightPanel: (type: RightPanelType) => void;
  closeRightPanel: () => void;
  toggleRightPanel: (type: RightPanelType) => void;
  openLeftPanel: (type: LeftPanelType) => void;
  closeLeftPanel: () => void;
  toggleLeftPanel: (type: LeftPanelType) => void;
  closeAllPanels: () => void;

  // Actions — Modals
  openModal: (type: ModalType) => void;
  closeModal: () => void;
  requestConfirm: (title: string, message: string, onConfirm: () => void, options?: ConfirmOptions) => void;
  requestPrompt: (title: string, message: string, onSubmit: (value: string) => void, options?: { placeholder?: string; defaultValue?: string }) => void;

  // Actions — Build menu data
  setBuildMenuCategories: (cats: BuildingCategory[], capitolIconUrl?: string) => void;
  setBuildMenuFacilities: (facs: BuildingInfo[]) => void;
  clearBuildMenuData: () => void;

  // Actions — Command palette
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Actions — Mobile
  setMobileTab: (tab: MobileTab) => void;
  setMobileSheetSnap: (snap: SnapPoint) => void;

  // Actions — Minimap fullscreen
  setMinimapFullscreen: (open: boolean) => void;
  toggleMinimapFullscreen: () => void;

  // Actions — Placement
  setIsPlacingBuilding: (v: boolean) => void;
  setPlacementValid: (v: boolean) => void;
  setPlacingFacility: (f: { name: string; cost: number } | null) => void;
  setConnectionFilters: (f: ConnectionFilters) => void;
  setConnectMode: (active: boolean, subject?: string) => void;

  // Actions — Escape (close topmost layer)
  dismissTopmost: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  rightPanel: null,
  leftPanel: null,
  modal: null,
  modalBeneath: null,
  confirmPayload: null,
  promptPayload: null,
  stack: [],
  pinned: false,
  buildMenuCategories: [],
  buildMenuFacilities: [],
  capitolIconUrl: '',
  commandPaletteOpen: false,
  mobileTab: 'map',
  mobileSheetSnap: 'half' as SnapPoint,
  minimapFullscreen: false,
  isPlacingBuilding: false,
  placementValid: false,
  placingFacility: null,
  connectionFilters: DEFAULT_CONNECTION_FILTERS,
  connectMode: { active: false, subject: '' },

  // Surfaces — one stack; the legacy panel fields follow its top
  pushSurface: (surface) => {
    const stack = get().stack;
    const top = stack[stack.length - 1];
    if (top && top.kind === surface.kind && JSON.stringify(top.params ?? {}) === JSON.stringify(surface.params ?? {})) return;
    const next = [...stack, surface];
    set({ stack: next, ...legacyView(next) });
  },
  popSurface: () => {
    const next = get().stack.slice(0, -1);
    set({ stack: next, ...legacyView(next) });
  },
  popToSurface: (index) => {
    const next = get().stack.slice(0, Math.max(0, index) + 1);
    set({ stack: next, ...legacyView(next) });
  },
  setRootSurface: (surface) => {
    const next = [surface];
    set({ stack: next, ...legacyView(next) });
  },
  replaceTopSurface: (surface) => {
    const stack = get().stack;
    const next = stack.length ? [...stack.slice(0, -1), surface] : [surface];
    set({ stack: next, ...legacyView(next) });
  },
  clearSurfaces: () => set({ stack: [], ...legacyView([]) }),
  setPinned: (pinned) => set({ pinned }),
  toggleBuildSurface: () => {
    const top = get().stack[get().stack.length - 1];
    if (top?.kind === 'build') get().clearSurfaces();
    else get().setRootSurface({ kind: 'build' });
  },
  toggleMapSurface: () => {
    const top = get().stack[get().stack.length - 1];
    if (top?.kind === 'map') get().clearSurfaces();
    else get().setRootSurface({ kind: 'map' });
  },
  openBuildingSurface: () => {
    const { pinned, stack } = get();
    if (pinned && stack.length > 0) get().pushSurface({ kind: 'building' });
    else get().setRootSurface({ kind: 'building' });
  },

  // Legacy panel API — thin wrappers. "open" = fresh root (what the HUD buttons mean),
  // "close" = clear, "toggle" = close if it is already on top.
  openRightPanel: (type) => get().setRootSurface({ kind: type }),
  closeRightPanel: () => get().clearSurfaces(),
  toggleRightPanel: (type) => {
    if (get().rightPanel === type) get().clearSurfaces();
    else get().setRootSurface({ kind: type });
  },
  openLeftPanel: (type) => get().setRootSurface({ kind: type }),
  closeLeftPanel: () => get().clearSurfaces(),
  toggleLeftPanel: (type) => {
    if (get().leftPanel === type) get().clearSurfaces();
    else get().setRootSurface({ kind: type });
  },
  closeAllPanels: () => get().clearSurfaces(),

  // Modals
  openModal: (type) => {
    // Civic building modal replaces the right-panel building inspector
    if (type === 'buildingInspector') {
      set({ modal: type, stack: [], ...legacyView([]) });
    } else {
      set({ modal: type });
    }
  },
  // Closing a stacked prompt returns to whatever it was raised over, not to
  // nothing. `modalBeneath` is null for every ordinary modal, so this stays a
  // plain close in every other case.
  closeModal: () => set((s) => ({
    modal: s.modalBeneath,
    modalBeneath: null,
    confirmPayload: null,
    promptPayload: null,
  })),
  requestConfirm: (title, message, onConfirm, options) => {
    // A spend the player opted out of for the session does not ask again (Dialog §2.8).
    if (options?.dontAskAgainKey && isDialogSuppressed(options.dontAskAgainKey)) {
      onConfirm();
      return;
    }
    set((s) => ({
      modal: 'confirm',
      modalBeneath: s.modal === 'confirm' || s.modal === 'prompt' ? s.modalBeneath : s.modal,
      confirmPayload: { title, message, onConfirm, options },
    }));
  },
  requestPrompt: (title, message, onSubmit, options) =>
    set((s) => ({
      modal: 'prompt',
      modalBeneath: s.modal === 'confirm' || s.modal === 'prompt' ? s.modalBeneath : s.modal,
      promptPayload: { title, message, onSubmit, ...options },
    })),

  // Build menu data
  setBuildMenuCategories: (cats, capitolIconUrl) => set({ buildMenuCategories: cats, ...(capitolIconUrl ? { capitolIconUrl } : {}) }),
  setBuildMenuFacilities: (facs) => set({ buildMenuFacilities: facs }),
  clearBuildMenuData: () => set({ buildMenuCategories: [], buildMenuFacilities: [] }),

  // Command palette
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  // Mobile
  setMobileTab: (tab) => set({ mobileTab: tab }),
  setMobileSheetSnap: (snap) => set({ mobileSheetSnap: snap }),

  // Minimap fullscreen
  setMinimapFullscreen: (open) => set({ minimapFullscreen: open }),
  toggleMinimapFullscreen: () => set((s) => ({ minimapFullscreen: !s.minimapFullscreen })),

  // Placement
  setIsPlacingBuilding: (v) => set({ isPlacingBuilding: v }),
  setPlacementValid: (v) => set({ placementValid: v }),
  setPlacingFacility: (f) => set({ placingFacility: f }),
  setConnectionFilters: (f) => set({ connectionFilters: f }),
  setConnectMode: (active, subject = '') => set({ connectMode: { active, subject } }),

  // Escape — dismiss topmost layer in priority order
  dismissTopmost: () => {
    const state = get();
    // Connect mode owns Escape: its own listener cancels the mode and reveals
    // the hidden stack — popping a surface the player cannot see would be worse.
    if (state.connectMode.active) return;
    if (state.minimapFullscreen) {
      set({ minimapFullscreen: false });
    } else if (state.commandPaletteOpen) {
      set({ commandPaletteOpen: false });
    } else {
      // Server switch overlay sits at z-450 (above modals z-400)
      const gameState = useGameStore.getState();
      if (gameState.serverSwitchMode) {
        const canCancel = (gameState.loginStage === 'zones' || gameState.loginStage === 'worlds')
          && !gameState.loginLoading;
        if (canCancel) {
          gameState.cancelServerSwitch();
          return;
        }
      }
      if (state.modal) {
        // Escape dismisses one layer. On a stacked prompt that means returning
        // to the inspector underneath, not closing both and losing the focus.
        if (state.modalBeneath) {
          set({ modal: state.modalBeneath, modalBeneath: null, confirmPayload: null, promptPayload: null });
          return;
        }
        if (state.modal === 'buildingInspector') {
          useBuildingStore.getState().clearFocus();
        }
        set({ modal: null, confirmPayload: null, promptPayload: null });
      } else if (state.stack.length > 0) {
        // Escape unstacks one surface — a supplier search returns to its building.
        get().popSurface();
      }
    }
  },
}));
