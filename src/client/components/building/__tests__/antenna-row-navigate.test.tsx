/**
 * Activating an antenna row (double-click or Enter) centres the map on that antenna's tile.
 * A table without coordinate columns (loans, services, ministries) stays inert.
 *
 * Reference client: `Voyager/AntennasSheet.pas:272-282` (`lvAntennasDblClick`) reads
 * `Info.X`/`Info.Y` off the selected row and issues
 * `?frame_Id=MapIsoView&frame_Action=MoveTo&x=…&y=…`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { DataTable } from '../PropertyTables';
import { PropertyGroup } from '../PropertyGroup';
import { ANTENNAS_GROUP, BANK_LOANS_GROUP } from '@/shared/building-details';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

const antennaDef = ANTENNAS_GROUP.properties[0];
const loansDef = BANK_LOANS_GROUP.properties[0];

function antennaValueMap(): Map<string, string> {
  return new Map([
    ['antName0', 'Tower One'],
    ['antTown0', 'Helartia'],
    ['antViewers0', '1000'],
    ['antActive0', '#-1'],
    ['antX0', '120'],
    ['antY0', '340'],
    ['antName1', 'Tower Two'],
    ['antTown1', 'Helartia'],
    ['antViewers1', '500'],
    ['antActive1', '#0'],
    ['antX1', '41'],
    ['antY1', '220'],
  ]);
}

describe('DataTable — antenna row navigation', () => {
  it('double-click on antenna row i calls the centring action with that row\'s antX/antY', () => {
    const spy = jest.fn();
    renderWithProviders(
      (
        <DataTable
          def={antennaDef}
          rowCount={2}
          valueMap={antennaValueMap()}
          canEdit={false}
          onPropertyChange={() => { /* not under test */ }}
          onRowNavigate={spy}
        />
      ),
    );

    const rows = document.querySelectorAll('tbody tr');
    fireEvent.doubleClick(rows[1]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(41, 220);
  });

  it('Enter on a focused antenna row calls the centring action', () => {
    const spy = jest.fn();
    renderWithProviders(
      (
        <DataTable
          def={antennaDef}
          rowCount={2}
          valueMap={antennaValueMap()}
          canEdit={false}
          onPropertyChange={() => { /* not under test */ }}
          onRowNavigate={spy}
        />
      ),
    );

    const row0 = document.querySelectorAll('tbody tr')[0] as HTMLElement;
    expect(row0.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(row0, { key: 'Enter' });

    expect(spy).toHaveBeenCalledWith(120, 340);
  });

  it('a key other than Enter does nothing', () => {
    const spy = jest.fn();
    renderWithProviders(
      (
        <DataTable
          def={antennaDef}
          rowCount={2}
          valueMap={antennaValueMap()}
          canEdit={false}
          onPropertyChange={() => { /* not under test */ }}
          onRowNavigate={spy}
        />
      ),
    );

    const row0 = document.querySelectorAll('tbody tr')[0] as HTMLElement;
    fireEvent.keyDown(row0, { key: 'Delete' });

    expect(spy).not.toHaveBeenCalled();
  });

  it('a row whose antX is missing stays inert', () => {
    const spy = jest.fn();
    const valueMap = antennaValueMap();
    valueMap.delete('antX1');
    renderWithProviders(
      (
        <DataTable
          def={antennaDef}
          rowCount={2}
          valueMap={valueMap}
          canEdit={false}
          onPropertyChange={() => { /* not under test */ }}
          onRowNavigate={spy}
        />
      ),
    );

    const row1 = document.querySelectorAll('tbody tr')[1] as HTMLElement;
    fireEvent.doubleClick(row1);

    expect(spy).not.toHaveBeenCalled();
  });

  it('a table without coordinate columns fires nothing', () => {
    const spy = jest.fn();
    const valueMap = new Map([
      ['Debtor0', 'Someone'],
      ['Amount0', '1000'],
      ['Interest0', '5'],
      ['Term0', '12'],
    ]);
    renderWithProviders(
      (
        <DataTable
          def={loansDef}
          rowCount={1}
          valueMap={valueMap}
          canEdit={false}
          onPropertyChange={() => { /* not under test */ }}
          onRowNavigate={spy}
        />
      ),
    );

    const row0 = document.querySelectorAll('tbody tr')[0] as HTMLElement;
    expect(row0.getAttribute('tabindex')).toBeNull();
    fireEvent.doubleClick(row0);
    fireEvent.keyDown(row0, { key: 'Enter' });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('PropertyGroup — antenna tab wiring', () => {
  beforeEach(() => {
    resetStores();
  });

  it('double-clicking the rendered row navigates through onNavigateToBuilding', () => {
    const details: BuildingDetailsResponse = {
      buildingId: 'bld-tv',
      x: 100,
      y: 200,
      visualClass: '5100',
      templateName: 'TVStation',
      buildingName: 'TV Station',
      ownerName: 'TestCo',
      securityId: 'sec-1',
      canGovern: false,
      tabs: [{ id: 'antennas', name: 'ANTENNAS', order: 0, icon: 'A', handlerName: 'Antennas' }],
      groups: { antennas: [] },
      timestamp: Date.now(),
    };
    useBuildingStore.getState().setDetails(details);
    useBuildingStore.setState({ currentTab: 'antennas', isLoading: false });

    const antennaProps: BuildingPropertyValue[] = [
      { name: 'antCount', value: '1' },
      { name: 'antName0', value: 'Tower One' },
      { name: 'antTown0', value: 'Helartia' },
      { name: 'antViewers0', value: '1000' },
      { name: 'antActive0', value: '#-1' },
      { name: 'antX0', value: '120' },
      { name: 'antY0', value: '340' },
    ] as BuildingPropertyValue[];

    const onNavigateToBuilding = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={antennaProps} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) },
    );

    const row = document.querySelector('tbody tr') as HTMLElement;
    fireEvent.doubleClick(row);

    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
  });
});
