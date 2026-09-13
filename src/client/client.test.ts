/**
 * setupGameUICallbacks — right-click map context menu wiring only.
 *
 * `StarpeaceClient` is a large god-class instantiated only via `document.getElementById`
 * side effects and a live WebSocket; the private method is exercised the same way
 * renderer-input.test.ts exercises the renderer's private handlers — prototype `.call()`
 * with a fake `this` covering only the fields this method reads.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { StarpeaceClient } from './client';
import { useUiStore } from './store/ui-store';
import { useGameStore } from './store/game-store';

const mockOwnTycoonRenderer = { setOwnTycoonId: jest.fn() };

jest.mock('./ui/map-navigation-ui', () => ({
  MapNavigationUI: jest.fn().mockImplementation(() => ({
    init: jest.fn(() => Promise.resolve()),
    getRenderer: () => mockOwnTycoonRenderer,
    destroy: jest.fn(),
  })),
}));

jest.mock('./ui/minimap-ui', () => ({
  MinimapUI: jest.fn().mockImplementation(() => ({
    setRenderer: jest.fn(),
    destroy: jest.fn(),
  })),
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

describe('applySettings — renderer wiring', () => {
  function makeRenderer() {
    return {
      setHideVegetationOnMove: jest.fn(),
      setDebugMode: jest.fn(),
      setVehicleAnimationsEnabled: jest.fn(),
      setAircraftAnimationsEnabled: jest.fn(),
      setGlassForeignBuildings: jest.fn(),
    };
  }

  it.each([true, false])('wires glassForeignBuildings = %s to the renderer and persists it', (glassForeignBuildings) => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, glassForeignBuildings };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setGlassForeignBuildings).toHaveBeenCalledWith(glassForeignBuildings);
  });
});

describe('switchToGameView — own tycoon id wiring', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("passes the game store's tycoonId to the freshly built renderer", async () => {
    jest.useFakeTimers();
    useGameStore.getState().setCredentials('SPO_test3', '7');

    const fake = {
      uiGamePanel: { style: {} },
      mapNavigationUI: null,
      minimapUI: null,
      currentWorldName: 'planitia',
      storedUsername: 'SPO_test3',
      viewportHeartbeatTimer: undefined,
      setupGameUICallbacks: jest.fn(),
      sendCameraPositionNow: jest.fn(),
      applySettings: jest.fn(),
    };

    await (proto.switchToGameView as (this: typeof fake) => Promise<void>).call(fake);

    expect(mockOwnTycoonRenderer.setOwnTycoonId).toHaveBeenCalledWith('7');
    jest.useRealTimers();
  });
});
