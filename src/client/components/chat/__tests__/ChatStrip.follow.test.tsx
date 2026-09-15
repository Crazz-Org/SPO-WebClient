/**
 * ChatStrip — the Follow control on an online-user row.
 *
 * Voyager offered the same item on the chat user list, enabled on every name
 * but the player's own (ChatListHandlerViewer.pas:110-126). Following yourself
 * is refused by the server anyway (ERROR_InvalidUserName,
 * InterfaceServer.pas:1579-1607), so the button is simply not rendered there.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useGameStore } from '../../../store/game-store';
import { ChatStrip } from '../ChatStrip';
import type { ChatUser } from '@/shared/types';

function user(name: string, id: string): ChatUser {
  return { name, id, isAway: false, nobilityPoints: 0, nobilityTier: 'Citizen', modifiers: 0 } as ChatUser;
}

function setup() {
  const onChaseUser = jest.fn();
  const callbacks = createSpiedCallbacks({
    onChaseUser: onChaseUser as (...a: unknown[]) => unknown,
  });
  const view = renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });
  return { ...view, onChaseUser };
}

describe('ChatStrip follow control', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({
      users: {
        SPO_test3: user('SPO_test3', 'u1'),
        'Mayor of Podan': user('Mayor of Podan', 'u2'),
      },
      chasedUser: null,
      isExpanded: true,
    });
    useGameStore.setState({ username: 'SPO_test3' });
  });

  it('asks the client to follow the player whose row was clicked', () => {
    const { onChaseUser } = setup();

    fireEvent.click(screen.getByLabelText('Follow Mayor of Podan'));

    expect(onChaseUser).toHaveBeenCalledWith('Mayor of Podan');
  });

  it('offers no follow button on the player\'s own row', () => {
    setup();

    expect(screen.queryByLabelText('Follow SPO_test3')).toBeNull();
  });

  it('marks the row of the player currently followed', () => {
    useChatStore.setState({ chasedUser: 'Mayor of Podan' });
    setup();

    const followed = screen.getByText('Mayor of Podan').closest('[aria-current="true"]');
    expect(followed).not.toBeNull();
    expect(screen.getByText('SPO_test3').closest('[aria-current="true"]')).toBeNull();
  });
});
