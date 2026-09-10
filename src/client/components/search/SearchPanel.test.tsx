import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { SearchPanel } from './SearchPanel';
import { WsMessageType } from '@/shared/types';
import type { WsRespSearchMenuHome, SearchMenuCategory } from '@/shared/types';

const BASE_CATEGORIES: SearchMenuCategory[] = [
  { id: 'capitol', label: 'Capitol', enabled: false },
  { id: 'towns', label: 'Towns', enabled: true },
  { id: 'rendertycoon', label: 'You', enabled: true },
  { id: 'tycoons', label: 'People', enabled: true },
  { id: 'rankings', label: 'Rankings', enabled: true },
  { id: 'banks', label: 'Banks', enabled: true },
];

function homeData(categories: SearchMenuCategory[]): WsRespSearchMenuHome {
  return { type: WsMessageType.RESP_SEARCH_MENU_HOME, categories };
}

function setup(categories: SearchMenuCategory[] | null, overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  useSearchStore.setState({
    currentPage: 'home',
    pageHistory: [],
    isLoading: false,
    homeData: categories === null ? null : homeData(categories),
  });
  const onNavigateToBuilding = overrides.onNavigateToBuilding ?? jest.fn();
  const onSearchMenuTycoonProfile = overrides.onSearchMenuTycoonProfile ?? jest.fn();
  const onSearchMenuHome = overrides.onSearchMenuHome ?? (() => { /* no-op */ });
  const clientCallbacks = createSpiedCallbacks({
    onNavigateToBuilding,
    onSearchMenuTycoonProfile,
    onSearchMenuHome,
    ...overrides,
  });
  renderWithProviders(<SearchPanel />, { clientCallbacks });
  return { onNavigateToBuilding, onSearchMenuTycoonProfile };
}

describe('SearchPanel — home grid', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders one tile per category, in the fixture order', () => {
    setup(BASE_CATEGORIES);

    const labels = BASE_CATEGORIES.map((c) => c.label);
    for (const label of labels) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('dims a disabled Capitol tile and leaves it inert', () => {
    setup(BASE_CATEGORIES);

    const capitolLabel = screen.getByText('Capitol');
    const card = capitolLabel.closest('[class*="categoryCard"]') as HTMLElement;

    expect(card.className).toMatch(/categoryCardDisabled/);
    expect(card.getAttribute('role')).toBeNull();

    fireEvent.click(card);
    expect(useSearchStore.getState().currentPage).toBe('home');
  });

  it('calls onNavigateToBuilding with the parsed coordinates for an enabled Capitol tile', () => {
    const categories = BASE_CATEGORIES.map((c) =>
      c.id === 'capitol' ? { id: 'capitol', label: 'Capitol', enabled: true, x: 220, y: 41 } : c,
    );
    const { onNavigateToBuilding } = setup(categories);

    fireEvent.click(screen.getByText('Capitol'));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(220, 41);
  });

  it('clicking the You tile navigates to tycoon-profile and requests "YOU"', () => {
    const { onSearchMenuTycoonProfile } = setup(BASE_CATEGORIES);

    fireEvent.click(screen.getByText('You'));

    expect(useSearchStore.getState().currentPage).toBe('tycoon-profile');
    expect(onSearchMenuTycoonProfile).toHaveBeenCalledWith('YOU');
  });

  it('clicking Towns preserves the existing navigation behaviour', () => {
    setup(BASE_CATEGORIES);

    fireEvent.click(screen.getByText('Towns'));

    expect(useSearchStore.getState().currentPage).toBe('towns');
  });

  it('renders an unknown server-added tile dimmed and inert, without a client edit', () => {
    const categories = [...BASE_CATEGORIES, { id: 'weather', label: 'Weather', enabled: true }];
    setup(categories);

    const label = screen.getByText('Weather');
    const card = label.closest('[class*="categoryCard"]') as HTMLElement;

    expect(card.className).toMatch(/categoryCardDisabled/);
    expect(card.getAttribute('role')).toBeNull();
  });

  it('shows the loading text and no tile when homeData is null', () => {
    setup(null);

    expect(screen.getByText('Loading directory…')).toBeTruthy();
    expect(screen.queryByText('Towns')).toBeNull();
  });
});
