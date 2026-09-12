/**
 * The Supplies and Products accordions share ONE expand-and-load mechanism.
 *
 * `useGateConnections` is that mechanism, and these tests drive it through both
 * panels — the same assertions, the same order — because the point of the hook
 * is that neither panel has its own version. A gate is collapsed until clicked;
 * clicking it reads that gate's connections and nothing else; a second click
 * costs nothing.
 *
 * Reference client: `RefreshFinger` loads `CurrentFinger` alone and only when
 * `not Info.Loaded` (Voyager/ProdSheetForm.pas:449-480).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { SuppliesPanel } from '../SuppliesGroup';
import { ProductsPanel } from '../ProductsGroup';
import { ProductSummaryCards } from '../PropertyTables';
import { formatCurrency } from '@/shared/building-details';
import { useBuildingStore, gateKey } from '../../../store/building-store';
import { useGameStore } from '../../../store/game-store';
import type {
  BuildingSupplyData, BuildingProductData, BuildingConnectionData, BuildingDetailsResponse,
} from '@/shared/types';

const X = 118;
const Y = 226;

const makeDetails = (): BuildingDetailsResponse => ({
  buildingId: 'bld-1', x: X, y: Y, visualClass: '9013', templateName: 'Warehouse',
  buildingName: 'Export Storage 4', ownerName: 'TestCorp', securityId: 's', canGovern: true,
  tabs: [], groups: {}, timestamp: 1,
});

const conn = (facilityName: string): BuildingConnectionData => ({
  facilityName, companyName: 'Yellow Inc.', createdBy: 'SPO_test3', price: '100',
  overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
  x: 40, y: 50,
});

const supply = (path: string, name: string, count: number): BuildingSupplyData => ({
  path, name, metaFluid: name, fluidValue: '1200', connectionCount: count, connections: [],
});

const product = (path: string, name: string, count: number): BuildingProductData => ({
  path, name, metaFluid: name, lastFluid: '80', quality: '90', pricePc: '110',
  avgPrice: '105', marketPrice: '5000', connectionCount: count, connections: [],
});

const SUPPLIES = [supply('SegA', 'Books', 2), supply('SegB', 'Cars', 1)];
const PRODUCTS = [product('GateA', 'Toys', 2), product('GateB', 'Fuel', 1)];

/** The store as a freshly opened tab leaves it: headers, no rows. */
function seedPanel(): void {
  useBuildingStore.getState().setDetails(makeDetails());
  useBuildingStore.getState().mergeTabData('supplies', { supplies: SUPPLIES }, X, Y);
  useBuildingStore.getState().mergeTabData('products', { products: PRODUCTS }, X, Y);
}

beforeEach(() => {
  resetStores();
  useGameStore.setState({ status: 'connected' });
  seedPanel();
});

const NO_SUPPLIES: BuildingSupplyData[] = [];
const NO_PRODUCTS: BuildingProductData[] = [];

/**
 * Hosts that take their rows from the store, as BuildingInspector does. A gate
 * merge has to reach the screen, and it only does through a subscription.
 */
function SuppliesHost({ canEdit = false }: { canEdit?: boolean }) {
  const supplies = useBuildingStore((s) => s.details?.supplies ?? NO_SUPPLIES);
  return <SuppliesPanel supplies={supplies} canEdit={canEdit} buildingX={X} buildingY={Y} />;
}

function ProductsHost({ canEdit = false }: { canEdit?: boolean }) {
  const products = useBuildingStore((s) => s.details?.products ?? NO_PRODUCTS);
  return (
    <ProductsPanel
      products={products}
      canEdit={canEdit}
      buildingX={X}
      buildingY={Y}
      onPropertyChange={() => { /* not under test */ }}
    />
  );
}

/**
 * The two panels, described identically. Each case names the gate it clicks and
 * how the panel labels a connection, and nothing else differs.
 */
