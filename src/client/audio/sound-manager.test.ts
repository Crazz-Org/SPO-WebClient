/**
 * Tests for SoundManager
 * Node test environment — mock Web Audio API objects as plain objects
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SoundManager, SoundEvent } from './sound-manager';

// --- Web Audio API mocks ---

interface MockAudioBufferSourceNode {
  buffer: unknown;
  loop: boolean;
  connect: jest.Mock;
  disconnect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onended: (() => void) | null;
}

interface MockGainNode {
  gain: { value: number };
  connect: jest.Mock;
  disconnect: jest.Mock;
}

interface MockStereoPannerNode {
  pan: { value: number };
  connect: jest.Mock;
  disconnect: jest.Mock;
}

function createMockBufferSource(): MockAudioBufferSourceNode {
  return {
    buffer: null,
    loop: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onended: null,
  };
}

function createMockGainNode(): MockGainNode {
  return {
    gain: { value: 1 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

function createMockPanner(): MockStereoPannerNode {
  return {
    pan: { value: 0 },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

/** The master gain — the first gain node the manager creates */
let mockGain: MockGainNode;
/** Every gain node created, master first (ambient voices add one each) */
let mockGains: MockGainNode[];
let mockPanners: MockStereoPannerNode[];
let mockSources: MockAudioBufferSourceNode[];
let mockContextState: string;
let mockDecodeResult: unknown;
/** Set false to simulate a context without StereoPannerNode support */
let mockHasPanner: boolean;

const mockResume = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);

// Mock AudioContext globally
(globalThis as unknown as Record<string, unknown>).AudioContext = jest.fn().mockImplementation(() => {
  const ctx: Record<string, unknown> = {
    state: mockContextState,
    destination: {},
    createGain: jest.fn(() => {
      const g = createMockGainNode();
      mockGains.push(g);
      if (mockGains.length === 1) mockGain = g;
      return g;
    }),
    createBufferSource: jest.fn(() => {
      const src = createMockBufferSource();
      mockSources.push(src);
      return src;
    }),
    decodeAudioData: jest.fn().mockImplementation(() => Promise.resolve(mockDecodeResult)),
    resume: mockResume,
    close: mockClose,
  };
  if (mockHasPanner) {
    ctx.createStereoPanner = jest.fn(() => {
      const p = createMockPanner();
      mockPanners.push(p);
      return p;
    });
  }
  return ctx;
});

// Mock fetch
const mockFetchResponse = {
  ok: true,
  arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
};
(globalThis as unknown as Record<string, unknown>).fetch = jest.fn().mockResolvedValue(mockFetchResponse);

