import { describe, it, expect } from '@jest/globals';
import {
  dockActions,
  badgeText,
  badgeLabel,
  dockMenuSections,
  nextMenuIndex,
  MAP_TOOL_GROUPS,
  toolLabel,
  type DockState,
  type DockMenuState,
} from './dock-model';
import { VISITOR_GATED_PANELS } from '../../visitor-gating';

const base: DockState = {
  topKind: undefined,
  leftPanel: null,
  rightPanel: null,
  isPlacing: false,
  unreadMail: 0,
  chatVisible: true,
  unreadChat: 0,
  isVisitor: false,
  moreOpen: false,
  isRoadBuild: false,
  isRoadDemolish: false,
  isZone: false,
};

const ids = (s: Partial<DockState>) => dockActions({ ...base, ...s }).map((a) => a.id);
const find = (s: Partial<DockState>, id: string) => dockActions({ ...base, ...s }).find((a) => a.id === id);

describe('dockActions', () => {
  it('lists the seven v1 tiles in v1 order with their shortcuts', () => {
    const actions = dockActions(base);
    expect(actions.map((a) => [a.id, a.label, a.kbd])).toEqual([
      ['build', 'Build', 'B'],
      ['map', 'Map', 'M'],
      ['empire', 'Empire', 'E'],
      ['politics', 'Government', 'P'],
      ['mail', 'Mail', 'L'],
      ['chat', 'Chat', undefined],
      ['more', 'More', undefined],
    ]);
    // At rest only Chat (shown by default) is active, and nothing carries a badge.
    expect(actions.filter((a) => a.active).map((a) => a.id)).toEqual(['chat']);
    expect(actions.every((a) => a.badge === 0)).toBe(true);
  });

  it('drops every visitor-gated panel for a visitor, and only those', () => {
    const visitor = ids({ isVisitor: true });
    expect(visitor).toEqual(['map', 'politics', 'mail', 'chat', 'more']);
    for (const a of dockActions(base)) {
      expect(visitor.includes(a.id)).toBe(!a.panel || !VISITOR_GATED_PANELS.has(a.panel));
    }
  });

  it('Build is active on the build surface or while placing', () => {
    expect(find({}, 'build')?.active).toBe(false);
    expect(find({ topKind: 'build' }, 'build')?.active).toBe(true);
    expect(find({ isPlacing: true }, 'build')?.active).toBe(true);
  });

  it('Map, Empire, Government and Mail follow the open surface', () => {
    expect(find({ topKind: 'map' }, 'map')?.active).toBe(true);
    expect(find({ leftPanel: 'empire' }, 'empire')?.active).toBe(true);
    expect(find({ rightPanel: 'politics' }, 'politics')?.active).toBe(true);
    expect(find({ rightPanel: 'mail' }, 'mail')?.active).toBe(true);
    expect(find({ rightPanel: 'mail' }, 'politics')?.active).toBe(false);
  });

  it('Mail carries its unread count, never negative', () => {
    expect(find({ unreadMail: 4 }, 'mail')?.badge).toBe(4);
    expect(find({ unreadMail: -1 }, 'mail')?.badge).toBe(0);
  });

  it('Chat is active while shown and carries the unread badge only while hidden', () => {
    expect(find({ chatVisible: true, unreadChat: 5 }, 'chat')).toMatchObject({ active: true, badge: 0 });
    expect(find({ chatVisible: false, unreadChat: 5 }, 'chat')).toMatchObject({ active: false, badge: 5 });
    expect(find({ chatVisible: false, unreadChat: -2 }, 'chat')?.badge).toBe(0);
  });

  it('More is active while open or in any road / zone mode', () => {
    expect(find({}, 'more')?.active).toBe(false);
    expect(find({ moreOpen: true }, 'more')?.active).toBe(true);
    expect(find({ isRoadBuild: true }, 'more')?.active).toBe(true);
    expect(find({ isRoadDemolish: true }, 'more')?.active).toBe(true);
    expect(find({ isZone: true }, 'more')?.active).toBe(true);
  });
});

describe('badgeText / badgeLabel', () => {
  it('caps the badge at 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('names the unread count only when there is one', () => {
    expect(badgeLabel('Mail', 3)).toBe('Mail, 3 unread');
    expect(badgeLabel('Mail', 0)).toBe('Mail');
  });
});

