/**
 * Smoke tests for extracted building panel components:
 * CompInputsPanel, ProductsPanel, SuppliesPanel.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { CompInputsPanel } from '../InputsGroup';
import { ProductsPanel } from '../ProductsGroup';
import { SuppliesPanel } from '../SuppliesGroup';
import type { CompInputData, BuildingProductData, BuildingSupplyData, BuildingConnectionData } from '@/shared/types';
import { fireEvent, act } from '@testing-library/react';
import { useBuildingStore, gateKey } from '../../../store/building-store';
import { useUiStore } from '../../../store/ui-store';

/** Disconnecting now asks first (T3, B5): the action lands in the confirm Dialog; confirm it. */
function confirmPendingDialog(): void {
  const s = useUiStore.getState();
  expect(s.modal).toBe('confirm');
  expect(s.confirmPayload?.options?.kind).toBe('destructive');
  s.confirmPayload?.onConfirm();
  s.closeModal();
}

/**
 * Mark a gate's connection rows as already read.
 *
 * The panels load a gate's rows when it is expanded, so an empty `connections`
 * on a gate nobody has read yet means "not read yet", not "none" — the panel
 * says so, and that is a different message from the ones below. These cases are
 * about what a gate reads like AFTER its rows came back, so they say so.
 */
function markGateLoaded(tabId: 'supplies' | 'products', path: string): void {
  useBuildingStore.setState((state) => ({
    gateLoadingStates: { ...state.gateLoadingStates, [gateKey(tabId, path)]: 'loaded' },
  }));
}

// ---------------------------------------------------------------------------
// Test Data Factories
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<BuildingConnectionData> = {}): BuildingConnectionData {
  return {
    facilityName: 'Steel Mill',
    companyName: 'AcmeCorp',
    createdBy: 'Owner',
    price: '120',
    overprice: '10',
    lastValue: '5000',
    cost: '600',
    quality: '85',
    connected: true,
    x: 100,
    y: 200,
    ...overrides,
  };
}

/** Three named rows at distinct coordinates — the multi-selection cases below. */
function threeConnections(): BuildingConnectionData[] {
  return [
    makeConnection({ facilityName: 'A', x: 10, y: 20 }),
    makeConnection({ facilityName: 'B', x: 30, y: 40 }),
    makeConnection({ facilityName: 'C', x: 50, y: 60 }),
  ];
}

