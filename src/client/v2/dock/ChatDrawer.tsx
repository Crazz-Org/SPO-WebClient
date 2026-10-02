/**
 * ChatDrawer — the v2 chat box above the Dock (replaces v1's desktop ChatStrip).
 *
 * A fixed 440 × 300 frame holding the same ChatStrip the mobile Chat tab uses, in its
 * `embedded` mode (always expanded, fills its parent; channel picker, history, users and the
 * input are all ChatStrip's own). GameScreenV2 mounts it only while `chatVisible` — the Dock's
 * Chat button and the minimise button here both call `toggleChatVisible`, the v1 chat toggle.
 */

import { Minus } from 'lucide-react';
import { ChatStrip } from '../../components/chat';
import { useChatStore } from '../../store/chat-store';
import styles from './ChatDrawer.module.css';

export function ChatDrawer() {
  return (
    <section className={styles.drawer} aria-label="Chat" data-v2="chat-drawer">
      <button
        type="button"
        className={styles.hide}
        onClick={() => useChatStore.getState().toggleChatVisible()}
        aria-label="Hide chat"
        title="Hide chat"
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <div className={styles.body}>
        <ChatStrip mode="embedded" />
      </div>
    </section>
  );
}