const menuBase: DockMenuState = { isVisitor: false, isPublicOfficeRole: false, isRoadBuild: false, isRoadDemolish: false, isZone: false };
const menuIds = (s: Partial<DockMenuState>) => dockMenuSections({ ...menuBase, ...s }).flatMap((sec) => sec.items.map((i) => i.id));
const menuItem = (s: Partial<DockMenuState>, id: string) =>
  dockMenuSections({ ...menuBase, ...s }).flatMap((sec) => sec.items).find((i) => i.id === id);

describe('dockMenuSections', () => {
  it('groups every v1 MoreMenu item plus the two interface items, in four sections', () => {
    const sections = dockMenuSections(menuBase);
    expect(sections.map((s) => s.title)).toEqual(['Map', 'Find', 'Interface', 'Session']);
    expect(menuIds({})).toEqual([
      'roadBuild', 'roadDemolish', 'overlays', 'minimap',
      'search', 'facilities',
      'settings', 'shortcuts', 'hideHud', 'classic',
      'switchServer',
    ]);
  });

  it('zone painting is offered to public office only, before the overlays', () => {
    expect(menuIds({ isPublicOfficeRole: true }).slice(0, 3)).toEqual(['roadBuild', 'roadDemolish', 'zone']);
    expect(menuIds({}).includes('zone')).toBe(false);
  });

  it('a visitor gets no roads and no facilities', () => {
    const v = menuIds({ isVisitor: true });
    expect(v.includes('roadBuild')).toBe(false);
    expect(v.includes('roadDemolish')).toBe(false);
    expect(v.includes('facilities')).toBe(false);
    expect(v.includes('overlays')).toBe(true);
  });

  it('mode items flip their label and become active while their mode runs', () => {
    expect(menuItem({}, 'roadBuild')).toMatchObject({ label: 'Build road', active: false });
    expect(menuItem({ isRoadBuild: true }, 'roadBuild')).toMatchObject({ label: 'Stop building roads', active: true });
    expect(menuItem({}, 'roadDemolish')).toMatchObject({ label: 'Demolish road', active: false });
    expect(menuItem({ isRoadDemolish: true }, 'roadDemolish')).toMatchObject({ label: 'Stop demolishing roads', active: true });
    expect(menuItem({ isPublicOfficeRole: true }, 'zone')).toMatchObject({ label: 'Zone painting', active: false });
    expect(menuItem({ isPublicOfficeRole: true, isZone: true }, 'zone')).toMatchObject({ label: 'Stop zone painting', active: true });
  });

  it('the interface items carry the keys that do the same thing', () => {
    expect(menuItem({}, 'shortcuts')?.kbd).toBe('?');
    expect(menuItem({}, 'hideHud')?.kbd).toBe('H');
    expect(menuItem({}, 'classic')).toMatchObject({ label: 'Switch to classic interface', kbd: 'V' });
  });
});

describe('nextMenuIndex', () => {
  it('moves down and up, wrapping at both ends', () => {
    expect(nextMenuIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextMenuIndex('ArrowDown', 2, 3)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, 3)).toBe(2);
    expect(nextMenuIndex('ArrowUp', 2, 3)).toBe(1);
  });

  it('starts from the ends when nothing is focused', () => {
    expect(nextMenuIndex('ArrowDown', -1, 3)).toBe(0);
    expect(nextMenuIndex('ArrowUp', -1, 3)).toBe(2);
  });

  it('Home and End jump; other keys and empty menus do nothing', () => {
    expect(nextMenuIndex('Home', 2, 3)).toBe(0);
    expect(nextMenuIndex('End', 0, 3)).toBe(2);
    expect(nextMenuIndex('a', 0, 3)).toBeNull();
    expect(nextMenuIndex('ArrowDown', -1, 0)).toBeNull();
  });
});

describe('map tools', () => {
  it('holds every RightRail control plus the overlays, debug last and muted', () => {
    const flat = MAP_TOOL_GROUPS.flat();
    expect(flat.map((t) => t.id)).toEqual(['zoomIn', 'zoomOut', 'rotateCcw', 'rotateCw', 'overlays', 'minimap', 'refresh', 'debug']);
    expect(flat[flat.length - 1]).toMatchObject({ id: 'debug', muted: true });
    expect(flat.filter((t) => t.muted).length).toBe(1);
  });

  it('labels a tool with its shortcut when it has one', () => {
    expect(toolLabel({ label: 'Zoom in', kbd: '+' })).toBe('Zoom in (+)');
    expect(toolLabel({ label: 'Docked minimap' })).toBe('Docked minimap');
  });
});
