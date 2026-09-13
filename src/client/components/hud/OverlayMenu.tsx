/**
 * OverlayMenu — Content for the overlays left panel.
 *
 * Renders inside LeftPanel. Grouped by category: Special, Environment,
 * Population, Market. Only one overlay active at a time; clicking the active
 * overlay disables it.
 */

import { OVERLAY_LIST, type SurfaceType } from '@/shared/types';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { Checkbox } from '../common';
import styles from './OverlayMenu.module.css';

const CATEGORY_LABELS: Record<string, string> = {
  special: 'Special',
  environment: 'Environment',
  population: 'Population',
  market: 'Market',
};

export function OverlayMenu() {
  const activeOverlay = useGameStore((s) => s.activeOverlay);
  const isCityZonesEnabled = useGameStore((s) => s.isCityZonesEnabled);
  const facilityKinds = useGameStore((s) => s.facilityKinds);
  const hiddenFacIds = useGameStore((s) => s.settings.hiddenFacIds);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const client = useClient();

  const handleSelect = (type: SurfaceType) => {
    client.onSetOverlay(type);
  };

  const handleToggleCityZones = () => {
    client.onToggleCityZones();
  };

  const hidden = new Set(hiddenFacIds);

  const applyHidden = (nextHiddenFacIds: number[]) => {
    updateSettings({ hiddenFacIds: nextHiddenFacIds });
    client.onSettingsChange({ ...useGameStore.getState().settings, hiddenFacIds: nextHiddenFacIds });
  };

  // Group overlays by category, rendering category headers
  let lastCategory = '';

  return (
    <>
      <div className={styles.list} role="menu" aria-label="Map Overlays">
        {OVERLAY_LIST.map((overlay) => {
          const showHeader = overlay.category !== lastCategory;
          lastCategory = overlay.category;

          const isZones = overlay.type === 'ZONES';
          const isActive = isZones ? isCityZonesEnabled : activeOverlay === overlay.type;

          return (
            <div key={overlay.type}>
              {showHeader && (
                <div className={styles.categoryLabel}>{CATEGORY_LABELS[overlay.category]}</div>
              )}
              <button
                className={`${styles.item} ${isActive ? styles.active : ''}`}
                role="menuitem"
                onClick={() => isZones ? handleToggleCityZones() : handleSelect(overlay.type)}
              >
                <span className={styles.itemLabel}>{overlay.label}</span>
                {isActive && <span className={styles.indicator} />}
              </button>
            </div>
          );
        })}
      </div>
      {facilityKinds.length > 0 && (
        <section className={styles.kinds} aria-label="Facility kinds">
          <div className={styles.categoryLabel}>Facilities</div>
          <div className={styles.kindActions}>
            <button type="button" className={styles.kindAction} onClick={() => applyHidden([])}>Show all</button>
            <button type="button" className={styles.kindAction} onClick={() => applyHidden(facilityKinds.map((k) => k.facId))}>Hide all</button>
          </div>
          {facilityKinds.map((kind) => (
            <Checkbox
              key={kind.facId}
              className={styles.kindRow}
              label={kind.label}
              checked={!hidden.has(kind.facId)}
              onChange={(e) => applyHidden(e.target.checked ? [...hidden].filter((id) => id !== kind.facId) : [...hidden, kind.facId])}
            />
          ))}
        </section>
      )}
    </>
  );
}
