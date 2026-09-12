/**
 * Warehouse gate on the Quick Trade buttons (issue 562).
 *
 * Voyager's IndustryGeneralSheet disables the two warehouse buttons when the
 * facility's own `Role` is 'Warehouse', unless its `TradeRole` is one of the
 * non-warehouse roles (IndustryGeneralSheet.pas:143,191-197,233-234).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { TradeConnectButtons } from '../PropertyActions';
import { PropertyType, IND_GENERAL_GROUP } from '@/shared/building-details';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const IND_CLASS = '562';

const IND_TABS: BuildingDetailsTab[] = [
  { id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
];

function seed(): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-562',
    x: 100, y: 200,
    visualClass: IND_CLASS,
    templateName: 'Factory',
    buildingName: 'Small Farm',
    ownerName: 'Bob - Green',
    securityId: 'sec-1',
    canGovern: false,
    tabs: IND_TABS,
    groups: { indGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'indGeneral', isOwner: true });
}

function props(over: Record<string, string>): BuildingPropertyValue[] {
  return Object.entries(over).map(([name, value]) => ({ name, value })) as BuildingPropertyValue[];
}

describe('TradeConnectButtons warehouse gate', () => {
  it('disables both warehouse buttons and emits nothing when the facility is a warehouse', () => {
    const onAction = jest.fn();
    renderWithProviders(
      <TradeConnectButtons properties={props({ Role: 'Warehouse' })} onAction={onAction} />,
    );

    const warehouseButtons = screen.getAllByRole('button', { name: 'Warehouses' });
    expect(warehouseButtons).toHaveLength(2);
    for (const btn of warehouseButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(btn);
    }
    expect(onAction).not.toHaveBeenCalled();

    const others = [
      ...screen.getAllByRole('button', { name: 'Stores' }),
      ...screen.getAllByRole('button', { name: 'Factories' }),
    ];
    expect(others).toHaveLength(4);
    for (const btn of others) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('leaves all six enabled on a non-warehouse facility', () => {
    const onAction = jest.fn();
    renderWithProviders(
      <TradeConnectButtons properties={props({ Role: 'Industry' })} onAction={onAction} />,
    );

    const allButtons = [
      ...screen.getAllByRole('button', { name: 'Stores' }),
      ...screen.getAllByRole('button', { name: 'Factories' }),
      ...screen.getAllByRole('button', { name: 'Warehouses' }),
    ];
    expect(allButtons).toHaveLength(6);
    for (const btn of allButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }

    fireEvent.click(screen.getAllByRole('button', { name: 'Warehouses' })[0]);
    expect(onAction).toHaveBeenCalledWith('tradeConnect:1');
  });

  it('leaves all six enabled when Role is absent entirely', () => {
    renderWithProviders(
      <TradeConnectButtons properties={props({})} onAction={jest.fn()} />,
    );

    for (const btn of screen.getAllByRole('button')) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('re-enables the warehouse buttons when TradeRole is a non-warehouse role', () => {
    renderWithProviders(
      <TradeConnectButtons properties={props({ Role: 'Warehouse', TradeRole: '1' })} onAction={jest.fn()} />,
    );

    for (const btn of screen.getAllByRole('button')) {
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('PropertyGroup warehouse gate integration', () => {
  beforeEach(resetStores);

  it('hides the Role row and disables the warehouse buttons', () => {
    seed();
    renderWithProviders(
      <PropertyGroup
        properties={props({ Role: 'Warehouse', TradeRole: '5', TradeLevel: '2' })}
        buildingX={100}
        buildingY={200}
      />,
    );

    expect(screen.queryByText('Role')).toBeNull();
    for (const btn of screen.getAllByRole('button', { name: 'Warehouses' })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('IND_GENERAL_GROUP template', () => {
  it('declares Role as a TEXT property and maps no RDO command for it', () => {
    const roleDef = IND_GENERAL_GROUP.properties.find((p) => p.rdoName === 'Role');
    expect(roleDef).toBeDefined();
    expect(roleDef?.type).toBe(PropertyType.TEXT);
    expect(IND_GENERAL_GROUP.rdoCommands?.Role).toBeUndefined();
  });
});
