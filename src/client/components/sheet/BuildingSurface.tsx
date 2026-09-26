/**
 * BuildingSurface — the `building` content of the universal sheet.
 *
 * One surface for every building (socle-3c). A civic building (Capitol, Town Hall) used to
 * open a centred modal with its own header; opening any picker from it destroyed the
 * inspector (audit §1.1 P6). Now it is the same sheet content as a factory, with the civic
 * header (President / Mayor, refresh) drawn here and the inspector body below it.
 */

import { RefreshCw, Mail } from 'lucide-react';
import { useBuildingStore, REFRESH_BUILDING_ACTION } from '../../store/building-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useClient } from '../../context';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import { BuildingInspector } from '../building';
import { getCivicSubtitle, findPropertyValue } from '../building/civic-subtitle';
import { isCapitolBuilding } from '../politics/CivicTabConfig';
import { mayorAddress, writeTo } from '../mail/write-to';
import { IconButton } from '../common';
import styles from './BuildingSurface.module.css';

export function BuildingSurface() {
  const details = useBuildingStore((s) => s.details);
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const refreshing = useBuildingStore((s) => s.inFlightActions).has(REFRESH_BUILDING_ACTION);
  const politicsData = usePoliticsStore((s) => s.data);
  const client = useClient();

  const visualClass = details?.visualClass ?? focusedBuilding?.visualClass;
  const civic = visualClass ? isCivicBuilding(visualClass) : false;

  if (!civic) return <BuildingInspector />;

  const title = details?.buildingName ?? focusedBuilding?.buildingName ?? 'City Government';
  const townName = details ? findPropertyValue(details, 'Town') : undefined;
  const capitol = details ? isCapitolBuilding(details.tabs) : false;
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title} tabIndex={-1}>{title}</h2>
          {details && <span className={styles.subtitle}>{getCivicSubtitle(details, politicsData)}</span>}
        </div>
        {details && !capitol && townName && (
          <IconButton
            icon={<Mail size={16} />}
            label={`Write to the Mayor of ${townName}`}
            size="sm"
            variant="ghost"
            onClick={() => writeTo(mayorAddress(townName))}
          />
        )}
        <IconButton
          icon={<RefreshCw size={16} />}
          label={refreshing ? 'Refreshing…' : 'Refresh'}
          size="sm"
          variant="ghost"
          disabled={!details || refreshing}
          onClick={() => {
            if (details) client.onRefreshBuilding(details.x, details.y, { userInitiated: true });
          }}
        />
      </div>
      <div className={styles.body}>
        <BuildingInspector hideHeader />
      </div>
    </div>
  );
}
