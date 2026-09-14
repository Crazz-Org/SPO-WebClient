/**
 * StatusPill — the desktop status line (doc/ux/handoff/00-socle.md §4.1).
 *
 * Everything the InfoWidget knew, in one horizontal glass pill centred on the free
 * area above the map: world · game date · cash · income/h · sparkline · Debt tag ·
 * rank · name · role · company · facilities · freshness. The cash and name segments
 * open the empire surface; the Debt tag opens the grouped My facilities list
 * (H6) — an alert that leads nowhere is a dead end, not information.
 */

import { useEffect, useState } from 'react';
import { incomeSign } from '../../format-utils';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { Sparkline } from '../common';
import styles from './StatusPill.module.css';

const COMPACT_DATE: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

/** Narrow no-break space — the group separator the design uses ("$ 12 480 300"). */
const NNBSP = '\u202F';

function formatCompactDate(date: Date | null): string {
  if (!date) return '...';
  return date.toLocaleDateString('en-US', COMPACT_DATE);
}

/** Parse a server money string ("1,234,567", "-500", "+800") into a number, NaN-safe. */
function parseAmount(value: string | number): number {
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : value;
  return isNaN(num) ? 0 : num;
}

/** "$ 12 480 300" — groups of three joined by narrow no-break spaces, "-$ …" when negative. */
export function formatGroupedMoney(value: string | number): string {
  const num = parseAmount(value);
  const digits = Math.round(Math.abs(num)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${num < 0 ? '-' : ''}$${NNBSP}${grouped}`;
}

/** "+$ 184 200 / h", "-$ 1 200 / h", "$ 0 / h". */
export function formatGroupedIncome(income: string): string {
  const num = parseAmount(income);
  const body = formatGroupedMoney(Math.abs(num));
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}${body}${NNBSP}/${NNBSP}h`;
}

/** Format a timestamp as a relative "Xs ago" / "Xm ago" string. */
function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function Divider() {
  return <span className={styles.divider} aria-hidden="true" />;
}

export function StatusPill() {
  const username = useGameStore((s) => s.username);
  const worldName = useGameStore((s) => s.worldName);
  const companyName = useGameStore((s) => s.companyName);
  const tycoonStats = useGameStore((s) => s.tycoonStats);
  const gameDate = useGameStore((s) => s.gameDate);
  const ownerRole = useGameStore((s) => s.ownerRole);
  const cashHistory = useGameStore((s) => s.cashHistory);
  const lastStatsUpdate = useGameStore((s) => s.lastStatsUpdate);
  const watchers = useGameStore((s) => s.watchers);
  const serverBusy = useGameStore((s) => s.serverBusy);
  const surfaceOpen = useUiStore((s) => s.stack.length > 0 && !s.connectMode.active);

  // Tick every second to keep the "Xs ago" label fresh
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(lastStatsUpdate));
  useEffect(() => {
    setTimeAgo(formatTimeAgo(lastStatsUpdate));
    if (!lastStatsUpdate) return;
    const id = setInterval(() => setTimeAgo(formatTimeAgo(lastStatsUpdate)), 1000);
    return () => clearInterval(id);
  }, [lastStatsUpdate]);

  const openEmpire = () => useUiStore.getState().toggleLeftPanel('empire');

  const failureLevel = tycoonStats?.failureLevel ?? 0;
  const sign = tycoonStats ? incomeSign(tycoonStats.incomePerHour) : 'neutral';
  const incomeClass =
    sign === 'positive' ? styles.incomePositive
      : sign === 'negative' ? styles.incomeNegative
        : styles.incomeNeutral;

  const pillClass = [styles.pill, surfaceOpen ? styles.shifted : ''].filter(Boolean).join(' ');
  const debtClass = [styles.debt, failureLevel >= 2 ? styles.alertPulse : ''].filter(Boolean).join(' ');

  return (
    <header className={pillClass} aria-label="Player status">
      <span className={styles.world}>{worldName ? worldName.toUpperCase() : 'OFFLINE'}</span>
      <span className={styles.date}>{formatCompactDate(gameDate)}</span>

      {tycoonStats && (
        <>
          <Divider />
          <button
            type="button"
            className={styles.cashButton}
            onClick={openEmpire}
            aria-label="Open profile (finances)"
            title="Open profile (finances)"
          >
            <span className={styles.cash}>{formatGroupedMoney(tycoonStats.cash)}</span>
          </button>
          <span className={incomeClass}>{formatGroupedIncome(tycoonStats.incomePerHour)}</span>
          {cashHistory.length >= 2 && (
            <Sparkline data={cashHistory} color="gold" width={64} height={18} className={styles.sparkline} />
          )}

          {failureLevel >= 1 && (
            <>
              <Divider />
              {/* H6 — the alert leads somewhere: the grouped My facilities list */}
              <button
                type="button"
                className={debtClass}
                onClick={() => useUiStore.getState().openLeftPanel('facilities')}
                aria-label="View facilities losing money"
                title={`Debt — level ${failureLevel}. View facilities losing money.`}
              >
                <span className={styles.debtDot} aria-hidden="true" />
                Debt
              </button>
            </>
          )}

          <Divider />
          <span className={styles.rankBadge}>#{tycoonStats.ranking}</span>
          <button
            type="button"
            className={styles.nameButton}
            onClick={openEmpire}
            aria-label="Open profile"
            title="Open profile"
          >
            {username || 'Unknown'}
          </button>
          {ownerRole && <span className={styles.role}>{ownerRole}</span>}
          {companyName && <span className={styles.company}>· {companyName}</span>}
          <span className={styles.facilities}>
            · {tycoonStats.buildingCount}/{tycoonStats.maxBuildings}
          </span>
        </>
      )}

      {watchers.length > 0 && (
        <>
          <Divider />
          <span
            className={styles.watchers}
            aria-label={`Watching your area: ${watchers.join(', ')}`}
            title={`Watching your area: ${watchers.join(', ')}`}
          >
            <span className={styles.watchersDot} aria-hidden="true" />
            {watchers.length}
          </span>
        </>
      )}

      {serverBusy && (
        <>
          <Divider />
          <span
            className={styles.backup}
            aria-label="Backup in progress — the world is saving; some actions may be slower"
            title="Backup in progress — the world is saving; some actions may be slower"
          >
            <span className={styles.backupDot} aria-hidden="true" />
            Backup
          </span>
        </>
      )}

      {timeAgo && <span className={styles.freshness}>{timeAgo}</span>}
    </header>
  );
}
