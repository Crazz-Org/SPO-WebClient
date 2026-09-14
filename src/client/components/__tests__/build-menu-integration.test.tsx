/**
 * Integration test: Build Menu flow.
 *
 * Tests the full user journey:
 * 1. Open build menu modal → categories request fires
 * 2. Store receives categories → category grid renders (no level badge)
 * 3. Click category → facilities request fires
 * 4. Store receives facilities → facility list renders with tile badges
 * 5. Click facility → card expands (accordion behavior)
 * 6. Click "Place Building" → modal closes, placement mode starts
 * 7. Capitol card (public office role) → fires onBuildCapitol
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { BuildMenu } from '../modals/BuildMenu';
import type { BuildingCategory, BuildingInfo } from '@/shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockCategories: BuildingCategory[] = [
  { kindName: 'Commerce', kind: '1', cluster: 'default', folder: 'commerce', iconPath: '/icons/commerce.png', tycoonLevel: 0 },
  { kindName: 'Industry', kind: '2', cluster: 'default', folder: 'industry', iconPath: '/icons/industry.png', tycoonLevel: 2 },
];

const mockFacilities: BuildingInfo[] = [
  {
    facilityClass: 'SmallStore',
    name: 'Small Store',
    description: 'A basic retail shop',
    cost: 50000,
    area: 4,
    iconPath: '/icons/small-store.png',
    available: true,
    visualClassId: '101',
    zoneRequirement: 'Commercial zone',
    xsize: 2,
    ysize: 2,
  },
  {
    facilityClass: 'LargeStore',
    name: 'Large Store',
    description: 'A large department store',
    cost: 250000,
    area: 9,
    iconPath: '/icons/large-store.png',
    available: false,
    visualClassId: '102',
    zoneRequirement: 'commercial',
    xsize: 3,
    ysize: 3,
  },
];

// Helper: navigate to facilities phase and populate store
function goToFacilitiesPhase(facilities: BuildingInfo[] = mockFacilities) {
  fireEvent.click(screen.getByText('Commerce'));
  act(() => {
    useUiStore.setState({ buildMenuFacilities: facilities });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Build Menu — integration flow', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({
      buildMenuCategories: [],
      buildMenuFacilities: [],
      capitolIconUrl: '',
    });
  });

  it('renders nothing when modal is not buildMenu', () => {
    const { container } = renderWithProviders(<BuildMenu />);
    expect(container.innerHTML).toBe('');
  });

  it('requests categories when modal opens', () => {
    const catSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onRequestBuildingCategories: catSpy });

    useUiStore.setState({ modal: 'buildMenu' });

    renderWithProviders(<BuildMenu />, { clientCallbacks: mockCallbacks });

    expect(catSpy).toHaveBeenCalled();
  });

  it('renders category cards without level badge', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);

    expect(screen.getByText('Commerce')).toBeTruthy();
    expect(screen.getByText('Industry')).toBeTruthy();
    // Level badge should NOT be rendered (removed from UI)
    expect(screen.queryByText('Lv.2')).toBeNull();
  });

  it('requests facilities when category is clicked', () => {
    const facSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onRequestBuildingFacilities: facSpy });

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />, { clientCallbacks: mockCallbacks });

    fireEvent.click(screen.getByText('Commerce'));

    expect(facSpy).toHaveBeenCalledWith('1', 'default');
  });

  it('renders facility list with tile badges when store receives facilities', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
      buildMenuFacilities: mockFacilities,
    });

    renderWithProviders(<BuildMenu />);

    fireEvent.click(screen.getByText('Commerce'));

    act(() => {
      useUiStore.setState({ buildMenuFacilities: [...mockFacilities] });
    });

    expect(screen.getByText('Small Store')).toBeTruthy();
    expect(screen.getByText('A basic retail shop')).toBeTruthy();
    expect(screen.getByText('Large Store')).toBeTruthy();
    expect(screen.getByText('A large department store')).toBeTruthy();
    // Tile dimension badges
    expect(screen.getByText('2×2')).toBeTruthy();
    expect(screen.getByText('3×3')).toBeTruthy();
  });

  it('expands facility card on click and shows Place Building button', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase();

    // Click to expand
    fireEvent.click(screen.getByText('Small Store'));

    // Expanded area should show Place Building button and full metadata
    expect(screen.getByText('Place Building')).toBeTruthy();
    // Tile info in expanded area
    expect(screen.getByText('Tiles: 2 × 2 (4 tiles)')).toBeTruthy();
  });

  it('closes modal and starts placement when Place Building is clicked', () => {
    const placeSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onPlaceBuilding: placeSpy });

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />, { clientCallbacks: mockCallbacks });
    goToFacilitiesPhase();

    // Expand then place
    fireEvent.click(screen.getByText('Small Store'));
    fireEvent.click(screen.getByText('Place Building'));

    expect(useUiStore.getState().modal).toBeNull();
    expect(placeSpy).toHaveBeenCalledWith('SmallStore', '101');
  });

  it('collapses expanded card when another card is clicked (accordion)', () => {
    // Use two available facilities
    const twoAvailable: BuildingInfo[] = [
      { ...mockFacilities[0] },
      { ...mockFacilities[1], available: true },
    ];

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase(twoAvailable);

    // Expand first card
    fireEvent.click(screen.getByText('Small Store'));
    expect(screen.getByText('Tiles: 2 × 2 (4 tiles)')).toBeTruthy();

    // Click second card — first should collapse
    fireEvent.click(screen.getByText('Large Store'));
    expect(screen.queryByText('Tiles: 2 × 2 (4 tiles)')).toBeNull();
    expect(screen.getByText('Tiles: 3 × 3 (9 tiles)')).toBeTruthy();
  });

  it('does not expand unavailable facility', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase();

    // Click unavailable facility (Large Store) — find the card by role
    const largeStoreCard = screen.getByText('Large Store').closest('[role="button"]');
    if (largeStoreCard) fireEvent.click(largeStoreCard);

    // Should NOT show expanded content
    expect(screen.queryByText('Place Building')).toBeNull();
  });

  it('facility card has correct accessibility attributes', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase();

    const smallStoreCard = screen.getByText('Small Store').closest('[role="button"]');
    expect(smallStoreCard).toBeTruthy();
    expect(smallStoreCard?.getAttribute('aria-expanded')).toBe('false');
    expect(smallStoreCard?.getAttribute('tabindex')).toBe('0');

    // Expand
    fireEvent.click(screen.getByText('Small Store'));
    const expandedCard = screen.getByText('Small Store').closest('[role="button"]');
    expect(expandedCard?.getAttribute('aria-expanded')).toBe('true');

    // Unavailable card should have aria-disabled and tabindex -1
    const largeStoreCard = screen.getByText('Large Store').closest('[role="button"]');
    expect(largeStoreCard?.getAttribute('aria-disabled')).toBe('true');
    expect(largeStoreCard?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows Capitol card for public office role', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
      capitolIconUrl: '/icons/capitol.png',
    });
    useGameStore.setState({ isPublicOfficeRole: true });

    renderWithProviders(<BuildMenu />);

    expect(screen.getByText('Capitol')).toBeTruthy();
    expect(screen.getByText('Public Office')).toBeTruthy();
  });

  it('Capitol card calls onBuildCapitol and closes modal', () => {
    const capitolSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onBuildCapitol: capitolSpy });

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
      capitolIconUrl: '/icons/capitol.png',
    });
    useGameStore.setState({ isPublicOfficeRole: true });

    renderWithProviders(<BuildMenu />, { clientCallbacks: mockCallbacks });

    fireEvent.click(screen.getByText('Capitol'));

    expect(capitolSpy).toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('shows the server requirement sentence under the Locked badge, falling back to today\'s wording when absent', () => {
    const withRequirement: BuildingInfo[] = [
      { ...mockFacilities[1], requirement: 'Requires tycoon level 3' },
    ];

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase(withRequirement);

    expect(screen.getByText('Requires tycoon level 3')).toBeTruthy();
    expect(screen.queryByText('Not available yet')).toBeNull();
  });

  it('falls back to "Not available yet" when a locked facility carries no requirement, and shows neither for an available one', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);
    goToFacilitiesPhase();

    // Large Store (mockFacilities[1]) is unavailable with no `requirement`.
    expect(screen.getByText('Not available yet')).toBeTruthy();
    // Small Store (mockFacilities[0]) is available — no locked reason text.
    const smallStoreCard = screen.getByText('Small Store').closest('[role="button"]');
    expect(smallStoreCard?.textContent).not.toContain('Not available yet');
  });

  it('close button dismisses modal', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(useUiStore.getState().modal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Residential grouping
// ---------------------------------------------------------------------------

const mockResidentialFacilities: BuildingInfo[] = [
  { facilityClass: 'PGIHiResA', name: 'Luxury Apartments', description: 'High class', cost: 200000, area: 4, iconPath: '', available: true, visualClassId: '5001', zoneRequirement: '', residenceClass: 'high', xsize: 2, ysize: 2 },
  { facilityClass: 'PGIMidResA', name: 'Town Houses', description: 'Middle class', cost: 100000, area: 4, iconPath: '', available: true, visualClassId: '5101', zoneRequirement: '', residenceClass: 'middle', xsize: 2, ysize: 2 },
  { facilityClass: 'PGILoResA', name: 'Low Income Housing', description: 'Low class', cost: 50000, area: 4, iconPath: '', available: true, visualClassId: '5201', zoneRequirement: '', residenceClass: 'low', xsize: 2, ysize: 2 },
];

describe('Build Menu — residential grouping', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({
      buildMenuCategories: [],
      buildMenuFacilities: [],
      capitolIconUrl: '',
    });
  });

  it('renders grouped residential facilities with High/Mid/Low headers', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);

    // Go to facilities phase
    fireEvent.click(screen.getByText('Commerce'));

    act(() => {
      useUiStore.setState({ buildMenuFacilities: mockResidentialFacilities });
    });

    expect(screen.getByText('High Class')).toBeTruthy();
    expect(screen.getByText('Middle Class')).toBeTruthy();
    expect(screen.getByText('Low Class')).toBeTruthy();
    expect(screen.getByText('Luxury Apartments')).toBeTruthy();
    expect(screen.getByText('Town Houses')).toBeTruthy();
    expect(screen.getByText('Low Income Housing')).toBeTruthy();
  });

  it('shows ungrouped facilities alongside classified groups', () => {
    const mixed: BuildingInfo[] = [
      ...mockResidentialFacilities,
      { facilityClass: 'PGIResSpecial', name: 'Special Building', description: '', cost: 30000, area: 4, iconPath: '', available: true, visualClassId: '5301', zoneRequirement: '', xsize: 1, ysize: 1 },
    ];

    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);

    fireEvent.click(screen.getByText('Commerce'));

    act(() => {
      useUiStore.setState({ buildMenuFacilities: mixed });
    });

    // Groups should render
    expect(screen.getByText('High Class')).toBeTruthy();
    // Ungrouped facility should also render
    expect(screen.getByText('Special Building')).toBeTruthy();
  });

  it('renders flat list when no facility has residenceClass', () => {
    useUiStore.setState({
      modal: 'buildMenu',
      buildMenuCategories: mockCategories,
    });

    renderWithProviders(<BuildMenu />);

    fireEvent.click(screen.getByText('Commerce'));

    act(() => {
      useUiStore.setState({ buildMenuFacilities: mockFacilities });
    });

    // No group headers should be present
    expect(screen.queryByText('High Class')).toBeNull();
    expect(screen.queryByText('Middle Class')).toBeNull();
    expect(screen.queryByText('Low Class')).toBeNull();
    // Buildings still render
    expect(screen.getByText('Small Store')).toBeTruthy();
  });
});

describe('Build Menu — T1 sheet behaviour (embedded)', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ buildMenuCategories: [], buildMenuFacilities: [], capitolIconUrl: '' });
    useGameStore.setState({ tycoonStats: null });
  });

  it('does not re-request categories when the store already has them (session cache)', () => {
    const catSpy = jest.fn();
    useUiStore.setState({ buildMenuCategories: mockCategories });
    renderWithProviders(<BuildMenu embedded />, { clientCallbacks: createSpiedCallbacks({ onRequestBuildingCategories: catSpy }) });
    expect(catSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Commerce')).toBeTruthy();
  });

  it('filters categories and buildings locally', () => {
    useUiStore.setState({ buildMenuCategories: mockCategories });
    renderWithProviders(<BuildMenu embedded />);
    fireEvent.change(screen.getByLabelText('Filter categories'), { target: { value: 'zzz' } });
    expect(screen.queryByText('Commerce')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter categories'), { target: { value: '' } });
    goToFacilitiesPhase();
    fireEvent.change(screen.getByLabelText('Filter buildings by name'), { target: { value: 'large' } });
    expect(screen.getByText('Large Store')).toBeTruthy();
    expect(screen.queryByText('Small Store')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter buildings by name'), { target: { value: 'nothing here' } });
    expect(screen.getByText(/No building matches/)).toBeTruthy();
  });

  it('shows cash after and blocks an unaffordable placement', () => {
    useUiStore.setState({ buildMenuCategories: mockCategories });
    useGameStore.setState({ tycoonStats: { cash: '40000', incomePerHour: '0', failureLevel: 0 } as never });
    renderWithProviders(<BuildMenu embedded />);
    goToFacilitiesPhase();
    fireEvent.click(screen.getByText('Small Store')); // costs 50 000, cash 40 000
    expect(screen.getByText(/Cash after:/).textContent).toContain('-');
    expect((screen.getByText('Place Building') as HTMLButtonElement).disabled).toBe(true);
    act(() => useGameStore.setState({ tycoonStats: { cash: '90000', incomePerHour: '0', failureLevel: 0 } as never }));
    expect(screen.getByText(/Cash after:/).textContent).not.toContain('-');
    expect((screen.getByText('Place Building') as HTMLButtonElement).disabled).toBe(false);
  });

  it('filters residential groups too', () => {
    useUiStore.setState({ buildMenuCategories: mockCategories });
    renderWithProviders(<BuildMenu embedded />);
    goToFacilitiesPhase(mockResidentialFacilities);
    fireEvent.change(screen.getByLabelText('Filter buildings by name'), { target: { value: 'luxury' } });
    expect(screen.getByText('Luxury Apartments')).toBeTruthy();
    expect(screen.queryByText('Town Houses')).toBeNull();
  });
});
