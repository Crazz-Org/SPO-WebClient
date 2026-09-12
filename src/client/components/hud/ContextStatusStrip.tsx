/**
 * ContextStatusStrip — the town under the camera, while nothing is selected.
 *
 * The server's own sentence for the place the player is looking at
 * (`ContextStatusText`, Interface Server/InterfaceServer.pas:149). It is the
 * idle line: selecting a building gives the HUD something more specific to say,
 * so the strip steps aside until the selection is cleared.
 *
 * An empty answer means "no town here" (Kernel/World.pas:4243) — nothing is
 * rendered, rather than an empty bar.
 */

import { useGameStore } from '../../store/game-store';
import { useBuildingStore } from '../../store/building-store';
import styles from './ContextStatusStrip.module.css';

export function ContextStatusStrip() {
  const text = useGameStore((s) => s.contextStatusText);
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);

  if (focusedBuilding || !text) return null;

  return (
    <div
      className={styles.strip}
      role="status"
      aria-live="polite"
      data-testid="context-status-strip"
    >
      {text}
    </div>
  );
}
