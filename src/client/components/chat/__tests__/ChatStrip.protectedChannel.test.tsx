/**
 * ChatStrip — joining a password-protected channel.
 *
 * The bespoke inline password form (#827) is gone; a protected row now routes
 * through the shared `requestPrompt`, the same modal used for bookmark rename
 * and minister nominations, with `type: 'password'`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useUiStore } from '../../../store/ui-store';
import { ChatStrip } from '../ChatStrip';

describe('ChatStrip — protected channel', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ currentChannel: 'Lobby' });
    useChatStore.getState().setChannels([
      { name: 'Lobby', isProtected: false },
      { name: 'Boardroom', isProtected: true },
    ]);
  });

  it('opens the shared password prompt, closes the dropdown, and joins nothing yet', () => {
    const onJoinChannel = jest.fn();
    const onGetChannelInfo = jest.fn();
    const callbacks = createSpiedCallbacks({
      onJoinChannel: onJoinChannel as (...a: unknown[]) => unknown,
      onGetChannelInfo: onGetChannelInfo as (...a: unknown[]) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getByText('Boardroom'));

    expect(useUiStore.getState().modal).toBe('prompt');
    expect(useUiStore.getState().promptPayload?.type).toBe('password');
    expect(screen.queryByText('Boardroom')).toBeNull();
    expect(screen.queryByLabelText('Channel password')).toBeNull();
    expect(onJoinChannel).not.toHaveBeenCalled();

    useUiStore.getState().promptPayload?.onSubmit('hunter2');

    expect(onJoinChannel).toHaveBeenCalledWith('Boardroom', 'hunter2');
    expect(onGetChannelInfo).toHaveBeenCalledWith('Boardroom');
    expect(useChatStore.getState().currentChannel).toBe('Boardroom');
  });
});
