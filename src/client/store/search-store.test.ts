/**
 * Tests for search-store: tycoon profile state, navigation, and reset.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useSearchStore } from './search-store';
import { WsMessageType } from '@/shared/types';
import type { WsRespSearchMenuTycoonProfile, WsRespSearchMenuPeopleSearch, WsRespSearchMenuNewspapers } from '@/shared/types';

function resetStore() {
  useSearchStore.setState({
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
  });
}

describe('Search Store — tycoon profile', () => {
  beforeEach(resetStore);

  it('setTycoonProfileData stores data and clears loading', () => {
    useSearchStore.getState().setLoading(true);
    expect(useSearchStore.getState().isLoading).toBe(true);

    const mockProfile: WsRespSearchMenuTycoonProfile = {
      type: WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE,
      profile: {
        name: 'TestTycoon',
        photoUrl: '',
        fortune: 5000000,
        thisYearProfit: -100000,
        ntaRanking: '1st place.',
        level: 'Legend.',
        prestige: 100,
        profileUrl: '',
        companiesUrl: '',
      },
    };

    useSearchStore.getState().setTycoonProfileData(mockProfile);

    const state = useSearchStore.getState();
    expect(state.tycoonProfileData).toEqual(mockProfile);
    expect(state.isLoading).toBe(false);
  });

  it('navigateTo tycoon-profile pushes history and sets loading', () => {
    useSearchStore.getState().navigateTo('people');
    useSearchStore.getState().setLoading(false);

    useSearchStore.getState().navigateTo('tycoon-profile');

    const state = useSearchStore.getState();
    expect(state.currentPage).toBe('tycoon-profile');
    expect(state.pageHistory).toContain('people');
    expect(state.isLoading).toBe(true);
  });

  it('goBack from tycoon-profile returns to people page', () => {
    useSearchStore.getState().navigateTo('people');
    useSearchStore.getState().setLoading(false);
    useSearchStore.getState().navigateTo('tycoon-profile');
    useSearchStore.getState().setLoading(false);

    useSearchStore.getState().goBack();

    expect(useSearchStore.getState().currentPage).toBe('people');
  });

  it('reset clears tycoonProfileData', () => {
    const mockProfile: WsRespSearchMenuTycoonProfile = {
      type: WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE,
      profile: {
        name: 'TestTycoon', photoUrl: '', fortune: 0, thisYearProfit: 0,
        ntaRanking: 'N/A', level: 'Unknown', prestige: 0, profileUrl: '', companiesUrl: '',
      },
    };
    useSearchStore.getState().setTycoonProfileData(mockProfile);
    expect(useSearchStore.getState().tycoonProfileData).not.toBeNull();

    useSearchStore.getState().reset();

    expect(useSearchStore.getState().tycoonProfileData).toBeNull();
    expect(useSearchStore.getState().currentPage).toBe('home');
  });
});

describe('Search Store — people search', () => {
  beforeEach(resetStore);

  it('setPeopleData stores results and clears loading', () => {
    useSearchStore.getState().setLoading(true);

    const mockResults: WsRespSearchMenuPeopleSearch = {
      type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH,
      results: ['Alice', 'Bob', 'SPO_test3'],
    };

    useSearchStore.getState().setPeopleData(mockResults);

    const state = useSearchStore.getState();
    expect(state.peopleData?.results).toEqual(['Alice', 'Bob', 'SPO_test3']);
    expect(state.isLoading).toBe(false);
  });
});

describe('Search Store — media (newspaper directory)', () => {
  beforeEach(resetStore);

  it('setNewspapersData stores the payload and clears loading', () => {
    useSearchStore.getState().setLoading(true);

    const mockData: WsRespSearchMenuNewspapers = {
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      newspapers: [
        { paperName: 'Shamba Daily', townName: 'Shamba' },
        { paperName: 'Helartia Herald', townName: 'Helartia' },
      ],
    };

    useSearchStore.getState().setNewspapersData(mockData);

    const state = useSearchStore.getState();
    expect(state.newspapersData).toEqual(mockData);
    expect(state.isLoading).toBe(false);
  });

  it('reset nulls newspapersData', () => {
    useSearchStore.getState().setNewspapersData({
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      newspapers: [{ paperName: 'Shamba Daily', townName: 'Shamba' }],
    });
    expect(useSearchStore.getState().newspapersData).not.toBeNull();

    useSearchStore.getState().reset();

    expect(useSearchStore.getState().newspapersData).toBeNull();
  });
});
