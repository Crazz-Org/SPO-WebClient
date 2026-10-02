/**
 * ModeBanner — v1's mode row (CommandBar) in the v2 top deck: the same words from
 * useModeDescriptor, Rotate view only while placing, the way out per mode, the invalid tone,
 * and the shift beside an open surface.
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { ModeBanner } from './ModeBanner';

describe('ModeBanner', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ isPlacingBuilding: false, placementValid: false, placingFacility: null, connectMode: { active: false, subject: '' } });
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false, tycoonStats: null, overlayBeforeMode: null });
  });

  it('renders nothing when no mode runs', () => {
    const { container } = renderWithProviders(<ModeBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('placement: kind, name, cost, cash after, hint, Rotate view (W) and Done (Esc)', () => {
    const onRotateCW = jest.fn();
    const onCancelBuildingPlacement = jest.fn();
    renderWithProviders(<ModeBanner />, { clientCallbacks: createSpiedCallbacks({ onRotateCW, onCancelBuildingPlacement }) });
    act(() => {
      useGameStore.setState({ tycoonStats: { username: 'u', cash: '1,000,000', incomePerHour: '0', ranking: 1, buildingCount: 0, maxBuildings: 10 } });
      useUiStore.getState().setPlacingFacility({ name: 'Textile Mill', cost: 240000 });
      useUiStore.getState().setIsPlacingBuilding(true);
      useUiStore.getState().setPlacementValid(true);
    });
    const banner = screen.getByTestId('v2-mode-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.className).toContain('banner');
    expect(banner.className).not.toContain('invalid');
    expect(banner.textContent).toContain('Placement');
    expect(banner.textContent).toContain('Textile Mill');
    expect(banner.textContent).toContain('$240,000');
    expect(banner.textContent).toContain('after: $760,000');
    expect(screen.getByText('$760,000').className).toContain('pos');
    expect(banner.textContent).toContain('Click the map to place');

    const rotate = screen.getByRole('button', { name: /Rotate view/ });
    expect(rotate.textContent).toContain('W');
    fireEvent.click(rotate);
    expect(onRotateCW).toHaveBeenCalledTimes(1);

    const done = screen.getByRole('button', { name: 'Done — leave Placement mode' });
    expect(done.textContent).toContain('Esc');
    fireEvent.click(done);
    expect(onCancelBuildingPlacement).toHaveBeenCalledTimes(1);
  });

  it('placement on a refused spot turns the banner and the hint red, and a negative balance red', () => {
    renderWithProviders(<ModeBanner />);
    act(() => {
      useGameStore.setState({ tycoonStats: { username: 'u', cash: '100', incomePerHour: '0', ranking: 1, buildingCount: 0, maxBuildings: 10 } });
      useUiStore.getState().setPlacingFacility({ name: 'Farm', cost: 240000 });
      useUiStore.getState().setIsPlacingBuilding(true);
      useUiStore.getState().setPlacementValid(false);
    });
    expect(screen.getByTestId('v2-mode-banner').className).toContain('invalid');
    expect(screen.getByText('Invalid spot — move the ghost').className).toContain('hintInvalid');
    expect(screen.getByText('-$239,900').className).toContain('neg');
  });

  it('road building: no money, no Rotate, the tariff, and Done toggles the mode off', () => {
    const onBuildRoad = jest.fn();
    renderWithProviders(<ModeBanner />, { clientCallbacks: createSpiedCallbacks({ onBuildRoad }) });
    act(() => useGameStore.setState({ isRoadBuildingMode: true }));
    const banner = screen.getByTestId('v2-mode-banner');
    expect(banner.textContent).toContain('Road');
    expect(banner.textContent).toContain('Build');
    expect(banner.textContent).toContain('per tile');
    expect(banner.textContent).not.toContain('after:');
    expect(screen.queryByRole('button', { name: /Rotate view/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done — leave Road mode' }));
    expect(onBuildRoad).toHaveBeenCalledTimes(1);
  });

  it('zone painting says what happened to the overlay', () => {
    const onCancelZonePainting = jest.fn();
    renderWithProviders(<ModeBanner />, { clientCallbacks: createSpiedCallbacks({ onCancelZonePainting }) });
    act(() => useGameStore.setState({ isZonePaintingMode: true, overlayBeforeMode: { type: 'none' } }));
    const banner = screen.getByTestId('v2-mode-banner');
    expect(banner.textContent).toContain('Drag a rectangle on the map');
    expect(banner.textContent).toContain('· Zones overlay shown for this mode');
    fireEvent.click(screen.getByRole('button', { name: 'Done — leave Zones mode' }));
    expect(onCancelZonePainting).toHaveBeenCalledTimes(1);
  });

  it('connect mode: the way out says Cancel, and the banner does not shift although the stack is open', () => {
    const onCancelConnectMode = jest.fn();
    renderWithProviders(<ModeBanner />, { clientCallbacks: createSpiedCallbacks({ onCancelConnectMode }) });
    act(() => {
      useUiStore.getState().toggleLeftPanel('empire');
      useUiStore.setState({ connectMode: { active: true, subject: 'Fabrics' } });
    });
    const banner = screen.getByTestId('v2-mode-banner');
    expect(banner.textContent).toContain('Fabrics');
    expect(banner.textContent).toContain('Click a building to connect');
    expect(banner.className).not.toContain('shifted');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel — leave Connect mode' }));
    expect(onCancelConnectMode).toHaveBeenCalledTimes(1);
  });

  it('shifts beside an open surface', () => {
    renderWithProviders(<ModeBanner />);
    act(() => {
      useGameStore.setState({ isRoadDemolishMode: true });
      useUiStore.getState().toggleLeftPanel('empire');
    });
    expect(screen.getByTestId('v2-mode-banner').className).toContain('shifted');
  });
});
