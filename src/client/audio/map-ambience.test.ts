/**
 * Tests for MapAmbience — the legacy curve and the voice pool.
 *
 * The curve functions are pure, so they are checked against the constants Voyager ships
 * (SoundTypes.pas:53-60). The pool is driven through `tick()` with an injected clock and RNG;
 * no real timer runs in these tests.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  MapAmbience,
  ambienceVolume,
  ambiencePan,
  legacyVolumeToGain,
  AMBIENCE_TICK_MS,
  BASE_ZOOM_LEVEL,
  CENTER_PAN,
  LEFT_PAN,
  MAX_AMBIENT_VOICES,
  MAX_HEAR_DIST,
  MAX_VOL,
  MIN_VOL,
  PAN_DEAD_ZONE_PX,
  RIGHT_PAN,
  type AmbienceSink,
  type AmbienceSnapshot,
  type AmbienceSource,
} from './map-ambience';

describe('legacy constants', () => {
  it('carries the SoundTypes.pas tuning values verbatim', () => {
    expect(LEFT_PAN).toBe(-1);
    expect(CENTER_PAN).toBe(0);
    expect(RIGHT_PAN).toBe(1);
    expect(PAN_DEAD_ZONE_PX).toBe(128);
    expect(MIN_VOL).toBe(0.6);
    expect(MAX_VOL).toBe(1);
    expect(MAX_HEAR_DIST).toBe(50);
    expect(BASE_ZOOM_LEVEL).toBe(3);
    expect(MAX_AMBIENT_VOICES).toBe(30);
    expect(AMBIENCE_TICK_MS).toBe(120);
  });
});

describe('ambienceVolume', () => {
  it('is at the ceiling under the listener at the closest zoom', () => {
    expect(ambienceVolume(0, BASE_ZOOM_LEVEL)).toBeCloseTo(MAX_VOL, 10);
  });

  it('falls to the floor at and beyond the max hear distance', () => {
    expect(ambienceVolume(MAX_HEAR_DIST, BASE_ZOOM_LEVEL)).toBeCloseTo(MIN_VOL, 10);
    expect(ambienceVolume(100, BASE_ZOOM_LEVEL)).toBeCloseTo(MIN_VOL, 10);
  });

  it('is linear between the ceiling and the floor', () => {
    expect(ambienceVolume(25, BASE_ZOOM_LEVEL)).toBeCloseTo(0.8, 10);
  });

  it.each([
    [2, 0.9],
    [1, 0.8],
    [0, 0.7],
  ])('loses a quarter of the range per zoom level away from the base (zoom %s)', (zoom, expected) => {
    expect(ambienceVolume(0, zoom)).toBeCloseTo(expected, 10);
  });

  it('never leaves [0, MAX_VOL] over a sweep of distances and zoom levels', () => {
    for (let zoom = 0; zoom <= 3; zoom++) {
      for (let dist = 0; dist <= 120; dist += 1) {
        const v = ambienceVolume(dist, zoom);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MAX_VOL);
      }
    }
  });
});

describe('ambiencePan', () => {
  it('centres a building under the middle of the canvas', () => {
    expect(ambiencePan(512, 1024)).toBe(CENTER_PAN);
  });

  it('centres anything inside the dead zone', () => {
    expect(ambiencePan(512 + PAN_DEAD_ZONE_PX, 1024)).toBe(CENTER_PAN);
    expect(ambiencePan(512 - PAN_DEAD_ZONE_PX, 1024)).toBe(CENTER_PAN);
  });

  it('snaps rather than eases at the dead-zone boundary', () => {
    expect(ambiencePan(512 + 127, 1024)).toBe(CENTER_PAN);
    expect(ambiencePan(512 + 129, 1024)).toBeGreaterThan(0.25);
  });

  it('reaches the extremes at the canvas edges', () => {
    expect(ambiencePan(0, 1024)).toBe(LEFT_PAN);
    expect(ambiencePan(1024, 1024)).toBe(RIGHT_PAN);
  });

  it('clamps a building dragged beyond the canvas into [-1, 1]', () => {
    expect(ambiencePan(-4000, 1024)).toBe(LEFT_PAN);
    expect(ambiencePan(9000, 1024)).toBe(RIGHT_PAN);
  });
});

describe('legacyVolumeToGain', () => {
  it('leaves the ceiling at unity', () => {
    expect(legacyVolumeToGain(MAX_VOL)).toBeCloseTo(1, 10);
  });

  it('maps the 0.6 floor to the -40 dB it means, not 60% amplitude', () => {
    expect(legacyVolumeToGain(MIN_VOL)).toBeCloseTo(0.01, 6);
  });

  it('is monotonic', () => {
    let previous = 0;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const gain = legacyVolumeToGain(v);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
  });
});

// --- The voice pool ---

interface MockSink extends AmbienceSink {
  setLoopVoice: jest.Mock;
  playPositioned: jest.Mock;
  stopLoopVoice: jest.Mock;
  stopAllLoopVoices: jest.Mock;
}

function makeSink(): MockSink {
  return {
    setLoopVoice: jest.fn(),
    playPositioned: jest.fn(),
    stopLoopVoice: jest.fn(),
    stopAllLoopVoices: jest.fn(),
  };
}

function source(overrides: Partial<AmbienceSource> & { key: string }): AmbienceSource {
  return {
    waveFile: 'farm.wav',
    attenuation: 1,
    priority: 0,
    looped: true,
    probability: 1,
    periodMs: 0,
    screenX: 512,
    distance: 0,
    ...overrides,
  };
}

function snapshot(sources: AmbienceSource[]): AmbienceSnapshot {
  return { canvasWidth: 1024, zoomLevel: BASE_ZOOM_LEVEL, sources };
}

describe('MapAmbience', () => {
  let sink: MockSink;
  let clock: number;

  beforeEach(() => {
    sink = makeSink();
    clock = 100000;
  });

  const build = (
    getSnapshot: () => AmbienceSnapshot | null,
    rand: () => number = () => 0
  ) => new MapAmbience(sink, getSnapshot, () => clock, rand);

  it('defaults to enabled', () => {
    expect(build(() => null).isEnabled()).toBe(true);
  });

  it('does nothing when there is no snapshot', () => {
    build(() => null).tick();
    expect(sink.setLoopVoice).not.toHaveBeenCalled();
  });

  it('voices a looped source with the curve gain and pan', () => {
    const ambience = build(() => snapshot([source({ key: '10,20', distance: 0, screenX: 0 })]));
    ambience.tick();

    expect(sink.setLoopVoice).toHaveBeenCalledTimes(1);
    const [key, wave, gain, pan] = sink.setLoopVoice.mock.calls[0] as [string, string, number, number];
    expect(key).toBe('10,20');
    expect(wave).toBe('farm.wav');
    expect(gain).toBeCloseTo(1, 10);
    expect(pan).toBe(LEFT_PAN);
  });

  it('folds the class attenuation into the gain', () => {
    const ambience = build(() =>
      snapshot([source({ key: '1,1', distance: 0, attenuation: 0.5 })])
    );
    ambience.tick();

    const gain = (sink.setLoopVoice.mock.calls[0] as [string, string, number, number])[2];
    expect(gain).toBeCloseTo(legacyVolumeToGain(0.5), 10);
  });

  it('never exceeds the voice cap, however many sources the view holds', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      source({ key: `${i},0`, priority: i, distance: i })
    );
    const ambience = build(() => snapshot(many));
    ambience.tick();

    expect(sink.setLoopVoice.mock.calls.length).toBe(MAX_AMBIENT_VOICES);
  });

  it('keeps the lowest priority first when the cap bites', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      source({ key: `${i},0`, priority: 99 - i })
    );
    const ambience = build(() => snapshot(many));
    ambience.tick();

    const priorities = (sink.setLoopVoice.mock.calls as Array<[string, string, number, number]>)
      .map(call => 99 - Number(call[0].split(',')[0]));
    expect(Math.max(...priorities)).toBeLessThan(MAX_AMBIENT_VOICES);
  });

  it('breaks a priority tie by distance, nearest first', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      source({ key: `${i},0`, priority: 0, distance: 60 - i })
    );
    const ambience = build(() => snapshot(many));
    ambience.tick();

    const keys = (sink.setLoopVoice.mock.calls as Array<[string]>).map(call => call[0]);
    expect(keys[0]).toBe('59,0');
    expect(keys.length).toBe(MAX_AMBIENT_VOICES);
  });

  it('stops a voice whose building has left the view', () => {
    let sources = [source({ key: 'a' }), source({ key: 'b' })];
    const ambience = build(() => snapshot(sources));
    ambience.tick();

    sources = [source({ key: 'a' })];
    ambience.tick();

    expect(sink.stopLoopVoice).toHaveBeenCalledTimes(1);
    expect(sink.stopLoopVoice).toHaveBeenCalledWith('b');
  });

  it('leaves a still-visible voice alone across ticks', () => {
    const ambience = build(() => snapshot([source({ key: 'a' })]));
    ambience.tick();
    ambience.tick();

    expect(sink.stopLoopVoice).not.toHaveBeenCalled();
    expect(sink.setLoopVoice).toHaveBeenCalledTimes(2);
  });

  describe('the retrigger gate', () => {
    const periodic = (probability: number) =>
      source({ key: 'dogs', looped: false, periodMs: 5000, probability, waveFile: 'dogs.wav' });

    it('fires a positioned one-shot on the first pass and then waits out the period', () => {
      const ambience = build(() => snapshot([periodic(1)]));
      ambience.tick();
      expect(sink.playPositioned).toHaveBeenCalledTimes(1);
      expect((sink.playPositioned.mock.calls[0] as [string])[0]).toBe('dogs.wav');

      clock += 4999;
      ambience.tick();
      expect(sink.playPositioned).toHaveBeenCalledTimes(1);

      clock += 2;
      ambience.tick();
      expect(sink.playPositioned).toHaveBeenCalledTimes(2);
    });

    it('rolls the probability and stays silent when the roll fails', () => {
      const ambience = build(() => snapshot([periodic(0.25)]), () => 0.9);
      ambience.tick();
      expect(sink.playPositioned).not.toHaveBeenCalled();
    });

    it('starts no loop voice for a periodic source', () => {
      const ambience = build(() => snapshot([periodic(1)]));
      ambience.tick();
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });

    it('ignores a non-looped source with no period', () => {
      const ambience = build(() =>
        snapshot([source({ key: 'x', looped: false, periodMs: 0 })])
      );
      ambience.tick();
      expect(sink.playPositioned).not.toHaveBeenCalled();
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });
  });

  describe('the sound switch', () => {
    it('stops every voice when turned off, and goes quiet on later ticks', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.tick();

      ambience.setEnabled(false);
      expect(ambience.isEnabled()).toBe(false);
      expect(sink.stopAllLoopVoices).toHaveBeenCalledTimes(1);

      sink.setLoopVoice.mockClear();
      ambience.tick();
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });

    it('re-voices from the live snapshot when turned back on — no reload', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.tick();
      ambience.setEnabled(false);

      ambience.setEnabled(true);
      sink.setLoopVoice.mockClear();
      ambience.tick();

      expect(ambience.isEnabled()).toBe(true);
      expect(sink.setLoopVoice).toHaveBeenCalledWith('a', 'farm.wav', expect.any(Number), expect.any(Number));
    });

    it('does not try to stop a voice it already forgot when turned off and on', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.tick();
      ambience.setEnabled(false);
      ambience.setEnabled(true);
      ambience.tick();

      expect(sink.stopLoopVoice).not.toHaveBeenCalled();
    });
  });

  describe('the mixer tick', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('arms on first interaction and voices every AMBIENCE_TICK_MS', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.initOnInteraction();
      ambience.initOnInteraction(); // idempotent — must not arm a second interval

      jest.advanceTimersByTime(AMBIENCE_TICK_MS * 2);
      expect(sink.setLoopVoice).toHaveBeenCalledTimes(2);
    });

    it('does not arm before an interaction', () => {
      build(() => snapshot([source({ key: 'a' })]));
      jest.advanceTimersByTime(AMBIENCE_TICK_MS * 3);
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });

    it('stays disarmed when re-enabled before any interaction', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.setEnabled(false);
      ambience.setEnabled(true);
      jest.advanceTimersByTime(AMBIENCE_TICK_MS * 3);
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });

    it('does not arm on interaction while sound is off', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.setEnabled(false);
      ambience.initOnInteraction();
      jest.advanceTimersByTime(AMBIENCE_TICK_MS * 3);
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });

    it('releases the tick and stops everything on destroy', () => {
      const ambience = build(() => snapshot([source({ key: 'a' })]));
      ambience.initOnInteraction();
      jest.advanceTimersByTime(AMBIENCE_TICK_MS);
      sink.setLoopVoice.mockClear();

      ambience.destroy();
      jest.advanceTimersByTime(AMBIENCE_TICK_MS * 5);

      expect(sink.stopAllLoopVoices).toHaveBeenCalledTimes(1);
      expect(sink.setLoopVoice).not.toHaveBeenCalled();
    });
  });
});
