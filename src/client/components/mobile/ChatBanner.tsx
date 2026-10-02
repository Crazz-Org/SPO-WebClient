/**
 * ChatBanner — Toast-style notification for new chat messages on mobile.
 *
 * Shows below TopBar for 4 seconds when a new message arrives while
 * the user is on the map tab. Tapping opens the chat panel.
 */

import { useState, useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { useChatStore, type ChatMessage } from '../../store/chat-store';
import { useUiStore } from '../../store/ui-store';
import { DEBUG_MARKERS } from '../../debug-markers';
import styles from './ChatBanner.module.css';

const BANNER_DURATION = 4000;

export function ChatBanner() {
  const [visible, setVisible] = useState(false);
  const [lastMessage, setLastMessage] = useState<ChatMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentChannel = useChatStore((s) => s.currentChannel);
  const messages = useChatStore((s) => s.messages);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const mobileTab = useUiStore((s) => s.mobileTab);

  const channelMessages = messages[currentChannel];
  const latestMsg = channelMessages?.[channelMessages.length - 1] ?? null;

  // Show banner when a new message arrives on the map tab
  useEffect(() => {
    if (!latestMsg || latestMsg.isSystem || mobileTab !== 'map') return;
    if (lastMessage && latestMsg.id === lastMessage.id) return;

    setLastMessage(latestMsg);
    setVisible(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), BANNER_DURATION);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [latestMsg, lastMessage, mobileTab]);

  if (!visible || !lastMessage) return null;

  const handleClick = () => {
    setVisible(false);
    setMobileTab('chat');
  };

  return (
    <button className={styles.banner} onClick={handleClick} aria-label="Open chat" data-testid={DEBUG_MARKERS.chatBanner}>
      <MessageSquare size={16} className={styles.icon} />
      <span className={styles.sender}>{lastMessage.from}:</span>
      <span className={styles.text}>{lastMessage.text}</span>
    </button>
  );
}
