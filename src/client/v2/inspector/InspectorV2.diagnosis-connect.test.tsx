/**
 * v2 inspector: the diagnosis banner's Connect (TV station "no antennas" warning, antenna
 * hint) starts the map pick — the same `connectMap` action the General tab's
 * Connect button dispatches — instead of looking for a tab neither building has.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { InspectorV2 } from './InspectorV2';
import type { BuildingFocusInfo, BuildingDetailsResponse } from '@/shared/types';

interface Tab { id: string; name: string; handlerName: string }

function seed(visualClass: string, hintsText: string, tabs: Tab[]): void {
  const focus = {
    buildingId: 'bld-' + visualClass,
    buildingName: 'Facility',
    ownerName: 'TestCo',
    x: 968,
    y: 993,
    xsize: 2,
    ysize: 2,
    visualClass,
    detailsText: '',
    hintsText,
  } as unknown as BuildingFocusInfo;
  const details = {
    buildingId: 'bld-' + visualClass,
    x: 968,
    y: 993,
    visualClass,
    templateName: tabs[0].handlerName,
    buildingName: 'Facility',
    ownerName: 'TestCo',
    securityId: 'sec-1',
    canGovern: true,
    tabs: tabs.map((t, i) => ({ ...t, order: i, icon: 'G' })),
    groups: {},
    timestamp: 0,
  } as unknown as BuildingDetailsResponse;
  useBuildingStore.getState().setFocus(focus);
  useBuildingStore.setState({ details, isLoading: false, isOwner: true });
}

const TV_TABS: Tab[] = [
  { id: 'tvGeneral', name: 'GENERAL', handlerName: 'TVGeneral' },
  { id: 'workforce', name: 'JOBS', handlerName: 'Workforce' },
  { id: 'products', name: 'CLIENTS', handlerName: 'Products' },
  { id: 'facManagement', name: 'MANAGEMENT', handlerName: 'facManagement' },
  { id: 'antennas', name: 'ANTENNAS', handlerName: 'Antennas' },
  { id: 'chart', name: 'HISTORY', handlerName: 'Chart' },
];

const ANTENNA_TABS: Tab[] = [
  { id: 'unkGeneral', name: 'GENERAL', handlerName: 'unkGeneral' },
  { id: 'workforce', name: 'JOBS', handlerName: 'Workforce' },
  { id: 'facManagement', name: 'MANAGEMENT', handlerName: 'facManagement' },
];

function clickBannerButton(name: string): void {
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name }));
}

describe('InspectorV2 — diagnosis Connect starts the map pick', () => {
  beforeEach(() => {
    resetStores();
  });

  it('TV station warning: Connect dispatches connectMap once', () => {
    const onBuildingAction = jest.fn();
    seed('2990', 'WARNING: There are no antennas attached to this facility. Use the Connect button in the INSPECT panel to connect antennas to this station.', TV_TABS);
    renderWithProviders(<InspectorV2 />, { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) });
    clickBannerButton('Connect');
    expect(onBuildingAction).toHaveBeenCalledTimes(1);
    expect(onBuildingAction).toHaveBeenCalledWith('connectMap');
  });

  it('antenna hint: Connect dispatches connectMap once', () => {
    const onBuildingAction = jest.fn();
    seed('2992', 'HINT: Use the "Connect" button in the INSPECT panel to connect this antenna to a station.', ANTENNA_TABS);
    renderWithProviders(<InspectorV2 />, { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) });
    clickBannerButton('Connect');
    expect(onBuildingAction).toHaveBeenCalledTimes(1);
    expect(onBuildingAction).toHaveBeenCalledWith('connectMap');
  });

  it('findSupplier still switches to the Supplies tab and dispatches nothing', () => {
    const onBuildingAction = jest.fn();
    seed('2994', 'Warning: This facility requires Cotton to produce. Hire some suppliers.', [
      { id: 'general', name: 'GENERAL', handlerName: 'IndGeneral' },
      { id: 'supplies', name: 'SUPPLIES', handlerName: 'Supplies' },
    ]);
    renderWithProviders(<InspectorV2 />, { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) });
    clickBannerButton('Find Cotton suppliers');
    expect(useBuildingStore.getState().currentTab).toBe('supplies');
    expect(onBuildingAction).not.toHaveBeenCalled();
  });
});
