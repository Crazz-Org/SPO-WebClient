/**
 * Dialog — the one modal of the design system (doc/ux/handoff/00-socle.md §2.8).
 *
 * It exists to make a spend, a destruction or an irreversible choice deliberate. Everything
 * else lives in the universal sheet, which is not modal. Accessibility is built in rather
 * than added per call site, because the audit (doc/ux/audit.md §3.1) found that none of the
 * eleven existing dialogs trapped or restored focus:
 *
 *  - `role="dialog" aria-modal="true" aria-labelledby`, description wired by id;
 *  - focus is TRAPPED (Tab / Shift+Tab cycle inside) and RESTORED to the element that was
 *    focused before the dialog opened;
 *  - initial focus goes to the SAFE action for a destructive dialog and to the primary
 *    action otherwise — one keystroke cannot destroy anything;
 *  - Escape = secondary action; clicking the scrim = secondary action;
 *  - `typeToConfirm` keeps the "type CONFIRM" guard the demolish flow relies on today;
 *  - `dontAskAgainKey` offers a session-scoped opt-out (sessionStorage) for repeated spends
 *    such as building placement — never for destructive dialogs.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Dialog.module.css';

export type DialogKind = 'spend' | 'destructive' | 'info';

export interface DialogRow {
  label: string;
  value: string;
  tone?: 'gold' | 'positive' | 'negative' | 'neutral';
}

export interface DialogProps {
  title: string;
  description?: ReactNode;
  kind?: DialogKind;
  /** Key/value lines (cost, cash after, …) rendered in a quiet box under the description. */
  rows?: DialogRow[];
  /** Extra content between rows and buttons (a Field for a prompt, for instance). */
  children?: ReactNode;
  primary: { label: string; onClick: () => void; disabled?: boolean };
  /** Defaults to "Cancel". */
  secondary?: { label: string };
  /**
   * Renders only the primary button (no secondary / Cancel). For an informational dialog whose
   * one action is to close it.
   */
  singleAction?: boolean;
  /** The user must type this exact text before the primary action is enabled. */
  typeToConfirm?: string;
  /** Shows a "Don't ask again this session" checkbox; the choice is stored under this key. */
  dontAskAgainKey?: string;
  onClose: () => void;
}

const DONT_ASK_PREFIX = 'spo.dialog.dontAsk.';

/** True when the user opted out of this dialog for the session. Exported so callers can skip it. */
export function isDialogSuppressed(key: string): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DONT_ASK_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function suppressDialog(key: string, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(DONT_ASK_PREFIX + key, '1');
    else sessionStorage.removeItem(DONT_ASK_PREFIX + key);
  } catch {
    /* storage unavailable — the dialog simply keeps asking */
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  description,
  kind = 'info',
  rows,
  children,
  primary,
  secondary,
  singleAction = false,
  typeToConfirm,
  dontAskAgainKey,
  onClose,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [dontAsk, setDontAsk] = useState(false);

  const typedOk = typeToConfirm === undefined || typed === typeToConfirm;
  const primaryDisabled = Boolean(primary.disabled) || !typedOk;

  // Focus: remember the opener, move in, give it back on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = kind === 'destructive' ? secondaryRef.current : primaryRef.current;
    // A typed guard wants the keyboard in the input first.
    const input = typeToConfirm ? boxRef.current?.querySelector<HTMLInputElement>('input[data-type-to-confirm]') : null;
    (input ?? target ?? boxRef.current)?.focus();
    return () => {
      opener?.focus?.();
    };
  }, [kind, typeToConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Enter' && typeToConfirm && (e.target as HTMLElement).tagName === 'INPUT' && !primaryDisabled) {
        e.preventDefault();
        primary.onClick();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const nodes = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, primary, primaryDisabled, typeToConfirm],
  );

  const handlePrimary = useCallback(() => {
    if (primaryDisabled) return;
    if (dontAskAgainKey) suppressDialog(dontAskAgainKey, dontAsk);
    primary.onClick();
  }, [dontAsk, dontAskAgainKey, primary, primaryDisabled]);

  return (
    <div className={styles.scrim} onClick={onClose} data-testid="dialog-scrim">
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`${styles.box} ${kind === 'destructive' ? styles.destructive : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h3 id={titleId} className={styles.title}>{title}</h3>
          {description && <p id={descId} className={styles.description}>{description}</p>}
        </div>

        {rows && rows.length > 0 && (
          <dl className={styles.rows}>
            {rows.map((r, i) => (
              <div key={i} className={styles.row}>
                <dt className={styles.rowLabel}>{r.label}</dt>
                <dd className={`${styles.rowValue} ${styles[`tone-${r.tone ?? (i === 0 ? 'gold' : 'neutral')}`]}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {children}

        {typeToConfirm && (
          <label className={styles.typeLabel}>
            <span>
              Type <strong>{typeToConfirm}</strong> to confirm
            </span>
            <input
              data-type-to-confirm
              className={styles.typeInput}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={typed.length > 0 && !typedOk ? true : undefined}
            />
          </label>
        )}

        {dontAskAgainKey && kind !== 'destructive' && (
          <label className={styles.dontAsk}>
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            <span>Don&apos;t ask again this session</span>
          </label>
        )}

        <div className={styles.actions}>
          {!singleAction && (
            <Button ref={secondaryRef} variant="ghost" onClick={onClose}>
              {secondary?.label ?? 'Cancel'}
            </Button>
          )}
          <Button
            ref={primaryRef}
            variant={kind === 'destructive' ? 'danger' : 'primary'}
            onClick={handlePrimary}
            disabled={primaryDisabled}
          >
            {primary.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
