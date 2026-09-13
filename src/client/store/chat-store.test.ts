/**
 * Tests for chat-store: user list incremental updates.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useChatStore } from './chat-store';
import type { ChatUser, ChatTab } from './chat-store';

/** Shorthand: create a ChatUser with default nobility fields. */
function user(name: string, id: string, status = 0): ChatUser {
  return { name, id, status, nobilityPoints: 0, nobilityTier: 'Commoner', modifiers: 0 };
}

function resetStore() {
  useChatStore.setState({
    currentChannel: '',
    channels: [],
    messages: {},
    users: {},
    typingUsers: new Set(),
    isExpanded: true,
    activeTab: 'chat' as ChatTab,
    channelInfo: {},
    chasedUser: null,
  });
}

describe('Chat Store — User list', () => {
  beforeEach(resetStore);

  it('setUsers populates the users record keyed by name', () => {
    useChatStore.getState().setUsers([user('Alice', 'u1'), user('Bob', 'u2')]);
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(2);
    expect(users['Alice'].id).toBe('u1');
    expect(users['Bob'].id).toBe('u2');
  });

  it('addUser adds a new user to the record', () => {
    useChatStore.getState().setUsers([user('Alice', 'u1')]);
    useChatStore.getState().addUser(user('Bob', 'u2'));
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(2);
    expect(users['Bob'].id).toBe('u2');
  });

  it('addUser overwrites an existing user with the same name', () => {
    useChatStore.getState().setUsers([user('Alice', 'u1')]);
    useChatStore.getState().addUser(user('Alice', 'u1', 1));
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(1);
    expect(users['Alice'].status).toBe(1);
  });

  it('removeUser removes a user by name', () => {
    useChatStore.getState().setUsers([user('Alice', 'u1'), user('Bob', 'u2')]);
    useChatStore.getState().removeUser('Alice');
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(1);
    expect(users['Alice']).toBeUndefined();
    expect(users['Bob'].id).toBe('u2');
  });

  it('removeUser is a no-op for unknown name', () => {
    useChatStore.getState().setUsers([user('Alice', 'u1')]);
    useChatStore.getState().removeUser('Unknown');
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(1);
    expect(users['Alice'].name).toBe('Alice');
  });

  it('addUser with name-only fallback (id defaults to name)', () => {
    useChatStore.getState().addUser(user('Player1', 'Player1'));
    const { users } = useChatStore.getState();
    expect(users['Player1'].id).toBe('Player1');
    expect(users['Player1'].name).toBe('Player1');
  });

  it('addUser with 2-field format (name + id, no status)', () => {
    useChatStore.getState().addUser(user('Player1', '12345'));
    const { users } = useChatStore.getState();
    expect(users['Player1'].id).toBe('12345');
    expect(users['Player1'].status).toBe(0);
  });

  it('removeUser by name works when user was added with different id', () => {
    useChatStore.getState().setUsers([user('Alice', '99999')]);
    useChatStore.getState().removeUser('Alice');
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(0);
  });
});

describe('Chat Store — Channels', () => {
  beforeEach(resetStore);

  it('setChannels sets the channel list and defaults currentChannel', () => {
    useChatStore.getState().setChannels(['Lobby', 'Trade']);
    const state = useChatStore.getState();
    expect(state.channels).toEqual(['Lobby', 'Trade']);
    expect(state.currentChannel).toBe('Lobby');
  });
});

describe('Chat Store — Channel info (GetChannelInfo)', () => {
  beforeEach(resetStore);

  it('setChannelInfo records the description under the channel name', () => {
    useChatStore.getState().setChannelInfo('Lobby', 'Lobby (Creator: Admin). 5 users.');
    expect(useChatStore.getState().channelInfo['Lobby']).toBe('Lobby (Creator: Admin). 5 users.');
  });

  it('keeps each channel under its own key', () => {
    useChatStore.getState().setChannelInfo('Lobby', 'Lobby info');
    useChatStore.getState().setChannelInfo('Trade', 'Trade info');
    const { channelInfo } = useChatStore.getState();
    expect(channelInfo['Lobby']).toBe('Lobby info');
    expect(channelInfo['Trade']).toBe('Trade info');
  });

  it('overwrites a previous description for the same channel', () => {
    useChatStore.getState().setChannelInfo('Lobby', 'Loading...');
    useChatStore.getState().setChannelInfo('Lobby', 'Lobby (Creator: Admin). 5 users.');
    expect(useChatStore.getState().channelInfo['Lobby']).toBe('Lobby (Creator: Admin). 5 users.');
  });
});

describe('Chat Store — Messages', () => {
  beforeEach(resetStore);

  it('addMessage appends to the correct channel', () => {
    useChatStore.getState().addMessage('Lobby', {
      id: 'm1', from: 'Alice', text: 'Hello', timestamp: 1000, isSystem: false, isGM: false,
    });
    const { messages } = useChatStore.getState();
    expect(messages['Lobby']).toHaveLength(1);
    expect(messages['Lobby'][0].text).toBe('Hello');
  });
});

describe('Chat Store — Chased user', () => {
  beforeEach(resetStore);

  it('starts with nobody followed', () => {
    expect(useChatStore.getState().chasedUser).toBeNull();
  });

  it('setChasedUser records a name and clears it again', () => {
    useChatStore.getState().setChasedUser('Mayor of Podan');
    expect(useChatStore.getState().chasedUser).toBe('Mayor of Podan');
    useChatStore.getState().setChasedUser(null);
    expect(useChatStore.getState().chasedUser).toBeNull();
  });
});

describe('Chat Store — Typing', () => {
  beforeEach(resetStore);

  it('setUserTyping adds and removes typing users', () => {
    useChatStore.getState().setUserTyping('Alice', true);
    expect(useChatStore.getState().typingUsers.has('Alice')).toBe(true);
    useChatStore.getState().setUserTyping('Alice', false);
    expect(useChatStore.getState().typingUsers.has('Alice')).toBe(false);
  });
});
