/**
 * MobileBuildContent — Combined build interface for mobile.
 *
 * Three subtabs: Buildings (embedded BuildMenu), Roads, Demolish.
 * Roads/Demolish activate modes on the renderer and dismiss the sheet.
 */

import { useState } from 'react';
import { Building2, Route, Trash2 } from 'lucide-react';
import { useClient } from '../../context';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { BuildMenu } from '../modals';
import { DEBUG_MARKERS } from '../../debug-markers';
import styles from './MobileBuildContent.module.css';

type BuildSubtab = 'buildings' | 'roads' | 'demolish';

export function MobileBuildContent() {
  const [subtab, setSubtab] = useState<BuildSubtab>('buildings');
  const client = useClient();
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const isPublicOfficeRole = useGameStore((s) => s.isPublicOfficeRole);

  const handleBuildRoad = () => {
    client.onBuildRoad();
    setMobileTab('map');
  };

  const handleDemolishRoad = () => {
    client.onDemolishRoad();
    setMobileTab('map');
  };

  const handleBuildMenuClose = () => {
    setMobileTab('map');
  };

  return (
    <div className={styles.container} data-testid={DEBUG_MARKERS.mobileBuildContent} data-subtab={subtab}>
      {/* Segmented control */}
      <div className={styles.tabs} role="tablist">
        <button
          className={`${styles.tab} ${subtab === 'buildings' ? styles.tabActive : ''}`}
          onClick={() => setSubtab('buildings')}
          role="tab"
          aria-selected={subtab === 'buildings'}
        >
          <Building2 size={16} />
          Buildings
        </button>
        <button
          className={`${styles.tab} ${subtab === 'roads' ? styles.tabActive : ''}`}
          onClick={() => setSubtab('roads')}
          role="tab"
          aria-selected={subtab === 'roads'}
        >
          <Route size={16} />
          Roads
        </button>
        <button
          className={`${styles.tab} ${subtab === 'demolish' ? styles.tabActive : ''}`}
          onClick={() => setSubtab('demolish')}
          role="tab"
          aria-selected={subtab === 'demolish'}
        >
          <Trash2 size={16} />
          Demolish
        </button>
      </div>

      {/* Subtab content */}
      <div className={styles.content}>
        {subtab === 'buildings' && (
          <BuildMenu onClose={handleBuildMenuClose} />
        )}

        {subtab === 'roads' && (
          <div className={styles.actionList}>
            <button className={styles.actionBtn} onClick={handleBuildRoad}>
              <Route size={20} />
              <div className={styles.actionInfo}>
                <span className={styles.actionLabel}>Build Road</span>
                <span className={styles.actionDesc}>Drag to draw road segments</span>
              </div>
            </button>
            <button className={styles.actionBtn} onClick={handleDemolishRoad}>
              <Trash2 size={20} />
              <div className={styles.actionInfo}>
                <span className={styles.actionLabel}>Demolish Road</span>
                <span className={styles.actionDesc}>Click or drag to remove roads</span>
              </div>
            </button>
          </div>
        )}

        {subtab === 'demolish' && (
          <div className={styles.actionList}>
            <button className={styles.actionBtn} onClick={handleDemolishRoad}>
              <Trash2 size={20} />
              <div className={styles.actionInfo}>
                <span className={styles.actionLabel}>Demolish Roads</span>
                <span className={styles.actionDesc}>Click or drag to remove road tiles</span>
              </div>
            </button>
            {isPublicOfficeRole && (
              <button
                className={styles.actionBtn}
                onClick={() => {
                  useUiStore.getState().openModal('zonePicker');
                  setMobileTab('map');
                }}
              >
                <Building2 size={20} />
                <div className={styles.actionInfo}>
                  <span className={styles.actionLabel}>Zone Painting</span>
                  <span className={styles.actionDesc}>Paint zones on the map (Public Office)</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
