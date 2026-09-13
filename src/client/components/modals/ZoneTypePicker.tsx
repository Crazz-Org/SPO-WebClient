/**
 * ZoneTypePicker — Compact modal for selecting a zone type to paint.
 *
 * Shows all ZONE_TYPES as a vertical list with color swatches.
 * Click a zone type → close modal + start painting.
 */

import { X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useClient } from '../../context';
import { ZONE_TYPES } from '@/shared/types';
import { officeLabel } from './office-label';
import styles from './ZoneTypePicker.module.css';

export function ZoneTypePicker() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const client = useClient();
  const username = useGameStore((s) => s.username);
  const politicalRoles = usePoliticsStore((s) => s.politicalRoles);

  if (modal !== 'zonePicker') return null;

  const office = officeLabel(username ? politicalRoles.get(username.toLowerCase()) : undefined);

  const handleSelect = (zoneId: number) => {
    closeModal();
    client.onToggleZonePainting(zoneId);
  };

  const handleBackdropClick = () => {
    closeModal();
  };

  return (
    <>
      <div className={styles.backdrop} onClick={handleBackdropClick} />
      <div className={styles.modal} role="dialog" aria-label="Zone Type Picker">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <span className={styles.title}>Select Zone Type</span>
            {office && <span className={styles.office}>{office}</span>}
          </div>
          <button className={styles.closeBtn} onClick={closeModal} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className={styles.list}>
          {ZONE_TYPES.map((zone) => (
            <button
              key={zone.id}
              className={styles.zoneItem}
              onClick={() => handleSelect(zone.id)}
            >
              <div className={styles.swatch} style={{ backgroundColor: zone.color }} />
              <span className={styles.label}>{zone.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