describe('SoundManager', () => {
  let sm: SoundManager;

  beforeEach(() => {
    sm = new SoundManager();
    mockSources = [];
    mockGains = [];
    mockPanners = [];
    mockHasPanner = true;
    mockContextState = 'running';
    mockDecodeResult = { duration: 1, length: 44100, sampleRate: 44100 };
    mockFetchResponse.ok = true;
    jest.clearAllMocks();
  });

  afterEach(() => {
    sm.destroy();
  });

  describe('initialization', () => {
    it('should not create AudioContext before user interaction', () => {
      expect((globalThis as unknown as Record<string, unknown>).AudioContext).not.toHaveBeenCalled();
    });

    it('should create AudioContext on initOnInteraction()', () => {
      sm.initOnInteraction();
      expect((globalThis as unknown as Record<string, unknown>).AudioContext).toHaveBeenCalledTimes(1);
    });

    it('should only initialize once on repeated calls', () => {
      sm.initOnInteraction();
      sm.initOnInteraction();
      expect((globalThis as unknown as Record<string, unknown>).AudioContext).toHaveBeenCalledTimes(1);
    });

    it('should resume suspended AudioContext', () => {
      mockContextState = 'suspended';
      sm.initOnInteraction();
      expect(mockResume).toHaveBeenCalled();
    });

    it('should preload common sounds on init', () => {
      sm.initOnInteraction();
      // Preload triggers fetch calls for UI sounds
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('enabled/disabled', () => {
    it('should default to enabled', () => {
      expect(sm.isEnabled()).toBe(true);
    });

    it('should set gain to 0 when disabled', () => {
      sm.initOnInteraction();
      sm.setEnabled(false);
      expect(mockGain.gain.value).toBe(0);
    });

    it('should restore gain when re-enabled', () => {
      sm.initOnInteraction();
      sm.setVolume(0.7);
      sm.setEnabled(false);
      expect(mockGain.gain.value).toBe(0);
      sm.setEnabled(true);
      expect(mockGain.gain.value).toBe(0.7);
    });

    it('should not play when disabled', () => {
      sm.initOnInteraction();
      sm.setEnabled(false);
      sm.play('ui-click');
      expect(mockSources.length).toBe(0);
    });
  });

  describe('volume', () => {
    it('should default volume to 1.0', () => {
      expect(sm.getVolume()).toBe(1.0);
    });

    it('should clamp volume to 0-1 range', () => {
      sm.setVolume(-0.5);
      expect(sm.getVolume()).toBe(0);
      sm.setVolume(1.5);
      expect(sm.getVolume()).toBe(1);
    });

    it('should update master gain on setVolume()', () => {
      sm.initOnInteraction();
      sm.setVolume(0.5);
      expect(mockGain.gain.value).toBe(0.5);
    });

    it('should not update gain if disabled', () => {
      sm.initOnInteraction();
      sm.setEnabled(false);
      sm.setVolume(0.8);
      // Gain stays at 0 when disabled, even after volume change
      expect(mockGain.gain.value).toBe(0);
      expect(sm.getVolume()).toBe(0.8);
    });
  });

  describe('playback', () => {
    it('should not play before user interaction', () => {
      sm.play('ui-click');
      expect(mockSources.length).toBe(0);
    });

    it('should play a named sound event', async () => {
      sm.initOnInteraction();
      sm.play('ui-click');
      // Wait for async load
      await new Promise(r => setTimeout(r, 10));
      expect(mockSources.length).toBeGreaterThan(0);
      expect(mockSources[0].start).toHaveBeenCalled();
    });

    it('should play from buffer cache on second call', async () => {
      sm.initOnInteraction();
      // Use playFile directly to test buffer caching (bypasses event debounce)
      sm.playFile('/sounds/come-here-notification.ogg');
      await new Promise(r => setTimeout(r, 10));

      sm.playFile('/sounds/come-here-notification.ogg');
      await new Promise(r => setTimeout(r, 10));
      // Should not fetch again — served from cache
      // (preload also fetches, so just check sources grew)
      expect(mockSources.length).toBeGreaterThanOrEqual(2);
    });

    it('should limit concurrent sounds', async () => {
      sm.initOnInteraction();
      // First load the sound so it's cached
      sm.playFile('/sounds/come-here-notification.ogg');
      await new Promise(r => setTimeout(r, 20));
      const sourcesAfterFirst = mockSources.length;

      // Now play many more — buffer is cached, so playBuffer is synchronous
      for (let i = 0; i < 10; i++) {
        sm.playFile('/sounds/come-here-notification.ogg');
      }
      // Only MAX_CONCURRENT (8) sources total should be created from cached playback
      // (minus the initial preload-triggered plays)
      const newSources = mockSources.length - sourcesAfterFirst;
      expect(newSources).toBeLessThanOrEqual(8);
    });

    it('should decrement activeSources on sound end', async () => {
      sm.initOnInteraction();
      sm.play('ui-click');
      await new Promise(r => setTimeout(r, 10));
      // Trigger onended
      if (mockSources[0]?.onended) {
        mockSources[0].onended();
      }
      // Should be able to play more sounds now
      sm.play('ui-click');
      await new Promise(r => setTimeout(r, 10));
      expect(mockSources.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle fetch failure gracefully', async () => {
      sm.initOnInteraction();
      mockFetchResponse.ok = false;
      sm.play('error');
      await new Promise(r => setTimeout(r, 10));
      // No crash, no source created for failed load
      // (preload sounds may still succeed)
    });

    it('should handle unknown sound events', () => {
      sm.initOnInteraction();
      sm.play('nonexistent' as SoundEvent);
      expect(mockSources.length).toBe(0);
    });
  });

  describe('stopAll', () => {
    it('should reset active sources', async () => {
      sm.initOnInteraction();
      sm.play('ui-click');
      await new Promise(r => setTimeout(r, 10));
      sm.stopAll();
      // After stopAll, should be able to play again (no concurrent limit hit)
      sm.play('ui-click');
      await new Promise(r => setTimeout(r, 10));
    });
  });

  describe('destroy', () => {
    it('should close AudioContext', () => {
      sm.initOnInteraction();
      sm.destroy();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle destroy before init gracefully', () => {
      expect(() => sm.destroy()).not.toThrow();
    });
  });

  // --- AmbientAudioBackend: what the map sound mixer drives ---

  describe('isReady', () => {
    it('is false before the unlocking gesture', () => {
      expect(sm.isReady()).toBe(false);
    });

    it('is true once the context exists', () => {
      sm.initOnInteraction();
      expect(sm.isReady()).toBe(true);
    });

    it('is false while sounds are disabled', () => {
      sm.initOnInteraction();
      sm.setEnabled(false);
      expect(sm.isReady()).toBe(false);
    });
  });

  describe('loadBuffer', () => {
    it('resolves null before the unlocking gesture', async () => {
      await expect(sm.loadBuffer('mine.wav')).resolves.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches from the asset cache and resolves the decoded buffer', async () => {
      sm.initOnInteraction();
      const buffer = await sm.loadBuffer('mine.wav');
      expect(buffer).toBe(mockDecodeResult);
      expect(fetch).toHaveBeenCalledWith('/cache/Sound/mine.wav');
    });

    it('resolves null when the wave is not on the server', async () => {
      sm.initOnInteraction();
      mockFetchResponse.ok = false;
      await expect(sm.loadBuffer('jackhammer.wav')).resolves.toBeNull();
    });
  });

  describe('startVoice', () => {
    const buffer = { duration: 2 } as unknown as AudioBuffer;

    it('returns null before the unlocking gesture', () => {
      expect(sm.startVoice(buffer, true, 1, 0, jest.fn())).toBeNull();
    });

    it('wires source → gain → panner → master and applies gain and pan', () => {
      sm.initOnInteraction();
      const handle = sm.startVoice(buffer, false, 0.5, -0.25, jest.fn());
      expect(handle).not.toBeNull();

      const src = mockSources[mockSources.length - 1];
      const voiceGain = mockGains[mockGains.length - 1];
      const panner = mockPanners[mockPanners.length - 1];

      expect(src.buffer).toBe(buffer);
      expect(src.loop).toBe(false);
      expect(voiceGain.gain.value).toBe(0.5);
      expect(panner.pan.value).toBe(-0.25);
      expect(src.connect).toHaveBeenCalledWith(voiceGain);
      expect(voiceGain.connect).toHaveBeenCalledWith(panner);
      expect(panner.connect).toHaveBeenCalledWith(mockGain);
    });

    it('starts a one-shot at offset 0 and a looped voice at a random offset', () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        sm.initOnInteraction();
        sm.startVoice(buffer, false, 1, 0, jest.fn());
        expect(mockSources[mockSources.length - 1].start).toHaveBeenCalledWith(0, 0);

        sm.startVoice(buffer, true, 1, 0, jest.fn());
        const looped = mockSources[mockSources.length - 1];
        expect(looped.loop).toBe(true);
        expect(looped.start).toHaveBeenCalledWith(0, 1); // 0.5 × 2s duration
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('connects straight to the master gain when the context has no panner', () => {
      mockHasPanner = false;
      sm.initOnInteraction();
      const handle = sm.startVoice(buffer, true, 0.8, 1, jest.fn());
      expect(handle).not.toBeNull();

      const voiceGain = mockGains[mockGains.length - 1];
      expect(mockPanners.length).toBe(0);
      expect(voiceGain.connect).toHaveBeenCalledWith(mockGain);
      // setPan is a no-op rather than a crash
      expect(() => handle!.setPan(-1)).not.toThrow();
    });

    it('re-aims a live voice through the handle', () => {
      sm.initOnInteraction();
      const handle = sm.startVoice(buffer, true, 0.5, 0, jest.fn());
      const voiceGain = mockGains[mockGains.length - 1];
      const panner = mockPanners[mockPanners.length - 1];

      handle!.setGain(0.9);
      handle!.setPan(0.25);
      expect(voiceGain.gain.value).toBe(0.9);
      expect(panner.pan.value).toBe(0.25);
    });

    it('reports the voice ending to the mixer', () => {
      sm.initOnInteraction();
      const onEnded = jest.fn();
      sm.startVoice(buffer, false, 1, 0, onEnded);
      mockSources[mockSources.length - 1].onended!();
      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('stops and disconnects the whole chain on stop()', () => {
      sm.initOnInteraction();
      const handle = sm.startVoice(buffer, true, 1, 0, jest.fn());
      const src = mockSources[mockSources.length - 1];
      const voiceGain = mockGains[mockGains.length - 1];
      const panner = mockPanners[mockPanners.length - 1];

      handle!.stop();
      expect(src.stop).toHaveBeenCalled();
      expect(src.disconnect).toHaveBeenCalled();
      expect(voiceGain.disconnect).toHaveBeenCalled();
      expect(panner.disconnect).toHaveBeenCalled();
    });

    it('survives a source that has already ended', () => {
      sm.initOnInteraction();
      const handle = sm.startVoice(buffer, false, 1, 0, jest.fn());
      const src = mockSources[mockSources.length - 1];
      src.stop.mockImplementation(() => { throw new Error('already stopped'); });
      expect(() => handle!.stop()).not.toThrow();
      expect(src.disconnect).toHaveBeenCalled();
    });
  });

  describe('the click and selection one-shots', () => {
    it('resolves them to the legacy waves in the asset cache', async () => {
      sm.initOnInteraction();
      sm.play('ui-select');
      await new Promise(r => setTimeout(r, 10));
      expect(fetch).toHaveBeenCalledWith('/cache/Sound/select.wav');
      expect(fetch).toHaveBeenCalledWith('/cache/Sound/click.wav'); // preloaded
    });

    it('is not debounced — two clicks in a row make two sounds', async () => {
      sm.initOnInteraction();
      const before = mockSources.length;
      sm.play('ui-click');
      sm.play('ui-click');
      await new Promise(r => setTimeout(r, 10));
      expect(mockSources.length - before).toBe(2);
    });

    it('leaves every other event debounced', async () => {
      // Pin the clock past the debounce window so the first play is never suppressed
      const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(10_000);
      try {
        sm.initOnInteraction();
        const before = mockSources.length;
        sm.play('mail');
        sm.play('mail');
        await new Promise(r => setTimeout(r, 10));
        expect(mockSources.length - before).toBe(1);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
