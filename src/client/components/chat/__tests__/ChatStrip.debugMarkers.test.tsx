/**
 * ChatStrip — the markers window.__spoDebug.getState() reads (issue 1192):
 * the channel picker and the online-users list.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { DEBUG_MARKERS } from '../../../debug-markers';
import { ChatStrip } from '../ChatStrip';

describe('ChatStrip debug markers', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ currentChannel: 'Lobby' });
    useChatStore.getState().setChannels([
      { name: 'Lobby', isProtected: false },
      { name: 'Trade', isProtected: false },
    ]);
  });

  it('the expanded strip shows the users list; the channel button toggles the picker marker', () => {
    useChatStore.setState({ isExpanded: true });
    renderWithProviders(<ChatStrip />);
    expect(screen.getByTestId(DEBUG_MARKERS.chatUsers)).toBeTruthy();
    expect(screen.queryByTestId(DEBUG_MARKERS.chatChannelPicker)).toBeNull();
    fireEvent.click(screen.getByText('Lobby'));
    expect(screen.getByTestId(DEBUG_MARKERS.chatChannelPicker)).toBeTruthy();
    fireEvent.click(screen.getByText('Trade'));
    expect(screen.queryByTestId(DEBUG_MARKERS.chatChannelPicker)).toBeNull();
  });

  it('the collapsed desktop strip shows no users list', () => {
    useChatStore.setState({ isExpanded: false });
    renderWithProviders(<ChatStrip />);
    expect(screen.queryByTestId(DEBUG_MARKERS.chatUsers)).toBeNull();
  });

  it('the embedded (mobile) strip shows the users list even when not expanded', () => {
    useChatStore.setState({ isExpanded: false });
    renderWithProviders(<ChatStrip mode="embedded" />);
    expect(screen.getByTestId(DEBUG_MARKERS.chatUsers)).toBeTruthy();
  });
});
