/**
 * Tests for the renderer's map-sound wiring (updateMapSounds / setMapSoundMixer). The
 * monolith is too heavy to instantiate, so the methods are exercised via prototype
 * `.call()` with a crafted host — the pattern renderer-aircraft.test.ts uses here.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { SoundScene, SOUND_TICK_MS, ambientPan } from '../audio/map-sound-mixer';
import { FacilityDimensions, MapBuilding } from '../../shared/types';

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

const MINE_SOUND = {
  waveFile: 'mine.wav', attenuation: 1, priority: 0, looped: true, probability: 1, period: 0,
};

function dims(visualClass: string, xsize: number, ysize: number, withSound: boolean): FacilityDimensions {
  return {
    visualClass, name: `n${visualClass}`, facid: '', xsize, ysize, level: 0,
    ...(withSound ? { sound: MINE_SOUND } : {}),
  };
}

function building(visualClass: string, x: number, y: number): MapBuilding {
  return { visualClass, tycoonId: 1, options: 0, x, y, level: 0, alert: false, attack: 0 };
}

type FakeMixer = { setScene: jest.Mock };

type Host = {
  mapSoundMixer: FakeMixer | null;
  lastMapSoundSceneTime: number;
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, FacilityDimensions>;
  terrainRenderer: {
    getCameraPosition: () => { i: number; j: number };
    mapToScreen: (i: number, j: number) => { x: number; y: number };
    getZoomLevel: () => number;
  };
  canvas: { width: number };
};

function makeHost(buildings: MapBuilding[], mixer: FakeMixer | null): Host {
  return {
    mapSoundMixer: mixer,
    lastMapSoundSceneTime: 0,
    allBuildings: buildings,
    facilityDimensionsCache: new Map([
      ['sounding', dims('sounding', 2, 2, true)],
      ['silent', dims('silent', 2, 2, false)],
    ]),
    terrainRenderer: {
      getCameraPosition: () => ({ i: 10, j: 10 }),
      mapToScreen: (i: number, j: number) => ({ x: 400 + j * 10, y: 300 + i * 10 }),
      getZoomLevel: () => 3,
    },
    canvas: { width: 800 },
  };
}

function updateMapSounds(host: Host): void {
  (proto.updateMapSounds as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function lastScene(mixer: FakeMixer): SoundScene {
  const calls = mixer.setScene.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as SoundScene;
}

describe('updateMapSounds', () => {
  let nowSpy: jest.SpiedFunction<typeof performance.now>;
  let now: number;

  beforeEach(() => {
    now = 100_000;
    nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('emits only visible buildings whose class carries a sound', () => {
    const mixer: FakeMixer = { setScene: jest.fn() };
    const host = makeHost(
      [building('sounding', 5, 6), building('silent', 5, 6), building('sounding', 100, 100)],
      mixer
    );

    updateMapSounds(host);

    const scene = lastScene(mixer);
    expect(scene.sources.length).toBe(1);
    expect(scene.sources[0]).toEqual({
      key: '5,6',
      sound: MINE_SOUND,
      screenX: 460,       // mapToScreen(7, 6).x — the centre tile
      distTiles: 5,       // camera (10,10) to centre (7,6)
    });
    expect(scene.zoomLevel).toBe(3);
    expect(scene.screenWidth).toBe(800);
    // The emitted screenX is what the pan curve consumes
    expect(ambientPan(scene.sources[0].screenX, scene.screenWidth)).toBe(0);
  });

  it('emits nothing for a building whose class is not in the dimensions cache', () => {
    const mixer: FakeMixer = { setScene: jest.fn() };
    const host = makeHost([building('unknown', 5, 6)], mixer);

    updateMapSounds(host);

    expect(lastScene(mixer).sources).toEqual([]);
  });

  it('throttles to one scene per SOUND_TICK_MS', () => {
    const mixer: FakeMixer = { setScene: jest.fn() };
    const host = makeHost([building('sounding', 5, 6)], mixer);

    updateMapSounds(host);
    expect(mixer.setScene).toHaveBeenCalledTimes(1);

    now += SOUND_TICK_MS - 1;
    updateMapSounds(host);
    expect(mixer.setScene).toHaveBeenCalledTimes(1);

    now += 1;
    updateMapSounds(host);
    expect(mixer.setScene).toHaveBeenCalledTimes(2);
  });

  it('does nothing and does not throw without a mixer attached', () => {
    const host = makeHost([building('sounding', 5, 6)], null);
    expect(() => updateMapSounds(host)).not.toThrow();
    expect(host.lastMapSoundSceneTime).toBe(0);
  });
});

describe('setMapSoundMixer', () => {
  it('stores the mixer and detaches it again on null', () => {
    const mixer: FakeMixer = { setScene: jest.fn() };
    const host = makeHost([], null);

    (proto.setMapSoundMixer as (this: Host, m: unknown) => void).call(host, mixer);
    expect(host.mapSoundMixer).toBe(mixer);

    (proto.setMapSoundMixer as (this: Host, m: unknown) => void).call(host, null);
    expect(host.mapSoundMixer).toBeNull();
  });
});
