/**
 * ContextStatusStrip — the one sentence the server writes about the town under
 * the camera (`ContextStatusText`, `Interface Server/InterfaceServer.pas:149`).
 *
 * This is the line Voyager kept on its secondary status caption. It refreshes on
 * an idle timer and, in Voyager, is replaced by the selected object's own status
 * text while something is selected (`MapIsoHandler.pas:672` disables the idle
 * timer, `:676-677` re-enables it when the object text is empty). Here the
 * selection is `focusedBuilding` and the object's line is `StatusOverlay`, so
 * this strip simply stands down while a building is focused.
 *
 * An empty answer is the normal "no town here" case (`Kernel/World.pas:4243`) —
 * the strip disappears rather than showing an empty bar.
 */

import { useEffect, useState } from 'react';
import { useBuildingStore } from '../../store/building-store';
import { useMapStore } from '../../store/map-store';
import { useClient } from '../../context/ClientContext';
import styles from './ContextStatusStrip.module.css';

/** Voyager's idle refresh: `fIdleTextTimer.Interval := 20000` (MapIsoHandler.pas:188). */
export const IDLE_REFRESH_MS = 20_000;
/** How often we look at the camera — local only, no traffic (mirrors useCameraHistory). */
export const CAMERA_POLL_MS = 1000;

export function ContextStatusStrip() {
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const client = useClient();
  const [text, setText] = useState('');

  useEffect(() => {
    // A building is selected: its own StatusOverlay is the line. Say nothing.
    if (focusedBuilding) {
      setText('');
      return;
    }

    let cancelled = false;
    let lastTile: { x: number; y: number } | null = null;
    let lastAskedAt = 0;

    const ask = async (x: number, y: number) => {
      lastTile = { x, y };
      lastAskedAt = Date.now();
      const answer = await client.onRequestContextStatus(x, y);
      // A slow answer must never overwrite a newer one, or the strip after unmount.
      if (!cancelled && lastTile && lastTile.x === x && lastTile.y === y) {
        setText(answer);
      }
    };

    const tick = () => {
      const { source } = useMapStore.getState();
      if (!source) return;
      const pos = source.getCameraPosition();
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);

      const moved = !lastTile || lastTile.x !== x || lastTile.y !== y;
      const stale = Date.now() - lastAskedAt >= IDLE_REFRESH_MS;
      if (moved || stale) void ask(x, y);
    };

    tick();
    const t = setInterval(tick, CAMERA_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [focusedBuilding, client]);

  if (focusedBuilding || !text.trim()) return null;

  return (
    <div className={styles.strip} role="status" aria-live="polite">
      {text}
    </div>
  );
}
