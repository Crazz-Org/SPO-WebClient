/**
 * SuppliesGroup — Supply input management panel.
 *
 * Extracted from PropertyGroup.tsx. Renders the "Supplies" special tab:
 * supply cards with connection tables, max price/min quality sliders,
 * sort-by-price / sort-by-quality headers, hire/modify/fire actions, and
 * overpayment popover.
 */

import { memo, useState, useCallback, useRef } from 'react';
import { Crosshair } from 'lucide-react';
import type { BuildingSupplyData, BuildingConnectionData } from '@/shared/types';
import { isTradeModeValue } from '@/shared/building-details/trade-settings';
import { useClient } from '../../context';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { findPropertyValue } from './InspectorHeader';
import { useGateConnections } from './useGateConnections';
import { connectionPendingKey } from '../../handlers/connection-pending-key';
import { SaveIndicator } from './SaveIndicator';
import styles from './PropertyGroup.module.css';

/** A connection the server never positioned reads back as 0,0 — there is nothing to centre on. */
function hasPosition(conn: BuildingConnectionData): boolean {
  return conn.x !== 0 || conn.y !== 0;
}

/**
 * Disconnecting is destructive and used to fire at once (Fire button, Delete key). It now goes
 * through the shared Dialog (T3, B5): focus lands on Cancel, Escape cancels. One dialog covers
 * the whole selection — it names the count when more than one row is going.
 */
function confirmDisconnect(names: string[], fluidLabel: string, direction: 'input' | 'output', onConfirm: () => void): void {
  const n = names.length;
  const title = n === 1
    ? `Disconnect ${names[0]}?`
    : `Disconnect ${n} ${direction === 'input' ? 'suppliers' : 'buyers'}?`;
  const message = direction === 'input'
    ? (n === 1
      ? `This building will stop receiving ${fluidLabel} from ${names[0]}. You can reconnect it later.`
      : `This building will stop receiving ${fluidLabel} from ${n} suppliers: ${names.join(', ')}. You can reconnect them later.`)
    : (n === 1
      ? `${names[0]} will stop buying ${fluidLabel} here. You can reconnect it later.`
      : `${n} buyers will stop buying ${fluidLabel} here: ${names.join(', ')}. You can reconnect them later.`);
  useUiStore.getState().requestConfirm(
    title,
    message,
    onConfirm,
    { kind: 'destructive', confirmLabel: 'Disconnect', typeToConfirm: null },
  );
}

// =============================================================================
// SUPPLIES PANEL (special === 'supplies')
// =============================================================================

export function SuppliesPanel({
  supplies,
  canEdit,
  buildingX,
  buildingY,
}: {
  supplies: BuildingSupplyData[];
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
}) {
  // Whether the automatic-buying checkbox is offered at all is a property of
  // the FACILITY, not of a gate: `cbAlmBuy.Visible := ((i=2) or (i=5) or (i=6))
  // and fHandler.fOwnsFac` (Voyager/SupplySheetForm.pas:359), where `i` is the
  // facility's trade role (`tidTradeRole`, :349). The three roles are the same
  // three the mode combo offers, so the predicate is shared rather than
  // restated. `Role` is the warehouse template's name for it.
  const groups = useBuildingStore((s) => s.details?.groups);
  const tradeRole = groups
    ? (findPropertyValue(groups, 'TradeRole') ?? findPropertyValue(groups, 'Role'))
    : undefined;
  const autoBuyOffered = canEdit && tradeRole !== undefined && isTradeModeValue(tradeRole);

  if (supplies.length === 0) {
    return <div className={styles.empty}>No supply inputs</div>;
  }
  return (
    <div className={styles.supplyList}>
      {/* Keyed by path, not metaFluid: the fluid id lives in the gate header,
          which is not read until the gate is opened. The path comes from
          GetInputNames and is there from the start. */}
      {supplies.map((supply) => (
        <SupplyCard
          key={supply.path}
          supply={supply}
          canEdit={canEdit}
          autoBuyOffered={autoBuyOffered}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      ))}
    </div>
  );
}

