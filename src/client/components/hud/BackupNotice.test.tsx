/**
 * BackupNotice — the one-time explanation for the backup lamp.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { BackupNotice, BACKUP_SEEN_KEY_PREFIX } from './BackupNotice';

describe('BackupNotice', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    useGameStore.setState({ username: 'SPO_test3', serverBusy: false });
  });

  it('renders nothing when serverBusy is false', () => {
    render(<BackupNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the explanation the first time serverBusy turns true', () => {
    render(<BackupNotice />);
    act(() => useGameStore.getState().setServerBusy(true));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('The world is saving')).toBeTruthy();
  });

  it('writes the per-account key on dismiss and hides the card', () => {
    render(<BackupNotice />);
    act(() => useGameStore.getState().setServerBusy(true));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(`${BACKUP_SEEN_KEY_PREFIX}SPO_test3`)).toBe('1');
  });

  it('shows nothing on a second serverBusy: true after dismissal', () => {
    render(<BackupNotice />);
    act(() => useGameStore.getState().setServerBusy(true));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    act(() => useGameStore.getState().setServerBusy(false));
    act(() => useGameStore.getState().setServerBusy(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing on a fresh mount when the key is already present', () => {
    localStorage.setItem(`${BACKUP_SEEN_KEY_PREFIX}SPO_test3`, '1');
    useGameStore.setState({ serverBusy: true });
    render(<BackupNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not crash when localStorage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    try {
      render(<BackupNotice />);
      act(() => useGameStore.getState().setServerBusy(true));
      expect(screen.getByRole('dialog')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('does nothing when serverBusy turns true but username is blank', () => {
    useGameStore.setState({ username: '' });
    render(<BackupNotice />);
    act(() => useGameStore.getState().setServerBusy(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
