/**
 * MusicPlayer — background soundtrack, independent of SoundManager's effects volume.
 *
 * Plays through a plain audio element (not the Web Audio buffer path SoundManager uses) so
 * a 2-4 MB MP3 streams instead of being decoded whole into memory, and so the element's own
 * `volume` property gives music a volume knob the effects gain node cannot touch.
 */

/** The subset of HTMLAudioElement the player drives — a test hands in a plain object. */
export interface MusicElement {
  src: string;
  volume: number;
  onended: ((ev: Event) => void) | null;
  play(): Promise<void>;
  pause(): void;
}

/** Voyager's in-map soundtrack, as the update-server mirror names the files (case matters). */
export const MUSIC_TRACKS: readonly string[] = [
  '/cache/Sound/inmap1.mp3',
  '/cache/Sound/Inmap2.mp3',
  '/cache/Sound/Inmap3.mp3',
  '/cache/Sound/Inmap4.mp3',
];

export class MusicPlayer {
  private element: MusicElement | null = null;
  private enabled = true;
  private volume = 0.5; // MusicVolume default '50' — OptionsHandlerViewer.pas:519
  private userInteracted = false;
  private trackIndex = 0;

  constructor(private readonly createElement: () => MusicElement = () => new Audio()) {}

  /** Call on first user interaction (click/keydown) to allow playback. */
  public initOnInteraction(): void {
    if (this.userInteracted) return;
    this.userInteracted = true;
    if (this.enabled) this.start();
  }

  /** Enable or disable the soundtrack (the global sound switch). */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.userInteracted) return;
    if (!enabled) {
      this.element?.pause();
    } else if (this.element) {
      this.element.play().catch(() => {});
    } else {
      this.start();
    }
  }

  /** Set music volume (0.0 - 1.0), independent of the effects volume. */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.element) {
      this.element.volume = this.volume;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isPlaying(): boolean {
    return this.element !== null && this.enabled && this.userInteracted;
  }

  /** Stop playback and release the element. */
  public destroy(): void {
    this.element?.pause();
    this.element = null;
  }

  private start(): void {
    if (!this.element) {
      this.element = this.createElement();
      this.element.onended = () => {
        this.trackIndex = (this.trackIndex + 1) % MUSIC_TRACKS.length;
        this.playCurrentTrack();
      };
    }
    this.element.volume = this.volume;
    this.playCurrentTrack();
  }

  private playCurrentTrack(): void {
    if (!this.element) return;
    this.element.src = MUSIC_TRACKS[this.trackIndex];
    this.element.play().catch(() => {});
  }
}
