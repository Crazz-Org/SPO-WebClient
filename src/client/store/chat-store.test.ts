/**
 * Tests for chat-store: user list incremental updates.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { useChatStore, MAX_MESSAGES_PER_CHANNEL } from './chat-store';
import type { ChatUser, ChatTab, ChatChannel } from './chat-store';
import { CHAT_VISIBLE_KEY } from './chat-visibility';

const storageMap = new Map<string, string>();

function installStorage() {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => { storageMap.set(k, v); },
    removeItem: (k: string) => { storageMap.delete(k); },
  };
}

/** Shorthand: create a ChatUser with default nobility fields. */
function user(name: string, id: string, isAway = false): ChatUser {
  return { name, id, isAway, nobilityPoints: 0, nobilityTier: 'Commoner', modifiers: 0 };
}

function resetStore() {
  useChatStore.setState({
    currentChannel: '',
    channels: [],
    messages: {},
    users: {},
    typingUsers: new Set(),
    isExpanded: true,
    chatVisible: true,
    activeTab: 'chat' as ChatTab,
    unreadChatCount: 0,
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
    useChatStore.getState().addUser(user('Alice', 'u1', true));
    const { users } = useChatStore.getState();
    expect(Object.keys(users)).toHaveLength(1);
    expect(users['Alice'].isAway).toBe(true);
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

  it('addUser with 2-field format (name + id, no afk flag)', () => {
    useChatStore.getState().addUser(user('Player1', '12345'));
    const { users } = useChatStore.getState();
    expect(users['Player1'].id).toBe('12345');
    expect(users['Player1'].isAway).toBe(false);
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

  /** An open (password-free) channel, the shape GetChannelList yields for one. */
  const open_ = (name: string): ChatChannel => ({ name, isProtected: false });

  it('setChannels sets the channel list and defaults currentChannel', () => {
    const channels = [
      { name: 'Lobby', isProtected: false },
      { name: 'Trade', isProtected: false },
    ];
    useChatStore.getState().setChannels(channels);
    const state = useChatStore.getState();
    expect(state.channels).toEqual(channels);
    expect(state.currentChannel).toBe('Lobby');
  });

  it('addChannel appends one name to the list', () => {
    useChatStore.getState().setChannels([open_('Lobby')]);
    useChatStore.getState().addChannel('Traders');
    expect(useChatStore.getState().channels).toEqual([open_('Lobby'), open_('Traders')]);
  });

  it('addChannel ignores a name already listed — the creator and the broadcast both insert it', () => {
    useChatStore.getState().setChannels([open_('Lobby'), open_('Traders')]);
    useChatStore.getState().addChannel('Traders');
    expect(useChatStore.getState().channels).toEqual([open_('Lobby'), open_('Traders')]);
  });

  it('addChannel ignores a name already listed even when that one is password-protected', () => {
    useChatStore.getState().setChannels([{ name: 'Traders', isProtected: true }]);
    useChatStore.getState().addChannel('Traders');
    // The padlock must survive: a bare "channel created" push carries no password
    // status, so re-inserting it would silently unlock the entry.
    expect(useChatStore.getState().channels).toEqual([{ name: 'Traders', isProtected: true }]);
  });

  it('addChannel ignores an empty name', () => {
    useChatStore.getState().setChannels([open_('Lobby')]);
    useChatStore.getState().addChannel('');
    expect(useChatStore.getState().channels).toEqual([open_('Lobby')]);
  });

  it('removeChannel filters the name out and leaves currentChannel alone', () => {
    useChatStore.getState().setChannels([open_('Lobby'), open_('Traders')]);
    useChatStore.setState({ currentChannel: 'Traders' });

    useChatStore.getState().removeChannel('Traders');

    const state = useChatStore.getState();
    expect(state.channels).toEqual([open_('Lobby')]);
    // The server sends its own channel-change notice when it moves you.
    expect(state.currentChannel).toBe('Traders');
  });

  it('removeChannel on an unknown name changes nothing', () => {
    useChatStore.getState().setChannels([open_('Lobby')]);
    useChatStore.getState().removeChannel('Nowhere');
    expect(useChatStore.getState().channels).toEqual([open_('Lobby')]);
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

  it('retains up to MAX_MESSAGES_PER_CHANNEL and drops the oldest overflow, well past the strip\'s 50-line window', () => {
    const total = MAX_MESSAGES_PER_CHANNEL + 20;
    for (let i = 0; i < total; i++) {
      useChatStore.getState().addMessage('Lobby', {
        id: `m${i}`, from: 'Alice', text: `msg-${i}`, timestamp: i, isSystem: false, isGM: false,
      });
    }
    const { messages } = useChatStore.getState();
    const retained = messages['Lobby'];
    expect(retained).toHaveLength(MAX_MESSAGES_PER_CHANNEL);
    expect(retained.length).toBeGreaterThan(50);
    // The oldest 20 were dropped; the newest is last.
    expect(retained[0].text).toBe('msg-20');
    expect(retained[retained.length - 1].text).toBe(`msg-${total - 1}`);
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

describe('Chat Store — chatVisible (#610)', () => {
  beforeEach(() => {
    storageMap.clear();
    installStorage();
    resetStore();
  });
  afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

  it('toggleChatVisible flips the flag and persists it', () => {
    useChatStore.getState().toggleChatVisible();
    expect(useChatStore.getState().chatVisible).toBe(false);
    expect(storageMap.get(CHAT_VISIBLE_KEY)).toBe('false');
    useChatStore.getState().toggleChatVisible();
    expect(useChatStore.getState().chatVisible).toBe(true);
    expect(storageMap.get(CHAT_VISIBLE_KEY)).toBe('true');
  });

  it('setChatVisible(true) zeroes unreadChatCount; setChatVisible(false) leaves it alone', () => {
    useChatStore.setState({ unreadChatCount: 5 });
    useChatStore.getState().setChatVisible(false);
    expect(useChatStore.getState().unreadChatCount).toBe(5);
    useChatStore.getState().setChatVisible(true);
    expect(useChatStore.getState().unreadChatCount).toBe(0);
  });

  it('addMessage keeps accumulating messages and unreadChatCount while chat is hidden', () => {
    useChatStore.getState().setChatVisible(false);
    useChatStore.getState().addMessage('Lobby', {
      id: 'm1', from: 'Alice', text: 'Hello', timestamp: 1000, isSystem: false, isGM: false,
    });
    useChatStore.getState().addMessage('Lobby', {
      id: 'm2', from: 'Bob', text: 'Hi', timestamp: 1001, isSystem: false, isGM: false,
    });
    const state = useChatStore.getState();
    expect(state.chatVisible).toBe(false);
    expect(state.messages['Lobby']).toHaveLength(2);
    expect(state.unreadChatCount).toBe(2);
  });
});
