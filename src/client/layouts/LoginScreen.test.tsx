/**
 * LoginScreen — what it hands the company stage.
 *
 * The card can only show a seal and a "Private" badge if the screen passes the
 * logged-in account and the address of the world that was just selected; both
 * come out of the store and out of the world the player clicked.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../__tests__/setup/render-helpers';
import { useGameStore } from '../store/game-store';
import { LoginScreen } from './LoginScreen';
import type { WorldInfo } from '@/shared/types';

// The animated background paints on a canvas jsdom does not implement.
jest.mock('../components/login/LoginBackground', () => ({ LoginBackground: () => null }));

const WORLDS: WorldInfo[] = [
  { name: 'planitia', url: '', ip: '1.2.3.4', port: 8000, running3: true },
  { name: 'shamba', url: '', ip: '5.6.7.8', port: 8000, running3: true },
];

describe('LoginScreen — company stage', () => {
  beforeEach(() => {
    useGameStore.setState({
      loginStage: 'worlds',
      loginWorlds: WORLDS,
      loginLoading: false,
      username: 'SPO_test3',
      companies: [
        { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3', cluster: 'PGI', facilityCount: 12 },
      ],
    });
  });

  it('seals the card with the IP of the world the player picked, and calls its owner Private', () => {
    renderWithProviders(<LoginScreen />);

    // Picking the world is what tells the screen which host serves the seals.
    fireEvent.click(screen.getByText('planitia'));
    act(() => {
      useGameStore.getState().setLoginStage('companies');
    });

    const seal = screen.getByAltText('PGI') as HTMLImageElement;
    expect(seal.src).toContain('http://1.2.3.4/');
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText('12 facilities')).toBeTruthy();
  });

  it('shows the role rather than Private when the account is someone else', () => {
    useGameStore.setState({ username: 'Someone Else' });
    renderWithProviders(<LoginScreen />);

    fireEvent.click(screen.getByText('planitia'));
    act(() => {
      useGameStore.getState().setLoginStage('companies');
    });

    expect(screen.queryByText('Private')).toBeNull();
    expect(screen.getByText('SPO_test3')).toBeTruthy();
  });
});
