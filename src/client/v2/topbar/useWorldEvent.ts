/**
 * useWorldEvent — the newest world event (`PickEvent`, `Interface Server/InterfaceServer.pas:166`)
 * for the v2 SignalLine, read exactly as v1's WorldEventTicker reads it.
 *
 * `PickEvent` pops the event off the tycoon's queue destructively (`Kernel/Kernel.pas:11255-11271`),
 * so nothing is asked while `document.hidden` — a poll nobody reads would throw the event away.
 * `POLL_MS` is imported from the ticker. A null answer (a backup running,
 * `InterfaceServer.pas:1161-1163`) keeps the last event in place.
 */

import { useEffect, useState } from 'react';
import { useClient } from '../../context/ClientContext';
import { POLL_MS } from '../../components/hud/WorldEventTicker';
import type { WorldEventLine } from '../../../shared/types';

export function useWorldEvent(): WorldEventLine | null {
  const client = useClient();
  const [event, setEvent] = useState<WorldEventLine | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (document.hidden) return;
      const next = await client.onRequestWorldEvent();
      if (!cancelled && next) setEvent(next);
    };

    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client]);

  return event;
}
