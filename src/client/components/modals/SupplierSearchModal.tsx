/**
 * SupplierSearchModal — Find suppliers to add as Initial Suppliers (auto-connections).
 *
 * Uses the same FindSuppliers RDO search as ConnectionPickerModal but routes results
 * to profile-store and commits via the auto-connection ASP action.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useProfileStore } from '../../store/profile-store';
import { useClient } from '../../context';
import { ALL_CONNECTION_ROLES, rolesToMask, type ConnectionRoleFlags } from '@/shared/connection-roles';
import styles from './ConnectionPickerModal.module.css';

export function SupplierSearchModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const supplierSearch = useProfileStore((s) => s.supplierSearch);
  const results = useProfileStore((s) => s.supplierSearchResults);
  const isSearching = useProfileStore((s) => s.supplierSearchLoading);
  const clearSupplierSearch = useProfileStore((s) => s.clearSupplierSearch);

  const [company, setCompany] = useState('');
  const [town, setTown] = useState('');
  const [maxResults, setMaxResults] = useState('20');
  const [roles, setRoles] = useState<ConnectionRoleFlags>(ALL_CONNECTION_ROLES);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const client = useClient();
  const companyRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (modal === 'supplierSearch') {
      setCompany('');
      setTown('');
      setMaxResults('20');
      setRoles(ALL_CONNECTION_ROLES);
      setSelectedIndices(new Set());
      requestAnimationFrame(() => companyRef.current?.focus());
    }
  }, [modal]);

  // Clear selection when results change
  useEffect(() => {
    setSelectedIndices(new Set());
  }, [results]);

  const handleClose = useCallback(() => {
    clearSupplierSearch();
    closeModal();
  }, [clearSupplierSearch, closeModal]);

  const handleSearch = useCallback(() => {
    if (!supplierSearch) return;

    useProfileStore.getState().setSupplierSearchLoading(true);

    // Use (0,0) as building coords — profile-level search, not building-specific
    client.onConnectionSearch(
      0, 0,
      supplierSearch.fluidId,
      'input',
      {
        company: company || undefined,
        town: town || undefined,
        maxResults: parseInt(maxResults) || 20,
        // Always a supplier search, so the mask is the 'input' one — 54 with every box ticked.
        roles: rolesToMask('input', roles),
      },
    );
  }, [supplierSearch, company, town, maxResults, roles, client]);

  const toggleIndex = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < results.length; i++) all.add(i);
    setSelectedIndices(all);
  }, [results]);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleAddSuppliers = useCallback(() => {
    if (!supplierSearch || selectedIndices.size === 0) return;

    const selected = Array.from(selectedIndices)
      .map((i) => results[i])
      .filter(Boolean);

    // Call add action for each selected supplier (format: "x,y,")
    for (const r of selected) {
      client.onProfileAutoConnectionAction('add', supplierSearch.fluidId, `${r.x},${r.y},`);
    }

    handleClose();
  }, [supplierSearch, selectedIndices, results, handleClose, client]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    },
    [handleClose],
  );

  if (modal !== 'supplierSearch' || !supplierSearch) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={handleClose} aria-hidden="true" />
      <div
        className={styles.modal}
        role="dialog"
        aria-label={`Find supplier for ${supplierSearch.fluidName}`}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            Find Supplier for: <span className={styles.fluidName}>{supplierSearch.fluidName}</span>
          </h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Filters */}
        <div className={styles.filters}>
          <div className={styles.filterRow}>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>Company</label>
              <input
                ref={companyRef}
                className={styles.filterInput}
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel}>Town</label>
              <input
                className={styles.filterInput}
                type="text"
                value={town}
                onChange={(e) => setTown(e.target.value)}
              />
            </div>
            <div className={styles.filterFieldSmall}>
              <label className={styles.filterLabel}>Max</label>
              <input
                className={styles.filterInput}
                type="number"
                min="1"
                max="100"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.rolesRow}>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.producer}
                onChange={(e) => setRoles((r) => ({ ...r, producer: e.target.checked }))}
              />
              Factories
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.distributer}
                onChange={(e) => setRoles((r) => ({ ...r, distributer: e.target.checked }))}
              />
              Warehouses
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.importer}
                onChange={(e) => setRoles((r) => ({ ...r, importer: e.target.checked }))}
              />
              Trade Centers
            </label>
            {/* A supplier search, so the fourth box is Voyager's cbExportWarehouses
                (OutputSearchHandlerViewer.pas:341-342) — rolCompExport, not a "Stores" box. */}
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.compExport}
                onChange={(e) => setRoles((r) => ({ ...r, compExport: e.target.checked }))}
              />
              Export Warehouses
            </label>
            <button
              className={styles.searchBtn}
              onClick={handleSearch}
              disabled={isSearching}
            >
              <Search size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className={styles.results}>
          {isSearching ? (
            <div className={styles.emptyState}>Searching...</div>
          ) : results.length === 0 ? (
            <div className={styles.emptyState}>
              Click Search to find available suppliers
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={`${r.x}-${r.y}`}
                className={styles.resultRow}
                onClick={() => toggleIndex(i)}
              >
                <input
                  type="checkbox"
                  className={styles.resultCheckbox}
                  checked={selectedIndices.has(i)}
                  onChange={() => toggleIndex(i)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className={styles.resultInfo}>
                  <div className={styles.resultName}>{r.facilityName}</div>
                  <div className={styles.resultMeta}>
                    {r.companyName}
                    {r.price ? ` — $${r.price}` : ''}
                    {r.quality ? ` (Q: ${r.quality})` : ''}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.secondaryBtn} onClick={selectAll} disabled={results.length === 0}>
            Select All
          </button>
          <button className={styles.secondaryBtn} onClick={clearSelection} disabled={selectedIndices.size === 0}>
            Clear
          </button>
          <button
            className={styles.connectBtn}
            onClick={handleAddSuppliers}
            disabled={selectedIndices.size === 0}
          >
            Add Selected ({selectedIndices.size})
          </button>
        </div>
      </div>
    </>
  );
}
