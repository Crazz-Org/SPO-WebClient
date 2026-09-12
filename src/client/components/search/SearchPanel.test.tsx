import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { SearchPanel } from './SearchPanel';
import { WsMessageType } from '@/shared/types';
import type { TownInfo, RankingEntry } from '@/shared/types';
// Separate statement on purpose: the import header above is a frozen span for this change.
import { fireEvent } from '@testing-library/react';

const TOWN_BASE: TownInfo = {
  name: 'Helartia',
  iconUrl: '',
  mayor: null,
  population: 0,
  unemploymentPercent: 0,
  qualityOfLife: 0,
  x: 0,
  y: 0,
  path: '',
  classId: '',
};

function showTowns(towns: TownInfo[]): void {
  useSearchStore.setState({
    currentPage: 'towns',
    isLoading: false,
    townsData: { type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns },
  });
}

describe('SearchPanel — towns page', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.getState().reset();
  });

  it('names the mayor and the term when the ruler has served terms', () => {
    showTowns([{
      ...TOWN_BASE,
      iconUrl: 'http://158.69.153.134/five/icons/TownHall64.gif',
      mayor: 'SPO_test3',
      mayorTerm: 3,
      population: 12400,
      unemploymentPercent: 4,
      qualityOfLife: 71,
    }]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: SPO_test3 (Term 3)')).toBeTruthy();
    expect(screen.getByText('Pop: 12,400')).toBeTruthy();
    expect(screen.getByText('Unemployment: 4%')).toBeTruthy();
    expect(screen.getByText('QoL: 71%')).toBeTruthy();
  });

  it('names the mayor with no term on a world with no elections', () => {
    showTowns([{ ...TOWN_BASE, name: 'Nova Roma', mayor: 'Crazz', unemploymentPercent: 9 }]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: Crazz')).toBeTruthy();
    expect(screen.getByText('Unemployment: 9%')).toBeTruthy();
  });

  it('says "Mayor: none" rather than dropping the line for a town with no ruler', () => {
    showTowns([{ ...TOWN_BASE, name: 'Dunmore' }]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: none')).toBeTruthy();
  });

  it('renders the town icon when one is on the wire', () => {
    showTowns([{ ...TOWN_BASE, iconUrl: 'http://158.69.153.134/five/icons/TownHall64.gif' }]);

    const { container } = renderWithProviders(<SearchPanel />);

    const img = container.querySelector('.listItemHeader img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('http://158.69.153.134/five/icons/TownHall64.gif');
  });

  it('falls back to the generic building glyph when no icon came through', () => {
    showTowns([{ ...TOWN_BASE }]);

    const { container } = renderWithProviders(<SearchPanel />);

    expect(container.querySelector('.listItemHeader img')).toBeNull();
    expect(container.querySelector('.listItemHeader svg')).not.toBeNull();
  });

  it('shows the empty state for a world with no towns', () => {
    showTowns([]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('No towns found.')).toBeTruthy();
  });
});

const RANKING_ENTRIES: RankingEntry[] = [
  { rank: 1, name: 'Alpha', valueText: '$7,000,000', photoUrl: '/api/image?u=alpha' },
  { rank: 2, name: 'Beta', valueText: '$6,000,000', photoUrl: '/api/image?u=beta' },
  { rank: 3, name: 'Gamma', valueText: '$5,000,000' },
  { rank: 4, name: 'Delta', valueText: '$4,000' },
  { rank: 5, name: 'Epsilon', valueText: '$3,000' },
  { rank: 6, name: 'Zeta', valueText: '$2,000' },
  { rank: 7, name: 'Eta', valueText: '$7,000' },
];

function showRanking(entries: RankingEntry[], title = 'Wealth Ranking'): void {
  useSearchStore.setState({
    currentPage: 'rankings',
    isLoading: false,
    rankingDetailData: {
      type: WsMessageType.RESP_SEARCH_MENU_RANKING_DETAIL,
      title,
      entries,
    },
  });
}

describe('SearchPanel — ranking detail', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.getState().reset();
  });

  it('shows every rank the server sent — a podium of three and the whole tail', () => {
    showRanking(RANKING_ENTRIES);

    const { container } = renderWithProviders(<SearchPanel />);

    expect(container.querySelectorAll('.podiumCard')).toHaveLength(3);
    expect(container.querySelectorAll('.rankingRow')).toHaveLength(4);
    expect(screen.getByText('Wealth Ranking')).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('Eta')).toBeTruthy();
  });

  it('prints the currency string the server sent, for both podium and tail', () => {
    showRanking(RANKING_ENTRIES);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('$7,000,000')).toBeTruthy();
    expect(screen.getByText('$7,000')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders the podium photo when one is on the wire', () => {
    showRanking(RANKING_ENTRIES);

    const { container } = renderWithProviders(<SearchPanel />);

    const img = container.querySelector('.podiumCard img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/api/image?u=alpha');
  });

  it('falls back to the placeholder when a podium photo fails to load', () => {
    showRanking(RANKING_ENTRIES);

    const { container } = renderWithProviders(<SearchPanel />);

    const img = container.querySelector('.podiumCard img')!;
    fireEvent.error(img);

    expect(container.querySelectorAll('.podiumCard img')).toHaveLength(1);
    expect(container.querySelectorAll('.profilePhotoPlaceholder')).toHaveLength(2);
  });

  it('renders the placeholder directly for a podium entry with no photo', () => {
    showRanking([RANKING_ENTRIES[2]]);

    const { container } = renderWithProviders(<SearchPanel />);

    expect(container.querySelector('.podiumCard img')).toBeNull();
    expect(container.querySelector('.profilePhotoPlaceholder')).not.toBeNull();
  });

  it('shows the server\'s own message for a ranking with no entries', () => {
    showRanking([]);

    const { container } = renderWithProviders(<SearchPanel />);

    expect(screen.getByText('There is no relevant performance to highlight in this area.')).toBeTruthy();
    expect(container.querySelector('.podium')).toBeNull();
  });

  it('omits the podium when the server sent only tail ranks', () => {
    showRanking(RANKING_ENTRIES.slice(3));

    const { container } = renderWithProviders(<SearchPanel />);

    expect(container.querySelector('.podium')).toBeNull();
    expect(container.querySelectorAll('.rankingRow')).toHaveLength(4);
  });

  it('goes back to the category list when the back link is clicked', () => {
    showRanking(RANKING_ENTRIES);

    renderWithProviders(<SearchPanel />);
    fireEvent.click(screen.getByText('← Back to rankings'));

    expect(useSearchStore.getState().rankingDetailData).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// People page — the A-Z index beside the typed search
// ---------------------------------------------------------------------------

import { createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import type { PeopleQuery } from '../../store/search-store';

function showPeople(results: string[], peopleQuery: PeopleQuery | null = null): void {
  useSearchStore.setState({
    currentPage: 'people',
    isLoading: false,
    peopleData: { type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH, results },
    peopleQuery,
  });
}

describe('SearchPanel — people page', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.getState().reset();
  });

  it('renders the whole alphabet, A first and Z last', () => {
    showPeople([]);

    const { container } = renderWithProviders(<SearchPanel />);

    const letters = container.querySelectorAll('.letterBtn');
    expect(letters).toHaveLength(26);
    expect(letters[0].textContent).toBe('A');
    expect(letters[25].textContent).toBe('Z');
  });

  it('clicking a letter searches that bucket by prefix, with nothing typed', () => {
    showPeople([]);
    const calls: unknown[][] = [];
    const callbacks = createSpiedCallbacks({
      onSearchMenuPeopleSearch: (...args: unknown[]) => { calls.push(args); },
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });
    fireEvent.click(screen.getByText('C'));

    expect(calls).toEqual([['C', 'prefix']]);
    const state = useSearchStore.getState();
    expect(state.peopleQuery).toEqual({ mode: 'prefix', term: 'C' });
    expect(state.isLoading).toBe(true);
  });

  it('a typed term still searches by contains', () => {
    showPeople([]);
    const calls: unknown[][] = [];
    const callbacks = createSpiedCallbacks({
      onSearchMenuPeopleSearch: (...args: unknown[]) => { calls.push(args); },
    });

    const { container } = renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });
    const input = container.querySelector('.searchInput') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Crazz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(calls).toEqual([['Crazz', 'contains']]);
    expect(useSearchStore.getState().peopleQuery).toEqual({ mode: 'contains', term: 'Crazz' });
  });

  it('a letter nobody matches says so instead of the type-something placeholder', () => {
    showPeople([], { mode: 'prefix', term: 'Q' });

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('No players whose name starts with Q.')).toBeTruthy();
    expect(screen.queryByText('Search for people by name.')).toBeNull();
  });

  it('keeps the placeholder before any search has been made', () => {
    showPeople([]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Search for people by name.')).toBeTruthy();
  });

  it('a prefix result opens the tycoon card, same as a typed result', () => {
    showPeople(['Crazz'], { mode: 'prefix', term: 'C' });
    const opened: unknown[] = [];
    const callbacks = createSpiedCallbacks({
      onSearchMenuTycoonProfile: (name: unknown) => { opened.push(name); },
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });
    fireEvent.click(screen.getByText('Crazz'));

    expect(opened).toEqual(['Crazz']);
    expect(useSearchStore.getState().currentPage).toBe('tycoon-profile');
  });
});