const PANELS = [
  {
    tabId: 'supplies' as const,
    label: 'Supplies',
    gate: 'SegA',
    gateName: 'Books',
    otherGate: 'SegB',
    header: 'Books',
    pending: /Loading suppliers/,
    failure: /Could not read the suppliers/,
    loadedGate: (): BuildingSupplyData => ({ ...SUPPLIES[0], connections: [conn('Farm A')] }),
    render: (onRequest: (...a: unknown[]) => unknown) => renderWithProviders(
      <SuppliesHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: onRequest }) },
    ),
  },
  {
    tabId: 'products' as const,
    label: 'Products',
    gate: 'GateA',
    gateName: 'Toys',
    otherGate: 'GateB',
    header: 'Toys',
    pending: /Loading buyers/,
    failure: /Could not read the buyers/,
    loadedGate: (): BuildingProductData => ({ ...PRODUCTS[0], connections: [conn('Farm A')] }),
    render: (onRequest: (...a: unknown[]) => unknown) => renderWithProviders(
      <ProductsHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: onRequest }) },
    ),
  },
];

describe.each(PANELS)('$label — one gate at a time', (panel) => {
  it('reads nothing while every gate is collapsed', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    expect(onRequest).not.toHaveBeenCalled();
  });

  it('reads exactly the gate that was clicked', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header));

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(X, Y, panel.tabId, panel.gate, panel.gateName, '9013');
  });

  it('says the rows are on their way rather than claiming there are none', () => {
    // An empty `connections` before the read means "not read yet". Rendering
    // that as "No suppliers connected" would contradict the count next to it.
    panel.render(jest.fn());

    fireEvent.click(screen.getByText(panel.header));

    expect(screen.getByText(panel.pending)).toBeTruthy();
  });

  it('does not read the gate again when it is re-opened', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header)); // open — reads
    act(() => {
      useBuildingStore.getState().mergeGateData(panel.tabId, panel.gate, panel.loadedGate(), X, Y);
    });
    fireEvent.click(screen.getByText(panel.header)); // close
    fireEvent.click(screen.getByText(panel.header)); // open again

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Farm A')).toBeTruthy();
  });

  it('re-reads the gate after an invalidation, which is what a connection change triggers', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header));
    act(() => {
      useBuildingStore.getState().mergeGateData(panel.tabId, panel.gate, panel.loadedGate(), X, Y);
    });
    expect(onRequest).toHaveBeenCalledTimes(1);

    act(() => {
      useBuildingStore.getState().invalidateTabs([panel.tabId]);
    });

    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('offers a way back from a failed read', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header));
    act(() => {
      useBuildingStore.getState().setGateError(panel.tabId, panel.gate);
    });
    expect(screen.getByText(panel.failure)).toBeTruthy();
    // Terminal until the user acts: no retry storm on re-render.
    expect(onRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(panel.header)); // close
    fireEvent.click(screen.getByText(panel.header)); // open again — retries

    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('leaves the other gates alone', () => {
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header));

    expect(useBuildingStore.getState().expandedGates.has(gateKey(panel.tabId, panel.otherGate))).toBe(false);
    expect(onRequest.mock.calls.every((c) => c[3] === panel.gate)).toBe(true);
  });

  it('stays open across a re-render with a new gate array', () => {
    // `resetTabLoadingStates` replaces the list on every auto-refresh; if the
    // open state lived in the card it would die with the card, collapsing the
    // gate the user is reading and throwing away the rows just fetched for it.
    const onRequest = jest.fn();
    const { rerender } = panel.render(onRequest) as ReturnType<typeof renderWithProviders>;

    fireEvent.click(screen.getByText(panel.header));
    expect(useBuildingStore.getState().expandedGates.has(gateKey(panel.tabId, panel.gate))).toBe(true);

    rerender(<div />);

    expect(useBuildingStore.getState().expandedGates.has(gateKey(panel.tabId, panel.gate))).toBe(true);
  });

  it('asks for nothing while the socket is down', () => {
    useGameStore.setState({ status: 'disconnected' });
    const onRequest = jest.fn();
    panel.render(onRequest);

    fireEvent.click(screen.getByText(panel.header));

    expect(onRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// A LISTED GATE — path and name, nothing else read yet
//
// This is the shape the tab read now returns. Everything a collapsed row used
// to show — the supplier/buyer count, the quality badge, the price slider —
// was a gate-header property, and reading 30 of those cost 60 round-trips
// before the user had opened anything. The rows below show what is left, and
// what appears once a gate IS opened.
// ===========================================================================

const STUB_SUPPLIES: BuildingSupplyData[] = [
  { path: 'SegA', name: 'Books', connections: [] },
  { path: 'SegB', name: 'Cars', connections: [] },
];

const STUB_PRODUCTS: BuildingProductData[] = [
  { path: 'GateA', name: 'Toys', connections: [] },
  { path: 'GateB', name: 'Fuel', connections: [] },
];

function seedListedOnly(): void {
  useBuildingStore.getState().setDetails(makeDetails());
  useBuildingStore.getState().mergeTabData('supplies', { supplies: STUB_SUPPLIES }, X, Y);
  useBuildingStore.getState().mergeTabData('products', { products: STUB_PRODUCTS }, X, Y);
}

describe('a gate nobody has opened', () => {
  beforeEach(seedListedOnly);

  it('names the supply gate and claims nothing else', () => {
    const { container } = renderWithProviders(
      <SuppliesHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );

    expect(screen.getByText('Books')).toBeTruthy();
    // Not "0 suppliers" — the server was never asked, and saying zero would be
    // stating something it never answered.
    expect(container.textContent).not.toMatch(/supplier/);
  });

  it('names the product gate and shows neither badge, count, nor price', () => {
    const { container } = renderWithProviders(
      <ProductsHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );

    expect(screen.getByText('Toys')).toBeTruthy();
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Q:/);
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('shows the supplier count once the gate has been read', () => {
    renderWithProviders(
      <SuppliesHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Books'));

    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', {
        path: 'SegA', name: 'Books', metaFluid: 'Books', fluidValue: '1200',
        connectionCount: 2, connections: [conn('Farm A'), conn('Farm B')],
      }, X, Y);
    });

    expect(screen.getByText('2 suppliers')).toBeTruthy();
    // …and only for the gate that was opened.
    expect(screen.queryByText('1 supplier')).toBeNull();
  });

  it('shows the product price slider once the gate has been read', () => {
    const { container } = renderWithProviders(
      <ProductsHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Toys'));

    act(() => {
      useBuildingStore.getState().mergeGateData('products', 'GateA', {
        path: 'GateA', name: 'Toys', metaFluid: 'Toys', lastFluid: '80', quality: '90',
        pricePc: '110', avgPrice: '105', marketPrice: '5000', connectionCount: 0,
        connections: [],
      }, X, Y);
    });

    // The price control lives inside the opened gate now, exactly where the
    // reference client puts it: PricePc acts on CurrentFinger alone
    // (Voyager/ProdSheetForm.pas:684).
    expect(container.querySelector('input[type="range"]')).toBeTruthy();
    expect(screen.getByText(/Q:90%/)).toBeTruthy();
  });

  it('will not let Hire fire without the fluid id it has to name', () => {
    // metaFluid IS the fluid id every mutation addresses, and it is a header
    // property. A Hire before the gate is read would search for undefined.
    const onSearch = jest.fn();
    renderWithProviders(
      <SuppliesHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn(), onSearchConnections: onSearch }) },
    );
    fireEvent.click(screen.getByText('Books'));

    const hire = screen.getByText('Hire') as HTMLButtonElement;
    expect(hire.disabled).toBe(true);
    fireEvent.click(hire);
    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', {
        path: 'SegA', name: 'Books', metaFluid: 'Books', connectionCount: 0, connections: [],
      }, X, Y);
    });

    const hireNow = screen.getByText('Hire') as HTMLButtonElement;
    expect(hireNow.disabled).toBe(false);
    fireEvent.click(hireNow);
    expect(onSearch).toHaveBeenCalledWith(X, Y, 'Books', 'Books', 'input');
  });

  it('keeps two gates of the same building apart even with no fluid id to key on', () => {
    // The cards used to be keyed by metaFluid, which no longer exists at list
    // time; the path does, and it is what the gate read is addressed by.
    renderWithProviders(
      <SuppliesHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );

    fireEvent.click(screen.getByText('Cars'));

    expect(useBuildingStore.getState().expandedGates.has(gateKey('supplies', 'SegB'))).toBe(true);
    expect(useBuildingStore.getState().expandedGates.has(gateKey('supplies', 'SegA'))).toBe(false);
  });
});

