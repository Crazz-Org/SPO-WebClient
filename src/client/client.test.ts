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
import { connectionStats } from './connection-stats';

const mockOwnTycoonRenderer = { setOwnTycoonId: jest.fn(), setExploredBlocks: jest.fn() };

jest.mock('./ui/map-navigation-ui', () => ({
  MapNavigationUI: jest.fn().mockImplementation(() => ({
    init: jest.fn(() => Promise.resolve()),
    getRenderer: () => mockOwnTycoonRenderer,
    destroy: jest.fn(),
  })),
}));

jest.mock('./handlers/building-focus-handler', () => ({
  handleMapClick: jest.fn(),
  unfocusBuilding: jest.fn(),
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
      setSignalLosingFacilities: jest.fn(),
      setBuildingAnimationsEnabled: jest.fn(),
      setTransparentOverlays: jest.fn(),
      setHiddenFacIds: jest.fn(),
    };
  }

  it.each([true, false])('wires glassForeignBuildings = %s to the renderer and persists it', (glassForeignBuildings) => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, glassForeignBuildings };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setGlassForeignBuildings).toHaveBeenCalledWith(glassForeignBuildings);
  });

  it.each([true, false])('wires signalLosingFacilities = %s to the renderer', (signalLosingFacilities) => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, signalLosingFacilities };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setSignalLosingFacilities).toHaveBeenCalledWith(signalLosingFacilities);
  });

  it.each([true, false])('wires buildingAnimations = %s to the renderer', (buildingAnimations) => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, buildingAnimations };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setBuildingAnimationsEnabled).toHaveBeenCalledWith(buildingAnimations);
  });

  it.each([true, false])('wires transparentOverlays = %s to the renderer', (transparentOverlays) => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, transparentOverlays };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setTransparentOverlays).toHaveBeenCalledWith(transparentOverlays);
  });

  it('wires hiddenFacIds to the renderer', () => {
    const renderer = makeRenderer();
    const mapNavigationUI = { getRenderer: () => renderer };
    const fake = {
      mapNavigationUI,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, hiddenFacIds: [10, 20] };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(renderer.setHiddenFacIds).toHaveBeenCalledWith([10, 20]);
  });

  it.each([
    [0, 0.7],
    [0.7, 0],
  ])('applies soundVolume = %s and musicVolume = %s to their own players', (soundVolume, musicVolume) => {
    const fake = {
      mapNavigationUI: null,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, soundVolume, musicVolume };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(fake.soundManager.setVolume).toHaveBeenCalledWith(soundVolume);
    expect(fake.musicPlayer.setVolume).toHaveBeenCalledWith(musicVolume);
  });

  it('wires minimapSize/minimapPixelSize and minimapZoom to the docked minimap', () => {
    const fake = {
      mapNavigationUI: null,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: { setSize: jest.fn(), setZoom: jest.fn() },
    };
    const settings = { ...useGameStore.getState().settings, minimapSize: 'large' as const, minimapPixelSize: 260, minimapZoom: 3 };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(fake.minimapUI.setSize).toHaveBeenCalledWith('large', 260);
    expect(fake.minimapUI.setZoom).toHaveBeenCalledWith(3);
  });

  it('disables both players when isSoundEnabled is false', () => {
    const fake = {
      mapNavigationUI: null,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, isSoundEnabled: false };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(fake.soundManager.setEnabled).toHaveBeenCalledWith(false);
    expect(fake.musicPlayer.setEnabled).toHaveBeenCalledWith(false);
  });

  it.each([true, false])('fans the sound switch (%s) out to the map ambience mixer', (isSoundEnabled) => {
    const fake = {
      mapNavigationUI: null,
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      musicPlayer: { setEnabled: jest.fn(), setVolume: jest.fn() },
      mapAmbience: { setEnabled: jest.fn() },
      minimapUI: null,
    };
    const settings = { ...useGameStore.getState().settings, isSoundEnabled };

    (proto.applySettings as (this: typeof fake, s: typeof settings) => void).call(fake, settings);

    expect(fake.mapAmbience.setEnabled).toHaveBeenCalledWith(isSoundEnabled);
  });
});

