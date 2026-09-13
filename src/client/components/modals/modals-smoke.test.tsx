/**
 * Smoke tests for modal components.
 *
 * Each modal uses useUiStore().modal to decide visibility.
 * Tests verify they render nothing when inactive, and mount without crashing when active.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { BuildMenu } from './BuildMenu';
import { SettingsDialog } from './SettingsDialog';
import { ZoneTypePicker } from './ZoneTypePicker';

// ---------------------------------------------------------------------------
// BuildMenu
// ---------------------------------------------------------------------------

describe('BuildMenu', () => {
  beforeEach(resetStores);

  it('renders nothing when modal is not buildMenu', () => {
    const { container } = renderWithProviders(<BuildMenu />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when buildMenu modal is open', () => {
    useUiStore.getState().openModal('buildMenu');
    renderWithProviders(<BuildMenu />);
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SettingsDialog
// ---------------------------------------------------------------------------

describe('SettingsDialog', () => {
  beforeEach(resetStores);

  it('renders nothing when modal is not settings', () => {
    const { container } = renderWithProviders(<SettingsDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when settings modal is open', () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('its toggles are real switches that flip on click (keyboard-usable)', () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    const sw = screen.getByRole('switch', { name: 'Vehicle animations' }) as HTMLInputElement;
    const before = sw.checked;
    fireEvent.click(sw);
    expect((screen.getByRole('switch', { name: 'Vehicle animations' }) as HTMLInputElement).checked).toBe(!before);
  });

  it('offers an Aircraft animations switch, checked by default, that flips on click', () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    const sw = screen.getByRole('switch', { name: 'Aircraft animations' }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect((screen.getByRole('switch', { name: 'Aircraft animations' }) as HTMLInputElement).checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ZoneTypePicker
// ---------------------------------------------------------------------------

describe('ZoneTypePicker', () => {
  beforeEach(resetStores);

  it('renders nothing when modal is not zonePicker', () => {
    const { container } = renderWithProviders(<ZoneTypePicker />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when zonePicker modal is open', () => {
    useUiStore.getState().openModal('zonePicker');
    renderWithProviders(<ZoneTypePicker />);
    expect(screen.getByText('Select Zone Type')).toBeTruthy();
  });
});
