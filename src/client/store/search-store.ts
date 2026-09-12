/**
 * Search Store — Directory search pages (home, towns, tycoons, rankings, banks, media).
 */

import { create } from 'zustand';
import type {
  WsRespSearchMenuHome,
  WsRespSearchMenuTowns,
  WsRespSearchMenuPeopleSearch,
  WsRespSearchMenuTycoonProfile,
  WsRespSearchMenuRankings,
  WsRespSearchMenuRankingDetail,
  WsRespSearchMenuBanks,
  WsRespSearchMenuNewspapers,
  DirectoryRef,
  DirectoryPage,
} from '@/shared/types';

export type SearchPage = 'home' | 'towns' | 'people' | 'rankings' | 'ranking-detail' | 'banks' | 'tycoon-profile' | 'media' | 'directory';

/** One level of the directory descent. `page` is null until the gateway answers. */
export interface DirectoryEntry {
  ref: DirectoryRef;
  page: DirectoryPage | null;
}

interface SearchState {
  // Navigation
  currentPage: SearchPage;
  pageHistory: SearchPage[];
  isLoading: boolean;

  // Page data
  homeData: WsRespSearchMenuHome | null;
  townsData: WsRespSearchMenuTowns | null;
  peopleData: WsRespSearchMenuPeopleSearch | null;
  rankingsData: WsRespSearchMenuRankings | null;
  rankingDetailData: WsRespSearchMenuRankingDetail | null;
  tycoonProfileData: WsRespSearchMenuTycoonProfile | null;
  banksData: WsRespSearchMenuBanks | null;
  newspapersData: WsRespSearchMenuNewspapers | null;

  /**
   * The directory descent, deepest last. The whole descent is one entry of `pageHistory`,
   * so `goBack` walks the stack before it leaves the directory.
   */
  directoryStack: DirectoryEntry[];

  // Actions
  navigateTo: (page: SearchPage) => void;
  goBack: () => void;
  setLoading: (loading: boolean) => void;
  setHomeData: (data: WsRespSearchMenuHome) => void;
  setTownsData: (data: WsRespSearchMenuTowns) => void;
  setPeopleData: (data: WsRespSearchMenuPeopleSearch) => void;
  setRankingsData: (data: WsRespSearchMenuRankings) => void;
  setRankingDetailData: (data: WsRespSearchMenuRankingDetail) => void;
  clearRankingDetail: () => void;
  setTycoonProfileData: (data: WsRespSearchMenuTycoonProfile) => void;
  setBanksData: (data: WsRespSearchMenuBanks) => void;
  setNewspapersData: (data: WsRespSearchMenuNewspapers) => void;
  pushDirectory: (ref: DirectoryRef) => void;
  setDirectoryPage: (ref: DirectoryRef, page: DirectoryPage) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  currentPage: 'home',
  pageHistory: [],
  isLoading: false,

  homeData: null,
  townsData: null,
  peopleData: null,
  rankingsData: null,
  rankingDetailData: null,
  tycoonProfileData: null,
  banksData: null,
  newspapersData: null,
  directoryStack: [],

  navigateTo: (page) =>
    set((state) => ({
      currentPage: page,
      pageHistory: [...state.pageHistory, state.currentPage],
      isLoading: true,
    })),

  goBack: () => {
    const { pageHistory: history, currentPage, directoryStack } = get();

    // Inside the directory, Back walks the descent first — the parent's page is still
    // held, so stepping up costs no round-trip.
    if (currentPage === 'directory' && directoryStack.length > 1) {
      set({ directoryStack: directoryStack.slice(0, -1), isLoading: false });
      return;
    }

    if (history.length === 0) return;
    const previous = history[history.length - 1];
    set({
      currentPage: previous,
      pageHistory: history.slice(0, -1),
      directoryStack: [],
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setHomeData: (data) => set({ homeData: data, isLoading: false }),
  setTownsData: (data) => set({ townsData: data, isLoading: false }),
  setPeopleData: (data) => set({ peopleData: data, isLoading: false }),
  setRankingsData: (data) => set({ rankingsData: data, isLoading: false }),
  setRankingDetailData: (data) => set({ rankingDetailData: data, isLoading: false }),
  clearRankingDetail: () => set({ rankingDetailData: null }),
  setTycoonProfileData: (data) => set({ tycoonProfileData: data, isLoading: false }),
  setBanksData: (data) => set({ banksData: data, isLoading: false }),
  setNewspapersData: (data) => set({ newspapersData: data, isLoading: false }),

  pushDirectory: (ref) =>
    set((state) => ({
      currentPage: 'directory',
      // The whole descent occupies one history slot: only the step that entered the
      // directory is remembered, the levels below it live on directoryStack.
      pageHistory: state.currentPage === 'directory'
        ? state.pageHistory
        : [...state.pageHistory, state.currentPage],
      directoryStack: [...state.directoryStack, { ref, page: null }],
      isLoading: true,
    })),

  setDirectoryPage: (ref, page) =>
    set((state) => {
      const top = state.directoryStack[state.directoryStack.length - 1];
      // The reply echoes the ref this client built, so a JSON round-trip preserves key
      // order. A reply for a level the user already left is dropped.
      if (!top || JSON.stringify(top.ref) !== JSON.stringify(ref)) {
        return { isLoading: false };
      }
      return {
        directoryStack: [...state.directoryStack.slice(0, -1), { ref: top.ref, page }],
        isLoading: false,
      };
    }),

  reset: () =>
    set({
      currentPage: 'home',
      pageHistory: [],
      isLoading: false,
      homeData: null,
      townsData: null,
      peopleData: null,
      rankingsData: null,
      rankingDetailData: null,
      tycoonProfileData: null,
      banksData: null,
      newspapersData: null,
      directoryStack: [],
    }),
}));
