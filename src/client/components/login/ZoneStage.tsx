/**
 * ZoneStage — Region/zone selector.
 *
 * Stage between Auth and World selection.
 * Shows BETA, Free Space, Restricted Space zone cards.
 */

import { GlassCard } from '../common';
import { WORLD_ZONES, type WorldZone } from '@/shared/types';
import { TimeoutCategory } from '@/shared/timeout-categories';
import { ConnectingGauge } from './ConnectingGauge';
import styles from './ZoneStage.module.css';

interface ZoneStageProps {
  onSelect: (zone: WorldZone) => void;
  isLoading: boolean;
}

/** Short descriptions for each zone */
const ZONE_DESCRIPTIONS: Record<string, string> = {
  beta: 'Testing zone — experimental features and frequent resets',
  free: 'Open economy — unrestricted play for all tycoons',
  restricted: 'Competitive zone — advanced rules and limited resources',
};

export function ZoneStage({ onSelect, isLoading }: ZoneStageProps) {
  return (
    <div className={styles.stage}>
      <h2 className={styles.title}>Select a Region</h2>
      <p className={styles.subtitle}>
        Each region hosts its own set of worlds with different rules
      </p>

      <div className={styles.grid}>
        {WORLD_ZONES.map((zone) => (
          <GlassCard
            key={zone.id}
            className={styles.zoneCard}
            onClick={() => !isLoading && onSelect(zone)}
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
