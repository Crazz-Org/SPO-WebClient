/**
 * The staged entrance (issue 549): a short CSS stagger on mount, skippable by a click,
 * key press or focus event, and played at most once per app load. The form itself is
 * always in the DOM from the first frame — the intro only withholds the settled CSS state.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { AuthStage, resetLoginIntro } from './AuthStage';

const props = { onConnect: () => {}, isLoading: false, status: 'idle' };

function stageRoot(): HTMLElement {
  const el = screen.getByText('STARPEACE ONLINE').closest('[data-intro]');
  if (!el) throw new Error('stage root not found');
  return el as HTMLElement;
}

describe('AuthStage staged entrance', () => {
  beforeEach(() => {
    resetLoginIntro();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  });

  it('is reachable and focusable within one interaction from the first frame', () => {
    renderWithProviders(<AuthStage {...props} />);

    expect(stageRoot().dataset.intro).toBe('playing');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Username'));
  });

  it('skips on a click', () => {
    renderWithProviders(<AuthStage {...props} />);

    fireEvent.pointerDown(window);

    expect(stageRoot().dataset.intro).toBe('done');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Username'));
  });

  it('skips on a key press', () => {
    renderWithProviders(<AuthStage {...props} />);

    fireEvent.keyDown(window, { key: 'a' });

    expect(stageRoot().dataset.intro).toBe('done');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Username'));
  });

  it('skips on a focus event landing elsewhere', () => {
    renderWithProviders(<AuthStage {...props} />);

    fireEvent.focus(screen.getByPlaceholderText('Password'));

    expect(stageRoot().dataset.intro).toBe('done');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Username'));
  });

  it('settles on its own after the stagger completes', () => {
    jest.useFakeTimers();
    try {
      renderWithProviders(<AuthStage {...props} />);

      act(() => {
        jest.advanceTimersByTime(1400);
      });

      expect(stageRoot().dataset.intro).toBe('done');
    } finally {
      jest.useRealTimers();
    }
  });

  it('plays once per app load, not on every remount', () => {
    const { unmount } = renderWithProviders(<AuthStage {...props} />);
    expect(stageRoot().dataset.intro).toBe('playing');
    unmount();

    renderWithProviders(<AuthStage {...props} />);
    expect(stageRoot().dataset.intro).toBe('done');
  });

  it('renders the form directly when the user prefers reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
    });

    renderWithProviders(<AuthStage {...props} />);

    expect(stageRoot().dataset.intro).toBe('done');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Username'));
  });
});
