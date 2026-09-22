/**
 * WorldEventTicker — the newest world event (`PickEvent`,
 * `Interface Server/InterfaceServer.pas:166`), where the legacy toolbar
 * scrolled events continuously (`Voyager/URLHandlers/ToolbarHandlerViewer.pas:207-271`).
 * Lives in the top band, directly under `StatusPill`, and shifts with the open sheet the
 * same way `StatusPill.shifted` does (issue 889).
 *
 * `PickEvent` pops the event off the tycoon's queue destructively
 * (`Kernel/Kernel.pas:11255-11271`) — a poll nobody reads throws the event
 * away, so this stands down while `document.hidden` is true.
 *
 * Cadence: Voyager had no fixed interval — a new event was fetched only once
 * the previous caption had finished scrolling, an effective ~10 s for a
 * typical caption (`ToolbarHandlerViewer.pas:207-217`). The card fixes the
 * band at 30-60 s; `POLL_MS` is the midpoint and is lighter than the legacy.
 *
 * An empty answer (a backup running, `InterfaceServer.pas:1161-1163`) is
 * never an error and never clears the strip — the last event stays in place
 * until a real one replaces it.
 *
 * Caption: `${date} — ${text}` (an em dash; the legacy used `' - '`,
 * `ToolbarHandlerViewer.pas:246`). When the event's URL carried a map tile,
 * the line is a button that moves the camera there — the WebClient cannot
 * host the ASP page the URL pointed at, so this is this card's own
 * substitution: Voyager's own `frame_Action=MOVETO` click existed only under
 * the `DEMO` command-line switch (`ToolbarHandlerViewer.pas:259-269`), never
 * as the normal path.
 */

import { useEffect, useState } from 'react';
import { useClient } from '../../context/ClientContext';
import { useMapStore } from '../../store/map-store';
import { useUiStore } from '../../store/ui-store';
import type { WorldEventLine } from '../../../shared/types';
import styles from './WorldEventTicker.module.css';

/** The card's 30-60 s band, midpoint — lighter than the legacy's effective ~10 s. */
export const POLL_MS = 45_000;

export function WorldEventTicker() {
  const client = useClient();
  const [event, setEvent] = useState<WorldEventLine | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      // The pop is destructive — polling a hidden tab throws events away.
      if (document.hidden) return;
      const next = await client.onRequestWorldEvent();
      // A null answer (a backup running) leaves the last event in place.
      if (!cancelled && next) setEvent(next);
    };

    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client]);

  const surfaceOpen = useUiStore((s) => s.stack.length > 0 && !s.connectMode.active);

  if (!event || !event.text.trim()) return null;

  const label = `${event.date} — ${event.text}`;
  const hasCoords = typeof event.x === 'number' && typeof event.y === 'number';

  const goToEvent = () => {
    if (!hasCoords) return;
    useMapStore.getState().source?.centerOn(event.x!, event.y!);
    useMapStore.getState().recordPosition(event.x!, event.y!);
  };

  const tickerClass = [styles.ticker, surfaceOpen ? styles.shifted : ''].filter(Boolean).join(' ');

  return (
    <div className={tickerClass} role="status" aria-live="polite">
      {hasCoords ? (
        <button
          type="button"
          className={styles.link}
          aria-label={`Go to (${event.x}, ${event.y})`}
          onClick={goToEvent}
        >
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
