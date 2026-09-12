/**
 * SupplierSearchModal — Find suppliers to add as Initial Suppliers (auto-connections).
 *
 * Uses the same FindSuppliers RDO search as ConnectionPickerModal but routes results
 * to profile-store and commits via the auto-connection ASP action.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useProfileStore } from '../../store/profile-store';
import { useClient } from '../../context';
import { type ConnectionRoleFlags } from '@/shared/connection-roles';
import { excludeTradeCenters, supplierSearchMask, ASP_SUPPLIER_ROLES } from './supplier-search-filter';
import type { ConnectionSearchResult } from '@/shared/types';
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
  const [maxResults, setMaxResults] = useState('50');
  const [roles, setRoles] = useState<ConnectionRoleFlags>(ASP_SUPPLIER_ROLES);
  /** `OnlyDist` of TycoonSuppliesSearch.asp:26-30 — overrides the boxes entirely. */
  const [warehousesOnly, setWarehousesOnly] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  /** Rows pruned with `Del` — local to the dialog, the store's results are never touched. */
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());

  const client = useClient();
  const companyRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (modal === 'supplierSearch') {
      setCompany('');
      setTown('');
      setMaxResults('50');
      setRoles(ASP_SUPPLIER_ROLES);
      setWarehousesOnly(false);
      setSelectedIndices(new Set());
      setHiddenIndices(new Set());
      requestAnimationFrame(() => companyRef.current?.focus());
    }
  }, [modal]);

  // Clear selection when results change
  useEffect(() => {
    setSelectedIndices(new Set());
    setHiddenIndices(new Set());
  }, [results]);

  const handleClose = useCallback(() => {
    clearSupplierSearch();
    closeModal();
  }, [clearSupplierSearch, closeModal]);

  const handleSearch = useCallback(() => {
    if (!supplierSearch) return;

    useProfileStore.getState().setSupplierSearchLoading(true);

    // This dialog only ever searches suppliers (connection-roles.ts).
    const rolesMask = supplierSearchMask(warehousesOnly, roles);

    // Use (0,0) as building coords — profile-level search, not building-specific
    client.onConnectionSearch(
      0, 0,
      supplierSearch.fluidId,
      'input',
      {
        company: company || undefined,
        town: town || undefined,
        maxResults: parseInt(maxResults) || 50,
        roles: rolesMask,
      },
    );
  }, [supplierSearch, company, town, maxResults, roles, warehousesOnly, client]);

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

  /** Trade Centers never reach this list (TycoonSuppliesSearch.asp:43-44); the store keeps them. */
  const rows = useMemo(() => excludeTradeCenters(results), [results]);

  // Rows pruned with Del disappear from the list without leaving the store
  const visible = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ i }) => !hiddenIndices.has(i)),
    [rows, hiddenIndices],
  );

  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      if (!hiddenIndices.has(i)) all.add(i);
    }
    setSelectedIndices(all);
  }, [rows, hiddenIndices]);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleAddSuppliers = useCallback(() => {
    if (!supplierSearch || selectedIndices.size === 0) return;

    const selected = Array.from(selectedIndices)
      .map((i) => rows[i])
      .filter(Boolean);

    // Call add action for each selected supplier (format: "x,y,")
    for (const r of selected) {
      client.onProfileAutoConnectionAction('add', supplierSearch.fluidId, `${r.x},${r.y},`);
    }

    handleClose();
  }, [supplierSearch, selectedIndices, rows, handleClose, client]);

  /** Double-click commits one row, the same way the footer commits the selection. */
  const commitRow = useCallback(
    (r: ConnectionSearchResult) => {
      if (!supplierSearch) return;
      client.onProfileAutoConnectionAction('add', supplierSearch.fluidId, `${r.x},${r.y},`);
      handleClose();
    },
    [supplierSearch, client, handleClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
      // Del prunes the selected rows from the list — local only, nothing is sent
      // (Voyager: OutputSearchHandlerViewer.pas:363-372).
      if (e.key === 'Delete') {
        const target = e.target as HTMLElement;
        if (target instanceof HTMLInputElement && target.type !== 'checkbox') return;
        if (selectedIndices.size === 0) return;
        e.preventDefault();
        setHiddenIndices((prev) => {
          const next = new Set(prev);
          for (const i of selectedIndices) next.add(i);
          return next;
        });
        setSelectedIndices(new Set());
      }
    },
    [handleClose, selectedIndices],
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
              <label className={styles.filterLabel} htmlFor="ss-company">Company</label>
              <input
                id="ss-company"
                ref={companyRef}
                className={styles.filterInput}
                type="text"
                value={company}
                placeholder="Partial name matches"
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel} htmlFor="ss-town">Town</label>
              <input
                id="ss-town"
                className={styles.filterInput}
                type="text"
                value={town}
                placeholder="Partial name matches"
                onChange={(e) => setTown(e.target.value)}
              />
            </div>
            <div className={styles.filterFieldSmall}>
              <label className={styles.filterLabel} htmlFor="ss-max">Max</label>
              <input
                id="ss-max"
                className={styles.filterInput}
                type="number"
                min="1"
                max="150"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.rolesRow}>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={warehousesOnly}
                onChange={(e) => setWarehousesOnly(e.target.checked)}
              />
              Warehouses only
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.producer}
                disabled={warehousesOnly}
                onChange={(e) => setRoles((r) => ({ ...r, producer: e.target.checked }))}
              />
              Factories
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.distributer}
                disabled={warehousesOnly}
                onChange={(e) => setRoles((r) => ({ ...r, distributer: e.target.checked }))}
              />
              Warehouses
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.importer}
                disabled={warehousesOnly}
                onChange={(e) => setRoles((r) => ({ ...r, importer: e.target.checked }))}
              />
              Trade Centers
            </label>
            <label className={styles.roleLabel}>
              <input
                type="checkbox"
                checked={roles.exporter}
                disabled={warehousesOnly}
                onChange={(e) => setRoles((r) => ({ ...r, exporter: e.target.checked }))}
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
          ) : visible.length === 0 ? (
            <div className={styles.emptyState}>
              {rows.length === 0
                ? 'Click Search to find available suppliers'
                : 'No facilities found'}
            </div>
          ) : (
            visible.map(({ r, i }) => (
              <div
                key={`${r.x}-${r.y}`}
                className={styles.resultRow}
                onClick={() => toggleIndex(i)}
                onDoubleClick={() => commitRow(r)}
              >
                <input
                  type="checkbox"
                  className={styles.resultCheckbox}
                  checked={selectedIndices.has(i)}
                  onChange={() => toggleIndex(i)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${r.facilityName}`}
                />
                <div className={styles.resultInfo}>
                  <div className={styles.resultName}>{r.facilityName}</div>
                  <div className={styles.resultMeta}>
                    {r.companyName}
                    {r.town ? ` · ${r.town}` : ''}
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
          <button className={styles.secondaryBtn} onClick={selectAll} disabled={rows.length === 0}>
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
