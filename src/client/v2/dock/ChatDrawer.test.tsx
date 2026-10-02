import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useChatStore } from '../../store/chat-store';
import { ChatDrawer } from './ChatDrawer';
import * as barrel from './index';
import { Dock } from './Dock';
import { MapTools } from './MapTools';

jest.mock('../../components/chat', () => ({
  ChatStrip: ({ mode }: { mode?: string }) => <div data-testid="chat-strip">{mode}</div>,
}));

describe('v2 ChatDrawer', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
    useChatStore.setState({ chatVisible: true, unreadChatCount: 0 });
  });

  it('frames the ChatStrip in its embedded mode', () => {
    renderWithProviders(<ChatDrawer />);
    expect(screen.getByRole('region', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByTestId('chat-strip').textContent).toBe('embedded');
  });

  it('the minimise tab hides the chat through the v1 toggle', () => {
    renderWithProviders(<ChatDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    expect(useChatStore.getState().chatVisible).toBe(false);
  });
});

describe('v2 dock barrel', () => {
  it('exports the three slots under their contract names', () => {
    expect(barrel.Dock).toBe(Dock);
    expect(barrel.MapTools).toBe(MapTools);
    expect(barrel.ChatDrawer).toBe(ChatDrawer);
  });
});
