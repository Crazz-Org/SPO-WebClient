/**
 * The language picker on the login card.
 *
 * It has to live here and not in the in-game settings: the id travels WITH the login
 * (`REQ_LOGIN_WORLD.languageId`), so a player who could only change it after joining could
 * never change it at all for the session they are in.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks, resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { LANGUAGES } from '@/shared/language';
import { AuthStage } from './AuthStage';

const props = { onConnect: () => {}, isLoading: false, status: 'idle' };

describe('AuthStage — the language picker', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  it('offers the six ASP instances by name', () => {
    renderWithProviders(<AuthStage {...props} />);

    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.value)).toEqual(LANGUAGES.map((l) => l.id));
    expect(options.map((o) => o.textContent)).toEqual(LANGUAGES.map((l) => l.label));
  });

  it('starts on English when nothing was persisted', () => {
    renderWithProviders(<AuthStage {...props} />);

    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('0');
  });

  it('picking Français writes the store and hands the merged settings to the client', () => {
    const seen: unknown[] = [];
    const callbacks = createSpiedCallbacks({ onSettingsChange: (s) => { seen.push(s); return undefined; } });
    renderWithProviders(<AuthStage {...props} />, { clientCallbacks: callbacks });

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: '2' } });

    expect(useGameStore.getState().settings.languageId).toBe('2');
    // onSettingsChange is what lands in applySettings -> persistSettings, i.e. the reload.
    expect(seen).toEqual([expect.objectContaining({ languageId: '2' })]);
  });

  it('renders the language the store already holds — a reload keeps the choice', () => {
    useGameStore.getState().updateSettings({ languageId: '3' });

    renderWithProviders(<AuthStage {...props} />);

    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('3');
  });

  it('falls back to English when the persisted blob holds an id the catalogue does not name', () => {
    useGameStore.getState().updateSettings({ languageId: '9' });

    renderWithProviders(<AuthStage {...props} />);

    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('0');
  });
});
