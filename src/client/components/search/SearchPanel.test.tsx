import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { SearchPanel } from './SearchPanel';
import { WsMessageType } from '@/shared/types';
import type { TownInfo } from '@/shared/types';

const TOWNS: TownInfo[] = [
  {
    name: 'Helartia',
    iconUrl: 'http://x/five/icons/townhall.gif',
    mayor: 'SPO_test3',
    mayorTerm: 2,
    population: 12400,
    unemploymentPercent: 4,
    qualityOfLife: 71,
    x: 120,
    y: 340,
    path: 'Towns\\Helartia',
    classId: '1000',
  },
  {
    name: 'Nova Roma',
    iconUrl: '',
    mayor: 'Rio',
    population: 800,
    unemploymentPercent: 9,
    qualityOfLife: 40,
    x: 55,
    y: 66,
    path: 'Towns\\Nova Roma',
    classId: '1000',
  },
  {
    name: 'Dunmore',
    iconUrl: '',
    mayor: null,
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 10,
    y: 20,
    path: 'Towns\\Dunmore',
    classId: '1000',
  },
];

function showTowns(towns: TownInfo[]): void {
  useSearchStore.setState({
    currentPage: 'towns',
    pageHistory: ['home'],
    isLoading: false,
    townsData: { type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns },
  });
}

describe('SearchPanel — towns page', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.setState({ townsData: null });
  });

  it('names the mayor and the term served', () => {
    showTowns(TOWNS);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: SPO_test3 (Term 2)')).toBeTruthy();
  });

  it('names a mayor with no term on a world with no elections', () => {
    showTowns(TOWNS);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: Rio')).toBeTruthy();
  });

  it('says "none" rather than dropping the line for a town with no ruler', () => {
    showTowns(TOWNS);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('Mayor: none')).toBeTruthy();
  });

  it('shows the unemployment percentage already on the wire', () => {
    showTowns(TOWNS);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('UE: 4%')).toBeTruthy();
    expect(screen.getByText('UE: 9%')).toBeTruthy();
    expect(screen.getByText('UE: 0%')).toBeTruthy();
  });

  it('renders the town icon when the wire carried one, and only then', () => {
    showTowns(TOWNS);

    const { container } = renderWithProviders(<SearchPanel />);

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toContain('townhall.gif');
  });

  it('navigates the map to the town when its card is clicked', () => {
    showTowns(TOWNS);
    const calls: unknown[][] = [];
    const callbacks = createSpiedCallbacks({
      onNavigateToBuilding: (...args: unknown[]) => { calls.push(args); },
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });
    fireEvent.click(screen.getByText('Helartia'));

    expect(calls).toEqual([[120, 340]]);
  });

  it('shows the empty state for a world with no towns', () => {
    showTowns([]);

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('No towns found.')).toBeTruthy();
  });
});
