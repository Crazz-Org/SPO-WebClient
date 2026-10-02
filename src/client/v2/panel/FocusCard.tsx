/**
 * FocusCard — UI v2 slot: the compact card over the focused building (replaces StatusOverlay).
 *
 * Phase 0 placeholder: renders the classic StatusOverlay so v2 stays playable. Contract: this
 * path, this export name, no props; keep data-testid "status-overlay" and "inspect-button".
 */

import { StatusOverlay } from '../../components/building';

export function FocusCard() {
  return <StatusOverlay />;
}
