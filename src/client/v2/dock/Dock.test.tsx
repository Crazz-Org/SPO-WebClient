import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { useChatStore } from '../../store/chat-store';
import { DEBUG_MARKERS } from '../../debug-markers';
import { Dock } from './Dock';

describe('v2 Dock', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({
      modal: null,
      commandPaletteOpen: false,
      isPlacingBuilding: false,
      connectMode: { active: false, subject: '' },
    });
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false, isPublicOfficeRole: false, isVisitor: false });
    useMailStore.setState({ unreadCount: 0 });
    useChatStore.setState({ chatVisible: true, unreadChatCount: 0 });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
  });

  it('renders the search pill and the seven actions with their shortcut hints', () => {
    renderWithProviders(<Dock />);
    expect(screen.getByRole('navigation', { name: 'Game actions' })).toBeTruthy();
    for (const name of ['Build', 'Map', 'Empire', 'Government', 'Mail', 'Chat', 'More']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('title')).toBe('Build (B)');
    expect(screen.getByRole('button', { name: 'Build' }).querySelector('kbd')?.textContent).toBe('B');
    expect(screen.getByRole('button', { name: 'Chat' }).querySelector('kbd')).toBeNull();
  });

  it('the search pill opens the command palette', () => {
    renderWithProviders(<Dock />);
    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it('each action calls its v1 store action and reflects the open surface', () => {
    renderWithProviders(<Dock />);
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['build']);
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(useUiStore.getState().stack[useUiStore.getState().stack.length - 1]?.kind).toBe('map');
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Empire' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
    expect(screen.getByRole('button', { name: 'Empire' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Government' }));
    expect(useUiStore.getState().rightPanel).toBe('politics');

    fireEvent.click(screen.getByRole('button', { name: 'Mail' }));
    expect(useUiStore.getState().rightPanel).toBe('mail');
    expect(screen.getByRole('button', { name: 'Mail' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the store actions are the ones v1 calls (spied)', () => {
    const ui = useUiStore.getState();
    const realUi = {
      toggleBuildSurface: ui.toggleBuildSurface,
      toggleMapSurface: ui.toggleMapSurface,
      toggleLeftPanel: ui.toggleLeftPanel,
      toggleRightPanel: ui.toggleRightPanel,
      openCommandPalette: ui.openCommandPalette,
    };
    const realToggleChat = useChatStore.getState().toggleChatVisible;
    const toggleBuildSurface = jest.fn();
    const toggleMapSurface = jest.fn();
    const toggleLeftPanel = jest.fn();
    const toggleRightPanel = jest.fn();
    const openCommandPalette = jest.fn();
    const toggleChatVisible = jest.fn();
    useUiStore.setState({ toggleBuildSurface, toggleMapSurface, toggleLeftPanel, toggleRightPanel, openCommandPalette });
    useChatStore.setState({ toggleChatVisible });
    try {
      renderWithProviders(<Dock />);
      fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Build' }));
      fireEvent.click(screen.getByRole('button', { name: 'Map' }));
      fireEvent.click(screen.getByRole('button', { name: 'Empire' }));
      fireEvent.click(screen.getByRole('button', { name: 'Government' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mail' }));
      fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
      expect(openCommandPalette).toHaveBeenCalledTimes(1);
      expect(toggleBuildSurface).toHaveBeenCalledTimes(1);
      expect(toggleMapSurface).toHaveBeenCalledTimes(1);
      expect(toggleLeftPanel).toHaveBeenCalledWith('empire');
      expect(toggleRightPanel).toHaveBeenNthCalledWith(1, 'politics');
      expect(toggleRightPanel).toHaveBeenNthCalledWith(2, 'mail');
      expect(toggleChatVisible).toHaveBeenCalledTimes(1);
    } finally {
      useUiStore.setState(realUi);
      useChatStore.setState({ toggleChatVisible: realToggleChat });
    }
  });

  it('Chat toggles chatVisible and carries the unread badge only while hidden', () => {
    useChatStore.setState({ chatVisible: false, unreadChatCount: 3 });
    renderWithProviders(<Dock />);
    const chat = screen.getByRole('button', { name: 'Chat, 3 unread' });
    expect(chat.getAttribute('aria-pressed')).toBe('false');
    expect(chat.textContent).toContain('3');
    fireEvent.click(chat);
    expect(useChatStore.getState().chatVisible).toBe(true);
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Mail names its unread count and caps the badge at 99+', () => {
    useMailStore.setState({ unreadCount: 150 });
    renderWithProviders(<Dock />);
    const mail = screen.getByRole('button', { name: 'Mail, 150 unread' });
    expect(mail.textContent).toContain('99+');
    act(() => useMailStore.setState({ unreadCount: 0 }));
    expect(screen.getByRole('button', { name: 'Mail' }).textContent).not.toContain('99+');
  });

  it('a visitor is not offered Build or Empire', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<Dock />);
    expect(screen.queryByRole('button', { name: 'Build' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empire' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Government' })).toBeTruthy();
  });

  it('narrows while a surface is open, but not during connect mode', () => {
    const { container } = renderWithProviders(<Dock />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('shifted');
    act(() => useUiStore.getState().toggleRightPanel('mail'));
    expect(root.className).toContain('shifted');
    act(() => useUiStore.setState({ connectMode: { active: true, subject: 'x' } }));
    expect(root.className).not.toContain('shifted');
  });

  it('More opens and closes the menu, and reflects a running road mode', () => {
    renderWithProviders(<Dock />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.className).not.toContain('active');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId(DEBUG_MARKERS.moreMenu)).toBeTruthy();
    // A mousedown on the More button itself does not close it behind the click's back
    fireEvent.mouseDown(more);
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.click(more);
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => useGameStore.setState({ isRoadBuildingMode: true }));
    expect(screen.getByRole('button', { name: 'More' }).className).toContain('active');
  });

  it('a menu item runs and closes the menu', () => {
    const onToggleMinimap = jest.fn();
    renderWithProviders(<Dock />, { clientCallbacks: createSpiedCallbacks({ onToggleMinimap }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Docked minimap' }));
    expect(onToggleMinimap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the menu and returns focus to More', () => {
    renderWithProviders(<Dock />);
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
