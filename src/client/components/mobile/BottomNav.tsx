/**
 * BottomNav — the mobile command bar (handoff 00 §4.2, mobile lot).
 *
 * The same six tiles as the desktop CommandBar, in one row: Build · Map · Chat · Government ·
 * Mail · More. Build / Chat / More are sheet tabs of the MobileShell; Map, Government and Mail
 * open their surfaces in the same BottomSheet through the surface stack, so what the desktop
 * sheet shows, the mobile sheet shows. Tapping the active tile closes it (back to the map).
 * Badges: Chat (unread messages), Mail (unread mail). "Fav" moved to More › My facilities.
 */

import { Map, MessageSquare, Hammer, Landmark, Mail, MoreHorizontal } from 'lucide-react';
import { useUiStore, type MobileTab } from '../../store/ui-store';
import { useChatStore } from '../../store/chat-store';
import { useMailStore } from '../../store/mail-store';
import { useGameStore } from '../../store/game-store';
import { Badge } from '../common';
import styles from './BottomNav.module.css';

type TileId = MobileTab | 'politics' | 'mail';

const TILES: { id: TileId; label: string; icon: typeof Map }[] = [
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'politics', label: 'Government', icon: Landmark },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function BottomNav() {
  const activeTab = useUiStore((s) => s.mobileTab);
  const topKind = useUiStore((s) => s.stack[s.stack.length - 1]?.kind);
  const setTab = useUiStore((s) => s.setMobileTab);
  const clearSurfaces = useUiStore((s) => s.clearSurfaces);
  const toggleMapSurface = useUiStore((s) => s.toggleMapSurface);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const unreadChat = useChatStore((s) => s.unreadChatCount);
  const unreadMail = useMailStore((s) => s.unreadCount);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const tiles = TILES.filter((t) => !isVisitor || t.id !== 'build');

  const isActive = (id: TileId): boolean => {
    if (id === 'map') return topKind === 'map';
    if (id === 'politics' || id === 'mail') return topKind === id;
    return activeTab === id && !topKind;
  };

  const handleTileClick = (id: TileId) => {
    if (id === 'map') {
      setTab('map');
      toggleMapSurface();
      return;
    }
    if (id === 'politics' || id === 'mail') {
      setTab('map');
      toggleRightPanel(id);
      return;
    }
    // Sheet tabs: tapping the active one dismisses (returns to map)
    if (id === activeTab && !topKind) {
      setTab('map');
    } else {
      clearSurfaces();
      setTab(id);
    }
  };

  const getBadge = (id: TileId): number => {
    if (id === 'chat') return unreadChat;
    if (id === 'mail') return unreadMail;
    return 0;
  };

  return (
    <nav className={styles.nav} role="tablist" aria-label="Game actions">
      {tiles.map(({ id, label, icon: Icon }) => {
        const badge = getBadge(id);
        const active = isActive(id);
        return (
          <button
            key={id}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            onClick={() => handleTileClick(id)}
            role="tab"
            aria-selected={active}
            aria-label={label}
          >
            <span className={styles.iconWrap}>
              <Icon size={20} />
              {badge > 0 && (
                <Badge variant="danger" className={styles.badge}>
                  {badge > 9 ? '9+' : badge}
                </Badge>
              )}
            </span>
            <span className={styles.label}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
