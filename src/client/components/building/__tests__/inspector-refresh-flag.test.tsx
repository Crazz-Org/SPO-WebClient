/**
 * Issue #929 — each refresh call site says whether a person asked for it.
 * Only a user-started refresh may raise an error toast; the 30 s auto-refresh
 * must pass `userInitiated: false`.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useGameStore } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { BuildingInspector } from '../BuildingInspector';
import { BuildingInspectorModal } from '../../modals/BuildingInspectorModal';
import type { BuildingFocusInfo, BuildingDetailsResponse } from '@/shared/types';

const focus: BuildingFocusInfo = {
  buildingId: 'bld-1', buildingName: 'Small Factory', ownerName: 'TestCo', salesInfo: '',
  revenue: '', detailsText: '', hintsText: '', x: 100, y: 200, xsize: 2, ysize: 2, visualClass: '300',
};

const details: BuildingDetailsResponse = {
  buildingId: 'bld-1', x: 100, y: 200, visualClass: '300', templateName: 'SrvGeneral',
  buildingName: 'Small Factory', ownerName: 'TestCo', securityId: 'sec-1', canGovern: true,
  tabs: [], groups: {}, timestamp: Date.now(),
};

describe('refresh call sites carry userInitiated', () => {
  beforeEach(() => {
    resetStores();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('the 30 s auto-refresh passes userInitiated: false', () => {
    jest.useFakeTimers();
    const onRefreshBuilding = jest.fn();
    useGameStore.setState({ status: 'connected' });
    useBuildingStore.getState().setFocus(focus);
    useBuildingStore.getState().setDetails(details);
    renderWithProviders(<BuildingInspector />, {
      clientCallbacks: createSpiedCallbacks({ onRefreshBuilding }),
    });

    act(() => { jest.advanceTimersByTime(30_000); });

    expect(onRefreshBuilding).toHaveBeenCalledWith(100, 200, { userInitiated: false });
  });

  it('the Retry button after an error passes userInitiated: true', () => {
    const onRefreshBuilding = jest.fn();
    useBuildingStore.getState().setFocus(focus);
    useBuildingStore.getState().setDetailsError('Failed to load building details. Please try again.');
    renderWithProviders(<BuildingInspector />, {
      clientCallbacks: createSpiedCallbacks({ onRefreshBuilding }),
    });

    fireEvent.click(screen.getByText('Retry'));

    expect(onRefreshBuilding).toHaveBeenCalledWith(100, 200, { userInitiated: true });
  });

  it('the modal Refresh button passes userInitiated: true', () => {
    const onRefreshBuilding = jest.fn();
    useBuildingStore.getState().setFocus(focus);
    useBuildingStore.getState().setDetails(details);
    useUiStore.getState().openModal('buildingInspector');
    renderWithProviders(<BuildingInspectorModal />, {
      clientCallbacks: createSpiedCallbacks({ onRefreshBuilding }),
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);

    expect(onRefreshBuilding).toHaveBeenCalledWith(100, 200, { userInitiated: true });
  });
});
