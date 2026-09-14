/**
 * ChatStrip — the sender badge and role colour on a rendered chat line.
 *
 * `DecodeCodeMSGChat` decorates a chat line from the AccDesc it carries, never
 * from the roster (`ChatListHandlerViewer.pas:137-149`) — this is the
 * component-level proof that `ChatMessage` follows the same order: the
 * message's own fields win, the user map is the fallback. Assertions are
 * scoped to the message row itself (`.message`) because a seeded user also
 * shows its own badge in the online sidebar, which must not be mistaken for
 * the chat line's.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useChatStore, type ChatMessage } from '../../../store/chat-store';
import { ChatStrip } from '../ChatStrip';
import type { ChatUser } from '@/shared/types';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    from: 'Someone',
    text: 'hello',
    timestamp: 0,
    isSystem: false,
    isGM: false,
    ...overrides,
  };
}

function user(overrides: Partial<ChatUser>): ChatUser {
  return {
    name: 'Someone',
    id: 'u1',
    status: 0,
    nobilityPoints: 0,
    nobilityTier: 'Commoner',
    modifiers: 0,
    ...overrides,
  } as ChatUser;
}

/** The rendered chat line, never the online-sidebar row for the same user. */
function messageRow(): HTMLElement {
  const row = document.querySelector('.message');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function setup() {
  return renderWithProviders(<ChatStrip mode="embedded" />);
}

beforeEach(() => {
  resetStores();
  useChatStore.setState({
    currentChannel: 'Lobby',
    channels: ['Lobby'],
    messages: {},
    users: {},
    isExpanded: true,
  });
});

describe('ChatMessage badge and role colour', () => {
  it('renders the badge from the message for a speaker absent from the user list', () => {
    useChatStore.setState({
      messages: { Lobby: [message({ from: 'Zorg', text: 'hi', nobilityTier: 'Duke', modifiers: 16 })] },
    });

    setup();

    const badge = messageRow().querySelector('[title]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('title')).toBe('Duke • GM');
  });

  it('falls back to the user map when the message carries nothing', () => {
    useChatStore.setState({
      users: { SPO_test3: user({ name: 'SPO_test3', nobilityTier: 'Baron', modifiers: 128 }) },
      messages: { Lobby: [message({ from: 'SPO_test3', text: 'hi' })] },
    });

    setup();

    const badge = messageRow().querySelector('[title]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('title')).toBe('Baron • Veteran');
  });

  it('the message fields win over a disagreeing user-map entry', () => {
    useChatStore.setState({
      users: { SPO_test3: user({ name: 'SPO_test3', nobilityTier: 'Baron', modifiers: 128 }) },
      messages: { Lobby: [message({ from: 'SPO_test3', text: 'hi', nobilityTier: 'Duke', modifiers: 16 })] },
    });

    setup();

    const badge = messageRow().querySelector('[title]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('title')).toBe('Duke • GM');
  });

  it('puts the role colour class on the body span and never on the sender', () => {
    useChatStore.setState({
      messages: { Lobby: [message({ from: 'Zorg', text: 'hi', nobilityTier: 'Duke', modifiers: 16 })] },
    });

    setup();
    const row = messageRow();

    const body = row.querySelector('span[class*="text"]');
    expect(body).not.toBeNull();
    expect(body!.className).toMatch(/roleGameMaster/);

    const sender = row.querySelector('span[class*="sender"]');
    expect(sender).not.toBeNull();
    expect(sender!.className).not.toMatch(/roleGameMaster/);
  });

  it('renders no badge for a system line, even with flags on the message', () => {
    useChatStore.setState({
      messages: { Lobby: [message({ from: 'SYSTEM', text: 'hi', isSystem: true, nobilityTier: 'Duke', modifiers: 16 })] },
    });

    setup();

    expect(messageRow().querySelector('[title]')).toBeNull();
  });
});
