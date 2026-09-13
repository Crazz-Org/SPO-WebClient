/**
 * ZoneTypePicker — office header tests.
 *
 * `resetStores()` does not touch the politics store, so each test seeds and
 * clears it itself.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { usePoliticsStore } from '../../store/politics-store';
import type { PoliticalRoleInfo } from '@/shared/types';
import { ZoneTypePicker } from './ZoneTypePicker';

const baseRole: PoliticalRoleInfo = {
  tycoonName: 'spo_test3',
  isMayor: false,
  town: '',
  isCapitalMayor: false,
  isPresident: false,
  isMinister: false,
  ministry: '',
  queriedAt: 0,
};

function seedRole(role: Partial<PoliticalRoleInfo>): void {
  usePoliticsStore.getState().setTycoonRole({ ...baseRole, ...role });
}

describe('ZoneTypePicker — office header', () => {
  beforeEach(() => {
    resetStores();
    usePoliticsStore.getState().clearRoles();
    useGameStore.setState({ username: 'spo_test3' });
    useUiStore.getState().openModal('zonePicker');
  });

  it('renders no office label when the player holds no office', () => {
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('Select Zone Type')).toBeTruthy();
    expect(screen.queryByText(/Mayor|Minister|President/)).toBeNull();
  });

  it('renders "Mayor of <town>" for a mayor', () => {
    seedRole({ isMayor: true, town: 'Helartia' });
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('Mayor of Helartia')).toBeTruthy();
  });

  it('renders "Minister of <ministry>" for a minister', () => {
    seedRole({ isMinister: true, ministry: 'Agriculture' });
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('Minister of Agriculture')).toBeTruthy();
  });

  it('renders "President" for a president', () => {
    seedRole({ isPresident: true });
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('President')).toBeTruthy();
  });

  it('holding both president and mayor resolves to President, the legacy precedence', () => {
    seedRole({ isPresident: true, isMayor: true, town: 'Helartia' });
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('President')).toBeTruthy();
    expect(screen.queryByText('Mayor of Helartia')).toBeNull();
  });

  it('a mayor with no town falls back to the bare "Mayor"', () => {
    seedRole({ isMayor: true, town: '' });
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('Mayor')).toBeTruthy();
  });

  it('a cached role with no office flags set renders no office label', () => {
    seedRole({});
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.queryByText(/Mayor|Minister|President/)).toBeNull();
  });
});
