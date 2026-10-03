/**
 * SettingsDialog — the Interface section: classic HUD or the new one (src/client/v2/).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { SettingsDialog } from './SettingsDialog';

function group() {
  return screen.getByRole('group', { name: 'In-game interface' });
}

describe('SettingsDialog interface section', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ uiVersion: 'v1' });
    useUiStore.getState().openModal('settings');
  });
  afterEach(() => { localStorage.removeItem('spo_ui_version'); });

  it('is the first section, and marks Classic as pressed by default', () => {
    renderWithProviders(<SettingsDialog />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles[0]).toBe('Interface');
    expect(within(group()).getByRole('button', { name: 'Classic' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group()).getByRole('button', { name: 'New (experimental)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('New switches to v2 and remembers it; Classic switches back', () => {
    renderWithProviders(<SettingsDialog />);
    fireEvent.click(within(group()).getByRole('button', { name: 'New (experimental)' }));
    expect(useUiStore.getState().uiVersion).toBe('v2');
    expect(localStorage.getItem('spo_ui_version')).toBe('v2');
    expect(within(group()).getByRole('button', { name: 'New (experimental)' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(group()).getByRole('button', { name: 'Classic' }));
    expect(useUiStore.getState().uiVersion).toBe('v1');
    expect(localStorage.getItem('spo_ui_version')).toBe('v1');
  });

  it('switching does not close the dialog', () => {
    renderWithProviders(<SettingsDialog />);
    fireEvent.click(within(group()).getByRole('button', { name: 'New (experimental)' }));
    expect(useUiStore.getState().modal).toBe('settings');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });
});