// ===========================================================================
// THE GENERAL TAB'S PRODUCT SUMMARY
//
// `ProductSummaryCards` draws a price slider per product on an industrial
// building's General tab, from the same `details.products` the accordion uses.
// Those gates now arrive without a price, so the panel has to say nothing
// rather than draw a slider at 0 %.
// ===========================================================================

describe('ProductSummaryCards', () => {
  const priced = (path: string, name: string): BuildingProductData => ({
    path, name, metaFluid: name, lastFluid: '80', quality: '90', pricePc: '110',
    avgPrice: '105', marketPrice: '5000', connectionCount: 0, connections: [],
  });

  it('renders nothing when no gate has been opened', () => {
    const { container } = renderWithProviders(
      <ProductSummaryCards products={STUB_PRODUCTS} canEdit onPropertyChange={() => {}} />,
    );

    // A slider at 0 % is an instruction the server never gave.
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing at all when there are no products', () => {
    const { container } = renderWithProviders(
      <ProductSummaryCards products={[]} canEdit onPropertyChange={() => {}} />,
    );

    expect(container.textContent).toBe('');
  });

  it('renders only the gates whose price has actually been read', () => {
    const { container } = renderWithProviders(
      <ProductSummaryCards
        products={[STUB_PRODUCTS[0], priced('GateB', 'Fuel')]}
        canEdit
        onPropertyChange={() => {}}
      />,
    );

    expect(screen.getByText('Fuel')).toBeTruthy();
    expect(screen.queryByText('Toys')).toBeNull();
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(1);
  });
});

