/**
 * Tests for search-store: tycoon profile state, navigation, and reset.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useSearchStore } from './search-store';
import { WsMessageType } from '@/shared/types';
import type { WsRespSearchMenuTycoonProfile, WsRespSearchMenuPeopleSearch, WsRespSearchMenuNewspapers, DirectoryRef, DirectoryPage } from '@/shared/types';

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
    directoryStack: [],
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

describe('Search Store — directory descent', () => {
  beforeEach(resetStore);

  const townRef: DirectoryRef = { kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' };
  const facilitiesRef: DirectoryRef = { kind: 'town-facilities', town: 'Helartia' };
  const folderPage: DirectoryPage = { kind: 'folder', items: ['Residentials'], ownedBy: null };

  it('pushDirectory from towns switches page, stacks the ref and starts loading', () => {
    useSearchStore.getState().navigateTo('towns');
    useSearchStore.getState().setLoading(false);

    useSearchStore.getState().pushDirectory(townRef);

    const state = useSearchStore.getState();
    expect(state.currentPage).toBe('directory');
    expect(state.pageHistory).toEqual(['home', 'towns']);
    expect(state.directoryStack).toEqual([{ ref: townRef, page: null }]);
    expect(state.isLoading).toBe(true);
  });

  it('spends one history slot on the whole descent, however deep it goes', () => {
    useSearchStore.getState().navigateTo('towns');
    useSearchStore.getState().pushDirectory(townRef);
    useSearchStore.getState().pushDirectory(facilitiesRef);

    const state = useSearchStore.getState();
    expect(state.pageHistory).toEqual(['home', 'towns']);
    expect(state.directoryStack.map((e) => e.ref)).toEqual([townRef, facilitiesRef]);
  });

  it('setDirectoryPage fills the top entry and clears loading', () => {
    useSearchStore.getState().pushDirectory(facilitiesRef);

    useSearchStore.getState().setDirectoryPage(facilitiesRef, folderPage);

    const state = useSearchStore.getState();
    expect(state.directoryStack).toEqual([{ ref: facilitiesRef, page: folderPage }]);
    expect(state.isLoading).toBe(false);
  });

  it('drops a reply for a level the user already left', () => {
    useSearchStore.getState().pushDirectory(townRef);
    useSearchStore.getState().pushDirectory(facilitiesRef);

    useSearchStore.getState().setDirectoryPage(townRef, { kind: 'town', town: {
      name: 'Helartia', iconUrl: '', inhabitants: 0, qualityOfLife: 0, unemploymentPercent: 0, x: 0, y: 0,
    } });

    const state = useSearchStore.getState();
    expect(state.directoryStack.every((e) => e.page === null)).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('drops a reply that arrives with the stack already emptied', () => {
    useSearchStore.getState().setLoading(true);

    useSearchStore.getState().setDirectoryPage(facilitiesRef, folderPage);

    expect(useSearchStore.getState().directoryStack).toEqual([]);
    expect(useSearchStore.getState().isLoading).toBe(false);
  });

  it('goBack pops the descent before it leaves the directory', () => {
    useSearchStore.getState().navigateTo('towns');
    useSearchStore.getState().pushDirectory(townRef);
    useSearchStore.getState().pushDirectory(facilitiesRef);

    useSearchStore.getState().goBack();

    expect(useSearchStore.getState().currentPage).toBe('directory');
    expect(useSearchStore.getState().directoryStack.map((e) => e.ref)).toEqual([townRef]);

    useSearchStore.getState().goBack();

    expect(useSearchStore.getState().currentPage).toBe('towns');
    expect(useSearchStore.getState().directoryStack).toEqual([]);
  });

  it('reset empties the descent', () => {
    useSearchStore.getState().pushDirectory(townRef);
    expect(useSearchStore.getState().directoryStack).toHaveLength(1);

    useSearchStore.getState().reset();

    expect(useSearchStore.getState().directoryStack).toEqual([]);
    expect(useSearchStore.getState().currentPage).toBe('home');
  });
});
