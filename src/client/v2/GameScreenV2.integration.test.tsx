/**
 * GameScreenV2 with the REAL v2 slots (TopBar, SignalLine, ModeBanner, Dock, MapTools,
 * ChatDrawer, SidePanel, FocusCard, InspectorV2) — the cross-agent contracts in one render.
 * Only the v1 pieces that touch the canvas or fetch on mount are stubbed, as GameScreen.test does.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, act, fireEvent, within } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { useChatStore } from '../store/chat-store';
import { useGameStore } from '../store/game-store';
import { useBuildingStore } from '../store/building-store';
import { UI_VERSION_KEY } from '../store/ui-version';
import type { BuildingDetailsResponse, BuildingFocusInfo } from '@/shared/types';
import { GameScreenV2 } from './GameScreenV2';

jest.mock('../components/chat', () => ({
  ...jest.requireActual<typeof import('../components/chat')>('../components/chat'),
  ChatStrip: () => <div>CHATSTRIP</div>,
}));
jest.mock('../components/map/MapContextMenu', () => ({ MapContextMenu: () => null }));
jest.mock('../components/modals', () => ({ ServerSwitchOverlay: () => null, ZoneTypePicker: () => null }));
jest.mock('../components/mobile', () => ({ MobileShell: () => null }));
jest.mock('../components/command-palette', () => ({ CommandPalette: () => null }));
jest.mock('../hooks/useChangelogCheck', () => ({ useChangelogCheck: () => undefined }));

const focus: BuildingFocusInfo = {
  buildingId: 'bld-7', buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green',
  salesInfo: '', revenue: '$1,200/h', detailsText: '', hintsText: '',
  x: 150, y: 300, xsize: 3, ysize: 3, visualClass: '200',
};

const details: BuildingDetailsResponse = {
  buildingId: 'bld-7', x: 150, y: 300, visualClass: '200', templateName: 'Farm',
  buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green', securityId: 's', canGovern: false,
  tabs: [{ id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' }],
  groups: { indGeneral: [{ name: 'Name', value: 'Small Farm' }] },
  timestamp: 1,
};

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

async function renderScreen() {
  let result!: ReturnType<typeof renderWithProviders>;
  await act(async () => { result = renderWithProviders(<GameScreenV2 />); });
  return result;
}

describe('GameScreenV2 — integration with the real v2 slots (desktop)', () => {
  beforeEach(() => {
    resetStores();
    setWidth(1400);
    useUiStore.setState({ modal: null, confirmPayload: null, promptPayload: null, hudVisible: true, uiVersion: 'v2' });
    useUiStore.getState().clearSurfaces();
    useChatStore.setState({ chatVisible: true, chasedUser: null });
    useGameStore.setState({ status: 'connected', username: 'SPO_test3', worldName: 'Planitia' });
  });
  afterEach(() => {
    setWidth(1024);
    localStorage.removeItem(UI_VERSION_KEY);
  });

  it('mounts the top bar, the dock, the map tools and the chat drawer', async () => {
    await renderScreen();
    expect(screen.getByRole('banner', { name: 'Player status' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Game actions' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Map controls' })).toBeTruthy();
    expect(screen.getByText('CHATSTRIP')).toBeTruthy();
    // no side panel until a surface opens
    expect(document.querySelector('aside[data-surface]')).toBeNull();
  });

  it('a building surface shows InspectorV2 inside the side panel, with one View on map and one Refresh', async () => {
    useBuildingStore.getState().setFocus(focus);
    useBuildingStore.getState().setDetails(details);
    useBuildingStore.setState({ isLoading: false, currentTab: 'overview' });
    await renderScreen();
    await act(async () => { useUiStore.getState().pushSurface({ kind: 'building' }); });

    const panel = document.querySelector<HTMLElement>('aside[data-surface="building"]');
    if (!panel) throw new Error('no side panel for the building surface');
    // the inspector draws the heading; the panel adds none of its own
    expect(within(panel).getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(within(panel).getByRole('heading', { name: 'Small Farm' })).toBeTruthy();
    expect(within(panel).getAllByRole('button', { name: /View on map/ })).toHaveLength(1);
    expect(within(panel).getAllByRole('button', { name: /^Refresh/ })).toHaveLength(1);
  });

  it('H hides the deck and keeps the open side panel', async () => {
    await renderScreen();
    await act(async () => { useUiStore.getState().pushSurface({ kind: 'mail' }); });
    expect(document.querySelector('aside[data-surface="mail"]')).toBeTruthy();

    act(() => useUiStore.getState().toggleHudVisible());
    expect(screen.queryByRole('banner', { name: 'Player status' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Game actions' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Map controls' })).toBeNull();
    expect(screen.queryByText('CHATSTRIP')).toBeNull();
    expect(document.querySelector('aside[data-surface="mail"]')).toBeTruthy();
  });

  it('while chasing, the stop control is in the top bar — v1 badge only once the bar is hidden', async () => {
    useChatStore.setState({ chasedUser: 'Alice' });
    await renderScreen();
    const header = screen.getByRole('banner', { name: 'Player status' });
    expect(within(header).getByRole('button', { name: 'Stop following Alice' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Stop following Alice' })).toHaveLength(1);

    act(() => useUiStore.getState().toggleHudVisible());
    expect(screen.getAllByRole('button', { name: 'Stop following Alice' })).toHaveLength(1);
    expect(screen.queryByRole('banner', { name: 'Player status' })).toBeNull();
  });

  it('the dock menu\'s "Switch to classic interface" sets uiVersion v1 and persists it', async () => {
    await renderScreen();
    const more = within(screen.getByRole('navigation', { name: 'Game actions' })).getByRole('button', { name: /^More/ });
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Switch to classic interface/ }));
    expect(useUiStore.getState().uiVersion).toBe('v1');
    expect(localStorage.getItem(UI_VERSION_KEY)).toBe('v1');
  });
  it('the dock menu opens the overlays surface through the classic content, in the side panel', async () => {
    await renderScreen();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Game actions' })).getByRole('button', { name: /^More/ }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: /Map overlays/ }));
    });
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['overlays']);
    expect(document.querySelector('aside[data-surface="overlays"]')).toBeTruthy();
  });
});
