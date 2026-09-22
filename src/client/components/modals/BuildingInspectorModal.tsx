/**
 * BuildingInspectorModal — Centered modal for civic buildings (Capitol, TownHall).
 *
 * Wraps the standard BuildingInspector in a wider centered modal
 * to accommodate dense tab content (coverage, towns, ministers, votes).
 */

import { RefreshCw, X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore, REFRESH_BUILDING_ACTION } from '../../store/building-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useClient } from '../../context';
import { BuildingInspector } from '../building/BuildingInspector';
import { ErrorBoundary, IconButton } from '../common';
import { getCivicSubtitle } from '../building/civic-subtitle';
import styles from './BuildingInspectorModal.module.css';

export function BuildingInspectorModal() {
  const modal = useUiStore((s) => s.modal);
  const modalBeneath = useUiStore((s) => s.modalBeneath);
  const closeModal = useUiStore((s) => s.closeModal);
  const details = useBuildingStore((s) => s.details);
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const refreshing = useBuildingStore((s) => s.inFlightActions).has(REFRESH_BUILDING_ACTION);
  const politicsData = usePoliticsStore((s) => s.data);
  const client = useClient();

  // Stay mounted while a prompt or confirm is stacked on top: unmounting would
  // throw away the open tab and the scroll position, and the appoint flow raises
  // a prompt on every single use.
  if (modal !== 'buildingInspector' && modalBeneath !== 'buildingInspector') return null;

  const handleClose = () => {
    closeModal();
    useBuildingStore.getState().clearFocus();
  };

  const handleRefresh = () => {
    if (details) client.onRefreshBuilding(details.x, details.y);
  };

  return (
    <>
      <div className={styles.backdrop} onClick={handleClose} aria-hidden="true" />
      <div className={styles.modal} role="dialog" aria-label={details?.buildingName ?? 'Building Inspector'}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{details?.buildingName ?? focusedBuilding?.buildingName ?? 'City Government'}</h2>
            {details && (
              <div className={styles.subtitle}>
                <span className={styles.roleLabel}>{getCivicSubtitle(details, politicsData)}</span>
                {details.x !== undefined && details.y !== undefined && (
                  <span className={styles.coords}>{details.x}, {details.y}</span>
                )}
              </div>
            )}
          </div>
          <div className={styles.headerActions}>
            <IconButton
              icon={<RefreshCw size={16} />}
              label="Refresh"
              size="sm"
              variant="ghost"
              disabled={refreshing}
              onClick={handleRefresh}
            />
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className={styles.body}>
          <ErrorBoundary>
            <BuildingInspector hideHeader />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
