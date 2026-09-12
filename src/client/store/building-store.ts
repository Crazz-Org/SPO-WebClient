/**
 * Building Store — Focused building state, details, and inspection data.
 */

import { create } from 'zustand';
import type {
  BuildingFocusInfo,
  BuildingDetailsResponse,
  BuildingSupplyData,
  BuildingProductData,
  ConnectionSearchResult,
  ResearchCategoryData,
  ResearchInventionDetails,
} from '@/shared/types';
import { registerInspectorTabs, isGateTab } from '@/shared/building-details';

interface ResearchState {
  /** Cached inventory per category tab (key = categoryIndex 0..4). */
  inventoryByCategory: Map<number, ResearchCategoryData>;
  /** Currently viewed category tab index (0..4). */
  activeCategoryIndex: number;
  /** Tab labels from research.0.dat (e.g. ["GENERAL","COMMERCE",...]). */
  categoryTabs: string[];
  /** Which categories have been fetched at least once. */
  loadedCategories: Set<number>;
  /** Selected invention (shared across tabs). */
  selectedInventionId: string | null;
  selectedDetails: ResearchInventionDetails | null;
  isLoadingInventory: boolean;
  isLoadingDetails: boolean;
}

/** Tracks an in-flight SET command (optimistic feedback). */
interface PendingUpdate {
  value: string;
  timestamp: number;
}

/** Tracks a failed SET command (revert + error display). */
interface FailedUpdate {
  originalValue: string;
  error: string;
  timestamp: number;
}

/**
 * How much the gateway could actually vouch for a write that came back
 * `success: true`.
 *
 * `'confirmed'` — the server was re-read and holds the value the write would
 * have produced. `'unconfirmed'` — the command went out and nothing came back
 * to contradict it, which is all that can be said when the member is a Pascal
 * `procedure` answering nothing, when its witness property reads the same
 * either way (`cnxCount` after a connect), or when the object cache has not
 * refreshed yet (OB-29).
 *
 * OB-1: the two used to render identically — a green tick — so a connection the
 * server discarded looked exactly like one it made.
 */
export type WriteVerdict = 'confirmed' | 'unconfirmed';

/** Tracks a recently settled SET command (success feedback). */
interface ConfirmedUpdate {
  timestamp: number;
  verdict: WriteVerdict;
}

/** Loading state for lazy tab data. */
type TabLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** The two tabs whose rows are gates loaded one at a time. */
export type GateTabId = 'supplies' | 'products';

/**
 * Key for the per-gate maps below. A gate is identified by its tab and its
 * Delphi path; the path is what the server needs to SetPath onto it, and it is
 * stable across a tab reload, which the array index is not.
 */
export function gateKey(tabId: GateTabId, path: string): string {
  return `${tabId}:${path}`;
}

/**
 * Forget the per-gate memo of the given tabs.
 *
 * A gate's load state means "these rows were read and are on screen", and it is
 * true only for as long as those rows are there. Every path that re-lists a
 * gate tab replaces them with headers carrying `connections: []`, so the memo
 * has to go with them: one left behind reads as "already loaded" over an empty
 * list, the gate is never read again, and the panel says "No suppliers
 * connected" about a gate it never asked about.
 */
function forgetGateStates(
  states: Record<string, TabLoadState>,
  tabIds: readonly string[],
): Record<string, TabLoadState> {
  if (tabIds.length === 0) return states;
  const next: Record<string, TabLoadState> = {};
  for (const [key, value] of Object.entries(states)) {
    if (!tabIds.some((id) => key.startsWith(`${id}:`))) next[key] = value;
  }
  return next;
}

/** The gate tabs a response re-lists — the ones whose rows it replaces. */
function relistedGateTabs(data: {
  supplies?: unknown;
  products?: unknown;
}): GateTabId[] {
  const tabs: GateTabId[] = [];
  if (data.supplies !== undefined) tabs.push('supplies');
  if (data.products !== undefined) tabs.push('products');
  return tabs;
}

