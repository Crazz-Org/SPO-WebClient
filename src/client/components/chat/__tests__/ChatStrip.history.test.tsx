/**
 * ChatStrip — the "Open chat history" button and the strip's own render window.
 *
 * The strip only ever shows its last `STRIP_RENDER_WINDOW` (50) messages; the
 * full transcript lives in ChatHistoryModal, opened from this button.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useChatStore, type ChatMessage } from '../../../store/chat-store';
import { useUiStore } from '../../../store/ui-store';
import { ChatStrip } from '../ChatStrip';

function seedMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({ id: `m${i}`, from: 'Alice', text: `line-${i}`, timestamp: i, isSystem: false, isGM: false });
  }
  return messages;
}

beforeEach(() => {
  resetStores();
  useChatStore.setState({
    currentChannel: 'Lobby',
    channels: [{ name: 'Lobby', isProtected: false }],
    messages: {},
    users: {},
    isExpanded: true,
  });
});

describe('ChatStrip — Open chat history', () => {
  it('shows the button in the expanded header and clicking it opens the modal', () => {
    renderWithProviders(<ChatStrip mode="embedded" />);

    const button = screen.getByLabelText('Open chat history');
    expect(button).toBeTruthy();

    fireEvent.click(button);

    expect(useUiStore.getState().modal).toBe('chatHistory');
  });
});

describe('ChatStrip — render window', () => {
  it('renders only the last 50 of 120 messages', () => {
    useChatStore.setState({ messages: { Lobby: seedMessages(120) } });

    renderWithProviders(<ChatStrip mode="embedded" />);

    expect(screen.queryByText('line-0')).toBeNull();
    expect(screen.queryByText('line-69')).toBeNull();
    expect(screen.getByText('line-70')).toBeTruthy();
    expect(screen.getByText('line-119')).toBeTruthy();
  });
});
