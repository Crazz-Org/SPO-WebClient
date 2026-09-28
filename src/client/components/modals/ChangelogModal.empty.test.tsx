/**
 * ChangelogModal with no player notes: it says so, so the VersionBadge is never a dead button.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { ChangelogModal } from './ChangelogModal';

jest.mock('../../player-notes.json', () => []);

beforeEach(() => {
  resetStores();
  localStorage.clear();
});

describe('ChangelogModal with no notes', () => {
  it('renders "Nothing new to report yet." and no section', () => {
    useUiStore.getState().openModal('changelog');
    renderWithProviders(<ChangelogModal />);
    expect(screen.getByText('Nothing new to report yet.')).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('section')).toBeNull();
  });

  it('still closes on the X button', () => {
    useUiStore.getState().openModal('changelog');
    renderWithProviders(<ChangelogModal />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(useUiStore.getState().modal).toBeNull();
  });
});
