/**
 * TopBar — the v2 top deck: the player's whole status in one bar along the top edge
 * (replaces v1's StatusPill; plan §2a).
 *
 * Left to right: world and game date · treasury (cash over income/h, the cash trend) ·
 * alert lamps (Debt, Backup, watchers) · identity (rank, name over company, role, facilities)
 * · freshness · Hide interface. Same click targets as StatusPill — the treasury and the name
 * open the empire surface, the Debt tag opens My facilities (H6) — but 36 px tall.
 *
 * Unlike StatusPill it never drops a segment when a surface opens: the side panel docks
 * under the top deck (`--v2-panel-top`), so the bar keeps its full width. On a narrow desktop
 * the cash trend hides and the lamps keep their icon (their words stay in the accessible
 * name and the tooltip); long names end in an ellipsis.
 *
 * A visitor (no company, chooseVisa.asp) has no empire and no facilities to open: the same
 * figures render as plain text, never as a button that leads nowhere — the rule the mobile
 * info bar already follows (`isPanelOffered`).
 */

import { useEffect, useState } from 'react';
import { Building2, DatabaseBackup, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { isPanelOffered } from '../../visitor-gating';
import { Sparkline } from '../../components/common';
import { formatGroupedIncome, formatGroupedMoney } from '../../components/hud/StatusPill';
import {
  BACKUP_LABEL,
  cx,
  debtState,
  facilitiesLabel,
  formatCompactDate,
  formatTimeAgo,
  incomeTone,
  roleLabel,
  watchersLabel,
  worldLabel,
} from './topbar-model';
import styles from './TopBar.module.css';

/** "Xs ago", re-read every second while there is a stats timestamp. */
function useTimeAgo(timestamp: number | null): string {
  const [label, setLabel] = useState(() => formatTimeAgo(timestamp, Date.now()));
  useEffect(() => {
    setLabel(formatTimeAgo(timestamp, Date.now()));
    if (!timestamp) return;
    const id = setInterval(() => setLabel(formatTimeAgo(timestamp, Date.now())), 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  return label;
}

function Divider() {
  return <span className={styles.divider} aria-hidden="true" />;
}

const INCOME_CLASS = {
  positive: styles.incomePositive,
  negative: styles.incomeNegative,
  neutral: styles.incomeNeutral,
} as const;

export function TopBar() {
  const username = useGameStore((s) => s.username);
  const worldName = useGameStore((s) => s.worldName);
  const companyName = useGameStore((s) => s.companyName);
  const tycoonStats = useGameStore((s) => s.tycoonStats);
  const gameDate = useGameStore((s) => s.gameDate);
  const ownerRole = useGameStore((s) => s.ownerRole);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const cashHistory = useGameStore((s) => s.cashHistory);
  const lastStatsUpdate = useGameStore((s) => s.lastStatsUpdate);
  const watchers = useGameStore((s) => s.watchers);
  const serverBusy = useGameStore((s) => s.serverBusy);
  const timeAgo = useTimeAgo(lastStatsUpdate);

  const canOpenEmpire = isPanelOffered('empire', isVisitor);
  const canOpenFacilities = isPanelOffered('facilities', isVisitor);
  const openEmpire = () => useUiStore.getState().toggleLeftPanel('empire');
  const openFacilities = () => useUiStore.getState().openLeftPanel('facilities');
  const hideInterface = () => useUiStore.getState().toggleHudVisible();

  const debt = debtState(tycoonStats);
  const watching = watchersLabel(watchers);
  const role = roleLabel(ownerRole, isVisitor);

  const treasury = tycoonStats && (
    <>
      <span className={styles.cash}>{formatGroupedMoney(tycoonStats.cash)}</span>
      <span className={INCOME_CLASS[incomeTone(tycoonStats)]}>{formatGroupedIncome(tycoonStats.incomePerHour)}</span>
    </>
  );

  const identity = (
    <>
      <span className={styles.name}>{username || 'Unknown'}</span>
      {companyName && <span className={styles.company}>{companyName}</span>}
    </>
  );

  const hasLamps = Boolean((debt && canOpenFacilities) || serverBusy || watching);

  return (
    <header className={styles.bar} aria-label="Player status">
      <div className={styles.world}>
        <span className={styles.worldName}>{worldLabel(worldName)}</span>
        <span className={styles.date}>{formatCompactDate(gameDate)}</span>
      </div>

      {tycoonStats && (
        <>
          <Divider />
          {canOpenEmpire ? (
            <button
              type="button"
              className={cx(styles.stack, styles.target)}
              onClick={openEmpire}
              aria-label="Open profile (finances)"
              title="Open profile (finances)"
            >
              {treasury}
            </button>
          ) : (
            <div className={styles.stack}>{treasury}</div>
          )}
          {cashHistory.length >= 2 && (
            <Sparkline data={cashHistory} color="gold" width={64} height={20} className={styles.sparkline} />
          )}
        </>
      )}

      {hasLamps && <Divider />}
      {hasLamps && (
        <div className={styles.lamps}>
          {debt && canOpenFacilities && (
            // H6 — the alert leads somewhere: the grouped My facilities list
            <button
              type="button"
              className={cx(styles.lamp, styles.debt, debt.critical && styles.alertPulse)}
              onClick={openFacilities}
              aria-label="View facilities losing money"
              title={debt.title}
            >
              <TriangleAlert size={14} aria-hidden="true" />
              <span className={styles.lampText}>Debt</span>
            </button>
          )}
          {serverBusy && (
            <span className={cx(styles.lamp, styles.backup)} role="img" aria-label={BACKUP_LABEL} title={BACKUP_LABEL}>
              <DatabaseBackup size={14} aria-hidden="true" />
              <span className={styles.lampText} aria-hidden="true">Backup</span>
            </span>
          )}
          {watching && (
            <span className={cx(styles.lamp, styles.watchers)} role="img" aria-label={watching} title={watching}>
              <Eye size={14} aria-hidden="true" />
              <span aria-hidden="true">{watchers.length}</span>
            </span>
          )}
        </div>
      )}

      <span className={styles.spacer} />

      {tycoonStats && (
        <div className={styles.identity}>
          <span className={styles.rank} title="Ranking">#{tycoonStats.ranking}</span>
          {canOpenEmpire ? (
            <button
              type="button"
              className={cx(styles.stack, styles.target, styles.who)}
              onClick={openEmpire}
              aria-label="Open profile"
              title="Open profile"
            >
              {identity}
            </button>
          ) : (
            <div className={cx(styles.stack, styles.who)}>{identity}</div>
          )}
          {role && <span className={styles.role}>{role}</span>}
          <span className={styles.facilities} title={`Facilities: ${tycoonStats.buildingCount} of ${tycoonStats.maxBuildings}`}>
            <Building2 size={14} aria-hidden="true" />
            {facilitiesLabel(tycoonStats)}
          </span>
        </div>
      )}

      {timeAgo && (
        <span className={styles.freshness} title="Last status update from the server">
          {timeAgo}
        </span>
      )}

      <button
        type="button"
        className={styles.hide}
        onClick={hideInterface}
        aria-label="Hide interface"
        title="Hide interface (H)"
      >
        <EyeOff size={18} aria-hidden="true" />
      </button>
    </header>
  );
}
