/**
 * The upgrade control states what the spend costs, and asks before it goes out.
 *
 * `NextUpgCost` is the price of ONE level; the control multiplies it by the count
 * in the box and shows that total next to OK. OK no longer sends: it raises a
 * confirmation naming the number of levels and the total, and only the dialog's
 * own confirm reaches `onUpgradeBuilding`. Cancelling drops the payload, so
 * nothing is sent. When the unit cost is unknown or zero the total cannot be
 * stated, so the row is not offered at all.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useUiStore } from '../../../store/ui-store';
import { UpgradeActions } from '../PropertyActions';
import { formatCurrency } from '@/shared/building-details';
import type { BuildingPropertyValue } from '@/shared/types';

const UNIT_COST = 50000;

function props(overrides: Record<string, string | undefined> = {}): BuildingPropertyValue[] {
  const base: Record<string, string | undefined> = {
    UpgradeLevel: '3',
    MaxUpgrade: '10',
    NextUpgCost: String(UNIT_COST),
    Upgrading: '0',
    Pending: '0',
    ...overrides,
  };
  return Object.entries(base)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({ name, value: value as string })) as BuildingPropertyValue[];
}

function renderControl(
  overrides: Record<string, string | undefined> = {},
  onUpgradeBuilding?: (...args: unknown[]) => unknown,
) {
  return renderWithProviders(
    <UpgradeActions properties={props(overrides)} canEdit buildingX={100} buildingY={200} />,
    onUpgradeBuilding ? { clientCallbacks: createSpiedCallbacks({ onUpgradeBuilding }) } : undefined,
  );
}

describe('upgrade control — total and confirmation', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ isOwner: true });
  });

  it('shows the total for one level, and follows the count', () => {
    renderControl();
    expect(screen.getByTestId('upgrade-total').textContent).toBe(formatCurrency(UNIT_COST));

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByTestId('upgrade-total').textContent).toBe(formatCurrency(UNIT_COST * 3));
  });

  it('OK asks for confirmation and sends nothing until it resolves', () => {
    const onUpgradeBuilding = jest.fn();
    renderControl({}, onUpgradeBuilding);

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onUpgradeBuilding).not.toHaveBeenCalled();
    const ui = useUiStore.getState();
    expect(ui.modal).toBe('confirm');
    expect(ui.confirmPayload?.message).toContain('3');
    expect(ui.confirmPayload?.message).toContain(formatCurrency(UNIT_COST * 3));
    expect(ui.confirmPayload?.options?.kind).toBe('spend');
    expect(ui.confirmPayload?.options?.rows).toEqual([
      { label: 'Levels', value: '3' },
      { label: 'Total', value: formatCurrency(UNIT_COST * 3), tone: 'gold' },
    ]);

    act(() => { useUiStore.getState().confirmPayload?.onConfirm(); });
    expect(onUpgradeBuilding).toHaveBeenCalledTimes(1);
    expect(onUpgradeBuilding).toHaveBeenCalledWith(100, 200, 'START_UPGRADE', 3);
  });

  it('the message reads singular for a single level', () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(useUiStore.getState().confirmPayload?.message).toContain('1 upgrade level for');
  });

  it('cancelling sends nothing', () => {
    const onUpgradeBuilding = jest.fn();
    renderControl({}, onUpgradeBuilding);

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    act(() => { useUiStore.getState().closeModal(); });

    expect(onUpgradeBuilding).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload).toBeNull();
  });

  it('the control is unavailable when the unit cost is unknown', () => {
    renderControl({ NextUpgCost: undefined });
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.queryByTestId('upgrade-total')).toBeNull();
    // Only the upgrade row goes; the rest of the widget stands.
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy();
  });

  it('the control is unavailable when the unit cost is zero', () => {
    renderControl({ NextUpgCost: '0' });
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy();
  });

  it('the control is unavailable when the unit cost is not a number', () => {
    renderControl({ NextUpgCost: 'n/a' });
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });

  it('the control is unavailable when no level remains', () => {
    renderControl({ UpgradeLevel: '10' });
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy();
  });

  it('the count box clamps typed input, and the - button floors at one', () => {
    renderControl();
    const box = screen.getByRole('spinbutton');
    fireEvent.change(box, { target: { value: '99' } });
    expect(screen.getByTestId('upgrade-total').textContent).toBe(formatCurrency(UNIT_COST * 7));

    fireEvent.change(box, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '-' }));
    fireEvent.click(screen.getByRole('button', { name: '-' }));
    expect(screen.getByTestId('upgrade-total').textContent).toBe(formatCurrency(UNIT_COST));
  });

  it('an upgrade in progress shows STOP instead of the row', () => {
    renderControl({ Upgrading: '1', Pending: '2' });
    expect(screen.getByRole('button', { name: 'STOP' })).toBeTruthy();
    expect(screen.queryByTestId('upgrade-total')).toBeNull();
  });

  it('no Downgrade at level 1', () => {
    renderControl({ UpgradeLevel: '1' });
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull();
  });

  it('Downgrade is offered from level 2', () => {
    renderControl({ UpgradeLevel: '2' });
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeTruthy();
  });

  it('no Downgrade while an upgrade is running, so nothing is sent', () => {
    const onUpgradeBuilding = jest.fn();
    renderControl({ Upgrading: '1', Pending: '2' }, onUpgradeBuilding);
    expect(screen.queryByRole('button', { name: 'Downgrade' })).toBeNull();
    expect(screen.getByRole('button', { name: 'STOP' })).toBeTruthy();
    expect(onUpgradeBuilding).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'DOWNGRADE');
  });
});
