/**
 * App — which in-game screen mounts: the classic GameScreen or the experimental GameScreenV2,
 * picked by `useUiStore.uiVersion`, with the v2 boundary falling back to classic on a crash.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from './__tests__/setup/render-helpers';
import { useGameStore } from './store/game-store';
import { useUiStore } from './store/ui-store';
import { resetToasts } from './components/common/Toast';

const v2Behaviour = { crash: false };

jest.mock('./layouts/LoginScreen', () => ({ LoginScreen: () => <div>LOGIN</div> }));
jest.mock('./layouts/GameScreen', () => ({ GameScreen: () => <div>GAME_V1</div> }));
jest.mock('./v2', () => ({
  GameScreenV2: () => {
    if (v2Behaviour.crash) throw new Error('v2 crashed');
    return <div>GAME_V2</div>;
  },
}));
jest.mock('./components/startup/ServerStartupScreen', () => ({ ServerStartupScreen: () => <div>STARTUP</div> }));
jest.mock('./components/startup/MapLoadingScreen', () => ({ MapLoadingScreen: () => null }));
jest.mock('./components/modals/CompanyCreationModal', () => ({ CompanyCreationModal: () => null }));
jest.mock('./error-reporter', () => ({ reportClientError: jest.fn() }));

import { App } from './App';

function inGame(status: 'connected' | 'reconnecting' = 'connected') {
  useGameStore.setState({
    status,
    serverStartup: { ...useGameStore.getState().serverStartup, ready: true },
  });
}

describe('App — interface switch', () => {
  beforeEach(() => {
    resetToasts();
    v2Behaviour.crash = false;
    useUiStore.setState({ uiVersion: 'v1', modal: null, commandPaletteOpen: false });
    useGameStore.setState({ status: 'disconnected' });
  });
  afterEach(() => {
    localStorage.removeItem('spo_ui_version');
    jest.restoreAllMocks();
  });

  /** Render, letting the lazy v2 chunk resolve inside act. */
  async function renderApp() {
    await act(async () => { renderWithProviders(<App />); });
  }
  async function switchTo(version: 'v1' | 'v2') {
    await act(async () => { useUiStore.getState().setUiVersion(version); });
  }

  it('shows the startup screen until the server is ready', async () => {
    useGameStore.setState({ serverStartup: { ...useGameStore.getState().serverStartup, ready: false } });
    await renderApp();
    expect(screen.getByText('STARTUP')).toBeTruthy();
  });

  it('out of game, the login screen — whatever the interface choice', async () => {
    useGameStore.setState({ status: 'disconnected', serverStartup: { ...useGameStore.getState().serverStartup, ready: true } });
    useUiStore.setState({ uiVersion: 'v2' });
    await renderApp();
    expect(screen.getByText('LOGIN')).toBeTruthy();
    expect(screen.queryByText('GAME_V2')).toBeNull();
  });

  it('in game on v1, the classic screen', async () => {
    inGame();
    await renderApp();
    expect(screen.getByText('GAME_V1')).toBeTruthy();
  });

  it('in game on v2, the new screen (lazy) — also while reconnecting', async () => {
    inGame('reconnecting');
    useUiStore.setState({ uiVersion: 'v2' });
    await renderApp();
    expect(screen.getByText('GAME_V2')).toBeTruthy();
    expect(screen.queryByText('GAME_V1')).toBeNull();
  });

  it('switching at runtime swaps the screen both ways', async () => {
    inGame();
    await renderApp();
    await switchTo('v2');
    expect(screen.getByText('GAME_V2')).toBeTruthy();
    await switchTo('v1');
    expect(screen.getByText('GAME_V1')).toBeTruthy();
    expect(screen.queryByText('GAME_V2')).toBeNull();
  });

  it('V on the keyboard switches the interface (the global shortcut is mounted here)', async () => {
    inGame();
    await renderApp();
    await act(async () => { fireEvent.keyDown(window, { key: 'v' }); });
    expect(screen.getByText('GAME_V2')).toBeTruthy();
  });

  it('a v2 crash falls back to the classic screen with a toast', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    v2Behaviour.crash = true;
    inGame();
    await renderApp();
    // The toast container is already listening (as in play) when the player switches.
    await switchTo('v2');
    expect(screen.getByText(/back to the classic one/)).toBeTruthy();
    expect(screen.getByText('GAME_V1')).toBeTruthy();
    expect(useUiStore.getState().uiVersion).toBe('v1');
    expect(localStorage.getItem('spo_ui_version')).toBe('v1');
  });
});
