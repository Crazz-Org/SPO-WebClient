/**
 * MobileInfoBar — Slim horizontal top bar replacing desktop InfoWidget on mobile.
 *
 * Single row: [World + Date] [Cash] [Income/h] [Debt?] [Rank + Name]
 * Glass background, 36px tall, z-300.
 * Tap to open the Profile (empire) surface; when the tycoon is in debt
 * (failureLevel >= 1) a "Debt" tag appears and taps through to the grouped
 * My facilities list instead (H6) — one interaction to the losing buildings.
 */

import { formatMoney, formatIncome, incomeSign } from '../../format-utils';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { isPanelOffered } from '../../visitor-gating';
import styles from './MobileInfoBar.module.css';

/** Format date compactly: "Aug 27, 92" */
function formatDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function MobileInfoBar() {
  const worldName = useGameStore((s) => s.worldName);
  const tycoonStats = useGameStore((s) => s.tycoonStats);
  const gameDate = useGameStore((s) => s.gameDate);
  const username = useGameStore((s) => s.username);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const openLeftPanel = useUiStore((s) => s.openLeftPanel);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const canOpenEmpire = isPanelOffered('empire', isVisitor);
  const canOpenFacilities = isPanelOffered('facilities', isVisitor);

  const handleTap = () => {
    setMobileTab('map');
    openLeftPanel('empire');
  };

  const handleDebtTap = () => {
    setMobileTab('map');
    openLeftPanel('facilities');
  };

  const failureLevel = tycoonStats?.failureLevel ?? 0;
  const sign = tycoonStats ? incomeSign(tycoonStats.incomePerHour) : 'neutral';
  const incomeClass =
    sign === 'positive' ? styles.incomePositive
      : sign === 'negative' ? styles.incomeNegative
        : styles.incomeNeutral;

  const mainContent = (
    <>
      {/* World + Date */}
      <span className={styles.world}>
        {worldName ? worldName.toUpperCase() : 'OFFLINE'}
      </span>
      <span className={styles.date}>{formatDate(gameDate)}</span>

      {/* Financial */}
      {tycoonStats && (
        <>
          <span className={styles.cash}>{formatMoney(tycoonStats.cash)}</span>
          <span className={incomeClass}>{formatIncome(tycoonStats.incomePerHour)}</span>
        </>
      )}
    </>
  );

  const identityContent = tycoonStats && (
    <span className={styles.identity}>
      #{tycoonStats.ranking} {username}
    </span>
  );

  return (
    <div className={styles.bar}>
      {/* A visitor has no empire to open: the same content, not a button (no dead control). */}
      {canOpenEmpire ? (
        <button className={styles.tapArea} onClick={handleTap} aria-label="Open empire overview">
          {mainContent}
        </button>
      ) : (
        <div className={styles.tapArea}>{mainContent}</div>
      )}

      {failureLevel >= 1 && canOpenFacilities && (
        <button
          className={styles.debtTag}
          onClick={handleDebtTap}
          aria-label="View facilities losing money"
        >
          Debt
        </button>
      )}

      {/* Identity — same tap target as the main area */}
      {tycoonStats && (canOpenEmpire ? (
        <button className={styles.identityTap} onClick={handleTap} aria-label="Open empire overview">
          {identityContent}
        </button>
      ) : (
        <div className={styles.identityTap}>{identityContent}</div>
      ))}
    </div>
  );
}
