/**
 * ZoneStage — Region/zone selector.
 *
 * Stage between Auth and World selection.
 * Shows BETA, Free Space, Restricted Space zone cards.
 */

import { useEffect, useRef } from 'react';
import { GlassCard } from '../common';
import { WORLD_ZONES, type WorldZone } from '@/shared/types';
import { TimeoutCategory } from '@/shared/timeout-categories';
import { ConnectingGauge } from './ConnectingGauge';
import styles from './ZoneStage.module.css';

interface ZoneStageProps {
  onSelect: (zone: WorldZone) => void;
  isLoading: boolean;
  /**
   * Picks this area as soon as the stage shows, once — the legacy theme's Universe Map opens
   * on Free Space as the original client did (`--login-default-zone`, read by LoginScreen).
   * Unset: the picker waits for a click.
   */
  autoSelectZoneId?: string;
}

/** Short descriptions for each zone */
const ZONE_DESCRIPTIONS: Record<string, string> = {
  beta: 'Testing zone — experimental features and frequent resets',
  free: 'Open economy — unrestricted play for all tycoons',
  restricted: 'Competitive zone — advanced rules and limited resources',
};

/**
 * The automatic pick waits this long after the stage shows: the sign-in has just closed its
 * Directory Server session, and a second connection opened in the same instant timed out on
 * the live DS (gateway log 2026-10-15, `directory_query socket … not connected after
 * 10000 ms`). A player clicking a region never hits that window.
 */
export const AUTO_SELECT_DELAY_MS = 1000;
/** One quiet retry when the automatic pick fails; after that the player clicks. */
export const AUTO_SELECT_ATTEMPTS = 2;

export function ZoneStage({ onSelect, isLoading, autoSelectZoneId }: ZoneStageProps) {
  const autoAttempts = useRef(0);
  const userPicked = useRef(false);
  useEffect(() => {
    if (!autoSelectZoneId || isLoading || userPicked.current) return;
    if (autoAttempts.current >= AUTO_SELECT_ATTEMPTS) return;
    const zone = WORLD_ZONES.find((z) => z.id === autoSelectZoneId);
    if (!zone) return;
    // A retry waits a little longer than the first try.
    const delay = AUTO_SELECT_DELAY_MS * (autoAttempts.current + 1);
    const timer = setTimeout(() => {
      if (userPicked.current) return;
      autoAttempts.current += 1;
      onSelect(zone);
    }, delay);
    return () => clearTimeout(timer);
  }, [autoSelectZoneId, isLoading, onSelect]);

  const pick = (zone: WorldZone) => {
    userPicked.current = true;
    onSelect(zone);
  };

  return (
    <div className={styles.stage}>
      {/* data-legacy-text: the original Universe Map's captions (UniversalMapViewer.dfm —
          Label11 and the ticker's welcome line), shown by the legacy theme's stylesheet. */}
      <h2 className={styles.title} data-legacy-text="Worlds found in this area:">
        Select a Region
      </h2>
      <p
        className={styles.subtitle}
        data-legacy-text="Welcome to the Universal Map. Click on any of the worlds above to display extended information."
      >
        Each region hosts its own set of worlds with different rules
      </p>

      <div className={styles.grid}>
        {WORLD_ZONES.map((zone) => (
          <GlassCard
            key={zone.id}
            className={styles.zoneCard}
            onClick={() => !isLoading && pick(zone)}
          >
            <span className={styles.zoneName}>{zone.name}</span>
            <span className={styles.zoneDesc}>
              {ZONE_DESCRIPTIONS[zone.id] ?? zone.path}
            </span>
          </GlassCard>
        ))}
      </div>

      {isLoading && (
        <div className={styles.overlay}>
          <div className={styles.overlayContent}>
            <ConnectingGauge label="Querying region..." category={TimeoutCategory.DIRECTORY} />
          </div>
        </div>
      )}
    </div>
  );
}
