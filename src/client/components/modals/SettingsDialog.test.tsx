/**
 * SettingsDialog — the two new visual toggles (building animations, transparent overlays)
 * forward through handleSettingChange to updateSettings + client.onSettingsChange, same as
 * every other ToggleRow in the Visual section.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { SettingsDialog } from './SettingsDialog';

describe('SettingsDialog — building animations / transparent overlays toggles', () => {
  beforeEach(() => {
    useUiStore.getState().openModal('settings');
  });

  it('toggling "Building animations" updates the store and notifies the client', () => {
    const onSettingsChange = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onSettingsChange }),
    });

    const toggle = screen.getByLabelText('Building animations') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    expect(useGameStore.getState().settings.buildingAnimations).toBe(false);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ buildingAnimations: false }),
    );
  });

  it('toggling "Transparent overlays" updates the store and notifies the client', () => {
    const onSettingsChange = jest.fn();
    renderWithProviders(<SettingsDialog />, {
      clientCallbacks: createSpiedCallbacks({ onSettingsChange }),
    });

    const toggle = screen.getByLabelText('Transparent overlays') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    expect(useGameStore.getState().settings.transparentOverlays).toBe(false);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ transparentOverlays: false }),
    );
  });
});
