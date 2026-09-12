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
  PeopleSearchMode,
} from '@/shared/types';

export type SearchPage = 'home' | 'towns' | 'people' | 'rankings' | 'ranking-detail' | 'banks' | 'tycoon-profile' | 'media';

/**
 * The people search currently on screen. It lives in the store rather than in
 * `PeoplePage` because `SearchPanel` unmounts the page component while
 * `isLoading` is true, which would wipe component state on every search.
 */
export interface PeopleQuery {
  mode: PeopleSearchMode;
  term: string;
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
  /** What the visible `peopleData` was asked for — `null` before any search. */
  peopleQuery: PeopleQuery | null;
  rankingsData: WsRespSearchMenuRankings | null;
  rankingDetailData: WsRespSearchMenuRankingDetail | null;
  tycoonProfileData: WsRespSearchMenuTycoonProfile | null;
  banksData: WsRespSearchMenuBanks | null;
  newspapersData: WsRespSearchMenuNewspapers | null;

  // Actions
  navigateTo: (page: SearchPage) => void;
  goBack: () => void;
  setLoading: (loading: boolean) => void;
  setHomeData: (data: WsRespSearchMenuHome) => void;
  setTownsData: (data: WsRespSearchMenuTowns) => void;
  setPeopleData: (data: WsRespSearchMenuPeopleSearch) => void;
  setPeopleQuery: (query: PeopleQuery) => void;
  setRankingsData: (data: WsRespSearchMenuRankings) => void;
  setRankingDetailData: (data: WsRespSearchMenuRankingDetail) => void;
  clearRankingDetail: () => void;
  setTycoonProfileData: (data: WsRespSearchMenuTycoonProfile) => void;
  setBanksData: (data: WsRespSearchMenuBanks) => void;
  setNewspapersData: (data: WsRespSearchMenuNewspapers) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  currentPage: 'home',
  pageHistory: [],
  isLoading: false,

  homeData: null,
  townsData: null,
  peopleData: null,
  peopleQuery: null,
  rankingsData: null,
  rankingDetailData: null,
  tycoonProfileData: null,
  banksData: null,
  newspapersData: null,

  navigateTo: (page) =>
    set((state) => ({
      currentPage: page,
      pageHistory: [...state.pageHistory, state.currentPage],
      isLoading: true,
    })),

  goBack: () => {
    const history = get().pageHistory;
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    set({
      currentPage: previous,
      pageHistory: history.slice(0, -1),
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setHomeData: (data) => set({ homeData: data, isLoading: false }),
  setTownsData: (data) => set({ townsData: data, isLoading: false }),
  setPeopleData: (data) => set({ peopleData: data, isLoading: false }),
  setPeopleQuery: (query) => set({ peopleQuery: query }),
  setRankingsData: (data) => set({ rankingsData: data, isLoading: false }),
  setRankingDetailData: (data) => set({ rankingDetailData: data, isLoading: false }),
  clearRankingDetail: () => set({ rankingDetailData: null }),
  setTycoonProfileData: (data) => set({ tycoonProfileData: data, isLoading: false }),
  setBanksData: (data) => set({ banksData: data, isLoading: false }),
  setNewspapersData: (data) => set({ newspapersData: data, isLoading: false }),

  reset: () =>
    set({
      currentPage: 'home',
      pageHistory: [],
      isLoading: false,
      homeData: null,
      townsData: null,
      peopleData: null,
      peopleQuery: null,
      rankingsData: null,
      rankingDetailData: null,
      tycoonProfileData: null,
      banksData: null,
      newspapersData: null,
    }),
}));