interface BuildingState {
  // Focus
  focusedBuilding: BuildingFocusInfo | null;

  // Overlay mode — first click shows overlay, second click opens panel
  isOverlayMode: boolean;

  // Details panel
  details: BuildingDetailsResponse | null;
  currentTab: string;
  /**
   * The section id the user last opened, or `null` after they closed the
   * drawer (or no section has been opened yet this play session).
   *
   * Deliberately survives `clearFocus` and `clearDetails`: it is a
   * play-session preference, not part of one facility's focus state. Only an
   * explicit close (`setCurrentTab('')`) or `forgetSection` (logout) clears it.
   */
  rememberedSection: string | null;
  isLoading: boolean;
  detailsError: string | null;

  // Lazy tab loading states (keyed by tab special id: 'supplies', 'products', etc.)
  tabLoadingStates: Record<string, TabLoadState>;

  /**
   * Per-gate connection-row loading states, keyed by {@link gateKey}.
   *
   * Opening the Supplies or Products tab loads gate HEADERS only; the rows of
   * one gate are read when the user expands it. This map is the memo that stops
   * a second expand from re-reading them, mirroring `Info.Loaded` in the
   * reference client (Voyager/ProdSheetForm.pas:464).
   */
  gateLoadingStates: Record<string, TabLoadState>;

  /**
   * Which gates the user has open, keyed by {@link gateKey}.
   *
   * Lives here rather than in the card because the card unmounts whenever the
   * tab data is replaced — an auto-refresh would otherwise silently collapse
   * every open gate and throw away the rows just fetched for it.
   */
  expandedGates: Set<string>;

  // Ownership context (set by client.ts when showing panel)
  currentCompanyName: string;
  /** All company names owned by the logged-in tycoon (for cross-company ownership). */
  ownedCompanyNames: Set<string>;
  isOwner: boolean;

  // Optimistic SET feedback
  pendingUpdates: Map<string, PendingUpdate>;
  failedUpdates: Map<string, FailedUpdate>;
  confirmedUpdates: Map<string, ConfirmedUpdate>;

  // Connection picker state
  connectionPicker: {
    fluidName: string;
    fluidId: string;
    direction: 'input' | 'output';
    buildingX: number;
    buildingY: number;
    results: ConnectionSearchResult[];
    isSearching: boolean;
  } | null;

  // Research state
  research: ResearchState | null;

  // Actions
  setFocus: (info: BuildingFocusInfo) => void;
  setOverlayMode: (mode: boolean) => void;
  setDetails: (details: BuildingDetailsResponse) => void;
  setCurrentTab: (tab: string) => void;
  forgetSection: () => void;
  setLoading: (loading: boolean) => void;
  setDetailsError: (error: string | null) => void;
  setCurrentCompanyName: (name: string) => void;
  setOwnedCompanyNames: (names: Set<string>) => void;
  clearFocus: () => void;
  clearDetails: () => void;
  clearOverlay: () => void;
  setConnectionPicker: (data: { fluidName: string; fluidId: string; direction: 'input' | 'output'; buildingX: number; buildingY: number }) => void;
  setConnectionResults: (results: ConnectionSearchResult[]) => void;
  setConnectionSearching: (searching: boolean) => void;
  clearConnectionPicker: () => void;

  // Lazy tab loading actions
  setTabLoading: (tabId: string) => void;
  mergeTabData: (tabId: string, data: Partial<BuildingDetailsResponse>, forX: number, forY: number) => void;
  resetTabLoadingStates: () => void;
  invalidateTabs: (tabIds: readonly string[]) => void;

  // Lazy gate loading actions
  setGateLoading: (tabId: GateTabId, path: string) => void;
  setGateError: (tabId: GateTabId, path: string) => void;
  mergeGateData: (
    tabId: GateTabId,
    path: string,
    gate: BuildingSupplyData | BuildingProductData,
    forX: number,
    forY: number,
  ) => void;
  toggleGateExpanded: (tabId: GateTabId, path: string) => void;