function makeCompInput(overrides: Partial<CompInputData> = {}): CompInputData {
  return {
    name: 'Computer Services',
    supplied: 50,
    demanded: 100,
    ratio: 75,
    maxDemand: 200,
    editable: true,
    units: 'units',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<BuildingProductData> = {}): BuildingProductData {
  return {
    path: '/output/chemicals',
    name: 'Chemicals',
    metaFluid: 'fluid_chemicals',
    lastFluid: '1200',
    quality: '90',
    pricePc: '110',
    avgPrice: '105',
    marketPrice: '5000',
    connectionCount: 2,
    connections: [
      makeConnection({ facilityName: 'Pharma Plant', x: 300, y: 400 }),
      makeConnection({ facilityName: 'Lab', x: 500, y: 600 }),
    ],
    ...overrides,
  };
}

function makeSupply(overrides: Partial<BuildingSupplyData> = {}): BuildingSupplyData {
  return {
    path: '/input/steel',
    name: 'Steel',
    metaFluid: 'fluid_steel',
    fluidValue: '800',
    lastCostPerc: '95',
    maxPrice: '200',
    minK: '50',
    connectionCount: 1,
    connections: [makeConnection()],
    ...overrides,
  };
}

// ===========================================================================
// CompInputsPanel
// ===========================================================================

describe('CompInputsPanel', () => {
  beforeEach(resetStores);

  it('renders empty state when no inputs', () => {
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('No company inputs');
  });

  it('renders editable input with demand slider', () => {
    const input = makeCompInput({ editable: true, ratio: 60 });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('COMPUTER SERVICES');
    expect(container.textContent).toContain('Demand');
    const slider = container.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
  });

  it('renders non-editable input with read-only rows', () => {
    const input = makeCompInput({ editable: false, demanded: 80, supplied: 40, ratio: 50 });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Requesting');
    expect(container.textContent).toContain('Receiving');
    expect(container.textContent).toContain('Ratio');
    expect(container.textContent).toContain('50%');
  });

  it('renders multiple inputs', () => {
    const inputs = [
      makeCompInput({ name: 'Advertisement' }),
      makeCompInput({ name: 'Computer Services' }),
      makeCompInput({ name: 'Legal Services' }),
    ];
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={inputs} canEdit={true} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('ADVERTISEMENT');
    expect(container.textContent).toContain('COMPUTER SERVICES');
    expect(container.textContent).toContain('LEGAL SERVICES');
  });

  it('shows supply bar fill percentage', () => {
    const input = makeCompInput({ supplied: 75, demanded: 100, maxDemand: 200 });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    // 75% fill (supplied/demanded)
    expect(container.textContent).toContain('75%');
  });

  it('shows "Demand below capacity" warning when demPct < 100', () => {
    // demanded=50, maxDemand=200 → demPct = 25%
    const input = makeCompInput({ demanded: 50, maxDemand: 200 });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Demand below capacity');
  });

  it('does not show "Demand below capacity" when demPct >= 100', () => {
    const input = makeCompInput({ demanded: 200, maxDemand: 200 });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).not.toContain('Demand below capacity');
  });

  it('shows summary with max capacity when available', () => {
    const input = makeCompInput({ supplied: 30, demanded: 60, maxDemand: 120, units: 'kg' });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Max');
    expect(container.textContent).toContain('kg');
  });

  it('fires RDO command on demand slider change', () => {
    jest.useFakeTimers();
    const onSetBuildingProperty = jest.fn();
    const callbacks = createSpiedCallbacks({ onSetBuildingProperty });
    const input = makeCompInput({ editable: true, ratio: 50 });

    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '80' } });

    // Debounce: not called yet
    expect(onSetBuildingProperty).not.toHaveBeenCalled();

    // Fast-forward past debounce
    jest.advanceTimersByTime(350);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      100, 200, 'RDOSetCompanyInputDemand', '80', { index: '0' },
    );

    jest.useRealTimers();
  });

  it('disables slider when canEdit is false', () => {
    const input = makeCompInput({ editable: true });
    const { container } = renderWithProviders(
      <CompInputsPanel compInputs={[input]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });
});

// ===========================================================================
// ProductsPanel
// ===========================================================================

