/**
 * ChaseBadge — "you are following X", top-right of the map.
 *
 * Voyager showed the same thing as a `ChasePanel` pinned to the map view, its
 * caption the chased name, visible only while that name was non-empty, and a
 * click on it stopped the chase (MapIsoView.pas:348-360, :538-543).
 */

import { Eye } from 'lucide-react';
import { useChatStore } from '../../store/chat-store';
import { useClient } from '../../context';
import styles from './ChaseBadge.module.css';

export function ChaseBadge() {
  const chasedUser = useChatStore((s) => s.chasedUser);
  const client = useClient();

  if (!chasedUser) return null;

  return (
    <button
      type="button"
      className={styles.badge}
      aria-label={`Stop following ${chasedUser}`}
      title="Click to stop following"
      onClick={() => client.onStopChase()}
    >
      <Eye size={12} />
      <span className={styles.name}>Following {chasedUser}</span>
    </button>
  );
}
