/**
 * DockMenu — the Dock's "More" menu (v2).
 *
 * Every item of v1's MoreMenu (CommandBar.tsx), with the same callbacks and the same
 * visitor / public-office gating, grouped into sections, plus two interface items:
 * "Hide interface" (toggleHudVisible, H) and "Switch to classic interface" (setUiVersion('v1'), V).
 *
 * Closes on an outside mousedown and on Escape (captured, so the global Escape that pops a
 * surface does not also fire), then hands focus back to the button that opened it. Arrow keys,
 * Home and End move between items.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Route, Eraser, Grid2x2, Search, Layers, Map, Heart, Settings, Keyboard, EyeOff, Undo2, Server } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { DEBUG_MARKERS } from '../../debug-markers';
import { dockMenuSections, nextMenuIndex, type DockMenuItemId } from './dock-model';
import styles from './DockMenu.module.css';

const ICONS: Record<DockMenuItemId, ReactNode> = {
  roadBuild: <Route size={16} />,
  roadDemolish: <Eraser size={16} />,
  zone: <Grid2x2 size={16} />,
  search: <Search size={16} />,
  overlays: <Layers size={16} />,
  minimap: <Map size={16} />,
  facilities: <Heart size={16} />,
  settings: <Settings size={16} />,
  shortcuts: <Keyboard size={16} />,
  hideHud: <EyeOff size={16} />,
  classic: <Undo2 size={16} />,
  switchServer: <Server size={16} />,
};

interface DockMenuProps {
  onClose: () => void;
  /** The button that opened the menu: outside-click ignores it, focus returns to it. */
  anchorRef?: RefObject<HTMLElement | null>;
}

export function DockMenu({ onClose, anchorRef }: DockMenuProps) {
  const client = useClient();
  const isVisitor = useGameStore((s) => s.isVisitor);
  const isPublicOfficeRole = useGameStore((s) => s.isPublicOfficeRole);
  const isRoadBuild = useGameStore((s) => s.isRoadBuildingMode);
  const isRoadDemolish = useGameStore((s) => s.isRoadDemolishMode);
  const isZone = useGameStore((s) => s.isZonePaintingMode);
  const ref = useRef<HTMLDivElement>(null);

  const sections = dockMenuSections({ isVisitor, isPublicOfficeRole, isRoadBuild, isRoadDemolish, isZone });

  const actions: Record<DockMenuItemId, () => void> = {
    roadBuild: () => client.onBuildRoad(),
    roadDemolish: () => client.onDemolishRoad(),
    zone: () => (isZone ? client.onCancelZonePainting() : useUiStore.getState().openModal('zonePicker')),
    search: () => useUiStore.getState().toggleRightPanel('search'),
    overlays: () => useUiStore.getState().toggleLeftPanel('overlays'),
    minimap: () => client.onToggleMinimap(),
    facilities: () => useUiStore.getState().toggleLeftPanel('facilities'),
    settings: () => useUiStore.getState().openModal('settings'),
    shortcuts: () => useUiStore.getState().openModal('shortcuts'),
    hideHud: () => useUiStore.getState().toggleHudVisible(),
    classic: () => useUiStore.getState().setUiVersion('v1'),
    switchServer: () => client.onSwitchServer(),
  };

  useEffect(() => {
    const close = (refocus: boolean) => {
      onClose();
      if (refocus) anchorRef?.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      // The opener toggles the menu itself; closing here too would reopen it on click.
      if (anchorRef?.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    // Keyboard players land on the first item.
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchorRef]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      aria-label="More actions"
      data-testid={DEBUG_MARKERS.moreMenu}
      onKeyDown={onMenuKeyDown}
    >
      {sections.map((section, i) => (
        <div key={section.id} role="group" aria-labelledby={`dock-menu-${section.id}`} className={styles.section}>
          {i > 0 && <div className={styles.separator} role="separator" />}
          <div id={`dock-menu-${section.id}`} className={styles.sectionTitle}>{section.title}</div>
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`${styles.item} ${item.active ? styles.itemActive : ''}`}
              onClick={() => {
                actions[item.id]();
                onClose();
              }}
            >
              <span className={styles.icon} aria-hidden="true">{ICONS[item.id]}</span>
              <span className={styles.label}>{item.label}</span>
              {item.active && <span className={styles.activeDot} aria-hidden="true" />}
              {item.kbd && <kbd className={styles.kbd} aria-hidden="true">{item.kbd}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
