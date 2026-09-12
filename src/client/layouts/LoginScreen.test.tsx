/**
 * LoginScreen — the wiring between the store's login slice and the company stage.
 *
 * Narrow on purpose: the stage components have their own suite
 * (`components/login/login-components.test.tsx`). What is asserted here is that the
 * screen reads the slice and hands it down, so the admission answer the gateway sent
 * actually reaches the player.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../__tests__/setup/render-helpers';
import { useGameStore } from '../store';
import { LoginScreen } from './LoginScreen';

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
});
