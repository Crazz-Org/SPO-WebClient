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
  onSelect: (worldName: string) => void;
  onBack?: () => void;
  onRetry?: () => void;
  isLoading: boolean;
  /** RDOCanJoinNewWorld said this account already holds as many worlds as its nobility allows. */
  atWorldLimit?: boolean;
}

export function WorldStage({ worlds, onSelect, onBack, onRetry, isLoading, atWorldLimit }: WorldStageProps) {
  const available = worlds.filter((w) => w.running3 !== false);
  const offline = worlds.filter((w) => w.running3 === false);

  return (
    <div className={styles.stage}>
      <h2 className={styles.title}>Select a World</h2>
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
            <button className={styles.retryBtn} onClick={onRetry} disabled={isLoading}>
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
            <div className={styles.worldStats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>
                  {world.online ?? world.players ?? 0}
                </span>
                <span className={styles.statLabel}>Online</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>
                  {(world.population ?? 0).toLocaleString()}
                </span>
                <span className={styles.statLabel}>Population</span>
              </div>
              {world.investors != null && world.investors > 0 && (
                <div className={styles.statItem}>
                  <span className={styles.statValue}>{world.investors}</span>
                  <span className={styles.statLabel}>Tycoons</span>
                </div>
              )}
              {world.date && (
                <div className={styles.statItem}>
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
    </div>
  );
}
