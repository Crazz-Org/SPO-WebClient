/**
 * LegacyChatWindow — the original client's chat, opened by the toolbar's chat icon over the
 * whole map area (`ChatHandlerViewer.dfm` beside `ChatListHandlerViewer.dfm`, 150 px on the
 * right). Legacy theme only; the regular theme keeps its ChatStrip.
 *
 *   - the channels (ChannelList, 20 px icons, Arial 9 px), "No channels to show" without any;
 *     Create / Join / Leave Channel and the channel marquee;
 *   - the conversation, as ServerCnxHandler.pas formats it (:3120-3157, rsSystemFormat :358):
 *     system lines "hh:mm:ss - SYSTEM: …" green Times New Roman 13 pt italic, a player's name
 *     yellow in Verdana before white text, a GM's name grey, italic text — each name led by
 *     the player's role and nobility icons (ChatListHandlerViewer.DecodeCodeMSGChat);
 *   - "Enter chat text here..." under it;
 *   - the "Chat" column: the users (ChatList.dat icons, the nobility margin under the name),
 *     Ignore User, Follow User, Chat over Map, Talk Panel, Log.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useClient } from '../../../context';
import { useChatStore, type ChatMessage, type ChatUser } from '../../../store/chat-store';
import { useGameStore } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { useMapStore } from '../../../store/map-store';
import { runChatCommand, type ChatCommandContext } from '../../../chat-commands';
import { LegacyMarquee } from './LegacyMarquee';
import { chatUserIcons, nobilityRank } from './legacy-chat-icons';
import styles from './LegacyChatWindow.module.css';

const MARQUEE_WELCOME = 'WELCOME TO STAR PEACE CHAT.';
const CHAT_PLACEHOLDER = 'Enter chat text here...';

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function UserIcons({ user }: { user: ChatUser | undefined }) {
  if (!user) return null;
  return (
    <>
      {chatUserIcons(user.modifiers, user.nobilityPoints).map((icon) => (
        <span key={icon} className={styles.icon} data-icon={icon} aria-hidden="true" />
      ))}
    </>
  );
}

function ChatLine({ msg, user }: { msg: ChatMessage; user: ChatUser | undefined }) {
  if (msg.isSystem) {
    return <div className={styles.systemLine}>{`${timeOf(msg.timestamp)} - ${msg.from || 'SYSTEM'}: ${msg.text}`}</div>;
  }
  return (
    <div className={styles.line}>
      <UserIcons user={user} />
      <span className={msg.isGM ? styles.gmName : styles.name}>{msg.from}: </span>
      <span className={msg.isGM ? styles.gmText : styles.text}>{msg.text}</span>
    </div>
  );
}

interface LegacyChatWindowProps {
  chatOverMap: boolean;
  onToggleChatOverMap: () => void;
}

export function LegacyChatWindow({ chatOverMap, onToggleChatOverMap }: LegacyChatWindowProps) {
  const client = useClient();
  const channels = useChatStore((s) => s.channels);
  const currentChannel = useChatStore((s) => s.currentChannel);
  const messages = useChatStore((s) => s.messages[s.currentChannel]);
  const users = useChatStore((s) => s.users);
  const ignored = useChatStore((s) => s.ignored);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const username = useGameStore((s) => s.username);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [marquee, setMarquee] = useState(MARQUEE_WELCOME);
  const logRef = useRef<HTMLDivElement>(null);

  // The marquee announces each channel that appears after the window opened.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const names = new Set(channels.map((c) => c.name));
    if (known.current) {
      const added = [...names].filter((n) => !known.current!.has(n));
      if (added.length > 0) setMarquee(`A NEW CHANNEL (${added[added.length - 1].toUpperCase()}) WAS CREATED.`);
    }
    known.current = names;
  }, [channels]);

  // The newest line stays in view (ChatRenderer.ShowLast).
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    useChatStore.getState().resetUnreadChat();
  }, [messages]);

  const sortedUsers = useMemo(
    () => Object.values(users).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const join = (name: string) => {
    const channel = channels.find((c) => c.name === name);
    if (!channel) return;
    const previous = useChatStore.getState().currentChannel;
    const go = (password?: string) => {
      useChatStore.getState().setCurrentChannel(channel.name);
      client.onJoinChannel(channel.name === 'Lobby' ? '' : channel.name, password, previous);
      client.onGetChannelInfo(channel.name);
    };
    if (channel.isProtected) {
      useUiStore.getState().requestPrompt(`Join "${channel.name}"`, `Password for "${channel.name}"`, (pw) => go(pw), { type: 'password' });
    } else {
      go();
    }
  };

  const leave = () => {
    const previous = useChatStore.getState().currentChannel;
    useChatStore.getState().setCurrentChannel('Lobby');
    client.onJoinChannel('', undefined, previous);
  };

  const commandContext: ChatCommandContext = useMemo(() => ({
    moveTo: (x, y) => {
      useMapStore.getState().source?.centerOn(x, y);
      useMapStore.getState().recordPosition(x, y);
    },
    endComposition: () => client.onChatTypingChange(false),
    setAway: () => client.onChatAway(),
    tellPlayer: (message) => {
      const chat = useChatStore.getState();
      chat.addMessage(chat.currentChannel, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'SYSTEM',
        text: message,
        timestamp: Date.now(),
        isSystem: true,
        isGM: false,
      });
    },
  }), [client]);

  const send = () => {
    const line = text.trim();
    if (!line) return;
    setText('');
    if (runChatCommand(line, commandContext) === 'handled') return;
    client.onChatTypingChange(false);
    client.onSendChatMessage(line);
  };

  const inLobby = !currentChannel || currentChannel === 'Lobby';
  const isIgnored = selectedUser !== null && ignored.includes(selectedUser);
  const listedChannels = channels.filter((c) => c.name !== 'Lobby');

  return (
    <div className={styles.window} role="region" aria-label="Chat">
      <div className={styles.main}>
        <div className={styles.channels}>
          {listedChannels.length === 0 ? (
            <div className={styles.noChannels}>No channels to show</div>
          ) : (
            <div className={styles.channelList} role="listbox" aria-label="Channels">
              {listedChannels.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={selectedChannel === c.name}
                  className={`${styles.channel} ${selectedChannel === c.name ? styles.channelSelected : ''} ${c.name === currentChannel ? styles.channelCurrent : ''}`}
                  title={c.isProtected ? `${c.name} (password)` : c.name}
                  onClick={() => setSelectedChannel(c.name)}
                  onDoubleClick={() => join(c.name)}
                >
                  <span className={styles.channelIcon} aria-hidden="true" />
                  <span className={styles.channelName}>{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className={styles.channelBar}>
            <button type="button" className={styles.framed} onClick={() => useUiStore.getState().openModal('createChannel')}>
              Create Channel
            </button>
            <button
              type="button"
              className={styles.framed}
              disabled={!selectedChannel || selectedChannel === currentChannel}
              onClick={() => selectedChannel && join(selectedChannel)}
            >
              Join Channel
            </button>
            <button type="button" className={styles.framed} disabled={inLobby} onClick={leave}>
              Leave Channel
            </button>
            <div className={styles.channelMarquee}>
              <LegacyMarquee text={marquee} direction="up" className={styles.channelMarqueeText} />
            </div>
          </div>
        </div>

        <div className={styles.log} ref={logRef} role="log" aria-live="polite">
          {(messages ?? []).map((m) => (
            <ChatLine key={m.id} msg={m} user={users[m.from]} />
          ))}
        </div>

        <div className={styles.composer}>
          <input
            className={styles.input}
            value={text}
            placeholder={CHAT_PLACEHOLDER}
            aria-label="Chat message"
            onChange={(e) => {
              setText(e.target.value);
              client.onChatTypingChange(e.target.value.length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
      </div>

      <div className={styles.side}>
        <div className={styles.title}>
          <span className={styles.titleIcon} aria-hidden="true" />
          Chat
        </div>
        <div className={styles.users} role="listbox" aria-label="Users">
          {sortedUsers.map((u) => {
            const rank = nobilityRank(u.nobilityPoints);
            return (
              <button
                key={u.name}
                type="button"
                role="option"
                aria-selected={selectedUser === u.name}
                className={`${styles.user} ${selectedUser === u.name ? styles.userSelected : ''}`}
                onClick={() => setSelectedUser(u.name)}
              >
                {rank && <span className={styles.nobTop} aria-hidden="true" />}
                <span className={styles.userRow}>
                  <span
                    className={styles.icon}
                    data-icon={ignored.includes(u.name) ? 'ignoreuser' : typingUsers.has(u.name) ? 'writing' : u.isAway ? 'afk' : 'void'}
                    aria-hidden="true"
                  />
                  <UserIcons user={u} />
                  <span className={styles.userName}>{u.name}</span>
                </span>
                {rank && <span className={styles.nobMargin} data-rank={rank} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className={styles.sideButtons}>
          <button
            type="button"
            className={styles.framed}
            disabled={!selectedUser || selectedUser === username}
            onClick={() => {
              if (!selectedUser) return;
              const chat = useChatStore.getState();
              if (isIgnored) chat.unignoreUser(selectedUser);
              else chat.ignoreUser(selectedUser);
            }}
          >
            {isIgnored ? 'Unignore User' : 'Ignore User'}
          </button>
          <button
            type="button"
            className={styles.framed}
            disabled={!selectedUser || selectedUser === username}
            onClick={() => selectedUser && client.onChaseUser(selectedUser)}
          >
            Follow User
          </button>
          <button type="button" className={styles.framed} aria-pressed={chatOverMap} onClick={onToggleChatOverMap}>
            Chat over Map
          </button>
          <button type="button" className={styles.framed} disabled title="Not available in this client">
            Talk Panel
          </button>
          <button type="button" className={styles.framed} onClick={() => useUiStore.getState().openModal('chatHistory')}>
            Log
          </button>
        </div>
      </div>
    </div>
  );
}
