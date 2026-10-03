import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { useChatStore } from '../store/chat-store';
import { GameScreenV2 } from './GameScreenV2';
import { ToastContainer, resetToasts } from '../components/common/Toast';

// The shell composes the slots; stub every slot and every shared piece that touches the
// canvas or fetches on mount, so this test is about composition only.
jest.mock('./topbar', () => ({
  TopBar: () => <header>TOPBAR</header>,
  SignalLine: () => <div>SIGNALLINE</div>,
  ModeBanner: () => <div>MODEBANNER</div>,
}));
jest.mock('./dock', () => ({
  Dock: () => <nav>DOCK</nav>,
  MapTools: () => <nav>MAPTOOLS</nav>,
  ChatDrawer: () => <div>CHATDRAWER</div>,
}));
jest.mock('./panel', () => ({
  SidePanel: () => <aside>SIDEPANEL</aside>,
  FocusCard: () => <div>FOCUSCARD</div>,
}));
jest.mock('../components/hud', () => ({
  ContextStatusStrip: () => <div>V1_CONTEXTSTATUS</div>,
  WorldEventTicker: () => <div>V1_WORLDEVENT</div>,
  VersionBadge: () => <div>VERSIONBADGE</div>,
}));
jest.mock('../components/chat', () => ({ ChaseBadge: () => <div>CHASEBADGE</div> }));
jest.mock('../components/map/MapContextMenu', () => ({ MapContextMenu: () => <div>MAPCONTEXTMENU</div> }));
jest.mock('../components/modals', () => ({
  ServerSwitchOverlay: () => <div>SERVERSWITCH</div>,
  ZoneTypePicker: () => <div>ZONEPICKER</div>,
}));
jest.mock('../components/mobile', () => ({ MobileShell: () => <div>MOBILESHELL</div> }));
jest.mock('../components/command-palette', () => ({ CommandPalette: () => <div>PALETTE</div> }));
jest.mock('../hooks/useChangelogCheck', () => ({ useChangelogCheck: () => undefined }));

const DESKTOP_CHROME = ['TOPBAR', 'SIGNALLINE', 'DOCK', 'MAPTOOLS', 'CHATDRAWER'];

/** Render, letting the lazy modal chunks resolve inside act. */
async function renderScreen(ui = <GameScreenV2 />) {
  let result!: ReturnType<typeof renderWithProviders>;
  await act(async () => { result = renderWithProviders(ui); });
  return result;
}

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

