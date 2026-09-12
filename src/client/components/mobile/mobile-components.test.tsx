/**
 * Smoke tests for mobile components (BottomNav, BottomSheet).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { useUiStore } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { useMailStore } from '../../store/mail-store';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { BottomNav } from './BottomNav';
import { BottomSheet } from './BottomSheet';

describe('BottomNav — the mobile command bar', () => {
  beforeEach(() => { resetStores(); useUiStore.getState().clearSurfaces(); useUiStore.getState().setMobileTab('map'); });

  it('renders the six tiles of the desktop bar', () => {
    renderWithProviders(<BottomNav />);
    for (const name of ['Build', 'Map', 'Chat', 'Government', 'Mail', 'More']) expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.queryByLabelText('Fav')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Game actions' })).toBeTruthy();
  });

  it('Map, Government and Mail open their surfaces (and close them again); the tile reflects the top surface', () => {
    renderWithProviders(<BottomNav />);
    fireEvent.click(screen.getByLabelText('Map'));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['map']);
    expect(screen.getByLabelText('Map').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByLabelText('Map'));
    expect(useUiStore.getState().stack).toEqual([]);
    fireEvent.click(screen.getByLabelText('Government'));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['politics']);
    expect(screen.getByLabelText('Government').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByLabelText('Mail'));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['mail']);
    expect(screen.getByLabelText('Government').getAttribute('aria-selected')).toBe('false');
  });

  it('Build / Chat / More are sheet tabs: tapping clears any surface, tapping again returns to the map', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    renderWithProviders(<BottomNav />);
    fireEvent.click(screen.getByLabelText('Build'));
    expect(useUiStore.getState().stack).toEqual([]);
    expect(useUiStore.getState().mobileTab).toBe('build');
    expect(screen.getByLabelText('Build').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByLabelText('Build'));
    expect(useUiStore.getState().mobileTab).toBe('map');
    fireEvent.click(screen.getByLabelText('More'));
    expect(useUiStore.getState().mobileTab).toBe('more');
  });

  it('a visitor sees no Build tile', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<BottomNav />);
    expect(screen.queryByLabelText('Build')).toBeNull();
    for (const name of ['Map', 'Chat', 'Government', 'Mail', 'More']) expect(screen.getByLabelText(name)).toBeTruthy();
  });

  it('badges: unread chat on Chat, unread mail on Mail', () => {
    useChatStore.setState({ unreadChatCount: 3 });
    useMailStore.setState({ unreadCount: 12 });
    renderWithProviders(<BottomNav />);
    expect(screen.getByLabelText('Chat').textContent).toContain('3');
    expect(screen.getByLabelText('Mail').textContent).toContain('9+');
  });
});

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <BottomSheet open={false} onClose={() => {}} title="Test">Content</BottomSheet>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open', () => {
    renderWithProviders(
      <BottomSheet open={true} onClose={() => {}} title="Building Inspector">
        <p>Sheet content</p>
      </BottomSheet>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
