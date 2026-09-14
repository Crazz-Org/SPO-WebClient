/**
 * ChatStrip — Bottom-center persistent chat hub.
 *
 * Reduced (44px): online badge + last message preview + input + expand toggle.
 * Expanded (300px): header with channel dropdown, chat messages on left, online users on right, input.
 * z-150, centered at bottom of viewport.
 */

import { useState, useRef, useCallback, useEffect, useMemo, memo, Fragment } from 'react';
import { ChevronUp, ChevronDown, ChevronUp as ChevronUpIcon, Send, Users, Eye, Lock, Plus, Star, History } from 'lucide-react';
import { useChatStore } from '../../store/chat-store';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMapStore } from '../../store/map-store';
import { useClient } from '../../context';
import { loadDefaultChannel, saveDefaultChannel } from '../../store/default-channel';
import { NobilityBadge } from './NobilityBadge';
import { roleClassKeyFor } from '../../chat-line-format';
import { runChatCommand, splitChatCoordinates, type ChatCommandContext } from '../../chat-commands';
import styles from './ChatStrip.module.css';

/** How long a pause retracts the "typing..." notice, in ms. */
const TYPING_IDLE_MS = 4000;

/** How many of the retained messages the strip itself renders. */
const STRIP_RENDER_WINDOW = 50;

/**
 * Move the camera to a tile — the one owner for "go to a tile", used by both `/go`
 * and a clicked coordinate, mirroring what the map context menu and the chase event
 * already do (`MapContextMenu.tsx`, `handlers/event-handler.ts`).
 */
function goToCoordinate(x: number, y: number): void {
  const source = useMapStore.getState().source;
  if (!source) return; // no renderer yet — a click must not throw
  source.centerOn(x, y);
  useMapStore.getState().recordPosition(x, y); // a jump is a jump: Back / Next must see it
}

interface ChatMessageProps {
  id: string;
  from: string;
  text: string;
  isSystem?: boolean;
  isGM?: boolean;
  nobilityTier?: string;
  modifiers?: number;
}

const ChatMessage = memo(function ChatMessage({ from, text, isSystem, isGM, nobilityTier, modifiers }: ChatMessageProps) {
  const user = useChatStore((s) => s.users[from]);
  // The message's own flags win; the user map is the fallback — the legacy
  // order, where DecodeCodeMSGChat decorates from the line and never looks
  // at the roster (ChatListHandlerViewer.pas:137-149).
  const tier = nobilityTier ?? user?.nobilityTier;
  const mods = modifiers ?? user?.modifiers;
  const roleKey = roleClassKeyFor(mods);
  return (
    <div className={`${styles.message} ${isSystem ? styles.system : ''} ${isGM ? styles.gm : ''}`}>
      {!isSystem && (
        <>
          {(tier !== undefined || mods !== undefined) && (
            <NobilityBadge nobilityTier={tier ?? ''} modifiers={mods ?? 0} size="md" />
          )}
          <span className={styles.sender}>{from}</span>
        </>
      )}
      <span className={[styles.text, roleKey ? styles[roleKey] : ''].filter(Boolean).join(' ')}>
        {splitChatCoordinates(text).map((seg, i) =>
          seg.kind === 'coord' ? (
            <button
              key={i}
              type="button"
              className={styles.coordLink}
              onClick={() => goToCoordinate(seg.x, seg.y)}
              title="Go to these coordinates"
            >
              {seg.text}
            </button>
          ) : (
            <Fragment key={i}>{seg.text}</Fragment>
          ),
        )}
      </span>
    </div>
  );
});

interface ChatStripProps {
  /** 'desktop' (default): positioned bottom-center. 'embedded': fills parent, always expanded. */
  mode?: 'desktop' | 'embedded';
}

