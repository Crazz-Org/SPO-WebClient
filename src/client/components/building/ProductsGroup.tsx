/**
 * ProductsGroup — Product output management panel.
 *
 * Compact two-line product tiles with inline price slider (always visible).
 * Expanding reveals connections table + hire/remove actions.
 */

import { memo, useState } from 'react';
import type { BuildingProductData } from '@/shared/types';
import { formatCurrency } from '@/shared/building-details';
import { useClient } from '../../context';
import { useUiStore } from '../../store/ui-store';
import { PriceSliderWithMarker } from './PropertyTables';
import { useGateConnections } from './useGateConnections';
import { connectionPendingKey } from '../../handlers/connection-pending-key';
import { SaveIndicator } from './SaveIndicator';
import styles from './PropertyGroup.module.css';

/**
 * Disconnecting is destructive and used to fire at once (Fire button, Delete key). It now goes
 * through the shared Dialog (T3, B5): focus lands on Cancel, Escape cancels.
 */
function confirmDisconnect(name: string, fluidLabel: string, direction: 'input' | 'output', onConfirm: () => void): void {
  useUiStore.getState().requestConfirm(
    `Disconnect ${name}?`,
    direction === 'input'
      ? `This building will stop receiving ${fluidLabel} from ${name}. You can reconnect it later.`
      : `${name} will stop buying ${fluidLabel} here. You can reconnect it later.`,
    onConfirm,
    { kind: 'destructive', confirmLabel: 'Disconnect', typeToConfirm: null },
  );
}

// =============================================================================
// PRODUCTS PANEL (special === 'products')
// =============================================================================

export function ProductsPanel({
  products,
  canEdit,
  buildingX,
  buildingY,
  onPropertyChange,
}: {
  products: BuildingProductData[];
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
  onPropertyChange: (propertyName: string, value: number, params?: Record<string, string>) => void;
}) {
  if (products.length === 0) {
    return <div className={styles.empty}>No product outputs</div>;
  }
  return (
    <div className={styles.productList}>
      {/* Keyed by path, not metaFluid: the fluid id lives in the gate header,
          which is not read until the gate is opened. The path comes from
          GetOutputNames and is there from the start. */}
      {products.map((product) => (
        <ProductCard
          key={product.path}
          product={product}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
          onPropertyChange={onPropertyChange}
        />
      ))}
    </div>
  );
}

function getQualityVariant(quality: number): string {
  if (quality >= 80) return styles.badgeGood;
  if (quality >= 40) return styles.badgeWarn;
  return styles.badgeBad;
}

