/**
 * dock-model — the pure data behind the v2 Dock, its More menu and the map tools rail.
 *
 * Which buttons exist, in which order, with which label, keyboard hint, active state and
 * badge. The components only attach an icon and the callback to each id, so the parity with
 * v1 (CommandBar tiles, MoreMenu, RightRail) is readable — and tested — in one place.
 */

import type { SurfaceKind } from '../../store/ui-store';
import { isPanelOffered } from '../../visitor-gating';

// ---------------------------------------------------------------------------
// Dock actions — the seven v1 CommandBar tiles, More included
// ---------------------------------------------------------------------------

export type DockActionId = 'build' | 'map' | 'empire' | 'politics' | 'mail' | 'chat' | 'more';

export interface DockAction {
  id: DockActionId;
  label: string;
  /** Shorter label for the compact dock (side panel open on a narrow screen); absent = `label` fits. */
  shortLabel?: string;
  /** The panel this action opens — checked against the visitor-gating list. */
  panel?: SurfaceKind;
  /** Keyboard hint (the shortcut itself is bound in useKeyboardShortcuts). */
  kbd?: string;
  active: boolean;
  /** Unread count shown on the button; 0 = no badge. */
  badge: number;
}

export interface DockState {
  /** Kind of the surface on top of the stack, if any. */
  topKind: SurfaceKind | undefined;
  leftPanel: string | null;
  rightPanel: string | null;
  isPlacing: boolean;
  unreadMail: number;
  chatVisible: boolean;
  unreadChat: number;
  isVisitor: boolean;
  moreOpen: boolean;
  isRoadBuild: boolean;
  isRoadDemolish: boolean;
  isZone: boolean;
}

/** The dock's buttons, in v1 tile order, minus what a visitor is not offered. */
export function dockActions(s: DockState): DockAction[] {
  const all: DockAction[] = [
    { id: 'build', label: 'Build', panel: 'build', kbd: 'B', active: s.topKind === 'build' || s.isPlacing, badge: 0 },
    { id: 'map', label: 'Map', panel: 'map', kbd: 'M', active: s.topKind === 'map', badge: 0 },
    { id: 'empire', label: 'Empire', panel: 'empire', kbd: 'E', active: s.leftPanel === 'empire', badge: 0 },
    { id: 'politics', label: 'Government', shortLabel: 'Gov.', panel: 'politics', kbd: 'P', active: s.rightPanel === 'politics', badge: 0 },
    { id: 'mail', label: 'Mail', panel: 'mail', kbd: 'L', active: s.rightPanel === 'mail', badge: Math.max(0, s.unreadMail) },
    { id: 'chat', label: 'Chat', active: s.chatVisible, badge: s.chatVisible ? 0 : Math.max(0, s.unreadChat) },
    { id: 'more', label: 'More', active: s.moreOpen || s.isRoadBuild || s.isRoadDemolish || s.isZone, badge: 0 },
  ];
  return all.filter((a) => !a.panel || isPanelOffered(a.panel, s.isVisitor));
}

/** Badge text: the count, capped at 99+. */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Accessible name of a button carrying an unread badge — the v1 wording. */
export function badgeLabel(label: string, count: number): string {
  return count > 0 ? `${label}, ${count} unread` : label;
}

// ---------------------------------------------------------------------------
// Dock menu — every v1 MoreMenu item, plus the two v2 interface items
// ---------------------------------------------------------------------------

export type DockMenuItemId =
  | 'roadBuild'
  | 'roadDemolish'
  | 'zone'
  | 'search'
  | 'overlays'
  | 'minimap'
  | 'facilities'
  | 'settings'
  | 'shortcuts'
  | 'hideHud'
  | 'classic'
  | 'switchServer';

export type DockMenuSectionId = 'map' | 'find' | 'interface' | 'session';

export interface DockMenuItem {
  id: DockMenuItemId;
  label: string;
  kbd?: string;
  active: boolean;
}

