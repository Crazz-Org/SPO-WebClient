/**
 * SoundManager - Web Audio API wrapper for game sounds
 *
 * Lazy AudioContext creation (requires user interaction per browser policy).
 * Preloads small UI sounds, plays on demand for events.
 *
 * Doubles as the `AmbientAudioBackend` of the map sound mixer: `isReady` / `loadBuffer` /
 * `startVoice` are the only Web Audio calls that layer makes.
 */

import { AmbientAudioBackend, VoiceHandle } from './map-sound-mixer';

/** Sound event categories the game can trigger */
export type SoundEvent =
  | 'ui-click'
  | 'ui-select'
  | 'chat-message'
  | 'mail'
  | 'period-end'
  | 'notification'
  | 'error'
  | 'construction';

/**
 * Maps sound events to filenames. A leading `/` is a path under public/; a bare
 * filename resolves to the asset cache under cache/Sound/ — the legacy
 * `CachePath + 'Sound\'` the original client preloaded from (MapIsoHandler.pas:633-638).
 */
const SOUND_MAP: Record<SoundEvent, string> = {
  'ui-click': 'click.wav',      // tidSound_Click, MapIsoHandler.pas:97
  'ui-select': 'select.wav',    // tidSound_Selection, MapIsoHandler.pas:96
  'chat-message': '/sounds/come-here-notification.ogg',
  'mail': '/sounds/come-here-notification.ogg',
  'period-end': '/sounds/come-here-notification.ogg',
  'notification': '/sounds/come-here-notification.ogg',
  'error': '/sounds/come-here-notification.ogg',
  'construction': '/sounds/come-here-notification.ogg',
};

/** Sound events to eagerly preload (small files) */
const PRELOAD_SOUNDS: SoundEvent[] = [
  'ui-click', 'ui-select', 'chat-message', 'mail', 'notification',
];

const MAX_CONCURRENT = 8;

/**
 * Events exempt from the repeat debounce: the click and selection one-shots answer a
 * direct gesture, so throttling them to one per three seconds would make them feel dead.
 */
const UNDEBOUNCED_EVENTS: ReadonlySet<SoundEvent> = new Set<SoundEvent>(['ui-click', 'ui-select']);

export class SoundManager implements AmbientAudioBackend {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private loadingPromises: Map<string, Promise<AudioBuffer | null>> = new Map();
  private enabled = true;
  private volume = 1.0;
  private userInteracted = false;
  private activeSources = 0;
  private lastPlayTime: Map<string, number> = new Map();

  /**
   * Call on first user interaction (click/keydown) to unlock AudioContext.
   */
  public initOnInteraction(): void {
    if (this.userInteracted) return;
    this.userInteracted = true;
    this.ensureContext();
    this.preload();
  }

