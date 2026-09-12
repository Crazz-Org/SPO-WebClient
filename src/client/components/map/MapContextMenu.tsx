/**
 * MapContextMenu — the menu a right-click release (without drag) opens at the pointer.
 *
 * Lists the actions valid for the tile under the pointer: Inspect/Visit only when a
 * building sits there, Centre view here always. Empty ground offers no building action.
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useMapStore } from '../../store/map-store';
import { useClient } from '../../context/ClientContext';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import styles from './MapContextMenu.module.css';

/** Portal facilities (6031/6032) are non-interactive map decorations, same exclusion as building-focus-handler.ts. */
const PORTAL_VISUAL_CLASSES = new Set(['6031', '6032']);

const MENU_WIDTH_ESTIMATE = 200;

export function MapContextMenu() {
  const menu = useUiStore((s) => s.mapContextMenu);
  const closeMapContextMenu = useUiStore((s) => s.closeMapContextMenu);
  const isPlacingBuilding = useUiStore((s) => s.isPlacingBuilding);
  const connectModeActive = useUiStore((s) => s.connectMode.active);
  const isRoadBuildingMode = useGameStore((s) => s.isRoadBuildingMode);
  const isRoadDemolishMode = useGameStore((s) => s.isRoadDemolishMode);
  const isZonePaintingMode = useGameStore((s) => s.isZonePaintingMode);
  const client = useClient();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click elsewhere (a right-click elsewhere closes on press and reopens on release).
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMapContextMenu();
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [menu, closeMapContextMenu]);

  // Close as soon as any other mode starts.
  useEffect(() => {
    if (menu && (isPlacingBuilding || connectModeActive || isRoadBuildingMode || isRoadDemolishMode || isZonePaintingMode)) {
      closeMapContextMenu();
    }
  }, [menu, isPlacingBuilding, connectModeActive, isRoadBuildingMode, isRoadDemolishMode, isZonePaintingMode, closeMapContextMenu]);

  if (!menu) return null;

  const { clientX, clientY, tileX, tileY, layer, visualClass } = menu;
  const isBuilding = layer === 'building' && !!visualClass && !PORTAL_VISUAL_CLASSES.has(visualClass);
  const isCivic = isBuilding && isCivicBuilding(visualClass!);
  const left = Math.min(clientX, window.innerWidth - MENU_WIDTH_ESTIMATE);
  const top = Math.min(clientY, window.innerHeight - MENU_WIDTH_ESTIMATE);

  const inspect = () => {
    client.onNavigateToBuilding(tileX, tileY);
    closeMapContextMenu();
  };

  const centerHere = () => {
    useMapStore.getState().source?.centerOn(tileX, tileY);
    closeMapContextMenu();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Map actions"
      data-testid="map-context-menu"
      className={styles.menu}
      style={{ left, top }}
    >
      {isBuilding && (
        <button role="menuitem" className={styles.item} onClick={inspect}>
          {isCivic ? 'Visit' : 'Inspect'}
        </button>
      )}
      <button role="menuitem" className={styles.item} onClick={centerHere}>
        Centre view here
      </button>
      <div className={styles.footer}>({tileX}, {tileY})</div>
    </div>
  );
}