function OverpaymentPopover({
  conn,
  connIndex,
  supply,
  buildingX,
  buildingY,
  onClose,
}: {
  conn: BuildingConnectionData;
  connIndex: number;
  supply: BuildingSupplyData;
  buildingX: number;
  buildingY: number;
  onClose: () => void;
}) {
  const client = useClient();
  const initialOverprice = parseInt(conn.overprice || '0', 10);
  const [overprice, setOverprice] = useState(isNaN(initialOverprice) ? 0 : initialOverprice);

  // The fluid id comes off the gate header, which is only read once the gate is
  // opened — and this popover only exists inside an opened gate. The guard is
  // what keeps a malformed SET (fluidId: undefined) off the wire if that ever
  // stops being true.
  const fluidId = supply.metaFluid;

  const handleOk = () => {
    if (!fluidId) return;
    client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetInputOverPrice', String(overprice), {
      fluidId,
      index: String(connIndex),
    });
    client.onRefreshBuilding(buildingX, buildingY);
    onClose();
  };

  const handleDelete = () => {
    if (!fluidId) return;
    confirmDisconnect([conn.facilityName], supply.name || fluidId, 'input', () => {
      client.onDisconnectConnection(buildingX, buildingY, fluidId, 'input', [{ x: conn.x, y: conn.y }]);
    });
    onClose();
  };

  return (
    <>
      <div className={styles.overpayBackdrop} onClick={onClose} />
      <div className={styles.overpayPopover}>
        <div className={styles.overpayHeader}>
          <div>Name: <strong>{conn.facilityName}</strong></div>
          <div>Company: <strong>{conn.companyName}</strong></div>
        </div>
        <div className={styles.overpaySliderRow}>
          <span className={styles.sliderLabel}>Overpayment</span>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={150}
            step={1}
            value={overprice}
            onChange={(e) => setOverprice(parseInt(e.target.value, 10))}
          />
          <span className={styles.sliderValue}>{overprice}%</span>
        </div>
        <div className={styles.overpayActions}>
          <button className={styles.overpayDeleteBtn} onClick={handleDelete}>Delete</button>
          <button className={styles.overpayOkBtn} onClick={handleOk}>OK</button>
          <button className={styles.overpayCancelBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/** A gate's percentage property as a slider position, with its default. */
function toPercent(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || String(fallback), 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * One of the two supplier columns the server can sort by (Price = mode 0,
 * Quality = mode 1, Voyager/SupplySheetForm.pas:1189-1206). When the gate is
 * not sortable the cell is the plain text it has always been — no button, no
 * `aria-sort` — so nothing offers a click the server would refuse.
 */
function SortHeader({
  label,
  mode,
  sortable,
  active,
  onSort,
}: {
  label: string;
  mode: 0 | 1;
  sortable: boolean;
  active: boolean;
  onSort: (mode: 0 | 1) => void;
}) {
  if (!sortable) {
    return <th style={{ width: 60 }}>{label}</th>;
  }
  return (
    <th style={{ width: 60 }} aria-sort={active ? 'ascending' : undefined}>
      <button
        type="button"
        className={`${styles.supplySortHeader}${active ? ` ${styles.supplySortActive}` : ''}`}
        onClick={() => onSort(mode)}
      >
        {label}
      </button>
    </th>
  );
}

const SupplyCard = memo(function SupplyCard({
  supply,
  canEdit,
  autoBuyOffered,
  buildingX,
  buildingY,
}: {
  supply: BuildingSupplyData;
  canEdit: boolean;
  /** The facility's role and ownership allow the automatic-buying checkbox. */
  autoBuyOffered: boolean;
  buildingX: number;
  buildingY: number;
}) {
  const client = useClient();
  // Expansion and this gate's connection rows are one mechanism, shared with
  // ProductCard: opening the gate is what reads its rows.
  const { expanded, toggle, loaded, failed } = useGateConnections(
    'supplies', supply.path, supply.name, buildingX, buildingY,
  );
  // A click toggles a row in or out of the selection: several suppliers can go
  // in one Fire, the way the reference client fired a multi-row list selection
  // (Voyager/SupplySheetForm.pas:889-908). Kept sorted so the pairs leave in
  // table order.
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [overpayTarget, setOverpayTarget] = useState<number | null>(null);
  const maxPriceTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const minKTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Both sliders are local state because the thumb has to move under the finger
  // before the debounced write goes out. That local copy is seeded from the
  // server value — and the server value is not there when the card first
  // renders: `maxPrice` and `minK` are gate-header properties, read only once
  // the gate is opened. Seeding once left the slider on its 200 % default over
  // a gate the server says is at 400 %, so it re-seeds whenever the server
  // sends a value it has not shown yet. Adjusting state during render is the
  // React-documented way to follow a changing input without a second pass; a
  // drag is not stomped, because only a value the card has never shown counts.
  const [seenMaxPrice, setSeenMaxPrice] = useState(supply.maxPrice);
  const [seenMinK, setSeenMinK] = useState(supply.minK);
  const [localMaxPrice, setLocalMaxPrice] = useState(() => toPercent(supply.maxPrice, 200));
  const [localMinK, setLocalMinK] = useState(() => toPercent(supply.minK, 0));

  if (supply.maxPrice !== seenMaxPrice) {
    setSeenMaxPrice(supply.maxPrice);
    // A gate being re-listed drops back to undefined for the length of the
    // re-read; the slider is hidden then, and there is nothing to follow.
    if (supply.maxPrice !== undefined) setLocalMaxPrice(toPercent(supply.maxPrice, 200));
  }
  if (supply.minK !== seenMinK) {
    setSeenMinK(supply.minK);
    if (supply.minK !== undefined) setLocalMinK(toPercent(supply.minK, 0));
  }

  // Which of the two sortable columns is the active one. Same "seen / local"
  // shape as the sliders above: the mark has to move on the click, before the
  // server has re-read the gate, and still follow a value the server sends that
  // this card has not shown yet. Voyager/SupplySheetForm.pas:1006 seeds it the
  // same way — SortMode = '1' means the Quality column carries the mark, and
  // anything else means the Price column does.
  const [seenSortMode, setSeenSortMode] = useState(supply.sortMode);
  const [localSortMode, setLocalSortMode] = useState<0 | 1>(supply.sortMode === '1' ? 1 : 0);

  if (supply.sortMode !== seenSortMode) {
    setSeenSortMode(supply.sortMode);
    if (supply.sortMode !== undefined) setLocalSortMode(supply.sortMode === '1' ? 1 : 0);
  }

  // Automatic buying, same "seen / local" shape: the box has to move on the
  // click, before the gate has been re-read, and still follow a value the
  // server sends that this card has not shown yet. `'1'` is what
  // `Cache.WriteBoolean` stores for true (Cache/CacheAgent.pas:150-152) and
  // what Voyager tests (`Info.IntValue[tidSelected] = 1`,
  // Voyager/SupplySheetForm.pas:997).
  const [seenSelected, setSeenSelected] = useState(supply.selected);
  const [localAutoBuy, setLocalAutoBuy] = useState(supply.selected === '1');

  if (supply.selected !== seenSelected) {
    setSeenSelected(supply.selected);
    if (supply.selected !== undefined) setLocalAutoBuy(supply.selected === '1');
  }

  // Every mutation below addresses the gate by its fluid id, and that id is a
  // header property — unknown until this gate has been opened and read. The
  // controls that use it are rendered only once it is known; the guards are the
  // second line.
  const fluidId = supply.metaFluid;

  // Voyager/SupplySheetForm.pas:1005 shows the sort mark only when QPSorted = '1';
  // :1187 accepts a column click only for the owner, with a fluid id, and with
  // that mark. A gate the server does not sort by quality/price ratio has no
  // sort to change, so the headers stay the plain text they were.
  const sortable = canEdit && supply.qpSorted === '1' && !!fluidId;

  // The control appears only once the state has actually been read: an unopened
  // gate, or one that does not publish `Selected` (a non-pull input has no
  // RDOSelSelected to call), shows nothing rather than a default.
  const autoBuyShown = autoBuyOffered && supply.selected !== undefined && !!fluidId;

  // `BuySet` (Voyager/SupplySheetForm.pas:1123-1139) hides the sliders panel,
  // the supplier list and the value/cost labels when the box is off. A gate with
  // no checkbox is always "buying", so it renders exactly as it did before.
  const buying = !autoBuyShown || localAutoBuy;

  const handleMaxPriceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setLocalMaxPrice(val);
    if (maxPriceTimeoutRef.current) clearTimeout(maxPriceTimeoutRef.current);
    maxPriceTimeoutRef.current = setTimeout(() => {
      if (!fluidId) return;
      client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetInputMaxPrice', String(val), {
        fluidId,
      });
    }, 300);
  }, [client, buildingX, buildingY, fluidId]);

  const handleMinKChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setLocalMinK(val);
    if (minKTimeoutRef.current) clearTimeout(minKTimeoutRef.current);
    minKTimeoutRef.current = setTimeout(() => {
      if (!fluidId) return;
      client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetInputMinK', String(val), {
        fluidId,
      });
    }, 300);
  }, [client, buildingX, buildingY, fluidId]);

  // One click is one write — no debounce (Voyager forks the call straight from
  // the column click, :1197 / :1204) and no refresh: the re-sorted supplier
  // order arrives with the next gate read, like every other gate property.
  const handleSortMode = (mode: 0 | 1) => {
    if (!sortable || !fluidId) return;
    setLocalSortMode(mode);
    client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetInputSortMode', String(mode), {
      fluidId,
    });
  };

  // One click, one write — no debounce: Voyager forks the call straight from the
  // click (`Threads.Fork(threadedSetSelect, ...)`, SupplySheetForm.pas:1100).
  // The gateway turns '1'/'0' into the `#-1`/`#0` the WordBool argument takes,
  // and `fluidId` is not a wire argument: it names the gate the frame is
  // addressed to.
  const handleAutoBuyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!fluidId) return;
    setLocalAutoBuy(e.target.checked);
    client.onSetBuildingProperty(
      buildingX, buildingY, 'RDOSelSelected', e.target.checked ? '1' : '0', { fluidId },
    );
  };

  const handleHire = () => {
    if (!fluidId) return;
    client.onSearchConnections(buildingX, buildingY, fluidId, supply.name, 'input');
  };

  // Overpayment is a per-connection property (index-addressed), so Modify only
  // makes sense on exactly one row.
  const handleModify = () => {
    if (selectedRows.length === 1) setOverpayTarget(selectedRows[0]);
  };

  const handleFire = () => {
    if (selectedRows.length === 0 || !fluidId) return;
    const conns = selectedRows
      .map(i => supply.connections[i])
      .filter((c): c is BuildingConnectionData => c !== undefined);
    if (conns.length === 0) return;
    confirmDisconnect(conns.map(c => c.facilityName), supply.name || fluidId, 'input', () => {
      client.onDisconnectConnection(buildingX, buildingY, fluidId, 'input', conns.map(c => ({ x: c.x, y: c.y })));
      setSelectedRows([]);
    });
  };

  const handleRowClick = (idx: number) => {
    setSelectedRows(prev => prev.includes(idx)
      ? prev.filter(i => i !== idx)
      : [...prev, idx].sort((a, b) => a - b));
  };

  const handleNavigate = (conn: BuildingConnectionData) => {
    if (!hasPosition(conn)) return;
    client.onNavigateToBuilding(conn.x, conn.y);
  };

  const handleRowContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    setOverpayTarget(idx);
  };

  return (
    <div className={styles.supplyCard}>
      <button className={styles.supplyHeader} onClick={toggle}>
        <span className={styles.supplyName}>{supply.name || supply.metaFluid}</span>
        {/* The supplier count is a header property. Reading it for every gate
            cost a round-trip per collapsed row; it now appears once the gate has
            been opened. Absent is honest — `0 suppliers` would not be. */}
        {supply.connectionCount !== undefined && (
          <span className={styles.supplyCount}>
            {supply.connectionCount} supplier{supply.connectionCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className={styles.supplyChevron}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className={styles.supplyBody}>
          {/* Automatic buying — the gate's own `Selected` flag */}
          {autoBuyShown && (
            <label className={styles.row}>
              <span className={styles.name}>Automatic buying</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={localAutoBuy}
                onChange={handleAutoBuyChange}
              />
              <SaveIndicator propertyKey={`RDOSelSelected:${JSON.stringify({ fluidId })}`} />
            </label>
          )}

          {/* Stats row */}
          {buying && (
            <div className={styles.supplyStats}>
              {supply.fluidValue && (
                <span className={styles.supplyStat}>Last Value: <strong>{supply.fluidValue}</strong></span>
              )}
              {supply.lastCostPerc && (
                <span className={styles.supplyStat}>Cost: <strong>{supply.lastCostPerc}%</strong></span>
              )}
            </div>
          )}

          {/* Max Price slider */}
          {buying && (canEdit && supply.maxPrice !== undefined ? (
            <div className={styles.supplySliderRow}>
              <span className={styles.sliderLabel}>Max Price</span>
              <input
                type="range"
                className={styles.slider}
                min={0}
                max={400}
                step={1}
                value={localMaxPrice}
                onChange={handleMaxPriceChange}
              />
              <span className={styles.sliderValue}>{localMaxPrice}%</span>
              {fluidId && <SaveIndicator propertyKey={`RDOSetInputMaxPrice:${JSON.stringify({ fluidId })}`} />}
            </div>
          ) : supply.maxPrice !== undefined ? (
            <div className={styles.row}>
              <span className={styles.name}>Max Price</span>
              <span className={styles.value}>{supply.maxPrice}%</span>
            </div>
          ) : null)}

          {/* Min Quality slider */}
          {buying && (canEdit && supply.minK !== undefined ? (
            <div className={styles.supplySliderRow}>
              <span className={styles.sliderLabel}>Min Quality</span>
              <input
                type="range"
                className={styles.slider}
                min={0}
                max={100}
                step={1}
                value={localMinK}
                onChange={handleMinKChange}
              />
              <span className={styles.sliderValue}>{localMinK}%</span>
              {fluidId && <SaveIndicator propertyKey={`RDOSetInputMinK:${JSON.stringify({ fluidId })}`} />}
            </div>
          ) : supply.minK !== undefined ? (
            <div className={styles.row}>
              <span className={styles.name}>Min Quality</span>
              <span className={styles.value}>{supply.minK}%</span>
            </div>
          ) : null)}

          {/* Connections table */}
          {buying && (supply.connections.length > 0 ? (
            <table
              className={styles.supplyTable}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Delete' && canEdit && selectedRows.length > 0) {
                  handleFire();
                }
                if (e.key === 'Insert' && canEdit) {
                  handleHire();
                }
                // Enter follows one row, so it needs exactly one selected — the rule
                // Modify already applies to a multi-selection (#563 meets #564).
                if (e.key === 'Enter' && selectedRows.length === 1) {
                  const conn = supply.connections[selectedRows[0]];
                  if (conn) handleNavigate(conn);
                }
              }}
            >
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Facility</th>
                  <th style={{ width: 80 }}>Owner</th>
                  <SortHeader
                    label="Price"
                    mode={0}
                    sortable={sortable}
                    active={localSortMode === 0}
                    onSort={handleSortMode}
                  />
                  <th style={{ width: 60 }}>Overpaid</th>
                  <th style={{ width: 80 }}>Last</th>
                  <SortHeader
                    label="Quality"
                    mode={1}
                    sortable={sortable}
                    active={localSortMode === 1}
                    onSort={handleSortMode}
                  />
                  <th style={{ width: 60 }}>T.Cost</th>
                  <th style={{ width: 24 }}></th>
                </tr>
              </thead>
              <tbody>
                {supply.connections.map((conn, j) => (
                  <tr
                    key={`${j}:${conn.x},${conn.y}`}
                    className={`${styles.supplyTableRow}${selectedRows.includes(j) ? ` ${styles.supplyTableRowSelected}` : ''}`}
                    onClick={() => handleRowClick(j)}
                    onDoubleClick={() => handleNavigate(conn)}
                    onContextMenu={(e) => canEdit && handleRowContextMenu(e, j)}
                    title={conn.companyName || undefined}
                  >
                    <td>
                      {conn.connected && <span className={styles.supplyConnectedIcon}>&#10003;</span>}
                    </td>
                    <td>
                      {conn.facilityName || (
                        <span className={styles.unnamedConnection}>no data</span>
                      )}
                    </td>
                    <td>{conn.createdBy}</td>
                    <td>${conn.price}</td>
                    <td>{conn.overprice}%</td>
                    <td>{conn.lastValue}</td>
                    <td>{conn.quality}</td>
                    <td>{conn.cost}</td>
                    <td>
                      {hasPosition(conn) && (
                        <button
                          type="button"
                          className={styles.tableActionBtn}
                          aria-label={`View ${conn.facilityName || 'facility'} on map`}
                          title="View on map"
                          onClick={(e) => { e.stopPropagation(); handleNavigate(conn); }}
                        >
                          <Crosshair size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.noConnections}>
              {failed
                ? 'Could not read the suppliers \u2014 close and re-open to retry'
                : !loaded
                  // Opening the gate is what reads it; until that lands an empty
                  // list means "not read yet", not "none".
                  ? 'Loading suppliers\u2026'
                  : (supply.connectionCount ?? 0) > 0
                    // The server counted connections it could not describe:
                    // cnxCount comes off the gate, the rows come from a separate
                    // sub-object read that returned nothing. Claiming "no
                    // suppliers" here is the contradiction the user hit — say
                    // what is actually known.
                    ? `${supply.connectionCount} supplier${supply.connectionCount !== 1 ? 's' : ''} connected — details unavailable`
                    : 'No suppliers connected'}
            </div>
          ))}

          {/* Overpayment popover */}
          {overpayTarget !== null && canEdit && supply.connections[overpayTarget] && (
            <OverpaymentPopover
              conn={supply.connections[overpayTarget]}
              connIndex={overpayTarget}
              supply={supply}
              buildingX={buildingX}
              buildingY={buildingY}
              onClose={() => setOverpayTarget(null)}
            />
          )}

          {/* Action buttons */}
          {canEdit && (
            <div className={styles.supplyActions}>
              <button className={styles.hireBtn} onClick={handleHire} disabled={!fluidId}>Hire</button>
              <button
                className={styles.modifyBtn}
                onClick={handleModify}
                disabled={selectedRows.length !== 1}
              >
                Modify
              </button>
              <button
                className={styles.fireBtn}
                onClick={handleFire}
                disabled={selectedRows.length === 0}
              >
                Fire
              </button>
              {/* Connecting and disconnecting are writes like any other — they say so here
                  instead of only in a toast that has already gone (B6). */}
              {fluidId && (
                <>
                  <SaveIndicator propertyKey={connectionPendingKey('RDOConnectInput', fluidId)} />
                  <SaveIndicator propertyKey={connectionPendingKey('RDODisconnectInput', fluidId)} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