export function ChatStrip({ mode = 'desktop' }: ChatStripProps) {
  const currentChannel = useChatStore((s) => s.currentChannel);
  const channels = useChatStore((s) => s.channels);
  const channelInfo = useChatStore((s) => s.channelInfo);
  const messages = useChatStore((s) => s.messages);
  const users = useChatStore((s) => s.users);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const isExpanded = useChatStore((s) => s.isExpanded);
  const toggleExpanded = useChatStore((s) => s.toggleExpanded);
  const setCurrentChannel = useChatStore((s) => s.setCurrentChannel);
  const chasedUser = useChatStore((s) => s.chasedUser);
  const username = useGameStore((s) => s.username);

  const client = useClient();
  const [input, setInput] = useState('');
  const [defaultChannel, setDefaultChannel] = useState<string | null>(() => loadDefaultChannel());
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const typingIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const channelMessages = messages[currentChannel] ?? [];
  const lastMessage = channelMessages[channelMessages.length - 1];
  const visibleMessages = useMemo(() => channelMessages.slice(-STRIP_RENDER_WINDOW), [channelMessages]);
  const onlineCount = useMemo(() => Object.keys(users).length, [users]);
  const userList = useMemo(() => Object.values(users), [users]);

  // Auto-scroll on new messages when expanded
  useEffect(() => {
    if (isExpanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [channelMessages.length, isExpanded]);

  // Close channel dropdown on outside click
  useEffect(() => {
    if (!channelDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setChannelDropdownOpen(false);
        setPendingChannel(null);
        setPasswordInput('');
      }
    };
    // Use setTimeout to avoid the same click event closing it immediately
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [channelDropdownOpen]);

  // Announce composition to the other players. The notice is a hint, not state:
  // it goes out on the transitions only, and an idle pause retracts it so a user
  // who wanders off mid-sentence does not stay "typing..." forever.
  const announceTyping = useCallback((isTyping: boolean) => {
    if (typingIdleTimer.current) {
      clearTimeout(typingIdleTimer.current);
      typingIdleTimer.current = null;
    }
    client.onChatTypingChange(isTyping);
    if (isTyping) {
      typingIdleTimer.current = setTimeout(() => {
        typingIdleTimer.current = null;
        client.onChatTypingChange(false);
      }, TYPING_IDLE_MS);
    }
  }, [client]);

  // Retract the notice if the strip goes away mid-sentence.
  useEffect(() => () => {
    if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInput(text);
    announceTyping(text.length > 0);
  }, [announceTyping]);

  // `/go` and `/afk` — routed here instead of to the server, per runChatCommand.
  const commandContext: ChatCommandContext = useMemo(() => ({
    moveTo: goToCoordinate,
    endComposition: () => announceTyping(false),
    setAway: () => {
      // The idle timer must be cancelled: left running, it fires 4s later with
      // onChatTypingChange(false) (state 0) and silently cancels the away state.
      if (typingIdleTimer.current) {
        clearTimeout(typingIdleTimer.current);
        typingIdleTimer.current = null;
      }
      client.onChatAway();
    },
    tellPlayer: (message) => {
      useChatStore.getState().addMessage(currentChannel, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'SYSTEM',
        text: message,
        timestamp: Date.now(),
        isSystem: true,
        isGM: false,
      });
    },
  }), [client, announceTyping, currentChannel]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (runChatCommand(text, commandContext) === 'handled') return;
    announceTyping(false);
    client.onSendChatMessage(text);
  }, [input, client, announceTyping, commandContext]);

  const submitPassword = useCallback(() => {
    if (!pendingChannel) return;
    setCurrentChannel(pendingChannel);
    client.onJoinChannel(pendingChannel, passwordInput);
    client.onGetChannelInfo(pendingChannel);
    setPendingChannel(null);
    setPasswordInput('');
    setChannelDropdownOpen(false);
  }, [pendingChannel, passwordInput, client, setCurrentChannel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Typing indicator text
  const typingText = useMemo(() => typingUsers.size > 0
    ? Array.from(typingUsers).slice(0, 3).join(', ') + (typingUsers.size > 3 ? '...' : '') + ' typing...'
    : null, [typingUsers]);

  const isEmbedded = mode === 'embedded';
  // In embedded mode, always show expanded view
  const showExpanded = isEmbedded || isExpanded;

  const stripClass = [
    styles.strip,
    showExpanded ? styles.expanded : '',
    isEmbedded ? styles.embedded : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stripClass}>
      {/* ================= EXPANDED: Header ================= */}
      {showExpanded && (
        <div className={styles.header}>
          {/* Channel dropdown */}
          <div className={styles.channelSelect} ref={dropdownRef}>
            <button
              className={styles.channelBtn}
              onClick={(e) => {
                e.stopPropagation();
                setChannelDropdownOpen(!channelDropdownOpen);
              }}
            >
              <ChevronUpIcon size={12} />
              {currentChannel || 'Channel'}
            </button>
            {channelDropdownOpen && (
              <div className={styles.channelDropdown}>
                {pendingChannel ? (
                  <form
                    className={styles.passwordPrompt}
                    onSubmit={(e) => { e.preventDefault(); submitPassword(); }}
                  >
                    <label className={styles.passwordLabel} htmlFor="channel-password">
                      Password for "{pendingChannel}"
                    </label>
                    <input
                      id="channel-password"
                      type="password"
                      aria-label="Channel password"
                      className={styles.passwordInput}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className={styles.passwordSubmit}>Join</button>
                  </form>
                ) : (
                  <>
                    {channels.map((ch) => (
                      <button
                        key={ch.name}
                        className={`${styles.channelOption} ${ch.name === currentChannel ? styles.channelOptionActive : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (ch.isProtected) {
                            setPendingChannel(ch.name);
                            return;
                          }
                          setCurrentChannel(ch.name);
                          setChannelDropdownOpen(false);
                          // Tell server to join this channel ("Lobby" maps to "" for the server)
                          client.onJoinChannel(ch.name === 'Lobby' ? '' : ch.name);
                          client.onGetChannelInfo(ch.name);
                        }}
                      >
                        {ch.name}
                        {ch.isProtected && (
                          <span className={styles.channelLock} aria-label="Password protected">
                            <Lock size={10} />
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.channelNew}
                      onClick={(e) => {
                        e.stopPropagation();
                        setChannelDropdownOpen(false);
                        useUiStore.getState().openModal('createChannel');
                      }}
                    >
                      <Plus size={12} /> New Channel…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mark/clear the current channel as the one to rejoin on next login */}
          {currentChannel && (
            <button
              type="button"
              className={`${styles.defaultBtn} ${defaultChannel === currentChannel ? styles.defaultBtnActive : ''}`}
              aria-label={defaultChannel === currentChannel ? 'Clear default channel' : `Set ${currentChannel} as default channel`}
              aria-pressed={defaultChannel === currentChannel}
              onClick={() => {
                if (defaultChannel === currentChannel) {
                  saveDefaultChannel(null);
                  setDefaultChannel(null);
                } else {
                  saveDefaultChannel(currentChannel);
                  setDefaultChannel(currentChannel);
                }
              }}
            >
              <Star size={12} />
            </button>
          )}

          {/* Title + channel info subtitle */}
          <div className={styles.headerTitleGroup}>
            <span className={styles.headerTitle}>Chat</span>
            {currentChannel && channelInfo[currentChannel] && (
              <span className={styles.channelInfoText} title={channelInfo[currentChannel]}>
                {channelInfo[currentChannel]}
              </span>
            )}
          </div>

          {/* Open the full scrollback view — useful in embedded/mobile mode too */}
          <button
            className={styles.historyBtn}
            onClick={() => useUiStore.getState().openModal('chatHistory')}
            aria-label="Open chat history"
          >
            <History size={14} />
          </button>

          {/* Collapse (hidden in embedded mode) */}
          {!isEmbedded && (
            <button
              className={styles.collapseBtn}
              onClick={toggleExpanded}
              aria-label="Collapse chat"
            >
              <ChevronDown size={16} />
            </button>
          )}
        </div>
      )}

      {/* ================= EXPANDED: Content (messages left + users right) ================= */}
      {showExpanded && (
        <div className={styles.contentArea}>
          {/* Chat messages (left) */}
          <div className={styles.messageArea}>
            {visibleMessages.map((msg) => (
              <ChatMessage
                key={msg.id}
                id={msg.id}
                from={msg.from}
                text={msg.text}
                isSystem={msg.isSystem}
                isGM={msg.isGM}
                nobilityTier={msg.nobilityTier}
                modifiers={msg.modifiers}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Online users (right sidebar) */}
          <div className={styles.userSidebar}>
            <div className={styles.userSidebarHeader}>
              <Users size={11} />
              <span>Online ({onlineCount})</span>
            </div>
            <div className={styles.userList}>
              {userList.length > 0 ? (
                userList.map((user) => (
                  <div
                    key={user.id}
                    className={`${styles.userRow} ${chasedUser === user.name ? styles.userRowFollowed : ''}`}
                    aria-current={chasedUser === user.name ? 'true' : undefined}
                  >
                    {(() => {
                      const isTyping = typingUsers.has(user.name);
                      const label = user.isAway
                        ? (isTyping ? 'away, typing' : 'away')
                        : (isTyping ? 'typing' : 'online');
                      return (
                        <span
                          className={`${styles.statusDot} ${user.isAway ? styles.statusDotAway : ''} ${isTyping ? styles.statusDotTyping : ''}`}
                          title={label}
                          aria-label={label}
                        />
                      );
                    })()}
                    <NobilityBadge nobilityTier={user.nobilityTier} modifiers={user.modifiers} size="sm" />
                    <span className={styles.userName}>{user.name}</span>
                    {/* Follow this player's camera — Voyager offered the same item on
                        every name but the player's own (ChatListHandlerViewer.pas:123-126). */}
                    {user.name !== username && (
                      <button
                        type="button"
                        className={styles.followBtn}
                        aria-label={`Follow ${user.name}`}
                        title="Follow this player's camera"
                        onClick={() => client.onChaseUser(user.name)}
                      >
                        <Eye size={11} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className={styles.emptyUsers}>No users</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= REDUCED: Preview row (hidden in embedded mode) ================= */}
      {!showExpanded && (
        <div className={styles.reducedRow} onClick={toggleExpanded}>
          {/* Online badge */}
          <div
            className={styles.onlineBadge}
            title="View online users"
          >
            <span className={styles.onlineDot} />
            <span>{onlineCount}</span>
          </div>

          {/* Channel indicator */}
          {currentChannel && (
            <span className={styles.channelTag}>{currentChannel}</span>
          )}

          {/* Last message preview */}
          {lastMessage ? (
            <div className={styles.preview}>
              <span className={styles.previewSender}>{lastMessage.from}:</span>
              <span className={styles.previewText}>{lastMessage.text}</span>
            </div>
          ) : (
            <div className={styles.preview}>
              <span className={styles.previewText}>No messages yet</span>
            </div>
          )}

          {/* Expand button */}
          <button
            className={styles.expandBtn}
            aria-label="Expand chat"
          >
            <ChevronUp size={14} />
          </button>
        </div>
      )}

      {/* ================= INPUT ROW (always visible) ================= */}
      <div className={styles.inputRow}>
        {typingText && <span className={styles.typing}>{typingText}</span>}

        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Type a message..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!input.trim()}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
