/**
 * SignalLine — the v2 signal line, one slim line under the TopBar (plan §2a): the sentence the
 * server writes about the town under the camera on the left (v1 ContextStatusStrip), the
 * newest world event on the right (v1 WorldEventTicker). Ambient information lives in one
 * band at the top instead of being split between the top and the bottom of the map.
 *
 * Each half is its own polite live region, as the two v1 strips were. The event is a button
 * that moves the camera to its tile when the event carried one. The line takes no pointer
 * events itself — only its two chips do — so the map stays draggable through the gap, and it
 * disappears entirely when there is nothing to say. Its right edge moves left while a surface
 * is open, because the side panel docks at the same height (`--v2-panel-top`).
 */

import { MapPin, Radio } from 'lucide-react';
import { useMapStore } from '../../store/map-store';
import { useUiStore } from '../../store/ui-store';
import { useContextStatus } from './useContextStatus';
import { useWorldEvent } from './useWorldEvent';
import { contextSentence, cx, eventCaption } from './topbar-model';
import styles from './SignalLine.module.css';

export function SignalLine() {
  const town = contextSentence(useContextStatus());
  const event = eventCaption(useWorldEvent());
  const surfaceOpen = useUiStore((s) => s.stack.length > 0 && !s.connectMode.active);

  if (!town && !event) return null;
  const tile = event?.tile ?? null;

  const goTo = (target: { x: number; y: number }) => {
    const map = useMapStore.getState();
    map.source?.centerOn(target.x, target.y);
    map.recordPosition(target.x, target.y);
  };

  return (
    <div className={cx(styles.line, surfaceOpen && styles.shifted)} data-testid="v2-signal-line">
      {town && (
        <div className={cx(styles.chip, styles.town)} role="status" aria-live="polite">
          <MapPin size={12} className={styles.icon} aria-hidden="true" />
          <span className={styles.text}>{town}</span>
        </div>
      )}
      {event && (
        <div className={cx(styles.chip, styles.event)} role="status" aria-live="polite" title={event.label}>
          <Radio size={12} className={styles.icon} aria-hidden="true" />
          {tile ? (
            <button
              type="button"
              className={styles.link}
              aria-label={`Go to (${tile.x}, ${tile.y})`}
              onClick={() => goTo(tile)}
            >
              {event.label}
            </button>
          ) : (
            <span className={styles.text}>{event.label}</span>
          )}
        </div>
      )}
    </div>
  );
}
