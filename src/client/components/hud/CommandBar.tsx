/**
 * CommandBar — the bottom bar of the option-C HUD (doc/ux/handoff/00-socle.md §4.2).
 *
 * Two rows above the map: a search row that opens the Command Palette (or, while a mode is
 * active, the MODE BAR — placement / road / zone — that stays visible as long as the mode
 * lasts, which the audit found missing on desktop, H1/H2), and six tiles: Build · Map ·
 * Empire · Government · Mail · More. It replaces LeftRail on desktop; the zoom cluster
 * (RightRail) stays. Hidden under 768 px (the mobile shell has its own navigation).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hammer, Map, User, Landmark, Mail, MoreHorizontal, Search, RotateCw, Settings, Layers, Heart, Server, Route, Eraser, Grid2x2 } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useModeDescriptor, type ModeDescriptor } from './use-mode-descriptor';
import { useMailStore } from '../../store/mail-store';
import { useClient } from '../../context';
import { Button } from '../common';
import styles from './CommandBar.module.css';

interface Tile {
  id: string;
  label: string;
  kbd?: string;
  icon: ReactNode;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

function ModeRow({ mode }: { mode: ModeDescriptor }) {
  const client = useClient();
  return (
    <div className={styles.modeRow} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.kind}>{mode.kind}</span>
      <span className={styles.modeTitle}>{mode.title}</span>
      {mode.cost && <span className={styles.cost}>{mode.cost}</span>}
      {mode.cashAfter && (
        <span className={styles.after}>
          after: <span className={mode.cashAfterNegative ? styles.neg : styles.pos}>{mode.cashAfter}</span>
        </span>
      )}
      <span className={`${styles.hint} ${mode.invalid ? styles.neg : ''}`}>{mode.hint}</span>
      {mode.overlayNote && <span className={styles.hint}>· {mode.overlayNote}</span>}
      <span className={styles.spacer} />
      {mode.isPlacing && (
        <Button size="sm" variant="secondary" kbd="W" iconLeft={<RotateCw size={14} />} onClick={() => client.onRotateCW()}>
          Rotate view
        </Button>
      )}
      <Button size="sm" variant="outline" kbd="Esc" onClick={mode.onDone}>
        {mode.doneLabel}
      </Button>
    </div>
  );
}

function MoreMenu({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const openModal = useUiStore((s) => s.openModal);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const isPublicOfficeRole = useGameStore((s) => s.isPublicOfficeRole);
  const isRoadBuild = useGameStore((s) => s.isRoadBuildingMode);
  const isRoadDemolish = useGameStore((s) => s.isRoadDemolishMode);
  const isZone = useGameStore((s) => s.isZonePaintingMode);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const item = (label: string, icon: ReactNode, onClick: () => void, active = false) => (
    <button
      type="button"
      role="menuitem"
      className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
      onClick={() => {
        onClick();
        onClose();
      }}
    >
      <span className={styles.menuIcon} aria-hidden="true">{icon}</span>
      {label}
    </button>
  );

  return (
    <div ref={ref} className={styles.menu} role="menu" aria-label="More actions">
      {!isVisitor && item(isRoadBuild ? 'Stop building roads' : 'Build road', <Route size={16} />, () => client.onBuildRoad(), isRoadBuild)}
      {!isVisitor && item(isRoadDemolish ? 'Stop demolishing roads' : 'Demolish road', <Eraser size={16} />, () => client.onDemolishRoad(), isRoadDemolish)}
      {isPublicOfficeRole && item(isZone ? 'Stop zone painting' : 'Zone painting', <Grid2x2 size={16} />, () => (isZone ? client.onCancelZonePainting() : openModal('zonePicker')), isZone)}
      {item('Map overlays', <Layers size={16} />, () => toggleLeftPanel('overlays'))}
      {item('Docked minimap', <Map size={16} />, () => client.onToggleMinimap())}
      {!isVisitor && item('My facilities', <Heart size={16} />, () => toggleLeftPanel('facilities'))}
      {item('Settings', <Settings size={16} />, () => openModal('settings'))}
      {item('Switch server', <Server size={16} />, () => client.onSwitchServer())}
    </div>
  );
}

export function CommandBar() {
  const stack = useUiStore((s) => s.stack);
  const rightPanel = useUiStore((s) => s.rightPanel);
  const leftPanel = useUiStore((s) => s.leftPanel);
  const toggleBuildSurface = useUiStore((s) => s.toggleBuildSurface);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const isPlacing = useUiStore((s) => s.isPlacingBuilding);
  const isRoadBuild = useGameStore((s) => s.isRoadBuildingMode);
  const isRoadDemolish = useGameStore((s) => s.isRoadDemolishMode);
  const isZone = useGameStore((s) => s.isZonePaintingMode);
  const unread = useMailStore((s) => s.unreadCount);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const mode = useModeDescriptor();
  const [moreOpen, setMoreOpen] = useState(false);

  const tiles: Tile[] = [
    { id: 'build', label: 'Build', kbd: 'B', icon: <Hammer size={20} />, active: stack[stack.length - 1]?.kind === 'build' || isPlacing, onClick: toggleBuildSurface },
    { id: 'map', label: 'Map', kbd: 'M', icon: <Map size={20} />, active: stack[stack.length - 1]?.kind === 'map', onClick: () => useUiStore.getState().toggleMapSurface() },
    { id: 'empire', label: 'Empire', kbd: 'E', icon: <User size={20} />, active: leftPanel === 'empire', onClick: () => toggleLeftPanel('empire') },
    { id: 'politics', label: 'Government', kbd: 'P', icon: <Landmark size={20} />, active: rightPanel === 'politics', onClick: () => toggleRightPanel('politics') },
    { id: 'mail', label: 'Mail', kbd: 'L', icon: <Mail size={20} />, active: rightPanel === 'mail', badge: unread, onClick: () => toggleRightPanel('mail') },
    { id: 'more', label: 'More', icon: <MoreHorizontal size={20} />, active: moreOpen || isRoadBuild || isRoadDemolish || isZone, onClick: () => setMoreOpen((v) => !v) },
  ].filter((t) => !isVisitor || (t.id !== 'build' && t.id !== 'empire'));

  const connectActive = useUiStore((s) => s.connectMode.active);
  const cls = [styles.bar, stack.length > 0 && !connectActive ? styles.shifted : ''].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      {mode ? (
        <ModeRow mode={mode} />
      ) : (
        <button type="button" className={styles.search} onClick={openCommandPalette} aria-label="Search or run a command (Ctrl+K)">
          <Search size={16} aria-hidden="true" />
          <span className={styles.searchText}>Search my facilities, a player, a town — or a command…</span>
          <span className={styles.kbds} aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
        </button>
      )}
      <nav className={styles.tiles} aria-label="Game actions">
        {tiles.map((t) => (
          <span key={t.id} className={styles.tileWrap}>
            <button
              type="button"
              className={`${styles.tile} ${t.active ? styles.tileActive : ''}`}
              onClick={t.onClick}
              aria-pressed={t.id === 'more' ? undefined : t.active}
              aria-haspopup={t.id === 'more' ? 'menu' : undefined}
              aria-expanded={t.id === 'more' ? moreOpen : undefined}
              aria-label={t.badge ? `${t.label}, ${t.badge} unread` : t.label}
            >
              <span className={styles.tileIcon} aria-hidden="true">{t.icon}</span>
              <span className={styles.tileLabel}>
                {t.label}
                {t.kbd && <kbd className={styles.tileKbd} aria-hidden="true">{t.kbd}</kbd>}
              </span>
              {t.badge ? <span className={styles.badge} aria-hidden="true">{t.badge > 99 ? '99+' : t.badge}</span> : null}
            </button>
            {t.id === 'more' && moreOpen && <MoreMenu onClose={() => setMoreOpen(false)} />}
          </span>
        ))}
      </nav>
    </div>
  );
}
