/**
 * TycoonFullProfileView — the page "Show Profile" opens on a directory card
 * (`RenderTycoon.asp:119-124`): the tycoon's own `TycoonCurriculum.asp`, read
 * for whoever the card names.
 *
 * It is a VIEWER, never an editor. The sections the server withholds from a
 * viewer who is not the account holder — Reset Account / Abandon Role
 * (`TycoonCurriculum.asp:175-211`) and the "advance to next level" checkbox
 * (`:250-261`) — have no slot here at all, so a withheld section leaves no
 * heading, no empty card and no error. Neither does the session-only Stats
 * block (ranking / facilities / area): those describe the viewer, not the
 * tycoon being viewed.
 */

import { DollarSign, Star, Award, TrendingUp, Crown, Zap } from 'lucide-react';
import { formatMoney } from '../../format-utils';
import { useSearchStore } from '../../store/search-store';
import { GlassCard } from '../common';
import styles from './SearchPanel.module.css';

export function TycoonFullProfileView() {
  const reply = useSearchStore((s) => s.tycoonFullProfileData);

  if (!reply) {
    return <div className={styles.emptyState}>No profile data available.</div>;
  }

  const data = reply.data;

  // `StrTycoonCurriculum_14` (TycoonCurriculum.asp:417-421) — ObjValid=false, or
  // the fetch itself failed.
  if (data.cacheUnavailable) {
    return <div className={styles.emptyState}>The server could not read this tycoon&apos;s profile.</div>;
  }

  return (
    <div className={styles.listContainer}>
      <GlassCard className={styles.profileCard} light>
        <div className={styles.profileHeader}>
          {data.currentLevelBadgeUrl ? (
            <img
              className={styles.levelBadge}
              src={data.currentLevelBadgeUrl}
              alt={data.currentLevelName}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : null}
          <span className={styles.profileName}>{data.tycoonName}</span>
        </div>

        <div className={styles.profileStatsGrid}>
          <span className={styles.profileStatLabel}>
            <DollarSign size={12} /> Fortune
          </span>
          <span className={styles.profileStatValue}>{formatMoney(data.fortune)}</span>

          {data.averageProfit ? (
            <>
              <span className={styles.profileStatLabel}>
                <TrendingUp size={12} /> Avg. Profit
              </span>
              <span className={styles.profileStatValue}>{data.averageProfit}</span>
            </>
          ) : null}

          <span className={styles.profileStatLabel}>
            <Star size={12} /> Prestige
          </span>
          <span className={styles.profileStatValue}>{data.prestige} points</span>

          <span className={styles.profileStatLabel}>
            <Crown size={12} /> Nobility
          </span>
          <span className={styles.profileStatValue}>{data.nobPoints} points</span>

          {/* :162-174 — the Ability block exists on tournament worlds only. */}
          {data.tournamentOn ? (
            <>
              <span className={styles.profileStatLabel}>
                <Zap size={12} /> Ability
              </span>
              <span className={styles.profileStatValue}>
                {data.abilityTotal} points ({data.abilityRankingPoints} rankings,{' '}
                {data.abilityLevelPoints} level, {data.abilityLoanPoints} loans)
              </span>
            </>
          ) : null}
        </div>

        {/* :215-266 — the current level. A mayor (SuperRole <> 0) gets none of it. */}
        <div className={styles.sectionTitle}>
          <Award size={12} /> {data.currentLevelName}
        </div>
        {data.currentLevelDescription ? (
          <div className={styles.listItemDetails}>{data.currentLevelDescription}</div>
        ) : null}
        {data.currentLevelCondition ? (
          <div className={styles.listItemDetails}>{data.currentLevelCondition}</div>
        ) : null}
        {data.levelReqStatus ? (
          <div className={styles.listItemDetails}>{data.levelReqStatus}</div>
        ) : null}

        {/* :268-315 — the next-level column, absent at the top level. */}
        {data.nextLevelName ? (
          <>
            <div className={styles.sectionTitle}>Next level: {data.nextLevelName}</div>
            {data.nextLevelDescription ? (
              <div className={styles.listItemDetails}>{data.nextLevelDescription}</div>
            ) : null}
            {data.nextLevelRequirements ? (
              <div className={styles.listItemDetails}>Requires: {data.nextLevelRequirements}</div>
            ) : null}
          </>
        ) : null}

        {/* :320-344 — the rankings grid. */}
        {data.rankings.length > 0 ? (
          <>
            <div className={styles.sectionTitle}>In the rankings</div>
            {data.rankings.map((r) => (
              <div key={r.category} className={styles.rankingRow}>
                <span className={styles.rankingName}>{r.category}</span>
                <span className={styles.rankingValue}>{r.rank === null ? '-' : `#${r.rank}`}</span>
              </div>
            ))}
          </>
        ) : null}

        {/* :369-416 — curriculum items, prestige signed as the page prints it. */}
        {data.curriculumItems.length > 0 ? (
          <>
            <div className={styles.sectionTitle}>Curriculum items</div>
            {data.curriculumItems.map((item, idx) => (
              <div key={`${item.item}-${idx}`} className={styles.rankingRow}>
                <span className={styles.rankingName}>{item.item}</span>
                <span className={styles.rankingValue}>
                  {item.prestige > 0 ? `+${item.prestige}` : String(item.prestige)}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </GlassCard>
    </div>
  );
}
