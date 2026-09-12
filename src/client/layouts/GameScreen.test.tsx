import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { GameScreen } from './GameScreen';

// The screen composes the HUD; stub the parts that touch the canvas or fetch on mount.
jest.mock('../components/hud', () => ({
  StatusPill: () => <header>PILL</header>,
  CommandBar: () => <nav>COMMANDBAR</nav>,
  RightRail: () => <nav>RIGHTRAIL</nav>,
  VersionBadge: () => null,
  ContextStatusStrip: () => null,
}));
jest.mock('../components/chat', () => ({ ChatStrip: () => <div>CHAT</div> }));
jest.mock('../components/building', () => ({ StatusOverlay: () => null }));
jest.mock('../components/modals', () => ({ ServerSwitchOverlay: () => null, ZoneTypePicker: () => null }));
jest.mock('../components/mobile', () => ({ MobileShell: () => null }));
jest.mock('../components/command-palette', () => ({ CommandPalette: () => null }));
jest.mock('../hooks/useChangelogCheck', () => ({ useChangelogCheck: () => undefined }));
jest.mock('../components/sheet', () => ({ Sheet: () => <aside>SHEET</aside> }));

describe('GameScreen', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, confirmPayload: null, promptPayload: null });
  });

  it('mounts the HUD and the universal sheet', () => {
    renderWithProviders(<GameScreen />);
    expect(screen.getByText('SHEET')).toBeTruthy();
    expect(screen.getByText('COMMANDBAR')).toBeTruthy();
    expect(screen.getByText('PILL')).toBeTruthy();
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
});
