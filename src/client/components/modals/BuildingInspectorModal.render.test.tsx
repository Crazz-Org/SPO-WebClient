/**
 * Smoke tests for BuildingInspectorModal — verifies it renders without crashing.
 *
 * Complements the existing BuildingInspectorModal.test.ts (store-only tests)
 * by actually rendering the component in jsdom.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, act } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { useUiStore } from '../../store/ui-store';
import { BuildingInspectorModal } from './BuildingInspectorModal';
import type { BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const mockTabs: BuildingDetailsTab[] = [
  { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'CapGeneral' },
];

const mockDetails: BuildingDetailsResponse = {
  buildingId: 'capitol-1',
  x: 510,
  y: 420,
  visualClass: '900',
  templateName: 'CapGeneral',
  buildingName: 'National Capitol',
  ownerName: 'Government',
  securityId: 'sec-gov',
  canGovern: true,
  tabs: mockTabs,
  groups: {
    general: [{ name: 'Status', value: 'Active' }],
  },
  timestamp: Date.now(),
};

describe('BuildingInspectorModal smoke tests', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders nothing when modal is not buildingInspector', () => {
    const { container } = renderWithProviders(<BuildingInspectorModal />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal with building name when open', () => {
    useUiStore.getState().openModal('buildingInspector');
    useBuildingStore.setState({ details: mockDetails, isLoading: false });
    useBuildingStore.getState().setFocus({
      buildingId: 'capitol-1',
      buildingName: 'National Capitol',
      ownerName: 'Government',
      salesInfo: '',
      revenue: '',
      detailsText: '',
      hintsText: '',
      x: 510,
      y: 420,
      xsize: 4,
      ysize: 4,
      visualClass: '900',
    });

    renderWithProviders(<BuildingInspectorModal />);
    expect(screen.getByText('National Capitol')).toBeTruthy();
    // ownerName is shown inside the role label (e.g. "Mayor: Government")
    expect(screen.getByText(/Government/)).toBeTruthy();
  });

  it('renders close button with accessible label', () => {
    useUiStore.getState().openModal('buildingInspector');
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    renderWithProviders(<BuildingInspectorModal />);
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('disables Refresh while the shared refresh action is in flight, and re-enables once it clears', () => {
    useUiStore.getState().openModal('buildingInspector');
    useBuildingStore.setState({ details: mockDetails, isLoading: false });

    renderWithProviders(<BuildingInspectorModal />);
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);

    act(() => useBuildingStore.getState().addInFlightAction('refreshBuilding'));
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);

    act(() => useBuildingStore.getState().removeInFlightAction('refreshBuilding'));
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
