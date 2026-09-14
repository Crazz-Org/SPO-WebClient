/**
 * Smoke tests for modal components.
 *
 * Each modal uses useUiStore().modal to decide visibility.
 * Tests verify they render nothing when inactive, and mount without crashing when active.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
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

  it("offers a Fade other players' buildings switch, checked by default, that flips on click", () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    const sw = screen.getByRole('switch', { name: "Fade other players' buildings" }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect((screen.getByRole('switch', { name: "Fade other players' buildings" }) as HTMLInputElement).checked).toBe(false);
  });

  it('offers a Signal losing facilities switch, unchecked by default, that flips on click', () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    const sw = screen.getByRole('switch', { name: 'Signal losing facilities' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect((screen.getByRole('switch', { name: 'Signal losing facilities' }) as HTMLInputElement).checked).toBe(true);
  });

  it('offers separate Effects volume and Music volume sliders, both defaulting to 50%', () => {
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    const effects = screen.getByLabelText('Effects volume') as HTMLInputElement;
    const music = screen.getByLabelText('Music volume') as HTMLInputElement;
    expect(effects.value).toBe('0.5');
    expect(music.value).toBe('0.5');
  });

  it('changing the music slider updates musicVolume only, and forwards the merged settings', () => {
    useUiStore.getState().openModal('settings');
    useGameStore.getState().updateSettings({ musicVolume: 0.5, soundVolume: 0.5 });
    const onSettingsChange = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onSettingsChange }),
    });

    fireEvent.change(screen.getByLabelText('Music volume'), { target: { value: '0.2' } });

    expect(useGameStore.getState().settings.musicVolume).toBe(0.2);
    expect(useGameStore.getState().settings.soundVolume).toBe(0.5);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ musicVolume: 0.2, soundVolume: 0.5 }),
    );
  });

  it('changing the effects slider updates soundVolume only, and forwards the merged settings', () => {
    useUiStore.getState().openModal('settings');
    useGameStore.getState().updateSettings({ musicVolume: 0.5, soundVolume: 0.5 });
    const onSettingsChange = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onSettingsChange }),
    });

    fireEvent.change(screen.getByLabelText('Effects volume'), { target: { value: '0.2' } });

    expect(useGameStore.getState().settings.soundVolume).toBe(0.2);
    expect(useGameStore.getState().settings.musicVolume).toBe(0.5);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ soundVolume: 0.2, musicVolume: 0.5 }),
    );
  });

  it('pressing Logout asks first — onLogout does not fire until the confirm callback runs', () => {
    useUiStore.getState().openModal('settings');
    const onLogout = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onLogout }),
    });

    fireEvent.click(screen.getByText('Logout'));

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('confirm');
    const payload = useUiStore.getState().confirmPayload;
    expect(payload).toBeTruthy();

    payload?.onConfirm();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('cancelling the logout confirmation leaves the session untouched', () => {
    useUiStore.getState().openModal('settings');
    const onLogout = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onLogout }),
    });

    fireEvent.click(screen.getByText('Logout'));
    useUiStore.getState().closeModal();

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload).toBeNull();
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
