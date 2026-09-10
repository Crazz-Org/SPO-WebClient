/**
 * SupplierSearchModal — the role checkboxes, rendered.
 *
 * The sibling `SupplierSearchModal.test.ts` runs in the node project and only touches the
 * stores. What the mask on the wire is worth needs the form itself: this is always a supplier
 * search, so its four boxes are Voyager's supplier form and every box ticked is 54.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useProfileStore } from '../../store/profile-store';
import { SupplierSearchModal } from './SupplierSearchModal';

function openSupplierSearch() {
  useProfileStore.getState().openSupplierSearch('Coal', 'Coal');
  useUiStore.getState().openModal('supplierSearch');
}

describe('SupplierSearchModal (rendered)', () => {
  beforeEach(() => {
    useUiStore.getState().closeModal();
    useProfileStore.getState().clearSupplierSearch();
  });

  it('searches with 54 when every box is ticked', () => {
    openSupplierSearch();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });

    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch).toHaveBeenCalledTimes(1);
    expect(onConnectionSearch.mock.calls[0][3]).toBe('input');
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 54 });
  });

  it('unticking Export Warehouses drops rolCompExport (32)', () => {
    openSupplierSearch();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Export Warehouses' }));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 22 });
  });

  it('Factories alone sends rolProducer (2), never rolNeutral (1)', () => {
    openSupplierSearch();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });

    for (const name of ['Warehouses', 'Trade Centers', 'Export Warehouses']) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 2 });
  });
});
