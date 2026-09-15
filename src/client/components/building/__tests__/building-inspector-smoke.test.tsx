/**
 * Smoke tests for the Building Inspector component tree.
 *
 * These tests verify that components render without crashing —
 * the minimum bar that prevents "component throws on mount" regressions.
 * They run in jsdom and use @testing-library/react.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { BuildingInspector } from '../BuildingInspector';
import { QuickStats } from '../QuickStats';
import { InspectorMenu } from '../InspectorMenu';
import { InspectorHeader } from '../InspectorHeader';
import type { BuildingFocusInfo, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockFocus: BuildingFocusInfo = {
  buildingId: 'bld-1',
  buildingName: 'Small Factory',
  ownerName: 'TestCo',
  salesInfo: '$1,200',
  revenue: '$500',
  detailsText: 'Producing goods',
  hintsText: 'Running well',
  x: 100,
  y: 200,
  xsize: 2,
  ysize: 2,
  visualClass: '300',
};

const mockTabs: BuildingDetailsTab[] = [
  { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'SrvGeneral' },
  { id: 'supplies', name: 'SUPPLIES', order: 1, icon: 'S', handlerName: 'compInputs' },
];

const mockDetails: BuildingDetailsResponse = {
  buildingId: 'bld-1',
  x: 100,
  y: 200,
  visualClass: '300',
  templateName: 'SrvGeneral',
  buildingName: 'Small Factory',
  ownerName: 'TestCo',
  securityId: 'sec-1',
  canGovern: true,
  tabs: mockTabs,
  groups: {
    general: [
      { name: 'Trouble', value: '0' },
      { name: 'Workers', value: '25' },
    ],
    supplies: [],
  },
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BuildingInspector smoke tests', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state when no building is focused', () => {
    const { container } = renderWithProviders(<BuildingInspector />);
    expect(container.textContent).toContain('Click a building');
  });

  it('renders loading skeleton when building is focused but details not yet loaded', () => {
    useBuildingStore.getState().setFocus(mockFocus);
    useBuildingStore.setState({ isLoading: true });

    const { container } = renderWithProviders(<BuildingInspector />);
    // Should render skeletons, not crash
    expect(container.querySelector('[class*="loading"]')).toBeTruthy();
  });

  it('renders full inspector when details are loaded', () => {
    useBuildingStore.getState().setFocus(mockFocus);
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    const { container } = renderWithProviders(<BuildingInspector />);
    expect(screen.getByText('Small Factory')).toBeTruthy();
    expect(screen.getByText('TestCo')).toBeTruthy();
    // QuickStats' height cap needs a definite-height parent to resolve against —
    // the slot wrapper supplies it (issue #443).
    const quickStatsSlot = container.querySelector('.quickStatsSlot');
    expect(quickStatsSlot).toBeTruthy();
    expect(quickStatsSlot?.querySelector('.bar')).toBeTruthy();
  });

  it('renders without header when hideHeader is true', () => {
    useBuildingStore.getState().setFocus(mockFocus);
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    const { container } = renderWithProviders(<BuildingInspector hideHeader />);
    // Component should render without crashing
    expect(container).toBeTruthy();
    // Building name should NOT appear in header (modal provides its own)
    const headers = container.querySelectorAll('h3');
    expect(headers.length).toBe(0);
  });

  it('renders tabs when details include multiple tabs', () => {
    useBuildingStore.getState().setFocus(mockFocus);
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    renderWithProviders(<BuildingInspector />);
    expect(screen.getByText('GENERAL')).toBeTruthy();
    expect(screen.getByText('SUPPLIES')).toBeTruthy();
  });
});

describe('QuickStats smoke test', () => {
  it('renders the sales info, and leaves revenue to the header', () => {
    renderWithProviders(<QuickStats focus={mockFocus} />);
    expect(screen.getByText('$1,200')).toBeTruthy();
    expect(screen.queryByText('$500')).toBeNull();
  });

  it('renders construction progress bar', () => {
    const constructionFocus = { ...mockFocus, salesInfo: '45% completed.' };
    renderWithProviders(<QuickStats focus={constructionFocus} />);
    expect(screen.getByText('45%')).toBeTruthy();
    expect(screen.getByText('Construction')).toBeTruthy();
  });
});

describe('InspectorMenu smoke test', () => {
  it('lists every section and opens none of them', () => {
    renderWithProviders(
      <InspectorMenu tabs={mockTabs} activeTab={null} onSelect={() => {}}>
        <div>section body</div>
      </InspectorMenu>,
    );
    expect(screen.getByText('GENERAL')).toBeTruthy();
    expect(screen.getByText('SUPPLIES')).toBeTruthy();
    // No section open — the body is not mounted, so nothing was read for it.
    expect(screen.queryByText('section body')).toBeNull();
  });

  it('opens the drawer for the active section', () => {
    renderWithProviders(
      <InspectorMenu tabs={mockTabs} activeTab="general" onSelect={() => {}}>
        <div>section body</div>
      </InspectorMenu>,
    );
    expect(screen.getByText('section body')).toBeTruthy();
    const item = screen.getAllByText('GENERAL')[0].closest('button');
    expect(item?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('InspectorHeader smoke test', () => {
  it('states name, level, society, owner, revenue and ROI', () => {
    renderWithProviders(
      <InspectorHeader
        buildingName="Small Factory"
        level={3}
        society="TestCo"
        owner="SPO_test3"
        revenue="$500/h"
        roi="12%"
        x={100}
        y={200}
      />,
    );
    expect(screen.getByText('Small Factory')).toBeTruthy();
    expect(screen.getByText('Lvl 3')).toBeTruthy();
    expect(screen.getByText('TestCo, SPO_test3')).toBeTruthy();
    expect(screen.getByText('$500/h')).toBeTruthy();
    expect(screen.getByText('12%')).toBeTruthy();
    expect(screen.getByText('100, 200')).toBeTruthy();
  });

  it('drops the comma when only the society is known', () => {
    renderWithProviders(<InspectorHeader buildingName="Small Factory" society="TestCo" />);
    expect(screen.getByText('TestCo')).toBeTruthy();
  });
});

describe('BuildingInspector — no toolbar of its own', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders no Close, Refresh or View on map — those now live on the sheet row', () => {
    useBuildingStore.getState().setFocus(mockFocus);
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    renderWithProviders(<BuildingInspector />);
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.queryByLabelText('Refresh')).toBeNull();
    expect(screen.queryByLabelText('View on map')).toBeNull();
  });

  it('the diagnosis banner reads the pushed hint and its action opens the matching tab (T2, B7)', () => {
    useBuildingStore.getState().setFocus({ ...mockFocus, detailsText: 'Upgrade Level: 2', hintsText: 'Warning: This facility requires Cotton to produce. Hire some suppliers or try to overpay those you already have.' } as never);
    useBuildingStore.setState({ details: { ...mockDetails, tabs: [...(mockDetails.tabs ?? []), { id: 'supplies', name: 'SUPPLIES', order: 9, icon: 'S', handlerName: 'Supplies' }] } as never, isLoading: false });
    renderWithProviders(<BuildingInspector />);
    expect(screen.getByText(/No supplies/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Find Cotton suppliers' }));
    expect(useBuildingStore.getState().currentTab).toBe('supplies');
  });
});

// ---------------------------------------------------------------------------
// Long product / service lists
// ---------------------------------------------------------------------------
// A warehouse sells (and stores) dozens of wares. The summary bar used to grow
// one row per ware and push the tab bar and the tab content out of the panel;
// each list now lives in its own bounded, scrollable box.

/** salesInfo as a warehouse sends it — one "<ware> sales at N%" line per ware. */
const manySalesInfo = Array.from(
  { length: 30 },
  (_, i) => `Ware ${i} sales at ${i * 3}%`,
).join('\n');

