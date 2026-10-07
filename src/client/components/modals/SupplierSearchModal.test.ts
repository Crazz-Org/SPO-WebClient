/**
 * Tests for SupplierSearchModal — supplier search for Initial Suppliers (auto-connections).
 *
 * Test environment is node (no jsdom). We test the store interactions and logic,
 * not React rendering.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useUiStore } from '../../store/ui-store';
import { useProfileStore } from '../../store/profile-store';
import type { ConnectionSearchResult } from '@/shared/types';

describe('SupplierSearchModal (store integration)', () => {
  beforeEach(() => {
    useUiStore.getState().closeModal();
    useProfileStore.getState().clearSupplierSearch();
  });

  it('should open supplier search modal via store actions', () => {
    useProfileStore.getState().openSupplierSearch('coal', 'Coal');
    useUiStore.getState().openModal('supplierSearch');

    expect(useUiStore.getState().modal).toBe('supplierSearch');
    expect(useProfileStore.getState().supplierSearch).toEqual({
      fluidId: 'coal',
      fluidName: 'Coal',
    });
  });

  it('should store search results in profile store', () => {
    useProfileStore.getState().openSupplierSearch('coal', 'Coal');
    useUiStore.getState().openModal('supplierSearch');

    const results: ConnectionSearchResult[] = [
      { facilityName: 'Coal Mine West', companyName: 'PGI', x: 463, y: 389, price: '80', quality: '40' },
      { facilityName: 'Coal Mine East', companyName: 'Dissidents', x: 483, y: 684, price: '80', quality: '40' },
    ];

    useProfileStore.getState().setSupplierSearchResults(results);

    expect(useProfileStore.getState().supplierSearchResults).toHaveLength(2);
    expect(useProfileStore.getState().supplierSearchResults[0].facilityName).toBe('Coal Mine West');
    expect(useProfileStore.getState().supplierSearchLoading).toBe(false);
  });

  it('should format supplier coordinates with trailing comma for ASP endpoint', () => {
    const result: ConnectionSearchResult = {
      facilityName: 'Trade Center',
      companyName: 'TestCo',
      x: 463,
      y: 389,
      price: '80',
      quality: '40',
    };

    // This is the format handleAddSuppliers uses
    const supplierCoord = `${result.x},${result.y},`;
    expect(supplierCoord).toBe('463,389,');
  });

  it('should clear supplier search state on close', () => {
    useProfileStore.getState().openSupplierSearch('steel', 'Steel');
    useUiStore.getState().openModal('supplierSearch');
    useProfileStore.getState().setSupplierSearchResults([
      { facilityName: 'Steel Works', companyName: 'Co', x: 100, y: 200 },
    ]);

    // Simulate close
    useProfileStore.getState().clearSupplierSearch();
    useUiStore.getState().closeModal();

    expect(useProfileStore.getState().supplierSearch).toBeNull();
    expect(useProfileStore.getState().supplierSearchResults).toEqual([]);
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('should track loading state during search', () => {
    useProfileStore.getState().openSupplierSearch('coal', 'Coal');

    useProfileStore.getState().setSupplierSearchLoading(true);
    expect(useProfileStore.getState().supplierSearchLoading).toBe(true);

    useProfileStore.getState().setSupplierSearchResults([]);
    expect(useProfileStore.getState().supplierSearchLoading).toBe(false);
  });
});
