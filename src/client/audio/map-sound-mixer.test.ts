/**
 * Tests for MapSoundMixer — the curve at the cited legacy constants, the ranking, the
 * hard voice cap, the missing-wave memory, the enable switch and the re-trigger rule.
 *
 * Node environment: the mixer makes no Web Audio call of its own, so a fake
 * AmbientAudioBackend is all that is needed.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  MapSoundMixer,
  AmbientAudioBackend,
  VoiceHandle,
  SoundSource,
  ambientGain,
  ambientPan,
  tileDistance,
  MAX_VOICES,
  SOUND_TICK_MS,
} from './map-sound-mixer';
import { FacilityAmbientSound } from '../../shared/types/domain-types';

// --- Fake backend ---

interface StartedVoice {
  buffer: AudioBuffer;
  looped: boolean;
  gain: number;
  pan: number;
  setGain: jest.Mock;
  setPan: jest.Mock;
  stop: jest.Mock;
  /** Simulate the voice finishing by itself */
  end: () => void;
}

class FakeBackend implements AmbientAudioBackend {
  public ready = true;
  public loadCalls: string[] = [];
  public missingFiles = new Set<string>();
  public rejectFiles = new Set<string>();
  public startReturnsNull = false;
  public started: StartedVoice[] = [];
  /** One per tick that got as far as asking — how the interval count is observed */
  public readyCalls = 0;

  isReady(): boolean {
    this.readyCalls++;
    return this.ready;
  }

  loadBuffer(filename: string): Promise<AudioBuffer | null> {
    this.loadCalls.push(filename);
    if (this.rejectFiles.has(filename)) return Promise.reject(new Error('boom'));
    if (this.missingFiles.has(filename)) return Promise.resolve(null);
    return Promise.resolve({ duration: 1, filename } as unknown as AudioBuffer);
  }

  startVoice(
    buffer: AudioBuffer,
    looped: boolean,
    gain: number,
    pan: number,
    onEnded: () => void
  ): VoiceHandle | null {
    if (this.startReturnsNull) return null;
    const voice: StartedVoice = {
      buffer, looped, gain, pan,
      setGain: jest.fn(), setPan: jest.fn(), stop: jest.fn(),
      end: onEnded,
    };
    this.started.push(voice);
    return {
      setGain: (g: number) => voice.setGain(g),
      setPan: (p: number) => voice.setPan(p),
      stop: () => voice.stop(),
    };
  }

  loadCountFor(filename: string): number {
    return this.loadCalls.filter(f => f === filename).length;
  }
}

const LOOPED: FacilityAmbientSound = {
  waveFile: 'mine.wav', attenuation: 1, priority: 0, looped: true, probability: 1, period: 0,
};

function makeSound(overrides: Partial<FacilityAmbientSound> = {}): FacilityAmbientSound {
  return { ...LOOPED, ...overrides };
}

function makeSource(
  key: string,
  distTiles: number,
  sound: FacilityAmbientSound = LOOPED,
  screenX = 400
): SoundSource {
  return { key, sound, screenX, distTiles };
}