  // Optimistic SET actions
  setPending: (key: string, value: string) => void;
  confirmPending: (key: string, verdict: WriteVerdict) => void;
  failPending: (key: string, originalValue: string, error: string) => void;
  clearFailed: (key: string) => void;
  clearConfirmed: (key: string) => void;

  // In-flight action tracking (disables buttons while processing)
  inFlightActions: Set<string>;
  addInFlightAction: (actionId: string) => void;
  removeInFlightAction: (actionId: string) => void;

  // Research actions
  setResearchCategoryTabs: (tabs: string[]) => void;
  setResearchInventory: (data: ResearchCategoryData) => void;
  setResearchSelectedInvention: (inventionId: string | null) => void;
  setResearchDetails: (details: ResearchInventionDetails) => void;
  setResearchActiveCategoryIndex: (index: number) => void;
  setResearchLoading: (field: 'inventory' | 'details', loading: boolean) => void;
  clearResearch: () => void;
}

const INITIAL_RESEARCH: ResearchState = {
  inventoryByCategory: new Map(),
  activeCategoryIndex: 0,
  categoryTabs: [],
  loadedCategories: new Set(),
  selectedInventionId: null,
  selectedDetails: null,
  isLoadingInventory: false,
  isLoadingDetails: false,
};

export const useBuildingStore = create<BuildingState>((set) => ({
  focusedBuilding: null,
  isOverlayMode: false,
  details: null,
  currentTab: 'overview',
  rememberedSection: null,
  isLoading: false,
  detailsError: null,
  currentCompanyName: '',
  ownedCompanyNames: new Set<string>(),
  isOwner: false,

  // Lazy tab loading
  tabLoadingStates: {},
  gateLoadingStates: {},
  expandedGates: new Set<string>(),

  // Optimistic SET feedback
  pendingUpdates: new Map(),
  failedUpdates: new Map(),
  confirmedUpdates: new Map(),

  // In-flight action tracking
  inFlightActions: new Set<string>(),

  setFocus: (info) => set({ focusedBuilding: info }),

  setOverlayMode: (mode) => set({ isOverlayMode: mode }),

  setDetails: (details) => {
    // Guard against malformed responses that would crash the render tree.
    // Missing tabs/groups indicate a corrupted or incomplete server response.
    if (!details.tabs || !details.groups) {
      set({ detailsError: 'Received malformed building data', isLoading: false });
      return;
    }
    // Lazily populate the client-side template cache from the server-sent tab config.
    // The server sends handlerName for each tab; HANDLER_TO_GROUP maps those to property
    // group definitions (with TABLE, SLIDER, etc. types) that the renderer needs.
    if (details.tabs.length) {
      registerInspectorTabs(
        details.visualClass,
        details.tabs.map((t) => ({ tabName: t.name, tabHandler: t.handlerName })),
        details.templateName,
      );
    }
    set((state) => {
      const ownerName = details.ownerName || state.focusedBuilding?.ownerName || '';
      const isSameBuilding = state.details?.x === details.x && state.details?.y === details.y;

      // Auto-mark lazy tabs as 'loaded' if the legacy path already fetched their data.
      // This prevents the lazy useEffect from re-fetching data that's already present.
      const preloaded: Record<string, TabLoadState> = {};
      if (details.supplies?.length) preloaded['supplies'] = 'loaded';
      if (details.products?.length) preloaded['products'] = 'loaded';
      if (details.compInputs?.length) preloaded['compInputs'] = 'loaded';
      if (details.warehouseWares?.length) preloaded['whGeneral'] = 'loaded';
      // A response carries only the groups it was asked for — the opening read
      // carries the header group alone. Marking those loaded is what tells the
      // panel it owes the server nothing for them; every other section stays
      // unmarked and is read when its menu entry is opened.
      for (const groupId of Object.keys(details.groups)) {
        // A GATE is loaded by its own read, never by a property group that happens to
        // share its name. The server no longer publishes one, and this is the second
        // line: a group key must never settle `supplies` / `products` / `compInputs`,
        // or the gate read is skipped and the tab stays empty forever.
        if (isGateTab(groupId)) continue;
        preloaded[groupId] = 'loaded';
      }

      // Carry forward lazy tab data when refreshing the same building.
      // EVENT_BUILDING_REFRESH sends basic details (products/supplies/warehouseWares
      // undefined). Without this merge, the UI shows empty tabs because
      // tabLoadingStates still says 'loaded' but the data is gone.
      const mergedDetails = isSameBuilding ? {
        ...details,
        // Carry forward name/owner when refresh returns empty strings
        // (refreshBuildingProperties skips SwitchFocusEx when already focused)
        buildingName: details.buildingName || state.details?.buildingName || '',
        ownerName: details.ownerName || state.details?.ownerName || '',
        supplies: details.supplies ?? state.details?.supplies,
        products: details.products ?? state.details?.products,
        compInputs: details.compInputs ?? state.details?.compInputs,
        warehouseWares: details.warehouseWares ?? state.details?.warehouseWares,
        // Sections the user already opened survive a header-only refresh. They
        // keep their values on screen while the panel re-reads them, instead of
        // blanking to a skeleton every thirty seconds.
        groups: { ...state.details?.groups, ...details.groups },
      } : details;

      return {
        details: mergedDetails,
        isLoading: false,
        detailsError: null,
        isOwner: ownerName !== '' && state.ownedCompanyNames.has(ownerName),
        tabLoadingStates: isSameBuilding
          ? { ...state.tabLoadingStates, ...preloaded }
          : preloaded,
        // The per-gate memo follows the rows. A response that carries a gate
        // list carries it freshly listed — headers, no connections — so the
        // gates it re-lists are no longer read. One that carries none (the
        // header-only refresh) leaves the rows alone, and the memo with them.
        gateLoadingStates: isSameBuilding
          ? forgetGateStates(state.gateLoadingStates, relistedGateTabs(details))
          : {},
        // Clear optimistic feedback when switching to a different building
        // to prevent phantom SaveIndicator from cross-building leaks
        ...(isSameBuilding ? {} : {
          // Gate paths are building-relative: `SegA` on one facility is `SegA`
          // on the next, so a memo kept across the switch would answer for the
          // wrong building — and an open gate would stay open on it.
          expandedGates: new Set<string>(),
          pendingUpdates: new Map(),
          failedUpdates: new Map(),
          confirmedUpdates: new Map(),
        }),
        // Restore the remembered section on a different facility, if it has
        // one — otherwise leave currentTab exactly as clearDetails/clearFocus
        // already put it (the menu for a standard facility, the first civic
        // tab for a civic one).
        ...(!isSameBuilding
          && state.rememberedSection
          && details.tabs.some((t) => t.id === state.rememberedSection)
          ? { currentTab: state.rememberedSection }
          : {}),
      };
    });
  },

  setCurrentTab: (tab) => set({ currentTab: tab, rememberedSection: tab || null }),

  forgetSection: () => set({ rememberedSection: null }),

  setLoading: (loading) => set({ isLoading: loading, ...(loading ? { detailsError: null } : {}) }),

  setDetailsError: (error) => set({ detailsError: error, isLoading: false }),

  setCurrentCompanyName: (name) =>
    set((state) => {
      const ownerName = state.details
        ? (state.details.ownerName || state.focusedBuilding?.ownerName || '')
        : '';
      return {
        currentCompanyName: name,
        isOwner: ownerName !== '' && state.ownedCompanyNames.has(ownerName),
      };
    }),

  setOwnedCompanyNames: (names) =>
    set((state) => {
      const ownerName = state.details
        ? (state.details.ownerName || state.focusedBuilding?.ownerName || '')
        : '';
      return {
        ownedCompanyNames: names,
        isOwner: ownerName !== '' && names.has(ownerName),
      };
    }),

  clearFocus: () =>
    set({
      focusedBuilding: null,
      isOverlayMode: false,
      details: null,
      currentTab: 'overview',
      isLoading: false,
      detailsError: null,
      isOwner: false,
      research: null,
      tabLoadingStates: {},
      gateLoadingStates: {},
      expandedGates: new Set<string>(),
      pendingUpdates: new Map(),
      failedUpdates: new Map(),
      confirmedUpdates: new Map(),
      connectionPicker: null,
      inFlightActions: new Set<string>(),
    }),

  clearDetails: () =>
    set({
      details: null,
      currentTab: 'overview',
      isLoading: true,
      detailsError: null,
      isOwner: false,
      research: null,
      tabLoadingStates: {},
      gateLoadingStates: {},
      expandedGates: new Set<string>(),
      pendingUpdates: new Map(),
      failedUpdates: new Map(),
      confirmedUpdates: new Map(),
      connectionPicker: null,
      inFlightActions: new Set<string>(),
    }),

  clearOverlay: () => set({ isOverlayMode: false }),

  addInFlightAction: (actionId) =>
    set((state) => {
      const next = new Set(state.inFlightActions);
      next.add(actionId);
      return { inFlightActions: next };
    }),

  removeInFlightAction: (actionId) =>
    set((state) => {
      const next = new Set(state.inFlightActions);
      next.delete(actionId);
      return { inFlightActions: next };
    }),

  // Lazy tab loading actions
  setTabLoading: (tabId) =>
    set((state) => ({
      tabLoadingStates: { ...state.tabLoadingStates, [tabId]: 'loading' as TabLoadState },
    })),

  mergeTabData: (tabId, data, forX, forY) =>
    set((state) => {
      if (!state.details) return state;
      // Reject stale data from a previously inspected building
      if (state.details.x !== forX || state.details.y !== forY) return state;
      return {
        details: {
          ...state.details,
          ...(data.supplies !== undefined ? { supplies: data.supplies } : {}),
          ...(data.products !== undefined ? { products: data.products } : {}),
          ...(data.compInputs !== undefined ? { compInputs: data.compInputs } : {}),
          ...(data.warehouseWares !== undefined ? { warehouseWares: data.warehouseWares } : {}),
          // Property groups arrive one section at a time now, so they MERGE
          // rather than replace: the response carries only the groups that
          // section asked for, and the ones already on screen must survive it.
          ...(data.groups !== undefined
            ? { groups: { ...state.details.groups, ...data.groups } }
            : {}),
        },
        tabLoadingStates: { ...state.tabLoadingStates, [tabId]: 'loaded' as TabLoadState },
        // Same rule as `setDetails`: a re-listed gate tab arrives with its rows
        // stripped, so the memo that said they were read goes with them.
        gateLoadingStates: forgetGateStates(state.gateLoadingStates, relistedGateTabs(data)),
      };
    }),

  // Mark specific lazy tabs as needing a re-fetch, without wiping their current
  // data. `resetTabLoadingStates` is the big hammer for an explicit refresh: it
  // blanks every lazy tab, which is right when the whole panel reloads and wrong
  // after a targeted mutation, where blanking makes the panel flash empty before
  // the same data comes back. Here the stale rows stay on screen until
  // `mergeTabData` replaces them.
  //
  // Clearing the load state is the whole point: `requestTabData` returns early
  // for a tab already marked 'loaded' (building-action-handler.ts:161), so
  // without this a connection change can never be re-read.
  invalidateTabs: (tabIds) =>
    set((state) => {
      const next = { ...state.tabLoadingStates };
      for (const id of tabIds) delete next[id];

      // The per-gate memo has to go with it. Its whole job is to stop a second
      // read of rows already held, and after a connection change those rows are
      // exactly what is wrong — leaving the memo would freeze an open gate on
      // the list it had before the mutation.
      return { tabLoadingStates: next, gateLoadingStates: forgetGateStates(state.gateLoadingStates, tabIds) };
    }),

  resetTabLoadingStates: () => set((state) => ({
    tabLoadingStates: {},
    // Gate rows go with the tab data they belong to. `expandedGates` does not:
    // the gates the user opened survive the refresh and re-read themselves.
    gateLoadingStates: {},
    // Wipe lazy tab data so stale values aren't carried forward by setDetails
    // after an explicit refresh. The lazy useEffect will re-fetch from scratch.
    details: state.details ? {
      ...state.details,
      supplies: undefined,
      products: undefined,
      compInputs: undefined,
      warehouseWares: undefined,
    } : null,
  })),

  setGateLoading: (tabId, path) =>
    set((state) => ({
      gateLoadingStates: {
        ...state.gateLoadingStates,
        [gateKey(tabId, path)]: 'loading' as TabLoadState,
      },
    })),

  setGateError: (tabId, path) =>
    set((state) => ({
      gateLoadingStates: {
        ...state.gateLoadingStates,
        [gateKey(tabId, path)]: 'error' as TabLoadState,
      },
    })),

  // Replace one gate in place. Same staleness guard as `mergeTabData`: a gate
  // read can land after the user moved to another building, and the shared
  // Delphi temp object means the answer may even describe the new one.
  //
  // A gate whose path is no longer in the list is dropped rather than appended
  // — that means the tab reloaded under the request (a warehouse ware was
  // switched off, say), and the reply describes a gate the panel no longer has.
  mergeGateData: (tabId, path, gate, forX, forY) =>
    set((state) => {
      if (!state.details) return state;
      if (state.details.x !== forX || state.details.y !== forY) return state;

      const key = gateKey(tabId, path);
      const list = tabId === 'supplies' ? state.details.supplies : state.details.products;
      const index = list?.findIndex((g) => g.path === path) ?? -1;
      if (!list) {
        // The tab holds no list at all: it is being re-listed under the request
        // (`resetTabLoadingStates` wipes the rows before the re-read), and the
        // reply has nowhere to go. Nothing was stored, so nothing may be marked
        // read — a 'loaded' with no rows behind it is what renders an unread
        // gate as "No suppliers connected", and it blocks the re-read that
        // would correct it. The gate is not on screen either, so clearing the
        // mark cannot spin: the row that asks comes back with the list.
        const cleared = { ...state.gateLoadingStates };
        delete cleared[key];
        return { gateLoadingStates: cleared };
      }
      if (index === -1) {
        // The list is there but no longer holds this gate — a warehouse ware
        // switched off, say. Nothing to merge and nothing on screen to ask
        // again, so the mark stops a ghost from being chased. It cannot go
        // stale: the next re-list of this tab drops it with every other.
        return { gateLoadingStates: { ...state.gateLoadingStates, [key]: 'loaded' as TabLoadState } };
      }

      const next = list.slice();
      next[index] = gate as (typeof next)[number];

      return {
        details: {
          ...state.details,
          ...(tabId === 'supplies'
            ? { supplies: next as BuildingSupplyData[] }
            : { products: next as BuildingProductData[] }),
        },
        gateLoadingStates: { ...state.gateLoadingStates, [key]: 'loaded' as TabLoadState },
      };
    }),

  // Collapsing does NOT drop the rows or the 'loaded' mark: re-opening the same
  // gate should cost nothing, which is the whole point of the memo.
  //
  // Re-opening a gate whose read FAILED does clear the mark, and that is the
  // retry: the loader treats 'error' as terminal so a broken gate cannot spin
  // on every render, which leaves closing and re-opening as the way back.
  toggleGateExpanded: (tabId, path) =>
    set((state) => {
      const key = gateKey(tabId, path);
      const next = new Set(state.expandedGates);
      const opening = !next.delete(key);
      if (opening) next.add(key);

      if (opening && state.gateLoadingStates[key] === 'error') {
        const nextGates = { ...state.gateLoadingStates };
        delete nextGates[key];
        return { expandedGates: next, gateLoadingStates: nextGates };
      }
      return { expandedGates: next };
    }),

  // Optimistic SET actions
  setPending: (key, value) =>
    set((state) => {
      const next = new Map(state.pendingUpdates);
      next.set(key, { value, timestamp: Date.now() });
      // Clear any previous failure for this key
      const nextFailed = new Map(state.failedUpdates);
      nextFailed.delete(key);
      return { pendingUpdates: next, failedUpdates: nextFailed };
    }),

  // The verdict is a required argument on purpose (OB-1): a call site that does
  // not know whether the write landed must say so, not default to a tick.
  confirmPending: (key, verdict) =>
    set((state) => {
      const nextPending = new Map(state.pendingUpdates);
      nextPending.delete(key);
      const nextConfirmed = new Map(state.confirmedUpdates);
      nextConfirmed.set(key, { timestamp: Date.now(), verdict });
      return { pendingUpdates: nextPending, confirmedUpdates: nextConfirmed };
    }),

  failPending: (key, originalValue, error) =>
    set((state) => {
      const nextPending = new Map(state.pendingUpdates);
      nextPending.delete(key);
      const nextFailed = new Map(state.failedUpdates);
      nextFailed.set(key, { originalValue, error, timestamp: Date.now() });
      return { pendingUpdates: nextPending, failedUpdates: nextFailed };
    }),

  clearFailed: (key) =>
    set((state) => {
      const next = new Map(state.failedUpdates);
      next.delete(key);
      return { failedUpdates: next };
    }),

  clearConfirmed: (key) =>
    set((state) => {
      const next = new Map(state.confirmedUpdates);
      next.delete(key);
      return { confirmedUpdates: next };
    }),

  // Connection picker
  connectionPicker: null,

  setConnectionPicker: (data) =>
    set({ connectionPicker: { ...data, results: [], isSearching: false } }),

  setConnectionResults: (results) =>
    set((state) => ({
      connectionPicker: state.connectionPicker
        ? { ...state.connectionPicker, results, isSearching: false }
        : null,
    })),

  setConnectionSearching: (searching) =>
    set((state) => ({
      connectionPicker: state.connectionPicker
        ? { ...state.connectionPicker, isSearching: searching }
        : null,
    })),

  clearConnectionPicker: () => set({ connectionPicker: null }),

  // Research
  research: null,

  setResearchCategoryTabs: (tabs) =>
    set((state) => ({
      research: {
        ...(state.research ?? INITIAL_RESEARCH),
        categoryTabs: tabs,
      },
    })),

  setResearchInventory: (data) =>
    set((state) => {
      // Reject stale data if building was cleared or research not yet initialized
      if (!state.details || !state.research) return state;
      const prev = state.research;
      const nextMap = new Map(prev.inventoryByCategory);
      nextMap.set(data.categoryIndex, data);
      const nextLoaded = new Set(prev.loadedCategories);
      nextLoaded.add(data.categoryIndex);
      return {
        research: {
          ...prev,
          inventoryByCategory: nextMap,
          loadedCategories: nextLoaded,
          isLoadingInventory: false,
        },
      };
    }),

  setResearchSelectedInvention: (inventionId) =>
    set((state) => ({
      research: {
        ...(state.research ?? INITIAL_RESEARCH),
        selectedInventionId: inventionId,
        selectedDetails: null,
      },
    })),

  setResearchDetails: (details) =>
    set((state) => {
      // Reject stale data if building was cleared or research not yet initialized
      if (!state.details || !state.research) return state;
      return {
        research: {
          ...state.research,
          selectedDetails: details,
          isLoadingDetails: false,
        },
      };
    }),

  setResearchActiveCategoryIndex: (index) =>
    set((state) => ({
      research: {
        ...(state.research ?? INITIAL_RESEARCH),
        activeCategoryIndex: index,
        selectedInventionId: null,
        selectedDetails: null,
      },
    })),

  setResearchLoading: (field, loading) =>
    set((state) => ({
      research: {
        ...(state.research ?? INITIAL_RESEARCH),
        [field === 'inventory' ? 'isLoadingInventory' : 'isLoadingDetails']: loading,
      },
    })),

  clearResearch: () => set({ research: null }),
}));
