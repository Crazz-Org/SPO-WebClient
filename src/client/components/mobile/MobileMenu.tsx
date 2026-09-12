/**
 * MobileMenu — Full-feature "More" menu for mobile.
 *
 * Grouped menu covering ALL desktop features not available via bottom tabs:
 * Communication (Mail), Exploration (Search, Command palette, Profile, My facilities, Government),
 * Map Controls (Zoom, Rotate, Overlays, Refresh), System (Settings, Server Switch, Debug).
 */

import {
  Mail, Search, Landmark,
  ZoomIn, ZoomOut, Layers, RefreshCw, RotateCw,
  Settings, Globe, Bug, Command, User, Heart,
} from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useMailStore } from '../../store/mail-store';
import { useClient } from '../../context';
import { Badge } from '../common';
import styles from './MobileMenu.module.css';

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

interface MenuItem {
  label: string;
  icon: typeof Mail;
  action: () => void;
  badge?: number;
}

export function MobileMenu() {
  const openRightPanel = useUiStore((s) => s.openRightPanel);
  const openModal = useUiStore((s) => s.openModal);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const openLeftPanel = useUiStore((s) => s.openLeftPanel);
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const unreadCount = useMailStore((s) => s.unreadCount);
  const client = useClient();

  /** Open a panel and stay on map so the BottomSheet shows panel content */
  const openPanel = (fn: () => void) => {
    fn();
    setMobileTab('map');
  };

  /** Perform an action and return to map */
  const doAction = (fn: () => void) => {
    fn();
    setMobileTab('map');
  };

  const groups: MenuGroup[] = [
    {
      label: 'Communication',
      items: [
        { label: 'Mail', icon: Mail, action: () => openPanel(() => openRightPanel('mail')), badge: unreadCount },
      ],
    },
    {
      label: 'Exploration',
      items: [
        { label: 'Search', icon: Search, action: () => openPanel(() => openRightPanel('search')) },
        { label: 'Command palette', icon: Command, action: () => doAction(() => openCommandPalette()) },
        { label: 'Profile', icon: User, action: () => openPanel(() => openLeftPanel('empire')) },
        { label: 'My facilities', icon: Heart, action: () => openPanel(() => openLeftPanel('facilities')) },
        { label: 'Government', icon: Landmark, action: () => openPanel(() => openRightPanel('politics')) },
      ],
    },
    {
      label: 'Map Controls',
      items: [
        { label: 'Zoom In', icon: ZoomIn, action: () => doAction(() => client.onZoomIn()) },
        { label: 'Zoom Out', icon: ZoomOut, action: () => doAction(() => client.onZoomOut()) },
        { label: 'Rotate view', icon: RotateCw, action: () => doAction(() => client.onRotateCW()) },
        { label: 'Map Overlays', icon: Layers, action: () => doAction(() => toggleLeftPanel('overlays')) },
        { label: 'Refresh Map', icon: RefreshCw, action: () => doAction(() => client.onRefreshMap()) },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Settings', icon: Settings, action: () => doAction(() => openModal('settings')) },
        { label: 'Switch Server', icon: Globe, action: () => doAction(() => client.onSwitchServer()) },
        { label: 'Debug Overlay', icon: Bug, action: () => doAction(() => client.onToggleDebugOverlay()) },
      ],
    },
  ];

  return (
    <div className={styles.menu}>
      {groups.map(({ label, items }) => (
        <div key={label} className={styles.group}>
          <span className={styles.groupLabel}>{label}</span>
          {items.map(({ label: itemLabel, icon: Icon, action, badge }) => (
            <button key={itemLabel} className={styles.item} onClick={action}>
              <Icon size={18} className={styles.icon} />
              <span className={styles.label}>{itemLabel}</span>
              {badge != null && badge > 0 && (
                <Badge variant="danger" className={styles.badge}>
                  {badge > 9 ? '9+' : badge}
                </Badge>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