// ===========================================================================
// A HEADER THAT CAME BACK WITHOUT A FLUID ID
//
// `buildGate` maps a missing MetaFluid to '' (the cache writes one value per
// requested name whether or not the property exists, Cache Server/
// CachedObjectWrap.pas:225-230). A gate can therefore be "read" and still have
// no id to address a mutation with, and no mutation may go out on the wire
// naming an empty fluid.
// ===========================================================================

describe('a gate read that yielded no fluid id', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const NAMELESS: BuildingProductData = {
    path: 'GateA', name: 'Toys', metaFluid: '', lastFluid: '80', quality: '90',
    pricePc: '110', avgPrice: '105', marketPrice: '5000', connectionCount: 0,
    connections: [],
  };

  it('shows the price but refuses to send a price change', () => {
    const onPropertyChange = jest.fn();
    useBuildingStore.getState().setDetails(makeDetails());
    useBuildingStore.getState().mergeTabData('products', { products: [NAMELESS] }, X, Y);
    act(() => {
      useBuildingStore.getState().mergeGateData('products', 'GateA', NAMELESS, X, Y);
    });

    const { container } = renderWithProviders(
      <ProductsPanel
        products={[NAMELESS]}
        canEdit
        buildingX={X}
        buildingY={Y}
        onPropertyChange={onPropertyChange}
      />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Toys'));

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: '150' } });
    // The slider debounces for 300 ms before it commits (PropertyTables.tsx:405).
    act(() => { jest.advanceTimersByTime(400); });

    // RDOSetOutputPrice addresses the gate by fluid id; without one there is
    // nothing to address, so nothing goes out.
    expect(onPropertyChange).not.toHaveBeenCalled();
  });

  it('does send the price change once the gate names its fluid', () => {
    // The other side of the guard: an opened gate with a real id still drives
    // RDOSetOutputPrice, from inside the expanded body where the control lives.
    const named: BuildingProductData = { ...NAMELESS, metaFluid: 'Toys' };
    const onPropertyChange = jest.fn();
    useBuildingStore.getState().setDetails(makeDetails());
    useBuildingStore.getState().mergeTabData('products', { products: [named] }, X, Y);
    act(() => {
      useBuildingStore.getState().mergeGateData('products', 'GateA', named, X, Y);
    });

    const { container } = renderWithProviders(
      <ProductsPanel
        products={[named]}
        canEdit
        buildingX={X}
        buildingY={Y}
        onPropertyChange={onPropertyChange}
      />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Toys'));

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '150' } });
    act(() => { jest.advanceTimersByTime(400); });

    expect(onPropertyChange).toHaveBeenCalledWith('PricePc', 150, { fluidId: 'Toys' });
  });
});

