/**
 * The UPGRADE_ACTIONS control must actually render (B5, PR #79).
 *
 * 'UpgradeActions' sits on HIDDEN_PROPERTY_NAMES to hide the raw server VALUE,
 * but the rdoName-based filter also swallowed the CONTROL of the same name —
 * so the Upgrade / Downgrade / Stop buttons were unreachable from the UI on
 * every building, and the B5 downgrade confirmation had no entry point.
 * These tests pin the exception: the control renders, its widget-owned values
 * do not repeat as rows, and the per-level cost does (the widget shows only the
 * total for the chosen count — see upgrade-confirm.test.tsx).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

const upgradeProps: BuildingPropertyValue[] = [
  { name: 'UpgradeLevel', value: '3' },
  { name: 'MaxUpgrade', value: '10' },
  { name: 'NextUpgCost', value: '50000' },
  { name: 'Upgrading', value: '0' },
  { name: 'Pending', value: '0' },
  { name: 'UpgradeActions', value: '' },
] as BuildingPropertyValue[];

function seedUpgradeTab(): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-1',
    x: 100, y: 200,
    visualClass: '0',
    templateName: 'Generic',
    buildingName: 'Factory',
    ownerName: 'TestCo',
    securityId: 'sec-1',
    canGovern: false,
    tabs: [{ id: 'upgrade', name: 'UPGRADE', order: 0, icon: 'U', handlerName: 'facManagement' }],
    groups: { upgrade: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.setState({ details, isLoading: false, currentTab: 'upgrade', isOwner: true });
}

describe('upgrade actions are reachable again', () => {
  beforeEach(() => {
    resetStores();
    seedUpgradeTab();
  });

  it('renders the Downgrade button for an owner with a level to lose', () => {
    renderWithProviders(<PropertyGroup properties={upgradeProps} buildingX={100} buildingY={200} />);
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy();
    // The widget states the level; no duplicate plain rows for what it owns
    expect(screen.queryByText('Current Level')).toBeNull();
    expect(screen.queryByText('Max Level')).toBeNull();
    // The per-level cost still has its row; the control shows only the total
    expect(screen.getByText('Upgrade Cost')).toBeTruthy();
  });

  it('Downgrade reaches the client callback (which asks for confirmation)', () => {
    const onUpgradeBuilding = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={upgradeProps} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onUpgradeBuilding }) },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Downgrade' }));
    expect(onUpgradeBuilding).toHaveBeenCalledWith(100, 200, 'DOWNGRADE');
  });

  it('a visitor (not owner) gets the level line but no buttons', () => {
    useBuildingStore.setState({ isOwner: false });
    renderWithProviders(<PropertyGroup properties={upgradeProps} buildingX={100} buildingY={200} />);
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });

  it('the raw UpgradeActions value never prints as a row', () => {
    const { container } = renderWithProviders(
      <PropertyGroup properties={upgradeProps} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).not.toContain('UpgradeActions');
  });
});
