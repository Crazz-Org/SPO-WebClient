import { useUiStore } from '../../store/ui-store';

/**
 * The single confirmed logout path — Settings on desktop and the mobile System menu both
 * come through here, so the guard can never be half-applied.
 *
 * `closeModal()` inside the confirm callback is deliberate: `requestConfirm` stacks the
 * confirm over whatever modal raised it (`modalBeneath`), and GameScreen's own `closeModal`
 * would otherwise restore Settings on top of a session that is on its way out. Clearing the
 * stack here first makes the later restore a plain close. Cancelling does NOT run this —
 * it returns to Settings untouched.
 */
export function confirmLogout(onLogout: () => void): void {
  useUiStore.getState().requestConfirm(
    'Log out',
    'You will be returned to the login screen.',
    () => {
      useUiStore.getState().closeModal();
      onLogout();
    },
    { kind: 'destructive', confirmLabel: 'Log out' },
  );
}
