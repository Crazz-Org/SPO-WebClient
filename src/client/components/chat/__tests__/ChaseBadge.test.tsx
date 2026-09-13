/**
 * ChaseBadge — Voyager's ChasePanel: present only while a chase is running,
 * captioned with the followed name, and a click on it stops the chase
 * (MapIsoView.pas:348-360, :538-543).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
// Through the barrel, the way GameScreen reaches it.
import { ChaseBadge } from '..';

function setup() {
  const onStopChase = jest.fn();
  const callbacks = createSpiedCallbacks({
    onStopChase: onStopChase as (...a: unknown[]) => unknown,
  });
  const view = renderWithProviders(<ChaseBadge />, { clientCallbacks: callbacks });
  return { ...view, onStopChase };
}

describe('ChaseBadge', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ chasedUser: null });
  });

  it('renders nothing while nobody is followed', () => {
    const { container } = setup();
    expect(container.innerHTML).toBe('');
  });

  it('names the followed player once a chase is running', () => {
    useChatStore.setState({ chasedUser: 'Mayor of Podan' });
    setup();

    expect(screen.getByText('Following Mayor of Podan')).toBeTruthy();
    expect(screen.getByLabelText('Stop following Mayor of Podan')).toBeTruthy();
  });

  it('stops the chase when clicked', () => {
    useChatStore.setState({ chasedUser: 'Mayor of Podan' });
    const { onStopChase } = setup();

    fireEvent.click(screen.getByLabelText('Stop following Mayor of Podan'));

    expect(onStopChase).toHaveBeenCalled();
  });
});
