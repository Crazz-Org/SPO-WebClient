/**
 * The two trade controls on a facility sheet (issue 551).
 *
 * `TradeRole`/`Role` and `TradeLevel` were hidden rows: the gateway could emit
 * `RDOSetRole` and `RDOSetTradeLevel`, the catalogue knew both, and nothing in
 * the UI could reach either. These tests pin the shape the reference client
 * offered — the mode combo only for the three roles it can express, the level
 * combo always, with three items that never include 1 — and that the arguments
 * that reach the client callback are those legal values and nothing else.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

/** Its own visual class: `registerInspectorTabs` caches per class. */
const IND_CLASS = '551';
const WH_CLASS = '5511';

const IND_TABS: BuildingDetailsTab[] = [
  { id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
];
const WH_TABS: BuildingDetailsTab[] = [
  { id: 'whGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'WHGeneral' },
];

/**
 * Seed through `setDetails`, not `setState`: that action is what registers the
 * template for the visual class. A bare `setState` leaves GENERIC_TEMPLATE,
 * which carries no trade settings at all.
 */
function seed(options: {
  tabs?: BuildingDetailsTab[];
  visualClass?: string;
  currentTab?: string;
  isOwner?: boolean;
}): void {
  const {
    tabs = IND_TABS, visualClass = IND_CLASS,
    currentTab = 'indGeneral', isOwner = true,
  } = options;
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-551',
    x: 100, y: 200,
    visualClass,
    templateName: 'Factory',
    buildingName: 'Small Farm',
    ownerName: 'Bob - Green',
    securityId: 'sec-1',
    canGovern: false,
    tabs,
    groups: { [currentTab]: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab, isOwner });
}

function props(over: Record<string, string>): BuildingPropertyValue[] {
  const base: Record<string, string> = {
    Creator: 'Bob', Cost: '250000', ROI: '14%', ...over,
  };
  return Object.entries(base).map(([name, value]) => ({ name, value })) as BuildingPropertyValue[];
}

function optionValues(select: HTMLElement): string[] {
  return Array.from((select as HTMLSelectElement).options).map(o => o.value);
}

describe('trade mode control', () => {
  beforeEach(resetStores);

  it('offers exactly the three roles cbMode carried, and sends the chosen one', () => {
    seed({});
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={props({ TradeRole: '5', TradeLevel: '2' })} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    const select = screen.getByRole('combobox', { name: 'Trade mode' });
    expect(optionValues(select)).toEqual(['2', '5', '6']);
    expect((select as HTMLSelectElement).value).toBe('5');

    fireEvent.change(select, { target: { value: '6' } });
    expect(onSetBuildingProperty).toHaveBeenCalledWith(100, 200, 'RDOSetRole', '6');
  });

  /** 1 is rolProducer: Voyager hides the combo, so there is no row at all. */
  it('renders no row for a role the combo cannot express', () => {
    seed({});
    renderWithProviders(
      <PropertyGroup properties={props({ TradeRole: '1', TradeLevel: '2' })} buildingX={100} buildingY={200} />,
    );

    expect(screen.queryByRole('combobox', { name: 'Trade mode' })).toBeNull();
    expect(screen.queryByText('Trade mode')).toBeNull();
    // and the raw value does not fall through to an unmatched row either
    expect(screen.queryByText('TradeRole')).toBeNull();
  });

  /** The warehouse sheet spells the same value `Role`; it writes RDOSetRole too. */
  it('renders from the warehouse sheet alias `Role`', () => {
    seed({ tabs: WH_TABS, visualClass: WH_CLASS, currentTab: 'whGeneral' });
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={props({ Role: '2', TradeLevel: '2' })} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    const select = screen.getByRole('combobox', { name: 'Trade mode' });
    expect(optionValues(select)).toEqual(['2', '5', '6']);

    fireEvent.change(select, { target: { value: '5' } });
    expect(onSetBuildingProperty).toHaveBeenCalledWith(100, 200, 'RDOSetRole', '5');
  });
});

describe('trade level control', () => {
  beforeEach(resetStores);

  it('offers 0/2/3 with the owner on item 0, and never a 1', () => {
    seed({});
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={props({ TradeRole: '5', TradeLevel: '2' })} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    const select = screen.getByRole('combobox', { name: 'Trade level' }) as HTMLSelectElement;
    expect(optionValues(select)).toEqual(['0', '2', '3']);
    expect(optionValues(select)).not.toContain('1');
    expect(select.options[0].textContent).toContain('Bob');

    fireEvent.change(select, { target: { value: '3' } });
    expect(onSetBuildingProperty).toHaveBeenCalledWith(100, 200, 'RDOSetTradeLevel', '3');
  });

  /** tlvPupil has no item of its own — Voyager selects item 0 for it. */
  it('shows a stored 1 as item 0', () => {
    seed({});
    renderWithProviders(
      <PropertyGroup properties={props({ TradeRole: '5', TradeLevel: '1' })} buildingX={100} buildingY={200} />,
    );

    const select = screen.getByRole('combobox', { name: 'Trade level' }) as HTMLSelectElement;
    expect(select.value).toBe('0');
  });
});

describe('a visitor', () => {
  beforeEach(resetStores);

  it('reads both settings as text, with no control', () => {
    seed({ isOwner: false });
    renderWithProviders(
      <PropertyGroup properties={props({ TradeRole: '5', TradeLevel: '3' })} buildingX={100} buildingY={200} />,
    );

    expect(screen.queryByRole('combobox', { name: 'Trade mode' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Trade level' })).toBeNull();
    expect(screen.getByText('Exporter')).toBeTruthy();
    expect(screen.getByText('Anyone')).toBeTruthy();
  });
});
