/**
 * ChatStrip — the Ignore control on an online-user row (#622).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useGameStore } from '../../../store/game-store';
import { ChatStrip } from '../ChatStrip';
import type { ChatUser } from '@/shared/types';

function user(name: string, id: string): ChatUser {
  return { name, id, isAway: false, nobilityPoints: 0, nobilityTier: 'Citizen', modifiers: 0 } as ChatUser;
}

function setup() {
  return renderWithProviders(<ChatStrip />);
}

describe('ChatStrip ignore control', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({
      users: {
        SPO_test3: user('SPO_test3', 'u1'),
        'Mayor of Podan': user('Mayor of Podan', 'u2'),
      },
      chasedUser: null,
      ignored: [],
      isExpanded: true,
    });
    useGameStore.setState({ username: 'SPO_test3' });
  });

  it('ignores a player from the user list, then un-ignores them', () => {
    setup();

    fireEvent.click(screen.getByLabelText('Ignore Mayor of Podan'));
    expect(useChatStore.getState().ignored).toEqual(['Mayor of Podan']);
    expect(screen.getByLabelText('Stop ignoring Mayor of Podan')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Stop ignoring Mayor of Podan'));
    expect(useChatStore.getState().ignored).toEqual([]);
    expect(screen.getByLabelText('Ignore Mayor of Podan')).toBeTruthy();
  });

  it('offers no ignore control on the player\'s own row', () => {
    setup();

    expect(screen.queryByLabelText('Ignore SPO_test3')).toBeNull();
  });

  it('marks an ignored row with the userRowIgnored class', () => {
    useChatStore.setState({ ignored: ['Mayor of Podan'] });
    setup();

    const row = screen.getByText('Mayor of Podan').closest('div');
    expect(row?.className).toContain('userRowIgnored');
  });
});
