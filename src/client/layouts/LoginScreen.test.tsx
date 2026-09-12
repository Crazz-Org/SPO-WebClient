/**
 * LoginScreen — the wiring between the store's login slice and the company stage.
 *
 * Narrow on purpose: the stage components have their own suite
 * (`components/login/login-components.test.tsx`). What is asserted here is that the
 * screen reads the slice and hands it down, so the admission answer the gateway sent
 * actually reaches the player.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
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

  it('retries the same zone query after an empty world list', () => {
    const onDirectoryConnect = jest.fn();
    const callbacks = createSpiedCallbacks({ onDirectoryConnect });

    renderWithProviders(<LoginScreen />, { clientCallbacks: callbacks });

    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'SPO_test3' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test3' } });
    fireEvent.click(screen.getByText('Enter the World'));

    act(() => useGameStore.setState({ loginStage: 'zones', loginLoading: false }));
    fireEvent.click(screen.getByText('BETA'));

    expect(onDirectoryConnect).toHaveBeenCalledTimes(1);
    expect(onDirectoryConnect).toHaveBeenCalledWith('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');

    act(() => useGameStore.getState().setLoginWorlds([]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onDirectoryConnect).toHaveBeenCalledTimes(2);
    expect(onDirectoryConnect).toHaveBeenLastCalledWith('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
  });
});
