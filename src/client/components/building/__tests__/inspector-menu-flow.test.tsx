/**
 * The redesigned INSPECT panel: header, details, sales, then a section menu.
 *
 * The load-time change is visible from here: the panel opens on the menu, no
 * section body is mounted, and nothing is asked of the server until the user
 * opens one. These tests drive that flow through the real component and the
 * real store.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useGameStore } from '../../../store/game-store';
import { BuildingInspector } from '../BuildingInspector';
import type { BuildingFocusInfo, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const focus: BuildingFocusInfo = {
  buildingId: 'bld-7',
  buildingName: 'Small Farm',
  ownerName: 'SPO_test3 - Green',
  salesInfo: 'Wheat sales at 80%',
  revenue: '$1,200/h',
  detailsText: 'Upgrade Level: 4  Producing: Wheat',
  hintsText: 'Needs workers',
  x: 150, y: 300, xsize: 3, ysize: 3,
  visualClass: '200',
};

const tabs: BuildingDetailsTab[] = [
  { id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
  { id: 'workforce', name: 'WORKFORCE', order: 1, icon: 'W', handlerName: 'Workforce' },
];

const details: BuildingDetailsResponse = {
  buildingId: 'bld-7', x: 150, y: 300, visualClass: '200', templateName: 'Farm',
  buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green',
  securityId: 'sec-1', canGovern: false, tabs,
  groups: {
    indGeneral: [
      { name: 'Creator', value: 'SPO_test3' },
      { name: 'ROI', value: '14%' },
      { name: 'Cost', value: '250000' },
    ],
  },
  timestamp: 1,
};

/**
 * Seed through `setDetails`, not through `setState`: that action is what marks
 * the groups a response carried as 'loaded', and the whole section-at-a-time
 * rule reads those marks.
 */
function showInspector(over: Partial<BuildingDetailsResponse> = {}, currentTab = 'overview'): void {
  useGameStore.setState({ status: 'connected' });
  useBuildingStore.getState().setFocus(focus);
  useBuildingStore.getState().setDetails({ ...details, ...over });
  useBuildingStore.setState({ isLoading: false, currentTab });
}

describe('INSPECT header', () => {
  beforeEach(resetStores);

  it('states the name and level, the society and the owner, the revenue and the ROI', () => {
    showInspector();
    renderWithProviders(<BuildingInspector />);

    expect(screen.getByText('Small Farm')).toBeTruthy();
    expect(screen.getByText('Lvl 4')).toBeTruthy();
    expect(screen.getByText('SPO_test3 - Green, SPO_test3')).toBeTruthy();
    expect(screen.getByText('$1,200/h')).toBeTruthy();
    expect(screen.getByText('14%')).toBeTruthy();
  });

  it('names the society alone while the owner property has not come back', () => {
    showInspector({ groups: { indGeneral: [{ name: 'ROI', value: '14%' }] } });
    renderWithProviders(<BuildingInspector />);

    expect(screen.getByText('SPO_test3 - Green')).toBeTruthy();
  });

  it('shows the details and the sales under the header', () => {
    showInspector();
    renderWithProviders(<BuildingInspector />);

    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText(/Wheat/)).toBeTruthy();
  });
});

