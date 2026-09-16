import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { MobileShell } from './MobileShell';

jest.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ device: 'mobile', isMobile: true, isDesktop: false }),
}));
jest.mock('../sheet', () => ({
  SurfaceContent: ({ kind }: { kind: string }) => <div>SURFACE:{kind}</div>,
  SURFACE_TITLES: { building: 'Building Inspector', mail: 'Mail', search: 'Search', politics: 'Government', empire: 'Profile', facilities: 'My Facilities', overlays: 'Map Overlays' },
  BuildingSheetActions: () => null,
}));
jest.mock('./MobileInfoBar', () => ({ MobileInfoBar: () => null }));
jest.mock('./ChatBanner', () => ({ ChatBanner: () => null }));
jest.mock('./BottomNav', () => ({ BottomNav: () => <nav>NAV</nav> }));
jest.mock('./PlacementHUD', () => ({ PlacementHUD: () => <div>PLACEMENT</div> }));
jest.mock('../chat', () => ({ ChatStrip: () => <div>CHAT</div> }));
jest.mock('./MobileBuildContent', () => ({ MobileBuildContent: () => <div>BUILD</div> }));
jest.mock('./MobileMenu', () => ({ MobileMenu: () => <div>MENU</div> }));

describe('MobileShell and the surface stack', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setMobileTab('map');
    useUiStore.getState().setIsPlacingBuilding(false);
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false, overlayBeforeMode: null });
  });

  it('routes the top surface into the bottom sheet — politics included', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'politics' }));
    renderWithProviders(<MobileShell />);
    expect(screen.getByText('Government')).toBeTruthy();
    expect(screen.getByText('SURFACE:politics')).toBeTruthy();
  });

  it('the profile surface is reachable on mobile', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'empire' }));
    renderWithProviders(<MobileShell />);
    expect(screen.getByText('SURFACE:empire')).toBeTruthy();
  });

  it('closing the sheet unstacks one surface at a time, then closes the tab', () => {
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'building' });
      useUiStore.getState().pushSurface({ kind: 'search' });
    });
    renderWithProviders(<MobileShell />);
    expect(screen.getByText('SURFACE:search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
    expect(screen.getByText('SURFACE:building')).toBeTruthy();
  });

  it('falls back to the tab content when the stack is empty (Fav moved to More › My facilities)', () => {
    act(() => useUiStore.getState().setMobileTab('build'));
    renderWithProviders(<MobileShell />);
    expect(screen.getByText('BUILD')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('the search row shows on the map tab only — not over a sheet, not during placement', () => {
    const { unmount } = renderWithProviders(<MobileShell />);
    expect(screen.getByRole('button', { name: 'Search or run a command' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search or run a command' }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
    unmount();
    useUiStore.setState({ commandPaletteOpen: false });
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    const r2 = renderWithProviders(<MobileShell />);
    expect(screen.queryByRole('button', { name: 'Search or run a command' })).toBeNull();
    r2.unmount();
    act(() => { useUiStore.getState().clearSurfaces(); useUiStore.getState().setIsPlacingBuilding(true); });
    renderWithProviders(<MobileShell />);
    expect(screen.queryByRole('button', { name: 'Search or run a command' })).toBeNull();
  });

  it('shows the placement HUD instead of the nav while placing', () => {
    act(() => useUiStore.getState().setIsPlacingBuilding(true));
    renderWithProviders(<MobileShell />);
    expect(screen.getByText('PLACEMENT')).toBeTruthy();
    expect(screen.queryByText('NAV')).toBeNull();
  });
  it('the mode bar takes the place of the nav while a road mode runs, and hides the search row', () => {
    act(() => useGameStore.setState({ isRoadBuildingMode: true }));
    renderWithProviders(<MobileShell />);
    expect(screen.queryByText('NAV')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Road');
    expect(screen.queryByRole('button', { name: 'Search or run a command' })).toBeNull();
    act(() => useGameStore.setState({ isRoadBuildingMode: false }));
    expect(screen.getByText('NAV')).toBeTruthy();
  });
});
