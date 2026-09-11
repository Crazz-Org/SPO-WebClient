import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { SearchPanel } from './SearchPanel';
import { WsMessageType } from '@/shared/types';
import type { TownInfo } from '@/shared/types';

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
