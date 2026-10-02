/**
 * SidePanel — UI v2 slot: the docked right panel showing the surface stack (replaces Sheet).
 *
 * Phase 0 placeholder: renders the classic Sheet so v2 stays playable. Contract: this path,
 * this export name, no props (read stores and useClient()); route 'building' to InspectorV2.
 */

import { Sheet } from '../../components/sheet';

export function SidePanel() {
  return <Sheet />;
}
