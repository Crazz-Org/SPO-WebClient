/**
 * B6 — every write says what it is doing, where it happened.
 *
 * The SaveIndicator already served the property inputs, the workforce table and the civic
 * tabs. These tests pin the three that had nothing: the supplier sliders, the connection
 * actions of a gate, and the rename. Each drives the store the way the write path does
 * (pending → confirmed / failed) and asserts what the panel says.
 *
 * That every write site renders an indicator bound to its own key is now enforced from
 * source by `save-indicator-coverage.test.ts`; this file pins the behaviour of chosen sites.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { SuppliesPanel } from '../SuppliesGroup';
import { CompInputsPanel } from '../InputsGroup';
import { ProductsPanel } from '../ProductsGroup';
import { useBuildingStore } from '../../../store/building-store';
import { connectionPendingKey } from '../../../handlers/connection-pending-key';
import type { BuildingSupplyData, BuildingProductData, BuildingConnectionData, CompInputData } from '@/shared/types';

const X = 10;
const Y = 20;

const supply: BuildingSupplyData = {
  path: 'in/Cotton', name: 'Cotton', metaFluid: 'Cotton', fluidValue: '1200',
  maxPrice: '120', minK: '40', connectionCount: 0, connections: [],
};

const product: BuildingProductData = {
  path: 'out/Fabric', name: 'Fabric', metaFluid: 'Fabric', quality: '80', pricePc: '100',
  avgPrice: '50', marketPrice: '60', lastFluid: '', connectionCount: 0, connections: [],
};

/** Open the gate: every control below the header appears only once it is expanded. */
function expandGate(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
}

describe('the supplier sliders say they are saving', () => {
  beforeEach(() => resetStores());

  it('Max Price and Min Quality each carry their own indicator', () => {
    renderWithProviders(<SuppliesPanel supplies={[supply]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().setPending('RDOSetInputMaxPrice:{"fluidId":"Cotton"}', '150'));
    expect(screen.getAllByText('Saving…').length).toBe(1);
    act(() => {
      useBuildingStore.getState().confirmPending('RDOSetInputMaxPrice:{"fluidId":"Cotton"}', 'confirmed');
      useBuildingStore.getState().setPending('RDOSetInputMinK:{"fluidId":"Cotton"}', '60');
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('a refused slider write is said in words, not swallowed', () => {
    renderWithProviders(<SuppliesPanel supplies={[supply]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().failPending(
      'RDOSetInputMinK:{"fluidId":"Cotton"}', '60', 'Server rejected the change',
    ));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed');
    expect(alert.textContent).toContain('Server rejected the change');
  });
});

describe('a connection change says so on its own gate', () => {
  beforeEach(() => resetStores());

  it('the supply gate watches connect and disconnect', () => {
    renderWithProviders(<SuppliesPanel supplies={[supply]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().setPending(connectionPendingKey('RDODisconnectInput', 'Cotton'), '0'));
    expect(screen.getByText('Saving…')).toBeTruthy();
    act(() => useBuildingStore.getState().confirmPending(connectionPendingKey('RDODisconnectInput', 'Cotton'), 'confirmed'));
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('the product gate watches its own direction, and its price slider', () => {
    renderWithProviders(<ProductsPanel products={[product]} canEdit buildingX={X} buildingY={Y} onPropertyChange={() => undefined} />);
    expandGate('Fabric');
    act(() => useBuildingStore.getState().setPending(connectionPendingKey('RDOConnectOutput', 'Fabric'), '0'));
    expect(screen.getByText('Saving…')).toBeTruthy();
    act(() => {
      useBuildingStore.getState().confirmPending(connectionPendingKey('RDOConnectOutput', 'Fabric'), 'confirmed');
      useBuildingStore.getState().setPending('PricePc:{"fluidId":"Fabric"}', '110');
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('a gate does not answer for the gate next door', () => {
    renderWithProviders(<SuppliesPanel supplies={[supply]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().setPending(connectionPendingKey('RDODisconnectInput', 'Wool'), '0'));
    expect(screen.queryByText('Saving…')).toBeNull();
  });
});

describe('the sort, overpayment and demand writes say they are saving', () => {
  beforeEach(() => resetStores());

  const row: BuildingConnectionData = {
    facilityName: 'Farm A', companyName: 'Yellow Inc.', createdBy: 'SPO_test3', price: '100',
    overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
    x: 40, y: 50,
  };
  const sortable: BuildingSupplyData = {
    ...supply, qpSorted: '1', sortMode: '0', connectionCount: 1, connections: [row],
  };

  it('the sort write shows one indicator, on the active column', () => {
    renderWithProviders(<SuppliesPanel supplies={[sortable]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().setPending('RDOSetInputSortMode:{"fluidId":"Cotton"}', '1'));
    expect(screen.getAllByText('Saving…').length).toBe(1);
    act(() => useBuildingStore.getState().confirmPending('RDOSetInputSortMode:{"fluidId":"Cotton"}', 'confirmed'));
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('the overpayment write shows on its own row only', () => {
    renderWithProviders(<SuppliesPanel supplies={[sortable]} canEdit buildingX={X} buildingY={Y} />);
    expandGate('Cotton');
    act(() => useBuildingStore.getState().setPending('RDOSetInputOverPrice:{"fluidId":"Cotton","index":"1"}', '20'));
    expect(screen.queryByText('Saving…')).toBeNull();
    act(() => useBuildingStore.getState().setPending('RDOSetInputOverPrice:{"fluidId":"Cotton","index":"0"}', '20'));
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('the company input demand write shows its indicator', () => {
    const input: CompInputData = {
      name: 'Computer Services', supplied: 50, demanded: 100, ratio: 75, maxDemand: 200,
      editable: true, units: 'units',
    };
    renderWithProviders(<CompInputsPanel compInputs={[input]} canEdit buildingX={X} buildingY={Y} />);
    act(() => useBuildingStore.getState().setPending('RDOSetCompanyInputDemand:{"index":"0"}', '50'));
    expect(screen.getByText('Saving…')).toBeTruthy();
  });
});
