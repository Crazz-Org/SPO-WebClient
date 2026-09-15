/**
 * ChatStrip — joining a password-protected channel.
 *
 * The bespoke inline password form (#827) is gone; a protected row now routes
 * through the shared `requestPrompt`, the same modal used for bookmark rename
 * and minister nominations, with `type: 'password'`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen, act } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useUiStore } from '../../../store/ui-store';
import { ChatStrip } from '../ChatStrip';
import { joinChannel } from '../../../handlers/chat-handler';
import type { ClientHandlerContext } from '../../../handlers/client-context';

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

    expect(onJoinChannel).toHaveBeenCalledWith('Boardroom', 'hunter2', 'Lobby');
    expect(onGetChannelInfo).toHaveBeenCalledWith('Boardroom');
    expect(useChatStore.getState().currentChannel).toBe('Boardroom');
  });

  it('puts the player back on their old channel when the password is refused', async () => {
    const err = new Error('Wrong password for "Boardroom".') as Error & { serverMessage: string };
    err.serverMessage = 'Wrong password for "Boardroom".';
    const showNotification = jest.fn();
    const ctx = {
      sendRequest: jest.fn(() => Promise.reject(err)),
      showNotification,
      isJoiningChannel: false,
    } as unknown as ClientHandlerContext;

    const callbacks = createSpiedCallbacks({
      onJoinChannel: ((name, password, previous) =>
        joinChannel(ctx, name as string, password as string | undefined, previous as string | undefined)) as (
        ...a: unknown[]
      ) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getByText('Boardroom'));

    await act(async () => {
      useUiStore.getState().promptPayload?.onSubmit('wrong');
    });

    expect(showNotification).toHaveBeenCalledWith('Wrong password for "Boardroom".', 'error');
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
  });
});
