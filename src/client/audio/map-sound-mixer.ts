/**
 * MapSoundMixer — the per-building ambient voice mixer.
 *
 * Reproduces Voyager's map sound layer: every visible building whose class carries a
 * stochastic [Sounds] entry contributes one voice, panned by its screen position and
 * attenuated by its distance from the camera cell, with a hard cap on how many voices
 * may sound at once.
 *
 * This module holds no Web Audio call of its own — the `AmbientAudioBackend` seam is
 * implemented by `SoundManager` in the browser and by a fake in the tests, so the
 * curve, the ranking and the cap are all testable in the node Jest project.
 *
 * Legacy references (read-only, ~/SPO-Original/Voyager/):
 * - Components/MapIsoView/SoundTypes.pas:52-60  the constants
 * - Components/MapIsoView/Map.pas:8398-8409     pan, distance and volume
 * - Components/MapIsoView/SoundMixer.pas:9,:63-86  the cap and the priority ranking
 * - Components/MapIsoView/Sounds.pas:58,:127-175   the 120 ms reconcile tick
 */

import { FacilityAmbientSound } from '../../shared/types/domain-types';

// =============================================================================
// CONSTANTS (Voyager, cited individually)
// =============================================================================

/** cMaxHearDist — tiles past which a building is only ever heard at MIN_VOL (SoundTypes.pas:59) */
export const MAX_HEAR_DIST_TILES = 50;

/** cMinVol — the floor a registered voice never drops below (SoundTypes.pas:57) */
export const MIN_VOL = 0.6;

/** cMaxVol — the gain of a building standing on the camera cell at the basic zoom (SoundTypes.pas:58) */
export const MAX_VOL = 1;

/** cZoomVolStep — each zoom step away from the basic resolution removes this much of the ramp (SoundTypes.pas:60) */
export const ZOOM_VOL_STEP = 0.25;

/** cPanDeadZone — pixels either side of the canvas centre that stay centred (SoundTypes.pas:56) */
export const PAN_DEAD_ZONE_PX = 128;

/** ord(cBasicZoomRes = zr32x64) — WebClient zoom index 3, the 64×32 tile (MapTypes.pas:10) */
export const BASIC_ZOOM_LEVEL = 3;

/**
 * cMaxAllowedSounds — THE hard cap on simultaneous voices (SoundMixer.pas:9).
 *
 * `tick()` is the only place a voice is ever registered, and it never keeps more than
 * this many entries, so `getVoiceCount() <= MAX_VOICES` holds after every tick no matter
 * how many sound-classed buildings are on screen.
 */
export const MAX_VOICES = 30;

/** cSoundsTimerInterval — the reconcile interval, in ms (Sounds.pas:58) */
export const SOUND_TICK_MS = 120;

// =============================================================================
// PURE CURVE FUNCTIONS (the L0 target)
// =============================================================================