describe('INSPECT section menu', () => {
  beforeEach(resetStores);

  it('opens on the menu, with no section body mounted', () => {
    showInspector();
    renderWithProviders(<BuildingInspector />);

    expect(screen.getByText('GENERAL')).toBeTruthy();
    expect(screen.getByText('WORKFORCE')).toBeTruthy();
    // Nothing from the GENERAL group is on screen — no section is open.
    expect(screen.queryByText('Value')).toBeNull();
  });

  it('asks for nothing until a section is opened', () => {
    const calls: unknown[][] = [];
    showInspector();
    renderWithProviders(<BuildingInspector />, {
      clientCallbacks: createSpiedCallbacks({
        onRequestTabData: (...args: unknown[]) => { calls.push(args); },
      }),
    });

    expect(calls).toEqual([]);
  });

  it('reads the section the user opens, naming its group', () => {
    const calls: unknown[][] = [];
    showInspector();
    renderWithProviders(<BuildingInspector />, {
      clientCallbacks: createSpiedCallbacks({
        onRequestTabData: (...args: unknown[]) => { calls.push(args); },
      }),
    });

    fireEvent.click(screen.getByText('WORKFORCE'));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([150, 300, 'workforce', '200', ['workforce']]);
  });

  it('opens the drawer on the section it already holds, without a round-trip', () => {
    const calls: unknown[][] = [];
    showInspector();
    renderWithProviders(<BuildingInspector />, {
      clientCallbacks: createSpiedCallbacks({
        onRequestTabData: (...args: unknown[]) => { calls.push(args); },
      }),
    });

    fireEvent.click(screen.getByText('GENERAL'));

    // The header read already brought this group back.
    expect(calls).toEqual([]);
    expect(screen.getByText('Value')).toBeTruthy();
  });

  it('closes the drawer and returns to the plain menu', () => {
    showInspector({}, 'indGeneral');
    renderWithProviders(<BuildingInspector />);
    expect(screen.getByText('Value')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close section'));

    expect(screen.queryByText('Value')).toBeNull();
    expect(screen.getByText('GENERAL')).toBeTruthy();
  });

  it('shows a skeleton while the opened section is still being read', () => {
    showInspector();
    useBuildingStore.setState({ currentTab: 'workforce' });
    const { container } = renderWithProviders(<BuildingInspector />);

    expect(container.querySelector('[class*="loadingState"]')).toBeTruthy();
  });

  it('says so when the section failed to load', () => {
    showInspector({}, 'workforce');
    useBuildingStore.setState({ tabLoadingStates: { workforce: 'error' } });
    renderWithProviders(<BuildingInspector />);

    expect(screen.getByText(/Failed to load this section/)).toBeTruthy();
  });
});

describe('INSPECT hidden properties', () => {
  beforeEach(resetStores);

  /**
   * `Creator` states the owner, which the header already names; the rest carry
   * nothing a player reads. They stay in the response — `SecurityId` decides
   * `canGovern` — and are dropped at render.
   *
   * `TradeLevel` was one of them until issue 551 and is not any more: it is a
   * setting the owner changes, and the sheet now carries a control for it.
   */
  it('keeps the hidden names out of an open section', () => {
    showInspector({
      groups: {
        indGeneral: [
          { name: 'Creator', value: 'SPO_test3' },
          { name: 'SecurityId', value: '-296197588--295583672--' },
          { name: 'Trouble', value: '3' },
          { name: 'ROI', value: '14%' },
        ],
      },
    }, 'indGeneral');
    renderWithProviders(<BuildingInspector />);

    const drawer = screen.getByLabelText('GENERAL');
    expect(drawer.textContent).not.toContain('-296197588');
    expect(drawer.textContent).not.toContain('Trouble');
  });

  /**
   * `UpgradeActions` names two things: the raw server VALUE (hidden, no reading
   * for a player) and the CONTROL carrying the Upgrade / Downgrade buttons.
   * This test used to pin the opposite — control hidden, values as plain rows —
   * which left the whole upgrade path unreachable from the UI (found by the B5
   * live QA, PR #79). Now: the control renders (Voyager's Management sheet has
   * the buttons, ManagementSheet.pas), it states the level itself, and the cost
   * it never shows keeps its own row.
   */
  it('renders the upgrade control, its level line, and the cost row', () => {
    const upgradeTabs: BuildingDetailsTab[] = [
      { id: 'upgrade', name: 'UPGRADE', order: 0, icon: 'U', handlerName: 'Upgrade' },
    ];
    showInspector({
      // Its own visual class: `registerInspectorTabs` caches per class, and the
      // rows are rendered from the registered template, not from `tabs`.
      visualClass: '9200',
      tabs: upgradeTabs,
      groups: {
        upgrade: [
          { name: 'UpgradeLevel', value: '3' },
          { name: 'MaxUpgrade', value: '5' },
          { name: 'NextUpgCost', value: '250000' },
          { name: 'UpgradeActions', value: '' },
        ],
      },
    }, 'upgrade');
    renderWithProviders(<BuildingInspector />);

    const drawer = screen.getByLabelText('UPGRADE');
    // The control owns the level line — no duplicate plain rows for it
    expect(drawer.textContent).toContain('Level 3');
    expect(drawer.textContent).not.toContain('Current Level');
    // The cost the control never shows keeps its row
    expect(drawer.textContent).toContain('Upgrade Cost');
    // The raw value never prints
    expect(drawer.textContent).not.toContain('UpgradeActions');
  });
});
