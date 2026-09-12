/**
 * A supplier row or a customer row can centre the map on that facility: double-click, a
 * trailing "View on map" button, or Enter on the selected row. A connection the server never
 * positioned (`x`/`y` both 0) offers none of the three.
 *
 * Reference client: `Voyager/SupplySheetForm.pas:1141-1156` (`lvConnectionsDblClick`) and
 * `Voyager/ProdSheetForm.pas:819-832` read `cnxXPos`/`cnxYPos` off the selected row and issue
 * `?frame_Id=MapIsoView&frame_Action=MoveTo&x=…&y=…` on double-click.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { SuppliesPanel } from '../SuppliesGroup';
import { ProductsPanel } from '../ProductsGroup';
import type { BuildingSupplyData, BuildingProductData, BuildingConnectionData } from '@/shared/types';

const X = 10;
const Y = 20;

const conn = (overrides: Partial<BuildingConnectionData> = {}): BuildingConnectionData => ({
  facilityName: 'Farm A', companyName: 'Vito Holdings', createdBy: 'Vito', price: '100',
  overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
  x: 40, y: 50, ...overrides,
});

const makeSupply = (overrides: Partial<BuildingSupplyData> = {}): BuildingSupplyData => ({
  path: 'in/Cotton', name: 'Cotton', metaFluid: 'Cotton', fluidValue: '1200',
  connectionCount: 1, connections: [conn()], ...overrides,
});

const makeProduct = (overrides: Partial<BuildingProductData> = {}): BuildingProductData => ({
  path: 'out/Cotton', name: 'Cotton', metaFluid: 'Cotton', lastFluid: '80', quality: '90',
  pricePc: '110', avgPrice: '105', marketPrice: '5000', connectionCount: 1,
  connections: [conn()], ...overrides,
});

function openSupplyGate(supply: BuildingSupplyData) {
  const onNavigateToBuilding = jest.fn();
  const result = renderWithProviders(
    <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) },
  );
  fireEvent.click(screen.getByRole('button', { name: /Cotton/ }));
  return { ...result, onNavigateToBuilding };
}

function openProductGate(product: BuildingProductData) {
  const onNavigateToBuilding = jest.fn();
  const result = renderWithProviders(
    <ProductsPanel
      products={[product]}
      canEdit={true}
      buildingX={X}
      buildingY={Y}
      onPropertyChange={() => { /* not under test */ }}
    />,
    { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) },
  );
  fireEvent.click(screen.getByRole('button', { name: /Cotton/ }));
  return { ...result, onNavigateToBuilding };
}

const PANELS = [
  { label: 'Supplies', open: openSupplyGate, make: makeSupply, rowClass: 'supplyTableRow' },
  { label: 'Products', open: openProductGate, make: makeProduct, rowClass: 'productTableRow' },
] as const;

describe.each(PANELS)('$label — navigate to a connection', (panel) => {
  beforeEach(() => {
    resetStores();
  });

  it('double-click on the row navigates to that connection', () => {
    const { onNavigateToBuilding } = panel.open(panel.make());

    const row = document.querySelector('tbody tr');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row as Element);

    expect(onNavigateToBuilding).toHaveBeenCalledTimes(1);
    expect(onNavigateToBuilding).toHaveBeenCalledWith(40, 50);
  });

  it('the in-row button navigates without changing selection', () => {
    const { onNavigateToBuilding } = panel.open(panel.make());

    const button = screen.getByRole('button', { name: /View .* on map/ });
    fireEvent.click(button);

    expect(onNavigateToBuilding).toHaveBeenCalledWith(40, 50);
    const row = document.querySelector('tbody tr');
    expect(row?.className).not.toMatch(/(supply|product)TableRowSelected/);
  });

  it('Enter on the selected row navigates', () => {
    const { onNavigateToBuilding } = panel.open(panel.make());

    const row = document.querySelector('tbody tr') as HTMLElement;
    fireEvent.click(row);
    const table = document.querySelector('table') as HTMLElement;
    fireEvent.keyDown(table, { key: 'Enter' });

    expect(onNavigateToBuilding).toHaveBeenCalledWith(40, 50);
  });

  it('a connection at 0,0 offers no navigation', () => {
    const { onNavigateToBuilding } = panel.open(
      panel.make({ connections: [conn({ x: 0, y: 0 })] } as never),
    );

    expect(screen.queryByRole('button', { name: /View .* on map/ })).toBeNull();

    const row = document.querySelector('tbody tr') as HTMLElement;
    fireEvent.doubleClick(row);
    expect(onNavigateToBuilding).not.toHaveBeenCalled();

    fireEvent.click(row);
    const table = document.querySelector('table') as HTMLElement;
    fireEvent.keyDown(table, { key: 'Enter' });
    expect(onNavigateToBuilding).not.toHaveBeenCalled();
  });

  it('Delete on the table does not navigate', () => {
    const { onNavigateToBuilding } = panel.open(panel.make());

    const row = document.querySelector('tbody tr') as HTMLElement;
    fireEvent.click(row);
    const table = document.querySelector('table') as HTMLElement;
    fireEvent.keyDown(table, { key: 'Delete' });

    expect(onNavigateToBuilding).not.toHaveBeenCalled();
  });
});
