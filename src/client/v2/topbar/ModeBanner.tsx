/**
 * ModeBanner — the active map MODE (placement / road / zones / connect), top-centre under the
 * signal line (plan §2a; replaces the mode row of v1's CommandBar).
 *
 * Reads the one shared description of the mode (`useModeDescriptor`, also behind the v1
 * command bar and the mobile mode bar), so the words and the way out are the same in every
 * interface. What changes is where it sits: near the top of the map, in the player's eye
 * line, with the hint allowed to wrap to a second line instead of being cut — it is the most
 * important sentence on screen while the mode lasts. Placement offers Rotate view (W); every
 * mode offers its way out (Esc).
 *
 * It stays when the HUD is hidden (H): a mode the player cannot see is a trap.
 */

import { RotateCw } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { Button } from '../../components/common';
import { useModeDescriptor } from '../../components/hud/use-mode-descriptor';
import { cx, modeExitLabel } from './topbar-model';
import styles from './ModeBanner.module.css';

export function ModeBanner() {
  const client = useClient();
  const mode = useModeDescriptor();
  const surfaceOpen = useUiStore((s) => s.stack.length > 0 && !s.connectMode.active);

  if (!mode) return null;

  return (
    <div
      className={cx(styles.banner, mode.invalid && styles.invalid, surfaceOpen && styles.shifted)}
      role="status"
      aria-live="polite"
      data-testid="v2-mode-banner"
    >
      <span className={styles.kind}>
        <span className={styles.dot} aria-hidden="true" />
        {mode.kind}
      </span>
      <span className={styles.title}>{mode.title}</span>
      {(mode.cost || mode.cashAfter) && (
        <span className={styles.money}>
          {mode.cost && <span className={styles.cost}>{mode.cost}</span>}
          {mode.cashAfter && (
            <span className={styles.after}>
              after: <span className={mode.cashAfterNegative ? styles.neg : styles.pos}>{mode.cashAfter}</span>
            </span>
          )}
        </span>
      )}
      <span className={cx(styles.hint, mode.invalid && styles.hintInvalid)}>
        {mode.hint}
        {mode.overlayNote && <span className={styles.note}> · {mode.overlayNote}</span>}
      </span>
      <span className={styles.actions}>
        {mode.isPlacing && (
          <Button size="sm" variant="secondary" kbd="W" iconLeft={<RotateCw size={14} />} onClick={() => client.onRotateCW()}>
            Rotate view
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          kbd="Esc"
          onClick={mode.onDone}
          aria-label={modeExitLabel(mode.doneLabel, mode.kind)}
        >
          {mode.doneLabel}
        </Button>
      </span>
    </div>
  );
}
