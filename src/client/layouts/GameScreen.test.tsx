import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { useChatStore } from '../store/chat-store';
import { GameScreen } from './GameScreen';

// The screen composes the HUD; stub the parts that touch the canvas or fetch on mount.
jest.mock('../components/hud', () => ({
  StatusPill: () => <header>PILL</header>,
  CommandBar: () => <nav>COMMANDBAR</nav>,
  ContextStatusStrip: () => <div>CONTEXTSTATUS</div>,
  WorldEventTicker: () => <div>WORLDEVENT</div>,
  RightRail: () => <nav>RIGHTRAIL</nav>,
  VersionBadge: () => null,
}));
jest.mock('../components/chat', () => ({
  ChatStrip: () => <div>CHAT</div>,
  ChaseBadge: () => <div>CHASEBADGE</div>,
}));
jest.mock('../components/building', () => ({ StatusOverlay: () => null }));
jest.mock('../components/modals', () => ({ ServerSwitchOverlay: () => null, ZoneTypePicker: () => null }));
jest.mock('../components/mobile', () => ({ MobileShell: () => null }));
jest.mock('../components/command-palette', () => ({ CommandPalette: () => null }));
jest.mock('../hooks/useChangelogCheck', () => ({ useChangelogCheck: () => undefined }));
jest.mock('../components/sheet', () => ({ Sheet: () => <aside>SHEET</aside> }));

describe('GameScreen', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null, promptPayload: null, hudVisible: true });
    useChatStore.setState({ chatVisible: true });
  });

  it('mounts the HUD and the universal sheet', () => {
    renderWithProviders(<GameScreen />);
    expect(screen.getByText('SHEET')).toBeTruthy();
    expect(screen.getByText('COMMANDBAR')).toBeTruthy();
    expect(screen.getByText('CONTEXTSTATUS')).toBeTruthy();
    expect(screen.getByText('PILL')).toBeTruthy();
    // The chase badge is mounted on the root screen, so it is reachable on
    // desktop and mobile alike without touching MobileShell.
    expect(screen.getByText('CHASEBADGE')).toBeTruthy();
  });

  it('renders the confirm dialog from the store with its options', () => {
    renderWithProviders(<GameScreen />);
    act(() => {
      useUiStore.getState().requestConfirm('Demolish Building', 'Sure?', () => {}, { kind: 'destructive', confirmLabel: 'Demolish', typeToConfirm: 'CONFIRM' });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Demolish' })).toBeTruthy();
  });

  it('renders the prompt dialog from the store', () => {
    renderWithProviders(<GameScreen />);
    act(() => {
      useUiStore.getState().requestPrompt('Rename', 'New name', () => {}, { defaultValue: 'Mill' });
    });
    expect(screen.getByDisplayValue('Mill')).toBeTruthy();
  });

  it('hides the ChatStrip when chatVisible is false, and shows it when true', () => {
    useChatStore.setState({ chatVisible: false });
    renderWithProviders(<GameScreen />);
    expect(screen.queryByText('CHAT')).toBeNull();
    act(() => useChatStore.getState().setChatVisible(true));
    expect(screen.getByText('CHAT')).toBeTruthy();
  });

  it('toggling hudVisible removes and restores the StatusPill and CommandBar, leaving other surfaces untouched', () => {
    renderWithProviders(<GameScreen />);
    expect(screen.getByText('PILL')).toBeTruthy();
    expect(screen.getByText('COMMANDBAR')).toBeTruthy();

    act(() => useUiStore.getState().toggleHudVisible());

    expect(screen.queryByText('PILL')).toBeNull();
    expect(screen.queryByText('COMMANDBAR')).toBeNull();
    expect(screen.getByText('SHEET')).toBeTruthy();
    expect(screen.getByText('CONTEXTSTATUS')).toBeTruthy();
    expect(screen.getByText('RIGHTRAIL')).toBeTruthy();
    expect(screen.getByText('CHAT')).toBeTruthy();

    act(() => useUiStore.getState().toggleHudVisible());

    expect(screen.getByText('PILL')).toBeTruthy();
    expect(screen.getByText('COMMANDBAR')).toBeTruthy();
  });

  it('a modal opened by other means still renders while the HUD is hidden', () => {
    useUiStore.setState({ hudVisible: false });
    renderWithProviders(<GameScreen />);
    act(() => {
      useUiStore.getState().requestConfirm('Demolish Building', 'Sure?', () => {});
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
