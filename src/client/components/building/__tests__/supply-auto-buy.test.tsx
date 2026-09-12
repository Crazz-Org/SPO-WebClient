/**
 * The automatic-buying checkbox on an input gate.
 *
 * Reference client: `cbAlmBuy.Visible := ((i=2) or (i=5) or (i=6)) and
 * fHandler.fOwnsFac` (`Voyager/SupplySheetForm.pas:359`, with `i` the facility's
 * `tidTradeRole`, `:349`); the box is seeded from the gate's own `tidSelected`
 * (`:996-998`); a click forks `RDOSelSelected` with the new state (`:1100` →
 * `:697-699`) and runs `BuySet` (`:1123-1139`), which hides the sliders panel,
 * the supplier list and the value/cost labels.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { SuppliesPanel } from '../SuppliesGroup';
import type { BuildingSupplyData, BuildingConnectionData, BuildingDetailsResponse } from '@/shared/types';

const X = 10;
const Y = 20;

const conn = (facilityName: string): BuildingConnectionData => ({
  facilityName, companyName: 'Yellow Inc.', createdBy: 'SPO_test3', price: '100',
  overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
  x: 40, y: 50,
});

const makeSupply = (overrides: Partial<BuildingSupplyData>): BuildingSupplyData => ({
  path: 'in/Cotton', name: 'Cotton', metaFluid: 'Cotton', fluidValue: '1200',
  maxPrice: '200', minK: '0', connectionCount: 1, connections: [conn('Farm A')],
  ...overrides,
});

/**
 * The facility's role, where the panel reads it: the first property group of
 * the opening read. `Role` is the warehouse template's name for the same value.
 */
function seedRole(role: string | undefined, key: 'TradeRole' | 'Role' = 'TradeRole'): void {
  useBuildingStore.setState({
    details: {
      buildingId: 'bld-1',
      x: X,
      y: Y,
      visualClass: '4722',
      templateName: 'IndGeneral',
      buildingName: 'Cotton Mill',
      ownerName: 'TestCo',
      securityId: 'sec-1',
      canGovern: true,
      tabs: [],
      groups: { indGeneral: role === undefined ? [] : [{ name: key, value: role }] },
      timestamp: 0,
    } as unknown as BuildingDetailsResponse,
  });
}

/** Render an opened gate, with the write callback spied. */
function openGate(supply: BuildingSupplyData, canEdit = true) {
  const onSetBuildingProperty = jest.fn();
  const result = renderWithProviders(
    <SuppliesPanel supplies={[supply]} canEdit={canEdit} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
  );
  fireEvent.click(screen.getByRole('button', { name: /Cotton/ }));
  return { ...result, onSetBuildingProperty };
}

function checkbox(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: 'Automatic buying' }) as HTMLInputElement;
}

beforeEach(() => resetStores());

describe('the state the gate opens with', () => {
  it.each(['2', '5', '6'])('role %s, owner, Selected 1 — checked', (role) => {
    seedRole(role);
    openGate(makeSupply({ selected: '1' }));

    expect(checkbox().checked).toBe(true);
  });

  it.each(['2', '5', '6'])('role %s, owner, Selected 0 — present and unchecked', (role) => {
    seedRole(role);
    openGate(makeSupply({ selected: '0' }));

    expect(checkbox().checked).toBe(false);
  });

  it('reads the warehouse template’s `Role` property too', () => {
    seedRole('5', 'Role');
    openGate(makeSupply({ selected: '1' }));

    expect(checkbox().checked).toBe(true);
  });

  it('follows a Selected the server sends after the card has already rendered', () => {
    // The gate header is read when the gate is opened, so the first render of an
    // opened card can predate the value.
    seedRole('2');
    const { rerender } = openGate(makeSupply({ selected: '1' }));
    expect(checkbox().checked).toBe(true);

    rerender(
      <SuppliesPanel
        supplies={[makeSupply({ selected: '0' })]}
        canEdit
        buildingX={X}
        buildingY={Y}
      />,
    );

    expect(checkbox().checked).toBe(false);
  });

  it('a gate being re-listed drops to no Selected without moving the box', () => {
    seedRole('2');
    const { rerender } = openGate(makeSupply({ selected: '0' }));

    rerender(
      <SuppliesPanel
        supplies={[makeSupply({ selected: undefined })]}
        canEdit
        buildingX={X}
        buildingY={Y}
      />,
    );

    // The control is gone with the value it showed, and nothing defaulted.
    expect(screen.queryByRole('checkbox', { name: 'Automatic buying' })).toBeNull();
  });
});

