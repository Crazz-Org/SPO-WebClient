import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore, DEFAULT_CONNECTION_FILTERS } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { ConnectionPickerContent } from './ConnectionPickerModal';
import { ClientBridge } from '../../bridge/client-bridge';

function openPicker() {
  useBuildingStore.getState().setConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'input', buildingX: 100, buildingY: 100 });
}

describe('ConnectionPickerContent (T3)', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ connectionFilters: DEFAULT_CONNECTION_FILTERS, modal: null });
    useBuildingStore.getState().clearConnectionPicker();
  });

  it('Enter in a filter field runs the search and remembers the filters', () => {
    openPicker();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    const company = screen.getByLabelText('Company') as HTMLInputElement;
    fireEvent.change(company, { target: { value: 'Crazz' } });
    fireEvent.keyDown(company, { key: 'Enter' });
    expect(onConnectionSearch).toHaveBeenCalledTimes(1);
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ company: 'Crazz' });
    expect(useUiStore.getState().connectionFilters.company).toBe('Crazz');
  });

  it('a new picker starts from the remembered filters', () => {
    useUiStore.setState({ connectionFilters: { ...DEFAULT_CONNECTION_FILTERS, town: 'Helartia' } });
    openPicker();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />);
    expect((screen.getByLabelText('Town') as HTMLInputElement).value).toBe('Helartia');
  });

  it('sorts results by distance from the building and shows it', () => {
    openPicker();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />);
    act(() => {
      useBuildingStore.getState().setConnectionResults([
        { facilityName: 'Far Farm', companyName: 'A', x: 100, y: 400, town: 'Nova Roma' },
        { facilityName: 'Near Farm', companyName: 'B', x: 103, y: 104 },
      ]);
    });
    const rows = screen.getAllByText(/tiles/);
    expect(rows[0].textContent).toContain('5 tiles');
    expect(rows[1].textContent).toContain('300 tiles');
    expect(screen.getByText(/Nova Roma/)).toBeTruthy();
  });

  it('connect sends the selected coordinates and closes', () => {
    openPicker();
    const onConnectionConnect = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={onClose} />, { clientCallbacks: createSpiedCallbacks({ onConnectionConnect }) });
    act(() => {
      useBuildingStore.getState().setConnectionResults([{ facilityName: 'Near Farm', companyName: 'B', x: 103, y: 104 }]);
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Near Farm' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect Selected/ }));
    expect(onConnectionConnect).toHaveBeenCalledWith('Cotton', 'input', [{ x: 103, y: 104 }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Del removes the selected rows from the list without connecting or re-searching', () => {
    openPicker();
    const onConnectionConnect = jest.fn();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onConnectionConnect, onConnectionSearch }),
    });
    act(() => {
      useBuildingStore.getState().setConnectionResults([
        { facilityName: 'Farm A', companyName: 'A', x: 101, y: 100 },
        { facilityName: 'Farm B', companyName: 'B', x: 102, y: 100 },
        { facilityName: 'Farm C', companyName: 'C', x: 103, y: 100 },
        { facilityName: 'Farm D', companyName: 'D', x: 104, y: 100 },
        { facilityName: 'Farm E', companyName: 'E', x: 105, y: 100 },
      ]);
    });
    expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(5);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Farm B' }));
    const rowD = screen.getByRole('checkbox', { name: 'Select Farm D' });
    fireEvent.click(rowD);
    fireEvent.keyDown(rowD, { key: 'Delete' });

    const remaining = screen.getAllByRole('checkbox', { name: /^Select / });
    expect(remaining.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Select Farm A', 'Select Farm C', 'Select Farm E',
    ]);
    expect(onConnectionConnect).not.toHaveBeenCalled();
    expect(onConnectionSearch).not.toHaveBeenCalled();
    // The removal is local: the store still holds all five results
    expect(useBuildingStore.getState().connectionPicker?.results).toHaveLength(5);
  });

  it('Select All after a prune covers only the rows still on screen', () => {
    openPicker();
    const onConnectionConnect = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onConnectionConnect }),
    });
    act(() => {
      useBuildingStore.getState().setConnectionResults([
        { facilityName: 'Farm A', companyName: 'A', x: 101, y: 100 },
        { facilityName: 'Farm B', companyName: 'B', x: 102, y: 100 },
        { facilityName: 'Farm C', companyName: 'C', x: 103, y: 100 },
      ]);
    });
    const rowB = screen.getByRole('checkbox', { name: 'Select Farm B' });
    fireEvent.click(rowB);
    fireEvent.keyDown(rowB, { key: 'Delete' });

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(screen.getByRole('button', { name: /Connect Selected/ }).textContent).toContain('(2)');
    fireEvent.click(screen.getByRole('button', { name: /Connect Selected/ }));
    expect(onConnectionConnect).toHaveBeenCalledWith('Cotton', 'input', [
      { x: 101, y: 100 }, { x: 103, y: 100 },
    ]);
  });

  it('double-clicking a row connects that row alone and closes', () => {
    openPicker();
    const onConnectionConnect = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={onClose} />, {
      clientCallbacks: createSpiedCallbacks({ onConnectionConnect }),
    });
    act(() => {
      useBuildingStore.getState().setConnectionResults([
        { facilityName: 'Near Farm', companyName: 'B', x: 103, y: 104 },
        { facilityName: 'Other Farm', companyName: 'C', x: 200, y: 200 },
      ]);
    });
    fireEvent.doubleClick(screen.getByText('Near Farm'));
    expect(onConnectionConnect).toHaveBeenCalledTimes(1);
    expect(onConnectionConnect).toHaveBeenCalledWith('Cotton', 'input', [{ x: 103, y: 104 }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the name filters say a partial name matches and Max defaults to 50, up to 150', () => {
    openPicker();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />);
    expect((screen.getByLabelText('Company') as HTMLInputElement).placeholder).toBe('Partial name matches');
    expect((screen.getByLabelText('Town') as HTMLInputElement).placeholder).toBe('Partial name matches');
    const max = screen.getByLabelText('Max') as HTMLInputElement;
    expect(max.value).toBe('50');
    expect(max.max).toBe('150');
  });

  it('Pick on map enters the connect mode without closing the picker (N10)', () => {
    openPicker();
    const onConnectionPickOnMap = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={onClose} />, { clientCallbacks: createSpiedCallbacks({ onConnectionPickOnMap }) });
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    expect(onConnectionPickOnMap).toHaveBeenCalledTimes(1);
    // The surface is hidden by the mode, never popped — its context survives
    expect(onClose).not.toHaveBeenCalled();
    expect(useBuildingStore.getState().connectionPicker?.fluidName).toBe('Cotton');
  });

  it('a supplier search with every box ticked sends Role 54', () => {
    // The four boxes of OutputSearchHandlerViewer.pas:337-351 — the `#54` of the
    // captured trace (src/server/__tests__/rdo/connection-search.test.ts:9).
    openPicker();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 54 });
  });

  it('a customer search with every box ticked sends Role 78, from its own boxes', () => {
    useBuildingStore.getState().setConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'output', buildingX: 100, buildingY: 100 });
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    expect(screen.getByText('Stores')).toBeTruthy();
    expect(screen.getByText('Import Warehouses')).toBeTruthy();
    expect(screen.queryByText('Trade Centers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 78 });
  });

  it('unticking Stores and Import Warehouses leaves a customer search on 6', () => {
    useBuildingStore.getState().setConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'output', buildingX: 100, buildingY: 100 });
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByLabelText('Stores'));
    fireEvent.click(screen.getByLabelText('Import Warehouses'));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    // rolProducer(2) | rolDistributer(4) — the two boxes both forms share
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 6 });
  });

  it('Factories alone sends Role 2 — rolProducer, with no fallback mask', () => {
    openPicker();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    for (const caption of ['Warehouses', 'Trade Centers', 'Export Warehouses']) {
      fireEvent.click(screen.getByLabelText(caption));
    }
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 2 });
  });

  it('the bridge stacks the picker on the building surface and closing pops it', () => {
    useUiStore.getState().setRootSurface({ kind: 'building' });
    ClientBridge.showConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'input', buildingX: 1, buildingY: 2 });
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building', 'supplierSearch']);
    ClientBridge.closeConnectionPicker();
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
    expect(useBuildingStore.getState().connectionPicker).toBeNull();
  });
});
