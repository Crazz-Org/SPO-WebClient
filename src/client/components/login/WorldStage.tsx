/**
 * WorldStage — World selection grid.
 *
 * Stage B of the cinematic login flow.
 * Cards in a responsive grid with gold hover glow. Offline worlds greyed out.
 */

import { GlassCard } from '../common';
import type { WorldInfo } from '@/shared/types';
import { TimeoutCategory } from '@/shared/timeout-categories';
import { ConnectingGauge } from './ConnectingGauge';
import styles from './WorldStage.module.css';

interface WorldStageProps {
  worlds: WorldInfo[];
  /** The area these worlds came from — only the legacy theme's tab strip shows it. */
  zoneId?: string;
  /** Loads another area in place (the legacy tab strip); without it a tab falls back to onBack. */
  onSelectZone?: (zoneId: string) => void;
  onSelect: (worldName: string) => void;
  onBack?: () => void;
  onRetry: (() => void) | null;
  isLoading: boolean;
  /** RDOCanJoinNewWorld said this account already holds as many worlds as its nobility allows. */
  atWorldLimit?: boolean;
}

/** The original Universe Map's tab order (WORLD_ZONES lists beta first). */
const LEGACY_TAB_ORDER = ['free', 'restricted', 'beta'] as const;

export function WorldStage({
  worlds, zoneId, onSelectZone, onSelect, onBack, onRetry, isLoading, atWorldLimit,
}: WorldStageProps) {
  const available = worlds.filter((w) => w.running3 !== false);
  const offline = worlds.filter((w) => w.running3 === false);

  return (
    <div className={styles.stage} data-zone={zoneId}>
      {/* Universe Map chrome of the legacy theme (UniversalMapViewer.dfm): the area tabs,
          captioned by the stylesheet with the current one lit through data-zone. Hidden in
          every other theme; a tab loads its area in place, or goes back to the picker. */}
      <div className={styles.legacyTabs} aria-hidden="true">
        {LEGACY_TAB_ORDER.map((id) => (
          <span
            key={id}
            data-zone-tab={id}
            onClick={() => (onSelectZone ? onSelectZone(id) : onBack?.())}
          />
        ))}
      </div>
      {/* data-legacy-text: the original client's caption (Label11 in UniversalMapViewer.dfm),
          shown by the legacy theme's stylesheet in place of this one. */}
      <h2 className={styles.title} data-legacy-text="Worlds found in this area:">
        Select a World
      </h2>
      <p className={styles.subtitle}>
        Choose your destination — each world has its own economy and politics
      </p>

      {atWorldLimit && (
        <p className={styles.limitNotice}>
          You have reached the number of worlds your nobility allows. You can still enter a world
          where you already own a company; any other world will only let you in as a visitor.
        </p>
      )}

      {worlds.length === 0 ? (
        <div className={styles.emptyState}>
          <p>The servers are down. No world in this region is reachable right now.</p>
          {onRetry && (
            <button
              className={styles.retryBtn}
              onClick={onRetry}
              disabled={isLoading}
              data-legacy-text="REFRESH ALL"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
      <div className={styles.grid}>
        {available.map((world) => (
          <GlassCard
            key={world.name}
            className={styles.worldCard}
            onClick={() => !isLoading && onSelect(world.name)}
          >
            <div className={styles.cardHeader}>
              <span className={styles.worldName}>{world.name}</span>
              <span className={styles.statusBadge} data-status="online">
                Online
              </span>
            </div>
            {/* data-name: the legacy theme's ticker opens with it ("Shamba. Population: …") */}
            <div className={styles.worldStats} data-name={world.name}>
              <div className={styles.statItem} data-stat="online">
                <span className={styles.statValue}>
                  {world.online ?? world.players ?? 0}
                </span>
                <span className={styles.statLabel}>Online</span>
              </div>
              <div className={styles.statItem} data-stat="population">
                <span className={styles.statValue}>
                  {(world.population ?? 0).toLocaleString()}
                </span>
                <span className={styles.statLabel}>Population</span>
              </div>
              {world.investors != null && world.investors > 0 && (
                <div className={styles.statItem} data-stat="investors">
                  <span className={styles.statValue}>{world.investors}</span>
                  <span className={styles.statLabel}>Tycoons</span>
                </div>
              )}
              {world.date && (
                <div className={styles.statItem} data-stat="year">
                  <span className={styles.statValue}>{world.date}</span>
                  <span className={styles.statLabel}>Year</span>
                </div>
              )}
            </div>
          </GlassCard>
        ))}

        {offline.map((world) => (
          <GlassCard key={world.name} className={`${styles.worldCard} ${styles.offlineCard}`}>
            <div className={styles.cardHeader}>
              <span className={styles.worldName}>{world.name}</span>
              <span className={styles.statusBadge} data-status="offline">
                Offline
              </span>
            </div>
            <div className={styles.worldStats}>
              <span className={styles.statLabel}>Server unavailable</span>
            </div>
          </GlassCard>
        ))}
      </div>
      )}

      {isLoading && (
        <div className={styles.overlay}>
          <div className={styles.overlayContent}>
            <ConnectingGauge label="Connecting to world..." category={TimeoutCategory.NORMAL} />
          </div>
        </div>
      )}

      {onBack && (
        <button className={styles.backBtn} onClick={onBack}>
          Back to Regions
        </button>
      )}

      {/* The original panel's buttons, legacy theme only (hidden elsewhere, never focusable).
          JUMP TO PLANET stays disabled as on the original's fresh map: a click on a world
          enters it directly here. REFRESH PLANET LIST re-queries the directory. */}
      <div className={styles.legacyButtons} aria-hidden="true">
        <button type="button" className={styles.legacyJump} tabIndex={-1} disabled>
          JUMP TO PLANET
        </button>
        <button
          type="button"
          className={styles.legacyRefresh}
          tabIndex={-1}
          onClick={onRetry ?? undefined}
          disabled={!onRetry || isLoading}
        >
          REFRESH PLANET LIST
        </button>
      </div>
    </div>
  );
}
