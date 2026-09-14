/**
 * Chat Store — Channels, messages, users, and typing state.
 */

import { create } from 'zustand';
import type { ChatUser } from '../../shared/types/domain-types';
import { loadChatVisible, saveChatVisible } from './chat-visibility';

export type { ChatUser };

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  timestamp: number;
  isSystem: boolean;
  isGM: boolean;
  nobilityTier?: string;
  modifiers?: number;
}

const MAX_MESSAGES_PER_CHANNEL = 100;

export type ChatTab = 'chat' | 'online';

interface ChatState {
  // State
  currentChannel: string;
  channels: string[];
  messages: Record<string, ChatMessage[]>;
  users: Record<string, ChatUser>;
  typingUsers: Set<string>;
  isExpanded: boolean;
  /** Desktop only: false hides the ChatStrip entirely. Persisted — issue #610. */
  chatVisible: boolean;
  activeTab: ChatTab;
  /** Unread message count for mobile chat tab badge */
  unreadChatCount: number;
  /** Channel name -> description returned by GetChannelInfo (creator, member count, password status). */
  channelInfo: Record<string, string>;
  /** Name of the player whose camera we are following, or null. Delphi's fChasedUser. */
  chasedUser: string | null;

  // Actions
  setCurrentChannel: (channel: string) => void;
  setChannels: (channels: string[]) => void;
  /** Insert one channel, ignoring a name already listed. Delphi's fControl.AddChannel. */
  addChannel: (channel: string) => void;
  /** Drop one channel. Delphi's fControl.DelChannel. */
  removeChannel: (channel: string) => void;
  setChannelInfo: (channel: string, info: string) => void;
  addMessage: (channel: string, message: ChatMessage) => void;
  setUsers: (users: ChatUser[]) => void;
  addUser: (user: ChatUser) => void;
  removeUser: (userName: string) => void;
  setUserTyping: (username: string, isTyping: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  setActiveTab: (tab: ChatTab) => void;
  resetUnreadChat: () => void;
  setChasedUser: (name: string | null) => void;
  setChatVisible: (visible: boolean) => void;
  toggleChatVisible: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentChannel: '',
  channels: [],
  messages: {},
  users: {},
  typingUsers: new Set(),
  isExpanded: true,
  chatVisible: loadChatVisible(),
  activeTab: 'chat' as ChatTab,
  unreadChatCount: 0,
  channelInfo: {},
  chasedUser: null,

  setCurrentChannel: (channel) => set({ currentChannel: channel }),

  setChannels: (channels) => set((state) => ({
    channels,
    currentChannel: state.currentChannel || (channels.length > 0 ? channels[0] : ''),
  })),

  addChannel: (channel) => set((state) =>
    !channel || state.channels.includes(channel) ? {} : { channels: [...state.channels, channel] }),

  // Deliberately leaves `currentChannel` alone: the server sends its own
  // channel-change notice when it moves you, and guessing here would be a
  // regression risk of its own.
  removeChannel: (channel) => set((state) => ({
    channels: state.channels.filter((c) => c !== channel),
  })),

  setChannelInfo: (channel, info) =>
    set((state) => ({
      channelInfo: { ...state.channelInfo, [channel]: info },
    })),

  addMessage: (channel, message) =>
    set((state) => {
      const existing = state.messages[channel] ?? [];
      const updated = [...existing, message].slice(-MAX_MESSAGES_PER_CHANNEL);
      return {
        messages: { ...state.messages, [channel]: updated },
        unreadChatCount: state.unreadChatCount + (message.isSystem ? 0 : 1),
      };
    }),

  setUsers: (users) => {
    const map: Record<string, ChatUser> = {};
    for (const u of users) {
      map[u.name] = u;
    }
    set({ users: map });
  },

  addUser: (user) =>
    set((state) => ({
      users: { ...state.users, [user.name]: user },
    })),

  removeUser: (userName) =>
    set((state) => {
      const { [userName]: _, ...rest } = state.users;
      return { users: rest };
    }),

  setUserTyping: (username, isTyping) =>
    set((state) => {
      const next = new Set(state.typingUsers);
      if (isTyping) {
        next.add(username);
      } else {
        next.delete(username);
      }
      return { typingUsers: next };
    }),

  setExpanded: (expanded) => set({ isExpanded: expanded }),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  resetUnreadChat: () => set({ unreadChatCount: 0 }),

  setChasedUser: (name) => set({ chasedUser: name }),

  setChatVisible: (visible) => {
    saveChatVisible(visible);
    // Showing chat is the player reading it — the toggle's badge clears with it.
    set(visible ? { chatVisible: true, unreadChatCount: 0 } : { chatVisible: false });
  },

  toggleChatVisible: () => get().setChatVisible(!get().chatVisible),
}));
