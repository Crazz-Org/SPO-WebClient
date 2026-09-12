import { describe, it, expect } from '@jest/globals';
import { ALL_CONNECTION_ROLES, type ConnectionRoleFlags } from '@/shared/connection-roles';
import type { ConnectionSearchResult } from '@/shared/types';
import { excludeTradeCenters, supplierSearchMask, ASP_SUPPLIER_ROLES } from './supplier-search-filter';

const NO_ROLES: ConnectionRoleFlags = {
  producer: false,
  distributer: false,
  importer: false,
  exporter: false,
  buyer: false,
  compImporter: false,
};

const fixture: ConnectionSearchResult[] = [
  { facilityName: 'Drug Plant', companyName: 'A', x: 1, y: 1, town: 'Nova Roma' },
  { facilityName: 'Trade Center', companyName: 'B', x: 2, y: 2, town: 'Helartia' },
  { facilityName: 'Warehouse', companyName: 'C', x: 3, y: 3 },
  { facilityName: 'Trade Center', companyName: 'D', x: 4, y: 4, town: 'Nova Roma' },
  { facilityName: 'Export Warehouse', companyName: 'E', x: 5, y: 5 },
];

describe('excludeTradeCenters', () => {
  it('drops the two Trade Centers of a five-row fixture, keeping the order', () => {
    const kept = excludeTradeCenters(fixture);
    expect(kept).toHaveLength(3);
    expect(kept.map((r) => r.facilityName)).toEqual(['Drug Plant', 'Warehouse', 'Export Warehouse']);
    expect(kept.some((r) => r.facilityName === 'Trade Center')).toBe(false);
  });

  it('matches exactly, as the ASP `<>` does', () => {
    const kept = excludeTradeCenters([
      { facilityName: 'Trade Center 2', companyName: 'A', x: 1, y: 1 },
      { facilityName: 'trade center', companyName: 'B', x: 2, y: 2 },
      { facilityName: 'Trade Center', companyName: 'C', x: 3, y: 3 },
    ]);
    expect(kept.map((r) => r.facilityName)).toEqual(['Trade Center 2', 'trade center']);
  });

  it('leaves an empty list empty', () => {
    expect(excludeTradeCenters([])).toEqual([]);
  });
});

describe('supplierSearchMask', () => {
  it('asks for rolDistributer alone when the toggle is on, whatever the boxes say', () => {
    expect(supplierSearchMask(true, ALL_CONNECTION_ROLES)).toBe(4);
    expect(supplierSearchMask(true, NO_ROLES)).toBe(4);
    expect(supplierSearchMask(true, ASP_SUPPLIER_ROLES)).toBe(4);
  });

  it('is the ticked boxes when the toggle is off', () => {
    // producers(2) + distributers(4) + importers(16) — TycoonSuppliesSearch.asp:29
    expect(supplierSearchMask(false, ASP_SUPPLIER_ROLES)).toBe(22);
    expect(supplierSearchMask(false, ALL_CONNECTION_ROLES)).toBe(54);
    expect(supplierSearchMask(false, NO_ROLES)).toBe(0);
  });
});

describe('ASP_SUPPLIER_ROLES', () => {
  it('opens with producers, warehouses and trade centers, but not export warehouses', () => {
    expect(ASP_SUPPLIER_ROLES.producer).toBe(true);
    expect(ASP_SUPPLIER_ROLES.distributer).toBe(true);
    expect(ASP_SUPPLIER_ROLES.importer).toBe(true);
    expect(ASP_SUPPLIER_ROLES.exporter).toBe(false);
  });
});
