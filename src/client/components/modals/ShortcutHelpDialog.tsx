/**
 * ShortcutHelpDialog — the keyboard shortcut list, opened with `?` or from the CommandBar
 * "More" menu. An informational dialog: one "Close" button, Esc closes it too.
 */

import { useUiStore } from '../../store/ui-store';
import { Dialog } from '../common/Dialog';
import { ShortcutList } from '../common/ShortcutList';

export function ShortcutHelpDialog() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  if (modal !== 'shortcuts') return null;
  return (
    <Dialog
      title="Keyboard shortcuts"
      kind="info"
      singleAction
      primary={{ label: 'Close', onClick: closeModal }}
      onClose={closeModal}
    >
      <ShortcutList />
    </Dialog>
  );
}
