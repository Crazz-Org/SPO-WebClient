/**
 * LegacyGameChrome — every toolbar icon, the StatusPanel buttons, the overlay picker and the
 * chat line's `/` commands.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useGameStore } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { useMapStore } from '../../../store/map-store';
import { useChatStore } from '../../../store/chat-store';
import { useSearchStore } from '../../../store/search-store';
import { useBuildingStore } from '../../../store/building-store';
import type { TownInfo, BuildingFocusInfo } from '@/shared/types';
import { LegacyGameChrome } from './LegacyGameChrome';

function fakeSource(camera = { x: 100, y: 100 }) {
  return { getCameraPosition: () => camera, centerOn: jest.fn() };
}

function town(name: string, x: number, y: number): TownInfo {
  return { name, iconUrl: '', mayor: null, population: 0, unemploymentPercent: 0, qualityOfLife: 0, x, y, path: '', classId: '' };
}

function typeChat(text: string) {
  const input = screen.getByPlaceholderText('Enter chat text here...');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

let openSpy: jest.SpiedFunction<typeof window.open>;

beforeEach(() => {
  resetStores();
  useUiStore.getState().clearSurfaces();
  useMapStore.getState().reset();
  useGameStore.setState({ username: 'danieleder', isVisitor: false, activeOverlay: null, isCityZonesEnabled: false });
  useChatStore.setState({ currentChannel: 'Lobby' });
  openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
});

describe('LegacyGameChrome toolbar', () => {
  it('each icon does its job', () => {
    const onRefreshMap = jest.fn();
    const onSwitchServer = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onRefreshMap, onSwitchServer }) });

    fireEvent.click(screen.getByLabelText('Refresh all views'));
    expect(onRefreshMap).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Starpeace Online Home Page'));
    fireEvent.click(screen.getByLabelText('Support'));
    expect(openSpy).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('Universe View'));
    expect(onSwitchServer).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Display Build menu'));
    expect(useUiStore.getState().stack.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Map view'));
    fireEvent.click(screen.getByLabelText('Favorites'));
    expect(useUiStore.getState().leftPanel).toBe('facilities');
    fireEvent.click(screen.getByLabelText('Map view'));
    fireEvent.click(screen.getByLabelText('User Profile'));
    expect(useUiStore.getState().leftPanel).toBe('empire');
    fireEvent.click(screen.getByLabelText('Map view'));
    fireEvent.click(screen.getByLabelText('Search the Web'));
    expect(useUiStore.getState().rightPanel).toBe('search');
    fireEvent.click(screen.getByLabelText('Options'));
    expect(useUiStore.getState().modal).toBe('settings');
  });

  it('the name in the tycoon block opens the profile', () => {
    useGameStore.setState({
      tycoonStats: { username: 'danieleder', ranking: 1, cash: '0', incomePerHour: '0', buildingCount: 0, maxBuildings: 50, failureLevel: 0 },
    });
    renderWithProviders(<LegacyGameChrome />);
    fireEvent.click(screen.getByTitle('Open profile'));
    expect(useUiStore.getState().leftPanel).toBe('empire');
  });
});

describe('LegacyGameChrome StatusPanel', () => {
  it('zooms out and rotates counter-clockwise', () => {
    const onZoomOut = jest.fn();
    const onRotateCCW = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onZoomOut, onRotateCCW }) });
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByLabelText('Rotate CCW'));
    expect(onZoomOut).toHaveBeenCalled();
    expect(onRotateCCW).toHaveBeenCalled();
  });

  it('INSPECT opens the focused facility', () => {
    const onInspectFocusedBuilding = jest.fn();
    useBuildingStore.setState({
      focusedBuilding: { buildingId: '1', buildingName: 'Farm', ownerName: 'x', salesInfo: '', revenue: '', detailsText: '', hintsText: '', x: 1, y: 1, xsize: 1, ysize: 1, visualClass: '' } as BuildingFocusInfo,
    });
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onInspectFocusedBuilding }) });
    fireEvent.click(screen.getByText('INSPECT'));
    expect(onInspectFocusedBuilding).toHaveBeenCalled();
  });

  it('BACK and NEXT walk the camera history', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src as never);
    useMapStore.getState().recordPosition(10, 10);
    useMapStore.getState().recordPosition(500, 500);
    renderWithProviders(<LegacyGameChrome />);
    fireEvent.click(screen.getByText('< BACK'));
    expect(src.centerOn).toHaveBeenLastCalledWith(10, 10);
    fireEvent.click(screen.getByText('NEXT >'));
    expect(src.centerOn).toHaveBeenLastCalledWith(500, 500);
  });

  it('GO TOWN HALL goes to the nearest hall, asking for the towns first when none are loaded', () => {
    const onSearchMenuTowns = jest.fn();
    const onNavigateToBuilding = jest.fn();
    useMapStore.getState().setSource(fakeSource({ x: 100, y: 100 }) as never);
    renderWithProviders(<LegacyGameChrome />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuTowns, onNavigateToBuilding }),
    });
    fireEvent.click(screen.getByText('GO TOWN HALL'));
    expect(onSearchMenuTowns).toHaveBeenCalled();
    expect(onNavigateToBuilding).not.toHaveBeenCalled();
    act(() => {
      useSearchStore.getState().setTownsData({ towns: [town('Far', 900, 900), town('Near', 110, 95)] } as never);
    });
    expect(onNavigateToBuilding).toHaveBeenCalledWith(110, 95);
    fireEvent.click(screen.getByText('GO TOWN HALL'));
    expect(onNavigateToBuilding).toHaveBeenCalledTimes(2);
  });

  it('GO TOWN HALL does nothing without a map', () => {
    const onSearchMenuTowns = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onSearchMenuTowns }) });
    fireEvent.click(screen.getByText('GO TOWN HALL'));
    expect(onSearchMenuTowns).not.toHaveBeenCalled();
  });
});

describe('LegacyGameChrome overlay picker', () => {
  it('NONE clears the overlay and the zones; Building Zones turns the zones on', () => {
    const onSetOverlay = jest.fn();
    const onToggleCityZones = jest.fn();
    useGameStore.setState({ isCityZonesEnabled: true });
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onSetOverlay, onToggleCityZones }) });
    fireEvent.click(screen.getByText('OVERLAY'));
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'NONE' } });
    expect(onSetOverlay).toHaveBeenCalledWith(null);
    expect(onToggleCityZones).toHaveBeenCalledTimes(1);
    act(() => { useGameStore.setState({ isCityZonesEnabled: false }); });
    fireEvent.change(select, { target: { value: 'ZONES' } });
    expect(onToggleCityZones).toHaveBeenCalledTimes(2);
  });

  it('Signal losing facilities saves the setting', () => {
    const onSettingsChange = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onSettingsChange }) });
    fireEvent.click(screen.getByText('OVERLAY'));
    fireEvent.click(screen.getByLabelText('Signal losing facilities'));
    expect(useGameStore.getState().settings.signalLosingFacilities).toBe(true);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ signalLosingFacilities: true }));
  });
});

describe('LegacyGameChrome chat line commands', () => {
  it('/go moves the camera, a bad /go explains itself, /afk goes away; none is spoken', () => {
    const onSendChatMessage = jest.fn();
    const onChatAway = jest.fn();
    const onChatTypingChange = jest.fn();
    const src = fakeSource();
    useMapStore.getState().setSource(src as never);
    renderWithProviders(<LegacyGameChrome />, {
      clientCallbacks: createSpiedCallbacks({ onSendChatMessage, onChatAway, onChatTypingChange }),
    });
    typeChat('/go 10,20');
    expect(src.centerOn).toHaveBeenCalledWith(10, 20);
    expect(onChatTypingChange).toHaveBeenCalledWith(false);
    typeChat('/go nowhere');
    expect(useChatStore.getState().messages.Lobby?.at(-1)?.text).toBe('Usage: /go x,y');
    typeChat('/afk');
    expect(onChatAway).toHaveBeenCalled();
    typeChat('   ');
    expect(onSendChatMessage).not.toHaveBeenCalled();
  });
});