describe('disconnecting asks first (T3, B5)', () => {
  it('Fire raises a destructive Dialog and only disconnects on confirm', () => {
    const { useUiStore } = jest.requireActual('../../../store/ui-store') as typeof import('../../../store/ui-store');
    useUiStore.setState({ modal: null, confirmPayload: null });
    const onDisconnectConnection = jest.fn();
    renderWithProviders(
      <SuppliesHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn(), onDisconnectConnection }) },
    );
    fireEvent.click(screen.getByText('Books'));
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', {
        path: 'SegA', name: 'Books', metaFluid: 'Books', connectionCount: 1, connections: [conn('Paper Mill')],
      }, X, Y);
    });
    fireEvent.click(screen.getByText('Paper Mill'));
    fireEvent.click(screen.getByText('Fire'));
    const s = useUiStore.getState();
    expect(s.modal).toBe('confirm');
    expect(s.confirmPayload?.title).toBe('Disconnect Paper Mill?');
    expect(s.confirmPayload?.options?.kind).toBe('destructive');
    expect(onDisconnectConnection).not.toHaveBeenCalled();
    s.confirmPayload?.onConfirm();
    expect(onDisconnectConnection).toHaveBeenCalledWith(X, Y, 'Books', 'input', 40, 50);
    useUiStore.getState().closeModal();
  });
});


// ===========================================================================
// THE MEMO AND THE ROWS, ON SCREEN
//
// Live, on `Liquor plant 2` (908,820): the Fresh Food gate was opened and
// filled with three suppliers; a re-open of the same building showed the same
// gate as "No suppliers connected", with no REQ_BUILDING_GATE_CONNECTIONS on
// the wire. The rows had been replaced by a fresh listing while the memo that
// said they were read stayed behind — a load state outliving its data, one
// level down from the Supplies-tab defect that made the gates load at all.
// ===========================================================================

