/**
 * SupplierSearchModal, rendered.
 *
 * `SupplierSearchModal.test.ts` is a node suite: it drives the stores and never
 * mounts the component, so the mask this dialog builds — the one thing a wrong
 * checkbox table gets wrong — had nothing asserting it. This suite clicks the
 * real boxes and reads the `Role` the dialog hands the bridge.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
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

  it('searches suppliers with Role 54 when every box is ticked', () => {
    open();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    // rolProducer(2) | rolDistributer(4) | rolImporter(16) | rolCompExport(32)
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 54 });
    expect(onConnectionSearch.mock.calls[0][3]).toBe('input');
  });

  it('unticking Export Warehouses drops rolCompExport, leaving 22', () => {
    open();
    const onConnectionSearch = jest.fn();
    renderWithProviders(<SupplierSearchModal />, { clientCallbacks: createSpiedCallbacks({ onConnectionSearch }) });
    fireEvent.click(screen.getByLabelText('Export Warehouses'));
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(onConnectionSearch.mock.calls[0][4]).toMatchObject({ roles: 22 });
  });
});
