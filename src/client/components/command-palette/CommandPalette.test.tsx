import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useEmpireStore } from '../../store/empire-store';
import { useSearchStore } from '../../store/search-store';
import { CommandPalette } from './CommandPalette';

const TOWNS = {
  towns: [
    { name: 'Helartia', iconUrl: '', mayor: 'SPO_test3', population: 1200, unemploymentPercent: 3, qualityOfLife: 80, x: 410, y: 520 },
    { name: 'Dunmore', iconUrl: '', mayor: null, population: 100, unemploymentPercent: 0, qualityOfLife: 50, x: 90, y: 75 },
  ],
} as never;

function openPalette() {
  act(() => {
    jest.advanceTimersByTime(60);
  });
}

function type(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ commandPaletteOpen: true });
    useGameStore.setState({ isVisitor: false });
    useEmpireStore.getState().reset();
    useSearchStore.getState().reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers a Government command that opens the politics surface', () => {
    renderWithProviders(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByText(/Open Government/));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['politics']);
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it('omits Build and Empire commands for a visitor', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<CommandPalette />);
    openPalette();
    expect(screen.queryByText('Open Build Menu')).toBeNull();
    expect(screen.queryByText('Open Empire Overview')).toBeNull();
    expect(screen.getByText(/Open Government/)).toBeTruthy();
  });

  it('reads the facilities list and the towns page once when it opens empty, not again when loading or filled', () => {
    const onRequestFacilities = jest.fn();
    const onSearchMenuTowns = jest.fn();
    const { unmount } = renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onRequestFacilities, onSearchMenuTowns }) });
    expect(onRequestFacilities).toHaveBeenCalledTimes(1);
    expect(onSearchMenuTowns).toHaveBeenCalledTimes(1);
    useSearchStore.getState().setTownsData(TOWNS);
    unmount();
    useEmpireStore.setState({ isLoading: true });
    const r2 = renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onRequestFacilities, onSearchMenuTowns }) });
    expect(onRequestFacilities).toHaveBeenCalledTimes(1);
    expect(onSearchMenuTowns).toHaveBeenCalledTimes(1);
    r2.unmount();
    useEmpireStore.getState().setFacilities([{ id: 1, name: 'Farm', x: 1, y: 2, path: '1' }]);
    renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onRequestFacilities }) });
    expect(onRequestFacilities).toHaveBeenCalledTimes(1);
  });

  it('finds one of my facilities by name and navigates to it', () => {
    useEmpireStore.getState().setFacilities([
      { id: 7, name: 'Cotton Farm North', x: 120, y: 340, path: '7' },
      { id: 8, name: 'Steel Mill', x: 5, y: 6, path: '8' },
    ]);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    openPalette();
    type('cotton');
    expect(screen.getByText('My facility: Cotton Farm North')).toBeTruthy();
    expect(screen.queryByText(/Steel Mill/)).toBeNull();
    fireEvent.click(screen.getByText('My facility: Cotton Farm North'));
    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it('finds a town (with its mayor when it has one) and navigates to its hall', () => {
    useSearchStore.getState().setTownsData(TOWNS);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    openPalette();
    type('hel');
    fireEvent.click(screen.getByText('Town: Helartia (mayor SPO_test3)'));
    expect(onNavigateToBuilding).toHaveBeenCalledWith(410, 520);
    act(() => useUiStore.setState({ commandPaletteOpen: true }));
    openPalette();
    type('dun');
    expect(screen.getByText('Town: Dunmore')).toBeTruthy();
  });

  it('"x,y" (or "x y") offers to go to the coordinates; Enter runs the first result', () => {
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    openPalette();
    type('120, 340');
    expect(screen.getByText('Go to (120, 340)')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
    act(() => useUiStore.setState({ commandPaletteOpen: true }));
    openPalette();
    type('7 9');
    expect(screen.getByText('Go to (7, 9)')).toBeTruthy();
  });

  it('arrow keys move the selection and Enter runs the selected command', () => {
    useEmpireStore.getState().setFacilities([{ id: 1, name: 'Alpha', x: 1, y: 1, path: '1' }, { id: 2, name: 'Alps', x: 2, y: 2, path: '2' }]);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<CommandPalette />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    openPalette();
    type('alp');
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigateToBuilding).toHaveBeenCalledWith(2, 2);
  });

  it('Escape typed in the field closes the palette', () => {
    renderWithProviders(<CommandPalette />);
    openPalette();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it('says when nothing matches', () => {
    renderWithProviders(<CommandPalette />);
    openPalette();
    type('zzzzqqq');
    expect(screen.getByText('No commands found')).toBeTruthy();
  });
});