const ProductCard = memo(function ProductCard({
  product,
  canEdit,
  buildingX,
  buildingY,
  onPropertyChange,
}: {
  product: BuildingProductData;
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
  onPropertyChange: (propertyName: string, value: number, params?: Record<string, string>) => void;
}) {
  const client = useClient();
  // Expansion and this gate's connection rows are one mechanism, shared with
  // SupplyCard: opening the gate is what reads its rows.
  const { expanded, toggle, loaded, failed } = useGateConnections(
    'products', product.path, product.name, buildingX, buildingY,
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Quality, price and market price are header properties: unknown until this
  // gate has been opened. `hasHeader` is what separates "not read yet" from a
  // genuine zero, and it gates every control that depends on one.
  const hasHeader = product.pricePc !== undefined;
  const quality = parseFloat(product.quality ?? '') || 0;
  const pricePc = parseFloat(product.pricePc ?? '') || 0;
  const avgPrice = parseFloat(product.avgPrice ?? '') || 0;
  const marketPrice = parseFloat(product.marketPrice ?? '') || 0;
  const dollarPrice = marketPrice > 0 ? (pricePc / 100) * marketPrice : 0;
  const fluidId = product.metaFluid;

  const handleRowClick = (idx: number) => {
    setSelectedIdx(selectedIdx === idx ? null : idx);
  };

  const handleHire = () => {
    if (!fluidId) return;
    client.onSearchConnections(buildingX, buildingY, fluidId, product.name || fluidId, 'output');
  };

  const handleFire = () => {
    if (selectedIdx === null || !fluidId) return;
    const conn = product.connections[selectedIdx];
    if (!conn) return;
    confirmDisconnect(conn.facilityName, product.name || fluidId, 'output', () => {
      client.onDisconnectConnection(buildingX, buildingY, fluidId, 'output', conn.x, conn.y);
      setSelectedIdx(null);
    });
  };

  const handlePriceChange = (rdoName: string, value: number) => {
    if (!fluidId) return;
    onPropertyChange(rdoName, value, { fluidId });
  };

  return (
    <div className={styles.productCard}>
      {/* Line 1: Name + inline badges + buyer count + chevron */}
      <button
        className={styles.productHeader}
        onClick={toggle}
        title={product.lastFluid ? `Last produced: ${product.lastFluid}` : undefined}
      >
        <span className={styles.productName}>{product.name || product.metaFluid}</span>
        {/* Quality, price and buyer count are all header properties. Reading
            them for every gate cost a round-trip per collapsed row; they now
            appear once the gate has been opened. */}
        {quality > 0 && (
          <span className={`${styles.inlineBadge} ${getQualityVariant(quality)}`}>
            Q:{quality}%
          </span>
        )}
        {!canEdit && pricePc > 0 && (
          <span className={styles.inlineBadge}>P:{pricePc}%</span>
        )}
        {product.connectionCount !== undefined && (
          <span className={styles.productBuyerCount}>
            {product.connectionCount}{product.connectionCount !== 1 ? '>' : '>'}
          </span>
        )}
        <span className={styles.productChevron}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {/* Expanded: price, then connections table + actions.
          The price row used to sit here, outside the body and always visible —
          it cannot, now that PricePc, AvgPrice and MarketPrice arrive with the
          gate. That is also where the reference client puts it: the PricePc
          control acts on `ftProducts.CurrentFinger` alone
          (Voyager/ProdSheetForm.pas:684). */}
      {expanded && (
        <div className={styles.productBody}>
          {hasHeader && (canEdit ? (
            <div className={styles.productPriceRow}>
              <PriceSliderWithMarker
                value={pricePc}
                avgPrice={avgPrice}
                max={300}
                step={5}
                canEdit={canEdit}
                rdoName="PricePc"
                onPropertyChange={handlePriceChange}
              />
              {dollarPrice > 0 && (
                <span className={styles.productDollarPrice}>{formatCurrency(dollarPrice)}</span>
              )}
              {fluidId && <SaveIndicator propertyKey={`PricePc:${JSON.stringify({ fluidId })}`} />}
            </div>
          ) : (
            pricePc > 0 && dollarPrice > 0 && (
              <div className={styles.productPriceReadonly}>
                {formatCurrency(dollarPrice)} ({pricePc}%)
              </div>
            )
          ))}
          {product.connections.length > 0 ? (
            <table
              className={styles.productTable}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Delete' && canEdit && selectedIdx !== null) {
                  handleFire();
                }
              }}
            >
              <thead>
                <tr>
                  <th>Facility</th>
                  <th style={{ width: 80 }}>Company</th>
                  <th style={{ width: 80 }}>Last</th>
                  <th style={{ width: 60 }}>T.Cost</th>
                </tr>
              </thead>
              <tbody>
                {product.connections.map((conn, j) => (
                  <tr
                    key={`${j}:${conn.x},${conn.y}`}
                    className={`${styles.productTableRow}${selectedIdx === j ? ` ${styles.productTableRowSelected}` : ''}`}
                    onClick={() => handleRowClick(j)}
                  >
                    <td className={styles.productFacilityCell}>
                      <span className={styles.productFacilityName}>
                        {conn.facilityName || (
                          <span className={styles.unnamedConnection}>no data</span>
                        )}
                      </span>
                    </td>
                    <td>{conn.companyName}</td>
                    <td>{conn.lastValue}</td>
                    <td>{conn.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.noConnections}>
              {/* Same three states as SuppliesGroup, and for the same reasons:
                  the rows are read when the gate opens, so an empty list before
                  that means "not read yet"; and a non-zero cnxCount with no rows
                  after it means the sub-object read came back empty, not that
                  the building has no buyers. */}
              {failed
                ? 'Could not read the buyers \u2014 close and re-open to retry'
                : !loaded
                  ? 'Loading buyers\u2026'
                  : (product.connectionCount ?? 0) > 0
                    ? `${product.connectionCount} buyer${product.connectionCount !== 1 ? 's' : ''} connected — details unavailable`
                    : 'No buyers connected'}
            </div>
          )}

          {canEdit && (
            <div className={styles.productActions}>
              <button className={styles.hireBtn} onClick={handleHire} disabled={!fluidId}>Hire</button>
              <button
                className={styles.fireBtn}
                onClick={handleFire}
                disabled={selectedIdx === null}
              >
                Remove
              </button>
              {/* Same as the supply side: a connection change says so where it happened. */}
              {fluidId && (
                <>
                  <SaveIndicator propertyKey={connectionPendingKey('RDOConnectOutput', fluidId)} />
                  <SaveIndicator propertyKey={connectionPendingKey('RDODisconnectOutput', fluidId)} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
