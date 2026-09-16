/**
 * The merged stack row (issue #877): Pin, Close, View on map and Refresh all
 * live on the sheet's own `.stackRow`, for both the non-civic and civic paths.
 * Renders the real Sheet + BuildingSurface + BuildingSheetActions; only the
 * heavy BuildingInspector is stubbed, same style as BuildingSurface.test.tsx.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { Sheet } from './Sheet';
import type { BuildingDetailsResponse } from '@/shared/types';

jest.mock('../building', () => ({
  BuildingInspector: () => <div>INSPECTOR</div>,
}));
jest.mock('@/shared/building-details/civic-buildings', () => ({
  isCivicBuilding: (vc: string) => vc === '9999',
}));

function details(over: Partial<BuildingDetailsResponse>): BuildingDetailsResponse {
  return {
    buildingId: 1, x: 5, y: 6, visualClass: '100', templateName: 't', buildingName: 'Small Factory',
    ownerName: 'TestCo', securityId: '', canGovern: true, tabs: [], groups: {}, timestamp: 0,
    ...over,
  } as unknown as BuildingDetailsResponse;
}

describe('Sheet — the building row (non-civic)', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setPinned(false);
    useBuildingStore.getState().clearFocus();
  });

  it('shows exactly one Close, plus View on map, Refresh and Pin, and no stack chips', () => {
    useBuildingStore.getState().setDetails(details({}));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'View on map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pin sheet/ })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Open surfaces' })).toBeNull();
  });

  it('closing clears the whole stack', () => {
    useBuildingStore.getState().setDetails(details({}));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().stack).toEqual([]);
  });

  it('View on map and Refresh call the client with the details coordinates', () => {
    useBuildingStore.getState().setDetails(details({ x: 7, y: 9 }));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    const onNavigateToBuilding = jest.fn();
    const onRefreshBuilding = jest.fn();
    renderWithProviders(<Sheet />, {
      clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding, onRefreshBuilding }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'View on map' }));
    expect(onNavigateToBuilding).toHaveBeenCalledWith(7, 9);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefreshBuilding).toHaveBeenCalledWith(7, 9);
  });

  it('Pin toggles', () => {
    useBuildingStore.getState().setDetails(details({}));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);

    fireEvent.click(screen.getByRole('button', { name: /Pin sheet/ }));
    expect(useUiStore.getState().pinned).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Unpin sheet/ }));
    expect(useUiStore.getState().pinned).toBe(false);
  });

  it('stack chips still render when stack.length > 1, on the same row', () => {
    useBuildingStore.getState().setDetails(details({}));
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'building' });
      useUiStore.getState().pushSurface({ kind: 'search' });
    });
    renderWithProviders(<Sheet />);

    expect(screen.getByRole('navigation', { name: 'Open surfaces' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Building Inspector' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
  });
});

describe('Sheet — the building row (civic)', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setPinned(false);
    useBuildingStore.getState().clearFocus();
  });

  it('Town Hall: exactly one Close, one Refresh, the mayor-write button, and no View on map', () => {
    useBuildingStore.getState().setDetails(details({
      visualClass: '9999',
      buildingName: 'Helartia Town Hall',
      groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }] } as never,
    }));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Write to the Mayor of Helartia' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View on map' })).toBeNull();
  });

  it('Capitol: exactly one Close, one Refresh, no mayor-write button, no View on map', () => {
    useBuildingStore.getState().setDetails(details({
      visualClass: '9999',
      buildingName: 'Capitol',
      tabs: [{ id: 'capitolTowns' }] as never,
      groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }] } as never,
    }));
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Write to the Mayor/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View on map' })).toBeNull();
  });
});
