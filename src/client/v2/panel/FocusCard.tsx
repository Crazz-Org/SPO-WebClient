/**
 * FocusCard — UI v2: the compact card over the focused building (replaces StatusOverlay).
 *
 * Follows the building on screen as the classic popover does (worldToScreenCentered, one rAF
 * loop, cancelled on unmount or when the focus goes), but never leaves the visible map: it sits
 * above the building, flips below it when the top deck leaves no room, and is clamped within
 * the viewport (placeFocusCard). It opens the inspector with the
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
import {
  buildFocusCard,
  salesTone,
  placeFocusCard,
  samePlacement,
  FALLBACK_CARD_SIZE,
  TOP_DECK_BOTTOM,
  type FactTone,
  type FocusCardPlacement,
} from './focus-card-model';
import styles from './FocusCard.module.css';

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
  const [placement, setPlacement] = useState<FocusCardPlacement | null>(null);
  const rafRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!building || !isOverlay) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const pos = worldToScreenCentered(building.x, building.y, building.xsize ?? 1, building.ysize ?? 1);
      if (pos) {
        // offsetWidth/Height: the laid-out size, unaffected by the entry animation's scale.
        // Layout is clean at the start of a frame, so this read costs no extra reflow.
        const el = cardRef.current;
        const next = placeFocusCard({
          anchorX: pos.x,
          textureTop: pos.y,
          textureHeight: pos.textureHeight,
          cardWidth: el?.offsetWidth || FALLBACK_CARD_SIZE.width,
          cardHeight: el?.offsetHeight || FALLBACK_CARD_SIZE.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          topInset: TOP_DECK_BOTTOM,
        });
        // Only re-render when the card actually moves on screen.
        setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [building, isOverlay]);

  const model = useMemo(() => (building ? buildFocusCard(building) : null), [building]);

  if (!building || !isOverlay || !placement || !model) return null;

  return (
    <div
      ref={cardRef}
      className={styles.card}
      style={{ left: placement.left, top: placement.top }}
      data-side={placement.side}
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

      <span
        className={`${styles.caret} ${placement.side === 'below' ? styles.caretBelow : ''}`}
        style={{ left: placement.caretX }}
        aria-hidden="true"
      />
    </div>
  );
}