describe('GameScreenV2', () => {
  beforeEach(() => {
    resetToasts();
    setWidth(1280);
    useUiStore.setState({ modal: null, confirmPayload: null, promptPayload: null, hudVisible: true });
    useChatStore.setState({ chatVisible: true });
  });
  afterEach(() => setWidth(1024));

  it('marks its root as v2 and keeps the click-through overlay contract', async () => {
    const { container } = await renderScreen();
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-ui')).toBe('v2');
    expect(root.className).toBe('screen');
    // The shell never creates a canvas: the map stays client.ts's.
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('on desktop mounts every v2 slot and every shared piece', async () => {
    await renderScreen();
    for (const text of [
      ...DESKTOP_CHROME, 'MODEBANNER', 'SIDEPANEL', 'FOCUSCARD',
      'MAPCONTEXTMENU', 'ZONEPICKER', 'SERVERSWITCH', 'VERSIONBADGE', 'MOBILESHELL', 'PALETTE',
    ]) {
      expect({ text, found: screen.queryByText(text) !== null }).toEqual({ text, found: true });
    }
    // v1's ticker and context strip are replaced by the signal line on desktop
    expect(screen.queryByText('V1_WORLDEVENT')).toBeNull();
    expect(screen.queryByText('V1_CONTEXTSTATUS')).toBeNull();
    // the TopBar carries the chase control; v1's badge would sit on the bar's right end
    expect(screen.queryByText('CHASEBADGE')).toBeNull();
  });

  it('mounts the v1 VersionBadge inside the v2 slot that places it', async () => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ connectMode: { active: false, subject: '' } });
    await renderScreen();
    const slot = screen.getByText('VERSIONBADGE').parentElement as HTMLElement;
    expect(slot.className.trim()).toBe('versionSlot');
    // the side panel covers its corner: the slot hides while one is open, not in connect mode
    act(() => useUiStore.getState().toggleRightPanel('mail'));
    expect(slot.className).toContain('versionSlotUnderPanel');
    act(() => useUiStore.setState({ connectMode: { active: true, subject: 'x' } }));
    expect(slot.className).not.toContain('versionSlotUnderPanel');
    act(() => {
      useUiStore.getState().clearSurfaces();
      useUiStore.setState({ connectMode: { active: false, subject: '' } });
    });
  });

  it('below 1024 px drops the desktop chrome and keeps v1\'s ticker and context strip', async () => {
    setWidth(800);
    await renderScreen();
    for (const text of [...DESKTOP_CHROME, 'MODEBANNER']) expect(screen.queryByText(text)).toBeNull();
    expect(screen.getByText('V1_WORLDEVENT')).toBeTruthy();
    expect(screen.getByText('V1_CONTEXTSTATUS')).toBeTruthy();
    expect(screen.getByText('MOBILESHELL')).toBeTruthy();
    expect(screen.getByText('SIDEPANEL')).toBeTruthy();
    expect(screen.getByText('CHASEBADGE')).toBeTruthy();
  });

  it('H hides the top deck, dock, map tools and chat drawer — the mode banner and side panel stay', async () => {
    await renderScreen();
    act(() => useUiStore.getState().toggleHudVisible());
    for (const text of DESKTOP_CHROME) expect(screen.queryByText(text)).toBeNull();
    expect(screen.getByText('MODEBANNER')).toBeTruthy();
    // with the TopBar gone, v1's chase badge takes the top-right corner back
    expect(screen.getByText('CHASEBADGE')).toBeTruthy();
    expect(screen.getByText('SIDEPANEL')).toBeTruthy();
    expect(screen.getByText('FOCUSCARD')).toBeTruthy();
    act(() => useUiStore.getState().toggleHudVisible());
    for (const text of DESKTOP_CHROME) expect(screen.getByText(text)).toBeTruthy();
  });

  it('the chat drawer follows chatVisible', async () => {
    useChatStore.setState({ chatVisible: false });
    await renderScreen();
    expect(screen.queryByText('CHATDRAWER')).toBeNull();
    act(() => useChatStore.getState().setChatVisible(true));
    expect(screen.getByText('CHATDRAWER')).toBeTruthy();
  });

  it('renders the confirm dialog from the store, and confirming runs the action then closes', async () => {
    const onConfirm = jest.fn();
    await renderScreen();
    act(() => {
      useUiStore.getState().requestConfirm('Demolish Building', 'Sure?', onConfirm, { kind: 'destructive', confirmLabel: 'Demolish' });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { screen.getByRole('button', { name: 'Demolish' }).click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('renders the prompt dialog from the store, and submitting passes the value then closes', async () => {
    const onSubmit = jest.fn();
    await renderScreen();
    act(() => {
      useUiStore.getState().requestPrompt('Rename', 'New name', onSubmit, { defaultValue: 'Mill' });
    });
    expect(screen.getByDisplayValue('Mill')).toBeTruthy();
    fireEvent.keyDown(screen.getByDisplayValue('Mill'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('Mill');
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('mounts the keyboard shortcut help dialog lazily when modal is "shortcuts"', async () => {
    useUiStore.setState({ modal: 'shortcuts' });
    await renderScreen();
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  describe('the hint while the interface is hidden', () => {
    const HINT = 'Press H to show the interface';
    const renderWithToasts = () => renderScreen(<><ToastContainer /><GameScreenV2 /></>);

    it('hiding the HUD shows the hint; its "Show" action brings the interface back', async () => {
      await renderWithToasts();
      expect(screen.queryByText(HINT)).toBeNull();
      act(() => useUiStore.getState().setHudVisible(false));
      expect(screen.getByText(HINT)).toBeTruthy();
      act(() => { screen.getByRole('button', { name: 'Show' }).click(); });
      expect(useUiStore.getState().hudVisible).toBe(true);
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });
});
