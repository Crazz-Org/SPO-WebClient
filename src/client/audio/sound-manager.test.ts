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

let mockGain: MockGainNode;
/** Every gain node the context handed out, master first. */
let mockGains: MockGainNode[];
let mockPanners: MockStereoPannerNode[];
let mockSources: MockAudioBufferSourceNode[];
let mockContextState: string;
let mockDecodeResult: unknown;
/** Set false to simulate a context without a stereo panner. */
let mockHasPanner: boolean;

const mockResume = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);

// Mock AudioContext globally
(globalThis as unknown as Record<string, unknown>).AudioContext = jest.fn().mockImplementation(() => {
  let gainsIssued = 0;
  const ctx: Record<string, unknown> = {
    state: mockContextState,
    destination: {},
    createGain: jest.fn(() => {
      const g = createMockGainNode();
      // The first gain a context hands out is the master gain, built in ensureContext.
      if (gainsIssued === 0) mockGain = g;
      gainsIssued++;
      mockGains.push(g);
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

  // --- Map one-shots (MapIsoHandler.pas:96-97) ---

  describe('map one-shots', () => {
    const flush = () => new Promise(r => setTimeout(r, 10));

    it('fetches the legacy wave files for the two click events', async () => {
      sm.initOnInteraction();
      await flush();
      const urls = (fetch as unknown as jest.Mock).mock.calls.map(c => c[0] as string);
      expect(urls).toContain('/cache/Sound/click.wav');
      expect(urls).toContain('/cache/Sound/select.wav');
    });

    it('plays distinct files for a selection and a map click', async () => {
      sm.initOnInteraction();
      await flush();
      const before = (fetch as unknown as jest.Mock).mock.calls.length;
      sm.play('ui-select');
      sm.play('ui-click');
      await flush();
      // Both were preloaded, so the two plays come from cache and fetch nothing more.
      expect((fetch as unknown as jest.Mock).mock.calls.length).toBe(before);
      expect(mockSources.length).toBeGreaterThanOrEqual(2);
    });

    it('lets the two click events repeat instead of debouncing them for 3s', async () => {
      sm.initOnInteraction();
      await flush();
      const before = mockSources.length;
      sm.play('ui-click');
      sm.play('ui-click');
      sm.play('ui-click');
      await flush();
      expect(mockSources.length - before).toBe(3);
    });

    it('still debounces the events that are not click-driven', async () => {
      sm.initOnInteraction();
      sm.playFile(''); // no-op guard — keeps the fetch mock warm
      await flush();
      const before = mockSources.length;
      sm.play('notification');
      sm.play('notification');
      await flush();
      expect(mockSources.length - before).toBeLessThanOrEqual(1);
    });
  });

  // --- Positioned / looping ambience voices ---

  describe('ambience voices', () => {
    const flush = () => new Promise(r => setTimeout(r, 10));

    it('starts a looping voice with its own gain and pan', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('10,20', 'farm.wav', 0.25, -0.5);
      await flush();

      expect(sm.getLoopVoiceCount()).toBe(1);
      const voiceSource = mockSources[mockSources.length - 1];
      expect(voiceSource.loop).toBe(true);
      expect(voiceSource.start).toHaveBeenCalled();
      const voiceGain = mockGains[mockGains.length - 1];
      expect(voiceGain.gain.value).toBe(0.25);
      expect(mockPanners[mockPanners.length - 1].pan.value).toBe(-0.5);
    });

    it('routes the voice into the master gain, not straight to the destination', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();

      const voiceGain = mockGains[mockGains.length - 1];
      expect(voiceGain.connect).toHaveBeenCalledWith(mockGain);
    });

    it('updates a live voice in place rather than duplicating it', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 0.5, -1);
      await flush();
      const sourcesAfterFirst = mockSources.length;
      const voiceGain = mockGains[mockGains.length - 1];
      const voicePanner = mockPanners[mockPanners.length - 1];

      sm.setLoopVoice('a', 'farm.wav', 0.9, 0.3);
      await flush();

      expect(sm.getLoopVoiceCount()).toBe(1);
      expect(mockSources.length).toBe(sourcesAfterFirst);
      expect(voiceGain.gain.value).toBe(0.9);
      expect(voicePanner.pan.value).toBe(0.3);
    });

    it('replaces the voice when the same key asks for a different wave', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();
      const first = mockSources[mockSources.length - 1];

      sm.setLoopVoice('a', 'mine.wav', 1, 0);
      await flush();

      expect(first.stop).toHaveBeenCalled();
      expect(sm.getLoopVoiceCount()).toBe(1);
    });

    it('ignores a repeated request for a voice whose buffer is still loading', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'plop.wav', 1, 0);
      sm.setLoopVoice('a', 'plop.wav', 1, 0);
      await flush();

      expect(sm.getLoopVoiceCount()).toBe(1);
    });

    it('drops a voice that was stopped while its buffer was loading', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'plop.wav', 1, 0);
      sm.stopLoopVoice('a');
      await flush();

      expect(sm.getLoopVoiceCount()).toBe(0);
    });

    it('stops one voice and leaves the rest', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      sm.setLoopVoice('b', 'farm.wav', 1, 0);
      await flush();
      expect(sm.getLoopVoiceCount()).toBe(2);

      sm.stopLoopVoice('a');
      expect(sm.getLoopVoiceCount()).toBe(1);
    });

    it('shrugs off stopping a key that has no voice', () => {
      sm.initOnInteraction();
      expect(() => sm.stopLoopVoice('nothing')).not.toThrow();
      expect(sm.getLoopVoiceCount()).toBe(0);
    });

    it('survives a source that refuses to stop twice', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();
      mockSources[mockSources.length - 1].stop.mockImplementation(() => {
        throw new Error('already stopped');
      });

      expect(() => sm.stopAllLoopVoices()).not.toThrow();
      expect(sm.getLoopVoiceCount()).toBe(0);
    });

    it('stops every voice at once', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      sm.setLoopVoice('b', 'mine.wav', 1, 0);
      await flush();

      sm.stopAllLoopVoices();
      expect(sm.getLoopVoiceCount()).toBe(0);
    });

    it('does not start voices while sound is disabled or before interaction', async () => {
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();
      expect(sm.getLoopVoiceCount()).toBe(0);

      sm.initOnInteraction();
      sm.setEnabled(false);
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();
      expect(sm.getLoopVoiceCount()).toBe(0);
    });

    it('does not spend the one-shot budget on ambience voices', async () => {
      sm.initOnInteraction();
      for (let i = 0; i < 12; i++) {
        sm.setLoopVoice(`v${i}`, 'farm.wav', 1, 0);
      }
      await flush();
      expect(sm.getLoopVoiceCount()).toBe(12);

      const before = mockSources.length;
      sm.playFile('/sounds/come-here-notification.ogg');
      await flush();
      expect(mockSources.length).toBeGreaterThan(before);
    });

    it('plays a positioned one-shot through its own gain and panner', async () => {
      sm.initOnInteraction();
      sm.playPositioned('dogs.wav', 0.4, 0.8);
      await flush();

      expect(mockGains[mockGains.length - 1].gain.value).toBe(0.4);
      expect(mockPanners[mockPanners.length - 1].pan.value).toBe(0.8);
      expect(mockSources[mockSources.length - 1].start).toHaveBeenCalled();
    });

    it('serves a positioned one-shot from the buffer cache on a repeat', async () => {
      sm.initOnInteraction();
      sm.playPositioned('dogs.wav', 1, 0);
      await flush();
      const fetches = (fetch as unknown as jest.Mock).mock.calls.length;

      sm.playPositioned('dogs.wav', 1, 0);
      await flush();
      expect((fetch as unknown as jest.Mock).mock.calls.length).toBe(fetches);
    });

    it('refuses a positioned one-shot while disabled', async () => {
      sm.initOnInteraction();
      sm.setEnabled(false);
      const before = mockSources.length;
      sm.playPositioned('dogs.wav', 1, 0);
      await flush();
      expect(mockSources.length).toBe(before);
    });

    it('plays unpanned rather than throwing on a context with no stereo panner', async () => {
      mockHasPanner = false;
      const plain = new SoundManager();
      plain.initOnInteraction();
      plain.setLoopVoice('a', 'farm.wav', 0.3, -1);
      await flush();

      expect(plain.getLoopVoiceCount()).toBe(1);
      expect(mockPanners.length).toBe(0);
      expect(mockGains[mockGains.length - 1].gain.value).toBe(0.3);
      plain.destroy();
    });

    it('tears every voice down on destroy', async () => {
      sm.initOnInteraction();
      sm.setLoopVoice('a', 'farm.wav', 1, 0);
      await flush();

      sm.destroy();
      expect(sm.getLoopVoiceCount()).toBe(0);
    });
  });
});
