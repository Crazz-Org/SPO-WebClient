import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, act } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useChatStore, type ChatMessage } from '../../store/chat-store';
import { useUiStore } from '../../store/ui-store';
import { ChatBanner } from './ChatBanner';

const msg = (id: string, isSystem: boolean): ChatMessage =>
  ({ id, from: 'someone', text: 'hello', timestamp: 1, isSystem, isGM: false });

describe('ChatBanner debug marker (issue 1192)', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ mobileTab: 'map' });
    useChatStore.setState({ currentChannel: 'Lobby', messages: { Lobby: [] } });
  });

  it('a new player message on the map tab shows the banner marker', () => {
    renderWithProviders(<ChatBanner />);
    expect(screen.queryByTestId('chat-banner')).toBeNull();
    act(() => useChatStore.setState({ messages: { Lobby: [msg('1', false)] } }));
    expect(screen.getByTestId('chat-banner')).toBeTruthy();
  });

  it('a system message shows no banner', () => {
    renderWithProviders(<ChatBanner />);
    act(() => useChatStore.setState({ messages: { Lobby: [msg('1', true)] } }));
    expect(screen.queryByTestId('chat-banner')).toBeNull();
  });
});
