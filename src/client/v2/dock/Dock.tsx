/**
 * Dock — the v2 bottom-left action row (replaces v1's CommandBar tiles and MoreMenu).
 *
 * One 56 px row: a search pill that opens the Command Palette (Ctrl K), then the seven v1
 * tiles — Build · Map · Empire · Government · Mail · Chat · More — with the same store
 * actions, the same visitor filter (isPanelOffered) and the same unread badges. "More" opens
 * DockMenu. The placement / road / zone mode row is not here: v2 shows it in ModeBanner.
 *
 * The dock only narrows (never moves) while the side panel is open, so its buttons stay where
 * the hand expects them.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Hammer, Map, User, Landmark, Mail, MessageSquare, MoreHorizontal, Search } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { useChatStore } from '../../store/chat-store';
import { dockActions, badgeLabel, badgeText, type DockActionId } from './dock-model';
import { DockMenu } from './DockMenu';
import styles from './Dock.module.css';

const ICONS: Record<DockActionId, ReactNode> = {
  build: <Hammer size={20} />,
  map: <Map size={20} />,
  empire: <User size={20} />,
  politics: <Landmark size={20} />,
  mail: <Mail size={20} />,
  chat: <MessageSquare size={20} />,
  more: <MoreHorizontal size={20} />,
};

export function Dock() {
  const stack = useUiStore((s) => s.stack);
  const leftPanel = useUiStore((s) => s.leftPanel);
  const rightPanel = useUiStore((s) => s.rightPanel);
  const isPlacing = useUiStore((s) => s.isPlacingBuilding);
  const connectActive = useUiStore((s) => s.connectMode.active);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const isRoadBuild = useGameStore((s) => s.isRoadBuildingMode);
  const isRoadDemolish = useGameStore((s) => s.isRoadDemolishMode);
  const isZone = useGameStore((s) => s.isZonePaintingMode);
  const unreadMail = useMailStore((s) => s.unreadCount);
  const chatVisible = useChatStore((s) => s.chatVisible);
  const unreadChat = useChatStore((s) => s.unreadChatCount);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  const actions = dockActions({
    topKind: stack[stack.length - 1]?.kind,
    leftPanel,
    rightPanel,
    isPlacing,
    unreadMail,
    chatVisible,
    unreadChat,
    isVisitor,
    moreOpen,
    isRoadBuild,
    isRoadDemolish,
    isZone,
  });

  const run: Record<DockActionId, () => void> = {
    build: () => useUiStore.getState().toggleBuildSurface(),
    map: () => useUiStore.getState().toggleMapSurface(),
    empire: () => useUiStore.getState().toggleLeftPanel('empire'),
    politics: () => useUiStore.getState().toggleRightPanel('politics'),
    mail: () => useUiStore.getState().toggleRightPanel('mail'),
    chat: () => useChatStore.getState().toggleChatVisible(),
    more: () => setMoreOpen((v) => !v),
  };

  const shifted = stack.length > 0 && !connectActive;
  const cls = [styles.dock, shifted ? styles.shifted : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} data-v2="dock">
      <button
        type="button"
        className={styles.search}
        onClick={() => useUiStore.getState().openCommandPalette()}
        aria-label="Search or run a command (Ctrl+K)"
        title="Search my facilities, a player, a town — or a command"
      >
        <Search size={18} aria-hidden="true" className={styles.searchIcon} />
        <span className={styles.searchText}>Search or command…</span>
        <span className={styles.searchKbds} aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button>

      <span className={styles.divider} aria-hidden="true" />

      <nav className={styles.actions} aria-label="Game actions">
        {actions.map((a) => {
          const isMore = a.id === 'more';
          return (
            <span key={a.id} className={`${styles.slot} ${isMore ? styles.slotMore : ''}`}>
              <button
                ref={isMore ? moreRef : undefined}
                type="button"
                className={`${styles.action} ${a.active ? styles.active : ''}`}
                onClick={run[a.id]}
                aria-pressed={isMore ? undefined : a.active}
                aria-haspopup={isMore ? 'menu' : undefined}
                aria-expanded={isMore ? moreOpen : undefined}
                aria-label={badgeLabel(a.label, a.badge)}
                title={a.kbd ? `${a.label} (${a.kbd})` : a.label}
              >
                <span className={styles.iconWrap} aria-hidden="true">
                  {ICONS[a.id]}
                  {a.badge > 0 && <span className={styles.badge}>{badgeText(a.badge)}</span>}
                </span>
                <span className={styles.label}>{a.label}</span>
                {a.kbd && <kbd className={styles.kbd} aria-hidden="true">{a.kbd}</kbd>}
              </button>
              {isMore && moreOpen && <DockMenu onClose={closeMore} anchorRef={moreRef} />}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
