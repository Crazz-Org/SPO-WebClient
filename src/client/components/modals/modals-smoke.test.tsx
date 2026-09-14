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
import { connectionStats } from '../../connection-stats';
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

  it('renders "—" for the round-trip figure when no measurement has been taken yet', () => {
    connectionStats.reset();
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders the round-trip figure once the gateway has pushed a latency sample', () => {
    connectionStats.reset();
    connectionStats.setLatency(42, 3);
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    expect(screen.getByText('42 ms')).toBeTruthy();
  });

  it('shows a non-zero Sent figure after bytes have been recorded', () => {
    connectionStats.reset();
    connectionStats.recordSent(2048);
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);
    expect(screen.getByText('Sent').nextSibling?.textContent).toMatch(/^2\.0 KB/);
  });

  it('Logout asks for confirmation before calling onLogout, and confirming logs out', () => {
    useUiStore.getState().openModal('settings');
    const onLogout = jest.fn();
    renderWithProviders(<SettingsDialog />, { clientCallbacks: createSpiedCallbacks({ onLogout }) });

    fireEvent.click(screen.getByRole('button', { name: /Logout/ }));

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload).not.toBeNull();
    expect(useUiStore.getState().modalBeneath).toBe('settings');

    useUiStore.getState().confirmPayload!.onConfirm();

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('offers a Support link to the configured destination, carrying world and player, in a new tab', () => {
    const w = window as unknown as Record<string, unknown>;
    w.__SPO_SUPPORT_URL__ = 'https://support.example.org/support.asp';
    useGameStore.setState({ worldName: 'planitia', username: 'Crazz' });
    useUiStore.getState().openModal('settings');
    renderWithProviders(<SettingsDialog />);

    const link = screen.getByRole('link', { name: 'Contact Support' }) as HTMLAnchorElement;
    expect(link.href).toContain('https://support.example.org/support.asp');
    expect(link.href).toContain('WorldName=planitia');
    expect(link.href).toContain('UserName=Crazz');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');

    delete w.__SPO_SUPPORT_URL__;
  });

  it('cancelling the Logout confirm leaves the session untouched and returns to Settings', () => {
    useUiStore.getState().openModal('settings');
    const onLogout = jest.fn();
    renderWithProviders(<SettingsDialog />, { clientCallbacks: createSpiedCallbacks({ onLogout }) });

    fireEvent.click(screen.getByRole('button', { name: /Logout/ }));
    useUiStore.getState().closeModal();

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('settings');
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
