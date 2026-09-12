import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { useSearchStore } from '../../store/search-store';
import { useMailStore } from '../../store/mail-store';
import { useUiStore } from '../../store/ui-store';
import { TycoonProfileView } from './TycoonProfileView';
import type { TycoonProfile } from '@/shared/types';

const profile: TycoonProfile = {
  name: 'Alice',
  photoUrl: '',
  fortune: 0,
  thisYearProfit: 0,
  ntaRanking: '1',
  level: 'Apprentice',
  prestige: 0,
  profileUrl: '',
  companiesUrl: '',
} as unknown as TycoonProfile;

describe('TycoonProfileView — write to', () => {
  beforeEach(() => {
    resetStores();
    useGameStore.setState({ worldName: 'Shamba' });
    useSearchStore.setState({ tycoonProfileData: null });
  });

  it('opens compose addressed to the tycoon at <Name>@<World>.net', () => {
    useSearchStore.setState({ tycoonProfileData: { profile } as never });
    renderWithProviders(<TycoonProfileView />);

    fireEvent.click(screen.getByRole('button', { name: /Write to Alice/ }));

    expect(useMailStore.getState().composeTo).toBe('Alice@Shamba.net');
    expect(useMailStore.getState().currentView).toBe('compose');
    expect(useUiStore.getState().rightPanel).toBe('mail');
  });

  it('offers no write button when there is no profile', () => {
    renderWithProviders(<TycoonProfileView />);
    expect(screen.getByText('No profile data available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Write to/ })).toBeNull();
  });
});

describe('TycoonProfileView — companies (#526)', () => {
  beforeEach(() => {
    resetStores();
    useGameStore.setState({ worldName: 'Shamba' });
    useSearchStore.setState({ tycoonProfileData: null, directoryStack: [] });
  });

  it('opens the tycoon\'s companies folder (RenderTycoon.asp:139)', () => {
    useSearchStore.setState({ tycoonProfileData: { profile } as never });
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<TycoonProfileView />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuDirectory: onSearchMenuDirectory as never }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));

    const expected = { kind: 'tycoon-companies', tycoon: 'Alice' };
    expect(onSearchMenuDirectory).toHaveBeenCalledWith(expected);
    expect(useSearchStore.getState().directoryStack).toEqual([{ ref: expected, page: null }]);
  });
});
