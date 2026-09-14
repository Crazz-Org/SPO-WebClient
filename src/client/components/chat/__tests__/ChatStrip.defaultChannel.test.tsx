/**
 * ChatStrip — the star that pins the current channel as the one to rejoin on
 * next login (issue #620).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { DEFAULT_CHANNEL_KEY } from '../../../store/default-channel';
import { ChatStrip } from '../ChatStrip';

beforeEach(() => {
  resetStores();
  localStorage.clear();
  useChatStore.setState({ currentChannel: 'Trade', channels: [
    { name: 'Lobby', isProtected: false },
    { name: 'Trade', isProtected: false },
  ] });
});
afterEach(() => localStorage.clear());

describe('ChatStrip — default channel', () => {
  it('pins the current channel on click, unpinned by default', () => {
    renderWithProviders(<ChatStrip />);

    const btn = screen.getByLabelText('Set Trade as default channel');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(btn);

    expect(localStorage.getItem(DEFAULT_CHANNEL_KEY)).toBe('Trade');
    expect(screen.getByLabelText('Clear default channel').getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the pin on a second click', () => {
    renderWithProviders(<ChatStrip />);

    fireEvent.click(screen.getByLabelText('Set Trade as default channel'));
    fireEvent.click(screen.getByLabelText('Clear default channel'));

    expect(localStorage.getItem(DEFAULT_CHANNEL_KEY)).toBeNull();
    expect(screen.getByLabelText('Set Trade as default channel').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders pressed on mount when the key already matches the current channel', () => {
    localStorage.setItem(DEFAULT_CHANNEL_KEY, 'Trade');

    renderWithProviders(<ChatStrip />);

    expect(screen.getByLabelText('Clear default channel').getAttribute('aria-pressed')).toBe('true');
  });
});
