/**
 * SettingsDialog — the Visual theme row: Corporate Empire or the legacy look.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { SettingsDialog } from './SettingsDialog';

function group() {
  return screen.getByRole('group', { name: 'Visual theme' });
}

describe('SettingsDialog visual theme', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().setTheme('empire');
    useUiStore.getState().openModal('settings');
  });
  afterEach(() => {
    localStorage.removeItem('spo_theme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('sits in the Interface section and marks Corporate Empire as pressed by default', () => {
    renderWithProviders(<SettingsDialog />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles[0]).toBe('Interface');
    expect(within(group()).getByRole('button', { name: 'Corporate Empire' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group()).getByRole('button', { name: 'Legacy' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Legacy stamps data-theme="legacy" on <html> and remembers it; Corporate Empire clears both', () => {
    renderWithProviders(<SettingsDialog />);
    fireEvent.click(within(group()).getByRole('button', { name: 'Legacy' }));
    expect(useUiStore.getState().theme).toBe('legacy');
    expect(localStorage.getItem('spo_theme')).toBe('legacy');
    expect(document.documentElement.getAttribute('data-theme')).toBe('legacy');
    expect(within(group()).getByRole('button', { name: 'Legacy' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(group()).getByRole('button', { name: 'Corporate Empire' }));
    expect(useUiStore.getState().theme).toBe('empire');
    expect(localStorage.getItem('spo_theme')).toBe('empire');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('switching does not close the dialog or touch the interface choice', () => {
    renderWithProviders(<SettingsDialog />);
    fireEvent.click(within(group()).getByRole('button', { name: 'Legacy' }));
    expect(useUiStore.getState().modal).toBe('settings');
    expect(useUiStore.getState().uiVersion).toBe('v1');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });
});