describe('a gate whose rows were replaced under it', () => {
  const READ_GATE = (): BuildingSupplyData => ({
    path: 'SegA', name: 'Books', metaFluid: 'Books', maxPrice: '400', minK: '20',
    connectionCount: 1, connections: [conn('Large Farm 1')],
  });

  function openAndRead(onRequest: (...a: unknown[]) => unknown) {
    renderWithProviders(
      <SuppliesHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: onRequest }) },
    );
    fireEvent.click(screen.getByText('Books'));
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
    });
    expect(screen.getByText('Large Farm 1')).toBeTruthy();
  }

  it('reads itself again when the tab is re-listed, instead of claiming there are none', () => {
    const onRequest = jest.fn();
    openAndRead(onRequest);

    // What re-opening the panel does: the tab is listed again, and a listing
    // carries headers with `connections: []`.
    act(() => {
      useBuildingStore.getState().mergeTabData('supplies', { supplies: SUPPLIES }, X, Y);
    });

    expect(onRequest).toHaveBeenCalledTimes(2);
    // Never the contradiction: the gate said "1 supplier" a moment ago.
    expect(screen.queryByText('No suppliers connected')).toBeNull();
    expect(screen.getByText(/Loading suppliers/)).toBeTruthy();
  });

  it('recovers when the read lands while the list is being replaced', () => {
    // The race behind the live sighting: a refresh wipes the rows
    // (`resetTabLoadingStates`) with the gate read still in flight, so the
    // reply has nowhere to go. Marking the gate read there is what left it
    // empty and silent for the rest of the session.
    const onRequest = jest.fn();
    openAndRead(onRequest);

    act(() => {
      useBuildingStore.getState().setGateLoading('supplies', 'SegA');
      useBuildingStore.getState().resetTabLoadingStates();
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
      useBuildingStore.getState().mergeTabData('supplies', { supplies: SUPPLIES }, X, Y);
    });

    expect(onRequest).toHaveBeenCalledTimes(2);
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
    });
    expect(screen.getByText('Large Farm 1')).toBeTruthy();
  });

  it('shows the price the server sent, not the default it started on', () => {
    // Max Price is a gate-header property: at first render there is none, and
    // the slider starts on its 200 % default. Live it stayed there over a gate
    // the server had answered 400 % for.
    const { container } = renderWithProviders(
      <SuppliesHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Books'));
    expect(container.querySelector('input[type="range"]')).toBeNull();

    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
    });

    const sliders = container.querySelectorAll('input[type="range"]');
    expect((sliders[0] as HTMLInputElement).value).toBe('400');
    expect((sliders[1] as HTMLInputElement).value).toBe('20');
    expect(screen.getByText('400%')).toBeTruthy();
  });

  it('follows a value the server changed, and leaves a drag alone', () => {
    const { container } = renderWithProviders(
      <SuppliesHost canEdit />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Books'));
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
    });

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '300' } });
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('300');

    // A re-read that carries the same value the card already showed must not
    // pull the thumb back out from under the user.
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', READ_GATE(), X, Y);
    });
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('300');

    // A value it has never shown is the server saying something new: follow it.
    act(() => {
      useBuildingStore.getState().mergeGateData(
        'supplies', 'SegA', { ...READ_GATE(), maxPrice: '150' }, X, Y,
      );
    });
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('150');
  });
});

