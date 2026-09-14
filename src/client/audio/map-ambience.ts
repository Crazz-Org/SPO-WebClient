/**
 * MapAmbience — the per-building sound mixer.
 *
 * Reproduces Voyager's TStaticBuildingSoundTarget (Map.pas:8374-8411): every on-screen
 * building whose class carries a `[Sounds]` entry contributes a voice, panned by where it
 * sits across the canvas and attenuated by how far it is from the tile under the middle of
 * the view. A hard cap of MAX_AMBIENT_VOICES simultaneous voices is applied by ranking on
 * the class's own priority, exactly as the legacy mixer does (SoundMixer.pas:72-84).
 *
 * The class holds no timers of its own beyond the 120 ms mixer tick, and `tick()` is public
 * so a test drives a pass directly instead of waiting on a real interval.
 */

/** SoundTypes.pas:53 — full left. */
export const LEFT_PAN = -1;
/** SoundTypes.pas:54 — dead centre. */
export const CENTER_PAN = 0;
/** SoundTypes.pas:55 — full right. */
export const RIGHT_PAN = 1;
/** SoundTypes.pas:56 — half-width of the no-pan band around screen centre, in pixels. */
export const PAN_DEAD_ZONE_PX = 128;
/** SoundTypes.pas:57 — the volume floor, as a legacy [0..1] value (not an amplitude). */
export const MIN_VOL = 0.6;
/** SoundTypes.pas:58 — the volume ceiling. */
export const MAX_VOL = 1;
/** SoundTypes.pas:59 — beyond this many tiles a building is only heard at the floor. */
export const MAX_HEAR_DIST = 50;
/** SoundTypes.pas:60 — volume lost per zoom level away from the closest zoom. */
export const ZOOM_VOL_STEP = 0.25;
/** ord(cBasicZoomRes) = ord(zr32x64) = 3 — MapTypes.pas:10, GameTypes.pas:29. */
export const BASE_ZOOM_LEVEL = 3;
/** SoundMixer.pas:9 (cMaxAllowedSounds) — the hard cap on simultaneous ambience voices. */
export const MAX_AMBIENT_VOICES = 30;
/** Sounds.pas:58 (cSoundsTimerInterval) — one mixer pass every 120 ms. */
export const AMBIENCE_TICK_MS = 120;

/**
 * Legacy volume → linear amplitude.
 *
 * The `[0..1]` value the curve produces is NOT an amplitude: Voyager feeds it to DirectSound
 * as `trunc((volume - 1) * 10000)` hundredths of a decibel of attenuation
 * (SoundLib.pas:165-166, :199-203). So the 0.6 floor is −40 dB — one percent of full scale,
 * not sixty percent. Web Audio gain is linear, hence the conversion.
 */
export function legacyVolumeToGain(volume: number): number {
  return 10 ** ((volume - 1) * 5);
}

/**
 * The distance/zoom volume curve — Map.pas:8405-8408.
 *
 * Returns a legacy [MIN_VOL..MAX_VOL] value; pass it through `legacyVolumeToGain` to get an
 * amplitude.
 */
export function ambienceVolume(distanceTiles: number, zoomLevel: number): number {
  let volume: number;
  if (distanceTiles < MAX_HEAR_DIST) {
    const zoomTerm = 1 - Math.abs(zoomLevel - BASE_ZOOM_LEVEL) * ZOOM_VOL_STEP;
    volume = MIN_VOL + (1 - distanceTiles / MAX_HEAR_DIST) * (MAX_VOL - MIN_VOL) * zoomTerm;
  } else {
    volume = MIN_VOL;
  }
  return Math.max(0, Math.min(MAX_VOL, volume));
}

/**
 * The pan law — Map.pas:8398-8401.
 *
 * Inside the dead zone the pan snaps to centre; it does not ease into it. Outside, the
 * building's horizontal position maps linearly across the full stereo field.
 */
export function ambiencePan(screenX: number, screenWidth: number): number {
  let pan: number;
  if (Math.abs(screenX - screenWidth / 2) > PAN_DEAD_ZONE_PX) {
    pan = LEFT_PAN + ((RIGHT_PAN - LEFT_PAN) * screenX) / screenWidth;
  } else {
    pan = CENTER_PAN;
  }
  return Math.max(LEFT_PAN, Math.min(RIGHT_PAN, pan));
}

