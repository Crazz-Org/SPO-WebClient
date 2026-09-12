/**
 * SupplierSearchModal, rendered.
 *
 * `SupplierSearchModal.test.ts` is a node suite: it drives the stores and never
 * mounts the component, so the mask this dialog builds — the one thing a wrong
 * checkbox table gets wrong — had nothing asserting it. This suite clicks the
 * real boxes and reads the `Role` the dialog hands the bridge.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useProfileStore } from '../../store/profile-store';
import { SupplierSearchModal } from './SupplierSearchModal';

function open() {
  useProfileStore.getState().openSupplierSearch('Drugs', 'Drugs');
  useUiStore.getState().openModal('supplierSearch');
}

describe('SupplierSearchModal (rendered)', () => {
  beforeEach(() => {
    useUiStore.getState().closeModal();
    useProfileStore.getState().clearSupplierSearch();
  });

  it('opens on Role 22 — producers + importers + distributers, TycoonSuppliesSearch.asp:29', () => {
    open();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    // rolProducer(2) | rolDistributer(4) | rolImporter(16)
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 22 });
    expect(onConnectionSearch.mock.calls[0][3]).toBe('input');
  });

  it('ticking Export Warehouses adds rolCompExport, giving 54', () => {
    open();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByLabelText('Export Warehouses'));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 54 });
  });

  it('Warehouses only disables the role boxes and searches rolDistributer alone', () => {
    open();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    const boxes = ['Factories', 'Warehouses', 'Trade Centers', 'Export Warehouses'];

    fireEvent.click(screen.getByLabelText('Warehouses only'));
    for (const name of boxes) {
      expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 4 });

    fireEvent.click(screen.getByLabelText('Warehouses only'));
    for (const name of boxes) {
      expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(false);
    }
  });

  it('Trade Center rows never reach the list', () => {
    open();
    const onProfileAutoConnectionAction = jest.fn();
    renderWithProviders(<SupplierSearchModal />, {
      clientCallbacks: createSpiedCallbacks({ onProfileAutoConnectionAction }),
    });
    act(() => {
      useProfileStore.getState().setSupplierSearchResults([
        { facilityName: 'Plant A', companyName: 'A', x: 101, y: 100 },
        { facilityName: 'Trade Center', companyName: 'B', x: 102, y: 100 },
        { facilityName: 'Warehouse C', companyName: 'C', x: 103, y: 100 },
        { facilityName: 'Trade Center', companyName: 'D', x: 104, y: 100 },
        { facilityName: 'Plant E', companyName: 'E', x: 105, y: 100 },
      ]);
    });
    expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(3);
    expect(screen.queryByText('Trade Center')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Selected/ }));
    expect(onProfileAutoConnectionAction.mock.calls.map((c) => c[2])).toEqual([
      '101,100,', '103,100,', '105,100,',
    ]);
  });

  it('shows the town of a result, as the connection picker does', () => {
    open();
    renderWithProviders(<SupplierSearchModal />);
    act(() => {
      useProfileStore.getState().setSupplierSearchResults([
        { facilityName: 'Drug Plant', companyName: 'A', x: 103, y: 104, town: 'Nova Roma' },
      ]);
    });
    expect(screen.getByText(/Nova Roma/)).toBeTruthy();
  });

  it('Del removes the selected rows from the list without adding or re-searching', () => {
    open();
    const onProfileAutoConnectionAction = jest.fn();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, {
      clientCallbacks: createSpiedCallbacks({ onProfileAutoConnectionAction, onConnectionSearch }),
    });
    act(() => {
      useProfileStore.getState().setSupplierSearchResults([
        { facilityName: 'Plant A', companyName: 'A', x: 101, y: 100 },
        { facilityName: 'Plant B', companyName: 'B', x: 102, y: 100 },
        { facilityName: 'Plant C', companyName: 'C', x: 103, y: 100 },
        { facilityName: 'Plant D', companyName: 'D', x: 104, y: 100 },
        { facilityName: 'Plant E', companyName: 'E', x: 105, y: 100 },
      ]);
    });
    expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(5);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Plant B' }));
    const rowD = screen.getByRole('checkbox', { name: 'Select Plant D' });
    fireEvent.click(rowD);
    fireEvent.keyDown(rowD, { key: 'Delete' });

    const remaining = screen.getAllByRole('checkbox', { name: /^Select / });
    expect(remaining.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Select Plant A', 'Select Plant C', 'Select Plant E',
    ]);
    expect(onProfileAutoConnectionAction).not.toHaveBeenCalled();
    expect(onConnectionSearch).not.toHaveBeenCalled();
    expect(useProfileStore.getState().supplierSearchResults).toHaveLength(5);
  });

  it('Select All after a prune covers only the rows still on screen', () => {
    open();
    const onProfileAutoConnectionAction = jest.fn();
    renderWithProviders(<SupplierSearchModal />, {
      clientCallbacks: createSpiedCallbacks({ onProfileAutoConnectionAction }),
    });
    act(() => {
      useProfileStore.getState().setSupplierSearchResults([
        { facilityName: 'Plant A', companyName: 'A', x: 101, y: 100 },
        { facilityName: 'Plant B', companyName: 'B', x: 102, y: 100 },
        { facilityName: 'Plant C', companyName: 'C', x: 103, y: 100 },
      ]);
    });
    const rowB = screen.getByRole('checkbox', { name: 'Select Plant B' });
    fireEvent.click(rowB);
    fireEvent.keyDown(rowB, { key: 'Delete' });

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(screen.getByRole('button', { name: /Add Selected/ }).textContent).toContain('(2)');
    fireEvent.click(screen.getByRole('button', { name: /Add Selected/ }));
    expect(onProfileAutoConnectionAction.mock.calls.map((c) => c[2])).toEqual(['101,100,', '103,100,']);
  });

  it('double-clicking a row adds that row alone and closes', () => {
    open();
    const onProfileAutoConnectionAction = jest.fn();
    renderWithProviders(<SupplierSearchModal />, {
      clientCallbacks: createSpiedCallbacks({ onProfileAutoConnectionAction }),
    });
    act(() => {
      useProfileStore.getState().setSupplierSearchResults([
        { facilityName: 'Drug Plant', companyName: 'A', x: 103, y: 104 },
        { facilityName: 'Other Plant', companyName: 'B', x: 200, y: 200 },
      ]);
    });
    fireEvent.doubleClick(screen.getByText('Drug Plant'));
    expect(onProfileAutoConnectionAction).toHaveBeenCalledTimes(1);
    expect(onProfileAutoConnectionAction).toHaveBeenCalledWith('add', 'Drugs', '103,104,');
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('the name filters say a partial name matches and Max defaults to 50, up to 150', () => {
    open();
    renderWithProviders(<SupplierSearchModal />);
    expect((screen.getByLabelText('Company') as HTMLInputElement).placeholder).toBe('Partial name matches');
    expect((screen.getByLabelText('Town') as HTMLInputElement).placeholder).toBe('Partial name matches');
    const max = screen.getByLabelText('Max') as HTMLInputElement;
    expect(max.value).toBe('50');
    expect(max.max).toBe('150');
  });
});
