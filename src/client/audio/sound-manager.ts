/**
 * SoundManager - Web Audio API wrapper for game sounds
 *
 * Lazy AudioContext creation (requires user interaction per browser policy).
 * Preloads small UI sounds, plays on demand for events.
 */

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

/** Maps sound events to filenames in public/sounds/ */
const SOUND_MAP: Record<SoundEvent, string> = {
  // The two map one-shots Voyager plays: select.wav on a selection, click.wav on a map
  // click (MapIsoHandler.pas:96-97, :736, :897). Bare names resolve to /cache/Sound/.
  'ui-click': 'click.wav',
  'ui-select': 'select.wav',
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

/** A live looping voice — one on-screen sounded building. */
interface LoopVoice {
  filename: string;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  panner: StereoPannerNode | null;
}

export class SoundManager {
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
   * Looping ambience voices, keyed by the caller's voice key. Deliberately NOT counted in
   * `activeSources`: that budget is the one-shot budget, and 30 ambience voices must never
   * starve a click sound.
   */
  private loopVoices: Map<string, LoopVoice> = new Map();
  /** Voice keys whose buffer is still being fetched, with the filename that was asked for. */
  private loopPending: Map<string, string> = new Map();

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

  /**
   * Events that opt out of the 3 s debounce. The two map one-shots answer a direct click,
   * so a player clicking twice in a row must hear it twice.
   */
  private static readonly DEBOUNCE_OVERRIDES: Partial<Record<SoundEvent, number>> = {
    'ui-click': 0,
    'ui-select': 0,
  };

  /** Play a named sound event (debounced — max once per 3s per event) */
  public play(event: SoundEvent): void {
    const filename = SOUND_MAP[event];
    if (!filename) return;

    const debounceMs = SoundManager.DEBOUNCE_OVERRIDES[event] ?? SoundManager.DEBOUNCE_MS;
    const now = performance.now();
    const last = this.lastPlayTime.get(event) ?? 0;
    if (now - last < debounceMs) return;
    this.lastPlayTime.set(event, now);

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

  /**
   * Start a looping voice for `key`, or update a live one's gain and pan in place.
   *
   * Passing a different filename for a key that already has a voice replaces it. Everything
   * routes through `masterGain`, so the enable switch and the effects volume govern ambience
   * exactly as they govern every other sound.
   */
  public setLoopVoice(key: string, filename: string, gain: number, pan: number): void {
    if (!this.enabled || !this.userInteracted) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const existing = this.loopVoices.get(key);
    if (existing && existing.filename === filename) {
      existing.gainNode.gain.value = gain;
      if (existing.panner) existing.panner.pan.value = pan;
      return;
    }
    if (existing) this.stopLoopVoice(key);

    const buffer = this.bufferCache.get(filename);
    if (buffer) {
      this.startLoopVoice(ctx, key, filename, buffer, gain, pan);
      return;
    }

    if (this.loopPending.get(key) === filename) return; // already in flight
    this.loopPending.set(key, filename);
    this.loadSound(filename).then(buf => {
      // The voice may have been stopped, or asked for a different wave, while we waited.
      if (this.loopPending.get(key) !== filename) return;
      this.loopPending.delete(key);
      const liveCtx = this.context;
      if (!buf || !this.enabled || !liveCtx || !this.masterGain) return;
      if (this.loopVoices.has(key)) return;
      this.startLoopVoice(liveCtx, key, filename, buf, gain, pan);
    }).catch(() => {
      this.loopPending.delete(key);
    });
  }

  /** Fire a one-shot at a given gain and pan (the periodic ambience entries). */
  public playPositioned(filename: string, gain: number, pan: number): void {
    if (!this.enabled || !this.userInteracted) return;
    if (this.activeSources >= MAX_CONCURRENT) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const buffer = this.bufferCache.get(filename);
    if (buffer) {
      this.playBuffer(ctx, buffer, { gain, pan });
    } else {
      this.loadSound(filename).then(buf => {
        if (buf) this.playBuffer(ctx, buf, { gain, pan });
      }).catch(() => { /* silently ignore playback failures */ });
    }
  }

  /** Stop the looping voice for `key`, if any. */
  public stopLoopVoice(key: string): void {
    this.loopPending.delete(key);
    const voice = this.loopVoices.get(key);
    if (!voice) return;
    this.loopVoices.delete(key);
    SoundManager.teardownVoice(voice);
  }

  /** Stop every looping voice. */
  public stopAllLoopVoices(): void {
    for (const voice of this.loopVoices.values()) {
      SoundManager.teardownVoice(voice);
    }
    this.loopVoices.clear();
    this.loopPending.clear();
  }

  /** How many looping voices are live. */
  public getLoopVoiceCount(): number {
    return this.loopVoices.size;
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
    // Before masterGain is replaced — the voices are connected to the current one.
    this.stopAllLoopVoices();
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

  private playBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    positioned?: { gain: number; pan: number }
  ): void {
    if (!this.masterGain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (positioned) {
      const chain = this.buildVoiceChain(ctx, positioned.gain, positioned.pan);
      if (!chain) return;
      source.connect(chain.input);
    } else {
      source.connect(this.masterGain);
    }

    this.activeSources++;
    source.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1);
    };

    source.start();
  }

  /**
   * Build `[panner ->] gain -> masterGain` and return the node a source connects to.
   *
   * The panner is optional on purpose: a context without `createStereoPanner` still plays the
   * voice, unpanned, rather than throwing and going silent.
   */
  private buildVoiceChain(ctx: AudioContext, gain: number, pan: number): {
    input: AudioNode;
    gainNode: GainNode;
    panner: StereoPannerNode | null;
  } | null {
    if (!this.masterGain) return null;

    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    gainNode.connect(this.masterGain);

    let panner: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      panner.connect(gainNode);
    }

    return { input: panner ?? gainNode, gainNode, panner };
  }

  private startLoopVoice(
    ctx: AudioContext,
    key: string,
    filename: string,
    buffer: AudioBuffer,
    gain: number,
    pan: number
  ): void {
    const chain = this.buildVoiceChain(ctx, gain, pan);
    if (!chain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(chain.input);

    // Copies of the same wave start at a random offset so they do not phase-lock
    // (SoundMixer.pas:99-102).
    const duration = buffer.duration || 0;
    source.start(0, Math.random() * duration);

    this.loopVoices.set(key, { filename, source, gainNode: chain.gainNode, panner: chain.panner });
  }

  private static teardownVoice(voice: LoopVoice): void {
    try {
      voice.source.stop();
    } catch {
      // Already stopped — nothing to do.
    }
    voice.source.disconnect();
    voice.panner?.disconnect();
    voice.gainNode.disconnect();
  }
}
