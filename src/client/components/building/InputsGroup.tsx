/**
 * InputsGroup — Company inputs (services/supplies) panel.
 *
 * Extracted from PropertyGroup.tsx. Renders the "compInputs" special tab:
 * accordion sections with demand sliders, supply bars, and read-only stats.
 */

import { useState, useCallback, useRef } from 'react';
import type { CompInputData } from '@/shared/types';
import { formatNumber } from '@/shared/building-details';
import { useClient } from '../../context';
import { SaveIndicator } from './SaveIndicator';
import styles from './PropertyGroup.module.css';

// =============================================================================
// COMPANY INPUTS PANEL (special === 'compInputs')
// =============================================================================

export function CompInputsPanel({
  compInputs,
  canEdit,
  buildingX,
  buildingY,
}: {
  compInputs: CompInputData[];
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
}) {
  if (compInputs.length === 0) {
    return <div className={styles.empty}>No company inputs</div>;
  }

  return (
    <div className={styles.ciAccordion}>
      {compInputs.map((data, i) => (
        <CompInputSection
          key={data.name || i}
          data={data}
          inputIndex={i}
          canEdit={canEdit && data.editable}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      ))}
    </div>
  );
}

function CompInputSection({
  data,
  inputIndex,
  canEdit,
  buildingX,
  buildingY,
}: {
  data: CompInputData;
  inputIndex: number;
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
}) {
  const client = useClient();
  const barMax = data.maxDemand > 0 ? data.maxDemand : data.demanded;
  const demPct = barMax > 0 ? Math.min(100, (data.demanded / barMax) * 100) : 0;
  const [localDemand, setLocalDemand] = useState(Math.round(demPct));
  const demandTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fillPct = data.demanded > 0 ? Math.min(100, (data.supplied / data.demanded) * 100) : 0;

  const handleDemandChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10)));
      setLocalDemand(val);
      if (demandTimeout.current) clearTimeout(demandTimeout.current);
      demandTimeout.current = setTimeout(() => {
        client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetCompanyInputDemand', String(val), {
          index: String(inputIndex),
        });
      }, 300);
    },
    [client, buildingX, buildingY, inputIndex],
  );

  return (
    <div className={styles.ciAccordionItem}>
      <div className={styles.ciAccordionHeader}>
        <span className={styles.ciAccordionName}>{data.name.toUpperCase()}</span>
      </div>
      <div className={styles.ciAccordionBody}>
        {data.editable ? (
          <>
            {/* Row 1: Demand slider */}
            <div className={styles.ciDemandRow}>
              <span className={styles.ciDemandLabel}>Demand</span>
              <input
                type="range"
                className={styles.slider}
                min={0}
                max={100}
                step={1}
                value={localDemand}
                disabled={!canEdit}
                onChange={handleDemandChange}
              />
              <span className={styles.ciDemandPerc}>{Math.round(demPct)}%</span>
              <SaveIndicator propertyKey={`RDOSetCompanyInputDemand:${JSON.stringify({ index: String(inputIndex) })}`} />
            </div>

            {/* Row 2: Supply bar — scaled to maxDemand capacity */}
            <div className={styles.ciDemandRow}>
              <span className={styles.ciDemandLabel}>Supply</span>
              <div className={styles.ciSupplyBar}>
                {/* Demand zone — faint gold showing demanded portion of max capacity */}
                <div className={styles.ciDemandZone} style={{ width: `${demPct}%` }} />
                {/* Supply fill — supplied portion of max capacity */}
                <div
                  className={`${styles.ciSupplyBarFill}${fillPct < 50 ? ` ${styles.ciBarCrit}` : fillPct < 100 ? ` ${styles.ciBarWarn}` : ''}`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <span className={styles.ciDemandPerc}>{Math.round(fillPct)}%</span>
            </div>

            {/* Demand below capacity warning */}
            {demPct < 100 && (
              <span className={styles.ciDemandBelowCap}>
                Demand below capacity
              </span>
            )}

            {/* Summary — includes max capacity when available */}
            <div className={styles.ciSummary}>
              <span className={styles.ciFluidLabel}>
                Supplied {formatNumber(data.supplied)} / Demanded {formatNumber(data.demanded)}{data.maxDemand > 0 ? ` / Max ${formatNumber(data.maxDemand)}` : ''} {data.units}
              </span>
            </div>
          </>
        ) : (
          /* Non-editable: read-only info rows (Requesting / Receiving / Ratio) */
          <div className={styles.ciReadOnlyGrid}>
            <div className={styles.ciReadOnlyRow}>
              <span className={styles.ciReadOnlyLabel}>Requesting</span>
              <span className={styles.ciReadOnlyValue}>{formatNumber(data.demanded)} {data.units}</span>
            </div>
            <div className={styles.ciReadOnlyRow}>
              <span className={styles.ciReadOnlyLabel}>Receiving</span>
              <span className={styles.ciReadOnlyValue}>{formatNumber(data.supplied)} {data.units}</span>
            </div>
            <div className={styles.ciReadOnlyRow}>
              <span className={styles.ciReadOnlyLabel}>Ratio</span>
              <span className={styles.ciReadOnlyValue}>{data.ratio}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
