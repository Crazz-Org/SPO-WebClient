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
import type { GameSettings } from './store/game-store';

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

describe('applySettings', () => {
  const memoryStore = new Map<string, string>();
  function installStorage() {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => { memoryStore.set(k, v); },
      removeItem: (k: string) => { memoryStore.delete(k); },
    };
  }

  beforeEach(() => {
    memoryStore.clear();
    installStorage();
  });
  afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

  const baseSettings: GameSettings = {
    isVegetationHiddenOnMove: false,
    vehicleAnimations: true,
    buildingAnimations: true,
    transparentOverlays: true,
    isSoundEnabled: true,
    soundVolume: 0.5,
    isDebugOverlay: false,
    minimapSize: 'medium',
    languageId: 'en',
  };

  function makeFake() {
    const renderer = {
      setHideVegetationOnMove: jest.fn(),
      setDebugMode: jest.fn(),
      setVehicleAnimationsEnabled: jest.fn(),
      setBuildingAnimationsEnabled: jest.fn(),
      setTransparentOverlays: jest.fn(),
    };
    const fake = {
      mapNavigationUI: { getRenderer: () => renderer },
      soundManager: { setEnabled: jest.fn(), setVolume: jest.fn() },
      minimapUI: { setSize: jest.fn() },
    };
    return { fake, renderer };
  }

  it('forwards buildingAnimations and transparentOverlays to the renderer when both are off', () => {
    const { fake, renderer } = makeFake();
    const settings: GameSettings = { ...baseSettings, buildingAnimations: false, transparentOverlays: false };

    proto.applySettings.call(fake, settings);

    expect(renderer.setBuildingAnimationsEnabled).toHaveBeenCalledWith(false);
    expect(renderer.setTransparentOverlays).toHaveBeenCalledWith(false);
  });

  it('forwards both flags when on, and persists both through spo_settings', () => {
    const { fake, renderer } = makeFake();
    const settings: GameSettings = { ...baseSettings, buildingAnimations: true, transparentOverlays: true };

    proto.applySettings.call(fake, settings);

    expect(renderer.setBuildingAnimationsEnabled).toHaveBeenCalledWith(true);
    expect(renderer.setTransparentOverlays).toHaveBeenCalledWith(true);

    const stored = JSON.parse(memoryStore.get('spo_settings') ?? '{}') as Partial<GameSettings>;
    expect(stored.buildingAnimations).toBe(true);
    expect(stored.transparentOverlays).toBe(true);
  });

  it('persists both flags when off', () => {
    const { fake } = makeFake();
    const settings: GameSettings = { ...baseSettings, buildingAnimations: false, transparentOverlays: false };

    proto.applySettings.call(fake, settings);

    const stored = JSON.parse(memoryStore.get('spo_settings') ?? '{}') as Partial<GameSettings>;
    expect(stored.buildingAnimations).toBe(false);
    expect(stored.transparentOverlays).toBe(false);
  });
});
