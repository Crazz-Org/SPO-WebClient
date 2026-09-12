/**
 * LoginScreen — the wiring between the store's login slice and the company stage.
 *
 * Narrow on purpose: the stage components have their own suite
 * (`components/login/login-components.test.tsx`). What is asserted here is that the
 * screen reads the slice and hands it down, so the admission answer the gateway sent
 * actually reaches the player.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../__tests__/setup/render-helpers';
import { useGameStore } from '../store';
import type { RememberedSession } from '../store';
import { LoginScreen } from './LoginScreen';

const RECORD: RememberedSession = {
  username: 'SPO_test3',
  zonePath: 'Root/Areas/Asia/Worlds',
  worldName: 'Shamba',
  companyId: '28',
  companyName: 'Yellow Inc.',
  ownerRole: 'SPO_test3',
};

describe('LoginScreen', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('shows the company stage once the login reaches it', () => {
    useGameStore.getState().setLoginCompanies([{ id: '1', name: 'TestCo', ownerRole: 'me' }]);

    renderWithProviders(<LoginScreen />);

    expect(screen.getByText('Select a Company')).toBeTruthy();
    expect(screen.getByText('Create New Company')).toBeTruthy();
  });

  it('passes the admission answer down to the company stage', () => {
    useGameStore.getState().setLoginCompanies([], { kind: 'full' });

    renderWithProviders(<LoginScreen />);

    expect(screen.getByText('World Full')).toBeTruthy();
    expect(screen.getByText('Choose another world')).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  it('hides the world stage and shows the progress line while resumeTarget is set', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Shamba', status: 'online', players: 1 } as never]);
    useGameStore.getState().setResumeTarget(RECORD);

    renderWithProviders(<LoginScreen />);

    expect(screen.queryByText('Select a World')).toBeNull();
    expect(screen.getByText('Returning to Shamba as Yellow Inc.…')).toBeTruthy();
  });

  it('clicking the return button calls onResumeSession, and forgetting empties rememberedSession', () => {
    useGameStore.getState().rememberSession(RECORD);
    const resumed: unknown[] = [];
    const callbacks = createSpiedCallbacks({
      onResumeSession: (...args: unknown[]) => { resumed.push(args); },
    });

    renderWithProviders(<LoginScreen />, { clientCallbacks: callbacks });

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test3' } });
    fireEvent.click(screen.getByLabelText('Return to Shamba as Yellow Inc.'));

    expect(resumed).toEqual([[RECORD, 'test3']]);

    fireEvent.click(screen.getByLabelText('Forget remembered session'));

    expect(useGameStore.getState().rememberedSession).toBeNull();
  });
});
