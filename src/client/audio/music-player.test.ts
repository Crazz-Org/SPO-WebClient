/**
 * Tests for MusicPlayer — background soundtrack, independent of SoundManager's effects volume.
 */

import { MusicPlayer, MUSIC_TRACKS, type MusicElement } from './music-player';

function makeFakeElement(): MusicElement {
  return {
    src: '',
    volume: 1,
    onended: null,
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(),
  };
}

describe('MusicPlayer', () => {
  it('creates no element and plays nothing before initOnInteraction()', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);

    expect(factory).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(false);
  });

  it('initOnInteraction() creates one element, sets it to the first track and plays it', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);

    player.initOnInteraction();

    expect(factory).toHaveBeenCalledTimes(1);
    const element = factory.mock.results[0].value as MusicElement;
    expect(element.src).toBe(MUSIC_TRACKS[0]);
    expect(element.play).toHaveBeenCalledTimes(1);

    player.initOnInteraction();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('keeps a volume set before the gesture and applies it once the element is created', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);

    player.setVolume(0.2);
    player.initOnInteraction();

    const element = factory.mock.results[0].value as MusicElement;
    expect(element.volume).toBe(0.2);
  });

  it('writes volume to the element directly once playing, and clamps to 0..1', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);
    player.initOnInteraction();
    const element = factory.mock.results[0].value as MusicElement;

    player.setVolume(0.7);
    expect(element.volume).toBe(0.7);
    expect(player.getVolume()).toBe(0.7);

    player.setVolume(-1);
    expect(player.getVolume()).toBe(0);
    player.setVolume(5);
    expect(player.getVolume()).toBe(1);
  });

  it('setEnabled(false) pauses, setEnabled(true) resumes the same element', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);
    player.initOnInteraction();
    const element = factory.mock.results[0].value as MusicElement;

    player.setEnabled(false);
    expect(element.pause).toHaveBeenCalledTimes(1);

    player.setEnabled(true);
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('setEnabled(false) before any gesture is remembered — initOnInteraction() never plays', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);

    player.setEnabled(false);
    player.initOnInteraction();

    expect(factory).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(false);
  });

  it('re-enabling after a gesture with no element yet starts it', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);

    player.setEnabled(false);
    player.initOnInteraction();
    expect(factory).not.toHaveBeenCalled();

    player.setEnabled(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(player.isEnabled()).toBe(true);
  });

  it('walks the four tracks in order and wraps back to the first on onended', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);
    player.initOnInteraction();
    const element = factory.mock.results[0].value as MusicElement;

    element.onended?.(new Event('ended'));
    expect(element.src).toBe(MUSIC_TRACKS[1]);
    element.onended?.(new Event('ended'));
    expect(element.src).toBe(MUSIC_TRACKS[2]);
    element.onended?.(new Event('ended'));
    expect(element.src).toBe(MUSIC_TRACKS[3]);
    element.onended?.(new Event('ended'));
    expect(element.src).toBe(MUSIC_TRACKS[0]);
  });

  it('does not throw when play() rejects (autoplay refusal or a 404)', async () => {
    const element: MusicElement = {
      ...makeFakeElement(),
      play: jest.fn(() => Promise.reject(new Error('autoplay refused'))),
    };
    const player = new MusicPlayer(() => element);

    expect(() => player.initOnInteraction()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('destroy() pauses and releases the element; a later setVolume() does not throw', () => {
    const factory = jest.fn(makeFakeElement);
    const player = new MusicPlayer(factory);
    player.initOnInteraction();
    const element = factory.mock.results[0].value as MusicElement;

    player.destroy();
    expect(element.pause).toHaveBeenCalledTimes(1);

    expect(() => player.setVolume(0.3)).not.toThrow();
  });
});
