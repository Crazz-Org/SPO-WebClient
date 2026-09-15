/**
 * FacilityFilter — hide whole KINDS of facility to declutter a dense city (issue #598).
 *
 * Rides inside the existing Overlays panel (`OverlayMenu`) rather than a new `SurfaceKind`:
 * the panel is already reachable on both desktop and mobile, so nothing new needs wiring.
 */

import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { Checkbox } from '../common/Toggle';
import styles from './FacilityFilter.module.css';

export function FacilityFilter() {
  const facilityKinds = useGameStore((s) => s.facilityKinds);
  const hiddenFacIds = useGameStore((s) => s.settings.hiddenFacIds);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const client = useClient();

  if (facilityKinds.length === 0) return null;

  const hidden = new Set(hiddenFacIds);
  const knownHiddenCount = facilityKinds.filter((k) => hidden.has(k.facId)).length;

  const apply = (next: number[]) => {
    updateSettings({ hiddenFacIds: next });
    client.onSettingsChange({ ...useGameStore.getState().settings, hiddenFacIds: next });
  };

  const toggle = (facId: number, shown: boolean) => {
    apply(shown ? hiddenFacIds.filter((id) => id !== facId) : [...hiddenFacIds, facId]);
  };

  const showAll = () => apply([]);
  const hideAll = () => apply(facilityKinds.map((k) => k.facId));

  const summary = knownHiddenCount === 0
    ? 'All facilities shown'
    : `${knownHiddenCount} of ${facilityKinds.length} kinds hidden`;

  return (
    <section className={styles.section} aria-label="Facility visibility">
      <h3 className={styles.heading}>Facility visibility</h3>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{summary}</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={showAll}
            disabled={knownHiddenCount === 0}
          >
            Show all
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={hideAll}
            disabled={knownHiddenCount === facilityKinds.length}
          >
            Hide all
          </button>
        </div>
      </div>
      <div className={styles.list}>
        {facilityKinds.map((kind) => (
          <Checkbox
            key={kind.facId}
            label={kind.label}
            checked={!hidden.has(kind.facId)}
            onChange={(e) => toggle(kind.facId, e.target.checked)}
          />
        ))}
      </div>
    </section>
  );
}