describe('setupGameUICallbacks — map click one-shots', () => {
  // The one-shot fires before the existing branch, so the branch itself is stubbed out:
  // this test is about the sound, not about focus handling.
  const focusHandler = jest.requireMock('./handlers/building-focus-handler') as {
    handleMapClick: jest.Mock;
    unfocusBuilding: jest.Mock;
  };

  function makeFake() {
    const mapNavigationUI = {
      setOnLoadZone: jest.fn(),
      setOnViewportChanged: jest.fn(),
      setOnBuildingClick: jest.fn(),
      setOnEmptyMapClick: jest.fn(),
      setOnMapContextMenu: jest.fn(),
      setOnFetchFacilityDimensions: jest.fn(),
      getRenderer: () => ({ clearSelectedBuilding: jest.fn() }),
    };
    return {
      mapNavigationUI,
      soundManager: { play: jest.fn() },
      currentBuildingToPlace: null,
    };
  }

  it('plays select.wav when a building is selected', () => {
    const fake = makeFake();
    proto.setupGameUICallbacks.call(fake);

    const onBuildingClick = (fake.mapNavigationUI.setOnBuildingClick.mock.calls[0] as unknown[])[0] as
      (x: number, y: number, visualClass: string) => void;
    onBuildingClick(10, 20, '602');

    expect(fake.soundManager.play).toHaveBeenCalledWith('ui-select');
    expect(focusHandler.handleMapClick).toHaveBeenCalled();
  });

  it('plays click.wav on an empty map click', () => {
    const fake = makeFake();
    proto.setupGameUICallbacks.call(fake);

    const onEmptyMapClick = (fake.mapNavigationUI.setOnEmptyMapClick.mock.calls[0] as unknown[])[0] as () => void;
    onEmptyMapClick();

    expect(fake.soundManager.play).toHaveBeenCalledWith('ui-click');
    expect(focusHandler.unfocusBuilding).toHaveBeenCalled();
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

describe('switchToGameView — explored-blocks wiring', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it("loads the seen-set for the game store's world and player, and attaches it to the renderer", async () => {
    jest.useFakeTimers();
    useGameStore.setState({ worldName: 'planitia' });
    useGameStore.getState().setCredentials('SPO_test3', '7');
    mockOwnTycoonRenderer.setExploredBlocks.mockClear();

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

    expect(mockOwnTycoonRenderer.setExploredBlocks).toHaveBeenCalledTimes(1);
    const attached = mockOwnTycoonRenderer.setExploredBlocks.mock.calls[0][0] as { has: (x: number, y: number) => boolean };
    expect(typeof attached.has).toBe('function');
    jest.useRealTimers();
  });
});

describe('sendRaw / onWsMessage — the single byte-counting taps', () => {
  beforeEach(() => {
    connectionStats.reset();
  });

  it('sendRaw adds the payload byte length and forwards the string untouched', () => {
    const send = jest.fn();
    const fake = { ws: { send } };

    (proto.sendRaw as (this: typeof fake, payload: string) => void).call(fake, '{"type":"X"}');

    expect(send).toHaveBeenCalledWith('{"type":"X"}');
    expect(connectionStats.snapshot().bytesSent).toBe('{"type":"X"}'.length);
  });

  it('onWsMessage counts the raw frame and still dispatches the parsed message', () => {
    const handleMessage = jest.fn();
    const fake = { handleMessage };
    const payload = JSON.stringify({ type: 'EVENT_REFRESH_DATE', dateDouble: 1 });

    (proto.onWsMessage as (this: typeof fake, event: MessageEvent) => void).call(
      fake,
      { data: payload } as MessageEvent,
    );

    expect(handleMessage).toHaveBeenCalledWith({ type: 'EVENT_REFRESH_DATE', dateDouble: 1 });
    expect(connectionStats.snapshot().bytesReceived).toBe(payload.length);
  });

  it('counts and swallows a malformed frame', () => {
    const handleMessage = jest.fn();
    const fake = { handleMessage };
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (proto.onWsMessage as (this: typeof fake, event: MessageEvent) => void).call(
      fake,
      { data: 'not json' } as MessageEvent,
    );

    expect(handleMessage).not.toHaveBeenCalled();
    expect(connectionStats.snapshot().bytesReceived).toBe('not json'.length);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
