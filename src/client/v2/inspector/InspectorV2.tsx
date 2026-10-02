/**
 * InspectorV2 — UI v2 slot: the building inspector, one column with section tabs (replaces
 * BuildingSurface / BuildingInspector inside the side panel).
 *
 * Phase 0 placeholder: renders the classic BuildingSurface (civic header or BuildingInspector)
 * so v2 stays playable. Contract: this path, this export name, no props.
 */

import { BuildingSurface } from '../../components/sheet/BuildingSurface';

export function InspectorV2() {
  return <BuildingSurface />;
}
