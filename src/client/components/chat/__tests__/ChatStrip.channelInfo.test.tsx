/**
 * ChatStrip — the GetChannelInfo header subtitle.
 *
 * Picking a channel from the dropdown fires onGetChannelInfo alongside the
 * existing onJoinChannel, and whatever chat-store holds under that channel
 * name renders as a small line under the "Chat" title.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { ChatStrip } from '../ChatStrip';

describe('ChatStrip channel info', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ channelInfo: {}, currentChannel: 'Lobby' });
    useChatStore.getState().setChannels([
      { name: 'Lobby', isProtected: false },
      { name: 'Trade', isProtected: false },
    ]);
  });

  it('fetches the new channel\'s info alongside joining it', () => {
    const onJoinChannel = jest.fn();
    const onGetChannelInfo = jest.fn();
    const callbacks = createSpiedCallbacks({
      onJoinChannel: onJoinChannel as (...a: unknown[]) => unknown,
      onGetChannelInfo: onGetChannelInfo as (...a: unknown[]) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getByText('Trade'));

    expect(onJoinChannel).toHaveBeenCalledWith('Trade');
    expect(onGetChannelInfo).toHaveBeenCalledWith('Trade');
  });

  it('translates the Lobby selection to the empty wire name for onJoinChannel, but not for onGetChannelInfo', () => {
    const onJoinChannel = jest.fn();
    const onGetChannelInfo = jest.fn();
    const callbacks = createSpiedCallbacks({
      onJoinChannel: onJoinChannel as (...a: unknown[]) => unknown,
      onGetChannelInfo: onGetChannelInfo as (...a: unknown[]) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getAllByText('Lobby')[1]);

    expect(onJoinChannel).toHaveBeenCalledWith('');
    expect(onGetChannelInfo).toHaveBeenCalledWith('Lobby');
  });

  it('shows nothing extra in the header until channel info arrives', () => {
    renderWithProviders(<ChatStrip />);
    expect(screen.queryByTitle(/Loading|Creator/)).toBeNull();
  });

  it('renders the fetched description under the "Chat" title', () => {
    useChatStore.getState().setChannelInfo('Lobby', 'Lobby (Creator: Admin). 5 users: John, Mary and Bob.');
    renderWithProviders(<ChatStrip />);

    expect(screen.getByText('Lobby (Creator: Admin). 5 users: John, Mary and Bob.').textContent)
      .toBe('Lobby (Creator: Admin). 5 users: John, Mary and Bob.');
  });

  it('shows the placeholder while a request is in flight', () => {
    useChatStore.getState().setChannelInfo('Lobby', 'Loading...');
    renderWithProviders(<ChatStrip />);

    expect(screen.getByText('Loading...').textContent).toBe('Loading...');
  });
});
