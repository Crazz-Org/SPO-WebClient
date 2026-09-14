/**
 * One confirmed logout path, shared by the desktop Settings button and the mobile System
 * menu — leaving the world is not something a single stray tap should do (#608).
 */
import { useUiStore } from '../../store/ui-store';

export function confirmLogout(onLogout: () => void): void {
  // Close whatever modal raised this (Settings, on desktop) BEFORE asking. `closeModal`
  // restores `modalBeneath` (ui-store.ts:306-311), so a confirm stacked ON TOP of Settings
  // would re-open Settings the moment it closes — including after a successful logout.
  useUiStore.getState().closeModal();
  useUiStore.getState().requestConfirm(
    'Log out',
    'Leave the world and return to the sign-in screen?',
    onLogout,
    { kind: 'destructive', confirmLabel: 'Log out' },
  );
}
