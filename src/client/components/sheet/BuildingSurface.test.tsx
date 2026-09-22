import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useMailStore } from '../../store/mail-store';
import { useUiStore } from '../../store/ui-store';
import { BuildingSurface } from './BuildingSurface';
import type { BuildingDetailsResponse } from '@/shared/types';

jest.mock('../building', () => ({
  BuildingInspector: ({ hideHeader }: { hideHeader?: boolean }) => <div>INSPECTOR {hideHeader ? 'no-header' : 'with-header'}</div>,
}));
jest.mock('@/shared/building-details/civic-buildings', () => ({
  isCivicBuilding: (vc: string) => vc === '9999',
}));
jest.mock('../politics/CivicTabConfig', () => ({
  isCapitolBuilding: (tabs: unknown[]) => Array.isArray(tabs) && tabs.some((t) => (t as { id: string }).id === 'capitol'),
}));

function details(over: Partial<BuildingDetailsResponse>): BuildingDetailsResponse {
  return {
    buildingId: 1, x: 5, y: 6, visualClass: '9999', templateName: 't', buildingName: 'Helartia Town Hall',
    ownerName: 'SPO_test3', securityId: '', canGovern: true, tabs: [], groups: {}, timestamp: 0,
    ...over,
  } as unknown as BuildingDetailsResponse;
}

describe('BuildingSurface', () => {
  beforeEach(() => {
    useBuildingStore.getState().clearFocus();
    usePoliticsStore.setState({ data: null });
  });

  it('renders the plain inspector for a non-civic building', () => {
    useBuildingStore.getState().setDetails(details({ visualClass: '100' }));
    renderWithProviders(<BuildingSurface />);
    expect(screen.getByText('INSPECTOR with-header')).toBeTruthy();
  });

  it('draws the civic header (Mayor) and the header-less inspector for a Town Hall', () => {
    useBuildingStore.getState().setDetails(details({}));
    usePoliticsStore.setState({ data: { mayorName: 'SPO_test3' } as never });
    renderWithProviders(<BuildingSurface />);
    expect(screen.getByRole('heading', { name: 'Helartia Town Hall' })).toBeTruthy();
    expect(screen.getByText('Mayor: SPO_test3')).toBeTruthy();
    expect(screen.getByText('INSPECTOR no-header')).toBeTruthy();
  });

  it('says President for the Capitol and refreshes through the client', () => {
    useBuildingStore.getState().setDetails(details({ buildingName: 'Capitol', tabs: [{ id: 'capitol' }] as never, groups: { g: [{ name: 'ActualRuler', value: 'Crazz' }] } as never }));
    const onRefreshBuilding = jest.fn();
    renderWithProviders(<BuildingSurface />, { clientCallbacks: createSpiedCallbacks({ onRefreshBuilding }) });
    expect(screen.getByText('President: Crazz')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefreshBuilding).toHaveBeenCalledWith(5, 6);
  });

  it('falls back to the focused building name while details load', () => {
    useBuildingStore.getState().setFocus({ buildingName: 'Town Hall', visualClass: '9999', x: 1, y: 2 } as never);
    renderWithProviders(<BuildingSurface />);
    expect(screen.getByRole('heading', { name: 'Town Hall' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers "Write to the Mayor" for a Town Hall and opens compose addressed to mayor@<Town>.gov', () => {
    useBuildingStore.getState().setDetails(details({ groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }] } as never }));
    renderWithProviders(<BuildingSurface />);

    fireEvent.click(screen.getByRole('button', { name: 'Write to the Mayor of Helartia' }));

    expect(useMailStore.getState().composeTo).toBe('mayor@Helartia.gov');
    expect(useMailStore.getState().currentView).toBe('compose');
    expect(useUiStore.getState().rightPanel).toBe('mail');
  });

  it('offers no mayor write action for the Capitol', () => {
    useBuildingStore.getState().setDetails(details({
      buildingName: 'Capitol',
      tabs: [{ id: 'capitol' }] as never,
      groups: { g: [{ name: 'ActualRuler', value: 'Crazz' }], townGeneral: [{ name: 'Town', value: 'Helartia' }] } as never,
    }));
    renderWithProviders(<BuildingSurface />);
    expect(screen.queryByRole('button', { name: /Write to the Mayor/ })).toBeNull();
  });

  it('offers no mayor write action when the Town property has not been read yet', () => {
    useBuildingStore.getState().setDetails(details({ groups: {} }));
    renderWithProviders(<BuildingSurface />);
    expect(screen.queryByRole('button', { name: /Write to the Mayor/ })).toBeNull();
  });

  it('disables Refresh while the shared refresh action is in flight, and re-enables once it clears', () => {
    useBuildingStore.getState().setDetails(details({}));
    renderWithProviders(<BuildingSurface />);
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);

    act(() => useBuildingStore.getState().addInFlightAction('refreshBuilding'));
    expect((screen.getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true);

    act(() => useBuildingStore.getState().removeInFlightAction('refreshBuilding'));
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
