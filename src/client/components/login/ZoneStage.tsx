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

export function ZoneStage({ onSelect, isLoading, autoSelectZoneId }: ZoneStageProps) {
  const autoFired = useRef(false);
  useEffect(() => {
    if (autoFired.current || !autoSelectZoneId || isLoading) return;
    const zone = WORLD_ZONES.find((z) => z.id === autoSelectZoneId);
    if (!zone) return;
    autoFired.current = true;
    onSelect(zone);
  }, [autoSelectZoneId, isLoading, onSelect]);

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
