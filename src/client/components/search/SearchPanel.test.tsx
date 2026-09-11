import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { SearchPanel } from './SearchPanel';
import { WsMessageType } from '@/shared/types';
import type { WsRespSearchMenuHome, SearchMenuCategory } from '@/shared/types';

function fixture(categories: SearchMenuCategory[]): WsRespSearchMenuHome {
  return { type: WsMessageType.RESP_SEARCH_MENU_HOME, categories };
}

const SIX_CATEGORIES: SearchMenuCategory[] = [
  { id: 'capitol', label: 'Capitol', enabled: false },
  { id: 'Towns', label: 'Towns', enabled: true },
  { id: 'RenderTycoon', label: 'You', enabled: true },
  { id: 'Tycoons', label: 'Tycoons', enabled: true },
  { id: 'Rankings', label: 'Rankings', enabled: true },
  { id: 'Newspapers', label: 'Newspapers', enabled: true },
];

describe('SearchPanel — home grid', () => {
  beforeEach(() => {
    resetStores();
    useSearchStore.getState().reset();
  });

  it('renders six tiles, with the disabled Capitol dimmed and inert', () => {
    const onNavigateToBuilding = jest.fn();
    const callbacks = createSpiedCallbacks({ onNavigateToBuilding });
    useSearchStore.setState({
      homeData: fixture(SIX_CATEGORIES), currentPage: 'home', pageHistory: [], isLoading: false,
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });

    const capitolLabel = screen.getByText('Capitol');
    const capitolCard = capitolLabel.closest('[class*="categoryCard"]') as HTMLElement;
    expect(capitolCard.className).toContain('categoryCardDisabled');
    expect(capitolCard.getAttribute('role')).toBeNull();

    fireEvent.click(capitolCard);
    expect(onNavigateToBuilding).not.toHaveBeenCalled();

    const tiles = document.querySelectorAll('[class*="categoryCard"]');
    expect(tiles.length).toBe(6);
  });

  it('clicking an enabled Capitol tile calls onNavigateToBuilding with the parsed coordinates', () => {
    const onNavigateToBuilding = jest.fn();
    const callbacks = createSpiedCallbacks({ onNavigateToBuilding });
    const categories: SearchMenuCategory[] = [
      { id: 'local', label: 'Capitol', enabled: true, x: 220, y: 41 },
      ...SIX_CATEGORIES.slice(1),
    ];
    useSearchStore.setState({
      homeData: fixture(categories), currentPage: 'home', pageHistory: [], isLoading: false,
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Capitol'));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(220, 41);
  });

  it('clicking the You tile opens the tycoon profile with the special "YOU" name', () => {
    const onSearchMenuTycoonProfile = jest.fn();
    const callbacks = createSpiedCallbacks({ onSearchMenuTycoonProfile });
    useSearchStore.setState({
      homeData: fixture(SIX_CATEGORIES), currentPage: 'home', pageHistory: [], isLoading: false,
    });

    renderWithProviders(<SearchPanel />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('You'));

    expect(useSearchStore.getState().currentPage).toBe('tycoon-profile');
    expect(onSearchMenuTycoonProfile).toHaveBeenCalledWith('YOU');
  });

  it('clicking a page tile navigates to that page', () => {
    useSearchStore.setState({
      homeData: fixture(SIX_CATEGORIES), currentPage: 'home', pageHistory: [], isLoading: false,
    });

    renderWithProviders(<SearchPanel />);

    fireEvent.click(screen.getByText('Towns'));

    expect(useSearchStore.getState().currentPage).toBe('towns');
  });

  it('shows the empty state when the server sends no categories', () => {
    useSearchStore.setState({
      homeData: fixture([]), currentPage: 'home', pageHistory: [], isLoading: false,
    });

    renderWithProviders(<SearchPanel />);

    expect(screen.getByText('No directory categories.')).toBeTruthy();
  });
});
