/**
 * ConnectionPicker — find suppliers / clients for a building fluid connection.
 *
 * `ConnectionPickerContent` is the body (filters, results, footer) and is what the universal
 * sheet shows as the `supplierSearch` surface, STACKED on the building (T3 handoff): the
 * inspector stays underneath, one chip away. `ConnectionPickerModal` keeps the historical
 * modal shape for the legacy `modal: 'connectionPicker'` path.
 *
 * Filters are remembered for the session (ui-store.connectionFilters) and Enter in any filter
 * field runs the search — the audit found both missing (B4). A supplier search shows the rows
 * in the order the cache server returned them — the delivered-cost order, price plus transport
 * (`Cache/FluidLinks.pas:9-11`, `Cache/OutputSearch.pas:90-93`) — and nothing re-sorts them.
 * Quality re-issues the search with `SortMode = 2`; Distance is the only local mode, computed
 * from the coordinates the server already returns. A customer search has no such control: the
 * server answers nearest-first whatever mode it was sent (`Cache/InputSearch.pas:90-96`).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { rolesToMask } from '@/shared/connection-roles';
import type { ConnectionSearchResult } from '@/shared/types';
import { reachabilityKey } from '../../store/building-store';
import type { RoadReachability } from '@/shared/road-circuits';
import styles from './ConnectionPickerModal.module.css';

/**
 * The road flag text for a row (issue #584). `undefined` means no answer has
 * arrived yet — `TFluidLink.Intercept` (`~/SPO-Original/Cache/FluidLinks.pas:121`).
 * The gateway resolves it after the results are already on screen, so a row is
 * always usable — nothing here disables selection or connecting.
 */
const ROAD_FLAG_TEXT: Record<RoadReachability, string> = {
  connected: 'Road: connected',
  isolated: 'Road: not connected',
  unknown: 'Road: unknown',
};

const ROAD_FLAG_CLASS: Record<RoadReachability, string> = {
  connected: styles.roadConnected,
  isolated: styles.roadIsolated,
  unknown: styles.roadUnknown,
};

/**
 * How the rows are ordered. `cost` and `quality` are the server's own modes
 * (`SortMode` 1 and 2); `distance` is sorted here, from the coordinates in the reply.
 */
type SortMode = 'cost' | 'quality' | 'distance';

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
  const reachability = useBuildingStore((s) => s.connectionPicker?.reachability);
  const clearConnectionPicker = useBuildingStore((s) => s.clearConnectionPicker);
  const remembered = useUiStore((s) => s.connectionFilters);
  const setConnectionFilters = useUiStore((s) => s.setConnectionFilters);

  const [company, setCompany] = useState(remembered.company);
  const [town, setTown] = useState(remembered.town);
  const [maxResults, setMaxResults] = useState(remembered.maxResults);
  const [roles, setRoles] = useState(remembered.roles);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  /** Rows pruned with `Del` — local to the dialog, the store's results are never touched. */
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());
  /**
   * A supplier search starts in the server's delivered-cost order; a customer search stays
   * on distance, the only order `FindClients` can answer in (`Cache/InputSearch.pas:90-96`).
   */
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    picker?.direction === 'output' ? 'distance' : 'cost',
  );

  const client = useClient();
  const companyRef = useRef<HTMLInputElement>(null);

  // Focus the first filter on open; the filter values themselves are remembered
  useEffect(() => {
    requestAnimationFrame(() => companyRef.current?.focus());
  }, []);

  // Clear selection when results change
  useEffect(() => {
    setSelectedIndices(new Set());
    setHiddenIndices(new Set());
  }, [picker?.results]);

  const handleClose = useCallback(() => {
    clearConnectionPicker();
    onClose();
  }, [clearConnectionPicker, onClose]);

  const runSearch = useCallback((mode: SortMode) => {
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
        maxResults: parseInt(maxResults) || 50,
        roles: rolesMask,
        // `distance` sends 1 too — the local sort does not care what order the
        // server used, and 1 is what Voyager emits (ObjectInspectorHandleViewer.pas:878).
        sortMode: mode === 'quality' ? 2 : 1,
      },
    );
  }, [picker, company, town, maxResults, roles, client, setConnectionFilters]);

  const handleSearch = useCallback(() => runSearch(sortMode), [runSearch, sortMode]);

  /**
   * Switching to a server mode re-issues the search — the order comes from the server,
   * so there is nothing to re-sort here. Switching to `distance` sends nothing.
   */
  const changeSortMode = useCallback(
    (next: SortMode) => {
      setSortMode(next);
      if (next !== 'distance' && picker && picker.results.length > 0) runSearch(next);
    },
    [picker, runSearch],
  );

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
    for (let i = 0; i < picker.results.length; i++) {
      if (!hiddenIndices.has(i)) all.add(i);
    }
    setSelectedIndices(all);
  }, [picker, hiddenIndices]);

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

  /** Double-click commits one row, the same way the footer commits the selection. */
  const commitRow = useCallback(
    (r: ConnectionSearchResult) => {
      if (!picker) return;
      client.onConnectionConnect(picker.fluidId, picker.direction, [{ x: r.x, y: r.y }]);
      handleClose();
    },
    [picker, client, handleClose],
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

  /**
   * The rows, each carrying its store index and a local distance from the building.
   * Only `distance` re-orders them — a server mode is shown exactly as it came back.
   */
  const ordered = useMemo(() => {
    if (!picker) return [];
    const bx = picker.buildingX;
    const by = picker.buildingY;
    const rows = picker.results.map((r, i) => ({ r, i, d: Math.round(Math.hypot(r.x - bx, r.y - by)) }));
    return sortMode === 'distance' ? rows.sort((a, b) => a.d - b.d) : rows;
  }, [picker, sortMode]);

  // Rows pruned with Del disappear from the list without leaving the store
  const visible = useMemo(() => ordered.filter(({ i }) => !hiddenIndices.has(i)), [ordered, hiddenIndices]);

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
                placeholder="Partial name matches"
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
                placeholder="Partial name matches"
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
                max="150"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                onKeyDown={onFilterKeyDown}
              />
            </div>
            {/* Only a supplier search has an order to choose: FindClients ignores
                SortMode and always answers nearest first (Cache/InputSearch.pas:90-96). */}
            {picker.direction === 'input' && (
              <div className={styles.filterFieldSmall}>
                <label className={styles.filterLabel} htmlFor="cp-sort">Sort</label>
                <select
                  id="cp-sort"
                  className={styles.filterInput}
                  value={sortMode}
                  onChange={(e) => changeSortMode(e.target.value as SortMode)}
                >
                  <option value="cost">Cost</option>
                  <option value="quality">Quality</option>
                  <option value="distance">Distance</option>
                </select>
              </div>
            )}
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
          ) : visible.length === 0 ? (
            <div className={styles.emptyState}>
              {results.length === 0
                ? 'Click Search to find available connections'
                : 'No facilities found'}
            </div>
          ) : (
            visible.map(({ r, i, d }) => (
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
                    {` · ${d} tiles`}
                    {(() => {
                      const flag = reachability?.[reachabilityKey(r.x, r.y)];
                      return (
                        <span className={`${styles.roadFlag} ${flag ? ROAD_FLAG_CLASS[flag] : ''}`}>
                          {flag ? ROAD_FLAG_TEXT[flag] : 'Road: checking…'}
                        </span>
                      );
                    })()}
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
