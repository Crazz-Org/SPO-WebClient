import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { RichDetailsView } from './RichDetails';
import { useBuildingStore } from '../../store/building-store';
import { BuildingInspector } from './BuildingInspector';
import type { BuildingFocusInfo, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const mockTabs: BuildingDetailsTab[] = [
  { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'SrvGeneral' },
];

const mockFocus: BuildingFocusInfo = {
  buildingId: 'bld-1',
  buildingName: 'Small Factory',
  ownerName: 'TestCo',
  salesInfo: '$1,200',
  revenue: '$500',
  detailsText: 'Upgrade Level: 2',
  hintsText: 'Warning: The roof is leaking.',
  x: 100,
  y: 200,
  xsize: 2,
  ysize: 2,
  visualClass: '300',
};

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
    general: [],
  },
  timestamp: Date.now(),
};

describe('RichDetailsView', () => {
  it('does not repeat a hint the banner already carries', () => {
    renderWithProviders(
      <RichDetailsView
        detailsText="Upgrade Level: 2"
        hintsText="Warning: This facility needs Qualified work force."
      />
    );
    expect(screen.queryByText(/Qualified work force/i)).toBeNull();
    expect(screen.queryByText(/No hints for this facility/i)).toBeNull();
  });

  it('shows a plain no-hint line when hintsText is the placeholder, empty, or absent', () => {
    const { unmount: unmount1 } = renderWithProviders(
      <RichDetailsView detailsText="Upgrade Level: 2" hintsText="No hints for this facility." />
    );
    expect(screen.getByText('No hints for this facility.')).toBeTruthy();
    unmount1();

    const { unmount: unmount2 } = renderWithProviders(
      <RichDetailsView detailsText="Upgrade Level: 2" hintsText="" />
    );
    expect(screen.getByText('No hints for this facility.')).toBeTruthy();
    unmount2();

    renderWithProviders(<RichDetailsView detailsText="Upgrade Level: 2" />);
    expect(screen.getByText('No hints for this facility.')).toBeTruthy();
  });

  it('shows the plain no-hint line, not the raw sentence, when the hint is denied', () => {
    renderWithProviders(
      <RichDetailsView
        detailsText="Upgrade Level: 2"
        hintsText="This facility belongs to Foo Inc. There are no hints for you."
      />
    );
    expect(screen.getByText('No hints for this facility.')).toBeTruthy();
    expect(screen.queryByText(/belongs to Foo Inc/i)).toBeNull();
  });

  it('shows the plain no-hint line when a Stopped diagnosis comes from section 1', () => {
    renderWithProviders(
      <RichDetailsView detailsText="Stopped: needs money." hintsText="No hints for this facility." />
    );
    expect(screen.getByText('No hints for this facility.')).toBeTruthy();
  });
});

describe('BuildingInspector hint rendering, end to end', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders an unknown hint sentence exactly once', () => {
    useBuildingStore.getState().setFocus({ ...mockFocus, detailsText: 'Upgrade Level: 2', hintsText: 'Warning: The roof is leaking.' } as never);
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    renderWithProviders(<BuildingInspector />);
    expect(screen.getAllByText(/roof is leaking/i)).toHaveLength(1);
  });
});
