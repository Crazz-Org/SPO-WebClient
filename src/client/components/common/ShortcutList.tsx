/**
 * ShortcutList — the keyboard shortcut reference, one row per SHORTCUTS entry in table order.
 *
 * Rendered by Settings → "Keyboard Shortcuts" and by the `?` help dialog, so both show the
 * same list and neither can drift from the handler's table.
 */

import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';
import styles from './ShortcutList.module.css';

export function ShortcutList() {
  return (
    <div className={styles.shortcutGrid} role="list">
      {SHORTCUTS.map((sc) => (
        <div key={sc.keys} className={styles.shortcutRow} role="listitem">
          <kbd className={styles.kbd}>{sc.keys}</kbd>
          <span className={styles.shortcutAction}>{sc.action}</span>
        </div>
      ))}
    </div>
  );
}
