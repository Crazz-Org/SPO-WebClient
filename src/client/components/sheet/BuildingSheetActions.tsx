/**
 * BuildingSheetActions — the non-civic building's surface-level actions
 * (View on map, Refresh), hosted in the sheet's own stack row instead of a
 * second toolbar inside the inspector.
 */

import { Crosshair, RefreshCw } from 'lucide-react';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import { IconButton } from '../common';

export function BuildingSheetActions() {
  const details = useBuildingStore((s) => s.details);
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const client = useClient();

  const visualClass = details?.visualClass ?? focusedBuilding?.visualClass;
  const isCivic = visualClass ? isCivicBuilding(visualClass) : false;

  if (isCivic || !details) return null;

  return (
    <>
      <IconButton
        icon={<Crosshair size={16} />}
        label="View on map"
        size="sm"
        variant="ghost"
        onClick={() => client.onNavigateToBuilding(details.x, details.y)}
      />
      <IconButton
        icon={<RefreshCw size={16} />}
        label="Refresh"
        size="sm"
        variant="ghost"
        onClick={() => client.onRefreshBuilding(details.x, details.y)}
      />
    </>
  );
}