describe('clicking the box', () => {
  it('sends RDOSelSelected 0 on uncheck and 1 on re-check, once per click', () => {
    seedRole('2');
    const { onSetBuildingProperty } = openGate(makeSupply({ selected: '1' }));

    fireEvent.click(checkbox());
    expect(onSetBuildingProperty).toHaveBeenCalledTimes(1);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      X, Y, 'RDOSelSelected', '0', { fluidId: 'Cotton' },
    );

    fireEvent.click(checkbox());
    expect(onSetBuildingProperty).toHaveBeenCalledTimes(2);
    expect(onSetBuildingProperty).toHaveBeenLastCalledWith(
      X, Y, 'RDOSelSelected', '1', { fluidId: 'Cotton' },
    );
  });

  it('the box moves at once, before any re-read', () => {
    seedRole('6');
    openGate(makeSupply({ selected: '1' }));

    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(false);
  });
});

describe('what unchecking hides — Voyager BuySet', () => {
  it('hides the sliders and the supplier table, and rechecking restores them', () => {
    seedRole('2');
    openGate(makeSupply({ selected: '1' }));

    expect(screen.getByText('Max Price')).toBeTruthy();
    expect(screen.getByText('Min Quality')).toBeTruthy();
    expect(screen.queryByRole('table')).not.toBeNull();

    fireEvent.click(checkbox());

    expect(screen.queryByText('Max Price')).toBeNull();
    expect(screen.queryByText('Min Quality')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // The checkbox itself stays, or there would be no way back.
    expect(checkbox().checked).toBe(false);

    fireEvent.click(checkbox());

    expect(screen.getByText('Max Price')).toBeTruthy();
    expect(screen.queryByRole('table')).not.toBeNull();
  });

  it('hides the value and cost labels too', () => {
    seedRole('5');
    openGate(makeSupply({ selected: '1', lastCostPerc: '85' }));

    expect(screen.getByText(/Last Value/)).toBeTruthy();

    fireEvent.click(checkbox());

    expect(screen.queryByText(/Last Value/)).toBeNull();
    expect(screen.queryByText(/Cost:/)).toBeNull();
  });
});

describe('gates that are offered no control at all', () => {
  /** No checkbox, and the gate renders exactly as it did before. */
  function expectAbsentAndIntact(): void {
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeNull();
  }

  it('a visitor who does not own the facility', () => {
    seedRole('2');
    openGate(makeSupply({ selected: '1' }), false);
    expect(screen.queryByRole('checkbox')).toBeNull();
    // A visitor never had the sliders either; the table is still there.
    expect(screen.queryByRole('table')).not.toBeNull();
  });

  it.each(['0', '1', '3', '4'])('role %s — not one of the three', (role) => {
    seedRole(role);
    openGate(makeSupply({ selected: '1' }));
    expectAbsentAndIntact();
  });

  it('no TradeRole in the groups at all', () => {
    seedRole(undefined);
    openGate(makeSupply({ selected: '1' }));
    expectAbsentAndIntact();
  });

  it('no details loaded yet', () => {
    openGate(makeSupply({ selected: '1' }));
    expectAbsentAndIntact();
  });

  it('a gate whose Selected has not been read', () => {
    seedRole('2');
    openGate(makeSupply({ selected: undefined }));
    expectAbsentAndIntact();
  });

  it('a gate read that yielded no fluid id to address the write with', () => {
    seedRole('2');
    openGate(makeSupply({ metaFluid: '', selected: '1' }));
    expectAbsentAndIntact();
  });
});
