/**
 * FacilityFilterMenu — hide whole kinds of facility (CLASSES.BIN FacIds) to declutter a dense
 * city. Sibling of OverlayMenu on the 'overlays' surface, never nested inside its menu role.
 */

import { useMemo } from 'react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { Checkbox } from '../common/Toggle';
import type { FacilityKind } from '@/shared/facility-kinds';
import styles from './FacilityFilterMenu.module.css';

export function FacilityFilterMenu() {
  const kinds = useUiStore((s) => s.facilityKinds);
  const hiddenFacIds = useGameStore((s) => s.settings.hiddenFacIds);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const client = useClient();

  const hiddenSet = useMemo(() => new Set(hiddenFacIds), [hiddenFacIds]);

  const commit = (next: number[]) => {
    updateSettings({ hiddenFacIds: next });
    client.onSettingsChange({ ...useGameStore.getState().settings, hiddenFacIds: next });
  };

  const handleShowAll = () => commit([]);
  const handleHideAll = () => commit(kinds.map((k) => k.facId));

  const handleToggle = (kind: FacilityKind, visible: boolean) => {
    const next = visible
      ? hiddenFacIds.filter((id) => id !== kind.facId)
      : [...hiddenFacIds, kind.facId];
    commit(next);
  };

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>Facility kinds</span>
        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={handleShowAll} disabled={kinds.length === 0}>
            Show all
          </button>
          <button className={styles.actionBtn} onClick={handleHideAll} disabled={kinds.length === 0}>
            Hide all
          </button>
        </div>
      </div>
      {kinds.length === 0 ? (
        <div className={styles.loading}>Loading facility kinds…</div>
      ) : (
        <div className={styles.list}>
          {kinds.map((kind) => (
            <Checkbox
              key={kind.facId}
              label={kind.label}
              checked={!hiddenSet.has(kind.facId)}
              onChange={(e) => handleToggle(kind, e.target.checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
