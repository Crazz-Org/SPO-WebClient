/**
 * ChatHistoryModal — the full scrollback view for the current channel.
 *
 * The strip only ever renders its last `STRIP_RENDER_WINDOW` messages
 * (`ChatStrip.tsx`); this modal reads the whole retained transcript from the
 * store, up to `MAX_MESSAGES_PER_CHANNEL`, with a text filter and a
 * "copy all" that yields plain `name: text` lines.
 *
 * Managed by ui-store modal state ('chatHistory').
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, Copy, History } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { formatTranscript, filterTranscript } from '../chat/chat-transcript';
import { toErrorMessage } from '@/shared/error-utils';
import styles from './ChatHistoryModal.module.css';

export function ChatHistoryModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const currentChannel = useChatStore((s) => s.currentChannel);
  const messages = useChatStore((s) => s.messages);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const channelMessages = messages[currentChannel] ?? [];
  const shown = useMemo(() => filterTranscript(channelMessages, query), [channelMessages, query]);

  // Reset the transient UI when the modal opens.
  useEffect(() => {
    if (modal === 'chatHistory') {
      setQuery('');
      setStatus('');
    }
  }, [modal]);

  // Open at the newest line, then leave the player's scroll position alone —
  // no effect on message count, so new traffic cannot fight a manual scroll.
  useEffect(() => {
    if (modal === 'chatHistory' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [modal, currentChannel]);

  const handleCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is not available');
      }
      await navigator.clipboard.writeText(formatTranscript(shown));
      setStatus('Copied');
    } catch (err: unknown) {
      setStatus(toErrorMessage(err));
    }
  }, [shown]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (modal !== 'chatHistory') return null;

  return (
    <>
      <div className={styles.backdrop} onClick={handleCancel} aria-hidden="true" />
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-history-title"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="chat-history-title">
            <History size={16} /> {currentChannel || 'Channel'} history
          </h2>
          <button className={styles.closeBtn} onClick={handleCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.filterInput}
              aria-label="Filter chat history"
              placeholder="Filter..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className={styles.copyBtn}
              aria-label="Copy chat history"
              onClick={handleCopy}
            >
              <Copy size={14} /> Copy all
            </button>
          </div>

          <div className={styles.count}>
            {shown.length} of {channelMessages.length} lines
          </div>

          <div className={styles.list} ref={listRef}>
            {shown.length > 0 ? (
              shown.map((msg) => (
                <div key={msg.id} className={styles.line}>
                  <span className={styles.sender}>{msg.from}:</span>{' '}
                  <span className={styles.text}>{msg.text}</span>
                </div>
              ))
            ) : (
              <div className={styles.empty}>No messages yet</div>
            )}
          </div>

          <div className={styles.status} role="status">
            {status}
          </div>
        </div>
      </div>
    </>
  );
}
