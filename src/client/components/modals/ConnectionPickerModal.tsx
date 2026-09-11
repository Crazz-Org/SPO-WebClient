/**
 * ConnectionPicker — find suppliers / clients for a building fluid connection.
 *
 * `ConnectionPickerContent` is the body (filters, results, footer) and is what the universal
 * sheet shows as the `supplierSearch` surface, STACKED on the building (T3 handoff): the
 * inspector stays underneath, one chip away. `ConnectionPickerModal` keeps the historical
 * modal shape for the legacy `modal: 'connectionPicker'` path.
 *
 * Filters are remembered for the session (ui-store.connectionFilters) and Enter in any filter
 * field runs the search — the audit found both missing (B4). Results are sorted by distance
 * from the building, computed locally from the coordinates the server already returns.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { rolesToMask } from '@/shared/connection-roles';
import styles from './ConnectionPickerModal.module.css';

export interface ConnectionPickerContentProps {
  /** Called when the picker is dismissed (the sheet pops the surface; the modal closes). */
  onClose: () => void;
  /** Show the "Find Suppliers for: X" heading (the sheet already names the surface). */
  showTitle?: boolean;
  /** Wrap in the modal frame's scrollable body (legacy modal). */
  className?: string;
}

export function ConnectionPickerContent({ onClose, showTitle = true, className }: ConnectionPickerContentProps) {
  const picker = useBuildingStore((s) => s.connectionPicker);
  const clearConnectionPicker = useBuildingStore((s) => s.clearConnectionPicker);
  const remembered = useUiStore((s) => s.connectionFilters);
  const setConnectionFilters = useUiStore((s) => s.setConnectionFilters);

  const [company, setCompany] = useState(remembered.company);
  const [town, setTown] = useState(remembered.town);
  const [maxResults, setMaxResults] = useState(remembered.maxResults);
  const [roles, setRoles] = useState(remembered.roles);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const client = useClient();
  const companyRef = useRef<HTMLInputElement>(null);

  // Focus the first filter on open; the filter values themselves are remembered
  useEffect(() => {
    requestAnimationFrame(() => companyRef.current?.focus());
  }, []);

  // Clear selection when results change
  useEffect(() => {
    setSelectedIndices(new Set());
  }, [picker?.results]);

  const handleClose = useCallback(() => {
    clearConnectionPicker();
    onClose();
  }, [clearConnectionPicker, onClose]);

  const handleSearch = useCallback(() => {
    if (!picker) return;

    // The direction decides which boxes count — the other direction's flags are
    // remembered but never sent (connection-roles.ts).
    const rolesMask = rolesToMask(picker.direction, roles);

    setConnectionFilters({ company, town, maxResults, roles });
    client.onConnectionSearch(
      picker.buildingX,
      picker.buildingY,
      picker.fluidId,
      picker.direction,
      {
        company: company || undefined,
        town: town || undefined,
        maxResults: parseInt(maxResults) || 20,
        roles: rolesMask,
      },
    );
  }, [picker, company, town, maxResults, roles, client, setConnectionFilters]);

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
    if (!picker) return;
    const all = new Set<number>();
    for (let i = 0; i < picker.results.length; i++) all.add(i);
    setSelectedIndices(all);
  }, [picker]);

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleConnect = useCallback(() => {
    if (!picker || selectedIndices.size === 0) return;

    const coords = Array.from(selectedIndices)
      .map((i) => picker.results[i])
      .filter(Boolean)
      .map((r) => ({ x: r.x, y: r.y }));

    client.onConnectionConnect(picker.fluidId, picker.direction, coords);
    handleClose();
  }, [picker, selectedIndices, handleClose, client]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    },
    [handleClose],
  );

  // Enter in a filter field runs the search (B4)
  const onFilterKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch],
  );

  // Results with a local distance from the building, nearest first
  const sorted = useMemo(() => {
    if (!picker) return [];
    const bx = picker.buildingX;
    const by = picker.buildingY;
    return picker.results
      .map((r, i) => ({ r, i, d: Math.round(Math.hypot(r.x - bx, r.y - by)) }))
      .sort((a, b) => a.d - b.d);
  }, [picker]);

  if (!picker) return null;

  const dirLabel = picker.direction === 'input' ? 'Find Suppliers' : 'Find Clients';
  const results = picker.results;

  return (
    <div className={`${styles.body} ${className ?? ''}`} onKeyDown={handleKeyDown}>
        {/* Header */}
        {showTitle && (
          <div className={styles.header}>
            <h2 className={styles.title}>
              {dirLabel} for: <span className={styles.fluidName}>{picker.fluidName}</span>
            </h2>
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className={styles.filters}>
          <div className={styles.filterRow}>
            <div className={styles.filterField}>
              <label className={styles.filterLabel} htmlFor="cp-company">Company</label>
              <input
                id="cp-company"
                ref={companyRef}
                className={styles.filterInput}
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                onKeyDown={onFilterKeyDown}
              />
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel} htmlFor="cp-town">Town</label>
              <input
                id="cp-town"
                className={styles.filterInput}
                type="text"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                onKeyDown={onFilterKeyDown}
              />
            </div>
            <div className={styles.filterFieldSmall}>
              <label className={styles.filterLabel} htmlFor="cp-max">Max</label>
              <input
                id="cp-max"
                className={styles.filterInput}
                type="number"
                min="1"
                max="100"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                onKeyDown={onFilterKeyDown}
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
            {/* The last two boxes are the direction's own, as in Voyager:
                OutputSearchHandlerViewer.pas:337-351 offers Trade Centers and
                Export Warehouses; InputSearchHandlerViewer.pas:313-327 offers
                Stores and Import Warehouses. */}
            {picker.direction === 'output' ? (
              <>
                <label className={styles.roleLabel}>
                  <input
                    type="checkbox"
                    checked={roles.buyer}
                    onChange={(e) => setRoles((r) => ({ ...r, buyer: e.target.checked }))}
                  />
                  Stores
                </label>
                <label className={styles.roleLabel}>
                  <input
                    type="checkbox"
                    checked={roles.compImporter}
                    onChange={(e) => setRoles((r) => ({ ...r, compImporter: e.target.checked }))}
                  />
                  Import Warehouses
                </label>
              </>
            ) : (
              <>
                <label className={styles.roleLabel}>
                  <input
                    type="checkbox"
                    checked={roles.importer}
                    onChange={(e) => setRoles((r) => ({ ...r, importer: e.target.checked }))}
                  />
                  Trade Centers
                </label>
                <label className={styles.roleLabel}>
                  <input
                    type="checkbox"
                    checked={roles.exporter}
                    onChange={(e) => setRoles((r) => ({ ...r, exporter: e.target.checked }))}
                  />
                  Export Warehouses
                </label>
              </>
            )}
            <button
              className={styles.searchBtn}
              onClick={handleSearch}
              disabled={picker.isSearching}
            >
              <Search size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {picker.isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className={styles.results}>
          {picker.isSearching ? (
            <div className={styles.emptyState}>Searching...</div>
          ) : results.length === 0 ? (
            <div className={styles.emptyState}>
              {picker.results === undefined || picker.results.length === 0
                ? 'Click Search to find available connections'
                : 'No facilities found'}
            </div>
          ) : (
            sorted.map(({ r, i, d }) => (
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
                  aria-label={`Select ${r.facilityName}`}
                />
                <div className={styles.resultInfo}>
                  <div className={styles.resultName}>{r.facilityName}</div>
                  <div className={styles.resultMeta}>
                    {r.companyName}
                    {r.town ? ` · ${r.town}` : ''}
                    {r.price ? ` — $${r.price}` : ''}
                    {r.quality ? ` (Q: ${r.quality})` : ''}
                    {` · ${d} tiles`}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {/* N10 — Voyager's PICKONMAP (MapIsoHandler.pas:277-285): pick the
              supplier by clicking the map. Always offered — often faster than
              scanning a list when the player can see the building. */}
          <button className={styles.secondaryBtn} onClick={() => client.onConnectionPickOnMap()}>
            Pick on map
          </button>
          <button className={styles.secondaryBtn} onClick={selectAll} disabled={results.length === 0}>
            Select All
          </button>
          <button className={styles.secondaryBtn} onClick={clearSelection} disabled={selectedIndices.size === 0}>
            Clear
          </button>
          <button
            className={styles.connectBtn}
            onClick={handleConnect}
            disabled={selectedIndices.size === 0}
          >
            Connect Selected ({selectedIndices.size})
          </button>
        </div>
    </div>
  );
}

/** Legacy modal shape — nothing opens it since the picker became a sheet surface, kept for the `modal` path. */
export function ConnectionPickerModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const picker = useBuildingStore((s) => s.connectionPicker);

  if (modal !== 'connectionPicker' || !picker) return null;
  const dirLabel = picker.direction === 'input' ? 'Find Suppliers' : 'Find Clients';

  return (
    <>
      <div className={styles.backdrop} onClick={closeModal} aria-hidden="true" />
      <div className={styles.modal} role="dialog" aria-label={`${dirLabel} for ${picker.fluidName}`}>
        <ConnectionPickerContent onClose={closeModal} />
      </div>
    </>
  );
}
