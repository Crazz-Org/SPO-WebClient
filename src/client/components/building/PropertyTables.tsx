/**
 * PropertyTables — Table and card-list components for building property rendering.
 *
 * DataTable + TableCellValue: generic multi-column indexed data table
 * ServiceCardList: card-per-service layout with price slider
 * ProductSummaryCards + ProductSaleCard + PriceSliderWithMarker: product cards on General tab
 *
 * Extracted from PropertyGroup.tsx.
 */

import { useState, useCallback, useRef } from 'react';
import type { BuildingProductData } from '@/shared/types';
import {
  PropertyType,
  type PropertyDefinition,
  type TableColumn,
  type RdoCommandMapping,
  formatCurrency,
  formatPercentage,
  formatNumber,
} from '@/shared/building-details';
import { computePendingKey } from './property-utils';
import { SliderInput, CurrencyInput } from './PropertyInputs';
import styles from './PropertyGroup.module.css';

// =============================================================================
// DATA TABLE (PropertyType.TABLE)
// =============================================================================

export function DataTable({
  def,
  rowCount,
  valueMap,
  canEdit,
  rdoCommands,
  onPropertyChange,
  onRowAction,
}: {
  def: PropertyDefinition;
  rowCount: number;
  valueMap: Map<string, string>;
  canEdit: boolean;
  rdoCommands?: Record<string, RdoCommandMapping>;
  onPropertyChange: (name: string, value: number) => void;
  onRowAction?: (actionId: string, rowIndex: number) => void;
}) {
  const propSuffix = def.indexSuffix || '';
  const cols = def.columns!;

  return (
    <table className={styles.dataTable}>
      <thead>
        <tr>
          {cols.map((col) => (
            <th key={col.rdoSuffix} style={col.width ? { width: col.width } : undefined}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rowCount }, (_, i) => {
          // Build row values map for conditional visibility (visibleWhen)
          const rowValues: Record<string, string> = {};
          for (const c of cols) {
            const cSuffix = c.columnSuffix || '';
            const iSuffix = c.indexSuffix !== undefined ? c.indexSuffix : propSuffix;
            rowValues[c.rdoSuffix] = valueMap.get(`${c.rdoSuffix}${i}${cSuffix}${iSuffix}`) ?? '';
          }
          return (
            <tr key={i} className={styles.dataRow}>
              {cols.map((col) => {
                const colSuffix = col.columnSuffix || '';
                const idxSuffix = col.indexSuffix !== undefined ? col.indexSuffix : propSuffix;
                const key = `${col.rdoSuffix}${i}${colSuffix}${idxSuffix}`;
                const value = valueMap.get(key) ?? '';
                return (
                  <td key={col.rdoSuffix} className={styles.tableCell}>
                    <TableCellValue
                      col={col}
                      value={value}
                      rdoName={key}
                      rowIndex={i}
                      canEdit={canEdit && !!col.editable}
                      rdoCommands={rdoCommands}
                      onPropertyChange={onPropertyChange}
                      onRowAction={onRowAction}
                      rowValues={rowValues}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TableCellValue({
  col,
  value,
  rdoName,
  rowIndex,
  canEdit,
  rdoCommands,
  onPropertyChange,
  onRowAction,
  rowValues,
}: {
  col: TableColumn;
  value: string;
  rdoName: string;
  rowIndex: number;
  canEdit: boolean;
  rdoCommands?: Record<string, RdoCommandMapping>;
  onPropertyChange: (name: string, value: number) => void;
  onRowAction?: (actionId: string, rowIndex: number) => void;
  rowValues: Record<string, string>;
}) {
  const num = parseFloat(value);
  switch (col.type) {
    case PropertyType.ACTION_BUTTON: {
      if (col.visibleWhen) {
        const colVal = rowValues[col.visibleWhen.column] ?? '';
        const isEmpty = !colVal || colVal.trim() === '';
        const show = col.visibleWhen.condition === 'empty' ? isEmpty : !isEmpty;
        if (!show) {
          // Check for altAction (e.g., Elect/Depose sharing one column)
          if (col.altAction) {
            const altColVal = rowValues[col.visibleWhen.column] ?? '';
            const altEmpty = !altColVal || altColVal.trim() === '';
            const altShow = col.altAction.condition === 'empty' ? altEmpty : !altEmpty;
            if (altShow) {
              const isDanger = col.altAction.buttonLabel === 'Depose';
              return (
                <button
                  className={isDanger ? styles.tableActionBtnDanger : styles.tableActionBtn}
                  onClick={() => onRowAction?.(col.altAction!.actionId, rowIndex)}
                >
                  {col.altAction.buttonLabel}
                </button>
              );
            }
          }
          return null;
        }
      }
      return (
        <button
          className={styles.tableActionBtn}
          onClick={() => col.actionId && onRowAction?.(col.actionId, rowIndex)}
        >
          {col.buttonLabel || 'Action'}
        </button>
      );
    }
    case PropertyType.CURRENCY:
      if (canEdit) {
        return (
          <CurrencyInput
            value={num}
            rdoName={rdoName}
            pendingKey={computePendingKey(rdoName, rdoCommands)}
            onPropertyChange={onPropertyChange}
          />
        );
      }
      return <span className={styles.value}>{formatCurrency(num)}</span>;
    case PropertyType.PERCENTAGE:
      return <span className={styles.value}>{formatPercentage(num)}</span>;
    case PropertyType.NUMBER:
      return <span className={styles.value}>{isNaN(num) ? value || '-' : formatNumber(num)}</span>;
    case PropertyType.BOOLEAN:
      return <span className={styles.value}>{num !== 0 ? 'Yes' : 'No'}</span>;
    case PropertyType.SLIDER:
      if (canEdit) {
        return (
          <SliderInput
            value={num}
            min={col.min ?? 0}
            max={col.max ?? 300}
            step={col.step ?? 5}
            rdoName={rdoName}
            pendingKey={computePendingKey(rdoName, rdoCommands)}
            onPropertyChange={onPropertyChange}
          />
        );
      }
      return <span className={styles.value}>{isNaN(num) ? value || '-' : String(num)}</span>;
    default:
      return <span className={styles.value}>{value || '-'}</span>;
  }
}

// =============================================================================
// SERVICE CARD LIST (PropertyType.SERVICE_CARDS)
// =============================================================================

export function ServiceCardList({
  def,
  rowCount,
  valueMap,
  canEdit,
  onPropertyChange,
}: {
  def: PropertyDefinition;
  rowCount: number;
  valueMap: Map<string, string>;
  canEdit: boolean;
  onPropertyChange: (name: string, value: number) => void;
}) {
  const propSuffix = def.indexSuffix || '';
  const cols = def.columns!;
  const colByPrefix = new Map(cols.map((c) => [c.rdoSuffix, c]));

  const getVal = (suffix: string, i: number) => {
    const col = colByPrefix.get(suffix);
    const colSuffix = col?.columnSuffix || '';
    const idxSuffix = col?.indexSuffix !== undefined ? col.indexSuffix : propSuffix;
    return valueMap.get(`${suffix}${i}${colSuffix}${idxSuffix}`) ?? '';
  };

  return (
    <div className={styles.pscList}>
      {Array.from({ length: rowCount }, (_, i) => {
        const price = parseFloat(getVal('srvPrices', i)) || 0;
        const marketPrice = parseFloat(getVal('srvMarketPrices', i)) || 0;
        const dollarPrice = marketPrice > 0 ? (price / 100) * marketPrice : 0;

        return (
          <ProductSaleCard
            key={i}
            name={getVal('srvNames', i) || `Service ${i + 1}`}
            supply={parseFloat(getVal('srvSupplies', i)) || 0}
            demand={parseFloat(getVal('srvDemands', i)) || 0}
            pricePc={price}
            avgPricePc={parseFloat(getVal('srvAvgPrices', i)) || 0}
            dollarPrice={dollarPrice}
            priceMax={colByPrefix.get('srvPrices')?.max ?? 500}
            priceStep={colByPrefix.get('srvPrices')?.step ?? 10}
            canEdit={canEdit && !!colByPrefix.get('srvPrices')?.editable}
            rdoName={`srvPrices${i}${propSuffix}`}
            onPropertyChange={onPropertyChange}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// PRODUCT SUMMARY CARDS (for General tab)
// =============================================================================

export function ProductSummaryCards({
  products,
  canEdit,
  onPropertyChange,
}: {
  products: BuildingProductData[];
  canEdit: boolean;
  onPropertyChange: (name: string, value: number) => void;
}) {
  if (products.length === 0) return null;

  // A product gate carries its price only once the user has opened it in the
  // Products tab — PricePc, AvgPrice and MarketPrice are gate-header properties,
  // and reading them for every gate up front is exactly the cost this panel is
  // no longer allowed to impose. A card with no price would be a slider set to
  // 0 %, which reads as an instruction the server never gave, so gates that
  // have not been opened are left out rather than drawn empty.
  const priced = products.filter((p) => p.pricePc !== undefined);
  if (priced.length === 0) return null;

  return (
    <div className={styles.pscList}>
      <div className={styles.pscSectionLabel}>Products</div>
      {priced.map((product, i) => {
        const pricePc = parseFloat(product.pricePc ?? '') || 0;
        const marketPrice = parseFloat(product.marketPrice ?? '') || 0;
        const dollarPrice = marketPrice > 0 ? (pricePc / 100) * marketPrice : 0;

        return (
          <ProductSaleCard
            key={i}
            name={product.name || product.metaFluid || ''}
            pricePc={pricePc}
            avgPricePc={parseFloat(product.avgPrice ?? '') || 0}
            dollarPrice={dollarPrice}
            priceMax={400}
            priceStep={1}
            canEdit={canEdit}
            rdoName={`PricePc`}
            productPath={product.path}
            onPropertyChange={onPropertyChange}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// PRODUCT SALE CARD (individual card)
// =============================================================================

function ProductSaleCard({
  name,
  supply,
  demand,
  pricePc,
  avgPricePc,
  dollarPrice,
  priceMax,
  priceStep,
  canEdit,
  rdoName,
  productPath: _productPath,
  onPropertyChange,
}: {
  name: string;
  supply?: number;
  demand?: number;
  pricePc: number;
  avgPricePc: number;
  dollarPrice: number;
  priceMax: number;
  priceStep: number;
  canEdit: boolean;
  rdoName: string;
  productPath?: string;
  onPropertyChange: (name: string, value: number) => void;
}) {
  const supplyColor =
    supply === undefined
      ? ''
      : supply >= 100
        ? styles.pscSupplyGood
        : supply > 0
          ? styles.pscSupplyWarn
          : styles.pscSupplyBad;

  return (
    <div className={styles.pscCard}>
      <div className={styles.pscHeader}>
        <span className={styles.pscName}>{name}</span>
        {supply !== undefined && (
          <span className={`${styles.pscSupply} ${supplyColor}`}>
            Supply {supply}%
          </span>
        )}
      </div>

      {demand !== undefined && (
        <span className={styles.pscDemand}>Local Demand: {demand}%</span>
      )}

      <span className={styles.pscPrice}>
        {dollarPrice > 0 ? `${formatCurrency(dollarPrice)} (${pricePc}%)` : `${pricePc}%`}
      </span>

      <PriceSliderWithMarker
        value={pricePc}
        avgPrice={avgPricePc}
        max={priceMax}
        step={priceStep}
        canEdit={canEdit}
        rdoName={rdoName}
        onPropertyChange={onPropertyChange}
      />
    </div>
  );
}

// =============================================================================
// PRICE SLIDER WITH AVG MARKER
// =============================================================================

export function PriceSliderWithMarker({
  value,
  avgPrice,
  max,
  step,
  canEdit,
  rdoName,
  onPropertyChange,
  onValueChange,
}: {
  value: number;
  avgPrice: number;
  max: number;
  step: number;
  canEdit: boolean;
  rdoName: string;
  onPropertyChange: (name: string, value: number) => void;
  /** The thumb's own value, reported on every move — for a label that has to
   *  follow the drag. Not debounced: the debounce below is for the wire. */
  onValueChange?: (value: number) => void;
}) {
  const [localVal, setLocalVal] = useState(isNaN(value) ? 0 : value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = parseFloat(e.target.value);
      setLocalVal(newVal);
      onValueChange?.(newVal);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        onPropertyChange(rdoName, newVal);
      }, 300);
    },
    [rdoName, onPropertyChange, onValueChange],
  );

  const markerPct = max > 0 ? Math.min(100, (avgPrice / max) * 100) : 0;

  if (!canEdit) {
    return <span className={styles.pscPriceReadonly}>{value}%</span>;
  }

  return (
    <div className={styles.pscSlider}>
      <div className={styles.pscSliderTrack}>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={max}
          step={step}
          value={localVal}
          onChange={handleChange}
        />
        <div
          className={styles.pscAvgMarker}
          style={{ left: `${markerPct}%` }}
          title={`Avg: ${avgPrice}%`}
        />
      </div>
      <span className={styles.sliderValue}>{localVal}%</span>
    </div>
  );
}