describe('two buildings, one gate path', () => {
  it('does not answer for the building the user just left', () => {
    // `SegA` is a building-relative Delphi path: the same string names a gate
    // on every facility of the type. A memo kept across the switch would make
    // the next building's gate look already read.
    const onRequest = jest.fn();
    renderWithProviders(
      <SuppliesHost />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: onRequest }) },
    );
    fireEvent.click(screen.getByText('Books'));
    act(() => {
      useBuildingStore.getState().mergeGateData(
        'supplies', 'SegA', { ...SUPPLIES[0], connections: [conn('Large Farm 1')] }, X, Y,
      );
    });

    act(() => {
      useBuildingStore.getState().setDetails({ ...makeDetails(), x: 500, y: 600 });
      useBuildingStore.getState().mergeTabData('supplies', { supplies: SUPPLIES }, 500, 600);
    });

    expect(useBuildingStore.getState().gateLoadingStates).toEqual({});
    expect(useBuildingStore.getState().expandedGates.size).toBe(0);

    // Opening it on the new building reads it, rather than showing the rows —
    // or the emptiness — of the old one. (The host names its own coordinates,
    // so the assertion is that a read happened at all.)
    fireEvent.click(screen.getByText('Books'));
    expect(onRequest).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// THE RANGE THE GAME ACTUALLY OFFERED
//
// Both price bars were TPercentEdit with MinPerc = 0, MaxPerc = 400
// (Voyager/SupplySheetForm.dfm `xfer_MaxPrice`, Voyager/ProdSheetForm.dfm
// `PricePc`; the widget maps a drag to round(perc*(fMaxPerc - fMinPerc)),
// Voyager/Components/PercentEdit.pas:265-273), so every integer 0..400 was
// reachable and there was no step. The panels had invented three different
// narrower ranges instead, none of which could express 305 % or 350 %.
// ===========================================================================

describe('price sliders offer the range the game had (0..400, step 1)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const PRICED_SUPPLY: BuildingSupplyData = {
    path: 'SegA', name: 'Books', metaFluid: 'Books', maxPrice: '200', minK: '20',
    connectionCount: 0, connections: [],
  };

  const PRICED_PRODUCT: BuildingProductData = {
    path: 'GateA', name: 'Toys', metaFluid: 'Toys', lastFluid: '80', quality: '90',
    pricePc: '110', avgPrice: '105', marketPrice: '5000', connectionCount: 0,
    connections: [],
  };

  /** An opened supply gate whose Max Price the server has answered. */
  function openSupplyGate(onSetBuildingProperty: (...a: unknown[]) => unknown) {
    const { container } = renderWithProviders(
      <SuppliesHost canEdit />,
      {
        clientCallbacks: createSpiedCallbacks({
          onRequestGateConnections: jest.fn(), onSetBuildingProperty,
        }),
      },
    );
    fireEvent.click(screen.getByText('Books'));
    act(() => {
      useBuildingStore.getState().mergeGateData('supplies', 'SegA', PRICED_SUPPLY, X, Y);
    });
    return container;
  }

  /** An opened product gate whose price and market price the server has answered. */
  function openProductGate(onPropertyChange: (...a: unknown[]) => unknown) {
    useBuildingStore.getState().mergeTabData('products', { products: [PRICED_PRODUCT] }, X, Y);
    const { container } = renderWithProviders(
      <ProductsPanel
        products={[PRICED_PRODUCT]}
        canEdit
        buildingX={X}
        buildingY={Y}
        onPropertyChange={onPropertyChange}
      />,
      { clientCallbacks: createSpiedCallbacks({ onRequestGateConnections: jest.fn() }) },
    );
    fireEvent.click(screen.getByText('Toys'));
    act(() => {
      useBuildingStore.getState().mergeGateData('products', 'GateA', PRICED_PRODUCT, X, Y);
    });
    return container;
  }

  it('the input max-price slider spans 0..400 in steps of 1', () => {
    const slider = openSupplyGate(jest.fn())
      .querySelector('input[type="range"]') as HTMLInputElement;

    expect(slider.min).toBe('0');
    expect(slider.max).toBe('400');
    expect(slider.step).toBe('1');
  });

  it('sends 305 % as the input max price — a value the old 0..500/10 bar could not express', () => {
    const onSetBuildingProperty = jest.fn();
    const slider = openSupplyGate(onSetBuildingProperty)
      .querySelector('input[type="range"]') as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '305' } });
    act(() => { jest.advanceTimersByTime(400); });

    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      X, Y, 'RDOSetInputMaxPrice', '305', { fluidId: 'Books' },
    );
  });

  it('the output price slider spans 0..400 in steps of 1', () => {
    const slider = openProductGate(jest.fn())
      .querySelector('input[type="range"]') as HTMLInputElement;

    expect(slider.min).toBe('0');
    expect(slider.max).toBe('400');
    expect(slider.step).toBe('1');
  });

  it('sends 305 % as the output price', () => {
    const onPropertyChange = jest.fn();
    const slider = openProductGate(onPropertyChange)
      .querySelector('input[type="range"]') as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '305' } });
    act(() => { jest.advanceTimersByTime(400); });

    expect(onPropertyChange).toHaveBeenCalledWith('PricePc', 305, { fluidId: 'Toys' });
  });

  it('the dollar figure beside the output slider follows the thumb', () => {
    // Voyager relabelled the bar on every move: `N% ($X)` with
    // X = (Value/100) * MarketPrice (Voyager/ProdSheetForm.pas:687-698).
    const container = openProductGate(jest.fn());
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

    expect(container.textContent).toContain(formatCurrency((110 / 100) * 5000));

    fireEvent.change(slider, { target: { value: '350' } });

    // No timer advance: the label is not on the wire's debounce.
    expect(container.textContent).toContain(formatCurrency((350 / 100) * 5000));
    expect(container.textContent).not.toContain(formatCurrency((110 / 100) * 5000));
  });

  it('the General tab summary slider agrees with the Products tab', () => {
    const { container } = renderWithProviders(
      <ProductSummaryCards products={[PRICED_PRODUCT]} canEdit onPropertyChange={jest.fn()} />,
    );

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.max).toBe('400');
    expect(slider.step).toBe('1');
  });
});
