import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { CommandBar } from './CommandBar';

describe('CommandBar', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ modal: null, commandPaletteOpen: false, isPlacingBuilding: false, placementValid: false, placingFacility: null });
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false, isPublicOfficeRole: false, isVisitor: false, tycoonStats: null, overlayBeforeMode: null });
    useMailStore.setState({ unreadCount: 0 });
  });

  it('renders the six tiles and the search row', () => {
    renderWithProviders(<CommandBar />);
    for (const name of ['Build', 'Map', 'Empire', 'Government', 'More']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mail/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Search or run a command/ })).toBeTruthy();
  });

  it('tiles open their surfaces and reflect the active one', () => {
    renderWithProviders(<CommandBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Government' }));
    expect(useUiStore.getState().rightPanel).toBe('politics');
    expect(screen.getByRole('button', { name: 'Government' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Empire' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(useUiStore.getState().stack[0]?.kind).toBe('build');
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the mail tile names its unread count', () => {
    useMailStore.setState({ unreadCount: 3 });
    renderWithProviders(<CommandBar />);
    expect(screen.getByRole('button', { name: 'Mail, 3 unread' })).toBeTruthy();
  });

  it('Map opens the Map surface (and closes it again); the docked minimap lives in More; the search row opens the palette', () => {
    const onToggleMinimap = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onToggleMinimap }) });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['map']);
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(useUiStore.getState().stack).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Docked minimap' }));
    expect(onToggleMinimap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it('More opens a menu with roads, overlays, facilities, settings, switch server; zone painting only for public office', () => {
    const onBuildRoad = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onBuildRoad }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(menu).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Zone painting/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Build road' }));
    expect(onBuildRoad).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('public office sees zone painting in More', () => {
    useGameStore.setState({ isPublicOfficeRole: true });
    renderWithProviders(<CommandBar />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zone painting' }));
    expect(useUiStore.getState().modal).toBe('zonePicker');
  });

  it('placement mode replaces the search row with the mode bar: name, cost, cash after, rotate, done', () => {
    useGameStore.setState({ tycoonStats: { cash: '12480300', incomePerHour: '0', failureLevel: 0 } as never });
    const onCancelBuildingPlacement = jest.fn();
    const onRotateCW = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onCancelBuildingPlacement, onRotateCW }) });
    act(() => {
      useUiStore.getState().setPlacingFacility({ name: 'Textile Mill', cost: 240000 });
      useUiStore.getState().setIsPlacingBuilding(true);
      useUiStore.getState().setPlacementValid(true);
    });
    const bar = screen.getByRole('status');
    expect(bar.textContent).toContain('Placement');
    expect(bar.textContent).toContain('Textile Mill');
    expect(bar.textContent).toContain('$240,000');
    expect(bar.textContent).toContain('$12,240,300');
    expect(bar.textContent).toContain('Click the map to place');
    expect(screen.queryByRole('button', { name: /Search or run a command/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Rotate view/ }));
    expect(onRotateCW).toHaveBeenCalledTimes(1);
    act(() => useUiStore.getState().setPlacementValid(false));
    expect(screen.getByRole('status').textContent).toContain('Invalid spot');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onCancelBuildingPlacement).toHaveBeenCalledTimes(1);
  });

  it('road mode shows a mode bar whose Done toggles the mode off', () => {
    const onDemolishRoad = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onDemolishRoad }) });
    act(() => useGameStore.setState({ isRoadDemolishMode: true }));
    expect(screen.getByRole('status').textContent).toContain('Demolish');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onDemolishRoad).toHaveBeenCalledTimes(1);
  });

  it('zone painting shows a mode bar whose Done cancels painting', () => {
    const onCancelZonePainting = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onCancelZonePainting }) });
    act(() => useGameStore.setState({ isZonePaintingMode: true }));
    expect(screen.getByRole('status').textContent).toContain('Zones');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onCancelZonePainting).toHaveBeenCalledTimes(1);
  });

  it('shifts left when a surface is open', () => {
    const { container } = renderWithProviders(<CommandBar />);
    expect(container.firstElementChild?.className).not.toContain('shifted');
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    expect(container.firstElementChild?.className).toContain('shifted');
  });

  it('road build mode: Done toggles building off; More shows the stop label', () => {
    const onBuildRoad = jest.fn();
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onBuildRoad }) });
    act(() => useGameStore.setState({ isRoadBuildingMode: true }));
    expect(screen.getByRole('status').textContent).toContain('Build');
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onBuildRoad).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Stop building roads' })).toBeTruthy();
  });

  it('More menu: the other items, Escape and an outside click close it', () => {
    const onSwitchServer = jest.fn();
    const onDemolishRoad = jest.fn();
    const onCancelZonePainting = jest.fn();
    useGameStore.setState({ isPublicOfficeRole: true, isZonePaintingMode: true });
    renderWithProviders(<CommandBar />, { clientCallbacks: createSpiedCallbacks({ onSwitchServer, onDemolishRoad, onCancelZonePainting }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop zone painting' }));
    expect(onCancelZonePainting).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Map overlays' }));
    expect(useUiStore.getState().leftPanel).toBe('overlays');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'My facilities' }));
    expect(useUiStore.getState().leftPanel).toBe('facilities');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(useUiStore.getState().modal).toBe('settings');
    useUiStore.setState({ modal: null });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Demolish road' }));
    expect(onDemolishRoad).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch server' }));
    expect(onSwitchServer).toHaveBeenCalledTimes(1);
    // Escape closes
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    // outside click closes
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a visitor sees no Build/Empire tiles and no road/facilities items in More', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<CommandBar />);
    expect(screen.queryByRole('button', { name: 'Build' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empire' })).toBeNull();
    for (const name of ['Map', 'Government', 'More']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Build road' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Demolish road' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'My facilities' })).toBeNull();
  });

  it('mail tile opens the mail surface', () => {
    renderWithProviders(<CommandBar />);
    fireEvent.click(screen.getByRole('button', { name: /Mail/ }));
    expect(useUiStore.getState().rightPanel).toBe('mail');
  });

  it('the mode bar says what happened to the overlay, and the road tariff', () => {
    renderWithProviders(<CommandBar />);
    act(() => useGameStore.setState({ isZonePaintingMode: true, overlayBeforeMode: { type: 'none' } }));
    expect(screen.getByRole('status').textContent).toContain('Zones overlay shown for this mode');
    act(() => useGameStore.setState({ overlayBeforeMode: { type: 'overlay', overlay: 'Crime' as never } }));
    expect(screen.getByRole('status').textContent).toContain('Crime comes back when done');
    act(() => useGameStore.setState({ overlayBeforeMode: { type: 'zones' } }));
    expect(screen.getByRole('status').textContent).not.toContain('overlay shown');
    act(() => useGameStore.setState({ isZonePaintingMode: false, isRoadBuildingMode: true, overlayBeforeMode: null }));
    // H7 (#99): the tariff is not flat — water costs the bridge rate, paved tiles are free.
    expect(screen.getByRole('status').textContent).toContain('$2,000,000 per tile, $4,000,000 over water; existing road is free');
  });
  it('placement cash after the spend is negative when the building costs more than the cash', () => {
    useGameStore.setState({ tycoonStats: { cash: '1,000', incomePerHour: '0', failureLevel: 0 } as never });
    renderWithProviders(<CommandBar />);
    act(() => {
      useUiStore.getState().setPlacingFacility({ name: 'Textile Mill', cost: 240000 });
      useUiStore.getState().setIsPlacingBuilding(true);
    });
    expect(screen.getByRole('status').textContent).toContain('-$239,000');
  });
});
