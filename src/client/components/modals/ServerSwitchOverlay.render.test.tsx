/**
 * Rendering tests for ServerSwitchOverlay — the world-limit answer reaching a player who is
 * already in-game and browsing for another world.
 *
 * Complements `ServerSwitchOverlay.test.ts` (store-only, node project) by rendering the
 * component in jsdom: the overlay reads the same `loginAtWorldLimit` slice the login screen
 * does, so a player switching servers at their limit is told the same thing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { ServerSwitchOverlay } from './ServerSwitchOverlay';

describe('ServerSwitchOverlay — the world limit', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.getState().setWorld('Shamba');
    useGameStore.getState().enterServerSwitch();
  });

  it('warns about the limit on the world stage', () => {
    useGameStore.getState().setLoginWorlds(
      [{ name: 'Movistar', url: '', ip: '127.0.0.1', port: 1234, running3: true }] as never[],
      true,
    );

    renderWithProviders(<ServerSwitchOverlay />);

    expect(screen.getByText(/reached the number of worlds your nobility allows/)).toBeTruthy();
  });

  it('offers the visitor entry on the company stage and asks the client for it', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Movistar' }] as never[], true);
    useGameStore.getState().setLoginCompanies([]);
    const onVisitWorld = jest.fn();

    renderWithProviders(<ServerSwitchOverlay />, {
      clientCallbacks: createSpiedCallbacks({ onVisitWorld }),
    });
    expect(screen.getByText('World Limit Reached')).toBeTruthy();
    fireEvent.click(screen.getByText('Enter as a visitor'));

    expect(onVisitWorld).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().loginLoading).toBe(true);
  });

  it('says nothing about a limit when the directory did not refuse', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Movistar' }] as never[]);
    useGameStore.getState().setLoginCompanies([]);

    renderWithProviders(<ServerSwitchOverlay />);

    // No refusal from the directory, so no limit message — and the empty company list
    // is the visa page (chooseVisa.asp), where the Tycoon Visa founds the first company.
    expect(screen.queryByText('World Limit Reached')).toBeNull();
    expect(screen.queryByText(/reached the number of worlds your nobility allows/)).toBeNull();
    expect(screen.getByText('Tycoon Visa')).toBeTruthy();
    expect(screen.getByText('Visitor Visa')).toBeTruthy();
  });
});

describe('ServerSwitchOverlay — the props the login screen passes', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.getState().setWorld('Shamba');
    useGameStore.getState().enterServerSwitch();
  });

  it('offers Retry on an empty world list and re-queries the last zone', () => {
    const onServerSwitchZoneSelect = jest.fn();
    renderWithProviders(<ServerSwitchOverlay />, {
      clientCallbacks: createSpiedCallbacks({ onServerSwitchZoneSelect }),
    });

    fireEvent.click(screen.getByText('Free Space'));
    act(() => useGameStore.getState().setLoginWorlds([]));

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);

    expect(onServerSwitchZoneSelect).toHaveBeenCalledTimes(2);
    expect(onServerSwitchZoneSelect).toHaveBeenNthCalledWith(2, 'Root/Areas/America/Worlds');
  });

  it('shows the World Full refusal instead of the visa page', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Movistar' }] as never[]);
    useGameStore.getState().setLoginCompanies([], { kind: 'full' });

    renderWithProviders(<ServerSwitchOverlay />);

    expect(screen.getByText('World Full')).toBeTruthy();
    expect(screen.getByText(/has reached its maximum number of tycoons/)).toBeTruthy();
    expect(screen.queryByText('Tycoon Visa')).toBeNull();
  });

  it('shows the Nobility Too Low refusal', () => {
    useGameStore.getState().setLoginWorlds([{ name: 'Movistar' }] as never[]);
    useGameStore.getState().setLoginCompanies([], { kind: 'nobility', shortfall: 3 });

    renderWithProviders(<ServerSwitchOverlay />);

    expect(screen.getByText('Nobility Too Low')).toBeTruthy();
    expect(screen.getByText(/3 point\(s\) below the minimum/)).toBeTruthy();
    expect(screen.queryByText('Tycoon Visa')).toBeNull();
  });
});
