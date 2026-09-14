/**
 * ChatStrip — the "New Channel…" entry in the channel dropdown.
 *
 * It is a sibling of the channel rows, not one of them: it must open the modal
 * and never call `onJoinChannel`, which the rows themselves do (with the
 * `'Lobby'` → `''` translation this button has no business touching).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useUiStore } from '../../../store/ui-store';
import { ChatStrip } from '../ChatStrip';

describe('ChatStrip — New Channel', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ currentChannel: 'Lobby' });
    useChatStore.getState().setChannels(['Lobby', 'Trade']);
  });

  it('offers "New Channel…" in the dropdown', () => {
    renderWithProviders(<ChatStrip />);

    fireEvent.click(screen.getByText('Lobby'));

    expect(screen.getByText('New Channel…')).toBeTruthy();
  });

  it('opens the createChannel modal, closes the dropdown, and joins nothing', () => {
    const onJoinChannel = jest.fn();
    const callbacks = createSpiedCallbacks({
      onJoinChannel: onJoinChannel as (...a: unknown[]) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getByText('New Channel…'));

    expect(useUiStore.getState().modal).toBe('createChannel');
    expect(screen.queryByText('New Channel…')).toBeNull();
    expect(onJoinChannel).not.toHaveBeenCalled();
  });
});
