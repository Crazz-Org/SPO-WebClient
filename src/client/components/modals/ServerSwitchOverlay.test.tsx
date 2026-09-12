/**
 * ServerSwitchOverlay — the second host of the company stage.
 *
 * It re-runs world and company selection on top of a running game, so it owes
 * the cards the same two facts the login screen owes them: the logged-in
 * account (for the "Private" rule) and the address of the selected world.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { ServerSwitchOverlay } from './ServerSwitchOverlay';
import type { WorldInfo } from '@/shared/types';

const WORLDS: WorldInfo[] = [
  { name: 'planitia', url: '', ip: '1.2.3.4', port: 8000, running3: true },
];

describe('ServerSwitchOverlay', () => {
  beforeEach(() => {
    useGameStore.setState({
      serverSwitchMode: true,
      loginStage: 'worlds',
      loginWorlds: WORLDS,
      loginLoading: false,
      username: 'SPO_test3',
      companies: [
        { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3', cluster: 'PGI', facilityCount: 12 },
      ],
    });
  });

  it('renders nothing when no switch is in progress', () => {
    useGameStore.setState({ serverSwitchMode: false });
    const { container } = renderWithProviders(<ServerSwitchOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('seals the card with the picked world and calls the account\'s own company Private', () => {
    renderWithProviders(<ServerSwitchOverlay />);

    fireEvent.click(screen.getByText('planitia'));
    act(() => {
      useGameStore.getState().setLoginStage('companies');
    });

    const seal = screen.getByAltText('PGI') as HTMLImageElement;
    expect(seal.src).toContain('http://1.2.3.4/');
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText('12 facilities')).toBeTruthy();
  });
});