export interface DockMenuSection {
  id: DockMenuSectionId;
  title: string;
  items: DockMenuItem[];
}

export interface DockMenuState {
  isVisitor: boolean;
  isPublicOfficeRole: boolean;
  isRoadBuild: boolean;
  isRoadDemolish: boolean;
  isZone: boolean;
}

/** The menu's sections, each with only the items this player is offered; empty sections dropped. */
export function dockMenuSections(s: DockMenuState): DockMenuSection[] {
  const map: DockMenuItem[] = [];
  if (!s.isVisitor) {
    map.push({ id: 'roadBuild', label: s.isRoadBuild ? 'Stop building roads' : 'Build road', active: s.isRoadBuild });
    map.push({ id: 'roadDemolish', label: s.isRoadDemolish ? 'Stop demolishing roads' : 'Demolish road', active: s.isRoadDemolish });
  }
  if (s.isPublicOfficeRole) {
    map.push({ id: 'zone', label: s.isZone ? 'Stop zone painting' : 'Zone painting', active: s.isZone });
  }
  map.push({ id: 'overlays', label: 'Map overlays', active: false });
  map.push({ id: 'minimap', label: 'Docked minimap', active: false });

  const find: DockMenuItem[] = [{ id: 'search', label: 'Search', active: false }];
  if (isPanelOffered('facilities', s.isVisitor)) find.push({ id: 'facilities', label: 'My facilities', active: false });

  const ui: DockMenuItem[] = [
    { id: 'settings', label: 'Settings', active: false },
    { id: 'shortcuts', label: 'Keyboard shortcuts', kbd: '?', active: false },
    { id: 'hideHud', label: 'Hide interface', kbd: 'H', active: false },
    { id: 'classic', label: 'Switch to classic interface', kbd: 'V', active: false },
  ];

  const session: DockMenuItem[] = [{ id: 'switchServer', label: 'Switch server', active: false }];

  return [
    { id: 'map' as const, title: 'Map', items: map },
    { id: 'find' as const, title: 'Find', items: find },
    { id: 'interface' as const, title: 'Interface', items: ui },
    { id: 'session' as const, title: 'Session', items: session },
  ];
}

/**
 * Index of the item focus moves to on an arrow / Home / End key in a menu of `count` items,
 * wrapping at both ends; `null` for any other key.
 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Map tools — everything v1's RightRail does, plus Map overlays
// ---------------------------------------------------------------------------

export type MapToolId = 'zoomIn' | 'zoomOut' | 'rotateCcw' | 'rotateCw' | 'overlays' | 'minimap' | 'refresh' | 'debug';

export interface MapTool {
  id: MapToolId;
  label: string;
  kbd?: string;
  /** Rendered muted (developer tool). */
  muted?: boolean;
}

/** The rail, as groups separated by a divider, top to bottom. */
export const MAP_TOOL_GROUPS: readonly (readonly MapTool[])[] = [
  [
    { id: 'zoomIn', label: 'Zoom in', kbd: '+' },
    { id: 'zoomOut', label: 'Zoom out', kbd: '−' },
  ],
  [
    { id: 'rotateCcw', label: 'Rotate view left', kbd: 'Q' },
    { id: 'rotateCw', label: 'Rotate view right', kbd: 'W' },
  ],
  [
    { id: 'overlays', label: 'Map overlays' },
    { id: 'minimap', label: 'Docked minimap' },
  ],
  [
    { id: 'refresh', label: 'Refresh map', kbd: 'R' },
    { id: 'debug', label: 'Debug overlay', kbd: 'D', muted: true },
  ],
];

/** Accessible name with the shortcut, e.g. "Zoom in (+)". */
export function toolLabel(tool: { label: string; kbd?: string }): string {
  return tool.kbd ? `${tool.label} (${tool.kbd})` : tool.label;
}