describe('ProductsPanel', () => {
  beforeEach(resetStores);

  it('renders empty state when no products', () => {
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('No product outputs');
  });

  it('renders product card with name and buyer count', () => {
    const product = makeProduct({ name: 'Clothing', connectionCount: 3 });
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Clothing');
    expect(container.textContent).toContain('3>');
  });

  it('shows buyer count for single connection', () => {
    const product = makeProduct({ connectionCount: 1 });
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('1>');
  });

  it('expands card to show connections on click', () => {
    const product = makeProduct();
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    // Click header to expand — reveals connections table, not stat rows
    const header = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(header);

    // Quality is shown as inline badge in header (Q:XX%)
    expect(container.textContent).toMatch(/Q:\d+%/);
    // Connection table is visible
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('shows connection table when expanded', () => {
    const product = makeProduct();
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(container.textContent).toContain('Pharma Plant');
    expect(container.textContent).toContain('Lab');
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('shows what each buyer took and what delivering it cost, and names the company in a cell', () => {
    // Output connections carry LastValueCnxInfo and tCostCnxInfo and nothing else
    // (building-details-handler.ts PRODUCT_GATES.connectionProps); Price and Quality
    // were columns the server never fills for a buyer.
    const conn = makeConnection({ facilityName: 'Pharma Plant', companyName: 'AcmeCorp', lastValue: '4321', cost: '$77' });
    const product = makeProduct({ connections: [conn], connectionCount: 1 });
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(cells).toContain('4321');
    expect(cells).toContain('$77');
    expect(cells).toContain('AcmeCorp');
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.getAttribute('title')).toBeNull();

    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).not.toContain('Price');
    expect(headers).not.toContain('Quality');
    expect(headers).toEqual(expect.arrayContaining(['Facility', 'Company', 'Last', 'T.Cost']));
  });

  it('shows "No buyers connected" when expanded with no connections', () => {
    const product = makeProduct({ connections: [], connectionCount: 0 });
    markGateLoaded('products', product.path);
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('No buyers connected');
  });

  it('does not claim "No buyers" when the server counted some it could not describe', () => {
    // cnxCount comes off the gate, the rows come from a separate sub-object read.
    // When that read returns nothing the two disagree, and "No buyers connected"
    // is the one thing we know to be false.
    const product = makeProduct({ connections: [], connectionCount: 2 });
    markGateLoaded('products', product.path);
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('2 buyers connected — details unavailable');
    expect(container.textContent).not.toContain('No buyers connected');
  });

  it('shows Hire and Remove buttons when canEdit', () => {
    const product = makeProduct();
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('Hire');
    expect(container.textContent).toContain('Remove');
  });

  it('does not show action buttons when canEdit is false', () => {
    const product = makeProduct();
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={false} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).not.toContain('Hire');
    expect(container.textContent).not.toContain('Remove');
  });

  it('calls onSearchConnections when Hire is clicked', () => {
    const onSearchConnections = jest.fn();
    const callbacks = createSpiedCallbacks({ onSearchConnections });
    const product = makeProduct({ name: 'Chemicals', metaFluid: 'fluid_chem' });

    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    const hireBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Hire');
    fireEvent.click(hireBtn!);

    expect(onSearchConnections).toHaveBeenCalledWith(100, 200, 'fluid_chem', 'Chemicals', 'output');
  });

  it('selects a row and fires onDisconnectConnection on Remove', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const conn = makeConnection({ x: 300, y: 400 });
    const product = makeProduct({ connections: [conn], metaFluid: 'fluid_chem' });

    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    // Expand
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Click row to select
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);

    // Click Remove
    const removeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Remove');
    fireEvent.click(removeBtn!);
    expect(onDisconnectConnection).not.toHaveBeenCalled();
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledWith(100, 200, 'fluid_chem', 'output', [{ x: 300, y: 400 }]);
  });

  it('Delete with three rows selected sends one call carrying the three pairs', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const product = makeProduct({
      metaFluid: 'fluid_chem',
      connections: [
        makeConnection({ facilityName: 'A', x: 10, y: 20 }),
        makeConnection({ facilityName: 'B', x: 30, y: 40 }),
        makeConnection({ facilityName: 'C', x: 50, y: 60 }),
      ],
    });

    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    container.querySelectorAll('tbody tr').forEach(row => fireEvent.click(row));
    fireEvent.keyDown(container.querySelector('table') as HTMLTableElement, { key: 'Delete' });

    expect(onDisconnectConnection).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload?.title).toBe('Disconnect 3 buyers?');
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(onDisconnectConnection).toHaveBeenCalledWith(100, 200, 'fluid_chem', 'output', [
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 },
    ]);
  });

  it('Remove with a multi-selection is one call, and the title names the count', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const product = makeProduct({
      metaFluid: 'fluid_chem',
      connections: [
        makeConnection({ facilityName: 'A', x: 10, y: 20 }),
        makeConnection({ facilityName: 'B', x: 30, y: 40 }),
      ],
    });

    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    container.querySelectorAll('tbody tr').forEach(row => fireEvent.click(row));

    const removeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Remove');
    fireEvent.click(removeBtn!);
    expect(useUiStore.getState().confirmPayload?.title).toBe('Disconnect 2 buyers?');
    expect(useUiStore.getState().confirmPayload?.message).toContain('A, B');
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(onDisconnectConnection).toHaveBeenCalledWith(100, 200, 'fluid_chem', 'output', [
      { x: 10, y: 20 }, { x: 30, y: 40 },
    ]);
  });

  it('clicking a selected row deselects it', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const product = makeProduct({ metaFluid: 'fluid_chem', connections: threeConnections() });

    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const rows = container.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    fireEvent.click(rows[0]);   // take the first one back out

    const removeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Remove');
    fireEvent.click(removeBtn!);
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledWith(100, 200, 'fluid_chem', 'output', [{ x: 30, y: 40 }]);
  });

  it('renders multiple products', () => {
    const products = [
      makeProduct({ name: 'Chemicals', metaFluid: 'fluid_chem' }),
      makeProduct({ name: 'Clothing', metaFluid: 'fluid_cloth' }),
    ];
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={products} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Chemicals');
    expect(container.textContent).toContain('Clothing');
  });

  it('falls back to metaFluid when name is empty', () => {
    const product = makeProduct({ name: '', metaFluid: 'fluid_xyz' });
    const { container } = renderWithProviders(
      <ProductsPanel onPropertyChange={() => {}} products={[product]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('fluid_xyz');
  });
});