  /** Enable or disable all sounds */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = enabled ? this.volume : 0;
    }
  }

  /** Set master volume (0.0 - 1.0) */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.enabled) {
      this.masterGain.gain.value = this.volume;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Minimum interval between repeated plays of the same event (ms) */
  private static readonly DEBOUNCE_MS = 3000;

  /** Play a named sound event (debounced — max once per 3s per event, except UNDEBOUNCED_EVENTS) */
  public play(event: SoundEvent): void {
    const filename = SOUND_MAP[event];
    if (!filename) return;

    if (!UNDEBOUNCED_EVENTS.has(event)) {
      const now = performance.now();
      const last = this.lastPlayTime.get(event) ?? 0;
      if (now - last < SoundManager.DEBOUNCE_MS) return;
      this.lastPlayTime.set(event, now);
    }

    this.playFile(filename);
  }

  /** Play a specific WAV/MP3 file from cache/Sound/ */
  public playFile(filename: string): void {
    if (!this.enabled || !this.userInteracted) return;
    if (this.activeSources >= MAX_CONCURRENT) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const buffer = this.bufferCache.get(filename);
    if (buffer) {
      this.playBuffer(ctx, buffer);
    } else {
      // Load and play asynchronously (fire-and-forget for non-blocking)
      this.loadSound(filename).then(buf => {
        if (buf) this.playBuffer(ctx, buf);
      }).catch(() => { /* silently ignore playback failures */ });
    }
  }

  /** Preload common UI sounds */
  public preload(): void {
    for (const event of PRELOAD_SOUNDS) {
      const filename = SOUND_MAP[event];
      if (filename && !this.bufferCache.has(filename) && !this.loadingPromises.has(filename)) {
        this.loadSound(filename).catch(() => { /* ignore preload failures */ });
      }
    }
  }

  /** Stop all currently playing sounds (resets gain briefly) */
  public stopAll(): void {
    if (this.masterGain) {
      this.masterGain.disconnect();
      const ctx = this.context;
      if (ctx) {
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.enabled ? this.volume : 0;
        this.masterGain.connect(ctx.destination);
      }
    }
    this.activeSources = 0;
  }

  // -- AmbientAudioBackend (the map sound mixer's only Web Audio access) --

  /** Sounds on, a gesture has unlocked the context, and the context exists. */
  public isReady(): boolean {
    return this.enabled && this.userInteracted && this.context !== null;
  }

  /** Decode a wave for the mixer; null when there is no context or the fetch failed. */
  public loadBuffer(filename: string): Promise<AudioBuffer | null> {
    if (!this.ensureContext()) return Promise.resolve(null);
    return this.loadSound(filename);
  }

  /**
   * Start one ambient voice: source → gain → stereo panner → master gain. Ambient voices
   * are not counted against MAX_CONCURRENT — that is the one-shot cap; the ambience has
   * its own cap in the mixer, and the legacy kept the two paths apart too
   * (MapIsoHandler.pas:707 bypasses the mixer).
   */
  public startVoice(
    buffer: AudioBuffer,
    looped: boolean,
    gain: number,
    pan: number,
    onEnded: () => void
  ): VoiceHandle | null {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return null;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = looped;

    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode);

    // StereoPannerNode is universal in the supported browsers, but a stub context in a
    // test or an old WebView may not carry it — then the voice simply plays centred.
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      gainNode.connect(panner);
      panner.connect(this.masterGain);
    } else {
      gainNode.connect(this.masterGain);
    }

    source.onended = () => onEnded();
    // Looped copies of one wave start at a random offset so they do not phase-lock
    // (SoundMixer.pas:99-101).
    source.start(0, looped ? Math.random() * (buffer.duration || 0) : 0);

    return {
      setGain: (g: number) => { gainNode.gain.value = g; },
      setPan: (p: number) => { if (panner) panner.pan.value = p; },
      stop: () => {
        try {
          source.stop();
        } catch { /* already ended — nothing to stop */ }
        source.disconnect();
        gainNode.disconnect();
        panner?.disconnect();
      },
    };
  }

  /** Clean up resources */
  public destroy(): void {
    this.stopAll();
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
    this.masterGain = null;
    this.bufferCache.clear();
    this.loadingPromises.clear();
  }

  // -- Internal --

  private ensureContext(): AudioContext | null {
    if (!this.userInteracted) return null;

    if (!this.context) {
      try {
        this.context = new AudioContext();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = this.enabled ? this.volume : 0;
        this.masterGain.connect(this.context.destination);
      } catch {
        return null;
      }
    }

    // Resume suspended context (browser auto-suspends until user gesture)
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }

    return this.context;
  }

  private async loadSound(filename: string): Promise<AudioBuffer | null> {
    // Deduplicate in-flight requests
    const existing = this.loadingPromises.get(filename);
    if (existing) return existing;

    const promise = this.fetchAndDecode(filename);
    this.loadingPromises.set(filename, promise);

    try {
      const buffer = await promise;
      if (buffer) {
        this.bufferCache.set(filename, buffer);
      }
      return buffer;
    } finally {
      this.loadingPromises.delete(filename);
    }
  }

  private async fetchAndDecode(filename: string): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;

    try {
      const url = filename.startsWith('/') ? filename : `/cache/Sound/${filename}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return await ctx.decodeAudioData(arrayBuffer);
    } catch {
      return null;
    }
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer): void {
    if (!this.masterGain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);

    this.activeSources++;
    source.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1);
    };

    source.start();
  }
}