/** One sounded building, as the renderer hands it to the mixer. */
export interface AmbienceSource {
  /** Voice key — the origin tile, mirroring Voyager's per-instance sound kind (Map.pas:8307). */
  key: string;
  waveFile: string;
  attenuation: number;
  priority: number;
  looped: boolean;
  probability: number;
  periodMs: number;
  /** Canvas-pixel x of the building's tile centre — the pan anchor. */
  screenX: number;
  /** Euclidean tile distance, screen-centre tile to building-centre tile (Map.pas:8404). */
  distance: number;
}

/** What the mixer needs to know about the view for one pass. */
export interface AmbienceSnapshot {
  canvasWidth: number;
  zoomLevel: number;
  sources: AmbienceSource[];
}

/**
 * The slice of SoundManager the mixer drives. Declared structurally so a test hands in a
 * plain object, the way MusicPlayer takes a MusicElement.
 */
export interface AmbienceSink {
  setLoopVoice(key: string, filename: string, gain: number, pan: number): void;
  playPositioned(filename: string, gain: number, pan: number): void;
  stopLoopVoice(key: string): void;
  stopAllLoopVoices(): void;
}

export class MapAmbience {
  private enabled = true;
  private userInteracted = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Keys of the loop voices the last tick left running. */
  private loopKeys: Set<string> = new Set();
  /** Retrigger clock per source key — the legacy fLastPlayed (Map.pas:8337). */
  private lastPlayed: Map<string, number> = new Map();

  constructor(
    private readonly sound: AmbienceSink,
    private readonly getSnapshot: () => AmbienceSnapshot | null,
    private readonly now: () => number = () => performance.now(),
    private readonly rand: () => number = Math.random
  ) {}

  /** Call on first user interaction — browsers refuse audio before one. */
  public initOnInteraction(): void {
    if (this.userInteracted) return;
    this.userInteracted = true;
    if (this.enabled) this.arm();
  }

  /**
   * The global sound switch. Off stops every voice; on re-arms the tick, and the next pass
   * re-voices from the live snapshot — no reload needed.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.disarm();
      this.sound.stopAllLoopVoices();
      this.loopKeys.clear();
      this.lastPlayed.clear();
    } else if (this.userInteracted) {
      this.arm();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** One mixer pass. Public so tests drive it without a real timer. */
  public tick(): void {
    if (!this.enabled) return;
    const snapshot = this.getSnapshot();
    if (!snapshot) return;

    // Rank then slice: this is the ONLY path that starts a voice, so MAX_AMBIENT_VOICES is a
    // cap on everything the mixer can make audible. Lowest priority first (SoundMixer.pas:72);
    // nearest first breaks a tie, where the legacy mixer just took array order.
    const ranked = [...snapshot.sources].sort(
      (a, b) => a.priority - b.priority || a.distance - b.distance
    );
    const kept = ranked.slice(0, MAX_AMBIENT_VOICES);

    const stillLooping = new Set<string>();
    for (const source of kept) {
      const volume = Math.max(
        0,
        Math.min(MAX_VOL, ambienceVolume(source.distance, snapshot.zoomLevel) * source.attenuation)
      );
      const gain = legacyVolumeToGain(volume);
      const pan = ambiencePan(source.screenX, snapshot.canvasWidth);

      if (source.looped) {
        this.sound.setLoopVoice(source.key, source.waveFile, gain, pan);
        stillLooping.add(source.key);
      } else if (source.periodMs > 0 && this.shouldRetrigger(source)) {
        this.sound.playPositioned(source.waveFile, gain, pan);
      }
    }

    for (const key of this.loopKeys) {
      if (!stillLooping.has(key)) this.sound.stopLoopVoice(key);
    }
    this.loopKeys = stillLooping;
  }

  /** Stop everything and release the tick. */
  public destroy(): void {
    this.disarm();
    this.sound.stopAllLoopVoices();
    this.loopKeys.clear();
    this.lastPlayed.clear();
  }

  // -- Internal --

  /** The legacy retrigger gate — Map.pas:8336-8352. The clock resets on a roll, pass or fail. */
  private shouldRetrigger(source: AmbienceSource): boolean {
    const now = this.now();
    const last = this.lastPlayed.get(source.key) ?? 0;
    if (now - last < source.periodMs) return false;
    this.lastPlayed.set(source.key, now);
    return this.rand() < source.probability;
  }

  private arm(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), AMBIENCE_TICK_MS);
  }

  private disarm(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
