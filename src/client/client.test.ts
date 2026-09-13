/**
 * setupGameUICallbacks — right-click map context menu wiring, the click/selection
 * one-shots, and applySettings' audio wiring.
 *
 * `StarpeaceClient` is a large god-class instantiated only via `document.getElementById`
 * side effects and a live WebSocket; the private methods are exercised the same way
 * renderer-input.test.ts exercises the renderer's private handlers — prototype `.call()`
 * with a fake `this` covering only the fields the method reads.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { StarpeaceClient } from './client';
import { useUiStore } from './store/ui-store';
import { useGameStore } from './store/game-store';

jest.mock('./handlers/building-focus-handler', () => ({
  handleMapClick: jest.fn(),
  unfocusBuilding: jest.fn(),
}));
jest.mock('./handlers/build-menu-handler', () => ({
  placeBuilding: jest.fn(),
}));

const proto = StarpeaceClient.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

describe('setupGameUICallbacks — map context menu', () => {
  beforeEach(() => {
    useUiStore.getState().closeMapContextMenu();
  });

  it('reads the tile anchor from the renderer and opens the ui-store menu', () => {
    const anchor = { tileX: 3, tileY: 4, layer: 'building' as const, visualClass: '100' };
    const renderer = { getCanvasAnchorAt: jest.fn((_clientX: number, _clientY: number) => anchor) };
    const mapNavigationUI = {
      setOnLoadZone: jest.fn(),
      setOnViewportChanged: jest.fn(),
      setOnBuildingClick: jest.fn(),
      setOnEmptyMapClick: jest.fn(),
      setOnMapContextMenu: jest.fn(),
      setOnFetchFacilityDimensions: jest.fn(),
      getRenderer: () => renderer,
    };
    const fake = { mapNavigationUI };

    proto.setupGameUICallbacks.call(fake);

    expect(mapNavigationUI.setOnMapContextMenu).toHaveBeenCalledTimes(1);
    const onMapContextMenu = (mapNavigationUI.setOnMapContextMenu.mock.calls[0] as unknown[])[0] as (clientX: number, clientY: number) => void;
    onMapContextMenu(120, 80);

    expect(renderer.getCanvasAnchorAt).toHaveBeenCalledWith(120, 80);
    expect(useUiStore.getState().mapContextMenu).toEqual({
      clientX: 120, clientY: 80, tileX: 3, tileY: 4, layer: 'building', visualClass: '100',
    });
  });

  it('does nothing when the renderer is not available', () => {
    const mapNavigationUI = {
      setOnLoadZone: jest.fn(),
      setOnViewportChanged: jest.fn(),
      setOnBuildingClick: jest.fn(),
      setOnEmptyMapClick: jest.fn(),
      setOnMapContextMenu: jest.fn(),
      setOnFetchFacilityDimensions: jest.fn(),
      getRenderer: () => null,
    };
    const fake = { mapNavigationUI };

    proto.setupGameUICallbacks.call(fake);

    const onMapContextMenu = (mapNavigationUI.setOnMapContextMenu.mock.calls[0] as unknown[])[0] as (clientX: number, clientY: number) => void;
    onMapContextMenu(120, 80);

    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });
});

describe('setupGameUICallbacks — the click and selection one-shots', () => {
  function wire(currentBuildingToPlace: unknown) {
    const soundManager = { play: jest.fn() };
    const renderer = { clearSelectedBuilding: jest.fn(), worldToScreen: jest.fn(), worldToScreenCentered: jest.fn() };
    const mapNavigationUI = {
      setOnLoadZone: jest.fn(),
      setOnViewportChanged: jest.fn(),
      setOnBuildingClick: jest.fn(),
      setOnEmptyMapClick: jest.fn(),
      setOnMapContextMenu: jest.fn(),
      setOnFetchFacilityDimensions: jest.fn(),
      getRenderer: () => renderer,
    };
    const fake = { mapNavigationUI, soundManager, currentBuildingToPlace };

    proto.setupGameUICallbacks.call(fake);

    return {
      soundManager,
      onBuildingClick: (mapNavigationUI.setOnBuildingClick.mock.calls[0] as unknown[])[0] as
        (x: number, y: number, visualClass: string) => void,
      onEmptyMapClick: (mapNavigationUI.setOnEmptyMapClick.mock.calls[0] as unknown[])[0] as () => void,
    };
  }

  it('plays the selection sound when a building is selected', () => {
    const { soundManager, onBuildingClick } = wire(null);
    onBuildingClick(4, 5, '601');
    expect(soundManager.play).toHaveBeenCalledWith('ui-select');
  });

  it('plays the click sound when the click places a building instead', () => {
    const { soundManager, onBuildingClick } = wire({ facilityClass: 'x' });
    onBuildingClick(4, 5, '601');
    expect(soundManager.play).toHaveBeenCalledWith('ui-click');
  });

  it('plays the click sound on bare ground', () => {
    const { soundManager, onEmptyMapClick } = wire(null);
    onEmptyMapClick();
    expect(soundManager.play).toHaveBeenCalledWith('ui-click');
  });
});

describe('applySettings — audio', () => {
  const settings = {
    isVegetationHiddenOnMove: false,
    vehicleAnimations: true,
    aircraftAnimations: true,
    isSoundEnabled: false,
    soundVolume: 0.25,
    isDebugOverlay: false,
    minimapSize: 'medium' as const,
    languageId: useGameStore.getState().settings.languageId,
  };

  it('hands the enable switch to both the one-shot manager and the map mixer', () => {
    const soundManager = { setEnabled: jest.fn(), setVolume: jest.fn() };
    const mapSoundMixer = { setEnabled: jest.fn() };
    const fake = { mapNavigationUI: null, minimapUI: null, soundManager, mapSoundMixer };

    proto.applySettings.call(fake, settings);

    expect(soundManager.setEnabled).toHaveBeenCalledWith(false);
    expect(soundManager.setVolume).toHaveBeenCalledWith(0.25);
    expect(mapSoundMixer.setEnabled).toHaveBeenCalledWith(false);
  });

  it('re-enables the map mixer when sound is turned back on', () => {
    const soundManager = { setEnabled: jest.fn(), setVolume: jest.fn() };
    const mapSoundMixer = { setEnabled: jest.fn() };
    const fake = { mapNavigationUI: null, minimapUI: null, soundManager, mapSoundMixer };

    proto.applySettings.call(fake, { ...settings, isSoundEnabled: true });

    expect(mapSoundMixer.setEnabled).toHaveBeenCalledWith(true);
  });
});