// ===========================================================================
// SuppliesPanel
// ===========================================================================

describe('SuppliesPanel', () => {
  beforeEach(resetStores);

  it('renders empty state when no supplies', () => {
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('No supply inputs');
  });

  it('renders supply card with name and supplier count', () => {
    const supply = makeSupply({ name: 'Steel', connectionCount: 3 });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Steel');
    expect(container.textContent).toContain('3 suppliers');
  });

  it('shows singular "supplier" for single connection', () => {
    const supply = makeSupply({ connectionCount: 1 });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('1 supplier');
    expect(container.textContent).not.toContain('1 suppliers');
  });

  it('expands card to show stats and sliders', () => {
    const supply = makeSupply({ fluidValue: '800', lastCostPerc: '95' });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(container.textContent).toContain('Last Value');
    expect(container.textContent).toContain('800');
    expect(container.textContent).toContain('Cost');
    expect(container.textContent).toContain('95%');
  });

  it('shows Max Price and Min Quality sliders when editable', () => {
    const supply = makeSupply({ maxPrice: '200', minK: '50' });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(container.textContent).toContain('Max Price');
    expect(container.textContent).toContain('Min Quality');
    const sliders = container.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(2);
  });

  it('shows read-only Max Price/Min Quality when canEdit is false', () => {
    const supply = makeSupply({ maxPrice: '200', minK: '50' });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={false} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(container.textContent).toContain('Max Price');
    expect(container.textContent).toContain('200%');
    expect(container.textContent).toContain('Min Quality');
    expect(container.textContent).toContain('50%');
    // No sliders in read-only mode
    const sliders = container.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(0);
  });

  it('shows connection table when expanded', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('Steel Mill');
    expect(container.textContent).toContain('Owner');
    expect(container.querySelector('tbody tr')?.getAttribute('title')).toBe('AcmeCorp');
  });

  it('shows "No suppliers connected" when no connections', () => {
    const supply = makeSupply({ connections: [], connectionCount: 0 });
    markGateLoaded('supplies', supply.path);
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('No suppliers connected');
  });

  it('labels a connection the server counts but cannot name', () => {
    // The live case: cnxCount says 1, the cached sub-object carries no facility
    // name, so every column comes back empty. The row must stay and must read as
    // "no data" rather than as a blank the user mistakes for a rendering bug.
    const supply = makeSupply({
      connectionCount: 1,
      connections: [makeConnection({ facilityName: '', companyName: '' })],
    });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('no data');
  });

  it('does not claim "No suppliers" when the header counts one', () => {
    // The reported contradiction, pinned: header "1 supplier", body "No
    // suppliers connected". Whatever else is wrong, the panel must not say both.
    const supply = makeSupply({ connections: [], connectionCount: 1 });
    markGateLoaded('supplies', supply.path);
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('1 supplier connected — details unavailable');
    expect(container.textContent).not.toContain('No suppliers connected');
  });

  it('shows Hire, Modify, Fire buttons when canEdit', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).toContain('Hire');
    expect(container.textContent).toContain('Modify');
    expect(container.textContent).toContain('Fire');
  });

  it('does not show action buttons when canEdit is false', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={false} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(container.textContent).not.toContain('Hire');
    expect(container.textContent).not.toContain('Fire');
  });

  it('fires RDO command on Max Price slider change', () => {
    jest.useFakeTimers();
    const onSetBuildingProperty = jest.fn();
    const callbacks = createSpiedCallbacks({ onSetBuildingProperty });
    const supply = makeSupply({ maxPrice: '200', metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const sliders = container.querySelectorAll('input[type="range"]');
    // First slider is Max Price
    fireEvent.change(sliders[0], { target: { value: '300' } });

    jest.advanceTimersByTime(350);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      100, 200, 'RDOSetInputMaxPrice', '300', { fluidId: 'fluid_steel' },
    );

    jest.useRealTimers();
  });

  it('fires RDO command on Min Quality slider change', () => {
    jest.useFakeTimers();
    const onSetBuildingProperty = jest.fn();
    const callbacks = createSpiedCallbacks({ onSetBuildingProperty });
    const supply = makeSupply({ minK: '50', metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const sliders = container.querySelectorAll('input[type="range"]');
    // Second slider is Min Quality
    fireEvent.change(sliders[1], { target: { value: '75' } });

    jest.advanceTimersByTime(350);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      100, 200, 'RDOSetInputMinK', '75', { fluidId: 'fluid_steel' },
    );

    jest.useRealTimers();
  });

  it('calls onSearchConnections when Hire is clicked', () => {
    const onSearchConnections = jest.fn();
    const callbacks = createSpiedCallbacks({ onSearchConnections });
    const supply = makeSupply({ name: 'Steel', metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    const hireBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Hire');
    fireEvent.click(hireBtn!);

    expect(onSearchConnections).toHaveBeenCalledWith(100, 200, 'fluid_steel', 'Steel', 'input');
  });

  it('selects row and fires onDisconnectConnection on Fire', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const conn = makeConnection({ x: 100, y: 200 });
    const supply = makeSupply({ connections: [conn], metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Select row
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);

    // Fire
    const fireBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fire');
    fireEvent.click(fireBtn!);
    expect(onDisconnectConnection).not.toHaveBeenCalled();
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [{ x: 100, y: 200 }]);
  });

  it('Delete with three rows selected sends one call carrying the three pairs', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const supply = makeSupply({ metaFluid: 'fluid_steel', connections: threeConnections() });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    container.querySelectorAll('tbody tr').forEach(row => fireEvent.click(row));
    fireEvent.keyDown(container.querySelector('table') as HTMLTableElement, { key: 'Delete' });

    expect(onDisconnectConnection).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload?.title).toBe('Disconnect 3 suppliers?');
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 },
    ]);
  });

  it('Fire with two rows selected is one call, and the selection is cleared after', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const supply = makeSupply({ metaFluid: 'fluid_steel', connections: threeConnections() });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const rows = container.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    fireEvent.click(rows[2]);

    const fireBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fire');
    fireEvent.click(fireBtn!);
    expect(useUiStore.getState().confirmPayload?.title).toBe('Disconnect 2 suppliers?');
    // Confirming clears the selection, which is a React state update — act() so
    // the re-render it causes has landed before the rows are read back.
    act(confirmPendingDialog);

    expect(onDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [
      { x: 10, y: 20 }, { x: 50, y: 60 },
    ]);
    // Nothing stays selected once the selection has gone.
    expect(container.querySelectorAll('tbody tr[class*="Selected"]')).toHaveLength(0);
  });

  it('clicking a selected row deselects it', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const supply = makeSupply({ metaFluid: 'fluid_steel', connections: threeConnections() });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const rows = container.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    fireEvent.click(rows[0]);   // take the first one back out

    const fireBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Fire');
    fireEvent.click(fireBtn!);
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [{ x: 30, y: 40 }]);
  });

  it('Modify needs exactly one selected row', () => {
    const supply = makeSupply({ metaFluid: 'fluid_steel', connections: threeConnections() });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    const modifyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Modify') as HTMLButtonElement;
    expect(modifyBtn.disabled).toBe(true);

    const rows = container.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(modifyBtn.disabled).toBe(false);

    fireEvent.click(rows[1]);
    expect(modifyBtn.disabled).toBe(true);
  });

  it('the overpayment popover Delete disconnects only the row it was opened on', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const supply = makeSupply({ metaFluid: 'fluid_steel', connections: threeConnections() });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const rows = container.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    fireEvent.click(rows[2]);
    // The popover is opened on the middle row, which is NOT in the selection.
    fireEvent.contextMenu(rows[1]);

    const deleteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete');
    fireEvent.click(deleteBtn!);
    expect(useUiStore.getState().confirmPayload?.title).toBe('Disconnect B?');
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledTimes(1);
    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [{ x: 30, y: 40 }]);
  });

  it('opens overpayment popover on Modify click', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Select row first
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);

    // Click Modify
    const modifyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Modify');
    fireEvent.click(modifyBtn!);

    expect(container.textContent).toContain('Overpayment');
    expect(container.textContent).toContain('OK');
    expect(container.textContent).toContain('Cancel');
    expect(container.textContent).toContain('Delete');
  });

  it('opens overpayment popover on right-click', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.contextMenu(row);

    expect(container.textContent).toContain('Overpayment');
  });

  it('closes overpayment popover on Cancel', () => {
    const supply = makeSupply();
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Select and Modify
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);
    const modifyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Modify');
    fireEvent.click(modifyBtn!);

    // Cancel
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel');
    fireEvent.click(cancelBtn!);

    expect(container.textContent).not.toContain('Overpayment');
  });

  it('fires RDO command on overpayment OK', () => {
    const onSetBuildingProperty = jest.fn();
    const onRefreshBuilding = jest.fn();
    const callbacks = createSpiedCallbacks({ onSetBuildingProperty, onRefreshBuilding });
    const conn = makeConnection({ overprice: '20' });
    const supply = makeSupply({ connections: [conn], metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={100} buildingY={200} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Select and Modify
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);
    const modifyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Modify');
    fireEvent.click(modifyBtn!);

    // OK
    const okBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'OK');
    fireEvent.click(okBtn!);

    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      100, 200, 'RDOSetInputOverPrice', '20', { fluidId: 'fluid_steel', index: '0' },
    );
    expect(onRefreshBuilding).toHaveBeenCalledWith(100, 200);
  });

  it('fires onDisconnectConnection on overpayment Delete', () => {
    const onDisconnectConnection = jest.fn();
    const callbacks = createSpiedCallbacks({ onDisconnectConnection });
    const conn = makeConnection({ x: 100, y: 200 });
    const supply = makeSupply({ connections: [conn], metaFluid: 'fluid_steel' });

    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={true} buildingX={50} buildingY={60} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    // Select and Modify to open popover
    const row = container.querySelector('tbody tr') as HTMLTableRowElement;
    fireEvent.click(row);
    const modifyBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Modify');
    fireEvent.click(modifyBtn!);

    // Delete
    const deleteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete');
    fireEvent.click(deleteBtn!);
    expect(onDisconnectConnection).not.toHaveBeenCalled();
    confirmPendingDialog();

    expect(onDisconnectConnection).toHaveBeenCalledWith(50, 60, 'fluid_steel', 'input', [{ x: 100, y: 200 }]);
  });

  it('renders multiple supplies', () => {
    const supplies = [
      makeSupply({ name: 'Steel', metaFluid: 'fluid_steel' }),
      makeSupply({ name: 'Plastic', metaFluid: 'fluid_plastic' }),
    ];
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={supplies} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('Steel');
    expect(container.textContent).toContain('Plastic');
  });

  it('falls back to metaFluid when name is empty', () => {
    const supply = makeSupply({ name: '', metaFluid: 'fluid_xyz' });
    const { container } = renderWithProviders(
      <SuppliesPanel supplies={[supply]} canEdit={false} buildingX={100} buildingY={200} />,
    );
    expect(container.textContent).toContain('fluid_xyz');
  });
});
