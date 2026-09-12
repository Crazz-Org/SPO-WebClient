import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore, type MapContextMenuState } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMapStore } from '../../store/map-store';
import { clearCivicVisualClassIds, registerCivicVisualClass } from '@/shared/building-details/civic-buildings';
import { MapContextMenu } from './MapContextMenu';

function menu(overrides: Partial<MapContextMenuState> = {}): MapContextMenuState {
  return { clientX: 100, clientY: 50, tileX: 10, tileY: 5, layer: 'building', visualClass: '100', ...overrides };
}

describe('MapContextMenu', () => {
  beforeEach(() => {
    useUiStore.setState({
      mapContextMenu: null,
      isPlacingBuilding: false,
      connectMode: { active: false, subject: '' },
    });
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false });
    useMapStore.setState({ source: null });
    clearCivicVisualClassIds();
  });

  it('renders nothing when closed', () => {
    renderWithProviders(<MapContextMenu />);
    expect(screen.queryByTestId('map-context-menu')).toBeNull();
  });

  it('shows Inspect on a building and calls onNavigateToBuilding, then closes', () => {
    const onNavigateToBuilding = jest.fn();
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });

    const item = screen.getByRole('menuitem', { name: 'Inspect' });
    fireEvent.click(item);

    expect(onNavigateToBuilding).toHaveBeenCalledWith(10, 5);
    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('shows no Inspect item on terrain', () => {
    useUiStore.getState().openMapContextMenu(menu({ layer: 'terrain', visualClass: undefined }));
    renderWithProviders(<MapContextMenu />);

    expect(screen.queryByRole('menuitem', { name: 'Inspect' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Centre view here' })).not.toBeNull();
  });

  it('shows no Inspect item for a portal visual class', () => {
    useUiStore.getState().openMapContextMenu(menu({ layer: 'building', visualClass: '6031' }));
    renderWithProviders(<MapContextMenu />);

    expect(screen.queryByRole('menuitem', { name: 'Inspect' })).toBeNull();
  });

  it('shows Visit for a civic building', () => {
    registerCivicVisualClass('500');
    useUiStore.getState().openMapContextMenu(menu({ visualClass: '500' }));
    renderWithProviders(<MapContextMenu />);

    expect(screen.getByRole('menuitem', { name: 'Visit' })).not.toBeNull();
  });

  it('centres the map source on "Centre view here" and closes', () => {
    const centerOn = jest.fn();
    useMapStore.setState({ source: { centerOn } as never });
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Centre view here' }));

    expect(centerOn).toHaveBeenCalledWith(10, 5);
    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('closes on a mousedown outside the menu', () => {
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />);
    expect(screen.getByTestId('map-context-menu')).not.toBeNull();

    fireEvent.mouseDown(document.body);

    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('closes when placement mode starts', () => {
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />);

    act(() => { useUiStore.setState({ isPlacingBuilding: true }); });

    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('closes when road building mode starts', () => {
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />);

    act(() => { useGameStore.setState({ isRoadBuildingMode: true }); });

    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('closes on Escape via dismissTopmost', () => {
    useUiStore.getState().openMapContextMenu(menu());
    renderWithProviders(<MapContextMenu />);

    act(() => { useUiStore.getState().dismissTopmost(); });

    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });
});