/** Let the loadBuffer promises settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// =============================================================================
// PURE CURVE FUNCTIONS
// =============================================================================

describe('ambientGain — Map.pas:8405-8409 at the cited constants', () => {
  it('is MAX_VOL on the camera cell at the basic zoom', () => {
    expect(ambientGain(0, 3)).toBe(1);
  });

  it('ramps linearly to the midpoint at half the max hear distance', () => {
    expect(ambientGain(25, 3)).toBeCloseTo(0.8, 10);
  });

  it('is MIN_VOL exactly at the max hear distance (50 tiles)', () => {
    expect(ambientGain(50, 3)).toBe(0.6);
  });

  it('stays at MIN_VOL past the max hear distance', () => {
    expect(ambientGain(120, 3)).toBe(0.6);
  });

  it('removes one zoom step of the ramp per level away from the basic zoom', () => {
    expect(ambientGain(0, 1)).toBeCloseTo(0.8, 10); // |1-3| * 0.25 = 0.5 of the ramp
    expect(ambientGain(0, 0)).toBeCloseTo(0.7, 10); // |0-3| * 0.25 = 0.25 of the ramp
    expect(ambientGain(0, 2)).toBeCloseTo(0.9, 10);
  });

  it('never exceeds MAX_VOL, even at a negative distance', () => {
    expect(ambientGain(-100, 3)).toBe(1);
  });
});

describe('ambientPan — Map.pas:8398-8401', () => {
  it('is dead centre on the canvas centre', () => {
    expect(ambientPan(400, 800)).toBe(0);
  });

  it('is dead centre anywhere inside the ±128 px dead zone', () => {
    expect(ambientPan(500, 800)).toBe(0);
    expect(ambientPan(300, 800)).toBe(0);
  });

  it('is hard left at x = 0 and hard right at x = width', () => {
    expect(ambientPan(0, 800)).toBe(-1);
    expect(ambientPan(800, 800)).toBe(1);
  });

  it('places a building three quarters across at +0.5', () => {
    expect(ambientPan(600, 800)).toBe(0.5);
  });

  it('clamps a position off the left edge to -1', () => {
    expect(ambientPan(-50, 800)).toBe(-1);
  });
});

describe('tileDistance — Map.pas:8402-8404', () => {
  it('is 0 when the camera cell is the building centre', () => {
    expect(tileDistance(12, 22, { x: 20, y: 10, xsize: 5, ysize: 5 })).toBe(0);
  });

  it('is Euclidean in map cells', () => {
    expect(tileDistance(0, 0, { x: 4, y: 3, xsize: 1, ysize: 1 })).toBe(5);
  });

  it('offsets by floor(size / 2) on each axis', () => {
    expect(tileDistance(0, 0, { x: 0, y: 0, xsize: 4, ysize: 4 })).toBeCloseTo(Math.sqrt(8), 10);
  });
});

// =============================================================================
// THE MIXER
// =============================================================================

describe('MapSoundMixer', () => {
  let backend: FakeBackend;
  let mixer: MapSoundMixer;
  let now: number;
  let roll: number;

  beforeEach(() => {
    backend = new FakeBackend();
    now = 1_000_000;
    roll = 0;
    mixer = new MapSoundMixer(backend, { now: () => now, random: () => roll });
  });

  /** One tick to request the buffers, one to register and start the voices. */
  async function settle(): Promise<void> {
    mixer.tick();
    await flush();
    mixer.tick();
  }

  describe('the voice cap', () => {
    it('never registers more than MAX_VOICES voices, however many sources are in the scene', async () => {
      const sources = Array.from({ length: 100 }, (_, i) => makeSource(`s${i}`, i));
      mixer.setScene({ sources, zoomLevel: 3, screenWidth: 800 });

      await settle();

      expect(mixer.getVoiceCount()).toBe(MAX_VOICES);
      expect(backend.started.length).toBe(MAX_VOICES);

      // Still capped after further ticks
      mixer.tick();
      mixer.tick();
      expect(mixer.getVoiceCount()).toBe(MAX_VOICES);
      expect(backend.started.length).toBe(MAX_VOICES);
    });

    it('keeps the nearest sources when every class carries the same priority', async () => {
      const sources = Array.from({ length: 100 }, (_, i) => makeSource(`s${i}`, 100 - i));
      mixer.setScene({ sources, zoomLevel: 3, screenWidth: 800 });

      await settle();

      // distances 1..30 are keys s99 down to s70
      expect(mixer.getVoiceCount()).toBe(MAX_VOICES);
      const loudest = backend.started.map(v => v.gain).sort((a, b) => b - a)[0];
      expect(loudest).toBeCloseTo(ambientGain(1, 3), 10);
    });

    it('lets a lower priority number win over a nearer source (SoundMixer.pas:72)', async () => {
      const near = makeSource('loud-but-deprioritised', 0, makeSound({ priority: 1 }));
      const far = Array.from({ length: MAX_VOICES }, (_, i) =>
        makeSource(`prio0-${i}`, 40 + i, makeSound({ priority: 0 }))
      );
      mixer.setScene({ sources: [near, ...far], zoomLevel: 3, screenWidth: 800 });

      await settle();

      expect(mixer.getVoiceCount()).toBe(MAX_VOICES);
      expect(mixer.getActiveHandleCount()).toBe(MAX_VOICES);
      // The prio=1 source got no voice — all 30 slots went to the prio=0 ones.
      expect(backend.started.every(v => v.gain <= ambientGain(40, 3))).toBe(true);
    });
  });

  describe('scene churn', () => {
    it('stops and forgets a voice whose building left the scene, and restarts it on return', async () => {
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      await settle();
      expect(mixer.getVoiceCount()).toBe(1);
      const first = backend.started[0];

      mixer.setScene({ sources: [], zoomLevel: 3, screenWidth: 800 });
      mixer.tick();
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(mixer.getVoiceCount()).toBe(0);

      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      mixer.tick();
      expect(mixer.getVoiceCount()).toBe(1);
      expect(backend.started.length).toBe(2);
      // No second load — the buffer is still cached
      expect(backend.loadCountFor('mine.wav')).toBe(1);
    });

    it('creates no voice when the buffer arrives after the source dropped out', async () => {
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      mixer.tick(); // requests the load

      mixer.setScene({ sources: [], zoomLevel: 3, screenWidth: 800 });
      await flush();
      mixer.tick();

      expect(mixer.getVoiceCount()).toBe(0);
      expect(backend.started.length).toBe(0);
    });

    it('re-aims gain and pan on the existing handle as the camera moves', async () => {
      mixer.setScene({ sources: [makeSource('a', 0, LOOPED, 400)], zoomLevel: 3, screenWidth: 800 });
      await settle();
      const voice = backend.started[0];

      mixer.setScene({ sources: [makeSource('a', 25, LOOPED, 800)], zoomLevel: 3, screenWidth: 800 });
      mixer.tick();

      expect(voice.setGain).toHaveBeenCalledWith(ambientGain(25, 3));
      expect(voice.setPan).toHaveBeenCalledWith(1);
      expect(backend.started.length).toBe(1); // no restart
    });

    it('multiplies the per-class attenuation into the gain (Map.pas:7725)', async () => {
      mixer.setScene({
        sources: [makeSource('a', 0, makeSound({ attenuation: 0.5 }))],
        zoomLevel: 3, screenWidth: 800,
      });
      await settle();
      expect(backend.started[0].gain).toBeCloseTo(0.5, 10);
    });
  });

  describe('a wave the server does not have', () => {
    it('is asked for once, then never again, and never occupies a slot', async () => {
      backend.missingFiles.add('jackhammer.wav');
      const ghosts = Array.from({ length: 60 }, (_, i) =>
        makeSource(`ghost${i}`, i, makeSound({ waveFile: 'jackhammer.wav' }))
      );
      const real = Array.from({ length: 40 }, (_, i) => makeSource(`real${i}`, 50 + i));
      mixer.setScene({ sources: [...ghosts, ...real], zoomLevel: 3, screenWidth: 800 });

      await settle();
      mixer.tick();
      await flush();
      mixer.tick();

      expect(backend.loadCountFor('jackhammer.wav')).toBe(1);
      expect(mixer.getVoiceCount()).toBe(MAX_VOICES);
      expect(backend.started.every(v => (v.buffer as unknown as { filename: string }).filename === 'mine.wav')).toBe(true);
    });

    it('treats a rejected load as missing too', async () => {
      backend.rejectFiles.add('mine.wav');
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });

      await settle();
      mixer.tick();

      expect(backend.loadCountFor('mine.wav')).toBe(1);
      expect(mixer.getVoiceCount()).toBe(0);
    });
  });

  describe('the sound switch', () => {
    it('stops every voice when turned off and resumes without a reload when turned on', async () => {
      const sources = [makeSource('a', 0), makeSource('b', 5)];
      mixer.setScene({ sources, zoomLevel: 3, screenWidth: 800 });
      await settle();
      expect(mixer.getVoiceCount()).toBe(2);
      const [first, second] = backend.started;

      mixer.setEnabled(false);
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(second.stop).toHaveBeenCalledTimes(1);
      expect(mixer.getVoiceCount()).toBe(0);
      expect(mixer.isEnabled()).toBe(false);

      // A tick while off does nothing at all
      mixer.tick();
      expect(mixer.getVoiceCount()).toBe(0);
      const loadsWhileOff = backend.loadCalls.length;

      mixer.setEnabled(true);
      mixer.tick();
      expect(mixer.getVoiceCount()).toBe(2);
      expect(backend.loadCalls.length).toBe(loadsWhileOff); // buffers still cached
      expect(backend.started.length).toBe(4);
    });

    it('ignores a redundant setEnabled with the same value', async () => {
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      await settle();
      mixer.setEnabled(true);
      expect(backend.started[0].stop).not.toHaveBeenCalled();
      expect(mixer.getVoiceCount()).toBe(1);
    });

    it('does nothing at all while the backend is not ready', async () => {
      backend.ready = false;
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });

      await settle();

      expect(backend.loadCalls.length).toBe(0);
      expect(mixer.getVoiceCount()).toBe(0);
    });
  });

  describe('the re-trigger rule — Map.pas:8332-8352', () => {
    it('starts a looped source once and never restarts it', async () => {
      mixer.setScene({ sources: [makeSource('a', 0, makeSound({ looped: true }))], zoomLevel: 3, screenWidth: 800 });
      await settle();
      expect(backend.started.length).toBe(1);
      expect(backend.started[0].looped).toBe(true);

      now += 60_000;
      mixer.tick();
      mixer.tick();
      expect(backend.started.length).toBe(1);
    });

    it('fires a period-0 one-shot once on entering view and never again', async () => {
      mixer.setScene({
        sources: [makeSource('a', 0, makeSound({ looped: false, period: 0 }))],
        zoomLevel: 3, screenWidth: 800,
      });
      await settle();
      expect(backend.started.length).toBe(1);
      expect(backend.started[0].looped).toBe(false);

      backend.started[0].end(); // the one-shot finishes
      now += 60_000;
      mixer.tick();
      expect(backend.started.length).toBe(1);
    });

    it('re-rolls a periodic one-shot only after its period, and only when the roll hits', async () => {
      const sound = makeSound({ looped: false, period: 10_000, probability: 0.8 });
      mixer.setScene({ sources: [makeSource('a', 0, sound)], zoomLevel: 3, screenWidth: 800 });

      roll = 0.5; // hits
      await settle();
      expect(backend.started.length).toBe(1);
      backend.started[0].end();

      // Too soon — no roll at all
      now += 5_000;
      mixer.tick();
      expect(backend.started.length).toBe(1);

      // Period elapsed but the roll misses
      now += 5_000;
      roll = 0.9;
      mixer.tick();
      expect(backend.started.length).toBe(1);

      // Period elapsed again and the roll hits
      now += 10_000;
      roll = 0.1;
      mixer.tick();
      expect(backend.started.length).toBe(2);
    });

    it('does not stack a second voice over a one-shot that is still playing', async () => {
      const sound = makeSound({ looped: false, period: 1_000, probability: 1 });
      mixer.setScene({ sources: [makeSource('a', 0, sound)], zoomLevel: 3, screenWidth: 800 });
      await settle();
      expect(backend.started.length).toBe(1);

      now += 10_000;
      mixer.tick();
      expect(backend.started.length).toBe(1);
      expect(mixer.getActiveHandleCount()).toBe(1);
    });

    it('leaves the registration handle-less when the backend refuses to start a voice', async () => {
      backend.startReturnsNull = true;
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      await settle();

      expect(mixer.getVoiceCount()).toBe(1);
      expect(mixer.getActiveHandleCount()).toBe(0);
    });
  });

  describe('start / stop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('ticks on the legacy SOUND_TICK_MS interval and is idempotent', () => {
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      mixer.start();
      mixer.start(); // second call must not add a second interval

      backend.readyCalls = 0;
      jest.advanceTimersByTime(SOUND_TICK_MS);
      expect(backend.readyCalls).toBe(1);
      expect(backend.loadCalls.length).toBe(1);
    });

    it('stops ticking and silences every voice on stop()', async () => {
      mixer.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      mixer.tick();
      await flush();
      mixer.tick();
      expect(mixer.getVoiceCount()).toBe(1);
      const voice = backend.started[0];

      mixer.start();
      mixer.stop();
      expect(voice.stop).toHaveBeenCalledTimes(1);
      expect(mixer.getVoiceCount()).toBe(0);

      jest.advanceTimersByTime(SOUND_TICK_MS * 5);
      expect(mixer.getVoiceCount()).toBe(0);
    });
  });

  describe('defaults', () => {
    it('uses performance.now and Math.random when no clock is injected', () => {
      const plain = new MapSoundMixer(backend);
      plain.setScene({ sources: [makeSource('a', 0)], zoomLevel: 3, screenWidth: 800 });
      expect(() => plain.tick()).not.toThrow();
      expect(backend.loadCalls).toEqual(['mine.wav']);
    });

    it('starts enabled', () => {
      expect(new MapSoundMixer(backend).isEnabled()).toBe(true);
    });
  });
});
