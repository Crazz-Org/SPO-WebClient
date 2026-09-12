/**
 * LoginScreen — the wiring between the store's login slice and the company stage.
 *
 * Narrow on purpose: the stage components have their own suite
 * (`components/login/login-components.test.tsx`). What is asserted here is that the
 * screen reads the slice and hands it down, so the admission answer the gateway sent
 * actually reaches the player.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../__tests__/setup/render-helpers';
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

  it('passes the world-limit answer down to the world stage', () => {
    useGameStore.getState().setLoginWorlds(
      [{ name: 'Shamba', url: '', ip: '127.0.0.1', port: 1234, running3: true }] as never[],
      true,
    );

    renderWithProviders(<LoginScreen />);

    expect(screen.getByText(/reached the number of worlds your nobility allows/)).toBeTruthy();
  });

  it('passes the world-limit answer down to the company stage', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Shamba' }] as never[], true);
    useGameStore.getState().setLoginCompanies([]);

    renderWithProviders(<LoginScreen />);

    expect(screen.getByText('World Limit Reached')).toBeTruthy();
    expect(screen.getByText('Enter as a visitor')).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  it('asks the client to enter as a visitor, and shows the loading overlay while it runs', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Shamba' }] as never[], true);
    useGameStore.getState().setLoginCompanies([]);
    const onVisitWorld = jest.fn();

    renderWithProviders(<LoginScreen />, {
      clientCallbacks: createSpiedCallbacks({ onVisitWorld }),
    });
    fireEvent.click(screen.getByText('Enter as a visitor'));

    expect(onVisitWorld).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().loginLoading).toBe(true);
  });
});