function bound(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map.pas:8405-8409 — linear ramp MAX_VOL → MIN_VOL over MAX_HEAR_DIST_TILES tiles,
 * the ramp scaled by the zoom term, flat at MIN_VOL from that distance on, clamped to [0, MAX_VOL].
 */
export function ambientGain(distTiles: number, zoomLevel: number): number {
  if (distTiles >= MAX_HEAR_DIST_TILES) return MIN_VOL;
  const zoomTerm = 1 - Math.abs(zoomLevel - BASIC_ZOOM_LEVEL) * ZOOM_VOL_STEP;
  const gain = MIN_VOL + (1 - distTiles / MAX_HEAR_DIST_TILES) * (MAX_VOL - MIN_VOL) * zoomTerm;
  return bound(0, MAX_VOL, gain);
}

/**
 * Map.pas:8398-8401 — a dead zone of ±PAN_DEAD_ZONE_PX about the canvas centre pans dead
 * centre, anything further is placed linearly across the canvas, clamped to [-1, 1].
 *
 * WebClient divergence, deliberate: the canvas width, where Voyager used the monitor width
 * (GetSystemMetrics, Map.pas:7771).
 */
export function ambientPan(screenX: number, screenWidth: number): number {
  if (Math.abs(screenX - screenWidth / 2) <= PAN_DEAD_ZONE_PX) return 0;
  return bound(-1, 1, -1 + (2 * screenX) / screenWidth);
}

/**
 * Map.pas:8402-8404 — Euclidean distance in map cells from the camera cell (which is the
 * cell under the canvas centre) to the building's centre cell.
 */
export function tileDistance(
  cameraI: number,
  cameraJ: number,
  b: { x: number; y: number; xsize: number; ysize: number }
): number {
  const centreI = b.y + Math.floor(b.ysize / 2);
  const centreJ = b.x + Math.floor(b.xsize / 2);
  const di = centreI - cameraI;
  const dj = centreJ - cameraJ;
  return Math.sqrt(di * di + dj * dj);
}

// =============================================================================
// THE AUDIO SEAM
// =============================================================================

/** One sounding voice, as the backend hands it back. */
export interface VoiceHandle {
  setGain(gain: number): void;
  setPan(pan: number): void;
  stop(): void;
}

export interface AmbientAudioBackend {
  /** True only once a gesture has unlocked the AudioContext and sounds are enabled. */
  isReady(): boolean;
  /** Resolves null when the file is missing or undecodable — the mixer then never asks again. */
  loadBuffer(filename: string): Promise<AudioBuffer | null>;
  /** Starts one voice; null when the context is gone. `onEnded` fires when it stops by itself. */
  startVoice(
    buffer: AudioBuffer,
    looped: boolean,
    gain: number,
    pan: number,
    onEnded: () => void
  ): VoiceHandle | null;
}

// =============================================================================
// SCENE INPUT
// =============================================================================

export interface SoundSource {
  /** `${x},${y}` — the renderer's identity for the building */
  key: string;
  sound: FacilityAmbientSound;
  /** Canvas x of the building's centre tile */
  screenX: number;
  /** tileDistance() from the camera cell */
  distTiles: number;
}

export interface SoundScene {
  sources: SoundSource[];
  zoomLevel: number;
  screenWidth: number;
}

interface RegisteredVoice {
  source: SoundSource;
  buffer: AudioBuffer;
  handle: VoiceHandle | null;
  /** ms timestamp of the last re-trigger roll (Map.pas:8332-8352, fLastPlayed) */
  lastPlayed: number;
}

export class MapSoundMixer {
  private readonly backend: AmbientAudioBackend;
  private readonly now: () => number;
  private readonly random: () => number;

  private scene: SoundScene = { sources: [], zoomLevel: BASIC_ZOOM_LEVEL, screenWidth: 0 };
  private voices: Map<string, RegisteredVoice> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  /** Waves the backend could not deliver — never requested again this session */
  private missing: Set<string> = new Set();
  private inFlight: Set<string> = new Set();
  private enabled = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(backend: AmbientAudioBackend, deps?: { now?: () => number; random?: () => number }) {
    this.backend = backend;
    this.now = deps?.now ?? (() => performance.now());
    this.random = deps?.random ?? (() => Math.random());
  }

  /** Latest snapshot from the renderer. Cheap on purpose — no audio work here. */
  public setScene(scene: SoundScene): void {
    this.scene = scene;
  }

  /** Start the reconcile interval. Idempotent — a second login must not double-tick. */
  public start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), SOUND_TICK_MS);
  }

  /** Stop the interval and silence every voice. */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.silence();
  }

  /**
   * The sound switch (Map.pas:7390-7406): off resets the mixer, on lets the next tick
   * rebuild from the last scene. Buffers survive, so re-enabling needs no reload.
   */
  public setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.silence();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Registered voices — never more than MAX_VOICES. */
  public getVoiceCount(): number {
    return this.voices.size;
  }

  /** Voices actually sounding right now (a registration whose re-trigger roll has hit). */
  public getActiveHandleCount(): number {
    let count = 0;
    for (const voice of this.voices.values()) {
      if (voice.handle) count++;
    }
    return count;
  }

  /** The 120 ms reconcile: rank, cull, register, then re-aim and re-trigger. */
  public tick(): void {
    if (!this.enabled || !this.backend.isReady()) return;

    const { zoomLevel, screenWidth } = this.scene;

    // 1-2. Drop sources whose wave is known missing, then rank: priority ascending
    // (SoundMixer.pas:72 — lower number wins), distance as the WebClient tiebreak since
    // every stochastic class in CLASSES.BIN carries prio=0.
    const ranked = this.scene.sources
      .filter(s => !this.missing.has(s.sound.waveFile))
      .sort((a, b) => a.sound.priority - b.sound.priority || a.distTiles - b.distTiles);

    // 3. Cull everything the cap or the viewport pushed out (Sounds.pas:275-293).
    const wanted = ranked.slice(0, MAX_VOICES);
    const wantedKeys = new Set(wanted.map(s => s.key));
    for (const [key, voice] of this.voices) {
      if (!wantedKeys.has(key)) {
        voice.handle?.stop();
        this.voices.delete(key);
      }
    }

    // 4. Register what is wanted and loaded; request what is wanted and not loaded. A
    // buffer that arrives is only turned into a voice on a later tick, so the cap above
    // stays the single place voices are created.
    for (const source of wanted) {
      const existing = this.voices.get(source.key);
      if (existing) {
        existing.source = source;
        continue;
      }
      const buffer = this.buffers.get(source.sound.waveFile);
      if (buffer) {
        this.voices.set(source.key, { source, buffer, handle: null, lastPlayed: 0 });
      } else {
        this.requestBuffer(source.sound.waveFile);
      }
    }

    // 5. Re-aim every registered voice (Sounds.pas:196-200), then apply the re-trigger rule.
    const now = this.now();
    for (const voice of this.voices.values()) {
      const sound = voice.source.sound;
      const gain = ambientGain(voice.source.distTiles, zoomLevel) * sound.attenuation;
      const pan = ambientPan(voice.source.screenX, screenWidth);
      if (voice.handle) {
        voice.handle.setGain(gain);
        voice.handle.setPan(pan);
      }
      // Map.pas:8332-8352 — a looped sound starts once and runs forever; a one-shot with
      // period 0 fires once on entering view; a one-shot with a period re-rolls every period.
      const mayRoll = (!sound.looped && sound.period !== 0) || voice.lastPlayed === 0;
      if (!mayRoll || now - voice.lastPlayed < sound.period) continue;
      const hit = this.random() < sound.probability;
      voice.lastPlayed = now;
      if (hit && !voice.handle) {
        voice.handle = this.backend.startVoice(voice.buffer, sound.looped, gain, pan, () => {
          voice.handle = null;
        });
      }
    }
  }

  // -- Internal --

  private requestBuffer(filename: string): void {
    if (this.inFlight.has(filename)) return;
    this.inFlight.add(filename);
    this.backend
      .loadBuffer(filename)
      .then(buffer => {
        this.inFlight.delete(filename);
        if (buffer) this.buffers.set(filename, buffer);
        else this.missing.add(filename);
      })
      .catch(() => {
        this.inFlight.delete(filename);
        this.missing.add(filename);
      });
  }

  private silence(): void {
    for (const voice of this.voices.values()) {
      voice.handle?.stop();
    }
    this.voices.clear();
  }
}
