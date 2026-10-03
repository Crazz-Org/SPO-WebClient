/**
 * useContextStatus — the one sentence the server writes about the town under the camera
 * (`ContextStatusText`, `Interface Server/InterfaceServer.pas:149`), for the v2 SignalLine.
 *
 * The same reading as v1's ContextStatusStrip, at the same cadence (its constants are
 * imported, not copied): the camera is looked at every `CAMERA_POLL_MS` (local, no traffic),
 * and the server is asked when the camera reached another tile or `IDLE_REFRESH_MS` has
 * passed (Voyager's idle timer, `MapIsoHandler.pas:188`). While a building is focused the
 * building's own card is the line, so this asks nothing and returns ''.
 */

import { useEffect, useState } from 'react';
import { useBuildingStore } from '../../store/building-store';
import { useMapStore } from '../../store/map-store';
import { useClient } from '../../context/ClientContext';
import { CAMERA_POLL_MS, IDLE_REFRESH_MS } from '../../components/hud/ContextStatusStrip';

export function useContextStatus(): string {
  const focused = useBuildingStore((s) => s.focusedBuilding !== null);
  const client = useClient();
  const [text, setText] = useState('');

  useEffect(() => {
    if (focused) {
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
      // A slow answer never overwrites a newer one, nor lands after unmount.
      if (!cancelled && lastTile && lastTile.x === x && lastTile.y === y) setText(answer);
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
  }, [focused, client]);

  return focused ? '' : text;
}
