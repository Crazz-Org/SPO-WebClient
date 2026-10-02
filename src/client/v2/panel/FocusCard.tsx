/**
 * FocusCard — UI v2: the compact card over the focused building (replaces StatusOverlay).
 *
 * Follows the building on screen exactly as the classic popover does (worldToScreenCentered,
 * one rAF loop, cancelled on unmount or when the focus goes) and opens the inspector with the
 * same `onInspectFocusedBuilding` call. At most 280 px wide: identity, revenue, the diagnosis
 * sentence, two headline figures and the top sales lines — the inspector carries the rest.
 * The data-testids "status-overlay" and "inspect-button" are kept for the E2E selectors.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, DoorOpen, Minus, ScanSearch, TrendingDown, TrendingUp } from 'lucide-react';
import { useBuildingStore } from '../../store/building-store';
import { worldToScreenCentered } from '../../bridge/client-bridge';
import { useClient } from '../../context/ClientContext';
import { DiagnosisBanner } from '../../components/building/DiagnosisBanner';
import { buildFocusCard, salesTone, type FactTone } from './focus-card-model';
import styles from './FocusCard.module.css';

/** Gap between the caret tip and the top of the building texture (pixels). */
const CARET_GAP = 8;

const TONE_CLASS: Record<FactTone, string> = {
  positive: styles.tonePositive,
  warning: styles.toneWarning,
  negative: styles.toneNegative,
  gold: styles.toneGold,
  neutral: styles.toneNeutral,
};

function RevenueIcon({ direction }: { direction: 'up' | 'down' | 'neutral' }) {
  const p = { size: 12, 'aria-hidden': true as const };
  if (direction === 'up') return <TrendingUp {...p} />;
  if (direction === 'down') return <TrendingDown {...p} />;
  return <Minus {...p} />;
}

const REVENUE_CLASS = { up: styles.revenueUp, down: styles.revenueDown, neutral: styles.revenueNeutral };

export function FocusCard() {
  const building = useBuildingStore((s) => s.focusedBuilding);
  const isOverlay = useBuildingStore((s) => s.isOverlayMode);
  const client = useClient();
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!building || !isOverlay) {
      setScreenPos(null);
      return;
    }
    const update = () => {
      const pos = worldToScreenCentered(building.x, building.y, building.xsize ?? 1, building.ysize ?? 1);
      if (pos) {
        // Only re-render when the building actually moved on screen.
        setScreenPos((prev) => (prev && prev.x === pos.x && prev.y === pos.y ? prev : { x: pos.x, y: pos.y }));
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [building, isOverlay]);

  const model = useMemo(() => (building ? buildFocusCard(building) : null), [building]);

  if (!building || !isOverlay || !screenPos || !model) return null;

  return (
    <div
      className={styles.card}
      style={{ left: screenPos.x, top: screenPos.y - CARET_GAP }}
      data-testid="status-overlay"
      role="group"
      aria-label={`${model.name} summary`}
    >
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.name} title={model.name}>{model.name}</span>
          {model.level !== null && <span className={styles.level}>Lvl {model.level}</span>}
        </div>
        {(model.owner || model.revenue) && (
          <div className={styles.metaRow}>
            {model.owner && <span className={styles.owner} title={model.owner}>{model.owner}</span>}
            {model.revenue && (
              <span className={`${styles.revenue} ${REVENUE_CLASS[model.revenue.direction]}`}>
                <RevenueIcon direction={model.revenue.direction} />
                {model.revenue.text}
              </span>
            )}
          </div>
        )}
      </header>

      <DiagnosisBanner diagnosis={model.diagnosis} compact />
      {model.hint && <p className={styles.hint}>{model.hint}</p>}

      {model.facts.length > 0 && (
        <dl className={styles.facts}>
          {model.facts.map((f, i) => (
            <div key={`${f.label}-${i}`} className={styles.fact}>
              <dt className={styles.factLabel} title={f.label}>{f.label}</dt>
              <dd className={`${styles.factValue} ${f.sub ? '' : TONE_CLASS[f.tone]}`} title={f.value}>{f.value}</dd>
              {f.sub && (
                <dd className={`${styles.factSub} ${TONE_CLASS[f.tone]}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {f.sub}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}

      {model.note && <p className={styles.note} title={model.note}>{model.note}</p>}

      {model.sales && (
        <ul className={styles.sales} aria-label="Sales">
          {model.sales.lines.map((line, i) => (
            <li key={`${line.category}-${i}`} className={styles.salesRow}>
              <span className={styles.salesCategory} title={line.category}>{line.category}</span>
              <span className={styles.salesTrack} aria-hidden="true">
                <span
                  className={`${styles.salesFill} ${TONE_CLASS[salesTone(line.percent)]}`}
                  style={{ width: `${Math.max(0, Math.min(100, line.percent))}%` }}
                />
              </span>
              <span className={`${styles.salesPercent} ${TONE_CLASS[salesTone(line.percent)]}`}>{line.percent}%</span>
            </li>
          ))}
        </ul>
      )}
      {model.salesText && <p className={styles.note} title={model.salesText}>{model.salesText}</p>}

      {(model.factsOmitted > 0 || (model.sales?.more ?? 0) > 0) && (
        <p className={styles.more}>
          +{model.factsOmitted + (model.sales?.more ?? 0)} more in the {model.isCivic ? 'building' : 'inspector'}
        </p>
      )}

      <button
        type="button"
        className={styles.action}
        onClick={() => client.onInspectFocusedBuilding()}
        data-testid="inspect-button"
      >
        {model.isCivic ? <DoorOpen size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}
        <span>{model.actionLabel}</span>
        <ChevronRight size={14} aria-hidden="true" className={styles.actionChevron} />
      </button>

      <span className={styles.caret} aria-hidden="true" />
    </div>
  );
}
