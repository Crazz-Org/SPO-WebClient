import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
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

describe('SearchPanel — towns page opens the town directory (#526)', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.getState().reset();
  });

  const HELARTIA: TownInfo = {
    ...TOWN_BASE,
    x: 120,
    y: 340,
    path: 'Towns\\Helartia.five',
    classId: '1234',
  };

  it('opens the town page rather than jumping the map', () => {
    showTowns([HELARTIA]);
    const onSearchMenuDirectory = jest.fn();
    const onNavigateToBuilding = jest.fn();
    const { container } = renderWithProviders(<SearchPanel />, {
      clientCallbacks: createSpiedCallbacks({
        onSearchMenuDirectory: onSearchMenuDirectory as never,
        onNavigateToBuilding: onNavigateToBuilding as never,
      }),
    });

    fireEvent.click(container.querySelector('.listItemTitle')!);

    const expected = { kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' };
    expect(onSearchMenuDirectory).toHaveBeenCalledWith(expected);
    expect(onNavigateToBuilding).not.toHaveBeenCalled();
    expect(useSearchStore.getState().currentPage).toBe('directory');
    expect(useSearchStore.getState().directoryStack).toEqual([{ ref: expected, page: null }]);
  });

  it('still jumps the map from the row action, without opening the town', () => {
    showTowns([HELARTIA]);
    const onSearchMenuDirectory = jest.fn();
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<SearchPanel />, {
      clientCallbacks: createSpiedCallbacks({
        onSearchMenuDirectory: onSearchMenuDirectory as never,
        onNavigateToBuilding: onNavigateToBuilding as never,
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
    expect(onSearchMenuDirectory).not.toHaveBeenCalled();
    expect(useSearchStore.getState().currentPage).toBe('towns');
  });

  it('walks the directory descent one level at a time on Back, then leaves it', () => {
    showTowns([HELARTIA]);
    useSearchStore.getState().pushDirectory({ kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' });
    useSearchStore.getState().pushDirectory({ kind: 'town-facilities', town: 'Helartia' });
    useSearchStore.setState({ isLoading: false });

    renderWithProviders(<SearchPanel />);
    fireEvent.click(screen.getByText('← Back'));

    expect(useSearchStore.getState().currentPage).toBe('directory');
    expect(useSearchStore.getState().directoryStack).toHaveLength(1);

    fireEvent.click(screen.getByText('← Back'));

    expect(useSearchStore.getState().currentPage).toBe('towns');
  });
});
