/**
 * Smoke tests for remaining building components:
 * SaveIndicator, RevenueGraph, StatusOverlay, PropertyGroup.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { SaveIndicator } from '../SaveIndicator';
import { RevenueGraph } from '../RevenueGraph';
import { PropertyGroup } from '../PropertyGroup';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

// ---------------------------------------------------------------------------
// SaveIndicator
// ---------------------------------------------------------------------------

describe('SaveIndicator', () => {
  beforeEach(resetStores);

  it('renders nothing when no pending/confirmed/failed state', () => {
    const { container } = renderWithProviders(<SaveIndicator propertyKey="test-key" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pending dot when update is pending', () => {
    useBuildingStore.setState({
      pendingUpdates: new Map([['price-0', { value: '100', timestamp: Date.now() }]]),
      confirmedUpdates: new Map(),
      failedUpdates: new Map(),
    });
    const { container } = renderWithProviders(<SaveIndicator propertyKey="price-0" />);
    expect(container.querySelector('[class*="pending"]')).toBeTruthy();
  });

  it('renders confirmed checkmark', () => {
    useBuildingStore.setState({
      pendingUpdates: new Map(),
      confirmedUpdates: new Map([['price-0', { timestamp: Date.now(), verdict: 'confirmed' as const }]]),
      failedUpdates: new Map(),
    });
    const { container } = renderWithProviders(<SaveIndicator propertyKey="price-0" />);
    expect(container.querySelector('[class*="confirmed"]')).toBeTruthy();
  });

  it('renders failed indicator', () => {
    useBuildingStore.setState({
      pendingUpdates: new Map(),
      confirmedUpdates: new Map(),
      failedUpdates: new Map([['price-0', { originalValue: '50', error: 'Server error', timestamp: Date.now() }]]),
    });
    const { container } = renderWithProviders(<SaveIndicator propertyKey="price-0" />);
    expect(container.querySelector('[class*="failed"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RevenueGraph
// ---------------------------------------------------------------------------

describe('RevenueGraph', () => {
  it('renders SVG chart with data', () => {
    const { container } = renderWithProviders(
      <RevenueGraph data={[100, 200, 150, 300, 250]} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders with empty data', () => {
    const { container } = renderWithProviders(<RevenueGraph data={[]} />);
    // Should render without crashing even with no data points
    expect(container).toBeTruthy();
  });

  it('renders with single data point', () => {
    const { container } = renderWithProviders(<RevenueGraph data={[500]} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('labels the x axis with years ending at endYear and values in thousands', () => {
    const { container } = renderWithProviders(
      <RevenueGraph data={[-29, 5, 42]} endYear={2333} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('2331');
    expect(text).toContain('2332');
    expect(text).toContain('2333');
    expect(text).toContain('$42.00K');
  });
});

// ---------------------------------------------------------------------------
// PropertyGroup
// ---------------------------------------------------------------------------

describe('PropertyGroup', () => {
  beforeEach(() => {
    resetStores();
    // Set up minimal details so the component can find its template
    const mockTabs: BuildingDetailsTab[] = [
      { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'SrvGeneral' },
    ];
    const mockDetails: BuildingDetailsResponse = {
      buildingId: 'bld-1',
      x: 100, y: 200,
      visualClass: '300',
      templateName: 'SrvGeneral',
      buildingName: 'Factory',
      ownerName: 'TestCo',
      securityId: 'sec-1',
      canGovern: true,
      tabs: mockTabs,
      groups: { general: [] },
      timestamp: Date.now(),
    };
    useBuildingStore.setState({ details: mockDetails, isLoading: false, currentTab: 'general' });
  });

  it('renders without crashing with empty properties', () => {
    const { container } = renderWithProviders(
      <PropertyGroup properties={[]} buildingX={100} buildingY={200} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders raw property rows for unknown properties', () => {
    const props: BuildingPropertyValue[] = [
      { name: 'CustomProp', value: 'Hello World' },
    ];
    const { container } = renderWithProviders(
      <PropertyGroup properties={props} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('CustomProp');
    expect(container.textContent).toContain('Hello World');
  });
});
