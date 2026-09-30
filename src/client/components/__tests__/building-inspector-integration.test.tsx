/**
 * Integration test: Building Inspector open flow.
 *
 * Tests the full user journey:
 * 1. Store receives focus → building store updates
 * 2. Store receives details → tabs + properties populate
 * 3. Component renders building name, tabs, properties
 * 4. Tab switching updates active tab and shown properties
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { BuildingInspector } from '../building/BuildingInspector';
import type {
  BuildingFocusInfo,
  BuildingDetailsResponse,
  BuildingDetailsTab,
  BuildingPropertyValue,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockFocus: BuildingFocusInfo = {
  buildingId: 'bld-42',
  buildingName: 'Small Farm',
  ownerName: 'TestCorp',
  salesInfo: 'Sales: $1,200/h',
  revenue: '$1,200',
  detailsText: 'Producing crops',
  hintsText: 'Needs workers',
  x: 150,
  y: 300,
  xsize: 3,
  ysize: 3,
  visualClass: '200',
};

const generalProps: BuildingPropertyValue[] = [
  { name: 'Name', value: 'Small Farm' },
  { name: 'Created', value: '2025-01-15' },
  { name: 'Efficiency', value: '85%' },
];

const productionProps: BuildingPropertyValue[] = [
  { name: 'Output', value: 'Wheat' },
  { name: 'Capacity', value: '500 tons/month' },
];

const tabs: BuildingDetailsTab[] = [
  { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
  { id: 'production', name: 'PRODUCTION', order: 1, icon: 'P', handlerName: 'IndProduction' },
];

const mockDetails: BuildingDetailsResponse = {
  buildingId: 'bld-42',
  x: 150,
  y: 300,
  visualClass: '200',
  templateName: 'SmallFarm',
  buildingName: 'Small Farm',
  ownerName: 'TestCorp',
  securityId: 'sec-1',
  canGovern: true,
  tabs,
  groups: {
    general: generalProps,
    production: productionProps,
  },
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Building Inspector — integration flow', () => {
  beforeEach(resetStores);

  it('shows empty state when no building is focused', () => {
    renderWithProviders(<BuildingInspector />);
    expect(screen.getByText('Click a building on the map to inspect it')).toBeTruthy();
  });

  it('shows loading skeleton when focus is set but details not yet received', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: null,
      isLoading: true,
    });
    const { container } = renderWithProviders(<BuildingInspector />);
    // Should show skeleton placeholders, not the empty state
    expect(container.querySelector('[class*="loading"]')).toBeTruthy();
    expect(screen.queryByText('Click a building on the map to inspect it')).toBeNull();
  });

  it('renders building name, owner, and tabs when details arrive', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: mockDetails,
      isLoading: false,
      currentTab: 'general',
    });
    renderWithProviders(<BuildingInspector />);

    // Header — name appears in header + Name property row
    expect(screen.getAllByText('Small Farm').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/TestCorp/)).toBeTruthy();

    // Sections. GENERAL is open, so its name is on the rail AND on the drawer
    // header — the menu is master/detail now, not a single row of pills.
    expect(screen.getAllByText('GENERAL').length).toBeGreaterThan(0);
    expect(screen.getByText('PRODUCTION')).toBeTruthy();
  });

  it('shows GENERAL tab properties by default', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: mockDetails,
      isLoading: false,
      currentTab: 'general',
    });
    renderWithProviders(<BuildingInspector />);

    // General tab properties visible (Name is shown in header, not property list)
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Efficiency')).toBeTruthy();
  });

  it('switches to PRODUCTION tab when clicked', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: mockDetails,
      isLoading: false,
      currentTab: 'general',
    });
    renderWithProviders(<BuildingInspector />);

    // Click PRODUCTION tab
    fireEvent.click(screen.getByText('PRODUCTION'));

    // Store should update
    expect(useBuildingStore.getState().currentTab).toBe('production');
  });

  it('renders QuickStats revenue info from focus', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: mockDetails,
      isLoading: false,
      currentTab: 'general',
    });
    renderWithProviders(<BuildingInspector />);

    // QuickStats should show revenue from focus
    expect(screen.getByText('$1,200')).toBeTruthy();
  });

  it('renders no toolbar of its own — Refresh and Close now live on the sheet row', () => {
    useBuildingStore.setState({
      focusedBuilding: mockFocus,
      details: mockDetails,
      isLoading: false,
      currentTab: 'general',
    });
    renderWithProviders(<BuildingInspector />);

    expect(screen.queryByLabelText('Refresh')).toBeNull();
    expect(screen.queryByLabelText('Close')).toBeNull();
  });
});