/** detailsText of a storage building — "N kg of <ware> at N% quality index." */
const manyStoringText =
  'Upgrade Level: 1  Storing: ' +
  Array.from(
    { length: 12 },
    (_, i) => `${1000 + i} kg of Ware ${i} at ${30 + i}% quality index.`,
  ).join('  ');

/** detailsText of a farm — products separated by a double period. */
const manyProducingText =
  'Upgrade Level: 2  Producing: ' +
  Array.from(
    { length: 6 },
    (_, i) => `${1000 + i} kg of Ware ${i} at ${60 + i}% quality index, 90% efficiency`,
  ).join('..');

describe('QuickStats — long sales lists stay scrollable', () => {
  it('renders every sales row inside a single scroll box', () => {
    const { container } = renderWithProviders(
      <QuickStats focus={{ ...mockFocus, salesInfo: manySalesInfo }} />,
    );
    const scroll = container.querySelector('.salesScroll');
    expect(scroll).toBeTruthy();
    expect(scroll?.querySelectorAll('.salesRow')).toHaveLength(30);
  });

  it('keeps the Sales header and the row count outside the scroll box', () => {
    const { container } = renderWithProviders(
      <QuickStats focus={{ ...mockFocus, salesInfo: manySalesInfo }} />,
    );
    const header = container.querySelector('.salesListHeader');
    expect(header?.textContent).toBe('Sales30');
    expect(container.querySelector('.salesScroll')?.textContent).not.toContain('Sales');
  });

  it('uses the same scroll box for a short list', () => {
    const { container } = renderWithProviders(
      <QuickStats focus={{ ...mockFocus, salesInfo: 'Pharmaceutics sales at 80%' }} />,
    );
    expect(container.querySelector('.salesListHeader')?.textContent).toBe('Sales1');
    expect(container.querySelectorAll('.salesScroll > .salesRow')).toHaveLength(1);
  });
});

describe('QuickStats — long detail lists stay scrollable', () => {
  it('wraps the Storing items in their own scroll box', () => {
    const { container } = renderWithProviders(
      <QuickStats focus={{ ...mockFocus, salesInfo: '', detailsText: manyStoringText }} />,
    );
    const items = container.querySelector('.sectionItems');
    expect(items).toBeTruthy();
    expect(items?.querySelectorAll('.productCard')).toHaveLength(12);
    expect(screen.getByText('Storing')).toBeTruthy();
  });

  it('wraps the Producing items in their own scroll box', () => {
    const { container } = renderWithProviders(
      <QuickStats focus={{ ...mockFocus, salesInfo: '', detailsText: manyProducingText }} />,
    );
    const items = container.querySelector('.sectionItems');
    expect(items?.querySelectorAll('.productCard')).toHaveLength(6);
    expect(screen.getByText('Producing')).toBeTruthy();
  });
});
